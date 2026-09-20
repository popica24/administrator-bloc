/* Ecranul "Confirma adresa de email" de dupa inregistrare (harta functiilor
   §2.2 si §2.3), pe amandoua drumurile: locatar cu cod si administrator cu
   atestat. Confirmarea se face pe bune, prin linkul din Mailpit, exact ca
   omul care deschide mesajul si apoi intra in cont. */

import { test, expect } from "@playwright/test";
import {
  PAROLA, buton, intra, serviciu, apartamentulNumarul, profilDupaEmail,
  stergeCont, curataConturiTemporare, curataIncercariInvitatii,
  ultimulEmail, textEcran, asteaptaToast, CUVINTE_TEHNICE,
} from "./ajutor.js";

test.beforeAll(async () => { await curataConturiTemporare(["e2e-mail-"]); });
test.afterAll(async () => { await curataIncercariInvitatii(); });

/* Un cod de invitatie nou, pe un apartament fara locatar */
async function codNou(numarApartament, calitate = "chirias") {
  const ap = await apartamentulNumarul(numarApartament);
  const cod = `EM${String(Date.now()).slice(-6)}`.replace(/[01IO]/g, "5").toUpperCase();
  const { error } = await serviciu().schema("identitate").from("invitatii").insert({
    apartament_id: ap.id, cod, calitate,
    expira_la: new Date(Date.now() + 86400000).toISOString(),
  });
  if (error) throw new Error(`codNou: ${error.message}`);
  return { ap, cod };
}

async function stergeCod(cod) {
  await serviciu().schema("identitate").from("invitatii").delete().eq("cod", cod);
}

/* Deschide linkul de confirmare in afara browserului aplicatiei: adresa se
   confirma, dar sesiunea nu se deschide singura, ca atunci cand omul citeste
   mesajul pe telefon si revine in aplicatie mai tarziu. */
async function confirmaAdresa(email) {
  const mesaj = await ultimulEmail(email);
  expect(mesaj.link, "mesajul de confirmare nu are link").toBeTruthy();
  const r = await fetch(mesaj.link, { redirect: "manual" });
  expect([200, 301, 302, 303, 307]).toContain(r.status);
  const profil = await profilDupaEmail(email);
  await expect.poll(async () => {
    const { data } = await serviciu().auth.admin.getUserById(profil.id);
    return !!(data && data.user && data.user.email_confirmed_at);
  }, { timeout: 15000 }).toBe(true);
  return mesaj;
}

test.describe("locatar nou cu cod", () => {
  test("ecranul de confirmare spune adresa, pastreaza codul si nu deschide sesiune", async ({ page }) => {
    const email = `e2e-mail-loc-${Date.now()}@adminbloc.test`;
    const { cod } = await codNou(19);
    try {
      await page.goto("/");
      await buton(page, "Am un cod de la administrator").click();
      await page.getByLabel("Codul primit").fill(cod);
      await page.getByLabel("Numele tau").fill("Ana Confirmata");
      await page.getByLabel("Telefon").fill("0722900001");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Alege o parola").fill(PAROLA);
      await buton(page, "Creeaza contul").click();

      await expect(page.getByText("Confirma adresa de email")).toBeVisible({ timeout: 25000 });
      await expect(page.getByText("Aproape gata")).toBeVisible();
      await expect(page.getByText(new RegExp(email.replace(/[.@]/g, "\\$&")))).toBeVisible();
      await expect(page.getByText(new RegExp(`Pastreaza codul ${cod}`))).toBeVisible();
      /* Fara sesiune: niciun tab, niciun ecran de locatar */
      await expect(page.getByRole("tab")).toHaveCount(0);

      const text = await textEcran(page);
      for (const cuvant of CUVINTE_TEHNICE) expect(text, `ecranul contine "${cuvant}"`).not.toContain(cuvant);

      /* Contul exista, codul ramane nefolosit pana dupa confirmare */
      await expect.poll(async () => !!(await profilDupaEmail(email)), { timeout: 20000 }).toBe(true);
      const { data: inv } = await serviciu().schema("identitate").from("invitatii")
        .select("folosita_la").eq("cod", cod).single();
      expect(inv.folosita_la).toBeNull();
    } finally {
      await stergeCod(cod);
      await stergeCont(email);
    }
  });

  test("intrarea inainte de confirmare este refuzata cu un mesaj pe intelesul omului", async ({ page }) => {
    const email = `e2e-mail-neconf-${Date.now()}@adminbloc.test`;
    const { cod } = await codNou(19);
    try {
      await page.goto("/");
      await buton(page, "Am un cod de la administrator").click();
      await page.getByLabel("Codul primit").fill(cod);
      await page.getByLabel("Numele tau").fill("Neconfirmat Ion");
      await page.getByLabel("Telefon").fill("0722900002");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Alege o parola").fill(PAROLA);
      await buton(page, "Creeaza contul").click();
      await expect(page.getByText("Confirma adresa de email")).toBeVisible({ timeout: 25000 });

      await buton(page, "Am confirmat, intru in cont").click();
      await expect(page.getByText("Intra in cont")).toBeVisible();
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Parola").fill(PAROLA);
      await buton(page, "Intra").click();

      await asteaptaToast(page, "Confirma adresa de email inainte sa intri in cont");
      await expect(page.getByRole("tab")).toHaveCount(0);
    } finally {
      await stergeCod(cod);
      await stergeCont(email);
    }
  });

  test("dupa confirmare, omul revine, intra in cont si isi leaga apartamentul cu codul", async ({ page }) => {
    const email = `e2e-mail-gata-${Date.now()}@adminbloc.test`;
    const { ap, cod } = await codNou(19);
    try {
      await page.goto("/");
      await buton(page, "Am un cod de la administrator").click();
      await page.getByLabel("Codul primit").fill(cod);
      await page.getByLabel("Numele tau").fill("Gata Confirmata");
      await page.getByLabel("Telefon").fill("0722900003");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Alege o parola").fill(PAROLA);
      await buton(page, "Creeaza contul").click();
      await expect(page.getByText("Confirma adresa de email")).toBeVisible({ timeout: 25000 });

      await confirmaAdresa(email);

      /* Omul revine mai tarziu, pe pagina goala, si intra in cont */
      await intra(page, email);
      await expect(page.getByText("Leaga contul de apartamentul tau")).toBeVisible({ timeout: 25000 });
      await page.getByLabel("Codul primit").fill(cod);
      await buton(page, "Foloseste codul").click();
      await asteaptaToast(page, `Contul a fost legat de apartamentul ${ap.numar}`);
      await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 25000 });
      await expect(page.getByText(`Bloc D14, scara A, ap. ${ap.numar}`)).toBeVisible();
    } finally {
      await stergeCod(cod);
      await stergeCont(email);
      await curataIncercariInvitatii();
    }
  });
});

test.describe("administrator nou cu atestat", () => {
  test("ecranul de confirmare aminteste atestatul si ce urmeaza", async ({ page }) => {
    const email = `e2e-mail-adm-${Date.now()}@adminbloc.test`;
    try {
      await page.goto("/");
      await buton(page, "Sunt administrator si vreau cont").click();
      await page.getByLabel("Numele tau").fill("Sorin Atestatescu");
      await page.getByLabel("Telefon").fill("0722900004");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Alege o parola").fill(PAROLA);
      await page.getByLabel("Numarul atestatului").fill("ATE-2026-321");
      await buton(page, "Trimite cererea").click();

      await expect(page.getByText("Confirma adresa de email")).toBeVisible({ timeout: 25000 });
      await expect(page.getByText(/ATE-2026-321/)).toBeVisible();
      await expect(page.getByRole("tab")).toHaveCount(0);
      /* Cererea de verificare nu pleaca inaintea confirmarii */
      const profil = await profilDupaEmail(email);
      if (profil) {
        const { data } = await serviciu().schema("identitate").from("administratori")
          .select("id").eq("profil_id", profil.id);
        expect(data || []).toHaveLength(0);
      }
    } finally {
      await stergeCont(email);
    }
  });

  test("dupa confirmare, administratorul intra si isi trimite atestatul", async ({ page }) => {
    const email = `e2e-mail-adm2-${Date.now()}@adminbloc.test`;
    try {
      await page.goto("/");
      await buton(page, "Sunt administrator si vreau cont").click();
      await page.getByLabel("Numele tau").fill("Vasile Atestat");
      await page.getByLabel("Telefon").fill("0722900005");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Alege o parola").fill(PAROLA);
      await page.getByLabel("Numarul atestatului").fill("ATE-2026-654");
      await buton(page, "Trimite cererea").click();
      await expect(page.getByText("Confirma adresa de email")).toBeVisible({ timeout: 25000 });

      await confirmaAdresa(email);
      await intra(page, email);

      await expect(page.getByText("Esti administrator de bloc?")).toBeVisible({ timeout: 25000 });
      await page.getByLabel("Numarul atestatului").fill("ATE-2026-654");
      await buton(page, "Trimite cererea de administrator").click();
      await asteaptaToast(page, "Cererea a fost trimisa spre verificare");
      await expect(page.getByText("Contul de administrator asteapta verificarea")).toBeVisible({ timeout: 25000 });

      const profil = await profilDupaEmail(email);
      const { data } = await serviciu().schema("identitate").from("administratori")
        .select("stare, numar_atestat").eq("profil_id", profil.id).single();
      expect(data.stare).toBe("in_asteptare");
      expect(data.numar_atestat).toBe("ATE-2026-654");
    } finally {
      await stergeCont(email);
    }
  });
});

test.describe("mesajul de confirmare care ajunge la om", () => {
  test("[F1] mesajul de confirmare este scris pe romaneste", async ({ page }) => {
    /* [F1] Singurul text al aplicatiei pe care il vede orice utilizator nou,
       inainte de orice ecran, pleaca in engleza: "Confirm your email address /
       Follow the link below to confirm this email address and finish signing
       up". Utilizatorii sunt de peste 50 de ani si netehnici, iar restul
       aplicatiei este integral pe romaneste (CLAUDE.md). supabase/config.toml
       nu suprascrie [auth.email.template.confirmation], deci pleaca sablonul
       implicit al GoTrue, in engleza si fara numele asociatiei. */
    const email = `e2e-mail-text-${Date.now()}@adminbloc.test`;
    const { cod } = await codNou(19);
    try {
      await page.goto("/");
      await buton(page, "Am un cod de la administrator").click();
      await page.getByLabel("Codul primit").fill(cod);
      await page.getByLabel("Numele tau").fill("Text Romanesc");
      await page.getByLabel("Telefon").fill("0722900006");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Alege o parola").fill(PAROLA);
      await buton(page, "Creeaza contul").click();
      await expect(page.getByText("Confirma adresa de email")).toBeVisible({ timeout: 25000 });

      const mesaj = await ultimulEmail(email);
      expect(mesaj.subiect).toMatch(/[Cc]onfirm[ăa]/);
      for (const cuvant of ["Confirm your email", "Follow the link", "signing up"]) {
        expect(mesaj.corp, `mesajul contine "${cuvant}"`).not.toContain(cuvant);
      }
    } finally {
      await stergeCod(cod);
      await stergeCont(email);
    }
  });
});
