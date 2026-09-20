/* Modul demonstrativ ca produs, nu ca oglinda a bazei.

   `z-demo-paritate` compara cifrele celor doua surse. Aici intrebarea e alta:
   cineva deschide aplicatia fara niciun server — un administrator care o
   incearca seara, acasa — si trebuie sa poata duce la capat tot ce duce la
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
    if (Date.now() - pornire > 60000) throw new Error("Serverul modului demonstrativ nu porneste");
    await new Promise((r) => setTimeout(r, 400));
  }
});

test.afterAll(() => {
  if (server) server.kill("SIGTERM");
  server = null;
});

async function intraDemo(page, email) {
  await page.goto(`${DEMO}/`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Parola").fill(PAROLA);
  await page.getByRole("button", { name: "Intra", exact: true }).click();
  await expect(page.getByRole("button", { name: "Iesi", exact: true })).toBeVisible({ timeout: 25000 });
}

/* Ecranul de fata nu are voie sa fie gol si nu are voie sa vorbeasca tehnic */
async function ecranSanatos(page, minimCaractere = 120) {
  const t = await textEcran(page);
  expect(t.length, `ecran prea gol:\n${t}`).toBeGreaterThan(minimCaractere);
  for (const cuvant of CUVINTE_TEHNICE) expect(t, `ecranul contine "${cuvant}"`).not.toContain(cuvant);
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
    for (const tabul of ["Plata", "Contoare", "Sesizari", "Bloc"]) {
      await mergiLaTab(page, tabul);
      await ecranSanatos(page, 200);
    }
    /* Subtaburile au si ele continut, nu doar titlu */
    for (const sub of ["Vot si adunare", "Acte", "Fonduri"]) {
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
    expect(t).toContain("Pret pe metru cub");
    expect(t).toContain("Consumul apartamentului");
  });

  test("plata cu cardul merge pana la chitanta descarcata", async ({ page }) => {
    await intraDemo(page, CONTURI.elena);
    await mergiLaTab(page, "Plata");
    const buton1 = page.getByRole("button", { name: /^Plateste [\d.,]+ lei cu cardul$/ });
    await expect(buton1).toBeVisible();
    const eticheta = await buton1.innerText();
    const suma = eticheta.replace("Plateste ", "").replace(" cu cardul", "");
    await buton1.click();
    await page.getByLabel("Numarul cardului").fill("4242424242424242");
    await page.getByLabel("Expira").fill("12/30");
    await page.getByLabel("Cod CVC").fill("123");
    await page.getByLabel("Numele de pe card").fill("ELENA MARINESCU");
    await buton(page, `Plateste ${suma}`).click();
    await expect(page.getByText("Plata a reusit")).toBeVisible({ timeout: 25000 });
    await expect(page.getByText(/Chitanta [A-Z0-9]+ nr\. \d{6} a fost emisa/)).toBeVisible();

    const chitanta = await descarcaDemo(page, () => buton(page, "Descarca chitanta").first().click());
    const textul = textPdf(chitanta.octeti);
    expect(textul).toContain("CHITANTA");
    expect(textul).toContain("Am primit de la");
    expect(textul).not.toMatch(/NaN|undefined|Invalid/);

    await buton(page, "Gata").click();
    /* Soldul s-a stins pe loc, in memorie */
    await ecranSanatos(page, 200);
    await mergiLaTab(page, "Acasa");
    await expect(page.getByText("Achitat").first()).toBeVisible();
  });

  test("cardul refuzat de banca spune ce s-a intamplat, fara jargon", async ({ page }) => {
    await intraDemo(page, CONTURI.elena);
    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: /^Plateste [\d.,]+ lei cu cardul$/ }).click();
    await page.getByLabel("Numarul cardului").fill("4000000000000002");
    await page.getByLabel("Expira").fill("12/30");
    await page.getByLabel("Cod CVC").fill("123");
    await page.getByLabel("Numele de pe card").fill("ELENA MARINESCU");
    await page.getByRole("button", { name: /^Plateste [\d.,]+ lei$/ }).click();
    await expect(page.getByRole("dialog", { name: "Plata cu cardul" }).getByText(/Banca a refuzat plata/)).toBeVisible({ timeout: 25000 });
    await ecranSanatos(page, 200);
  });

  test("indexul contorului se transmite cu poza si ecranul confirma", async ({ page }) => {
    /* Ap. 3 nu a transmis inca indexul in datele demo, deci formularul e deschis */
    await intraDemo(page, CONTURI.ilie);
    await mergiLaTab(page, "Contoare");
    for (const eticheta of [/^Apa rece, index anterior /, /^Apa calda, index anterior /]) {
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
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await buton(page, "Bec ars pe scara").click();
    await buton(page, "Trimite sesizarea").click();
    await expect(page.getByText(/Sesizarea a ajuns la administrator/)).toBeVisible({ timeout: 25000 });
    await expect(page.getByText("Bec ars pe scara").first()).toBeVisible();

    await page.getByRole("textbox", { name: "Adauga un mesaj pentru administrator" }).first()
      .fill("Becul de la etajul 2, va rog.");
    await buton(page, "Trimite").first().click();
    await expect(page.getByText("Becul de la etajul 2, va rog.")).toBeVisible({ timeout: 25000 });

    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Vot si adunare", exact: true }).click();
    const t = await ecranSanatos(page, 150);
    expect(t).toMatch(/vot|adunare/i);
  });
});

test.describe("administratorul duce la capat o luna intreaga, fara server", () => {
  test("factura noua, previzualizare, publicare si cele doua PDF-uri", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Facturi");
    await expect(page.getByText(/in lucru/i).first()).toBeVisible();

    await buton(page, "Adauga factura").click();
    const panou = page.getByRole("dialog", { name: "Factura noua" });
    await panou.getByLabel("Sau scrie un furnizor nou").fill("Demo Curatenie SRL");
    await panou.getByLabel("Ce cheltuiala este").fill("Demo curatenie");
    await panou.getByLabel("Suma facturii").fill("600");
    await panou.getByLabel("Cum se imparte").selectOption("apartamente");
    await panou.getByLabel("Serie si numar factura").fill("DEMO-1");
    await buton(page, "Salveaza factura").click();
    await expect(panou).toBeHidden({ timeout: 25000 });
    await expect(page.getByText("Demo curatenie", { exact: true })).toBeVisible();

    await buton(page, "Calculeaza lista pe apartamente").click();
    await expect(page.getByText("Total repartizat")).toBeVisible({ timeout: 25000 });
    const previz = await ecranSanatos(page, 400);
    expect(previz).toContain("Total facturi");

    await buton(page, "Publica lista").click();
    await expect(page.getByRole("dialog", { name: "Publica lista" })).toContainText("Termenul de plata va fi");
    await buton(page, "Da, publica lista").click();
    await expect(page.getByText(/Lista a fost publicata/)).toBeVisible({ timeout: 25000 });

    const publicata = await ecranSanatos(page, 300);
    expect(publicata).toContain("Nealocat");
    expect(publicata).toMatch(/Nealocat\s*0,00/);

    const avizier = await descarcaDemo(page, () => buton(page, "Exporta PDF pentru avizier").click());
    const textAvizier = textPdf(avizier.octeti);
    expect(textAvizier).toContain("Lista de plata pe");
    expect(textAvizier).toContain("Demo curatenie");
    expect(textAvizier).not.toMatch(/NaN|undefined|Invalid/);

    const intern = await descarcaDemo(page, () => buton(page, "Exporta lista interna (uz administrativ)").click());
    expect(textPdf(intern.octeti)).toContain("Document intern");
  });

  test("fisa apartamentului: incasare, chitanta, cod de invitatie si corectie", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 3", exact: true }).click();
    const fisa = page.getByRole("dialog", { name: "Apartament 3" });
    await ecranSanatos(page, 300);

    await buton(page, "Inregistreaza incasare cash").click();
    await page.getByLabel("Suma primita").fill("100");
    await buton(page, "Emite chitanta").click();
    await expect(fisa.getByText(/Incasare inregistrata/)).toBeVisible({ timeout: 25000 });
    const chitanta = await descarcaDemo(page, () => buton(page, "Descarca chitanta").click());
    expect(textPdf(chitanta.octeti)).toContain("CHITANTA");

    await buton(page, "Invita un locatar in aplicatie").click();
    await buton(page, "Genereaza codul").click();
    await expect(fisa.getByText(/^[A-Z2-9]{8}$/)).toBeVisible();
    await buton(page, "Gata").click();

    await buton(page, "Corecteaza datele apartamentului").click();
    await page.getByLabel("Proprietar").fill("Familia Ilie si fiul");
    await buton(page, "Salveaza corectia").click();
    await expect(page.getByText(/Fisa apartamentului a fost actualizata/)).toBeVisible({ timeout: 25000 });
    await expect(fisa.getByText("Familia Ilie si fiul")).toBeVisible();
  });

  test("citirile se valideaza si se resping, iar refuzurile sunt pe romaneste", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    await ecranSanatos(page, 400);

    await buton(page, "Valideaza").first().click();
    await expect(page.getByText(/Citirea a fost validata/)).toBeVisible({ timeout: 25000 });

    await buton(page, "Respinge").first().click();
    await page.getByRole("button", { name: "Poza este neclara, nu se vad cifrele." }).click();
    await buton(page, "Respinge citirea").click();
    await expect(page.getByText(/Citirea a fost respinsa/)).toBeVisible({ timeout: 25000 });

    /* Estimarea inainte de termen: refuz explicat, nu un buton mort */
    page.once("dialog", (d) => d.accept());
    await buton(page, "Estimeaza citirile lipsa").click();
    await expect(page.getByText(/Nu poti estima inainte de termenul de citire/)).toBeVisible({ timeout: 25000 });
    await ecranSanatos(page, 300);
  });

  test("fondul primeste o iesire cu document, iar soldul scade pe loc", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Fonduri", exact: true }).click();
    await buton(page, "Inregistreaza o iesire").first().click();
    await page.getByLabel("Suma iesita").fill("250");
    await page.getByLabel("Pentru ce").fill("Demo reparatie interfon");
    await page.setInputFiles("input[type=file]", fisierPoza("deviz.jpg"));
    await buton(page, "Inregistreaza iesirea").click();
    await expect(page.getByText(/Iesirea din fond a fost inregistrata/)).toBeVisible({ timeout: 25000 });
    const t = await ecranSanatos(page, 300);
    expect(t).toContain("Demo reparatie interfon");
    expect(t).toContain("-250,00");
  });

  test("comunicarea: anunt, vot, adunare si un act incarcat", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Comunicare");
    await buton(page, "Scrie un anunt").click();
    await page.getByLabel("Titlu").fill("Demo: apa oprita marti");
    await page.getByLabel("Continut").fill("Marti intre 9 si 14 se opreste apa pe toata scara.");
    await buton(page, "Publica anuntul").click();
    await expect(page.getByText(/Anunt publicat la avizier/)).toBeVisible({ timeout: 25000 });
    await expect(page.getByText("Demo: apa oprita marti")).toBeVisible();

    await page.getByRole("button", { name: "Vot si AG", exact: true }).click();
    await ecranSanatos(page, 150);

    await page.getByRole("button", { name: "Acte", exact: true }).click();
    await ecranSanatos(page, 100);
  });

  test("sesizarile se preiau, primesc raspuns si se inchid", async ({ page }) => {
    await intraDemo(page, CONTURI.admin);
    await mergiLaTab(page, "Sesizari");
    await ecranSanatos(page, 200);
    await page.getByRole("button", { name: /Bec ars/ }).first().click();
    await page.getByRole("textbox", { name: /raspuns|mesaj/i }).first().fill("Am cumparat becul, il schimbam maine.");
    await buton(page, "Trimite raspunsul").click();
    await expect(page.getByText("Am cumparat becul, il schimbam maine.")).toBeVisible({ timeout: 25000 });
    await buton(page, "Marcheaza rezolvata").click();
    await expect(page.getByText(/rezolvata/i).first()).toBeVisible({ timeout: 25000 });
    await ecranSanatos(page, 200);
  });
});
