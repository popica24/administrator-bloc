/* Al doilea an al unui bloc: decembrie 2026 → ianuarie 2027.

   Ciclul unei luni (`z-ciclu-luna`) si doua luni la rand (`zz-doua-luni`)
   raman inainte de granita de an. Aici blocul trece dintr-un an in altul si se
   verifica exact ce se poate strica la trecere: luna urmatoare lui decembrie,
   termenul de plata din alt an, penalizarile calculate peste 31 decembrie,
   seria de chitante care continua (nu se reia de la 1), o corectie in anul nou
   si cuvintele lunilor si ale datelor peste tot unde apar, inclusiv in PDF-uri.

   Testul publica cinci liste ale blocului demo, deci strica datele
   demonstrative: ruleaza o singura data, pe proiectul "telefon", si la final
   readuce baza la starea initiala. Numele "zzz-" il aseaza ultimul. */

import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, serviciu, blocD14, apartamente, apartamentulNumarul,
  asteaptaToast, textEcran, CUVINTE_TEHNICE, listaLunara, soldApartament, uitaCache,
  descarca, textPdf, CONTURI, profilDupaEmail, URL_SUPABASE, CHEIE_SERVICIU, verificaCitirileLunii,
} from "./ajutor.js";

const lei = (n) => Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d),)/g, ".");

/* Lunile de trecut, cu data reala a publicarii fiecareia */
const DINAINTE = [
  { luna: "2026-09-01", publicata: "2026-09-27T18:00:00+03:00" },
  { luna: "2026-10-01", publicata: "2026-10-27T18:00:00+03:00" },
  { luna: "2026-11-01", publicata: "2026-11-27T18:00:00+02:00" },
];

let BLOC;
let APARTAMENTE;
let FURNIZOR;
const LISTE = {};

async function ok(promisiune, ce) {
  const { data, error } = await promisiune;
  if (error) throw new Error(`${ce}: ${error.message}`);
  return data;
}

async function publicaPrinFunctie(listaId, publicataLa, recalculare = false) {
  const r = await fetch(`${URL_SUPABASE}/functions/v1/publica-lista`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHEIE_SERVICIU}` },
    body: JSON.stringify({ lista_id: listaId, publicata_la: publicataLa, recalculare }),
  });
  expect(r.status, await r.clone().text()).toBe(200);
  return r.json();
}

/* Doua cheltuieli simple, fara apa: apa cere citiri pe fiecare luna si ciclul
   ei e parcurs deja in alta parte. */
async function adaugaFacturile(listaId, eticheta) {
  await ok(serviciu().schema("intretinere").from("cheltuieli").insert([
    { lista_id: listaId, tip: "factura", cod: "C50", categorie: `E2E an ${eticheta} salubritate`, furnizor_id: FURNIZOR, suma: 900, metoda: "persoane", serie_numar: `E2E-AN-${eticheta}-1` },
    { lista_id: listaId, tip: "factura", cod: "C51", categorie: `E2E an ${eticheta} curatenie`, furnizor_id: FURNIZOR, suma: 600, metoda: "apartamente", serie_numar: `E2E-AN-${eticheta}-2` },
  ]), `facturile lunii ${eticheta}`);
}

test.describe("granita dintre ani: decembrie 2026 → ianuarie 2027", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browserName }, testInfo) => {
    void browserName;
    test.skip(testInfo.project.name !== "telefon", "se parcurge o singura data");
    BLOC = await blocD14();
    APARTAMENTE = await apartamente();
    FURNIZOR = (await ok(serviciu().schema("intretinere").from("furnizori").insert({
      asociatie_id: BLOC.asociatie_id, denumire: "E2E Furnizor an nou",
      categorie_implicita: "Test", metoda_implicita: "apartamente", cod_implicit: "C50",
    }).select("id").single(), "furnizor")).id;

    /* Septembrie, octombrie si noiembrie se publica pe scurtatura, prin
       comenzile reale: interesul testului incepe la decembrie. */
    for (const l of DINAINTE) {
      const id = await ok(serviciu().schema("intretinere").rpc("deschide_lista", { p_bloc_id: BLOC.id, p_luna: l.luna }), `deschide ${l.luna}`);
      LISTE[l.luna] = id;
      await adaugaFacturile(id, l.luna.slice(0, 7));
      await verificaCitirileLunii(BLOC.id, l.luna);
      await publicaPrinFunctie(id, l.publicata);
    }
  });

  test.afterAll(async ({ browserName }, testInfo) => {
    void browserName;
    if (testInfo.project.name !== "telefon") return;
    execSync("supabase db reset && npm run seed", { cwd: process.cwd(), stdio: "pipe", timeout: 600000 });
    uitaCache();
  });

  test("1. dupa decembrie, aplicatia propune ianuarie anul urmator", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");

    /* Lista lunii decembrie se incepe din ecran */
    await expect(page.getByText("Lista pe decembrie 2026 nu este inceputa")).toBeVisible({ timeout: 20000 });
    await buton(page, "Incepe lista pe decembrie 2026").click();
    await asteaptaToast(page, "Lista");
    await expect(page.getByText("DECEMBRIE 2026 · IN LUCRU")).toBeVisible({ timeout: 20000 });

    LISTE["2026-12-01"] = (await listaLunara({ stare: "ciorna" })).id;
    expect((await listaLunara({ stare: "ciorna" })).luna).toBe("2026-12-01");

    const t = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
    /* Nicaieri "luna 13", "2026-13" sau o luna fara nume */
    expect(t).not.toMatch(/2026-1[3-9]|luna 13|undefined 202/);
  });

  test("2. lista pe decembrie are termen de plata in anul urmator", async ({ page }) => {
    await adaugaFacturile(LISTE["2026-12-01"], "decembrie");

    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Calculeaza lista pe apartamente").click();
    await expect(page.getByText("Total repartizat")).toBeVisible({ timeout: 20000 });

    await buton(page, "Publica lista").click();
    const panou = page.getByRole("dialog", { name: "Publica lista" });
    await expect(panou).toContainText("Publici lista pe decembrie 2026");
    /* Granita: scadenta cade in ianuarie 2027, nu in ianuarie 2026 */
    await expect(panou).toContainText("Termenul de plata va fi 25 ianuarie 2027");
    await buton(page, "Da, publica lista").click();
    await asteaptaToast(page, "Lista a fost publicata");

    const lista = await listaLunara({ luna: "2026-12-01" });
    expect(lista.stare).toBe("publicata");
    expect(lista.scadenta).toBe("2027-01-25");

    /* Datoriile de intretinere ale lunii decembrie au si ele scadenta in 2027 */
    await expect.poll(async () => {
      const { count } = await serviciu().schema("financiar").from("datorii")
        .select("id", { count: "exact", head: true }).eq("lista_id", lista.id).eq("tip", "intretinere");
      return count;
    }, { timeout: 30000 }).toBe(APARTAMENTE.length);
    const { data: datorii } = await serviciu().schema("financiar").from("datorii")
      .select("scadenta, luna").eq("lista_id", lista.id).eq("tip", "intretinere");
    for (const d of datorii) {
      expect(d.scadenta).toBe("2027-01-25");
      expect(d.luna).toBe("2026-12-01");
    }
  });

  test("3. lista pe ianuarie 2027 se deschide, se publica si isi scrie anul", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await expect(page.getByText("Lista pe ianuarie 2027 nu este inceputa")).toBeVisible({ timeout: 20000 });
    await buton(page, "Incepe lista pe ianuarie 2027").click();
    await expect(page.getByText("IANUARIE 2027 · IN LUCRU")).toBeVisible({ timeout: 20000 });

    const ciorna = await listaLunara({ stare: "ciorna" });
    expect(ciorna.luna).toBe("2027-01-01");
    LISTE["2027-01-01"] = ciorna.id;
    await adaugaFacturile(ciorna.id, "ianuarie");

    await page.reload();
    await mergiLaTab(page, "Facturi");
    await buton(page, "Publica lista").click();
    const panou = page.getByRole("dialog", { name: "Publica lista" });
    await expect(panou).toContainText("Publici lista pe ianuarie 2027");
    await expect(panou).toContainText("Termenul de plata va fi 25 februarie 2027");
    await buton(page, "Da, publica lista").click();
    await asteaptaToast(page, "Lista a fost publicata");

    const lista = await listaLunara({ luna: "2027-01-01" });
    expect(lista.stare).toBe("publicata");
    expect(lista.scadenta).toBe("2027-02-25");

    /* Selectorul de luni are acum si 2027: fiecare luna isi poarta anul */
    const t = await textEcran(page);
    expect(t).toContain("IANUARIE 2027");
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("4. locatarul vede lunile amandurora anilor, cu anul scris", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await expect(page.getByText("TOTAL DE PLATA ACUM")).toBeVisible({ timeout: 20000 });

    /* Alegerea lunii: peste 4 liste publicate inseamna lista derulanta, si
       acolo fiecare luna se scrie cu anul ei. */
    const optiuni = await page.getByLabel("Luna").locator("option").allInnerTexts();
    expect(optiuni).toContain("ianuarie 2027");
    expect(optiuni).toContain("decembrie 2026");
    expect(optiuni.every((o) => /^[a-z]+ 20\d\d$/.test(o.trim())), `optiuni: ${optiuni.join("|")}`).toBe(true);

    const t = await textEcran(page);
    expect(t).toContain("Cheltuielile lunii ianuarie");
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);

    /* Graficul si istoricul: lunile scurte poarta si ele anul ("dec 26", "ian 27") */
    await page.getByRole("button", { name: "Platile mele" }).click();
    const istoric = await textEcran(page);
    expect(istoric).toContain("ian 27");
    expect(istoric).toContain("dec 26");
    expect(istoric).toContain("ianuarie 2027");
    expect(istoric).toContain("decembrie 2026");
    /* Fraza de comparatie leaga cele doua luni de peste granita */
    expect(istoric).toMatch(/Intretinerea pe ianuarie este .*Pe decembrie a fost/s);
    for (const cuvant of CUVINTE_TEHNICE) expect(istoric).not.toContain(cuvant);

    expect(await soldApartament(ap.id)).toBeGreaterThan(0);
  });

  test("5. seria de chitante continua in anul nou, fara sa se reia de la 1", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(5);
    const { data: inainte } = await sb.schema("financiar").from("chitante")
      .select("serie, numar").eq("asociatie_id", BLOC.asociatie_id)
      .order("numar", { ascending: false }).limit(1).single();

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: `Apartament ${ap.numar}`, exact: true }).click();
    await buton(page, "Inregistreaza incasare cash").click();
    await page.getByLabel("Suma primita").fill("40");
    await buton(page, "Emite chitanta").click();
    await asteaptaToast(page, "Incasare inregistrata, chitanta emisa");

    const { data: dupa } = await sb.schema("financiar").from("chitante")
      .select("serie, numar, emisa_la").eq("asociatie_id", BLOC.asociatie_id)
      .order("numar", { ascending: false }).limit(1).single();
    expect(dupa.serie).toBe(inainte.serie);
    expect(dupa.numar).toBe(inainte.numar + 1);

    /* Chitanta se vede pe ecran cu seria si numarul ei, nu cu un numar nou de an */
    await expect(page.getByText(new RegExp(`Chitanta ${dupa.serie} nr\\. 0*${dupa.numar}`))).toBeVisible();
  });

  test("6. penalizarile trecute peste 31 decembrie numara zilele corect", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(3);

    /* Jobul lunar, rulat luna de luna peste granita de an, exact cum il
       cheama cron-ul pe 1 ale lunii */
    for (const zi of ["2026-12-01", "2027-01-01", "2027-02-01"]) {
      const r = await fetch(`${URL_SUPABASE}/rest/v1/rpc/calculeaza_penalizari`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json", "Content-Profile": "financiar",
          apikey: CHEIE_SERVICIU, Authorization: `Bearer ${CHEIE_SERVICIU}`,
        },
        body: JSON.stringify({ p_la: zi }),
      });
      expect(r.status, await r.text()).toBe(200);
    }

    const { data: pen, error } = await sb.schema("financiar").from("penalizari")
      .select("suma, zile_taxate, zile_gratie, zile_intarziere, luna_calcul, datorie_sursa_id, d:datorii!penalizari_datorie_sursa_id_fkey!inner(apartament_id, suma, tip, scadenta)")
      .eq("d.apartament_id", ap.id);
    if (error) throw new Error(error.message);
    expect(pen.length).toBeGreaterThan(0);

    /* Nicio penalizare nu se plimba invers in timp si niciuna nu depaseste
       datoria pe care o taxeaza */
    for (const p of pen) {
      expect(Number(p.zile_taxate)).toBeGreaterThan(0);
      expect(Number(p.suma)).toBeLessThanOrEqual(Number(p.d.suma) + 0.001);
      expect(p.d.tip).not.toBe("penalizare");
    }

    /* Granita: pe o datorie taxata si in 2026 si in 2027, zilele taxate se
       leaga cap la cap peste 31 decembrie — nici o zi in plus, nici una
       sarita. */
    const peDatorie = {};
    for (const p of pen) (peDatorie[p.datorie_sursa_id] ||= []).push(p);
    const pesteAn = Object.values(peDatorie).filter((g) => {
      const start = new Date(`${g[0].d.scadenta}T00:00:00Z`).getTime() + Number(g[0].zile_gratie) * 86400000;
      return g.some((p) => String(p.luna_calcul) >= "2027-01-01") && start <= Date.parse("2026-12-31T00:00:00Z");
    });
    expect(pesteAn.length, "nicio datorie nu este taxata si in 2026 si in 2027").toBeGreaterThan(0);
    for (const g of pesteAn) {
      const start = new Date(`${g[0].d.scadenta}T00:00:00Z`).getTime() + Number(g[0].zile_gratie) * 86400000;
      const ultim = g.map((p) => String(p.luna_calcul)).sort().at(-1);
      const zileAsteptate = Math.round((Date.parse(`${ultim}T00:00:00Z`) - start) / 86400000);
      const zileTaxate = g.reduce((s, p) => s + Number(p.zile_taxate), 0);
      expect(zileTaxate, `zile taxate pe datoria ${g[0].datorie_sursa_id}`).toBe(zileAsteptate);
    }

    await intraCa(page, "ilie");
    await mergiLaTab(page, "Plata");
    const t = await textEcran(page);
    expect(t).toMatch(/Penalizare pentru intretinere/);
    expect(t).toMatch(/[\d.]+,\d\d × 0,02% × \d+ (de )?zile/);
    expect(t).not.toMatch(/× -\d+ (de )?zile|× 0 zile/);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("7. o corectie in anul nou ajunge la locatar cu luna ei scrisa corect", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(17);
    const lista = await listaLunara({ luna: "2027-01-01" });

    const { data: c } = await sb.schema("intretinere").from("cheltuieli")
      .select("id").eq("lista_id", lista.id).eq("categorie", "E2E an ianuarie salubritate").single();
    await sb.schema("intretinere").from("cheltuieli").update({ suma: 1200 }).eq("id", c.id);
    await publicaPrinFunctie(lista.id, null, true);

    await expect.poll(async () => {
      const { count } = await sb.schema("financiar").from("datorii")
        .select("id", { count: "exact", head: true })
        .eq("lista_id", lista.id).eq("tip", "corectie").eq("apartament_id", ap.id);
      return count;
    }, { timeout: 30000 }).toBe(1);

    const elena = await profilDupaEmail(CONTURI.elena);
    await expect.poll(async () => {
      const { data } = await sb.schema("comunicare").from("notificari")
        .select("titlu, corp").eq("profil_id", elena.id)
        .order("trimisa_la", { ascending: false }).limit(1);
      return `${((data || [])[0] || {}).titlu || ""} ${((data || [])[0] || {}).corp || ""}`;
    }, { timeout: 30000 }).toMatch(/ianuarie 2027/);

    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    const sold = await soldApartament(ap.id);
    const t = await textEcran(page);
    expect(t).toContain(lei(sold));
    expect(t).not.toMatch(/ianuarie 2026|decembrie 2027/);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);

    const verificare = page.locator(".ab-shell").getByText("Verificarea repartitiei").locator("xpath=ancestor::div[1]");
    await expect(verificare).toContainText("0,00");
  });

  test("8. PDF-urile anului nou scriu luna si data cu anul lor", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await page.getByLabel("Luna").selectOption({ label: "ianuarie 2027" });
    await expect(page.getByText("IANUARIE 2027 · PUBLICATA")).toBeVisible({ timeout: 20000 });

    const avizier = await descarca(page, () => buton(page, "Exporta PDF pentru avizier").click());
    expect(avizier.nume).toContain("2027-01");
    const textAvizier = textPdf(avizier.octeti);
    expect(textAvizier).toContain("Lista de plata pe ianuarie 2027");
    expect(textAvizier).not.toMatch(/NaN|Invalid|undefined|2027-01-01/);
    /* Termenul de plata din antet este tot din 2027 */
    expect(textAvizier).toMatch(/25 februarie 2027/);

    const intern = await descarca(page, () => buton(page, "Exporta lista interna (uz administrativ)").click());
    const textIntern = textPdf(intern.octeti);
    expect(textIntern).toContain("Lista de plata pe ianuarie 2027");
    expect(textIntern).not.toMatch(/NaN|Invalid|undefined/);

    /* Chitanta emisa in anul nou: data cu anul ei, nu cu al listei */
    await mergiLaTab(page, "Apartamente");
    const ap = await apartamentulNumarul(5);
    await page.getByRole("button", { name: `Apartament ${ap.numar}`, exact: true }).click();
    await buton(page, "Inregistreaza incasare cash").click();
    await page.getByLabel("Suma primita").fill("25");
    await buton(page, "Emite chitanta").click();
    await asteaptaToast(page, "Incasare inregistrata, chitanta emisa");
    const chitanta = await descarca(page, () => buton(page, "Descarca chitanta").first().click());
    const textChitanta = textPdf(chitanta.octeti);
    expect(textChitanta).toMatch(/Data: \d{1,2} [a-z]+ 20\d\d, ora \d\d:\d\d/);
    expect(textChitanta).not.toMatch(/NaN|Invalid|undefined/);
  });
});
