/* Viata unui apartament: cineva se muta la mijlocul lunii, altcineva pleaca,
   apartamentul se vinde cu datorii cu tot, iar noul proprietar primeste cont.
   Intrebarea, peste tot, este ce vede omul nou despre omul dinaintea lui si ce
   ramane pe apartament dupa ce cineva pleaca.

   Regula pe care si-a pus-o proiectul la sesizari (migratia K4: un locatar nou
   nu citeste conversatia celui dinaintea lui) se cere aici si de la bani si de
   la documente. */

import { test, expect } from "@playwright/test";
import {
  buton, intra, intraCa, mergiLaTab, serviciu, blocD14, apartamentulNumarul,
  creeazaCont, stergeCont, legaDeApartament, textEcran, CUVINTE_TEHNICE,
  asteaptaToast, descarca, textPdf, soldApartament, datorieDeTest,
} from "./ajutor.js";

const azi = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Bucharest" });

async function repuneFisa(ap) {
  const { error } = await serviciu().schema("organizare").rpc("schimba_fisa_apartament", {
    p_apartament_id: ap.id,
    p_proprietar_nume: ap.proprietar_nume,
    p_cota_indiviza: ap.cota_indiviza,
    p_suprafata_mp: ap.suprafata_mp,
    p_scutit_lift: ap.scutit_lift,
    p_etaj: ap.etaj,
  });
  if (error) throw new Error(`repuneFisa: ${error.message}`);
}

test.describe("cineva se muta la mijlocul lunii", () => {
  const TELEFON = "0798507739";
  test.beforeAll(async () => { await stergeCont(TELEFON); });
  test.afterAll(async () => { await stergeCont(TELEFON); });

  test("chiriasul mutat azi intra si vede apartamentul, cu lista intreaga a lunii", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const pid = await creeazaCont(TELEFON, "Nicolae Mutat");
    const b = await blocD14();
    const { error } = await serviciu().schema("identitate").from("locatari").insert({
      apartament_id: ap.id, bloc_id: b.id, profil_id: pid, calitate: "chirias", activ_din: azi(),
    });
    if (error) throw new Error(error.message);

    await intra(page, TELEFON);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(`Apartament ${ap.numar}, Bloc D14, scara A`)).toBeVisible();

    /* Intretinerea nu se imparte pe zile: cine se muta pe 15 primeste
       lista intreaga a lunii. Ecranul trebuie macar sa fie intreg si pe
       romaneste, nu un ecran gol sau o eroare. */
    await mergiLaTab(page, "Plata");
    const t = await textEcran(page);
    expect(t).toContain("TOTAL DE PLATA ACUM");
    expect(t).toContain(String(await soldApartament(ap.id)).replace(".", ","));
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  /* [S3, reparat de auditul 4] Migratia K4 a scos conversatiile fostului
     locatar din ochii celui nou; banii au ramas nefiltrati pana acum, deci un
     chirias mutat azi vedea fiecare plata a celui dinaintea lui, cu suma, data
     si numarul chitantei, si ii putea descarca chitantele in PDF. Politica
     cere acum, ca la sesizari, ca plata sa fie din perioada lui. */
  test("[S3] chiriasul mutat azi nu vede platile si chitantele celui dinaintea lui", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const pid = await creeazaCont(TELEFON, "Nicolae Mutat");
    const b = await blocD14();
    await serviciu().schema("identitate").from("locatari").insert({
      apartament_id: ap.id, bloc_id: b.id, profil_id: pid, calitate: "chirias", activ_din: azi(),
    });

    await intra(page, TELEFON);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: "Platile mele" }).click();
    const t = await textEcran(page);
    expect(t).not.toMatch(/Chitanta [A-Z0-9]+ nr\./);
    await expect(buton(page, "Descarca chitanta")).toHaveCount(0);
  });
});

test.describe("cineva pleaca la mijlocul lunii", () => {
  const TELEFON = "0798349533";
  test.beforeAll(async () => { await stergeCont(TELEFON); });
  test.afterAll(async () => { await stergeCont(TELEFON); });

  test("administratorul inchide accesul din fisa, iar datoria ramane pe apartament", async ({ page, browser }) => {
    const ap = await apartamentulNumarul(10);
    const pid = await creeazaCont(TELEFON, "Olga Plecata");
    await legaDeApartament(pid, ap.id, "chirias");
    const datorie = await datorieDeTest(ap.id, 155.5, "E2E datoria celui plecat");

    try {
      /* Omul este in aplicatie chiar acum, cu un alt browser deschis */
      const ctx = await browser.newContext();
      const alPlecatului = await ctx.newPage();
      await intra(alPlecatului, TELEFON);
      await expect(alPlecatului.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });

      await intraCa(page, "admin");
      await mergiLaTab(page, "Apartamente");
      await page.getByRole("button", { name: `Apartament ${ap.numar}`, exact: true }).click();
      page.once("dialog", (d) => d.accept());
      await buton(page, "Inchide accesul").first().click();
      await asteaptaToast(page, "Accesul a fost inchis");

      /* Fisa il tine minte ca acces inchis, nu il sterge */
      const fisa = page.getByRole("dialog", { name: `Apartament ${ap.numar}` });
      await expect(fisa.getByText(/Olga Plecata, acces inchis pe/)).toBeVisible();

      /* Datoria lui ramane a apartamentului, nu pleaca odata cu el */
      expect(await soldApartament(ap.id)).toBeGreaterThanOrEqual(155.5);
      /* Fisa scrie datoria cu eticheta tipului ei si cu suma */
      await expect(fisa.getByText("155,50").first()).toBeVisible();

      /* Iar omul, la urmatoarea incarcare, nu mai vede nimic din bloc */
      await alPlecatului.reload();
      await expect(alPlecatului.getByText("Leaga contul de apartamentul tau")).toBeVisible({ timeout: 20000 });
      const t = await textEcran(alPlecatului);
      expect(t).not.toContain("155,50");
      for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
      await ctx.close();
    } finally {
      await serviciu().schema("financiar").from("datorii").delete().eq("id", datorie);
    }
  });
});

test.describe("apartamentul se vinde cu datorii cu tot", () => {
  const TELEFON = "0798073676";
  test.beforeAll(async () => { await stergeCont(TELEFON); });
  test.afterAll(async () => { await stergeCont(TELEFON); });

  test("noul proprietar preia soldul vechiului proprietar, scris pe fata", async ({ page }) => {
    const ap = await apartamentulNumarul(3);
    const vechi = { ...ap };
    const datorie = await soldApartament(ap.id);
    expect(datorie, "apartamentul 3 este restantierul demo").toBeGreaterThan(0);

    try {
      /* 1. Administratorul schimba proprietarul din fisa */
      await intraCa(page, "admin");
      await mergiLaTab(page, "Apartamente");
      await page.getByRole("button", { name: `Apartament ${ap.numar}`, exact: true }).click();
      await buton(page, "Corecteaza datele apartamentului").click();
      await page.getByLabel("Proprietar").fill("Vasile Cumparatorul");
      await buton(page, "Salveaza corectia").click();
      await asteaptaToast(page, "Fisa apartamentului a fost actualizata");

      /* 2. Soldul nu se muta nicaieri: ramane pe apartament, sub numele nou */
      const fisa = page.getByRole("dialog", { name: `Apartament ${ap.numar}` });
      await expect(fisa.getByText("Vasile Cumparatorul")).toBeVisible();
      expect(await soldApartament(ap.id)).toBeCloseTo(datorie, 2);

      /* 3. Cumparatorul primeste cont si vede datoria ca fiind a lui */
      const pid = await creeazaCont(TELEFON, "Vasile Cumparatorul");
      await legaDeApartament(pid, ap.id, "proprietar");
      await buton(page, "Inchide").click();
      await buton(page, "Iesi").click();
      await intra(page, TELEFON);
      await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });
      const t = await textEcran(page);
      /* Datoria vanzatorului este acum de plata cumparatorului: aplicatia nu
         cunoaste adeverinta de achitare la zi ceruta la vanzare. */
      expect(t).toMatch(/Termen depasit|De plata acum/i);
      for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
    } finally {
      await repuneFisa(vechi);
    }
  });

  /* [S4, reparat de auditul 4] PDF-ul chitantei se genereaza de fiecare data,
     dar din ce s-a inghetat la emitere: randurile platii (B6) si apartamentul
     cu proprietarul lui de atunci (financiar.chitante.emis_pentru). Dupa o
     vanzare, chitantele vechi ale apartamentului nu se mai retiparesc pe
     numele noului proprietar. */
  test("[S4] chitanta ramane cu proprietarul de la emitere, nu cu cel de azi", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const vechi = { ...ap };

    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: "Platile mele" }).click();
    const inainte = textPdf((await descarca(page, () => buton(page, "Descarca chitanta").first().click())).octeti);
    expect(inainte).toContain(`Proprietar la data emiterii: ${vechi.proprietar_nume}`);

    try {
      await serviciu().schema("organizare").rpc("schimba_fisa_apartament", {
        p_apartament_id: ap.id, p_proprietar_nume: "Vasile Cumparatorul",
        p_cota_indiviza: ap.cota_indiviza, p_suprafata_mp: ap.suprafata_mp,
        p_scutit_lift: ap.scutit_lift, p_etaj: ap.etaj,
      });

      await page.reload();
      await mergiLaTab(page, "Plata");
      await page.getByRole("button", { name: "Platile mele" }).click();
      const dupa = textPdf((await descarca(page, () => buton(page, "Descarca chitanta").first().click())).octeti);
      expect(dupa).toContain(`Proprietar la data emiterii: ${vechi.proprietar_nume}`);
      expect(dupa).not.toContain("Vasile Cumparatorul");
    } finally {
      await repuneFisa(vechi);
    }
  });
});

test.describe("acelasi om cu doua apartamente plateste pentru unul singur", () => {
  const TELEFON = "0798778736";
  let DATORIE_A = null;
  let DATORIE_B = null;

  test.beforeAll(async () => {
    await stergeCont(TELEFON);
    const b = await blocD14();
    const primul = await apartamentulNumarul(15);
    const alDoilea = await apartamentulNumarul(16);
    const pid = await creeazaCont(TELEFON, "Doi Proprietari");
    for (const [ap, din] of [[primul, "2026-06-01"], [alDoilea, "2026-07-01"]]) {
      const { error } = await serviciu().schema("identitate").from("locatari").insert({
        apartament_id: ap.id, bloc_id: b.id, profil_id: pid, calitate: "proprietar", activ_din: din,
      });
      if (error) throw new Error(error.message);
    }
    DATORIE_A = await datorieDeTest(primul.id, 31.11, "E2E datoria apartamentului intai");
    DATORIE_B = await datorieDeTest(alDoilea.id, 42.22, "E2E datoria apartamentului doi");
  });

  test.afterAll(async () => {
    await stergeCont(TELEFON);
    const sb = serviciu();
    for (const id of [DATORIE_A, DATORIE_B]) if (id) await sb.schema("financiar").from("datorii").delete().eq("id", id);
  });

  test("plata se duce pe apartamentul ales, nu pe celalalt", async ({ page, browser }) => {
    const primul = await apartamentulNumarul(15);
    const alDoilea = await apartamentulNumarul(16);
    const soldA = await soldApartament(primul.id);
    const soldB = await soldApartament(alDoilea.id);

    await intra(page, TELEFON);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });

    /* Alege explicit al doilea apartament: instructiunile de plata sunt ale lui */
    await page.getByRole("button", { name: "Schimba apartamentul" }).click();
    await page.getByRole("button", { name: `Apartament ${alDoilea.numar}` }).click();
    await expect(page.getByText(`Apartament ${alDoilea.numar}, Bloc D14, scara A`)).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Plata");
    const suma = Number(soldB).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d),)/g, ".");
    await expect(page.getByText(`Ai de plata ${suma} lei`)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(`Scrie la detalii: apartament ${alDoilea.numar}, Bloc D14, scara A`)).toBeVisible();

    /* Iar banii dusi administratorului se inregistreaza pe apartamentul acela.
       Administratorul lucreaza in fereastra lui, ca locatarul sa ramana unde e. */
    const ctxAdmin = await browser.newContext();
    const adminPage = await ctxAdmin.newPage();
    try {
      await intraCa(adminPage, "admin");
      await mergiLaTab(adminPage, "Apartamente");
      await adminPage.getByRole("button", { name: `Apartament ${alDoilea.numar}`, exact: true }).click();
      await buton(adminPage, "Inregistreaza incasare cash").click();
      await buton(adminPage, "Emite chitanta").click();
      await expect(adminPage.getByText(/Chitanta [A-Z0-9]+ nr\. \d{6}\./)).toBeVisible({ timeout: 30000 });
    } finally {
      await ctxAdmin.close();
    }

    /* Al doilea apartament este achitat, primul a ramas neatins */
    await expect.poll(async () => soldApartament(alDoilea.id), { timeout: 30000 }).toBe(0);
    expect(await soldApartament(primul.id)).toBeCloseTo(soldA, 2);

    /* Iar in aplicatie, dupa schimbare, ecranul arata apartamentul celalalt
       cu soldul lui neschimbat */
    await page.getByRole("button", { name: "Schimba apartamentul" }).click();
    await page.getByRole("button", { name: `Apartament ${primul.numar}` }).click();
    await expect(page.getByText(`Apartament ${primul.numar}, Bloc D14, scara A`).first()).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Plata");
    await expect(page.getByText("31,11").first()).toBeVisible({ timeout: 20000 });
    const t = await textEcran(page);
    expect(t).toContain("31,11");
    expect(t).not.toContain("42,22");
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });
});
