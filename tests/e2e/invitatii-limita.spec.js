/* Limita de incercari la codul de invitatie (harta functiilor §2.2):
   5 coduri gresite pe cont si 20 pe adresa clientului, in acelasi sfert de ora.

   ATENTIE: incercarile se numara in baza comuna a stack-ului local, iar limita
   pe adresa ii priveste pe toti cei care lucreaza de la aceeasi adresa. Fiecare
   test de aici sterge ce a scris, in `finally` si in `afterEach`, altfel
   blocheaza restul suitei un sfert de ora. */

import { test, expect } from "@playwright/test";
import {
  buton, intra, serviciu, apartamentulNumarul, creeazaCont, stergeCont,
  profilDupaEmail, asteaptaToast, textEcran, CUVINTE_TEHNICE,
  curataIncercariInvitatii, curataConturiTemporare,
} from "./ajutor.js";

const MESAJ_CONT = "Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.";
const MESAJ_ADRESA = "S-au incercat prea multe coduri gresite de la aceasta conexiune. Mai asteapta un sfert de ora si incearca din nou.";
const MESAJ_COD = "Codul nu este valabil. Cere administratorului un cod nou.";

test.beforeAll(async () => {
  await curataConturiTemporare(["e2e-lim-"]);
  await curataIncercariInvitatii();
});
test.afterEach(async () => { await curataIncercariInvitatii(); });
test.afterAll(async () => {
  await curataConturiTemporare(["e2e-lim-"]);
  await curataIncercariInvitatii();
});

async function contNou(sufix) {
  const email = `e2e-lim-${sufix}-${Date.now()}@adminbloc.test`;
  await creeazaCont(email, `Limita ${sufix}`);
  return email;
}

async function codBun(numarApartament = 20, calitate = "chirias") {
  const ap = await apartamentulNumarul(numarApartament);
  const cod = `LM${String(Date.now()).slice(-6)}`.replace(/[01IO]/g, "7").toUpperCase();
  const { error } = await serviciu().schema("identitate").from("invitatii").insert({
    apartament_id: ap.id, cod, calitate,
    expira_la: new Date(Date.now() + 86400000).toISOString(),
  });
  if (error) throw new Error(`codBun: ${error.message}`);
  return { ap, cod };
}

/* O incercare gresita, de pe ecranul contului fara apartament */
async function incearca(page, cod) {
  await page.getByLabel("Codul primit").fill(cod);
  await buton(page, "Foloseste codul").click();
}

test.describe("limita pe cont", () => {
  test("patru coduri gresite nu opresc codul bun, iar reusita sterge numaratoarea", async ({ page }) => {
    const email = await contNou("bun");
    const { ap, cod } = await codBun(20);
    try {
      await intra(page, email);
      await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
      for (let i = 0; i < 4; i += 1) {
        await incearca(page, `ZZZZ88${i}${i}`);
        await asteaptaToast(page, MESAJ_COD);
        await page.waitForTimeout(120);
      }
      const profil = await profilDupaEmail(email);
      const { count: inainte } = await serviciu().schema("identitate").from("incercari_invitatii")
        .select("id", { count: "exact", head: true }).eq("profil_id", profil.id);
      expect(inainte).toBe(4);

      await incearca(page, cod);
      await asteaptaToast(page, `Contul a fost legat de apartamentul ${ap.numar}`);

      const { count: dupa } = await serviciu().schema("identitate").from("incercari_invitatii")
        .select("id", { count: "exact", head: true }).eq("profil_id", profil.id);
      expect(dupa, "reusita sterge incercarile contului").toBe(0);
    } finally {
      await serviciu().schema("identitate").from("invitatii").delete().eq("cod", cod);
      await stergeCont(email);
      await curataIncercariInvitatii();
    }
  });

  test("a sasea incercare gresita se opreste cu un mesaj pe romaneste, fara jargon", async ({ page }) => {
    const email = await contNou("cinci");
    try {
      await intra(page, email);
      await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
      for (let i = 0; i < 5; i += 1) {
        await incearca(page, `ZZZZ77${i}${i}`);
        await asteaptaToast(page, MESAJ_COD);
        await page.waitForTimeout(120);
      }
      await incearca(page, "ZZZZ7799");
      await asteaptaToast(page, MESAJ_CONT);

      const text = await textEcran(page);
      for (const cuvant of CUVINTE_TEHNICE) expect(text, `ecranul contine "${cuvant}"`).not.toContain(cuvant);
      /* Mesajul spune si cat are omul de asteptat */
      const toast = await page.locator(".ab-toast").innerText();
      expect(toast).toContain("un sfert de ora");
      expect(toast).not.toMatch(/[a-z]{2,}_[a-z]{2,}/);
    } finally {
      await stergeCont(email);
      await curataIncercariInvitatii();
    }
  });

  test("limita este a contului: un cont blocat nu blocheaza un vecin de pe aceeasi adresa", async ({ page }) => {
    /* Reparatia G1: plafonul al doilea s-a mutat de pe "toata lumea" pe adresa,
       dar cinci incercari gresite ale unui cont nu trebuie sa-l opreasca pe
       urmatorul om care are un cod bun. */
    const blocat = await contNou("blocat");
    const cinstit = await contNou("cinstit");
    const { ap, cod } = await codBun(20);
    try {
      await intra(page, blocat);
      await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
      for (let i = 0; i < 5; i += 1) {
        await incearca(page, `ZZZZ66${i}${i}`);
        await asteaptaToast(page, MESAJ_COD);
        await page.waitForTimeout(120);
      }
      await incearca(page, "ZZZZ6699");
      await asteaptaToast(page, MESAJ_CONT);
      await buton(page, "Iesi din cont").click();

      await intra(page, cinstit);
      await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
      await incearca(page, cod);
      await asteaptaToast(page, `Contul a fost legat de apartamentul ${ap.numar}`);
      await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });
    } finally {
      await serviciu().schema("identitate").from("invitatii").delete().eq("cod", cod);
      await stergeCont(blocat);
      await stergeCont(cinstit);
      await curataIncercariInvitatii();
    }
  });
});

test.describe("limita pe adresa clientului", () => {
  test("incercarile gresite se retin cu adresa de la care au venit", async ({ page }) => {
    const email = await contNou("adresa");
    try {
      await intra(page, email);
      await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
      await incearca(page, "ZZZZ5511");
      await asteaptaToast(page, MESAJ_COD);

      const profil = await profilDupaEmail(email);
      const { data } = await serviciu().schema("identitate").from("incercari_invitatii")
        .select("ip").eq("profil_id", profil.id);
      expect(data).toHaveLength(1);
      expect(data[0].ip, "incercarea trebuie sa retina adresa clientului, altfel plafonul pe adresa nu exista").not.toBeNull();
    } finally {
      await stergeCont(email);
      await curataIncercariInvitatii();
    }
  });

  test("dupa 20 de coduri gresite de la aceeasi adresa, si un cod bun este oprit", async ({ page }) => {
    /* Cele 20 de incercari se scriu direct in baza, cu adresa pe care o vede
       serverul: prin ecran ar insemna cinci conturi si un minut de asteptari,
       iar testul verifica plafonul, nu drumul pana la el. */
    const email = await contNou("plafon");
    const { cod } = await codBun(20);
    try {
      await intra(page, email);
      await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
      await incearca(page, "ZZZZ4411");
      await asteaptaToast(page, MESAJ_COD);

      const profil = await profilDupaEmail(email);
      const { data: primele } = await serviciu().schema("identitate").from("incercari_invitatii")
        .select("ip").eq("profil_id", profil.id);
      const ip = primele[0].ip;
      test.skip(!ip, "PostgREST nu vede adresa clientului in acest stack");

      const umplutura = Array.from({ length: 20 }, () => ({ profil_id: profil.id, ip }));
      await serviciu().schema("identitate").from("incercari_invitatii").insert(umplutura);

      await incearca(page, cod);
      await asteaptaToast(page, MESAJ_ADRESA);
      /* Codul bun nu s-a consumat: omul il poate folosi dupa sfertul de ora */
      const { data: inv } = await serviciu().schema("identitate").from("invitatii")
        .select("folosita_la").eq("cod", cod).single();
      expect(inv.folosita_la).toBeNull();

      const text = await textEcran(page);
      for (const cuvant of CUVINTE_TEHNICE) expect(text, `ecranul contine "${cuvant}"`).not.toContain(cuvant);
    } finally {
      await serviciu().schema("identitate").from("invitatii").delete().eq("cod", cod);
      await stergeCont(email);
      await curataIncercariInvitatii();
    }
  });

  test("dupa curatarea incercarilor, drumul cinstit merge din nou", async ({ page }) => {
    const email = await contNou("dupa");
    const { ap, cod } = await codBun(20);
    try {
      await curataIncercariInvitatii();
      await intra(page, email);
      await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
      await incearca(page, cod);
      await asteaptaToast(page, `Contul a fost legat de apartamentul ${ap.numar}`);
    } finally {
      await serviciu().schema("identitate").from("invitatii").delete().eq("cod", cod);
      await stergeCont(email);
      await curataIncercariInvitatii();
    }
  });
});
