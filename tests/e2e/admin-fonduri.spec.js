/* Administrator: tabul Fonduri din Apartamente (harta functiilor §4.2 si §6.7).
   Soldurile, miscarile, "Inregistreaza o iesire" cu document obligatoriu, suma
   scrisa pozitiv dar salvata negativ si refuzul care ar duce fondul sub zero.
   Fiecare test isi sterge miscarile, ca soldul demo sa ramana cel din seed. */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, serviciu, blocD14, asteaptaToast,
  textEcran, CUVINTE_TEHNICE, fisierPoza,
} from "./ajutor.js";

const MARCAJ = "E2E fond";

async function fonduri() {
  const b = await blocD14();
  const { data, error } = await serviciu().schema("financiar").from("fonduri")
    .select("*").eq("bloc_id", b.id);
  if (error) throw new Error(error.message);
  return data;
}

async function fondReparatii() {
  return (await fonduri()).find((f) => f.tip === "reparatii");
}

async function miscari(fondId) {
  const { data, error } = await serviciu().schema("financiar").from("miscari_fond")
    .select("*").eq("fond_id", fondId);
  if (error) throw new Error(error.message);
  return data;
}

async function sold(fondId) {
  const m = await miscari(fondId);
  return Math.round(m.reduce((s, x) => s + Number(x.suma), 0) * 100) / 100;
}

/* Sterge tot ce au lasat testele: miscarea si documentul ei */
async function curataMiscarileDeTest() {
  const sb = serviciu();
  const { data } = await sb.schema("financiar").from("miscari_fond")
    .select("id, document_id, descriere").like("descriere", `${MARCAJ}%`);
  for (const m of data || []) {
    await sb.schema("financiar").from("miscari_fond").delete().eq("id", m.id);
    if (m.document_id) {
      const { data: doc } = await sb.schema("comunicare").from("documente")
        .select("cale").eq("id", m.document_id).maybeSingle();
      if (doc && doc.cale) await sb.storage.from("documente").remove([doc.cale]);
      await sb.schema("comunicare").from("documente").delete().eq("id", m.document_id);
    }
  }
  await sb.schema("comunicare").from("documente").delete().like("titlu", `${MARCAJ}%`);
}

test.beforeAll(curataMiscarileDeTest);
test.afterEach(curataMiscarileDeTest);

async function deschideFonduri(page) {
  await intraCa(page, "admin");
  await mergiLaTab(page, "Apartamente");
  await page.getByRole("button", { name: "Fonduri", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fonduri" }).or(page.getByText("Fonduri").first())).toBeVisible();
}

test.describe("Fonduri: ce se vede", () => {
  test("tabul arata fiecare fond cu soldul din registru si cu miscarile lui", async ({ page }) => {
    const toate = await fonduri();
    await deschideFonduri(page);

    for (const f of toate) {
      await expect(page.getByText(f.denumire).first()).toBeVisible();
      const s = await sold(f.id);
      const scris = `${Math.abs(s).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d),)/g, ".")}`;
      expect(scris.length).toBeGreaterThan(0);
    }
    const reparatii = await fondReparatii();
    for (const m of await miscari(reparatii.id)) {
      await expect(page.getByText(m.descriere).first()).toBeVisible();
    }
  });

  test("soldul afisat este suma miscarilor, la banul din registru", async ({ page }) => {
    const reparatii = await fondReparatii();
    const asteptat = await sold(reparatii.id);
    await deschideFonduri(page);
    const text = await textEcran(page);
    const intreg = Math.trunc(asteptat).toLocaleString("ro-RO");
    const zecimale = Math.abs(asteptat).toFixed(2).slice(-2);
    expect(text).toContain(`${intreg},${zecimale}`);
  });

  test("fiecare iesire din registru isi arata documentul justificativ", async ({ page }) => {
    const reparatii = await fondReparatii();
    const cuDocument = (await miscari(reparatii.id)).filter((m) => m.document_id);
    expect(cuDocument.length).toBeGreaterThan(0);
    await deschideFonduri(page);
    await expect(buton(page, "Vezi documentul").first()).toBeVisible();
  });

  test("KPI-ul Fond de reparatii de pe Sumar duce direct in tabul Fonduri", async ({ page }) => {
    await intraCa(page, "admin");
    await page.getByRole("button", { name: /^Fond de reparatii/ }).first().click();
    await expect(page.getByRole("tab", { name: /^Apartamente/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Fonduri", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(buton(page, "Inregistreaza o iesire").first()).toBeVisible();
  });
});

test.describe("Fonduri: inregistrarea unei iesiri", () => {
  test("suma se scrie pozitiv si se salveaza negativa, cu document", async ({ page }) => {
    const reparatii = await fondReparatii();
    const inainte = await sold(reparatii.id);
    const descriere = `${MARCAJ} schimbat teava ${Date.now()}`;

    await deschideFonduri(page);
    await buton(page, "Inregistreaza o iesire").first().click();
    const panou = page.getByRole("dialog", { name: "Iesire din fond" });
    await expect(panou.getByText("Scrie suma ca numar pozitiv; ea se scade din fond.")).toBeVisible();

    await page.getByLabel("Suma iesita").fill("430,50");
    await page.getByLabel("Pentru ce").fill(descriere);
    await page.setInputFiles("input[type=file]", fisierPoza("factura-teava.jpg"));
    await buton(page, "Inregistreaza iesirea").click();
    await asteaptaToast(page, "Iesirea din fond a fost inregistrata");

    const ale = (await miscari(reparatii.id)).filter((m) => m.descriere === descriere);
    expect(ale).toHaveLength(1);
    expect(Number(ale[0].suma)).toBe(-430.5);
    expect(ale[0].document_id).not.toBeNull();
    expect(await sold(reparatii.id)).toBe(Math.round((inainte - 430.5) * 100) / 100);

    /* Panoul se inchide si miscarea apare pe ecran, cu semnul minus */
    await expect(panou).toHaveCount(0);
    await expect(page.getByText(descriere)).toBeVisible();
    await expect(page.getByText("-430,50", { exact: true })).toBeVisible();
  });

  test("fara document salvarea ramane blocata", async ({ page }) => {
    await deschideFonduri(page);
    await buton(page, "Inregistreaza o iesire").first().click();
    await expect(buton(page, "Inregistreaza iesirea")).toBeDisabled();
    await page.getByLabel("Suma iesita").fill("100");
    await expect(buton(page, "Inregistreaza iesirea")).toBeDisabled();
    await page.getByLabel("Pentru ce").fill(`${MARCAJ} fara document`);
    await expect(buton(page, "Inregistreaza iesirea")).toBeDisabled();
    await page.setInputFiles("input[type=file]", fisierPoza("document.jpg"));
    await expect(buton(page, "Inregistreaza iesirea")).not.toBeDisabled();
  });

  test("o iesire mai mare decat soldul este refuzata, pe romaneste", async ({ page }) => {
    const reparatii = await fondReparatii();
    const inainte = await sold(reparatii.id);
    const descriere = `${MARCAJ} peste sold ${Date.now()}`;

    await deschideFonduri(page);
    await buton(page, "Inregistreaza o iesire").first().click();
    await page.getByLabel("Suma iesita").fill(String(Math.ceil(inainte) + 1000));
    await page.getByLabel("Pentru ce").fill(descriere);
    await page.setInputFiles("input[type=file]", fisierPoza("prea-mult.jpg"));
    await buton(page, "Inregistreaza iesirea").click();

    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 20000 });
    const mesaj = await page.locator(".ab-toast").innerText();
    expect(mesaj).toMatch(/fond|sold/i);
    for (const cuvant of CUVINTE_TEHNICE) expect(mesaj, `mesajul contine "${cuvant}"`).not.toContain(cuvant);

    expect(await sold(reparatii.id)).toBe(inainte);
  });

  test.fixme("[F3] refuzul pe sold nu lasa documentul orfan la avizierul de Acte", async ({ page }) => {
    /* [F3] Reparatia C6 verifica ieftin suma, descrierea si data inainte de a
       incarca documentul, dar verificarea care conteaza — soldul fondului nu
       poate trece sub zero — este in RPC, dupa upload. Cand RPC-ul refuza,
       documentul ramane in comunicare.documente cu vizibil_locatarilor = true
       (implicitul lui `document()`, src/sursa-supabase.js:325 si :528), deci
       factura unei plati care nu s-a facut niciodata apare la toti locatarii,
       in Bloc > Acte, fara nicio miscare in spatele ei. */
    const reparatii = await fondReparatii();
    const inainte = await sold(reparatii.id);
    const descriere = `${MARCAJ} orfan ${Date.now()}`;

    await deschideFonduri(page);
    await buton(page, "Inregistreaza o iesire").first().click();
    await page.getByLabel("Suma iesita").fill(String(Math.ceil(inainte) + 1000));
    await page.getByLabel("Pentru ce").fill(descriere);
    await page.setInputFiles("input[type=file]", fisierPoza("prea-mult.jpg"));
    await buton(page, "Inregistreaza iesirea").click();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 20000 });

    const { data: docuri } = await serviciu().schema("comunicare").from("documente")
      .select("id, vizibil_locatarilor").eq("titlu", descriere);
    expect(docuri, "documentul unei iesiri refuzate ramane in baza").toHaveLength(0);

    await buton(page, "Iesi").click();
    await intraCa(page, "elena");
    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Acte", exact: true }).click();
    await expect(page.getByText(descriere)).toHaveCount(0);
  });

  test("suma zero si data din viitor sunt oprite inainte de server", async ({ page }) => {
    await deschideFonduri(page);
    await buton(page, "Inregistreaza o iesire").first().click();
    await page.getByLabel("Suma iesita").fill("0");
    await page.getByLabel("Pentru ce").fill(`${MARCAJ} zero`);
    await page.setInputFiles("input[type=file]", fisierPoza("zero.jpg"));
    await expect(buton(page, "Inregistreaza iesirea")).toBeDisabled();

    await page.getByLabel("Suma iesita").fill("50");
    const maine = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await page.getByLabel("Data").fill(maine);
    await buton(page, "Inregistreaza iesirea").click();
    await asteaptaToast(page, "Data iesirii din fond nu poate fi in viitor");
    const { data: docuri } = await serviciu().schema("comunicare").from("documente")
      .select("id").like("titlu", `${MARCAJ}%`);
    expect(docuri).toHaveLength(0);
  });

  test("panoul pornit nu se inchide la atingerea fundalului", async ({ page }) => {
    await deschideFonduri(page);
    await buton(page, "Inregistreaza o iesire").first().click();
    await page.getByLabel("Pentru ce").fill(`${MARCAJ} text scris`);
    const cutie = await page.locator(".ab-shell").boundingBox();
    await page.mouse.click(cutie.x + cutie.width / 2, cutie.y + 20);
    await expect(page.getByRole("dialog", { name: "Iesire din fond" })).toBeVisible();
    await expect(page.getByLabel("Pentru ce")).toHaveValue(`${MARCAJ} text scris`);
  });

  test("iesirea inregistrata de administrator se vede si la locatar, cu documentul ei", async ({ page }) => {
    const descriere = `${MARCAJ} vazut de locatar ${Date.now()}`;
    await deschideFonduri(page);
    await buton(page, "Inregistreaza o iesire").first().click();
    await page.getByLabel("Suma iesita").fill("120");
    await page.getByLabel("Pentru ce").fill(descriere);
    await page.setInputFiles("input[type=file]", fisierPoza("chitanta.jpg"));
    await buton(page, "Inregistreaza iesirea").click();
    await asteaptaToast(page, "Iesirea din fond a fost inregistrata");

    await buton(page, "Iesi").click();
    await intraCa(page, "elena");
    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Fonduri", exact: true }).click();
    await expect(page.getByText("Unde s-au dus banii").first()).toBeVisible();
    await expect(page.getByText(descriere)).toBeVisible();
    await expect(page.getByText("-120,00", { exact: true })).toBeVisible();
  });
});

test.describe("Fonduri: cine ajunge la ele", () => {
  test("locatarul vede fondurile, dar nu poate inregistra o iesire", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Fonduri", exact: true }).click();
    await expect(page.getByText("Fond de reparatii").first()).toBeVisible();
    const text = await textEcran(page);
    expect(text).not.toContain("Inregistreaza o iesire");
  });
});
