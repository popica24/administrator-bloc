/* Locatar: Contoare (harta functiilor §3.3) */

import { test, expect } from "@playwright/test";
import {
  buton, intra, intraCa, mergiLaTab, serviciu, blocD14, apartamentulNumarul,
  creeazaCont, legaDeApartament, asteaptaToast, textEcran, CUVINTE_TEHNICE, fisierPoza,
} from "./ajutor.js";

const LUNA = "2026-09-01";

async function stergeCitirile(apartamentId, luna = LUNA) {
  const { error } = await serviciu().schema("contorizare").from("citiri")
    .delete().eq("apartament_id", apartamentId).eq("luna", luna);
  if (error) throw new Error(error.message);
}

async function citiriDin(apartamentId, luna = LUNA) {
  const { data, error } = await serviciu().schema("contorizare").from("citiri")
    .select("*").eq("apartament_id", apartamentId).eq("luna", luna);
  if (error) throw new Error(error.message);
  return data;
}

test.describe("transmiterea indexului", () => {
  test.beforeEach(async () => {
    const ap = await apartamentulNumarul(17);
    await stergeCitirile(ap.id);
  });

  test.afterEach(async () => {
    const ap = await apartamentulNumarul(17);
    await stergeCitirile(ap.id);
  });

  test("formularul cere ambele contoare, o poza, si explica termenul", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Contoare");
    await expect(page.getByText("Citirea pentru septembrie")).toBeVisible();
    await expect(page.getByText("Termen 25 sep 2026")).toBeVisible();
    await expect(page.getByLabel(/^Apa rece, index anterior /)).toBeVisible();
    await expect(page.getByLabel(/^Apa caldă, index anterior /)).toBeVisible();
    await expect(buton(page, "Trimite indexul")).toHaveAttribute("aria-disabled", "true");
    await expect(buton(page, "Fotografiază contoarele")).toBeVisible();
  });

  test("indexul mai mic decat cel anterior este refuzat in formular", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Contoare");
    await page.getByLabel(/^Apa rece, index anterior /).fill("1");
    await expect(page.getByText("Indexul nou nu poate fi mai mic decât cel anterior. Verifică cifrele.")).toBeVisible();
    await expect(buton(page, "Trimite indexul")).toHaveAttribute("aria-disabled", "true");
  });

  test("literele in loc de cifre sunt refuzate", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Contoare");
    await page.getByLabel(/^Apa rece, index anterior /).fill("abc");
    await expect(page.getByText("Scrie doar cifre.")).toBeVisible();
  });

  test("un consum foarte mare da un avertisment, dar lasa trimiterea", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Contoare");
    const camp = page.getByLabel(/^Apa rece, index anterior /);
    const anterior = Number((await camp.getAttribute("placeholder")).replace(",", "."));
    await camp.fill(String(anterior + 100));
    await expect(page.getByText("Consumul pare foarte mare. Verifică încă o dată cifrele.")).toBeVisible();
  });

  test("fara poza butonul ramane blocat si se spune de ce", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Contoare");
    for (const eticheta of [/^Apa rece, index anterior /, /^Apa caldă, index anterior /]) {
      const camp = page.getByLabel(eticheta);
      const anterior = Number((await camp.getAttribute("placeholder")).replace(",", "."));
      await camp.fill(String(anterior + 4));
    }
    await expect(page.getByText("Mai adaugă poza contoarelor, apoi poți trimite.")).toBeVisible();
    await expect(buton(page, "Trimite indexul")).toHaveAttribute("aria-disabled", "true");
  });

  test("indexul cu poza ajunge in baza si ecranul confirma", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    await intraCa(page, "elena");
    await mergiLaTab(page, "Contoare");

    const valori = {};
    for (const [tip, eticheta] of [["rece", /^Apa rece, index anterior /], ["calda", /^Apa caldă, index anterior /]]) {
      const camp = page.getByLabel(eticheta);
      const anterior = Number((await camp.getAttribute("placeholder")).replace(",", "."));
      valori[tip] = anterior + 5;
      await camp.fill(String(valori[tip]));
    }
    await page.setInputFiles('input[type="file"]', fisierPoza());
    await expect(page.locator('img[alt="Poza contoarelor"]')).toBeVisible();
    await buton(page, "Trimite indexul").click();
    await asteaptaToast(page, "Indexul a fost trimis administratorului");

    await expect(page.getByText("Indexul pe septembrie a ajuns la administrator")).toBeVisible();
    const citiri = await citiriDin(ap.id);
    expect(citiri).toHaveLength(2);
    for (const c of citiri) {
      expect(c.stare).toBe("trimisa");
      expect(c.sursa).toBe("locatar");
      expect(c.poza_cale).toMatch(new RegExp(`^${(await blocD14()).id}/${ap.id}/`));
      expect(Number(c.index_curent)).toBeCloseTo(valori[c.tip], 2);
    }
    await expect(buton(page, "Corectează indexul")).toBeVisible();
  });

  test("corectarea inlocuieste citirea trimisa", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    await intraCa(page, "elena");
    await mergiLaTab(page, "Contoare");
    const valori = {};
    for (const [tip, eticheta] of [["rece", /^Apa rece, index anterior /], ["calda", /^Apa caldă, index anterior /]]) {
      const camp = page.getByLabel(eticheta);
      const anterior = Number((await camp.getAttribute("placeholder")).replace(",", "."));
      valori[tip] = anterior + 3;
      await camp.fill(String(valori[tip]));
    }
    await page.setInputFiles('input[type="file"]', fisierPoza());
    await buton(page, "Trimite indexul").click();
    await asteaptaToast(page, "Indexul a fost trimis");

    await buton(page, "Corectează indexul").click();
    for (const [tip, eticheta] of [["rece", /^Apa rece, index anterior /], ["calda", /^Apa caldă, index anterior /]]) {
      valori[tip] += 2;
      const camp = page.getByLabel(eticheta);
      await camp.fill(String(valori[tip]));
      /* Ce a scris omul ramane scris: campul celalalt nu il sterge */
      await expect(camp).toHaveValue(String(valori[tip]));
    }
    await expect(page.getByLabel(/^Apa rece, index anterior /)).toHaveValue(String(valori.rece));
    await page.setInputFiles('input[type="file"]', fisierPoza("contor2.jpg"));
    await buton(page, "Trimite indexul").click();
    await expect(page.getByText("Indexul pe septembrie a ajuns la administrator")).toBeVisible();

    await expect.poll(async () => {
      const c = await citiriDin(ap.id);
      return c.map((x) => `${x.tip}=${Number(x.index_curent)}`).sort().join(" ");
    }, { timeout: 15000 }).toBe(`calda=${valori.calda} rece=${valori.rece}`);
  });

  test("Acasa arata sarcina de transmitere a indexului", async ({ page }) => {
    await intraCa(page, "elena");
    await expect(page.getByText("Transmite indexul la apă")).toBeVisible();
    await page.getByText("Transmite indexul la apă").click();
    await expect(page.getByText("Citirea pentru septembrie")).toBeVisible();
  });
});

test.describe("stari ale citirii", () => {
  const TELEFON = "0798833251";

  test("citirea respinsa arata motivul si lasa retrimiterea", async ({ page }) => {
    const ap = await apartamentulNumarul(6);
    const pid = await creeazaCont(TELEFON, "Vasile Munteanu");
    await legaDeApartament(pid, ap.id);
    const citiri = await citiriDin(ap.id);
    expect(citiri.every((c) => c.stare === "respinsa")).toBe(true);

    await intra(page, TELEFON);
    await expect(page.getByRole("tab", { name: "Contoare" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Trimite din nou indexul")).toBeVisible();
    await mergiLaTab(page, "Contoare");
    await expect(page.getByText("Citirea trimisă a fost respinsă")).toBeVisible();
    await expect(page.locator(".ab-shell")).toContainText(citiri[0].motiv_respingere);
    await expect(page.getByLabel(/^Apa rece, index anterior /)).toBeVisible();
  });

  test("citirea validata apare ca verificata, fara formular", async ({ page }) => {
    await intraCa(page, "voicu");
    await mergiLaTab(page, "Contoare");
    await expect(page.getByText("Indexul pe septembrie a fost verificat de administrator")).toBeVisible();
    await expect(buton(page, "Trimite indexul")).toHaveCount(0);
  });
});

test.describe("istoric si explicatii", () => {
  test("graficul, istoricul pe luni si explicatia diferentei pe coloana", async ({ page }) => {
    await intraCa(page, "voicu");
    await mergiLaTab(page, "Contoare");
    await expect(page.getByText("Cum a evoluat consumul")).toBeVisible();
    await expect(page.getByRole("button", { name: "Apa caldă" })).toBeVisible();
    await page.getByRole("button", { name: "Apa caldă" }).click();
    await expect(page.getByText("Istoric")).toBeVisible();
    const t = await textEcran(page);
    expect(t).toContain("De ce plătește blocul mai multă apă decât arată contoarele");
    expect(t).toMatch(/contorul general de la subsol a înregistrat [\d,.]+ mc/);
    expect(t).toContain("Diferența de");
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("istoricul arata starea fiecarei luni", async ({ page }) => {
    await intraCa(page, "voicu");
    await mergiLaTab(page, "Contoare");
    await expect(page.getByText("septembrie 2026")).toBeVisible();
    await expect(page.getByText("Index de pornire").first()).toBeVisible();
    await expect(page.getByText("Validat").first()).toBeVisible();
  });
});
