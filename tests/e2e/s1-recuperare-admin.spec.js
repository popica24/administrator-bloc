/* Caile de iesire ale administratorului.

   Restul suitei verifica faptul ca aplicatia REFUZA ce trebuie refuzat. Aici
   intrebarea e urmatoarea: dupa refuz, ce face omul? Fiecare test porneste de
   la un refuz real, pe ecran, si merge mai departe pana la o rezolvare
   adevarata, in aceeasi sesiune. Unde nu exista nicio cale, testul o cere si e
   marcat `fixme` cu un identificator [S…], ca defect al aplicatiei.

   Fiecare test isi pune datele la loc: fisa, cotele, miscarile de fond si
   conturile temporare. */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, serviciu, blocD14, apartamente, apartamentulNumarul,
  asteaptaToast, textEcran, CUVINTE_TEHNICE, fisierPoza,
} from "./ajutor.js";

const MARCAJ = "E2E ieșire";
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const numRo = (n, d = 2) => Number(n).toFixed(d).replace(".", ",");

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

async function repuneCotele(toate) {
  const b = await blocD14();
  const { error } = await serviciu().schema("organizare").rpc("schimba_cotele_blocului", {
    p_bloc_id: b.id,
    p_cote: toate.map((a) => ({ apartament_id: a.id, cota: a.cota_indiviza })),
  });
  if (error) throw new Error(`repuneCotele: ${error.message}`);
}

async function curataIesirile() {
  const sb = serviciu();
  const { data } = await sb.schema("financiar").from("miscari_fond")
    .select("id, document_id").like("descriere", `${MARCAJ}%`);
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

async function deschideFisa(page, numar) {
  await intraCa(page, "admin");
  await mergiLaTab(page, "Apartamente");
  await page.getByRole("button", { name: `Apartament ${numar}` }).click();
  return page.getByRole("dialog", { name: `Apartament ${numar}` });
}

test.describe("refuzul cotei are o iesire: editorul intregului bloc", () => {
  test("cota refuzata pe fisa se salveaza pana la capat din editorul de cote", async ({ page }) => {
    const toate = await apartamente();
    const ap = await apartamentulNumarul(18);
    const vecin = await apartamentulNumarul(19);
    const nouaCota = round2(Number(ap.cota_indiviza) + 0.6);
    const cotaVecin = round2(Number(vecin.cota_indiviza) - 0.6);
    expect(cotaVecin).toBeGreaterThan(0);

    try {
      const fisa = await deschideFisa(page, 18);
      await buton(page, "Corectează datele apartamentului").click();
      await page.getByLabel("Cotă indiviză").fill(numRo(nouaCota));
      await buton(page, "Salvează corecția").click();

      /* 1. Refuzul, pe ecran, cu suma la care ar ajunge blocul */
      const refuz = fisa.getByText(/Cotele blocului ar ajunge la/);
      await expect(refuz).toBeVisible();

      /* 2. Ecranul ofera, chiar acolo, singura cale corecta mai departe */
      await expect(buton(page, "Redistribuie cotele întregului bloc")).toBeVisible();
      await buton(page, "Redistribuie cotele întregului bloc").click();

      /* 3. In editor se muta procentele intre doua apartamente si totalul
            se intoarce la 100 sub ochii administratorului */
      await fisa.getByLabel(`Ap. ${ap.numar}, ${ap.proprietar_nume}`).fill(numRo(nouaCota));
      await expect(fisa.getByText(/% din 100%/)).not.toContainText("100,00% din 100%");
      await expect(buton(page, "Salvează cotele blocului")).toBeDisabled();
      await fisa.getByLabel(`Ap. ${vecin.numar}, ${vecin.proprietar_nume}`).fill(numRo(cotaVecin));
      await expect(fisa.getByText("100,00% din 100%")).toBeVisible();

      await buton(page, "Salvează cotele blocului").click();
      await asteaptaToast(page, "Cotele blocului au fost actualizate");

      /* 4. Rezolvare adevarata: in baza, cota ceruta initial este acolo */
      expect(Number((await apartamentulNumarul(18)).cota_indiviza)).toBeCloseTo(nouaCota, 4);
      expect(Number((await apartamentulNumarul(19)).cota_indiviza)).toBeCloseTo(cotaVecin, 4);
      const dupa = await apartamente();
      expect(round2(dupa.reduce((s, a) => s + Number(a.cota_indiviza), 0))).toBe(100);

      const t = await textEcran(page);
      for (const cuvant of CUVINTE_TEHNICE) expect(t, `mesajul conține "${cuvant}"`).not.toContain(cuvant);
    } finally {
      await repuneCotele(toate);
      await repuneFisa(ap);
    }
  });
});

test.describe("refuzul fondului are o iesire: o suma care incape", () => {
  test.afterEach(curataIesirile);

  test("iesirea prea mare e refuzata, iar suma corecta trece in aceeasi sesiune", async ({ page }) => {
    const b = await blocD14();
    const { data: fond } = await serviciu().schema("financiar").from("fonduri_solduri")
      .select("id, sold").eq("bloc_id", b.id).eq("tip", "reparatii").single();
    const soldul = round2(Number(fond.sold));

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Fonduri", exact: true }).click();
    await buton(page, "Înregistrează o ieșire").first().click();

    /* 1. Refuz: mai mult decat are fondul */
    await page.getByLabel("Suma ieșită").fill(numRo(soldul + 1000));
    await page.getByLabel("Pentru ce").fill(`${MARCAJ} prea mare`);
    await page.setInputFiles("input[type=file]", fisierPoza("deviz.jpg"));
    await buton(page, "Înregistrează ieșirea").click();
    const panou = page.getByRole("dialog", { name: "Ieșire din fond" });
    await expect(panou.getByText(/l-ar duce pe minus/)).toBeVisible();

    /* 2. Calea de iesire: ecranul arata soldul, deci administratorul stie
          cat poate scoate. Panoul nu a pierdut nimic din ce s-a scris. */
    await expect(panou.getByLabel("Pentru ce")).toHaveValue(`${MARCAJ} prea mare`);

    /* 3. Rezolvare: suma care incape se inregistreaza imediat, fara alt drum */
    await page.getByLabel("Suma ieșită").fill("120");
    await page.getByLabel("Pentru ce").fill(`${MARCAJ} reparație ușa`);
    await buton(page, "Înregistrează ieșirea").click();
    await asteaptaToast(page, "Ieșirea din fond a fost înregistrată");

    const { data: dupa } = await serviciu().schema("financiar").from("fonduri_solduri")
      .select("sold").eq("id", fond.id).single();
    expect(round2(Number(dupa.sold))).toBe(round2(soldul - 120));

    const t = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });
});
