/* Autentificare si acces (harta functiilor §2) */

import { test, expect } from "@playwright/test";
import {
  CONTURI, PAROLA, buton, intra, intraCa, serviciu, apartamentulNumarul,
  creeazaCont, stergeCont, profilDupaEmail, asteaptaToast, textEcran, CUVINTE_TEHNICE,
  curataConturiTemporare,
} from "./ajutor.js";

test.beforeAll(async () => { await curataConturiTemporare(); });

const EMAIL_RESPINS = "e2e-respins@adminbloc.test";
const EMAIL_FARA_AP = "e2e-fara-apartament@adminbloc.test";

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
    await expect(page.getByText("Buna, Elena")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Acasa" })).toBeVisible();
    await expect(page.getByText("Bloc D14, scara A, ap. 17")).toBeVisible();
  });

  test("parola gresita nu intra si spune de ce, pe romaneste", async ({ page }) => {
    await intra(page, CONTURI.elena, "parola-gresita-1234");
    await asteaptaToast(page, "Emailul sau parola nu sunt corecte");
    await expect(page.getByText("Intra in cont")).toBeVisible();
    await expect(page.getByRole("button", { name: "Iesi", exact: true })).toHaveCount(0);
  });

  test("butonul Intra este blocat pana la un email valid si o parola", async ({ page }) => {
    await page.goto("/");
    await expect(buton(page, "Intra")).toHaveAttribute("aria-disabled", "true");
    await page.getByLabel("Email").fill("nuesteemail");
    await page.getByLabel("Parola").fill(PAROLA);
    await expect(buton(page, "Intra")).toHaveAttribute("aria-disabled", "true");
    await page.getByLabel("Email").fill(CONTURI.elena);
    await expect(buton(page, "Intra")).not.toHaveAttribute("aria-disabled", "true");
  });

  test("iesirea din cont duce inapoi la ecranul de intrare", async ({ page }) => {
    await intraCa(page, "elena");
    await buton(page, "Iesi").click();
    await expect(page.getByText("Intra in cont")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Intra in cont")).toBeVisible();
  });
});

test.describe("conturi fara acces", () => {
  test("administratorul neverificat vede ecranul de asteptare", async ({ page }) => {
    await intra(page, CONTURI.adminNou);
    await expect(page.getByText("Contul de administrator asteapta verificarea")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(buton(page, "Iesi din cont")).toBeVisible();
  });

  test("administratorul respins vede motivul si nu vede date", async ({ page }) => {
    const pid = await creeazaCont(EMAIL_RESPINS, "Radu Respins");
    await serviciu().schema("identitate").from("administratori")
      .upsert({ profil_id: pid, numar_atestat: "RESP-1", stare: "in_asteptare" });
    const { error } = await serviciu().schema("identitate").rpc("verifica_administrator", {
      p_profil_id: pid, p_aprobat: false, p_motiv: "Atestatul nu este valabil.",
    });
    if (error) throw new Error(error.message);

    await intra(page, EMAIL_RESPINS);
    await expect(page.getByText("Cererea de administrator a fost respinsa")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("tab")).toHaveCount(0);
  });

  test("contul fara apartament primeste campul de cod", async ({ page }) => {
    await creeazaCont(EMAIL_FARA_AP, "Ana Fara Apartament");
    await intra(page, EMAIL_FARA_AP);
    await expect(page.getByText("Leaga contul de apartamentul tau")).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel("Codul primit")).toBeVisible();
    await expect(page.getByText("Esti administrator de bloc?")).toBeVisible();
  });

  test("codul gresit este refuzat cu un mesaj clar", async ({ page }) => {
    /* Cont proaspat: limita de 5 incercari gresite pe sfert de ora este a
       contului, nu a codului. */
    const email = `e2e-cod-gresit-${Date.now()}@adminbloc.test`;
    await creeazaCont(email, "Vasile Gresit");
    await intra(page, email);
    await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
    await page.getByLabel("Codul primit").fill("ZZZZ9999");
    await buton(page, "Foloseste codul").click();
    await asteaptaToast(page, "Codul nu este valabil. Cere administratorului un cod nou.");
    const text = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(text).not.toContain(cuvant);
    await stergeCont(email);
  });

  test("prea multe coduri gresite opresc incercarile", async ({ page }) => {
    const email = `e2e-cod-limita-${Date.now()}@adminbloc.test`;
    await creeazaCont(email, "Mihai Insistent");
    await intra(page, email);
    await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
    for (let i = 0; i < 5; i += 1) {
      await page.getByLabel("Codul primit").fill(`ZZZZ999${i}`);
      await buton(page, "Foloseste codul").click();
      await asteaptaToast(page, "Codul nu este valabil");
      await page.waitForTimeout(150);
    }
    await page.getByLabel("Codul primit").fill("ZZZZ9995");
    await buton(page, "Foloseste codul").click();
    await asteaptaToast(page, "Ai incercat de prea multe ori cu un cod gresit");
    const text = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(text).not.toContain(cuvant);
    await stergeCont(email);
  });

  test("contul fara apartament se leaga cu un cod bun", async ({ page }) => {
    const email = `e2e-cod-${Date.now()}@adminbloc.test`;
    await creeazaCont(email, "Cornel Cod");
    const ap = await apartamentulNumarul(20);
    const cod = `E2E${String(Date.now()).slice(-5)}`.replace(/[01IO]/g, "2").toUpperCase();
    await serviciu().schema("identitate").from("invitatii").insert({
      apartament_id: ap.id, cod, calitate: "chirias",
      expira_la: new Date(Date.now() + 86400000).toISOString(),
    });

    await intra(page, email);
    await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
    await page.getByLabel("Codul primit").fill(cod);
    await buton(page, "Foloseste codul").click();
    await asteaptaToast(page, `Contul a fost legat de apartamentul ${ap.numar}`);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });

    await stergeCont(email);
  });
});

test.describe("cont nou", () => {
  test("locatar nou cu cod de invitatie: contul se creeaza", async ({ page }) => {
    const email = `e2e-inreg-${Date.now()}@adminbloc.test`;
    const ap = await apartamentulNumarul(19);
    const cod = `EE${String(Date.now()).slice(-6)}`.replace(/[01IO]/g, "3").toUpperCase();
    await serviciu().schema("identitate").from("invitatii").insert({
      apartament_id: ap.id, cod, calitate: "membru_familie",
      expira_la: new Date(Date.now() + 86400000).toISOString(),
    });

    await page.goto("/");
    await buton(page, "Am un cod de la administrator").click();
    await page.getByLabel("Codul primit").fill(cod);
    await page.getByLabel("Numele tau").fill("Ioana Noua");
    await page.getByLabel("Telefon").fill("0722111222");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Alege o parola").fill(PAROLA);
    await buton(page, "Creeaza contul").click();

    /* Confirmarea pe email este activa, deci inregistrarea nu deschide sesiune.
       Contul trebuie totusi sa existe. */
    await expect.poll(async () => !!(await profilDupaEmail(email)), { timeout: 20000 }).toBe(true);
    /* Codul ramane nefolosit: inregistrarea nu deschide sesiune (vezi E1) */
    await serviciu().schema("identitate").from("invitatii").delete().eq("cod", cod);
    await stergeCont(email);
  });

  test("dupa inregistrare, mesajul despre confirmare este pe romaneste", async ({ page }) => {
    const email = `e2e-mesaj-${Date.now()}@adminbloc.test`;
    await page.goto("/");
    await buton(page, "Sunt administrator si vreau cont").click();
    await page.getByLabel("Numele tau").fill("Mesaj Clar");
    await page.getByLabel("Telefon").fill("0722111666");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Alege o parola").fill(PAROLA);
    await page.getByLabel("Numarul atestatului").fill("ATE-2026-888");
    await buton(page, "Trimite cererea").click();
    await asteaptaToast(page, "Confirma adresa de email");
    await stergeCont(email);
  });

  test.fixme("[E1] dupa inregistrare aplicatia arata ecranul de confirmare si pastreaza codul", async ({ page }) => {
    const email = `e2e-conf-${Date.now()}@adminbloc.test`;
    const ap = await apartamentulNumarul(18);
    const cod = `EF${String(Date.now()).slice(-6)}`.replace(/[01IO]/g, "4").toUpperCase();
    await serviciu().schema("identitate").from("invitatii").insert({
      apartament_id: ap.id, cod, calitate: "chirias",
      expira_la: new Date(Date.now() + 86400000).toISOString(),
    });

    await page.goto("/");
    await buton(page, "Am un cod de la administrator").click();
    await page.getByLabel("Codul primit").fill(cod);
    await page.getByLabel("Numele tau").fill("Vlad Confirmare");
    await page.getByLabel("Telefon").fill("0722111333");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Alege o parola").fill(PAROLA);
    await buton(page, "Creeaza contul").click();

    /* Ecranul "Confirma adresa de email" din EcranAutentificare: singurul loc
       care spune ce are omul de facut si care pastreaza codul pe ecran.
       Azi ecranul nu apare niciodata: sursa arunca in loc sa intoarca o sesiune
       goala, iar ecranul primeste doar un toast de 3,4 secunde. */
    await expect(page.getByText("Aproape gata")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(cod)).toBeVisible();
    await stergeCont(email);
  });

  test.fixme("[E1] administrator nou cu atestat: ecranul de confirmare aminteste atestatul", async ({ page }) => {
    const email = `e2e-adm-${Date.now()}@adminbloc.test`;
    await page.goto("/");
    await buton(page, "Sunt administrator si vreau cont").click();
    await page.getByLabel("Numele tau").fill("Sorin Atestat");
    await page.getByLabel("Telefon").fill("0722111444");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Alege o parola").fill(PAROLA);
    await page.getByLabel("Numarul atestatului").fill("ATE-2026-777");
    await buton(page, "Trimite cererea").click();

    await expect(page.getByText("Aproape gata")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("ATE-2026-777")).toBeVisible();
    await stergeCont(email);
  });

  test("emailul deja folosit este refuzat pe romaneste", async ({ page }) => {
    await page.goto("/");
    await buton(page, "Sunt administrator si vreau cont").click();
    await page.getByLabel("Numele tau").fill("Cineva Altcineva");
    await page.getByLabel("Telefon").fill("0722111555");
    await page.getByLabel("Email").fill(CONTURI.elena);
    await page.getByLabel("Alege o parola").fill(PAROLA);
    await page.getByLabel("Numarul atestatului").fill("ATE-1");
    await buton(page, "Trimite cererea").click();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 20000 });
    const mesaj = await page.locator(".ab-toast").innerText();
    expect(mesaj).not.toMatch(/already|registered|error/i);
  });

  test("parola slaba este refuzata inainte de trimitere", async ({ page }) => {
    await page.goto("/");
    await buton(page, "Sunt administrator si vreau cont").click();
    await page.getByLabel("Alege o parola").fill("scurta");
    await expect(page.getByText("Parola are nevoie de cel putin 10 caractere")).toBeVisible();
    await expect(buton(page, "Trimite cererea")).toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("sesiune stocata", () => {
  test("o sesiune invalida in browser nu blocheaza aplicatia pe Se incarca", async ({ page }) => {
    await intraCa(page, "elena");
    await page.evaluate(() => {
      for (const cheie of Object.keys(window.localStorage)) {
        if (!cheie.startsWith("sb-")) continue;
        const v = JSON.parse(window.localStorage.getItem(cheie));
        v.access_token = "invalid.invalid.invalid";
        v.refresh_token = "invalid";
        v.expires_at = Math.floor(Date.now() / 1000) - 10;
        window.localStorage.setItem(cheie, JSON.stringify(v));
      }
    });
    await page.reload();
    /* Ori ecranul de intrare, ori ecranul de eroare cu iesire: niciodata
       "Se incarca..." pentru totdeauna (audit S3) */
    await expect(
      page.getByText("Intra in cont").or(page.getByText("Nu am putut deschide contul"))
    ).toBeVisible({ timeout: 25000 });
    await expect(page.getByText("Se incarca...")).toHaveCount(0);
  });
});
