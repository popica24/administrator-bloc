/* Administrator: Sesizari si Comunicare (harta functiilor §4.4 si §4.5) */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, tab, serviciu, blocD14, apartamentulNumarul, profilDupaTelefon,
  CONTURI, asteaptaToast, textEcran, CUVINTE_TEHNICE, fisierPdf,
  asociatieD14,
} from "./ajutor.js";

/* Identificatorii se cauta in baza: un `db reset && npm run seed` le schimba */
let ASOC;
test.beforeAll(async () => { ASOC = await asociatieD14(); });

async function sesizareDeTest(titlu, stare = "noua") {
  const b = await blocD14();
  const ap = await apartamentulNumarul(17);
  const autor = await profilDupaTelefon(CONTURI.elena);
  const { data, error } = await serviciu().schema("sesizari").from("sesizari").insert({
    bloc_id: b.id, apartament_id: ap.id, autor_id: autor.id,
    categorie: "instalatii", titlu, descriere: "Curge apa la robinetul de pe palier.", stare,
  }).select("id").single();
  if (error) throw new Error(`sesizareDeTest: ${error.message}`);
  return data.id;
}

async function stergeSesizare(id) {
  const sb = serviciu();
  await sb.schema("sesizari").from("sesizari_mesaje").delete().eq("sesizare_id", id);
  await sb.schema("sesizari").from("sesizari_poze").delete().eq("sesizare_id", id);
  await sb.schema("sesizari").from("sesizari").delete().eq("id", id);
}

async function stergeNotificariDupa(iso) {
  await serviciu().schema("comunicare").from("notificari").delete().gte("trimisa_la", iso);
}

test.describe("Sesizări, administrator", () => {
  test("filtrele si timpul de asteptare", async ({ page }) => {
    const b = await blocD14();
    const { count: deschise } = await serviciu().schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("bloc_id", b.id).neq("stare", "rezolvata");

    await intraCa(page, "admin");
    await mergiLaTab(page, "Sesizări");
    await expect(page.getByText(`${deschise} DESCHISE`)).toBeVisible();
    await expect(page.getByText(/Așteaptă de \d+ (de )?zile|Trimisă azi/).first()).toBeVisible();
    await page.getByRole("button", { name: "Rezolvate" }).click();
    await expect(page.getByText("Rezolvată").first()).toBeVisible();
    await page.getByRole("button", { name: "Toate" }).click();
    const t = await textEcran(page);
    expect(t).toMatch(/Ap\. \d+ · /);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("badge-ul de pe tab numara sesizarile noi", async ({ page }) => {
    const b = await blocD14();
    const { count } = await serviciu().schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("bloc_id", b.id).eq("stare", "noua");
    await intraCa(page, "admin");
    if (count > 0) await expect(tab(page, "Sesizări")).toContainText(String(count));
  });

  test("raspunsul trece sesizarea in lucru si ajunge la locatar", async ({ page }) => {
    const titlu = `E2E răspuns ${Date.now()}`;
    const id = await sesizareDeTest(titlu);
    await intraCa(page, "admin");
    await mergiLaTab(page, "Sesizări");
    await page.getByRole("button", { name: titlu }).click();
    const dialog = page.getByRole("dialog", { name: "Ap. 17" });
    await expect(dialog).toContainText("Curge apa la robinetul de pe palier.");
    await expect(buton(page, "Trimite răspunsul")).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel("Răspuns pentru proprietar").fill("Vine instalatorul joi dimineata.");
    await buton(page, "Trimite răspunsul").click();
    await asteaptaToast(page, "Mesajul a fost trimis");
    await expect(dialog.getByText("Vine instalatorul joi dimineata.")).toBeVisible();
    await expect(dialog.getByText("În lucru").first()).toBeVisible();

    const { data } = await serviciu().schema("sesizari").from("sesizari").select("stare").eq("id", id).single();
    expect(data.stare).toBe("in_lucru");
    const { data: mesaje } = await serviciu().schema("sesizari").from("sesizari_mesaje")
      .select("text, din_administratie").eq("sesizare_id", id);
    expect(mesaje).toHaveLength(1);
    expect(mesaje[0].din_administratie).toBe(true);
    await stergeSesizare(id);
  });

  test("preluarea si rezolvarea schimba starea", async ({ page }) => {
    const titlu = `E2E preluare ${Date.now()}`;
    const id = await sesizareDeTest(titlu);
    await intraCa(page, "admin");
    await mergiLaTab(page, "Sesizări");
    await page.getByRole("button", { name: titlu }).click();
    await buton(page, "Preiau sesizarea").click();
    await asteaptaToast(page, "Sesizarea este în lucru");
    await expect.poll(async () => {
      const { data } = await serviciu().schema("sesizari").from("sesizari").select("stare, preluata_la").eq("id", id).single();
      return data.stare === "in_lucru" && data.preluata_la !== null;
    }, { timeout: 20000 }).toBe(true);

    await buton(page, "Marchează rezolvată").click();
    await asteaptaToast(page, "Sesizarea a fost marcată rezolvată");
    await expect.poll(async () => {
      const { data } = await serviciu().schema("sesizari").from("sesizari").select("stare").eq("id", id).single();
      return data.stare;
    }, { timeout: 20000 }).toBe("rezolvata");

    await page.getByRole("button", { name: "Rezolvate" }).click();
    await page.getByRole("button", { name: titlu }).click();
    await expect(buton(page, "Trimite răspunsul")).toHaveCount(0);
    await stergeSesizare(id);
  });
});

test.describe("Comunicare: anunțuri", () => {
  test("anuntul nou apare la avizier cu numarul de cititori", async ({ page }) => {
    const titlu = `E2E anunț ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await buton(page, "Scrie un anunț").click();
    await expect(buton(page, "Publică anunțul")).toHaveAttribute("aria-disabled", "true");
    await page.getByLabel("Titlu").fill(titlu);
    await page.getByLabel("Continut").fill("Se schimbă becurile de pe casa scării joi.");
    await buton(page, "Publică anunțul").click();
    await asteaptaToast(page, "Anunț publicat la avizier");

    await expect(page.getByText(titlu)).toBeVisible();
    await expect(page.getByText(/Citit de \d+ din \d+ locatari cu cont/).first()).toBeVisible();
    const { data } = await serviciu().schema("comunicare").from("anunturi")
      .select("id, urgent, corp").eq("asociatie_id", ASOC).eq("titlu", titlu).single();
    expect(data.urgent).toBe(false);
    expect(data.corp).toBe("Se schimbă becurile de pe casa scării joi.");

    await serviciu().schema("comunicare").from("anunturi_citiri").delete().eq("anunt_id", data.id);
    await serviciu().schema("comunicare").from("anunturi").delete().eq("id", data.id);
  });

  test("anuntul urgent trimite si notificare", async ({ page }) => {
    const inceput = new Date().toISOString();
    const titlu = `E2E urgent ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await buton(page, "Scrie un anunț").click();
    await page.getByLabel("Titlu").fill(titlu);
    await page.getByLabel("Continut").fill("Se opreste apa maine între 8 și 14.");
    await page.getByRole("button", { name: "Urgent" }).click();
    await buton(page, "Publică anunțul").click();
    await asteaptaToast(page, "Anunț publicat și notificare trimisă");

    const { data } = await serviciu().schema("comunicare").from("anunturi")
      .select("id, urgent").eq("asociatie_id", ASOC).eq("titlu", titlu).single();
    expect(data.urgent).toBe(true);
    await expect.poll(async () => {
      const { count } = await serviciu().schema("comunicare").from("notificari")
        .select("id", { count: "exact", head: true }).gte("trimisa_la", inceput);
      return count;
    }, { timeout: 25000 }).toBeGreaterThan(0);

    await stergeNotificariDupa(inceput);
    await serviciu().schema("comunicare").from("anunturi_citiri").delete().eq("anunt_id", data.id);
    await serviciu().schema("comunicare").from("anunturi").delete().eq("id", data.id);
  });
});

test.describe("Comunicare: remindere", () => {
  test("comutatorul si numarul de zile se salveaza", async ({ page }) => {
    const sb = serviciu();
    const { data: inainte } = await sb.schema("comunicare").from("remindere_setari")
      .select("tip, activ, zile").eq("asociatie_id", ASOC).eq("tip", "adunare_generala").single();

    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await page.getByRole("button", { name: "Remindere" }).click();
    await expect(page.getByText("Convocare adunare generală")).toBeVisible();
    await page.getByRole("button", { name: "Convocare adunare generală" }).click();
    await asteaptaToast(page, "").catch(() => {});
    await expect.poll(async () => {
      const { data } = await sb.schema("comunicare").from("remindere_setari")
        .select("activ").eq("asociatie_id", ASOC).eq("tip", "adunare_generala").single();
      return data.activ;
    }, { timeout: 20000 }).toBe(!inainte.activ);

    if (!inainte.activ) {
      const rand = page.getByLabel("Convocare adunare generală").locator("xpath=../..");
      await rand.getByRole("button", { name: "7 zile" }).click();
      await expect.poll(async () => {
        const { data } = await sb.schema("comunicare").from("remindere_setari")
          .select("zile").eq("asociatie_id", ASOC).eq("tip", "adunare_generala").single();
        return data.zile;
      }, { timeout: 20000 }).toBe(7);
    }

    await sb.schema("comunicare").from("remindere_setari")
      .update({ activ: inainte.activ, zile: inainte.zile }).eq("asociatie_id", ASOC).eq("tip", "adunare_generala");
  });

  test("Trimite acum raporteaza cati locatari au primit", async ({ page }) => {
    const inceput = new Date().toISOString();
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await page.getByRole("button", { name: "Remindere" }).click();
    const trimiteAcum = page.getByText("Trimite acum", { exact: true }).locator("xpath=..");
    for (const eticheta of ["Reamintire de citire index", "Reamintire de plată", "Înștiințare restanțieri"]) {
      await trimiteAcum.getByRole("button", { name: eticheta, exact: true }).click();
      await expect(page.locator(".ab-toast")).toContainText(/Trimis către .* cu cont, din .* vizat/, { timeout: 20000 });
    }
    await stergeNotificariDupa(inceput);
  });
});

test.describe("Comunicare: vot si adunare", () => {
  test("votul nou cere doua variante si o data de inchidere", async ({ page }) => {
    const inceput = new Date().toISOString();
    const titlu = `E2E vot ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await page.getByRole("button", { name: "Vot și AG" }).click();
    await buton(page, "Deschide un vot nou").click();
    const dialog = page.getByRole("dialog", { name: "Vot nou" });
    await dialog.getByLabel("Ce se votează").fill(titlu);
    await dialog.getByLabel("Detalii").fill("Două oferte, 12.000 și 14.500 lei.");
    await expect(buton(page, "Deschide votul")).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel("Varianta 1").fill("Da");
    await dialog.getByLabel("Varianta 2").fill("Nu");
    await expect(buton(page, "Deschide votul")).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel("Votul se închide pe").fill("2026-10-31");
    await buton(page, "Deschide votul").click();
    await asteaptaToast(page, "Votul a fost deschis");

    const { data } = await serviciu().schema("guvernanta").from("voturi")
      .select("id, numarare, inchide_la").eq("asociatie_id", ASOC).eq("titlu", titlu).single();
    expect(data.numarare).toBe("apartament");
    const { data: optiuni } = await serviciu().schema("guvernanta").from("voturi_optiuni")
      .select("text").eq("vot_id", data.id);
    expect(optiuni.map((o) => o.text).sort()).toEqual(["Da", "Nu"]);
    await expect(page.getByText("Nu au votat: ap. 1, 2, 3")).toBeVisible();

    await serviciu().schema("guvernanta").from("voturi_optiuni").delete().eq("vot_id", data.id);
    await serviciu().schema("guvernanta").from("voturi").delete().eq("id", data.id);
    await stergeNotificariDupa(inceput);
  });

  test("variantele in plus se adauga si se scot", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await page.getByRole("button", { name: "Vot și AG" }).click();
    await buton(page, "Deschide un vot nou").click();
    const dialog = page.getByRole("dialog", { name: "Vot nou" });
    await expect(dialog.getByRole("textbox", { name: /^Varianta / })).toHaveCount(2);
    await expect(buton(page, "Șterge varianta")).toHaveCount(0);
    await buton(page, "Adaugă o variantă").click();
    await expect(dialog.getByRole("textbox", { name: /^Varianta / })).toHaveCount(3);
    await buton(page, "Șterge varianta").first().click();
    await expect(dialog.getByRole("textbox", { name: /^Varianta / })).toHaveCount(2);
  });

  test("convocarea adunarii pleaca cu data, ora si locul", async ({ page }) => {
    const inceput = new Date().toISOString();
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await page.getByRole("button", { name: "Vot și AG" }).click();
    await buton(page, "Convoacă adunarea").click();
    const dialog = page.getByRole("dialog", { name: "Convoacă adunarea generală" });
    await expect(buton(page, "Trimite convocarea")).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel("Data").fill("2026-11-12");
    await dialog.getByLabel("Ora").fill("19:00");
    await dialog.getByLabel("Locul").fill("E2E la parter");
    await dialog.getByLabel("Ordinea de zi").fill("E2E bugetul pe 2027");
    await buton(page, "Trimite convocarea").click();
    await asteaptaToast(page, "Convocarea a fost trimisă locatarilor cu cont");

    const { data } = await serviciu().schema("guvernanta").from("adunari_generale")
      .select("id, loc, ordine_de_zi, data_ora").eq("asociatie_id", ASOC).eq("loc", "E2E la parter").single();
    expect(data.ordine_de_zi).toBe("E2E bugetul pe 2027");
    expect(new Date(data.data_ora).toISOString().slice(0, 10)).toBe("2026-11-12");
    await expect(page.getByText("Adunarea generală din 12 noiembrie 2026")).toBeVisible();

    await serviciu().schema("guvernanta").from("adunari_prezente").delete().eq("adunare_id", data.id);
    await serviciu().schema("guvernanta").from("adunari_generale").delete().eq("id", data.id);
    await stergeNotificariDupa(inceput);
  });
});

test.describe("Comunicare: acte", () => {
  test("documentul incarcat apare cu badge-ul de vizibilitate", async ({ page }) => {
    const titlu = `E2E document ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await page.getByRole("button", { name: "Acte", exact: true }).click();
    await buton(page, "Încarcă un document").click();
    const dialog = page.getByRole("dialog", { name: "Document nou" });
    await expect(buton(page, "Încarcă documentul")).toHaveAttribute("aria-disabled", "true");
    await dialog.getByLabel("Titlu").fill(titlu);
    await dialog.getByLabel("Tip").selectOption("proces_verbal");
    await dialog.locator('input[type="file"]').setInputFiles(fisierPdf("proces-verbal.pdf"));
    await page.getByRole("button", { name: "Vizibil locatarilor" }).click();
    await buton(page, "Încarcă documentul").click();
    await asteaptaToast(page, "Documentul a fost încărcat");

    const { data } = await serviciu().schema("comunicare").from("documente")
      .select("id, tip, vizibil_locatarilor, cale").eq("asociatie_id", ASOC).eq("titlu", titlu).single();
    expect(data.tip).toBe("proces_verbal");
    expect(data.vizibil_locatarilor).toBe(false);
    await expect(page.getByText(titlu)).toBeVisible();
    await expect(page.getByText("Doar admin").first()).toBeVisible();

    await serviciu().storage.from("documente").remove([data.cale]);
    await serviciu().schema("comunicare").from("documente").delete().eq("id", data.id);
  });
});
