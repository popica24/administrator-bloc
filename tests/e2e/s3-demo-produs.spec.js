/* Modul demonstrativ ca produs, nu ca oglinda a bazei.

   `z-demo-paritate` compara cifrele celor doua surse. Aici intrebarea e alta:
   cineva deschide aplicatia fara niciun server, un administrator care o
   incearca seara, acasa, si trebuie sa poata duce la capat tot ce duce la
   capat in aplicatia adevarata, fara sa dea peste un ecran gol, un buton care
   nu face nimic sau un cuvant de programator.

   Serverul demonstrativ si-l porneste fisierul singur, pe alt port, cu cele
   doua variabile golite (`sursa.js` alege atunci mock-ul). Datele stau in
   memorie si se sterg la fiecare reincarcare, deci fiecare test isi face
   drumul de la capat si nu lasa nimic in urma. */

import { spawn } from "node:child_process";
import { test, expect } from "@playwright/test";
import { PAROLA, CONTURI, buton, mergiLaTab, textEcran, CUVINTE_TEHNICE, fisierPoza, textPdf } from "./ajutor.js";

const PORT = 5175;
const DEMO = `http://localhost:${PORT}`;
let server = null;

async function raspunde(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  if (await raspunde(DEMO)) return;
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort"], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" },
    stdio: "ignore",
  });
  const pornire = Date.now();
  while (!(await raspunde(DEMO))) {
    if (Date.now() - pornire > 60000) throw new Error("Serverul modului demonstrativ nu pornește");
    await new Promise((r) => setTimeout(r, 400));
  }
});

test.afterAll(() => {
  if (server) server.kill("SIGTERM");
  server = null;
});

async function intraDemo(page, telefon) {
  await page.goto(`${DEMO}/`);
  await page.getByLabel("Numărul tău de telefon").fill(telefon);
  await page.getByLabel("Parola").fill(PAROLA);
  await page.getByRole("button", { name: "Intră", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ieși", exact: true })).toBeVisible({ timeout: 25000 });
}

/* Ecranul de fata nu are voie sa fie gol si nu are voie sa vorbeasca tehnic */
async function ecranSanatos(page, minimCaractere = 120) {
  const t = await textEcran(page);
  expect(t.length, `ecran prea gol:\n${t}`).toBeGreaterThan(minimCaractere);
  for (const cuvant of CUVINTE_TEHNICE) expect(t, `ecranul conține "${cuvant}"`).not.toContain(cuvant);
  expect(t).not.toMatch(/\bnull\b|\[object|Infinity|\bNaN\b/);
  return t;
}

const descarcaDemo = async (page, actiune) => {
  const asteptare = page.waitForEvent("download");
  await actiune();
  const d = await asteptare;
  const { readFile } = await import("node:fs/promises");
  return { nume: d.suggestedFilename(), octeti: await readFile(await d.path()) };
};

test.describe("fara server, ecranul de intrare isi spune singur povestea", () => {
  test("aplicatia porneste, se prezinta si arata conturile cu care se poate intra", async ({ page }) => {
    await page.goto(`${DEMO}/`);
    await expect(page.getByText("AdminBloc").first()).toBeVisible({ timeout: 25000 });
    const t = await page.locator(".ab-shell").innerText();
    /* Omul trebuie sa afle de aici ca e o demonstratie si cu ce conturi intra */
    expect(t).toMatch(/demonstrativ|demonstratie|de proba/i);
    expect(t).toContain(CONTURI.elena);
    expect(t).toContain(CONTURI.admin);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });
});

test.describe("locatarul duce la capat tot ce are de facut, fara server", () => {
  test("cele cinci ecrane sunt pline si pe romaneste", async ({ page }) => {
    await intraDemo(page, CONTURI.elena);
    await ecranSanatos(page, 300);
    for (const tabul of ["Plata", "Contoare", "Sesizări", "Bloc"]) {
      await mergiLaTab(page, tabul);
      await ecranSanatos(page, 200);
    }
    /* Subtaburile au si ele continut, nu doar titlu */
    for (const sub of ["Vot și adunare", "Acte", "Fonduri"]) {
      await page.getByRole("button", { name: sub, exact: true }).click();
      await ecranSanatos(page, 100);
    }
  });

  test("randul de cheltuiala se desface si arata calculul, ca in aplicatia reala", async ({ page }) => {
    await intraDemo(page, CONTURI.elena);
    await mergiLaTab(page, "Plata");
    const rand = page.getByRole("button", { name: /^Apa rece si canalizare,/ }).first();
    await rand.click();
    await expect(rand).toHaveAttribute("aria-expanded", "true");
    const t = await ecranSanatos(page, 300);
    expect(t).toContain("Contor general al blocului");
    expect(t).toContain("Preț pe metru cub");
    expect(t).toContain("Consumul apartamentului");
  });

  test("ecranul de plata spune cum se plateste, fara jargon", async ({ page }) => {
    await intraDemo(page, CONTURI.elena);
    await mergiLaTab(page, "Plata");
    await expect(page.getByText("Cum plătești")).toBeVisible();
    const t = await ecranSanatos(page, 200);
    /* Titlurile mici se scriu cu majuscule pe ecran (text-transform) */
    expect(t).toContain("ÎN NUMERAR, LA ADMINISTRATOR");
    expect(t).toContain("PRIN TRANSFER BANCAR");
    expect(t).toContain("Chitanța o primești în Plățile mele");
  });

  test("indexul contorului se transmite cu poza si ecranul confirma", async ({ page }) => {
    /* Ap. 3 nu a transmis inca indexul in datele demo, deci formularul e deschis */
    await intraDemo(page, CONTURI.ilie);
    await mergiLaTab(page, "Contoare");
    for (const eticheta of [/^Apa rece, index anterior /, /^Apa caldă, index anterior /]) {
      const camp = page.getByLabel(eticheta);
      const anterior = Number((await camp.getAttribute("placeholder")).replace(",", "."));
      await camp.fill(String(anterior + 6));
    }
    await page.setInputFiles("input[type=file]", fisierPoza("contor.jpg"));
    await buton(page, "Trimite indexul").click();
    await expect(page.getByText("Indexul a fost trimis administratorului")).toBeVisible({ timeout: 25000 });
    await expect(page.getByText(/Indexul pe septembrie a ajuns la administrator/)).toBeVisible();
    await ecranSanatos(page, 200);
  });

  test("sesizarea noua, raspunsul si votul merg pana la capat", async ({ page }) => {
    await intraDemo(page, CONTURI.elena);
    await mergiLaTab(page, "Sesizări");
    await buton(page, "Sesizare nouă").click();
    await buton(page, "Bec ars pe scară").click();
    await buton(page, "Trimite sesizarea").click();
    await expect(page.getByText(/Sesizarea a ajuns la administrator/)).toBeVisible({ timeout: 25000 });
    await expect(page.getByText("Bec ars pe scară").first()).toBeVisible();

    await page.getByRole("textbox", { name: "Adaugă un mesaj pentru administrator" }).first()
      .fill("Becul de la etajul 2, va rog.");
    await buton(page, "Trimite").first().click();
    await expect(page.getByText("Becul de la etajul 2, va rog.")).toBeVisible({ timeout: 25000 });

    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Vot și adunare", exact: true }).click();
    const t = await ecranSanatos(page, 150);
    expect(t).toMatch(/vot|adunare/i);
  });
});

test.describe("administratorul duce la capat o luna intreaga, fara server", () => {
  test("factura noua, previzualizare, publicare si cele doua PDF-uri", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);

    /* [K6] Lista nu se publica peste citiri trimise: administratorul le
       verifica intai, apartament cu apartament, ca in aplicatia reala */
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    const valideaza = page.getByRole("button", { name: "Valideaza", exact: true });
    for (let ramase = await valideaza.count(); ramase > 0; ramase -= 1) {
      await valideaza.first().click();
      await expect(valideaza).toHaveCount(ramase - 1, { timeout: 15000 });
    }

    await mergiLaTab(page, "Facturi");
    await expect(page.getByText(/în lucru/i).first()).toBeVisible();

    await buton(page, "Adaugă factură").click();
    const panou = page.getByRole("dialog", { name: "Factură nouă" });
    await panou.getByLabel("Sau scrie un furnizor nou").fill("Demo Curățenie SRL");
    await panou.getByLabel("Ce cheltuială este").fill("Demo curățenie");
    await panou.getByLabel("Suma facturii").fill("600");
    await panou.getByLabel("Cum se împarte").selectOption("apartamente");
    await panou.getByLabel("Serie și număr factură").fill("DEMO-1");
    await buton(page, "Salvează factura").click();
    await expect(panou).toBeHidden({ timeout: 25000 });
    await expect(page.getByText("Demo curățenie", { exact: true })).toBeVisible();

    await buton(page, "Calculează lista pe apartamente").click();
    await expect(page.getByText("Total repartizat")).toBeVisible({ timeout: 25000 });
    const previz = await ecranSanatos(page, 400);
    expect(previz).toContain("Total facturi");

    await buton(page, "Publică lista").click();
    await expect(page.getByRole("dialog", { name: "Publică lista" })).toContainText("Termenul de plată va fi");
    await buton(page, "Da, publică lista").click();
    await expect(page.getByText(/Lista a fost publicată/)).toBeVisible({ timeout: 25000 });

    const publicata = await ecranSanatos(page, 300);
    expect(publicata).toContain("Nealocat");
    expect(publicata).toMatch(/Nealocat\s*0,00/);

    const avizier = await descarcaDemo(page, () => buton(page, "Exportă PDF pentru avizier").click());
    const textAvizier = textPdf(avizier.octeti);
    expect(textAvizier).toContain("Lista de plata pe");
    expect(textAvizier).toContain("Demo curatenie");
    expect(textAvizier).not.toMatch(/NaN|undefined|Invalid/);

    const intern = await descarcaDemo(page, () => buton(page, "Exportă lista internă (uz administrativ)").click());
    expect(textPdf(intern.octeti)).toContain("Document intern");
  });

  test("fisa apartamentului: incasare, chitanta, cont de locatar si corectie", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 3", exact: true }).click();
    const fisa = page.getByRole("dialog", { name: "Apartament 3" });
    await ecranSanatos(page, 300);

    await buton(page, "Înregistrează încasare cash").click();
    await page.getByLabel("Suma primită").fill("100");
    await buton(page, "Emite chitanța").click();
    await expect(fisa.getByText(/Încasare înregistrată/)).toBeVisible({ timeout: 25000 });
    const chitanta = await descarcaDemo(page, () => buton(page, "Descarcă chitanța").click());
    expect(textPdf(chitanta.octeti)).toContain("CHITANTA");

    await buton(page, "Adaugă un locatar în aplicație").click();
    await page.getByLabel("Numele locatarului").fill("Vecin Nou");
    await page.getByLabel("Numărul lui de telefon").fill("0798 100 200");
    await buton(page, "Fă contul").click();
    await expect(fisa.getByText("Intră cu numărul 0798 100 200")).toBeVisible();
    await expect(fisa.getByText(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/)).toBeVisible();
    await buton(page, "Gata").click();

    await buton(page, "Corectează datele apartamentului").click();
    await page.getByLabel("Proprietar").fill("Familia Ilie și fiul");
    await buton(page, "Salvează corecția").click();
    await expect(page.getByText(/Fișa apartamentului a fost actualizată/)).toBeVisible({ timeout: 25000 });
    await expect(fisa.getByText("Familia Ilie și fiul")).toBeVisible();
  });

  test("citirile se valideaza si se resping, iar refuzurile sunt pe romaneste", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    await ecranSanatos(page, 400);

    await buton(page, "Valideaza").first().click();
    await expect(page.getByText(/Citirea a fost validată/)).toBeVisible({ timeout: 25000 });

    await buton(page, "Respinge").first().click();
    await page.getByRole("button", { name: "Poza este neclară, nu se văd cifrele." }).click();
    await buton(page, "Respinge citirea").click();
    await expect(page.getByText(/Citirea a fost respinsă/)).toBeVisible({ timeout: 25000 });

    /* Estimarea: raspunsul este explicat, nu un buton mort. Modul demonstrativ
       merge pe ceasul real, deci inainte de termenul de citire estimarea este
       refuzata, iar dupa el chiar se poate face -- amandoua sunt raspunsuri
       cinstite, si amandoua trebuie sa fie pe romaneste. */
    page.once("dialog", (d) => d.accept());
    await buton(page, "Estimează citirile lipsă").click();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 25000 });
    const raspuns = await page.locator(".ab-toast").innerText();
    expect(raspuns).toMatch(/Nu poti estima inainte de termenul de citire|Au fost estimate \d+ citiri/);
    for (const cuvant of CUVINTE_TEHNICE) expect(raspuns).not.toContain(cuvant);
    await ecranSanatos(page, 300);
  });

  test("fondul primeste o iesire cu document, iar soldul scade pe loc", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Fonduri", exact: true }).click();
    await buton(page, "Înregistrează o ieșire").first().click();
    await page.getByLabel("Suma ieșită").fill("250");
    await page.getByLabel("Pentru ce").fill("Demo reparație interfon");
    await page.setInputFiles("input[type=file]", fisierPoza("deviz.jpg"));
    await buton(page, "Înregistrează ieșirea").click();
    await expect(page.getByText(/Ieșirea din fond a fost înregistrată/)).toBeVisible({ timeout: 25000 });
    const t = await ecranSanatos(page, 300);
    expect(t).toContain("Demo reparație interfon");
    expect(t).toContain("-250,00");
  });

  test("comunicarea: anunt, vot, adunare si un act incarcat", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Comunicare");
    await buton(page, "Scrie un anunț").click();
    await page.getByLabel("Titlu").fill("Demo: apa oprita marti");
    await page.getByLabel("Continut").fill("Marti între 9 și 14 se opreste apa pe toată scară.");
    await buton(page, "Publică anunțul").click();
    await expect(page.getByText(/Anunț publicat la avizier/)).toBeVisible({ timeout: 25000 });
    await expect(page.getByText("Demo: apa oprita marti")).toBeVisible();

    await page.getByRole("button", { name: "Vot și AG", exact: true }).click();
    await ecranSanatos(page, 150);

    await page.getByRole("button", { name: "Acte", exact: true }).click();
    await ecranSanatos(page, 100);
  });

  test("sesizarile se preiau, primesc raspuns si se inchid", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Sesizări");
    await ecranSanatos(page, 200);
    await page.getByRole("button", { name: /Bec ars/ }).first().click();
    await page.getByRole("textbox", { name: /răspuns|mesaj/i }).first().fill("Am cumparat becul, îl schimbam maine.");
    await buton(page, "Trimite răspunsul").click();
    await expect(page.getByText("Am cumparat becul, îl schimbam maine.")).toBeVisible({ timeout: 25000 });
    await buton(page, "Marchează rezolvată").click();
    await expect(page.getByText(/rezolvată/i).first()).toBeVisible({ timeout: 25000 });
    await ecranSanatos(page, 200);
  });
});
