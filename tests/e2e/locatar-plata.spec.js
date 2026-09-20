/* Locatar: Acasa si Plata (harta functiilor §3.1 si §3.2) */

import { test, expect } from "@playwright/test";
import {
  CONTURI, buton, intra, intraCa, mergiLaTab, serviciu, apartamentulNumarul,
  creeazaCont, legaDeApartament, datorieDeTest, soldApartament,
  textEcran, CUVINTE_TEHNICE,
} from "./ajutor.js";

const lei = (n) => Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d),)/g, ".");

test.describe("Acasa", () => {
  test("cardul De plata acum arata exact soldul din registru", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const sold = await soldApartament(ap.id);
    await intraCa(page, "elena");
    await expect(page.getByText("De plata acum")).toBeVisible();
    await expect(page.locator(".ab-shell")).toContainText(lei(sold));
    await expect(buton(page, "Plateste acum")).toBeVisible();
    await expect(buton(page, "De unde vine suma")).toBeVisible();
  });

  test("Acasa arata fraza de comparatie, De facut, avizierul si contactele", async ({ page }) => {
    await intraCa(page, "elena");
    const text = await textEcran(page);
    expect(text).toContain("Intretinerea pe");
    expect(text).toContain("De facut");
    expect(text).toContain("De la avizier");
    expect(text).toContain("Pe cine suni");
    expect(text).toContain("Consumul tau fata de bloc");
    await expect(buton(page, /^Suna /).first()).toBeVisible();
  });

  test("restantierul vede soldul intreg pe Acasa", async ({ page }) => {
    const ap = await apartamentulNumarul(3);
    const sold = await soldApartament(ap.id);
    await intraCa(page, "ilie");
    await expect(page.locator(".ab-shell")).toContainText(lei(sold));
    await expect(page.getByText("De plata acum")).toBeVisible();
  });

  test.fixme("[E2] restantierul nu este anuntat ca mai are zile pana la scadenta", async ({ page }) => {
    /* Ap. 3 are intretinerea pe iunie si iulie scadenta si nepatita, plus
       penalizare. Badge-ul se calculeaza doar din scadenta listei curente, deci
       cel mai vechi datornic al blocului citeste "Mai ai 5 zile". */
    const ap = await apartamentulNumarul(3);
    const scadente = await serviciu().schema("financiar").from("datorii_rest")
      .select("scadenta, rest").eq("apartament_id", ap.id).gt("rest", 0);
    const azi = new Date().toISOString().slice(0, 10);
    expect(scadente.data.some((d) => d.scadenta < azi)).toBe(true);

    await intraCa(page, "ilie");
    await expect(page.getByText("Termen depasit")).toBeVisible();
    await expect(page.getByText(/Mai ai \d+ (de )?zile/)).toHaveCount(0);
  });

  test("mesajul necitit se marcheaza citit si ramane citit", async ({ page }) => {
    const sb = serviciu();
    const { data: profil } = await sb.schema("identitate").from("profiluri")
      .select("id").eq("email", CONTURI.ilie).single();
    const { data: necitite } = await sb.schema("comunicare").from("notificari")
      .select("id, titlu").eq("profil_id", profil.id).is("citita_la", null)
      .order("trimisa_la", { ascending: false }).limit(1);
    test.skip(necitite.length === 0, "contul nu are notificari necitite");

    await intraCa(page, "ilie");
    await expect(page.getByText("Mesaje noi")).toBeVisible();
    await buton(page, "Am citit").first().click();
    await expect.poll(async () => {
      const { data } = await sb.schema("comunicare").from("notificari")
        .select("citita_la").eq("id", necitite[0].id).single();
      return data.citita_la !== null;
    }, { timeout: 20000 }).toBe(true);

    /* Datele demo raman cum erau: notificarea redevine necitita */
    await sb.schema("comunicare").from("notificari")
      .update({ citita_la: null }).eq("id", necitite[0].id);
  });

  test("Plateste acum duce in Plata cu formularul de card deschis", async ({ page }) => {
    await intraCa(page, "elena");
    await buton(page, "Plateste acum").click();
    await expect(page.getByRole("dialog", { name: "Plata cu cardul" })).toBeVisible();
    await expect(page.getByLabel("Numarul cardului")).toBeVisible();
  });
});

test.describe("Plata: lista de plata", () => {
  test("totalul listei curente este soldul apartamentului, in trei trepte", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const sold = await soldApartament(ap.id);
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await expect(page.getByText("Total de plata acum")).toBeVisible();
    const text = await textEcran(page);
    expect(text).toContain("1. Cheltuielile lunii");
    expect(text).toContain("2. Fonduri");
    expect(text).toContain("3. Datorii din lunile trecute");
    expect(text).toContain(lei(sold));
  });

  test("verificarea repartitiei da diferenta zero", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    const card = page.locator(".ab-shell").getByText("Verificarea repartitiei").locator("xpath=ancestor::div[1]");
    await expect(card).toContainText("Diferenta");
    await expect(card).toContainText("0,00");
  });

  test("randul de apa se desface si arata calculul complet, cu documentul", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    const rand = page.getByRole("button", { name: /^Apa rece si canalizare,/ }).first();
    await rand.click();
    await expect(rand).toHaveAttribute("aria-expanded", "true");
    const ecran = await textEcran(page);
    expect(ecran).toContain("Contor general al blocului");
    expect(ecran).toContain("Suma contoarelor din apartamente");
    expect(ecran).toContain("Diferenta pe coloana");
    expect(ecran).toContain("Pret pe metru cub");
    expect(ecran).toContain("Consumul apartamentului");
    /* Eticheta mica este scrisa cu majuscule prin CSS, deci innerText o da asa */
    expect(ecran).toContain("DOCUMENTUL JUSTIFICATIV");
    expect(ecran).toMatch(/Apartamentul suporta \d/);
    await expect(buton(page, "Vezi documentul").first()).toBeVisible();
  });

  test("un rand pe cota arata suma, baza blocului si baza apartamentului", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    const randuri = page.getByRole("button", { name: /, \d[\d.]*,\d\d lei$/ });
    const n = await randuri.count();
    let gasit = false;
    for (let i = 0; i < n; i += 1) {
      await randuri.nth(i).click();
      const t = await textEcran(page);
      if (t.includes("Baza de calcul, tot blocul")) {
        expect(t).toContain("Baza apartamentului");
        expect(t).toContain("Suma de repartizat");
        gasit = true;
        break;
      }
      await randuri.nth(i).click();
    }
    expect(gasit).toBe(true);
  });

  test("apartamentul scutit de lift vede randul zero explicat", async ({ page }) => {
    await intraCa(page, "voicu");
    await mergiLaTab(page, "Plata");
    const lift = page.getByRole("button", { name: /^Intretinere ascensor,/ }).first();
    await expect(lift).toBeVisible();
    await lift.click();
    await expect(page.getByText("Apartamentul este scutit de lift, de aceea nu plateste nimic pe acest rand.")).toBeVisible();
  });

  test("restantierul vede penalizarea cu formula ei", async ({ page }) => {
    await intraCa(page, "ilie");
    await mergiLaTab(page, "Plata");
    const t = await textEcran(page);
    expect(t).toContain("Penalizare calculata pe");
    expect(t).toMatch(/% × \d+ zile/);
    expect(t).toContain("nu poate depasi suma datorata");
  });

  test("alegerea lunii schimba lista afisata", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    const luni = page.getByRole("button", { name: /^(iun|iul|aug) 26$/ });
    await expect(luni).toHaveCount(3);
    await luni.filter({ hasText: "iun 26" }).click();
    await expect(page.getByText("Lista pe iunie 2026")).toBeVisible();
    await expect(page.getByText("Achitata")).toBeVisible();
  });
});

test.describe("Plata: platile mele", () => {
  test("istoricul arata fiecare plata cu chitanta ei", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: "Platile mele" }).click();
    await expect(page.getByText("Cat ai avut de plata")).toBeVisible();
    await expect(page.getByText("Platile tale")).toBeVisible();
    const t = await textEcran(page);
    expect(t).toMatch(/Chitanta [A-Z0-9]+ nr\. \d{6}/);
    expect(t).toContain("Intretinere");
  });

  test("chitanta se descarca in PDF", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: "Platile mele" }).click();
    const descarcare = page.waitForEvent("download");
    await buton(page, "Descarca chitanta").first().click();
    const fisier = await descarcare;
    expect(fisier.suggestedFilename()).toMatch(/^chitanta-\d+\.pdf$/);
    const flux = await fisier.createReadStream();
    const bucati = [];
    for await (const b of flux) bucati.push(b);
    const continut = Buffer.concat(bucati);
    expect(continut.subarray(0, 5).toString()).toBe("%PDF-");
    expect(continut.toString("latin1")).toContain("CHITANTA");
  });

  test("locatarul nu vede platile altor apartamente", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const { count } = await serviciu().schema("financiar").from("plati")
      .select("id", { count: "exact", head: true }).eq("apartament_id", ap.id).eq("stare", "confirmata");
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: "Platile mele" }).click();
    await expect(buton(page, "Descarca chitanta")).toHaveCount(count);
  });
});

test.describe("Plata cu cardul", () => {
  const EMAIL = "e2e-platitor@adminbloc.test";

  test.beforeEach(async () => {
    const ap = await apartamentulNumarul(20);
    const pid = await creeazaCont(EMAIL, "Lavinia Costea");
    await legaDeApartament(pid, ap.id);
  });

  test("cardul refuzat de banca nu inregistreaza nicio plata", async ({ page }) => {
    const ap = await apartamentulNumarul(20);
    await datorieDeTest(ap.id, 11.11, "Test card refuzat");
    const { count: inainte } = await serviciu().schema("financiar").from("plati")
      .select("id", { count: "exact", head: true }).eq("apartament_id", ap.id).eq("stare", "confirmata");

    await intra(page, EMAIL);
    await expect(page.getByRole("tab", { name: "Plata" })).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Plata");
    const soldRefuzat = await soldApartament(ap.id);
    await buton(page, `Plateste ${lei(soldRefuzat)} lei cu cardul`).click();
    await page.getByLabel("Numarul cardului").fill("4000000000000002");
    await page.getByLabel("Expira").fill("12/30");
    await page.getByLabel("Cod CVC").fill("123");
    await page.getByLabel("Numele de pe card").fill("LAVINIA COSTEA");
    await buton(page, `Plateste ${lei(soldRefuzat)} lei`).click();

    await expect(page.getByRole("dialog", { name: "Plata cu cardul" }).locator("text=/refuz|respins|banca/i").first())
      .toBeVisible({ timeout: 25000 });
    const { count: dupa } = await serviciu().schema("financiar").from("plati")
      .select("id", { count: "exact", head: true }).eq("apartament_id", ap.id).eq("stare", "confirmata");
    expect(dupa).toBe(inainte);
    const t = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("cardul acceptat plateste, emite chitanta si o lasa de descarcat", async ({ page }) => {
    const ap = await apartamentulNumarul(20);
    await datorieDeTest(ap.id, 12.34, "Test card acceptat");
    const sold = await soldApartament(ap.id);

    await intra(page, EMAIL);
    await expect(page.getByRole("tab", { name: "Plata" })).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Plata");
    await buton(page, `Plateste ${lei(sold)} lei cu cardul`).click();
    await page.getByLabel("Numarul cardului").fill("4242424242424242");
    await page.getByLabel("Expira").fill("12/30");
    await page.getByLabel("Cod CVC").fill("123");
    await page.getByLabel("Numele de pe card").fill("LAVINIA COSTEA");
    await buton(page, `Plateste ${lei(sold)} lei`).click();

    await expect(page.getByText("Plata a reusit")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Chitanta [A-Z0-9]+ nr\. \d{6} a fost emisa/)).toBeVisible();

    const descarcare = page.waitForEvent("download");
    await buton(page, "Descarca chitanta").click();
    expect((await descarcare).suggestedFilename()).toMatch(/^chitanta-\d+\.pdf$/);
    await buton(page, "Gata").click();

    /* Registrul: plata confirmata, chitanta emisa, soldul la zero */
    const { data: plati } = await serviciu().schema("financiar").from("plati")
      .select("id, suma, stare, metoda").eq("apartament_id", ap.id).eq("stare", "confirmata")
      .order("creat_la", { ascending: false }).limit(1);
    expect(plati[0].metoda).toBe("card");
    expect(Number(plati[0].suma)).toBeCloseTo(sold, 2);
    const { data: ch } = await serviciu().schema("financiar").from("chitante")
      .select("numar").eq("plata_id", plati[0].id).single();
    expect(ch.numar).toBeGreaterThan(0);
    expect(await soldApartament(ap.id)).toBe(0);
  });

  test("dublul apasat pe Plateste nu trimite doua plati", async ({ page }) => {
    const ap = await apartamentulNumarul(20);
    await datorieDeTest(ap.id, 9.99, "Test dublu apasat card");
    const sold = await soldApartament(ap.id);

    await intra(page, EMAIL);
    await expect(page.getByRole("tab", { name: "Plata" })).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Plata");
    await buton(page, `Plateste ${lei(sold)} lei cu cardul`).click();
    await page.getByLabel("Numarul cardului").fill("4242424242424242");
    await page.getByLabel("Expira").fill("12/30");
    await page.getByLabel("Cod CVC").fill("123");
    await page.getByLabel("Numele de pe card").fill("LAVINIA COSTEA");
    const { count: inainte } = await serviciu().schema("financiar").from("plati")
      .select("id", { count: "exact", head: true }).eq("apartament_id", ap.id);
    const plateste = buton(page, `Plateste ${lei(sold)} lei`);
    await plateste.dblclick();

    await expect(page.getByText("Plata a reusit")).toBeVisible({ timeout: 30000 });
    const { count: dupa } = await serviciu().schema("financiar").from("plati")
      .select("id", { count: "exact", head: true }).eq("apartament_id", ap.id);
    expect(dupa - inainte).toBe(1);
  });
});
