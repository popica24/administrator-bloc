/* Corectarea fisei apartamentului si redistribuirea cotelor intregului bloc
   (harta functiilor §4.2, comenzile schimba_fisa_apartament si
   schimba_cotele_blocului). Amandoua sunt noi si amandoua ating numere din
   care se calculeaza banii, deci fiecare test isi pune datele la loc. */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, serviciu, blocD14, apartamente, apartamentulNumarul,
  asteaptaToast, textEcran, CUVINTE_TEHNICE,
} from "./ajutor.js";

/* Scrie inapoi in baza fisa unui apartament, ocolind ecranul */
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

async function deschideFisa(page, numar) {
  await intraCa(page, "admin");
  await mergiLaTab(page, "Apartamente");
  await page.getByRole("button", { name: `Apartament ${numar}` }).click();
  return page.getByRole("dialog", { name: `Apartament ${numar}` });
}

test.describe("corectarea fisei apartamentului", () => {
  test("proprietarul, etajul, suprafata si scutirea de lift se schimba toate deodata", async ({ page }) => {
    const ap = await apartamentulNumarul(12);
    try {
      const fisa = await deschideFisa(page, 12);
      await buton(page, "Corecteaza datele apartamentului").click();

      const nume = `Familia Corectata ${Date.now()}`;
      await page.getByLabel("Proprietar").fill(nume);
      await page.getByLabel("Etaj").fill("2");
      await page.getByLabel("Suprafata").fill("58,5");
      await page.getByLabel("Scutit de plata liftului").click();
      await buton(page, "Salveaza corectia").click();
      await asteaptaToast(page, "Fisa apartamentului a fost actualizata");

      /* Fisa afisata se reincarca din baza, nu din formular */
      await expect(fisa.getByText(nume).first()).toBeVisible();
      await expect(fisa.getByText("58,5 mp")).toBeVisible();
      await expect(fisa.getByText("Scutit")).toBeVisible();

      const dupa = await apartamentulNumarul(12);
      expect(dupa.proprietar_nume).toBe(nume);
      expect(dupa.etaj).toBe(2);
      expect(Number(dupa.suprafata_mp)).toBe(58.5);
      expect(dupa.scutit_lift).toBe(true);
      expect(Number(dupa.cota_indiviza)).toBe(Number(ap.cota_indiviza));
    } finally {
      await repuneFisa(ap);
    }
  });

  test("parterul se scrie cu 0 si ramane parter", async ({ page }) => {
    const ap = await apartamentulNumarul(13);
    try {
      const fisa = await deschideFisa(page, 13);
      await buton(page, "Corecteaza datele apartamentului").click();
      await page.getByLabel("Etaj").fill("0");
      await buton(page, "Salveaza corectia").click();
      await asteaptaToast(page, "Fisa apartamentului a fost actualizata");
      await expect(fisa.getByText("Parter")).toBeVisible();
      expect((await apartamentulNumarul(13)).etaj).toBe(0);
    } finally {
      await repuneFisa(ap);
    }
  });

  test("formularul porneste de la datele apartamentului, nu gol", async ({ page }) => {
    const ap = await apartamentulNumarul(14);
    await deschideFisa(page, 14);
    await buton(page, "Corecteaza datele apartamentului").click();
    await expect(page.getByLabel("Proprietar")).toHaveValue(ap.proprietar_nume);
    await expect(page.getByLabel("Etaj")).toHaveValue(String(ap.etaj));
    await expect(page.getByLabel("Cota indiviza")).toHaveValue(Number(ap.cota_indiviza).toFixed(2).replace(".", ","));
  });

  test("proprietarul gol blocheaza salvarea", async ({ page }) => {
    await deschideFisa(page, 14);
    await buton(page, "Corecteaza datele apartamentului").click();
    await page.getByLabel("Proprietar").fill("   ");
    await expect(buton(page, "Salveaza corectia")).toBeDisabled();
    await page.getByLabel("Proprietar").fill("Cineva");
    await expect(buton(page, "Salveaza corectia")).not.toBeDisabled();
  });

  test("Renunta lasa fisa neatinsa", async ({ page }) => {
    const ap = await apartamentulNumarul(14);
    const fisa = await deschideFisa(page, 14);
    await buton(page, "Corecteaza datele apartamentului").click();
    await page.getByLabel("Proprietar").fill("Nu Se Salveaza");
    await buton(page, "Renunta").click();
    await expect(fisa.getByText(ap.proprietar_nume).first()).toBeVisible();
    expect((await apartamentulNumarul(14)).proprietar_nume).toBe(ap.proprietar_nume);
  });

  test("o cota care ar strica suma blocului este refuzata cu un mesaj pe romaneste, pe ecran", async ({ page }) => {
    const ap = await apartamentulNumarul(15);
    try {
      await deschideFisa(page, 15);
      await buton(page, "Corecteaza datele apartamentului").click();
      await page.getByLabel("Cota indiviza").fill("9,00");
      await buton(page, "Salveaza corectia").click();

      /* [F17] Eroarea ramane pe ecran, nu doar in mesajul zburator de 3,4 s */
      const inPanou = page.getByRole("dialog", { name: "Apartament 15" })
        .getByText(/Cotele blocului ar ajunge la/);
      await expect(inPanou).toBeVisible();
      await expect(inPanou).toBeVisible({ timeout: 6000 });
      const text = await textEcran(page);
      for (const cuvant of CUVINTE_TEHNICE) expect(text, `mesajul contine "${cuvant}"`).not.toContain(cuvant);
      expect(Number((await apartamentulNumarul(15)).cota_indiviza)).toBe(Number(ap.cota_indiviza));
    } finally {
      await repuneFisa(ap);
    }
  });

  test.fixme("[F2] refuzul cotei scrie numarul romaneste, nu asa cum il da baza", async ({ page }) => {
    /* [F2] Mesajul refuzului vine direct din `raise exception` si tipareste
       numericul Postgres: "Cotele blocului ar ajunge la 102.9800 din 100".
       Punctul zecimal si cele patru zecimale sunt limbajul bazei, nu al
       administratorului: peste tot in aplicatie acelasi numar se scrie
       "102,98". Vezi supabase/migrations/20260919223750_schimba_fisa_apartament.sql:68. */
    const ap = await apartamentulNumarul(15);
    try {
      await deschideFisa(page, 15);
      await buton(page, "Corecteaza datele apartamentului").click();
      await page.getByLabel("Cota indiviza").fill("9,00");
      await buton(page, "Salveaza corectia").click();
      const mesaj = await page.getByRole("dialog", { name: "Apartament 15" })
        .getByText(/Cotele blocului ar ajunge la/).innerText();
      expect(mesaj).toContain("102,98");
      expect(mesaj).not.toContain("102.9800");
    } finally {
      await repuneFisa(ap);
    }
  });

  test("o corectie mica de cota, care lasa suma la 100, trece", async ({ page }) => {
    const ap = await apartamentulNumarul(16);
    try {
      await deschideFisa(page, 16);
      await buton(page, "Corecteaza datele apartamentului").click();
      /* 0,01 in plus intra in toleranta cu care blocul a fost activat */
      await page.getByLabel("Cota indiviza").fill(Number(Number(ap.cota_indiviza) + 0.01).toFixed(2).replace(".", ","));
      await buton(page, "Salveaza corectia").click();
      await asteaptaToast(page, "Fisa apartamentului a fost actualizata");
      expect(Number((await apartamentulNumarul(16)).cota_indiviza))
        .toBeCloseTo(Number(ap.cota_indiviza) + 0.01, 4);
    } finally {
      await repuneFisa(ap);
    }
  });

  test("scutirea de lift schimbata din fisa se vede in randul liftului al locatarului", async ({ page }) => {
    /* Scutirea intra in motor la urmatoarea publicare; fisa si lista deja
       publicata raman doua lucruri diferite, iar ecranul trebuie sa arate
       starea curenta a fisei. */
    const ap = await apartamentulNumarul(7);
    try {
      const fisa = await deschideFisa(page, 7);
      await expect(fisa.getByText("Plateste")).toBeVisible();
      await buton(page, "Corecteaza datele apartamentului").click();
      await page.getByLabel("Scutit de plata liftului").click();
      await buton(page, "Salveaza corectia").click();
      await asteaptaToast(page, "Fisa apartamentului a fost actualizata");
      await expect(fisa.getByText("Scutit")).toBeVisible();
      expect((await apartamentulNumarul(7)).scutit_lift).toBe(true);
    } finally {
      await repuneFisa(ap);
    }
  });
});

test.describe("redistribuirea cotelor intregului bloc", () => {
  test("editorul porneste de la cotele din baza si arata totalul 100", async ({ page }) => {
    const toate = await apartamente();
    await deschideFisa(page, 4);
    await buton(page, "Corecteaza datele apartamentului").click();
    await buton(page, "Redistribuie cotele intregului bloc").click();

    await expect(page.getByText("Redistribuie cotele blocului")).toBeVisible();
    for (const a of toate) {
      await expect(page.getByLabel(`Ap. ${a.numar}, ${a.proprietar_nume}`))
        .toHaveValue(Number(a.cota_indiviza).toFixed(2).replace(".", ","));
    }
    await expect(page.getByText("100,00% din 100%")).toBeVisible();
    await expect(buton(page, "Salveaza cotele blocului")).not.toBeDisabled();
  });

  test("totalul se recalculeaza la fiecare tasta si blocheaza salvarea sub 100", async ({ page }) => {
    const toate = await apartamente();
    const unu = toate.find((a) => a.numar === "1");
    await deschideFisa(page, 4);
    await buton(page, "Corecteaza datele apartamentului").click();
    await buton(page, "Redistribuie cotele intregului bloc").click();

    await page.getByLabel(`Ap. ${unu.numar}, ${unu.proprietar_nume}`).fill("5,01");
    await expect(page.getByText("101,00% din 100%")).toBeVisible();
    await expect(buton(page, "Salveaza cotele blocului")).toBeDisabled();

    await page.getByLabel(`Ap. ${unu.numar}, ${unu.proprietar_nume}`).fill("3,01");
    await expect(page.getByText("99,00% din 100%")).toBeVisible();
    await expect(buton(page, "Salveaza cotele blocului")).toBeDisabled();
  });

  test("o cota goala sau zero blocheaza salvarea, chiar daca restul insumeaza 100", async ({ page }) => {
    const toate = await apartamente();
    const unu = toate.find((a) => a.numar === "1");
    const doi = toate.find((a) => a.numar === "2");
    await deschideFisa(page, 4);
    await buton(page, "Corecteaza datele apartamentului").click();
    await buton(page, "Redistribuie cotele intregului bloc").click();

    /* Toata cota apartamentului 1 se muta pe 2: suma ramane 100, dar un
       apartament fara cota nu mai plateste nimic din cheltuielile pe cota. */
    const sumaDoua = Number(unu.cota_indiviza) + Number(doi.cota_indiviza);
    await page.getByLabel(`Ap. ${unu.numar}, ${unu.proprietar_nume}`).fill("0");
    await page.getByLabel(`Ap. ${doi.numar}, ${doi.proprietar_nume}`).fill(sumaDoua.toFixed(2).replace(".", ","));
    await expect(page.getByText("100,00% din 100%")).toBeVisible();
    await expect(buton(page, "Salveaza cotele blocului")).toBeDisabled();
  });

  test("redistribuirea muta procente intre doua apartamente si se vede in lista", async ({ page }) => {
    const toate = await apartamente();
    const unu = toate.find((a) => a.numar === "1");
    const doi = toate.find((a) => a.numar === "2");
    try {
      await deschideFisa(page, 4);
      await buton(page, "Corecteaza datele apartamentului").click();
      await buton(page, "Redistribuie cotele intregului bloc").click();

      const nouUnu = (Number(unu.cota_indiviza) - 0.5).toFixed(2).replace(".", ",");
      const nouDoi = (Number(doi.cota_indiviza) + 0.5).toFixed(2).replace(".", ",");
      await page.getByLabel(`Ap. ${unu.numar}, ${unu.proprietar_nume}`).fill(nouUnu);
      await page.getByLabel(`Ap. ${doi.numar}, ${doi.proprietar_nume}`).fill(nouDoi);
      await expect(page.getByText("100,00% din 100%")).toBeVisible();
      await buton(page, "Salveaza cotele blocului").click();
      await asteaptaToast(page, "Cotele blocului au fost actualizate");

      const dupa = await apartamente();
      expect(Number(dupa.find((a) => a.numar === "1").cota_indiviza)).toBeCloseTo(Number(unu.cota_indiviza) - 0.5, 4);
      expect(Number(dupa.find((a) => a.numar === "2").cota_indiviza)).toBeCloseTo(Number(doi.cota_indiviza) + 0.5, 4);
      const total = dupa.reduce((s, a) => s + Number(a.cota_indiviza), 0);
      expect(Math.round(total * 100) / 100).toBe(100);

      /* Lista de apartamente arata cota noua, fara reincarcarea paginii */
      await page.getByRole("dialog", { name: "Apartament 4" }).getByRole("button", { name: "Inchide" }).click();
      await expect(page.getByRole("button", { name: `Apartament ${doi.numar}`, exact: true })).toContainText(`cota ${nouDoi}%`);
    } finally {
      await repuneCotele(toate);
    }
  });

  test("editorul acopera toate apartamentele blocului, in ordinea de pe usa", async ({ page }) => {
    const toate = await apartamente();
    await deschideFisa(page, 4);
    await buton(page, "Corecteaza datele apartamentului").click();
    await buton(page, "Redistribuie cotele intregului bloc").click();
    /* cate un camp pentru fiecare apartament, in ordinea de pe usa */
    const campuri = page.locator("input[aria-label^='Ap. ']");
    await expect(campuri).toHaveCount(toate.length);
    const etichete = await campuri.evaluateAll((n) => n.map((x) => x.getAttribute("aria-label")));
    expect(etichete).toEqual(toate.map((a) => `Ap. ${a.numar}, ${a.proprietar_nume}`));
  });

  test("Renunta din editorul de cote nu schimba nimic", async ({ page }) => {
    const toate = await apartamente();
    const unu = toate.find((a) => a.numar === "1");
    await deschideFisa(page, 4);
    await buton(page, "Corecteaza datele apartamentului").click();
    await buton(page, "Redistribuie cotele intregului bloc").click();
    await page.getByLabel(`Ap. ${unu.numar}, ${unu.proprietar_nume}`).fill("9,99");
    await buton(page, "Renunta").click();
    const dupa = await apartamente();
    expect(Number(dupa.find((a) => a.numar === "1").cota_indiviza)).toBe(Number(unu.cota_indiviza));
  });
});

test.describe("cuvintele ecranelor noi", () => {
  test("formularul de corectie si editorul de cote sunt pe romaneste, fara jargon tehnic", async ({ page }) => {
    const englezisme = [" the ", " and ", " not found", " failed", "Unauthorized", "[object", "null"];
    await deschideFisa(page, 6);
    await buton(page, "Corecteaza datele apartamentului").click();
    let text = await textEcran(page);
    for (const cuvant of [...CUVINTE_TEHNICE, ...englezisme]) {
      expect(text, `formularul de corectie contine "${cuvant}"`).not.toContain(cuvant);
    }
    expect(text).toContain("O corectie mica se salveaza direct");

    await buton(page, "Redistribuie cotele intregului bloc").click();
    text = await textEcran(page);
    for (const cuvant of [...CUVINTE_TEHNICE, ...englezisme]) {
      expect(text, `editorul de cote contine "${cuvant}"`).not.toContain(cuvant);
    }
    expect(text).toContain("Cotele tuturor apartamentelor trebuie sa insumeze 100%.");
  });
});

test.describe("cine poate corecta fisa", () => {
  test("locatarul nu are niciun buton de corectat fisa sau cotele", async ({ page }) => {
    await intraCa(page, "elena");
    for (const t of ["Acasa", "Plata", "Contoare", "Sesizari", "Bloc"]) {
      await mergiLaTab(page, t);
      const text = await textEcran(page);
      expect(text).not.toContain("Corecteaza datele apartamentului");
      expect(text).not.toContain("Redistribuie cotele");
    }
  });
});
