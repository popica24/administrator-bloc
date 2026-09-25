/* Transversal: taburi si badge-uri, navigare, reincarcare, dublu apasat,
   ecran de 320 px, tastatura si mesaje pe romaneste. */

import { test, expect } from "@playwright/test";
import {
  CONTURI, PAROLA, buton, intraCa, mergiLaTab, tab, serviciu, blocD14,
  apartamentulNumarul, asteaptaToast, textEcran, textTot, CUVINTE_TEHNICE,
  asociatieD14, telefonTemporar, profilDupaTelefon, stergeCont,
} from "./ajutor.js";

/* Identificatorii se cauta in baza: un `db reset && npm run seed` le schimba */
let ASOC;
test.beforeAll(async () => { ASOC = await asociatieD14(); });

const TABURI_LOCATAR = ["Acasă", "Plata", "Contoare", "Sesizări", "Bloc"];
const TABURI_ADMIN = ["Sumar", "Apartamente", "Facturi", "Sesizări", "Comunicare"];

test.describe("bara de taburi si badge-uri", () => {
  test("locatarul are cele cinci taburi, cu badge-urile din date", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const sb = serviciu();
    const profil = await profilDupaTelefon(CONTURI.elena);
    const { count: sesizari } = await sb.schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("apartament_id", ap.id).neq("stare", "rezolvata");
    const { count: notificari } = await sb.schema("comunicare").from("notificari")
      .select("id", { count: "exact", head: true }).eq("profil_id", profil.id).is("citita_la", null);

    await intraCa(page, "elena");
    for (const t of TABURI_LOCATAR) await expect(tab(page, t)).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(5);
    if (sesizari > 0) await expect(tab(page, "Sesizări")).toContainText(String(sesizari));
    if (notificari > 0) await expect(tab(page, "Acasă")).toContainText(String(Math.min(notificari, 50)));
  });

  test("administratorul are cele cinci taburi ale lui", async ({ page }) => {
    await intraCa(page, "admin");
    for (const t of TABURI_ADMIN) await expect(tab(page, t)).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(5);
    await expect(tab(page, "Sumar")).toHaveAttribute("aria-selected", "true");
  });

  test("fiecare tab deschide ecranul lui, pentru ambele roluri", async ({ page }) => {
    await intraCa(page, "elena");
    const asteptate = {
      Acasă: "Bună, Elena", Plata: "Întreținere", Contoare: "Contoare",
      Sesizări: "Sesizări", Bloc: "Bloc D14, scara A",
    };
    for (const [t, text] of Object.entries(asteptate)) {
      await mergiLaTab(page, t);
      await expect(tab(page, t)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText(text).first()).toBeVisible();
    }
    await buton(page, "Ieși").click();

    await intraCa(page, "admin");
    const asteptateAdmin = {
      Sumar: "Panou administrator", Apartamente: "Apartamente", Facturi: "Facturi și liste",
      Sesizări: "Sesizări", Comunicare: "Comunicare",
    };
    for (const [t, text] of Object.entries(asteptateAdmin)) {
      await mergiLaTab(page, t);
      await expect(tab(page, t)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText(text).first()).toBeVisible();
    }
  });
});

test.describe("navigare si reincarcare", () => {
  test("go() duce din Acasa direct in ecranul cerut", async ({ page }) => {
    await intraCa(page, "elena");
    await buton(page, "De unde vine suma").click();
    await expect(tab(page, "Plata")).toHaveAttribute("aria-selected", "true");
    await mergiLaTab(page, "Acasă");
    await page.getByRole("button", { name: "Transmite indexul la apă" }).click();
    await expect(tab(page, "Contoare")).toHaveAttribute("aria-selected", "true");
    await mergiLaTab(page, "Acasă");
    await page.getByRole("button", { name: "Confirmă prezența la adunarea generală" }).click();
    await expect(tab(page, "Bloc")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/Adunarea generală din/)).toBeVisible();
  });

  test("reincarcarea in mijlocul unui flux nu pierde datele si nu crapa", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizări");
    await buton(page, "Sesizare nouă").click();
    await page.getByLabel("Sau scrie pe scurt problema").fill("ceva ce nu se trimite");
    await page.reload();
    /* Sesiunea tine, formularul nedepus se pierde, aplicatia porneste de la Acasa */
    await expect(page.getByText("Bună, Elena")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const { count } = await serviciu().schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("titlu", "ceva ce nu se trimite");
    expect(count).toBe(0);
  });

  test("[E3] butonul Inapoi al browserului se intoarce la tabul anterior", async ({ page }) => {
    /* Taburile nu lasa nicio urma in istoricul browserului: pe telefon, butonul
       hardware Inapoi iese din aplicatie in loc sa urce un nivel. */
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await mergiLaTab(page, "Bloc");
    await page.goBack();
    await expect(tab(page, "Plata")).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(tab(page, "Bloc")).toHaveAttribute("aria-selected", "true");
  });

  test("iesirea si intrarea cu alt cont schimba complet ecranele", async ({ page }) => {
    await intraCa(page, "elena");
    await buton(page, "Ieși").click();
    await expect(page.getByText("Intră în cont")).toBeVisible();
    await intraCa(page, "admin");
    await expect(page.getByText("Panou administrator")).toBeVisible();
    const t = await textTot(page);
    expect(t).not.toContain("Elena Marinescu, Apartament");
  });
});

test.describe("dublul apasat pe butoanele principale", () => {
  test("un anunt publicat de doua ori ramane unul singur", async ({ page }) => {
    const titlu = `E2E dublu anunț ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await buton(page, "Scrie un anunț").click();
    await page.getByLabel("Titlu").fill(titlu);
    await page.getByLabel("Continut").fill("Text de test.");
    await buton(page, "Publică anunțul").dblclick();
    await asteaptaToast(page, "Anunț publicat");

    const { data } = await serviciu().schema("comunicare").from("anunturi")
      .select("id").eq("asociatie_id", ASOC).eq("titlu", titlu);
    expect(data).toHaveLength(1);
    await serviciu().schema("comunicare").from("anunturi_citiri").delete().eq("anunt_id", data[0].id);
    await serviciu().schema("comunicare").from("anunturi").delete().eq("id", data[0].id);
  });

  test("contul unui locatar nu se face de doua ori", async ({ page }) => {
    const ap = await apartamentulNumarul(18);
    const telefon = telefonTemporar();
    try {
      await intraCa(page, "admin");
      await mergiLaTab(page, "Apartamente");
      await page.getByRole("button", { name: "Apartament 18" }).click();
      await buton(page, "Adaugă un locatar în aplicație").click();
      await page.getByLabel("Numele locatarului").fill("Dublu Apasat");
      await page.getByLabel("Numărul lui de telefon").fill(telefon);
      await buton(page, "Fă contul").dblclick();
      await asteaptaToast(page, "Contul a fost creat");

      const { data } = await serviciu().schema("identitate").from("locatari")
        .select("id").eq("apartament_id", ap.id).is("activ_pana", null);
      expect(data).toHaveLength(1);
      expect(await profilDupaTelefon(telefon)).not.toBeNull();
    } finally {
      await stergeCont(telefon);
    }
  });

  test("un vot deschis de doua ori ramane unul singur", async ({ page }) => {
    const titlu = `E2E dublu vot ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await page.getByRole("button", { name: "Vot și AG" }).click();
    await buton(page, "Deschide un vot nou").click();
    const dialog = page.getByRole("dialog", { name: "Vot nou" });
    await dialog.getByLabel("Ce se votează").fill(titlu);
    await dialog.getByLabel("Varianta 1").fill("Da");
    await dialog.getByLabel("Varianta 2").fill("Nu");
    await dialog.getByLabel("Votul se închide pe").fill("2026-10-31");
    await buton(page, "Deschide votul").dblclick();
    await asteaptaToast(page, "Votul a fost deschis");

    const { data } = await serviciu().schema("guvernanta").from("voturi")
      .select("id").eq("asociatie_id", ASOC).eq("titlu", titlu);
    expect(data).toHaveLength(1);
    for (const v of data) {
      await serviciu().schema("guvernanta").from("voturi_optiuni").delete().eq("vot_id", v.id);
      await serviciu().schema("guvernanta").from("voturi").delete().eq("id", v.id);
    }
    await serviciu().schema("comunicare").from("notificari")
      .delete().gte("trimisa_la", new Date(Date.now() - 120000).toISOString());
  });

  test("un mesaj trimis de doua ori nu ajunge de doua ori", async ({ page }) => {
    const b = await blocD14();
    const ap = await apartamentulNumarul(17);
    const profil = await profilDupaTelefon(CONTURI.elena);
    const titlu = `E2E dublu mesaj ${Date.now()}`;
    const { data: ses } = await serviciu().schema("sesizari").from("sesizari").insert({
      bloc_id: b.id, apartament_id: ap.id, autor_id: profil.id,
      categorie: "altele", titlu, descriere: titlu, stare: "noua",
    }).select("id").single();

    await intraCa(page, "admin");
    await mergiLaTab(page, "Sesizări");
    await page.getByRole("button", { name: titlu }).click();
    await page.getByLabel("Răspuns pentru proprietar").fill("Am notat, revin.");
    await buton(page, "Trimite răspunsul").dblclick();
    await asteaptaToast(page, "Mesajul a fost trimis");

    const { data: mesaje } = await serviciu().schema("sesizari").from("sesizari_mesaje")
      .select("id").eq("sesizare_id", ses.id);
    expect(mesaje).toHaveLength(1);

    await serviciu().schema("sesizari").from("sesizari_mesaje").delete().eq("sesizare_id", ses.id);
    await serviciu().schema("sesizari").from("sesizari").delete().eq("id", ses.id);
  });
});

test.describe("ecran ingust de 320 px", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("locatarul nu are derulare pe orizontala si vede suma intreaga", async ({ page }) => {
    await intraCa(page, "elena");
    const lat = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth, win: window.innerWidth,
    }));
    expect(lat.doc).toBeLessThanOrEqual(lat.win);
    await expect(page.getByText("De plată acum")).toBeVisible();
    for (const t of TABURI_LOCATAR) await expect(tab(page, t)).toBeVisible();
  });

  test("ecranele administratorului incap si ele", async ({ page }) => {
    await intraCa(page, "admin");
    for (const t of ["Sumar", "Apartamente", "Facturi", "Sesizări", "Comunicare"]) {
      await mergiLaTab(page, t);
      const lat = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth, win: window.innerWidth,
      }));
      expect(lat.doc, `tabul ${t} cere derulare pe orizontala`).toBeLessThanOrEqual(lat.win);
    }
  });
});

test.describe("operare de la tastatura", () => {
  test("intrarea in cont se face fara mouse", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Intră în cont")).toBeVisible();
    for (let i = 0; i < 12; i += 1) {
      const etichetaCurenta = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("aria-label"));
      if (etichetaCurenta === "Numărul tău de telefon") break;
      await page.keyboard.press("Tab");
    }
    expect(await page.evaluate(() => document.activeElement.getAttribute("aria-label"))).toBe("Numărul tău de telefon");
    await page.keyboard.type(CONTURI.elena);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement.getAttribute("aria-label"))).toBe("Parola");
    await page.keyboard.type(PAROLA);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Bună, Elena")).toBeVisible({ timeout: 20000 });
  });

  test("taburile si randurile se activeaza cu Enter si cu Space", async ({ page }) => {
    await intraCa(page, "elena");
    await tab(page, "Plata").focus();
    await page.keyboard.press("Enter");
    await expect(tab(page, "Plata")).toHaveAttribute("aria-selected", "true");

    const rand = page.getByRole("button", { name: /^Apa rece si canalizare,/ }).first();
    await rand.focus();
    await page.keyboard.press(" ");
    await expect(rand).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Enter");
    await expect(rand).toHaveAttribute("aria-expanded", "false");
  });

  test("panoul se inchide cu Escape", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizări");
    await buton(page, "Sesizare nouă").click();
    await expect(page.getByRole("dialog", { name: "Sesizare nouă" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Sesizare nouă" })).toHaveCount(0);
  });
});

test.describe("niciun mesaj tehnic pe ecran", () => {
  const CUVINTE_ENGLEZE = [
    " the ", " and ", " not found", " failed", " invalid ", "Unauthorized",
    "Bad Request", "Internal Server", "Forbidden", "null", "[object",
  ];

  test("toate ecranele locatarului sunt pe romaneste", async ({ page }) => {
    await intraCa(page, "elena");
    const subtaburi = { Bloc: ["Avizier", "Vot și adunare", "Acte", "Fonduri"], Plata: ["Lista de plată", "Plățile mele"], Sesizări: ["Ale mele", "Din tot blocul"] };
    for (const t of TABURI_LOCATAR) {
      await mergiLaTab(page, t);
      for (const sub of subtaburi[t] || [null]) {
        if (sub) await page.getByRole("button", { name: sub, exact: true }).click();
        const text = await textEcran(page);
        for (const cuvant of [...CUVINTE_TEHNICE, ...CUVINTE_ENGLEZE]) {
          expect(text, `tabul ${t}${sub ? `/${sub}` : ""} conține "${cuvant}"`).not.toContain(cuvant);
        }
      }
    }
  });

  test("toate ecranele administratorului sunt pe romaneste", async ({ page }) => {
    await intraCa(page, "admin");
    const subtaburi = {
      Apartamente: ["Apartamente", "Citiri contoare", "Fonduri"],
      Comunicare: ["Anunțuri", "Remindere", "Vot și AG", "Acte"],
      Sesizări: ["Deschise", "Rezolvate", "Toate"],
    };
    for (const t of TABURI_ADMIN) {
      await mergiLaTab(page, t);
      for (const sub of subtaburi[t] || [null]) {
        if (sub) await page.getByRole("button", { name: sub, exact: true }).first().click();
        const text = await textEcran(page);
        for (const cuvant of [...CUVINTE_TEHNICE, ...CUVINTE_ENGLEZE]) {
          expect(text, `tabul ${t}${sub ? `/${sub}` : ""} conține "${cuvant}"`).not.toContain(cuvant);
        }
      }
    }
  });
});

test.describe("doua actiuni diferite, una dupa alta", () => {
  /* Protectia la dublu apasat blocheaza comanda dupa nume, nu dupa butonul
     apasat: cat timp o comanda este in aer, aceeasi comanda pe alt rand este
     aruncata in tacere, fara toast si fara efect. */
  test("[E6] doua notificari marcate citite una dupa alta raman amandoua citite", async ({ page }) => {
    const sb = serviciu();
    const profil = await profilDupaTelefon(CONTURI.elena);
    /* Testul isi face singur cele doua notificari necitite. Cate are Elena
       depinde de ziua in care s-a facut seed-ul (mai vechi de 14 zile sunt
       citite) si de ce au facut testele rulate inainte in aceeasi baza: pe un
       seed din 21 septembrie are una singura. Sunt cele mai noi, deci primele. */
    const acum = Date.now();
    const asociatie = await asociatieD14();
    const { data: noi, error } = await sb.schema("comunicare").from("notificari").insert([
      { profil_id: profil.id, asociatie_id: asociatie, tip: "reminder", titlu: "E2E E6 prima", trimisa_la: new Date(acum).toISOString() },
      { profil_id: profil.id, asociatie_id: asociatie, tip: "reminder", titlu: "E2E E6 a două", trimisa_la: new Date(acum - 1000).toISOString() },
    ]).select("id");
    if (error) throw new Error(`notificarile testului: ${error.message}`);
    const iduri = noi.map((n) => n.id);

    try {
      await intraCa(page, "elena");
      const butoane = buton(page, "Am citit");
      await expect(butoane.nth(1)).toBeVisible();
      const unu = await butoane.nth(0).elementHandle();
      const doi = await butoane.nth(1).elementHandle();
      await unu.dispatchEvent("click");
      /* fara pauza: cele doua apasari cad in aceeasi fereastra */
      await doi.dispatchEvent("click");

      await expect.poll(async () => {
        const { count } = await sb.schema("comunicare").from("notificari")
          .select("id", { count: "exact", head: true })
          .in("id", iduri).not("citita_la", "is", null);
        return count;
      }, { timeout: 20000 }).toBe(2);
    } finally {
      await sb.schema("comunicare").from("notificari").delete().in("id", iduri);
    }
  });
});

/* Fundalul intunecat al panoului, chiar sub marginea de sus a coloanei */
async function apasaFundalul(page) {
  const cutie = await page.locator(".ab-shell").boundingBox();
  await page.mouse.click(cutie.x + cutie.width / 2, cutie.y + 20);
}

test.describe("panoul care tine minte ce s-a scris", () => {
  test("atingerea fundalului nu arunca textul dintr-un formular inceput", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizări");
    await buton(page, "Sesizare nouă").click();
    await page.getByLabel("Sau scrie pe scurt problema").fill("text care nu trebuie pierdut");
    await apasaFundalul(page);
    await expect(page.getByRole("dialog", { name: "Sesizare nouă" })).toBeVisible();
    await expect(page.getByLabel("Sau scrie pe scurt problema")).toHaveValue("text care nu trebuie pierdut");
  });

  test("panoul gol se inchide la atingerea fundalului", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizări");
    await buton(page, "Sesizare nouă").click();
    await apasaFundalul(page);
    await expect(page.getByRole("dialog", { name: "Sesizare nouă" })).toHaveCount(0);
  });
});
