/* Drumurile pe care le face un om real cand ceva nu merge: internetul cade in
   mijlocul comenzii, sesiunea expira cu formularul deschis, apasa de doua ori,
   sau are aplicatia deschisa in doua locuri deodata si al doilea schimba datele
   sub primul. */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, serviciu, blocD14, apartamentulNumarul,
  datorieDeTest, soldApartament, asteaptaToast, CUVINTE_TEHNICE,
  listaLunara, fisierPdf,
} from "./ajutor.js";

let LISTA_CIORNA;
test.beforeAll(async () => {
  LISTA_CIORNA = (await listaLunara({ stare: "ciorna" })).id;
});

/* Tot ce lasa in urma testele din fisier: facturi de proba, furnizorii lor si
   documentele urcate odata cu ele (inclusiv fisierul din bucket) */
test.afterEach(async () => {
  const sb = serviciu();
  await sb.schema("intretinere").from("cheltuieli").delete().eq("lista_id", LISTA_CIORNA).like("categorie", "E2E%");
  const { data: furnizori } = await sb.schema("intretinere").from("furnizori").select("id").like("denumire", "E2E%");
  for (const f of furnizori || []) {
    const { count } = await sb.schema("intretinere").from("cheltuieli")
      .select("id", { count: "exact", head: true }).eq("furnizor_id", f.id);
    if (!count) await sb.schema("intretinere").from("furnizori").delete().eq("id", f.id);
  }
  const { data: documente } = await sb.schema("comunicare").from("documente").select("id, cale").like("titlu", "Factura E2E%");
  for (const d of documente || []) {
    if (d.cale) await sb.storage.from("documente").remove([d.cale]);
    await sb.schema("comunicare").from("documente").delete().eq("id", d.id);
  }
});

async function chitante() {
  const { count } = await serviciu().schema("financiar").from("chitante")
    .select("id", { count: "exact", head: true });
  return count;
}

test.describe("internetul cade in mijlocul comenzii", () => {
  test("comanda cazuta spune ca serverul nu raspunde si nu scrie nimic", async ({ page }) => {
    const sb = serviciu();
    const b = await blocD14();
    const { count: inainte } = await sb.schema("comunicare").from("anunturi")
      .select("id", { count: "exact", head: true }).eq("asociatie_id", b.asociatie_id);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await buton(page, "Scrie un anunt").click();
    const panou = page.getByRole("dialog", { name: "Anunt nou" });
    await panou.getByLabel("Titlu").fill("E2E anunt fara internet");
    await panou.getByLabel("Continut").fill("Nu ajunge la server.");

    await page.route("**/rest/v1/rpc/publica_anunt", (r) => r.abort());
    await buton(page, "Publica anuntul").click();

    const toast = page.locator(".ab-toast");
    await expect(toast).toBeVisible({ timeout: 20000 });
    const mesaj = await toast.innerText();
    expect(mesaj).toContain("Serverul nu raspunde");
    for (const cuvant of CUVINTE_TEHNICE) expect(mesaj).not.toContain(cuvant);
    await page.unroute("**/rest/v1/rpc/publica_anunt");

    const { count: dupa } = await sb.schema("comunicare").from("anunturi")
      .select("id", { count: "exact", head: true }).eq("asociatie_id", b.asociatie_id);
    expect(dupa).toBe(inainte);

    /* Formularul ramane deschis, cu textul scris, ca omul sa reincerce */
    await expect(panou.getByLabel("Titlu")).toHaveValue("E2E anunt fara internet");
  });

  /* reincarca() isi prinde singur erorile, deci o comanda reusita a carei
     reincarcare cade tot spune ca a reusit. Omul vede intai "Serverul nu
     raspunde" (de la reincarcare) si apoi confirmarea comenzii. */
  test("o incasare reusita se confirma chiar daca reincarcarea de dupa ea cade", async ({ page }) => {
    const ap = await apartamentulNumarul(18);
    await datorieDeTest(ap.id, 13.13, "E2E reincarcare cazuta");
    const inainte = await chitante();

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 18" }).click();
    await buton(page, "Inregistreaza incasare cash").click();

    /* Comanda trece; doar reincarcarea de dupa ea nu mai are internet */
    await page.route("**/rest/v1/rpc/eu", (r) => r.abort());
    await buton(page, "Emite chitanta").click();
    const toast = page.locator(".ab-toast");
    await expect(toast).toBeVisible({ timeout: 20000 });
    const mesaj = await toast.innerText();
    await page.unroute("**/rest/v1/rpc/eu");

    /* Chitanta chiar s-a emis: mesajul nu are voie sa spuna altceva */
    expect(await chitante()).toBe(inainte + 1);
    expect(mesaj).toContain("Incasare inregistrata");
  });

  test("reincarcarea cazuta dupa o incasare nu face totusi doua chitante", async ({ page }) => {
    /* Oricare ar fi mesajul, banii se iau o singura data: testul apara
       invariantul si cand reincarcarea de dupa comanda cade. */
    const ap = await apartamentulNumarul(13);
    await datorieDeTest(ap.id, 9.09, "E2E reincarcare cazuta 2");
    const inainte = await chitante();

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 13" }).click();
    await buton(page, "Inregistreaza incasare cash").click();
    await page.route("**/rest/v1/rpc/eu", (r) => r.abort());
    await buton(page, "Emite chitanta").click();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 20000 });
    await page.unroute("**/rest/v1/rpc/eu");

    expect(await chitante()).toBe(inainte + 1);
    expect(await soldApartament(ap.id)).toBe(0);
  });
});

/* Sesiunea expira (config.toml: 24 de ore, sau 8 ore de inactivitate) sau este
   inchisa din alta parte. Aici se reproduce exact: sesiunea este revocata in
   server si tokenul din browser este trecut de valabilitate, deci reimprospatarea
   nu mai are ce sa reinnoiasca. */
async function inchideSesiuneaDinServer(page) {
  const token = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes("auth-token"));
    return JSON.parse(localStorage.getItem(k)).access_token;
  });
  const { error } = await serviciu().auth.admin.signOut(token, "global");
  if (error) throw new Error(`signOut: ${error.message}`);
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes("auth-token"));
    const v = JSON.parse(localStorage.getItem(k));
    v.expires_at = 1;
    v.expires_in = -1;
    localStorage.setItem(k, JSON.stringify(v));
  });
}

async function anuntInceput(page) {
  await intraCa(page, "admin");
  await mergiLaTab(page, "Comunicare");
  await buton(page, "Scrie un anunt").click();
  const panou = page.getByRole("dialog", { name: "Anunt nou" });
  await panou.getByLabel("Titlu").fill("E2E anunt cu sesiunea inchisa");
  await panou.getByLabel("Continut").fill("Sesiunea s-a inchis intre timp.");
  return panou;
}

test.describe("sesiunea expira cu formularul deschis", () => {
  /* [P3] Vezi raportul: eroarea bruta a bazei ajunge nemodificata pe ecran, in
     engleza tehnica, si nimic nu-i spune omului ca trebuie sa intre din nou. */
  test("[P3] sesiunea inchisa spune pe romaneste ce s-a intamplat", async ({ page }) => {
    await anuntInceput(page);
    await inchideSesiuneaDinServer(page);

    await buton(page, "Publica anuntul").click();
    const toast = page.locator(".ab-toast");
    await expect(toast).toBeVisible({ timeout: 20000 });
    const mesaj = await toast.innerText();

    expect(mesaj).toMatch(/sesiun|intra din nou/i);
    for (const cuvant of CUVINTE_TEHNICE) expect(mesaj).not.toContain(cuvant);
  });

  /* [R1] Reparatia P3 (`AdminBloc.jsx:4673`) scoate omul la ecranul de
     autentificare de indata ce o comanda loveste sesiunea moarta:
     `setSesiune(null)` demonteaza tot ecranul, cu panoul deschis cu tot, deci
     anuntul scris se pierde. Cele doua reparatii se bat cap in cap — mesajul
     pe romaneste a ramas, ce scrisese omul nu. Testul a fost verificat de 8
     ori la rand: cade de fiecare data. */
  test("[R1] sesiunea inchisa nu pierde ce s-a scris in formular", async ({ page }) => {
    const panou = await anuntInceput(page);
    await inchideSesiuneaDinServer(page);

    await buton(page, "Publica anuntul").click();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 20000 });

    await expect(panou.getByLabel("Titlu")).toHaveValue("E2E anunt cu sesiunea inchisa");
    await expect(panou.getByLabel("Continut")).toHaveValue("Sesiunea s-a inchis intre timp.");
  });

  test("comanda refuzata dupa inchiderea sesiunii nu scrie nimic", async ({ page }) => {
    const sb = serviciu();
    const b = await blocD14();
    const { count: inainte } = await sb.schema("comunicare").from("anunturi")
      .select("id", { count: "exact", head: true }).eq("asociatie_id", b.asociatie_id);

    await anuntInceput(page);
    await inchideSesiuneaDinServer(page);
    await buton(page, "Publica anuntul").click();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 20000 });

    const { count: dupa } = await sb.schema("comunicare").from("anunturi")
      .select("id", { count: "exact", head: true }).eq("asociatie_id", b.asociatie_id);
    expect(dupa).toBe(inainte);
  });
});

test.describe("aplicatia deschisa in doua locuri deodata", () => {
  test("al doilea tab sterge factura pe care primul o modifica", async ({ browser }) => {
    const categorie = `E2E doua taburi ${Date.now()}`;
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    try {
      await intraCa(a, "admin");
      await mergiLaTab(a, "Facturi");
      await buton(a, "Adauga factura").click();
      let panou = a.getByRole("dialog", { name: "Factura noua" });
      await panou.getByLabel("Sau scrie un furnizor nou").fill(`E2E Doua Taburi ${Date.now()}`);
      await panou.getByLabel("Ce cheltuiala este").fill(categorie);
      await panou.getByLabel("Suma facturii").fill("120");
      await buton(a, "Salveaza factura").click();
      await asteaptaToast(a, "Factura a fost adaugata");

      /* Primul tab deschide "Modifica" pe randul tocmai salvat */
      const rand = a.getByText(categorie).locator("xpath=../../../..");
      await rand.getByRole("button", { name: "Modifica" }).click();
      panou = a.getByRole("dialog", { name: "Modifica factura" });
      await panou.getByLabel("Suma facturii").fill("130");

      /* Al doilea tab sterge acelasi rand */
      await intraCa(b, "admin");
      await mergiLaTab(b, "Facturi");
      const randB = b.getByText(categorie).locator("xpath=../../../..");
      b.once("dialog", (d) => d.accept());
      await randB.getByRole("button", { name: "Sterge" }).click();
      await asteaptaToast(b, "Cheltuiala a fost stearsa");

      /* Primul tab salveaza peste un rand care nu mai exista */
      await buton(a, "Salveaza factura").click();
      const toast = a.locator(".ab-toast");
      await expect(toast).toContainText("Reincarca lista", { timeout: 20000 });
      const mesaj = await toast.innerText();
      for (const cuvant of CUVINTE_TEHNICE) expect(mesaj).not.toContain(cuvant);

      /* Dupa reincarcare, primul tab vede realitatea */
      await a.reload();
      await mergiLaTab(a, "Facturi");
      await expect(a.getByText(categorie)).toHaveCount(0);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  /* [P4] Vezi raportul: factura scanata se inregistreaza ca document vizibil
     locatarilor inainte ca randul de cheltuiala sa fie salvat. Daca salvarea
     cade (randul sters intre timp, lista publicata in alt tab), documentul
     ramane la "Acte", in fata locatarilor, fara nicio cheltuiala in spate —
     acelasi tipar reparat la iesirea din fond (F3). */
  test("[P4] o salvare cazuta nu lasa factura scanata la Acte", async ({ page }) => {
    const sb = serviciu();
    const categorie = `E2E scan orfan ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Adauga factura").click();
    let panou = page.getByRole("dialog", { name: "Factura noua" });
    await panou.getByLabel("Sau scrie un furnizor nou").fill(`E2E Scan ${Date.now()}`);
    await panou.getByLabel("Ce cheltuiala este").fill(categorie);
    await panou.getByLabel("Suma facturii").fill("150");
    await buton(page, "Salveaza factura").click();
    await asteaptaToast(page, "Factura a fost adaugata");

    const { data: c } = await sb.schema("intretinere").from("cheltuieli")
      .select("id").eq("lista_id", LISTA_CIORNA).eq("categorie", categorie).single();

    const rand = page.getByText(categorie).locator("xpath=../../../..");
    await rand.getByRole("button", { name: "Modifica" }).click();
    panou = page.getByRole("dialog", { name: "Modifica factura" });
    await panou.getByLabel("Serie si numar factura").fill("E2E-ORFAN");
    await panou.locator('input[type="file"]').setInputFiles(fisierPdf());

    /* Randul dispare de sub formular (sters din alt tab) */
    await sb.schema("intretinere").from("cheltuieli").delete().eq("id", c.id);

    await buton(page, "Salveaza factura").click();
    await asteaptaToast(page, "Reincarca lista");

    const { data: orfane } = await sb.schema("comunicare").from("documente")
      .select("id, titlu, vizibil_locatarilor").eq("titlu", "Factura E2E-ORFAN");
    expect(orfane).toHaveLength(0);
  });
});

test.describe("dublul apasat pe comenzile administratorului", () => {
  test("Valideaza apasat de doua ori valideaza o singura data", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(9);
    const luna = "2026-09-01";
    await sb.schema("contorizare").from("citiri")
      .update({ stare: "trimisa", verificata_de: null, verificata_la: null, motiv_respingere: null })
      .eq("apartament_id", ap.id).eq("luna", luna);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    const card = page.getByText("Ap. 9 · Mircea Olaru").locator("xpath=../..");
    await card.getByRole("button", { name: "Valideaza" }).dblclick();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 20000 });
    const mesaj = await page.locator(".ab-toast").innerText();
    /* Ori a mers o data, ori a doua apasare a fost oprita politicos; in niciun
       caz un mesaj tehnic sau "nu mai sunt citiri de verificat" */
    expect(mesaj).toMatch(/Citirea a fost validata|Asteapta sa se termine/);
    for (const cuvant of CUVINTE_TEHNICE) expect(mesaj).not.toContain(cuvant);

    const { data } = await sb.schema("contorizare").from("citiri")
      .select("stare").eq("apartament_id", ap.id).eq("luna", luna);
    expect(data.every((c) => c.stare === "validata")).toBe(true);

    await sb.schema("contorizare").from("citiri")
      .update({ stare: "trimisa", verificata_de: null, verificata_la: null, motiv_respingere: null })
      .eq("apartament_id", ap.id).eq("luna", luna);
  });
});
