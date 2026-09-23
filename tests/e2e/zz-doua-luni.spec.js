/* Doua luni una dupa alta, pe acelasi bloc.

   Ciclul unei singure luni este deja parcurs de `z-ciclu-luna`. Aici intrebarea
   este alta: ce se intampla cu ce ramane de la o luna la alta. Dupa a doua
   publicare se cauta derive: solduri care nu se mai potrivesc, contributii la
   fond numarate de doua ori, numere de chitanta sarite sau repetate,
   penalizari calculate din nou peste aceleasi zile, istoricul locatarului care
   pierde o luna, si PDF-ul de avizier al lunii vechi schimbat de lista noua.

   Testul publica doua liste ale blocului demo, deci strica datele
   demonstrative: ruleaza o singura data, pe proiectul "telefon", si la final
   readuce baza la starea initiala. Fisierul se numeste cu "zz-" ca sa ruleze
   dupa toate celelalte. */

import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, serviciu, blocD14, apartamente, apartamentulNumarul,
  asteaptaToast, textEcran, CUVINTE_TEHNICE, listaLunara, soldApartament, uitaCache,
  descarca, textPdf, CONTURI, profilDupaEmail, verificaCitirileLunii,
} from "./ajutor.js";

const LUNA_1 = "2026-09-01";
const LUNA_2 = "2026-10-01";
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const lei = (n) => Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d),)/g, ".");

/* Aceleasi trei facturi in amandoua lunile, ca diferentele sa vina din ce s-a
   intamplat intre timp, nu din alte cifre. Niciuna pe consum: apa are ciclul
   ei, parcurs deja de `z-ciclu-luna`. */
const FACTURI = [
  { cod: "C30", categorie: "E2E doua luni salubritate", metoda: "persoane", suma: 900 },
  { cod: "C31", categorie: "E2E doua luni deratizare", metoda: "apartamente", suma: 400 },
  { cod: "C32", categorie: "E2E doua luni administrare", metoda: "cota", suma: 1000 },
];

let BLOC;
let APARTAMENTE;
let FURNIZOR;
const LISTE = {};
const CHITANTE = [];

async function ok(promisiune, ce) {
  const { data, error } = await promisiune;
  if (error) throw new Error(`${ce}: ${error.message}`);
  return data;
}

async function adaugaFacturile(listaId) {
  await ok(serviciu().schema("intretinere").from("cheltuieli").insert(FACTURI.map((f) => ({
    lista_id: listaId, tip: "factura", cod: f.cod, categorie: f.categorie,
    furnizor_id: FURNIZOR, suma: f.suma, metoda: f.metoda, serie_numar: `E2E-2L-${f.cod}`,
  }))), "facturile lunii");
}

async function totaluri(listaId) {
  const sb = serviciu();
  const chelt = await ok(sb.schema("intretinere").from("cheltuieli").select("suma").eq("lista_id", listaId), "cheltuieli");
  const rep = await ok(sb.schema("intretinere").from("repartizari").select("suma").eq("lista_id", listaId), "repartizari");
  return {
    facturi: round2(chelt.reduce((s, c) => s + Number(c.suma), 0)),
    repartizat: round2(rep.reduce((s, r) => s + Number(r.suma), 0)),
    randuri: rep.length,
  };
}

test.describe("doua luni la rand, fara derive", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browserName }, testInfo) => {
    void browserName;
    test.skip(testInfo.project.name !== "telefon", "se parcurge o singura data");
    BLOC = await blocD14();
    APARTAMENTE = await apartamente();
    LISTE[LUNA_1] = (await listaLunara({ stare: "ciorna" })).id;
    FURNIZOR = (await ok(serviciu().schema("intretinere").from("furnizori").insert({
      asociatie_id: BLOC.asociatie_id, denumire: "E2E Furnizor doua luni",
      categorie_implicita: "Test", metoda_implicita: "apartamente", cod_implicit: "C30",
    }).select("id").single(), "furnizor")).id;
  });

  test.afterAll(async ({ browserName }, testInfo) => {
    void browserName;
    if (testInfo.project.name !== "telefon") return;
    execSync("supabase db reset && npm run seed", { cwd: process.cwd(), stdio: "pipe", timeout: 600000 });
    uitaCache();
  });

  test("1. prima luna se publica si intra in registru", async ({ page }) => {
    const sb = serviciu();
    await adaugaFacturile(LISTE[LUNA_1]);
    await verificaCitirileLunii(BLOC.id, LUNA_1);
    const fondInainte = Number((await ok(sb.schema("financiar").from("fonduri_solduri")
      .select("sold").eq("bloc_id", BLOC.id).eq("tip", "reparatii").single(), "fond")).sold);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Publica lista").click();
    await expect(page.getByRole("dialog", { name: "Publica lista" })).toBeVisible();
    await buton(page, "Da, publica lista").click();
    await asteaptaToast(page, "Lista a fost publicata");

    const t1 = await totaluri(LISTE[LUNA_1]);
    expect(t1.repartizat, "nimic nealocat in prima luna").toBe(t1.facturi);

    /* O datorie de intretinere pe fiecare apartament, exact una */
    const datorii = await ok(sb.schema("financiar").from("datorii")
      .select("apartament_id, lista_id").eq("bloc_id", BLOC.id).eq("tip", "intretinere")
      .eq("lista_id", LISTE[LUNA_1]), "datorii luna 1");
    expect(datorii).toHaveLength(APARTAMENTE.length);
    expect(new Set(datorii.map((d) => d.apartament_id)).size).toBe(APARTAMENTE.length);

    /* Fondul a primit o singura contributie */
    const fondDupa = Number((await ok(sb.schema("financiar").from("fonduri_solduri")
      .select("sold").eq("bloc_id", BLOC.id).eq("tip", "reparatii").single(), "fond")).sold);
    expect(fondDupa).toBeGreaterThan(fondInainte);
    const miscari = await ok(sb.schema("financiar").from("miscari_fond")
      .select("id, descriere, fond_id").ilike("descriere", `%${"septembrie"}%`), "miscari");
    expect(miscari.length, "o singura contributie pentru luna publicata").toBe(1);
  });

  test("2. banii primiti in prima luna: intreg si partial, in numerar", async ({ page }) => {
    const sb = serviciu();
    const apElena = await apartamentulNumarul(17);

    /* Un locatar plateste tot, in numerar, la administrator */
    const sold = await soldApartament(apElena.id);
    expect(sold).toBeGreaterThan(0);
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 17" }).click();
    await buton(page, "Inregistreaza incasare cash").click();
    await buton(page, "Emite chitanta").click();
    await asteaptaToast(page, "chitanta");
    await expect.poll(async () => soldApartament(apElena.id), { timeout: 30000 }).toBe(0);

    /* Iar de la restantier incaseaza doar o parte */
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 3" }).click();
    await buton(page, "Inregistreaza incasare cash").click();
    await page.getByLabel(/Suma primita/).fill("100");
    await buton(page, "Emite chitanta").click();
    await asteaptaToast(page, "chitanta");

    const chitante = await ok(sb.schema("financiar").from("chitante").select("serie, numar").order("numar"), "chitante");
    CHITANTE.push(...chitante.map((c) => `${c.serie}-${c.numar}`));
    expect(new Set(CHITANTE).size, "numere de chitanta repetate").toBe(CHITANTE.length);
  });

  test("3. a doua luna se deschide, se completeaza si se publica", async ({ page }) => {
    const sb = serviciu();
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Incepe lista pe octombrie 2026").click();
    await asteaptaToast(page, "a fost inceputa");

    const lista2 = await ok(sb.schema("intretinere").from("liste_lunare")
      .select("id, stare").eq("bloc_id", BLOC.id).eq("luna", LUNA_2).single(), "lista octombrie");
    expect(lista2.stare).toBe("ciorna");
    LISTE[LUNA_2] = lista2.id;
    await adaugaFacturile(LISTE[LUNA_2]);

    await page.reload();
    await expect(buton(page, "Iesi")).toBeVisible({ timeout: 25000 });
    await mergiLaTab(page, "Facturi");
    await buton(page, "Publica lista").click();
    await expect(page.getByRole("dialog", { name: "Publica lista" })).toBeVisible();
    await buton(page, "Da, publica lista").click();
    await asteaptaToast(page, "Lista a fost publicata");

    const t2 = await totaluri(LISTE[LUNA_2]);
    expect(t2.repartizat, "nimic nealocat in a doua luna").toBe(t2.facturi);
    const t1 = await totaluri(LISTE[LUNA_1]);
    expect(t1.repartizat, "prima luna nu s-a clintit").toBe(t1.facturi);
  });

  test("4. registrul dupa doua luni: nicio dublura, niciun gol, nimic pe minus", async () => {
    const sb = serviciu();

    /* Cate o datorie de intretinere pe apartament si pe lista, nici una in plus */
    const datorii = await ok(sb.schema("financiar").from("datorii")
      .select("apartament_id, lista_id, tip, suma").eq("bloc_id", BLOC.id).eq("tip", "intretinere"), "datorii");
    for (const luna of [LUNA_1, LUNA_2]) {
      const ale = datorii.filter((d) => d.lista_id === LISTE[luna]);
      expect(ale.length, `datorii de intretinere pe ${luna}`).toBe(APARTAMENTE.length);
      expect(new Set(ale.map((d) => d.apartament_id)).size).toBe(APARTAMENTE.length);
    }

    /* Chitantele: numerotare fara goluri si fara repetari, pe serie */
    const chitante = await ok(sb.schema("financiar").from("chitante").select("serie, numar").order("numar"), "chitante");
    const peSerie = {};
    for (const c of chitante) (peSerie[c.serie] ||= []).push(Number(c.numar));
    for (const [serie, numere] of Object.entries(peSerie)) {
      const sortate = [...numere].sort((a, b) => a - b);
      expect(new Set(sortate).size, `numere repetate in seria ${serie}`).toBe(sortate.length);
      for (let i = 1; i < sortate.length; i += 1) {
        expect(sortate[i] - sortate[i - 1], `gol in seria ${serie} intre ${sortate[i - 1]} si ${sortate[i]}`).toBe(1);
      }
    }

    /* Fondul de reparatii: exact doua contributii, una pe luna publicata */
    const fond = await ok(sb.schema("financiar").from("fonduri")
      .select("id").eq("bloc_id", BLOC.id).eq("tip", "reparatii").single(), "fond");
    const miscari = await ok(sb.schema("financiar").from("miscari_fond")
      .select("suma, descriere").eq("fond_id", fond.id).ilike("descriere", "%Contributii fond%"), "miscari fond");
    const aleLunilor = miscari.filter((m) => /septembrie|octombrie/.test(m.descriere));
    expect(aleLunilor.length, "contributii la fond pentru cele doua luni").toBe(2);
    const descrieri = aleLunilor.map((m) => m.descriere);
    expect(new Set(descrieri).size, "aceeasi contributie numarata de doua ori").toBe(2);

    /* Niciun rest negativ si soldul fiecarui apartament egal cu suma resturilor */
    const rest = await ok(sb.schema("financiar").from("datorii_rest").select("apartament_id, rest"), "datorii_rest");
    for (const r of rest) expect(Number(r.rest), "rest negativ in registru").toBeGreaterThanOrEqual(0);
    const solduri = await ok(sb.schema("financiar").from("solduri").select("apartament_id, sold"), "solduri");
    for (const ap of APARTAMENTE) {
      const dinResturi = round2(rest.filter((r) => r.apartament_id === ap.id).reduce((s, r) => s + Number(r.rest), 0));
      const raportat = solduri.find((s) => s.apartament_id === ap.id);
      if (raportat) expect(round2(Number(raportat.sold)), `soldul apartamentului ${ap.numar}`).toBe(dinResturi);
    }
  });

  test("5. penalizarile nu se calculeaza de doua ori peste aceleasi zile", async () => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(3);
    const peste = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);

    const inainte = await ok(sb.schema("financiar").from("penalizari").select("id"), "penalizari inainte");

    /* Acelasi apel pe care il face jobul de cron pe 1 ale lunii */
    await ok(sb.schema("financiar").rpc("calculeaza_penalizari", { p_la: peste }), "penalizari 1");
    const dupaPrima = await ok(sb.schema("financiar").from("penalizari")
      .select("id, suma, datorie_id, zile_taxate").order("id"), "penalizari 1");

    await ok(sb.schema("financiar").rpc("calculeaza_penalizari", { p_la: peste }), "penalizari 2");
    const dupaADoua = await ok(sb.schema("financiar").from("penalizari")
      .select("id, suma, datorie_id, zile_taxate").order("id"), "penalizari 2");

    expect(dupaPrima.length, "prima rulare nu a calculat nicio penalizare noua, deci testul nu verifica nimic")
      .toBeGreaterThan(inainte.length);
    expect(dupaADoua.length, "a doua rulare pe aceeasi zi mai adauga penalizari").toBe(dupaPrima.length);

    /* Nicio penalizare nu depaseste datoria pe care o insoteste */
    const datorii = await ok(sb.schema("financiar").from("datorii").select("id, suma").eq("bloc_id", BLOC.id), "datorii");
    const peDatorie = {};
    for (const p of dupaADoua) peDatorie[p.datorie_id] = round2((peDatorie[p.datorie_id] || 0) + Number(p.suma));
    for (const [id, suma] of Object.entries(peDatorie)) {
      const d = datorii.find((x) => x.id === id);
      if (d) expect(suma, `penalizari peste datoria ${id}`).toBeLessThanOrEqual(round2(Number(d.suma)) + 0.01);
    }

    /* Si niciun rest negativ dupa penalizari */
    const rest = await ok(sb.schema("financiar").from("datorii_rest").select("rest").eq("apartament_id", ap.id), "rest");
    for (const r of rest) expect(Number(r.rest)).toBeGreaterThanOrEqual(0);
  });

  test("6. locatarul isi vede amandoua lunile in istoric, cu cifrele lor", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(17);
    const repLuna = async (listaId) => {
      const { data } = await sb.schema("intretinere").from("repartizari")
        .select("suma").eq("lista_id", listaId).eq("apartament_id", ap.id);
      return round2((data || []).reduce((s, r) => s + Number(r.suma), 0));
    };
    const septembrie = await repLuna(LISTE[LUNA_1]);
    const octombrie = await repLuna(LISTE[LUNA_2]);

    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: "Platile mele" }).click();
    await page.waitForTimeout(800);
    const istoric = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(istoric).not.toContain(cuvant);
    expect(istoric, "septembrie lipseste din istoric").toContain(lei(septembrie));
    expect(istoric, "octombrie lipseste din istoric").toContain(lei(octombrie));
    expect(istoric).toMatch(/sep/i);
    expect(istoric).toMatch(/oct/i);

    /* Acasa: soldul este exact lista noua, nu suma amandurora */
    await mergiLaTab(page, "Acasa");
    const acasa = await textEcran(page);
    expect(acasa, "soldul de pe Acasa nu este cat lista noua").toContain(lei(await soldApartament(ap.id)));
    for (const cuvant of CUVINTE_TEHNICE) expect(acasa).not.toContain(cuvant);

    /* Notificarile: cate una pe luna publicata, nu doua pe aceeasi luna */
    const elena = await profilDupaEmail(CONTURI.elena);
    const anunturi = await ok(sb.schema("comunicare").from("notificari")
      .select("titlu").eq("profil_id", elena.id).eq("tip", "lista_publicata"), "notificari");
    const titluri = anunturi.map((n) => n.titlu);
    expect(new Set(titluri).size, "aceeasi luna anuntata de doua ori").toBe(titluri.length);
  });

  test("7. avizierul lunii vechi nu se schimba dupa publicarea lunii noi", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");

    const pdfuri = {};
    /* Cu pana la 4 liste publicate luna se alege din butoane scurte ("sep 26"),
       peste 4 dintr-o lista derulanta ("septembrie 2026"). Dupa a doua
       publicare, D14 trece pragul, deci testul trebuie sa le stie pe amandoua. */
    const alegeLuna = async (scurt, lung) => {
      const picker = page.getByLabel("Luna");
      if (await picker.count()) { await picker.selectOption({ label: lung }); return; }
      await buton(page, scurt).click();
    };

    for (const [luna, scurt, lung] of [[LUNA_2, "oct 26", "octombrie 2026"], [LUNA_1, "sep 26", "septembrie 2026"]]) {
      await alegeLuna(scurt, lung);
      await page.waitForTimeout(800);
      const fisier = await descarca(page, () => buton(page, "Exporta PDF pentru avizier").click());
      pdfuri[luna] = textPdf(fisier.octeti);
    }

    for (const luna of [LUNA_1, LUNA_2]) {
      const t = await totaluri(LISTE[luna]);
      expect(pdfuri[luna], `PDF-ul lunii ${luna}`).toBeTruthy();
      expect(pdfuri[luna].replace(/\s+/g, " "), `totalul lunii ${luna} pe avizier`).toContain(lei(t.facturi));
    }
    expect(pdfuri[LUNA_1]).not.toBe(pdfuri[LUNA_2]);
    /* Avizierul nu duce nume si nici restante (regula lui, pastrata si a doua luna) */
    for (const luna of [LUNA_1, LUNA_2]) {
      expect(pdfuri[luna], "avizierul arata nume").not.toContain("Marinescu");
      expect(pdfuri[luna], "avizierul arata restante").not.toMatch(/Restant/i);
    }
  });
});
