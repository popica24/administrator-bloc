/* Modul demonstrativ, pe care nu-l atinge niciun alt test end-to-end.

   Fara `.env.local`, aplicatia ruleaza intreaga in browser, pe `sursa-mock.js`,
   care rejoaca `src/date-demo.js`. Baza Supabase locala a fost semanata din
   aceleasi date, prin comenzile reale (`npm run seed`). Regula proiectului este
   ca ambele surse arata aceleasi cifre si refuza aceleasi lucruri, deci fiecare
   test de aici pune ecranele fata in fata.

   Serverul de demonstratie si-l porneste fisierul singur, pe alt port, cu cele
   doua variabile golite: variabilele din mediu au prioritate fata de
   `.env.local`, deci `sursa.js` alege mock-ul.

   Comparatia cere date demo neatinse: modul demonstrativ porneste de fiecare
   data de la zero, baza pastreaza tot ce au facut testele dinainte. De aceea
   fisierul se numeste "z-d", ca sa ruleze imediat dupa `z-ciclu-luna`, care
   reface baza cu `supabase db reset && npm run seed`, si se parcurge o singura
   data, pe proiectul "telefon". */

import { spawn } from "node:child_process";
import { test, expect } from "@playwright/test";
import { PAROLA, CONTURI, buton, mergiLaTab } from "./ajutor.js";

const PORT_DEMO = 5174;
const DEMO = `http://localhost:${PORT_DEMO}`;
const REAL = "http://localhost:5173";

let server = null;

async function raspunde(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

test.beforeAll(async ({ browserName }, testInfo) => {
  void browserName;
  test.skip(testInfo.project.name !== "telefon", "se parcurge o singura data, pe date demo proaspete");
  if (await raspunde(DEMO)) return;
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT_DEMO), "--strictPort"], {
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

async function intraPe(page, baza, email) {
  await page.goto(`${baza}/`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Parola").fill(PAROLA);
  await page.getByRole("button", { name: "Intra", exact: true }).click();
  await expect(page.getByRole("button", { name: "Iesi", exact: true })).toBeVisible({ timeout: 25000 });
}

/* Cine a deschis ce nu este o cifra a asociatiei: modul demonstrativ porneste
   mereu de la zero, iar baza tine minte ce au citit rularile dinainte. Badge-ul
   "NOU" si randul "Citit de N din M" ies din comparatie; tot restul ramane. */
const ecran = async (page) => (await page.locator(".ab-shell > .ab-scroll").innerText())
  .split("\n")
  .filter((r) => r.trim() !== "NOU" && !/^Citit de \d+ din \d+/.test(r.trim()))
  .join("\n");

/* Aceeasi plimbare prin aplicatie, pe o sursa sau pe cealalta */
async function plimbare(page, baza, email, pasi) {
  await intraPe(page, baza, email);
  const rezultat = {};
  for (const [nume, pas] of Object.entries(pasi)) {
    await pas(page);
    await page.waitForTimeout(600);
    rezultat[nume] = (await ecran(page)).trim();
  }
  return rezultat;
}

/* Cifrele sunt inima paritatii: sume in lei, metri cubi, procente, numere de
   zile. Textul din jur poate diferi cu un spatiu, cifrele nu au voie. */
const cifre = (text) => text.match(/\d[\d.]*(,\d+)?/g) || [];

async function comparaPlimbarea(browser, email, pasi) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const supabase = await plimbare(await ctxA.newPage(), REAL, email, pasi);
    const demo = await plimbare(await ctxB.newPage(), DEMO, email, pasi);
    for (const nume of Object.keys(pasi)) {
      expect(demo[nume], `textul ecranului "${nume}"`).toBe(supabase[nume]);
      expect(cifre(demo[nume]), `cifrele ecranului "${nume}"`).toEqual(cifre(supabase[nume]));
    }
    return { supabase, demo };
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
}

test.describe("aceleasi cifre in ambele surse", () => {
  test("locatarul cu lista de plata: Acasa, Plata, Contoare, Bloc", async ({ browser }) => {
    await comparaPlimbarea(browser, CONTURI.elena, {
      acasa: async () => {},
      plata: (p) => mergiLaTab(p, "Plata"),
      platileMele: async (p) => { await p.getByRole("button", { name: "Platile mele" }).click(); },
      contoare: (p) => mergiLaTab(p, "Contoare"),
      bloc: (p) => mergiLaTab(p, "Bloc"),
    });
  });

  /* [R2] Repartizarea apei imparte diferenta pe coloana cu `distribuieExact`,
     iar sutimile ramase merg "in ordinea din lista" (motor.js:53). Cele doua
     surse dau apartamentele motorului in ordini diferite, deci acelasi banut
     ajunge la alt apartament: pe Supabase, apartamentul 3 are pe august
     821,84 lei si un sold de 2.319,29; in modul demonstrativ, aceleasi date
     dau 821,91 si 2.319,36. Aceeasi lista publicata, alte cifre pe ecran. */
  test.fixme("[R2] restantierul: acelasi sold, aceleasi penalizari, aceleasi zile", async ({ browser }) => {
    await comparaPlimbarea(browser, CONTURI.ilie, {
      acasa: async () => {},
      plata: (p) => mergiLaTab(p, "Plata"),
      platileMele: async (p) => { await p.getByRole("button", { name: "Platile mele" }).click(); },
    });
  });

  /* [R2] Acelasi banut, vazut de la nivelul blocului: "Restantele blocului
     sunt 7.013,73 lei" pe Supabase, 7.013,65 in modul demonstrativ. */
  test.fixme("[R2] situatia blocului de la Fonduri arata acelasi total", async ({ browser }) => {
    await comparaPlimbarea(browser, CONTURI.elena, {
      bloc: (p) => mergiLaTab(p, "Bloc"),
      fonduri: async (p) => { await p.getByRole("button", { name: "Fonduri" }).click(); },
    });
  });

  test("locatarul scutit de lift: randul de lift este 0 in ambele surse", async ({ browser }) => {
    const { demo } = await comparaPlimbarea(browser, CONTURI.voicu, {
      plata: (p) => mergiLaTab(p, "Plata"),
    });
    expect(demo.plata).toMatch(/scutit de lift/i);
  });

  test("administratorul: Facturi si Comunicare", async ({ browser }) => {
    await comparaPlimbarea(browser, CONTURI.admin, {
      facturi: (p) => mergiLaTab(p, "Facturi"),
      comunicare: (p) => mergiLaTab(p, "Comunicare"),
    });
  });

  /* [R2] Acelasi banut al apei, ajuns pe ecranele administratorului: totalul
     restantelor blocului si trei apartamente au alte cifre in cele doua surse
     (ap. 3: 821,84 / 821,91; ap. 11: 1.021,96 / 1.021,97; ap. 15: 870,82 /
     870,74; restante bloc: 7.013,73 / 7.013,65). */
  test.fixme("[R2] administratorul vede acelasi Sumar si aceleasi fise", async ({ browser }) => {
    await comparaPlimbarea(browser, CONTURI.admin, {
      sumar: async () => {},
      apartamente: (p) => mergiLaTab(p, "Apartamente"),
    });
  });
});

test.describe("aceleasi refuzuri in ambele surse", () => {
  /* Fiecare refuz se cere pe amandoua sursele si se compara mesajul vazut de om */
  async function refuzul(browser, baza, email, actiune) {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await intraPe(page, baza, email);
      return await actiune(page);
    } finally {
      await ctx.close();
    }
  }

  async function amandoua(browser, email, actiune) {
    const a = await refuzul(browser, REAL, email, actiune);
    const b = await refuzul(browser, DEMO, email, actiune);
    expect(b, "mesajul de refuz").toBe(a);
    return a;
  }

  test("cardul cu numar prea scurt nu se poate trimite, pe nicio sursa", async ({ browser }) => {
    const stare = await amandoua(browser, CONTURI.elena, async (page) => {
      await buton(page, "Plateste acum").click();
      const panou = page.getByRole("dialog", { name: "Plata cu cardul" });
      await panou.getByLabel("Numarul cardului").fill("4242 4242 42");
      await panou.getByLabel("Expira").fill("12/30");
      await panou.getByLabel("Cod CVC").fill("123");
      await panou.getByLabel("Numele de pe card").fill("ELENA MARINESCU");
      const plateste = panou.getByRole("button", { name: /^Plateste / });
      return await plateste.getAttribute("aria-disabled");
    });
    expect(stare, "butonul de plata ramane blocat").toBe("true");
  });

  test("indexul mai mic decat cel anterior primeste acelasi mesaj", async ({ browser }) => {
    const mesaj = await amandoua(browser, CONTURI.elena, async (page) => {
      await mergiLaTab(page, "Contoare");
      await page.getByLabel(/^Apa rece, index anterior /).fill("1");
      await page.waitForTimeout(300);
      const t = await page.locator(".ab-shell > .ab-scroll").innerText();
      const blocat = await buton(page, "Trimite indexul").getAttribute("aria-disabled");
      return `${blocat} | ${(t.match(/Indexul nou[^\n]*/) || [""])[0]}`;
    });
    expect(mesaj).toContain("nu poate fi mai mic");
    expect(mesaj.startsWith("true")).toBe(true);
  });

  test("sesizarea fara titlu nu se poate trimite, pe nicio sursa", async ({ browser }) => {
    const stare = await amandoua(browser, CONTURI.elena, async (page) => {
      await mergiLaTab(page, "Sesizari");
      await page.getByRole("button", { name: "Sesizare noua" }).click();
      const trimite = page.getByRole("button", { name: /^Trimite sesizarea/ });
      return await trimite.first().getAttribute("aria-disabled");
    });
    expect(stare).toBe("true");
  });

  test("lista in lucru se calculeaza la fel inainte de publicare", async ({ browser }) => {
    await comparaPlimbarea(browser, CONTURI.admin, {
      previzualizare: async (p) => {
        await mergiLaTab(p, "Facturi");
        const calculeaza = buton(p, "Calculeaza lista pe apartamente");
        if (await calculeaza.count()) await calculeaza.click();
        await p.waitForTimeout(2500);
      },
    });
  });
});
