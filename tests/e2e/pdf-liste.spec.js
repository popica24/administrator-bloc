/* Cele doua PDF-uri ale listei de plata (audit 2, X01):
   - "Exporta PDF pentru avizier": se lipeste in casa scarii, deci nu are voie
     sa contina nume de proprietari, restante sau penalizari;
   - "Exporta lista interna (uz administrativ)": le contine pe toate si spune
     limpede ca nu se afiseaza la avizier.
   Amandoua se descarca pe bune si li se citeste continutul. */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, apartamente, descarca, textPdf,
} from "./ajutor.js";

/* Lista pe august este ultima publicata din datele demo */
async function listaAugust(page) {
  await intraCa(page, "admin");
  await mergiLaTab(page, "Facturi");
  await page.getByRole("button", { name: "aug 26" }).click();
  await expect(page.getByText("AUGUST 2026 · PUBLICATA")).toBeVisible();
}

test.describe("PDF-ul pentru avizier", () => {
  test("nu contine niciun nume de proprietar, nici restante, nici penalizari", async ({ page }) => {
    const toate = await apartamente();
    await listaAugust(page);
    const fisier = await descarca(page, () => buton(page, "Exporta PDF pentru avizier").click());
    expect(fisier.nume).toBe("lista-plata-2026-08.pdf");

    const text = textPdf(fisier.octeti);
    expect(text.length).toBeGreaterThan(200);
    for (const ap of toate) {
      const numeScurt = ap.proprietar_nume.split(" ").slice(0, 2).join(" ");
      expect(text, `numele proprietarului ap. ${ap.numar} ajunge pe avizier`).not.toContain(numeScurt);
    }
    for (const coloana of ["Proprietar", "Restante", "Penaliz.", "De plata", "Pers."]) {
      expect(text, `coloana "${coloana}" nu are ce cauta pe avizier`).not.toContain(coloana);
    }
    expect(text).not.toContain("uz intern");
    expect(text).not.toContain("Document intern");
  });

  test("arata tot ce trebuie sa arate: apartamentele, codurile si totalul", async ({ page }) => {
    const toate = await apartamente();
    await listaAugust(page);
    const fisier = await descarca(page, () => buton(page, "Exporta PDF pentru avizier").click());
    const text = textPdf(fisier.octeti);

    expect(text).toContain("Lista de plata pe august 2026");
    expect(text).toContain("Ap.");
    expect(text).toContain("Total luna");
    expect(text).toContain("TOTAL");
    expect(text).toContain("Termen de plata");
    expect(text).toMatch(/C1 Apa rece si canalizare - Apa Canal 2000 Arges/);
    const randuri = text.split("\n");
    for (const ap of toate) {
      expect(randuri, `apartamentul ${ap.numar} lipseste de pe lista`).toContain(ap.numar);
    }
    expect(text).toContain("Fiecare suma se poate verifica in aplicatie");
  });
});

test.describe("exportul intern al administratorului", () => {
  test("contine numele, persoanele si avertismentul ca nu e pentru avizier", async ({ page }) => {
    const toate = await apartamente();
    await listaAugust(page);
    const fisier = await descarca(page, () => buton(page, "Exporta lista interna (uz administrativ)").click());
    expect(fisier.nume).toBe("lista-plata-2026-08-uz-intern.pdf");

    const text = textPdf(fisier.octeti);
    expect(text).toContain("Proprietar");
    expect(text).toContain("Pers.");
    expect(text).toContain("Document intern, uz administrativ");
    expect(text).toContain("Nu se afiseaza la avizier.");
    for (const ap of toate.slice(0, 5)) {
      expect(text, `numele ap. ${ap.numar} lipseste din exportul intern`)
        .toContain(ap.proprietar_nume.split(" ")[0]);
    }
  });

  test("pe lista curenta, exportul intern arata si Restante, Penalizari si De plata", async ({ page }) => {
    await intraCa(page, "admin");
    const fisier = await descarca(page, () => buton(page, "Exporta lista PDF").click());
    const text = textPdf(fisier.octeti);
    expect(text).toContain("Restante");
    expect(text).toContain("Penaliz.");
    expect(text).toContain("De plata");
    expect(text).toContain("Document intern, uz administrativ");
  });

  test("[F4] exportul intern de pe Sumar nu se cheama la fel ca cel de avizier", async ({ page }) => {
    /* [F4] Butonul "Exporta lista PDF" de pe Sumar descarca varianta interna
       (AdminBloc.jsx:2652 foloseste listaPdfIntern), dar sub numele
       `lista-plata-2026-08.pdf` — exact numele fisierului de avizier de la
       Facturi. In folderul Descarcari cele doua ajung "lista-plata-2026-08.pdf"
       si "lista-plata-2026-08 (1).pdf", iar la avizier se lipeste cel care
       vine primul la mana. Reparatia X01 a separat continutul, dar nu si
       numele sub care pleaca din aplicatie. */
    await intraCa(page, "admin");
    const fisier = await descarca(page, () => buton(page, "Exporta lista PDF").click());
    expect(fisier.nume).toContain("uz-intern");
  });

  test("cele doua PDF-uri ale aceleiasi luni nu se contrazic la cifre", async ({ page }) => {
    /* [D13] Lista de pe perete si cea din birou trebuie sa spuna acelasi
       lucru: fiecare suma de pe avizier se regaseste in exportul intern. */
    await listaAugust(page);
    const avizier = await descarca(page, () => buton(page, "Exporta PDF pentru avizier").click());
    const intern = await descarca(page, () => buton(page, "Exporta lista interna (uz administrativ)").click());

    const sume = (t) => (t.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || []);
    const peAvizier = new Set(sume(textPdf(avizier.octeti)));
    const inIntern = new Set(sume(textPdf(intern.octeti)));
    expect(peAvizier.size).toBeGreaterThan(20);
    const lipsa = [...peAvizier].filter((s) => !inIntern.has(s));
    expect(lipsa, "avizierul arata sume care nu exista in exportul intern").toEqual([]);
  });
});

test.describe("cine poate descarca listele", () => {
  test("locatarul nu are niciun buton de export al listei intregului bloc", async ({ page }) => {
    await intraCa(page, "elena");
    for (const t of ["Acasa", "Plata", "Bloc"]) {
      await mergiLaTab(page, t);
      await expect(buton(page, "Exporta PDF pentru avizier")).toHaveCount(0);
      await expect(buton(page, "Exporta lista interna (uz administrativ)")).toHaveCount(0);
      await expect(buton(page, "Exporta lista PDF")).toHaveCount(0);
    }
  });
});
