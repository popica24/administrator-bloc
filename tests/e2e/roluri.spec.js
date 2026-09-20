/* Roluri care nu se pot produce din interfata: presedinte, cenzor, fost
   locatar. Starea se face cu cheia de serviciu, ca dezvoltatorul din §8. */

import { test, expect } from "@playwright/test";
import {
  buton, intra, intraCa, mergiLaTab, serviciu, blocD14, apartamentulNumarul,
  creeazaCont, stergeCont, legaDeApartament, textEcran, CUVINTE_TEHNICE,
  asociatieD14, datorieDeTest,
} from "./ajutor.js";

/* Identificatorii se cauta in baza: un `db reset && npm run seed` le schimba */
let ASOC;
test.beforeAll(async () => { ASOC = await asociatieD14(); });

async function faceMembru(profilId, rol) {
  const { error } = await serviciu().schema("identitate").from("membri_asociatie")
    .upsert({ asociatie_id: ASOC, profil_id: profilId, rol }, { onConflict: "asociatie_id,profil_id,rol" });
  if (error) throw new Error(`faceMembru: ${error.message}`);
}

async function platiConfirmate(apartamentId) {
  const { count } = await serviciu().schema("financiar").from("plati")
    .select("id", { count: "exact", head: true }).eq("apartament_id", apartamentId).eq("stare", "confirmata");
  return count;
}

test.describe("presedinte si cenzor care locuiesc in bloc", () => {
  const PRESEDINTE = "e2e-presedinte@adminbloc.test";
  const CENZOR = "e2e-cenzor@adminbloc.test";

  test.afterAll(async () => {
    await stergeCont(PRESEDINTE);
    await stergeCont(CENZOR);
  });

  test("presedintele vede ecranele de locatar, doar cu apartamentul lui", async ({ page }) => {
    const ap = await apartamentulNumarul(12);
    const pid = await creeazaCont(PRESEDINTE, "Ioana Stancu");
    await legaDeApartament(pid, ap.id);
    await faceMembru(pid, "presedinte");
    const plati = await platiConfirmate(ap.id);

    await intra(page, PRESEDINTE);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });
    /* Rolul ramane de locatar: cinci taburi, nu panoul de administrator */
    await expect(page.getByRole("tab")).toHaveCount(5);
    await expect(page.getByText("Panou administrator")).toHaveCount(0);
    await expect(page.getByText("Apartament 12, Bloc D14, scara A")).toBeVisible();

    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: "Platile mele" }).click();
    /* Desi RLS ii da tot blocul, ecranul arata doar platile apartamentului lui */
    await expect(buton(page, "Descarca chitanta")).toHaveCount(plati);
    const t = await textEcran(page);
    expect(t).not.toContain("Familia Ilie");
    expect(t).not.toContain("Elena Marinescu");
  });

  test("cenzorul vede doar sesizarile apartamentului lui la Ale mele", async ({ page }) => {
    const ap = await apartamentulNumarul(4);
    const pid = await creeazaCont(CENZOR, "Radu Pintea");
    await legaDeApartament(pid, ap.id);
    await faceMembru(pid, "cenzor");
    const { count } = await serviciu().schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("apartament_id", ap.id);
    expect(count).toBe(0);
    const plati = await platiConfirmate(ap.id);

    await intra(page, CENZOR);
    await expect(page.getByRole("tab", { name: /^Sesizari/ })).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Sesizari");
    await expect(page.getByText("Nu ai trimis nicio sesizare")).toBeVisible();
    await page.getByRole("button", { name: "Din tot blocul" }).click();
    const t = await textEcran(page);
    expect(t).not.toMatch(/Ap\. \d/);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);

    /* Cenzorul are drept de citire pe tot blocul, dar ecranul de locatar
       ramane al apartamentului lui (auditul 1, S2) */
    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: "Platile mele" }).click();
    await expect(buton(page, "Descarca chitanta")).toHaveCount(plati);
  });

  test("contactele blocului arata presedintele si cenzorul", async ({ page }) => {
    await intraCa(page, "elena");
    const t = await textEcran(page);
    expect(t).toContain("PRESEDINTE");
    expect(t).toContain("CENZOR");
    expect(t).toContain("ADMINISTRATOR");
    expect(t).toContain("URGENTE LIFT");
  });
});

test.describe("presedinte fara apartament", () => {
  const EMAIL = "e2e-presedinte-fara-ap@adminbloc.test";
  test.afterAll(async () => { await stergeCont(EMAIL); });

  /* Documentat in harta functiilor §9: eu() nu are rol de presedinte, deci un
     presedinte fara apartament ramane fara_apartament. Testul fixeaza
     comportamentul de azi ca sa se vada cand se schimba. */
  test("ramane pe ecranul fara acces si nu vede blocul", async ({ page }) => {
    const pid = await creeazaCont(EMAIL, "Petre Presedinte");
    await faceMembru(pid, "presedinte");

    await intra(page, EMAIL);
    await expect(page.getByText("Leaga contul de apartamentul tau")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("tab")).toHaveCount(0);
    const t = await textEcran(page);
    expect(t).not.toContain("Bloc D14");
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });
});

/* Aplicatia nu modeleaza un om legat de doua apartamente: identitate.eu()
   alege un singur apartament (cea mai veche legatura activa), iar toate
   ecranele de locatar sunt filtrate pe el. Testele fixeaza ce vede azi. */
test.describe("locatar cu doua apartamente", () => {
  const EMAIL = "e2e-doua-apartamente@adminbloc.test";
  let DATORIE;

  test.beforeAll(async () => {
    await stergeCont(EMAIL);
    const b = await blocD14();
    const primul = await apartamentulNumarul(5);
    const alDoilea = await apartamentulNumarul(7);
    const pid = await creeazaCont(EMAIL, "Doua Apartamente");
    const sb = serviciu();
    for (const [ap, din] of [[primul, "2026-06-01"], [alDoilea, "2026-07-01"]]) {
      const { error } = await sb.schema("identitate").from("locatari").insert({
        apartament_id: ap.id, bloc_id: b.id, profil_id: pid, calitate: "proprietar", activ_din: din,
      });
      if (error) throw new Error(error.message);
    }
    DATORIE = await datorieDeTest(alDoilea.id, 77.77, "E2E datoria celui de-al doilea apartament");
  });

  test.afterAll(async () => {
    await stergeCont(EMAIL);
    if (DATORIE) await serviciu().schema("financiar").from("datorii").delete().eq("id", DATORIE);
  });

  test("vede doar primul apartament, fara nicio urma a celui de-al doilea", async ({ page }) => {
    const primul = await apartamentulNumarul(5);
    const alDoilea = await apartamentulNumarul(7);

    await intra(page, EMAIL);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(`Apartament ${primul.numar}, Bloc D14, scara A`)).toBeVisible();

    /* Nicio cale spre al doilea apartament si nicio cifra de la el */
    const t = await textEcran(page);
    expect(t).not.toContain(alDoilea.proprietar_nume);
    expect(t).not.toContain("77,77");
    await mergiLaTab(page, "Plata");
    expect(await textEcran(page)).not.toContain("77,77");
    for (const cuvant of CUVINTE_TEHNICE) expect(await textEcran(page)).not.toContain(cuvant);
  });

  /* [P5] Vezi raportul: omul plateste pentru doua apartamente, dar aplicatia
     ii arata unul singur si nu ii spune nimic despre celalalt. */
  test.fixme("[P5] stie ca mai are un apartament in aplicatie", async ({ page }) => {
    const alDoilea = await apartamentulNumarul(7);
    await intra(page, EMAIL);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(new RegExp(`[Aa]partament(ul)? ${alDoilea.numar}\\b`))).toBeVisible();
  });
});

test.describe("fost locatar", () => {
  const EMAIL = "e2e-fost-locatar@adminbloc.test";
  test.afterAll(async () => { await stergeCont(EMAIL); });

  test("accesul incheiat ieri nu mai vede nimic din bloc", async ({ page }) => {
    const ap = await apartamentulNumarul(8);
    await stergeCont(EMAIL);
    const pid = await creeazaCont(EMAIL, "Fost Locatar");
    const b = await blocD14();
    const { error } = await serviciu().schema("identitate").from("locatari").insert({
      apartament_id: ap.id, bloc_id: b.id, profil_id: pid, calitate: "chirias",
      activ_din: "2026-01-01", activ_pana: "2026-09-19",
    });
    if (error) throw new Error(error.message);

    await intra(page, EMAIL);
    await expect(page.getByText("Leaga contul de apartamentul tau")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("tab")).toHaveCount(0);
    const t = await textEcran(page);
    expect(t).not.toContain("Familia Dumitrescu");
    expect(t).not.toContain("Bloc D14");
  });
});
