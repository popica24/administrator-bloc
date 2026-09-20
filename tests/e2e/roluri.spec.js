/* Roluri care nu se pot produce din interfata: presedinte, cenzor, fost
   locatar. Starea se face cu cheia de serviciu, ca dezvoltatorul din §8. */

import { test, expect } from "@playwright/test";
import {
  buton, intra, intraCa, mergiLaTab, serviciu, blocD14, apartamentulNumarul,
  creeazaCont, stergeCont, legaDeApartament, textEcran, CUVINTE_TEHNICE,
} from "./ajutor.js";

const ASOC = "51098af2-7ff6-4f35-86f4-e52cf87bbe23";

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
