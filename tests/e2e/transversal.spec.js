/* Transversal: taburi si badge-uri, navigare, reincarcare, dublu apasat,
   ecran de 320 px, tastatura si mesaje pe romaneste. */

import { test, expect } from "@playwright/test";
import {
  CONTURI, PAROLA, buton, intraCa, mergiLaTab, tab, serviciu, blocD14,
  apartamentulNumarul, asteaptaToast, textEcran, textTot, CUVINTE_TEHNICE,
} from "./ajutor.js";

const ASOC = "51098af2-7ff6-4f35-86f4-e52cf87bbe23";

const TABURI_LOCATAR = ["Acasa", "Plata", "Contoare", "Sesizari", "Bloc"];
const TABURI_ADMIN = ["Sumar", "Apartamente", "Facturi", "Sesizari", "Comunicare"];

test.describe("bara de taburi si badge-uri", () => {
  test("locatarul are cele cinci taburi, cu badge-urile din date", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const sb = serviciu();
    const profil = await sb.schema("identitate").from("profiluri").select("id").eq("email", CONTURI.elena).single();
    const { count: sesizari } = await sb.schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("apartament_id", ap.id).neq("stare", "rezolvata");
    const { count: notificari } = await sb.schema("comunicare").from("notificari")
      .select("id", { count: "exact", head: true }).eq("profil_id", profil.data.id).is("citita_la", null);

    await intraCa(page, "elena");
    for (const t of TABURI_LOCATAR) await expect(tab(page, t)).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(5);
    if (sesizari > 0) await expect(tab(page, "Sesizari")).toContainText(String(sesizari));
    if (notificari > 0) await expect(tab(page, "Acasa")).toContainText(String(Math.min(notificari, 50)));
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
      Acasa: "Buna, Elena", Plata: "Intretinere", Contoare: "Contoare",
      Sesizari: "Sesizari", Bloc: "Bloc D14, scara A",
    };
    for (const [t, text] of Object.entries(asteptate)) {
      await mergiLaTab(page, t);
      await expect(tab(page, t)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText(text).first()).toBeVisible();
    }
    await buton(page, "Iesi").click();

    await intraCa(page, "admin");
    const asteptateAdmin = {
      Sumar: "Panou administrator", Apartamente: "Apartamente", Facturi: "Facturi si liste",
      Sesizari: "Sesizari", Comunicare: "Comunicare",
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
    await mergiLaTab(page, "Acasa");
    await page.getByRole("button", { name: "Transmite indexul la apa" }).click();
    await expect(tab(page, "Contoare")).toHaveAttribute("aria-selected", "true");
    await mergiLaTab(page, "Acasa");
    await page.getByRole("button", { name: "Confirma prezenta la adunarea generala" }).click();
    await expect(tab(page, "Bloc")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/Adunarea generala din/)).toBeVisible();
  });

  test("reincarcarea in mijlocul unui flux nu pierde datele si nu crapa", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await page.getByLabel("Sau scrie pe scurt problema").fill("ceva ce nu se trimite");
    await page.reload();
    /* Sesiunea tine, formularul nedepus se pierde, aplicatia porneste de la Acasa */
    await expect(page.getByText("Buna, Elena")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const { count } = await serviciu().schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("titlu", "ceva ce nu se trimite");
    expect(count).toBe(0);
  });

  test.fixme("[E3] butonul Inapoi al browserului se intoarce la tabul anterior", async ({ page }) => {
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
    await buton(page, "Iesi").click();
    await expect(page.getByText("Intra in cont")).toBeVisible();
    await intraCa(page, "admin");
    await expect(page.getByText("Panou administrator")).toBeVisible();
    const t = await textTot(page);
    expect(t).not.toContain("Elena Marinescu, Apartament");
  });
});

test.describe("dublul apasat pe butoanele principale", () => {
  test("un anunt publicat de doua ori ramane unul singur", async ({ page }) => {
    const titlu = `E2E dublu anunt ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await buton(page, "Scrie un anunt").click();
    await page.getByLabel("Titlu").fill(titlu);
    await page.getByLabel("Continut").fill("Text de test.");
    await buton(page, "Publica anuntul").dblclick();
    await asteaptaToast(page, "Anunt publicat");

    const { data } = await serviciu().schema("comunicare").from("anunturi")
      .select("id").eq("asociatie_id", ASOC).eq("titlu", titlu);
    expect(data).toHaveLength(1);
    await serviciu().schema("comunicare").from("anunturi_citiri").delete().eq("anunt_id", data[0].id);
    await serviciu().schema("comunicare").from("anunturi").delete().eq("id", data[0].id);
  });

  test("codul de invitatie nu se genereaza de doua ori", async ({ page }) => {
    const ap = await apartamentulNumarul(18);
    await serviciu().schema("identitate").from("invitatii")
      .delete().eq("apartament_id", ap.id).is("folosita_la", null);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 18" }).click();
    await buton(page, "Invita un locatar in aplicatie").click();
    await buton(page, "Genereaza codul").dblclick();
    await asteaptaToast(page, "Codul de invitatie a fost generat");

    const { data } = await serviciu().schema("identitate").from("invitatii")
      .select("id").eq("apartament_id", ap.id).is("folosita_la", null);
    expect(data).toHaveLength(1);
    await serviciu().schema("identitate").from("invitatii").delete().eq("id", data[0].id);
  });

  test("un vot deschis de doua ori ramane unul singur", async ({ page }) => {
    const titlu = `E2E dublu vot ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await page.getByRole("button", { name: "Vot si AG" }).click();
    await buton(page, "Deschide un vot nou").click();
    const dialog = page.getByRole("dialog", { name: "Vot nou" });
    await dialog.getByLabel("Ce se voteaza").fill(titlu);
    await dialog.getByLabel("Varianta 1").fill("Da");
    await dialog.getByLabel("Varianta 2").fill("Nu");
    await dialog.getByLabel("Votul se inchide pe").fill("2026-10-31");
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
    const { data: profil } = await serviciu().schema("identitate").from("profiluri")
      .select("id").eq("email", CONTURI.elena).single();
    const titlu = `E2E dublu mesaj ${Date.now()}`;
    const { data: ses } = await serviciu().schema("sesizari").from("sesizari").insert({
      bloc_id: b.id, apartament_id: ap.id, autor_id: profil.id,
      categorie: "altele", titlu, descriere: titlu, stare: "noua",
    }).select("id").single();

    await intraCa(page, "admin");
    await mergiLaTab(page, "Sesizari");
    await page.getByRole("button", { name: titlu }).click();
    await page.getByLabel("Raspuns pentru proprietar").fill("Am notat, revin.");
    await buton(page, "Trimite raspunsul").dblclick();
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
    await expect(page.getByText("De plata acum")).toBeVisible();
    for (const t of TABURI_LOCATAR) await expect(tab(page, t)).toBeVisible();
  });

  test("ecranele administratorului incap si ele", async ({ page }) => {
    await intraCa(page, "admin");
    for (const t of ["Sumar", "Apartamente", "Facturi", "Sesizari", "Comunicare"]) {
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
    await expect(page.getByText("Intra in cont")).toBeVisible();
    for (let i = 0; i < 12; i += 1) {
      const etichetaCurenta = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("aria-label"));
      if (etichetaCurenta === "Email") break;
      await page.keyboard.press("Tab");
    }
    expect(await page.evaluate(() => document.activeElement.getAttribute("aria-label"))).toBe("Email");
    await page.keyboard.type(CONTURI.elena);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement.getAttribute("aria-label"))).toBe("Parola");
    await page.keyboard.type(PAROLA);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Buna, Elena")).toBeVisible({ timeout: 20000 });
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
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await expect(page.getByRole("dialog", { name: "Sesizare noua" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Sesizare noua" })).toHaveCount(0);
  });
});

test.describe("niciun mesaj tehnic pe ecran", () => {
  const CUVINTE_ENGLEZE = [
    " the ", " and ", " not found", " failed", " invalid ", "Unauthorized",
    "Bad Request", "Internal Server", "Forbidden", "null", "[object",
  ];

  test("toate ecranele locatarului sunt pe romaneste", async ({ page }) => {
    await intraCa(page, "elena");
    const subtaburi = { Bloc: ["Avizier", "Vot si adunare", "Acte", "Fonduri"], Plata: ["Lista de plata", "Platile mele"], Sesizari: ["Ale mele", "Din tot blocul"] };
    for (const t of TABURI_LOCATAR) {
      await mergiLaTab(page, t);
      for (const sub of subtaburi[t] || [null]) {
        if (sub) await page.getByRole("button", { name: sub, exact: true }).click();
        const text = await textEcran(page);
        for (const cuvant of [...CUVINTE_TEHNICE, ...CUVINTE_ENGLEZE]) {
          expect(text, `tabul ${t}${sub ? `/${sub}` : ""} contine "${cuvant}"`).not.toContain(cuvant);
        }
      }
    }
  });

  test("toate ecranele administratorului sunt pe romaneste", async ({ page }) => {
    await intraCa(page, "admin");
    const subtaburi = {
      Apartamente: ["Apartamente", "Citiri contoare"],
      Comunicare: ["Anunturi", "Remindere", "Vot si AG", "Acte"],
      Sesizari: ["Deschise", "Rezolvate", "Toate"],
    };
    for (const t of TABURI_ADMIN) {
      await mergiLaTab(page, t);
      for (const sub of subtaburi[t] || [null]) {
        if (sub) await page.getByRole("button", { name: sub, exact: true }).first().click();
        const text = await textEcran(page);
        for (const cuvant of [...CUVINTE_TEHNICE, ...CUVINTE_ENGLEZE]) {
          expect(text, `tabul ${t}${sub ? `/${sub}` : ""} contine "${cuvant}"`).not.toContain(cuvant);
        }
      }
    }
  });
});

test.describe("doua actiuni diferite, una dupa alta", () => {
  /* Protectia la dublu apasat blocheaza comanda dupa nume, nu dupa butonul
     apasat: cat timp o comanda este in aer, aceeasi comanda pe alt rand este
     aruncata in tacere, fara toast si fara efect. */
  test.fixme("[E6] doua notificari marcate citite una dupa alta raman amandoua citite", async ({ page }) => {
    const sb = serviciu();
    const { data: profil } = await sb.schema("identitate").from("profiluri")
      .select("id").eq("email", CONTURI.elena).single();
    const { data: necitite } = await sb.schema("comunicare").from("notificari")
      .select("id").eq("profil_id", profil.id).is("citita_la", null)
      .order("trimisa_la", { ascending: false }).limit(3);
    expect(necitite.length).toBeGreaterThanOrEqual(2);

    await intraCa(page, "elena");
    const butoane = buton(page, "Am citit");
    await expect(butoane).toHaveCount(3);
    const unu = await butoane.nth(0).elementHandle();
    const doi = await butoane.nth(1).elementHandle();
    await unu.dispatchEvent("click");
    /* fara pauza: cele doua apasari cad in aceeasi fereastra */
    await doi.dispatchEvent("click");

    await expect.poll(async () => {
      const { count } = await sb.schema("comunicare").from("notificari")
        .select("id", { count: "exact", head: true })
        .in("id", [necitite[0].id, necitite[1].id]).not("citita_la", "is", null);
      return count;
    }, { timeout: 20000 }).toBe(2);
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
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await page.getByLabel("Sau scrie pe scurt problema").fill("text care nu trebuie pierdut");
    await apasaFundalul(page);
    await expect(page.getByRole("dialog", { name: "Sesizare noua" })).toBeVisible();
    await expect(page.getByLabel("Sau scrie pe scurt problema")).toHaveValue("text care nu trebuie pierdut");
  });

  test("panoul gol se inchide la atingerea fundalului", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await apasaFundalul(page);
    await expect(page.getByRole("dialog", { name: "Sesizare noua" })).toHaveCount(0);
  });
});
