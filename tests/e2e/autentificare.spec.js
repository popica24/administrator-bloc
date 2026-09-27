/* Autentificare si acces (harta functiilor §2): omul intra cu numarul lui de
   telefon si cu parola primita de la administrator, iar contul il face tot
   administratorul, din fisa apartamentului. */

import { test, expect } from "@playwright/test";
import {
  CONTURI, PAROLA, buton, intra, intraCa, mergiLaTab, apartamentulNumarul,
  creeazaCont, stergeCont, legaDeApartament, asteaptaToast, textEcran, CUVINTE_TEHNICE,
  curataConturiTemporare, telefonTemporar,
} from "./ajutor.js";

test.beforeAll(async () => { await curataConturiTemporare(); });

test.describe("intrare in cont", () => {
  test("administratorul aprobat intra si vede panoul", async ({ page }) => {
    await intraCa(page, "admin");
    await expect(page.getByText("Panou administrator")).toBeVisible();
    await expect(page.getByText("Mihai Dobre")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sumar" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Apartamente" })).toBeVisible();
  });

  test("locatarul intra si vede ecranul Acasa", async ({ page }) => {
    await intraCa(page, "elena");
    await expect(page.getByText("Bună, Elena")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Acasă" })).toBeVisible();
    await expect(page.getByText("Bloc D14, scara A, ap. 17")).toBeVisible();
  });

  test("numarul scris cu spatii sau cu prefixul tarii este acelasi om", async ({ page }) => {
    await intra(page, "+40733410217");
    await expect(page.getByText("Bună, Elena")).toBeVisible({ timeout: 20000 });
  });

  test("parola gresita nu intra si spune de ce, pe romaneste", async ({ page }) => {
    await intra(page, CONTURI.elena, "parola-gresita-1234");
    await asteaptaToast(page, "Numarul de telefon sau parola nu sunt corecte");
    await expect(page.getByText("Intră în cont")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ieși", exact: true })).toHaveCount(0);
  });

  test("butonul Intra este blocat pana la un numar intreg si o parola", async ({ page }) => {
    await page.goto("/");
    await expect(buton(page, "Intră")).toHaveAttribute("aria-disabled", "true");
    await page.getByLabel("Numărul tău de telefon").fill("0733");
    await page.getByLabel("Parola").fill(PAROLA);
    await expect(buton(page, "Intră")).toHaveAttribute("aria-disabled", "true");
    await page.getByLabel("Numărul tău de telefon").fill(CONTURI.elena);
    await expect(buton(page, "Intră")).not.toHaveAttribute("aria-disabled", "true");
  });

  test("ecranul spune de unde se ia contul, ca omul sa nu il caute singur", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Cere-l administratorului blocului/)).toBeVisible();
    const t = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("iesirea din cont duce inapoi la ecranul de intrare", async ({ page }) => {
    await intraCa(page, "elena");
    await buton(page, "Ieși").click();
    await expect(page.getByText("Intră în cont")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Intră în cont")).toBeVisible();
  });
});

test.describe("conturi fara apartament", () => {
  test("contul nelegat de un apartament asteapta administratorul", async ({ page }) => {
    await intra(page, CONTURI.adminNou);
    await expect(page.getByText("Contul nu este legat de un apartament")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("tab")).toHaveCount(0);
    const t = await textEcran(page);
    expect(t).toContain("Administratorul blocului leagă contul de apartamentul tău");
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
    await buton(page, "Ieși din cont").click();
    await expect(page.getByText("Intră în cont")).toBeVisible();
  });
});

test.describe("contul il face administratorul", () => {
  const TELEFON = telefonTemporar();

  test.afterAll(async () => { await stergeCont(TELEFON); });

  test("din fisa apartamentului: numele, numarul, apoi parola aratata o data", async ({ page }) => {
    const ap = await apartamentulNumarul(12);
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 12", exact: true }).click();
    await buton(page, "Adaugă un locatar în aplicație").click();
    await page.getByLabel("Numele locatarului").fill("Petre Ionescu");
    await page.getByLabel("Numărul lui de telefon").fill(TELEFON);
    await buton(page, "Fă contul").click();

    const fisa = page.getByRole("dialog", { name: "Apartament 12" });
    await expect(fisa.getByText(/^Intră cu numărul/)).toBeVisible({ timeout: 20000 });
    const parola = (await fisa.locator("text=/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\\d{4}$/").first().innerText()).trim();
    await buton(page, "Gata").click();
    await expect(fisa.getByText("Petre Ionescu")).toBeVisible();
    /* parola nu se mai vede dupa ce panoul s-a inchis */
    await expect(page.getByText(parola)).toHaveCount(0);

    /* Omul intra imediat cu numarul si parola primite */
    await fisa.getByRole("button", { name: "Închide" }).first().click();
    await buton(page, "Ieși").click();
    await intra(page, TELEFON, parola);
    await expect(page.getByText("Bună, Petre")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(`Bloc D14, scara A, ap. ${ap.numar}`)).toBeVisible();
  });

  test("parola noua, pentru cine si-a uitat-o, inlocuieste parola veche", async ({ page }) => {
    const telefon = telefonTemporar();
    const ap = await apartamentulNumarul(14);
    const pid = await creeazaCont(telefon, "Uituca Popescu");
    await legaDeApartament(pid, ap.id);
    try {
      await intraCa(page, "admin");
      await mergiLaTab(page, "Apartamente");
      await page.getByRole("button", { name: "Apartament 14", exact: true }).click();
      const fisa = page.getByRole("dialog", { name: "Apartament 14" });
      await fisa.getByRole("button", { name: "Parola nouă" }).first().click();
      await expect(fisa.getByText(/^Intră cu numărul/)).toBeVisible({ timeout: 20000 });
      const parola = (await fisa.locator("text=/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\\d{4}$/").first().innerText()).trim();
      await buton(page, "Gata").click();
      await fisa.getByRole("button", { name: "Închide" }).first().click();
      await buton(page, "Ieși").click();

      /* parola veche nu mai merge, cea noua da */
      await intra(page, telefon, PAROLA);
      await asteaptaToast(page, "Numarul de telefon sau parola nu sunt corecte");
      await intra(page, telefon, parola);
      await expect(page.getByText("Bună, Uituca")).toBeVisible({ timeout: 20000 });
    } finally {
      await stergeCont(telefon);
    }
  });

  test("un numar gresit nu ajunge la server, iar unul cunoscut leaga contul existent", async ({ page }) => {
    const telefon = telefonTemporar();
    const altul = await apartamentulNumarul(18);
    const pid = await creeazaCont(telefon, "Două Apartamente");
    await legaDeApartament(pid, altul.id);
    try {
      await intraCa(page, "admin");
      await mergiLaTab(page, "Apartamente");
      await page.getByRole("button", { name: "Apartament 16", exact: true }).click();
      await buton(page, "Adaugă un locatar în aplicație").click();
      await page.getByLabel("Numele locatarului").fill("Cineva");
      await page.getByLabel("Numărul lui de telefon").fill("0722 12");
      await expect(buton(page, "Fă contul")).toHaveAttribute("aria-disabled", "true");

      /* numarul are deja cont: se leaga de apartamentul acesta, fara parola noua */
      await page.getByLabel("Numărul lui de telefon").fill(telefon);
      await buton(page, "Fă contul").click();
      const fisa = page.getByRole("dialog", { name: "Apartament 16" });
      await expect(fisa.getByText(/Omul avea deja cont pe acest număr/)).toBeVisible({ timeout: 20000 });
      await buton(page, "Gata").click();

      /* a doua oara, pe acelasi apartament, spune limpede ca exista deja */
      await buton(page, "Adaugă un locatar în aplicație").click();
      await page.getByLabel("Numele locatarului").fill("Cineva");
      await page.getByLabel("Numărul lui de telefon").fill(telefon);
      await buton(page, "Fă contul").click();
      await expect(fisa.getByText("Contul este deja legat de acest apartament.")).toBeVisible({ timeout: 20000 });
      const t = await textEcran(page);
      for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
    } finally {
      await stergeCont(telefon);
    }
  });
});
