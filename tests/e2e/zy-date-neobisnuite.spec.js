/* Ecranele pe date pe care blocul demo nu le are: un bloc cu un singur
   apartament, un apartament fara contoare, o lista cu douazeci de facturi, un
   locatar fara nicio datorie si fara nicio citire, si setarile asociatiei
   schimbate la mijlocul lunii, dupa ce lista a fost deja publicata.

   Fisierul isi face propriile asociatii, prin aceleasi comenzi ca `npm run
   seed` (Edge Function-ul `creeaza-asociatie`, inrolarea de pe hartie,
   `activeaza_bloc`), si nu atinge blocul demo D14. Ruleaza dupa ciclul lunii,
   iar `zz-doua-luni` reface baza la final, deci nu lasa nimic in urma.
   Se parcurge o singura data, pe proiectul "telefon". */

import { test, expect } from "@playwright/test";
import {
  serviciu, URL_SUPABASE, CHEIE_SERVICIU, PAROLA, intra, buton, mergiLaTab,
  asteaptaToast, CUVINTE_TEHNICE, descarca, textPdf, telefonTemporar, creeazaCont,
} from "./ajutor.js";

const STAMP = Date.now().toString(36);
/* Luna curenta pe ora Romaniei, ca in baza de date */
const LUNA = `${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" }).slice(0, 7)}-01`;

async function ok(promisiune, ce) {
  const { data, error } = await promisiune;
  if (error) throw new Error(`${ce}: ${error.message}`);
  return data;
}

async function functie(nume, corp) {
  const r = await fetch(`${URL_SUPABASE}/functions/v1/${nume}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CHEIE_SERVICIU}`, "Content-Type": "application/json" },
    body: JSON.stringify(corp),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${nume}: ${j.eroare || JSON.stringify(j)}`);
  return j;
}

/* O asociatie noua cu un bloc, apartamentele ei si administratorul ei */
async function creeazaBloc({ eticheta, cui, apartamente, contoareGenerale }) {
  const db = serviciu();
  const telefon = telefonTemporar();
  const creata = await functie("creeaza-asociatie", {
    asociatie: {
      denumire: `E2E ${eticheta} ${STAMP}`, cui, iban: "RO49RNCB0082004512340099",
      banca: "Banca de test", adresa: "Str. Testelor nr. 1", telefon: "0700000000",
      email: `e2e-${eticheta}-${STAMP}@adminbloc.test`,
    },
    setari: { procentPenalizareZi: 0.02, zileGratie: 30, ziScadenta: 25, chitantaSerie: `E2E${STAMP.slice(-3).toUpperCase()}`, chitantaUltimulNumar: 0 },
    bloc: { denumire: `E2E bloc ${eticheta} ${STAMP}`, adresa: "Str. Testelor nr. 1", etaje: 1, ziLimitaCitire: 15, rulmentPerApartament: 0 },
    administrator: { telefon, parola: PAROLA, nume: `Administrator ${eticheta}`, atestat: `E2E-${STAMP}` },
  });

  for (const a of apartamente) {
    const rand = await ok(db.schema("organizare").from("inrolare_apartamente").insert({
      bloc_id: creata.bloc_id, numar: a.numar, sursa: "operator",
      date: {
        etaj: a.etaj ?? 1, proprietar: a.proprietar, persoane: a.persoane, cota: a.cota,
        suprafata: 50, scutit_lift: false, luna_start: LUNA,
        ...(a.faraContoare ? {} : {
          index_rece: a.indexRece, index_calda: a.indexCalda,
          serie_rece: `E2E-R-${a.numar}`, serie_calda: `E2E-C-${a.numar}`,
        }),
      },
    }).select("id").single(), `inrolare ${a.numar}`);
    await ok(db.schema("organizare").rpc("confirma_inrolare", { p_inrolare_id: rand.id }), `confirmare ${a.numar}`);
  }
  await ok(db.rpc("proceseaza_evenimente_restante"), "ApartamentCreat");

  const apsBd = await ok(db.schema("organizare").from("apartamente").select("id, numar").eq("bloc_id", creata.bloc_id), "apartamente");

  /* Apartamentul "fara contoare": inrolarea ii da oricum un contor de apa rece
     (migratia care repara apartamentul fara index), deci contoarele lui se
     scot aici, ca ecranele sa fie vazute chiar fara niciun contor. */
  for (const a of apartamente.filter((x) => x.faraContoare)) {
    const apId = apsBd.find((x) => x.numar === a.numar).id;
    /* Contorul implicit il creeaza evenimentul ApartamentCreat, procesat si
       asincron, prin webhook: daca webhook-ul apuca evenimentul inaintea
       apelului de mai sus, contorul apare abia dupa stergere, iar apartamentul
       "fara contoare" are unul (asa a picat [R5] pe CI, 21 septembrie). Se
       asteapta sa apara; evenimentul se proceseaza o singura data, deci nu
       mai revine dupa stergere. */
    let cont = [];
    for (let i = 0; i < 40 && cont.length === 0; i += 1) {
      cont = await ok(db.schema("contorizare").from("contoare").select("id").eq("apartament_id", apId), "contor implicit");
      if (cont.length === 0) await new Promise((r) => { setTimeout(r, 500); });
    }
    if (cont.length === 0) throw new Error("contorul implicit al apartamentului n-a aparut in 20 de secunde");
    for (const c of cont) {
      await db.schema("contorizare").from("citiri").delete().eq("contor_id", c.id);
      await ok(db.schema("contorizare").from("contoare").delete().eq("id", c.id), "sterge contor");
    }
  }

  for (const tip of contoareGenerale || []) {
    const g = await ok(db.schema("contorizare").from("contoare").insert({
      bloc_id: creata.bloc_id, tip, serie: `E2E-GEN-${tip}`, amplasare: "subsol",
    }).select("id").single(), "contor general");
    await ok(db.schema("contorizare").from("citiri").insert({
      contor_id: g.id, tip, bloc_id: creata.bloc_id, luna: LUNA,
      index_anterior: 1000, index_curent: 1000, sursa: "pornire", stare: "validata",
    }), "pornire general");
  }

  await ok(db.schema("organizare").rpc("activeaza_bloc", { p_bloc_id: creata.bloc_id }), "activare bloc");
  return { ...creata, telefon, apartamente: apsBd };
}

/* Contul se tine pe numarul de telefon: acelasi ajutor ca in restul suitei */
async function locatarNou(telefon, nume, apartamentId, blocId) {
  const db = serviciu();
  const id = await creeazaCont(telefon, nume);
  await ok(db.schema("identitate").from("locatari").insert({
    apartament_id: apartamentId, bloc_id: blocId, profil_id: id, calitate: "proprietar", activ_din: LUNA,
  }), `locatar ${telefon}`);
  return id;
}

/* `creeaza_asociatie` refoloseste asociatia cu acelasi CUI: fiecare rulare are
   nevoie de un CUI numai al ei, altfel testul publica lista rularii dinainte. */
let urmatorulCui = 0;
const cuiNou = () => String(90000000 + ((Date.now() + (urmatorulCui += 7919)) % 9000000));

const LOCATAR_UNUL = telefonTemporar();
const LOCATAR_GOL = telefonTemporar();

let UNUL;   /* bloc cu un singur apartament, cu contoare */
let GOL;    /* bloc cu un apartament fara contoare */

test.describe("ecrane pe date neobisnuite", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browserName }, testInfo) => {
    void browserName;
    test.skip(testInfo.project.name !== "telefon", "se parcurge o singura data");
    test.setTimeout(180000);
    UNUL = await creeazaBloc({
      eticheta: "unul", cui: cuiNou(),
      apartamente: [{ numar: "1", proprietar: "Singurul Proprietar", persoane: 2, cota: 100, indexRece: 100, indexCalda: 50 }],
      contoareGenerale: ["rece"],
    });
    GOL = await creeazaBloc({
      eticheta: "gol", cui: cuiNou(),
      apartamente: [{ numar: "1", proprietar: "Fara Contoare", persoane: 1, cota: 100, faraContoare: true }],
    });
    await locatarNou(LOCATAR_UNUL, "Locatar Unul", UNUL.apartamente[0].id, UNUL.bloc_id);
    await locatarNou(LOCATAR_GOL, "Locatar Gol", GOL.apartamente[0].id, GOL.bloc_id);
  });

  test("1. locatarul fara datorii si fara citiri vede ecrane pline de text, nu goluri", async ({ page }) => {
    await intra(page, LOCATAR_GOL);
    await expect(buton(page, "Iesi")).toBeVisible({ timeout: 20000 });

    for (const t of ["Acasa", "Plata", "Contoare", "Sesizari", "Bloc"]) {
      await mergiLaTab(page, t);
      await page.waitForTimeout(400);
      const text = await page.locator(".ab-shell > .ab-scroll").innerText();
      expect(text.trim().length, `tabul ${t} nu are ce arata`).toBeGreaterThan(30);
      for (const cuvant of CUVINTE_TEHNICE) expect(text, `tabul ${t}`).not.toContain(cuvant);
    }

    /* Nicio datorie: soldul este zero si nu i se cere nimic */
    await mergiLaTab(page, "Acasa");
    const acasa = await page.locator(".ab-shell > .ab-scroll").innerText();
    expect(acasa).toMatch(/ACHITAT|0,00/);
  });

  /* [R5] Apartamentul nu are niciun contor, dar ecranul Contoare ii arata
     formularul intreg: "Citirea pentru septembrie", badge-ul "TERMEN DEPASIT",
     cererea de poza si butonul "Trimite indexul" — fara niciun camp de index,
     pentru ca nu exista contor. Cine incarca poza si apasa butonul primeste
     "Scrie cel putin un index", desi nu are unde sa-l scrie. */
  test("[R5] apartamentul fara contoare nu primeste un formular pe care nu-l poate completa", async ({ page }) => {
    await intra(page, LOCATAR_GOL);
    await expect(buton(page, "Iesi")).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Contoare");
    const contoare = (await page.locator(".ab-shell > .ab-scroll").innerText()).replace(/\s+/g, " ");
    await expect(buton(page, "Trimite indexul")).toHaveCount(0);
    expect(contoare, "ecranul nu spune de ce nu are ce transmite").toMatch(/nu ai contor|niciun contor|fara contor/i);
    expect(contoare, "i se cere o citire pe care nu o poate face").not.toMatch(/TERMEN DEPASIT/);
  });

  test("2. administratorul unui apartament fara contoare nu ramane cu ecranul de citiri gol", async ({ page }) => {
    await intra(page, GOL.telefon);
    await expect(buton(page, "Iesi")).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    await page.waitForTimeout(500);
    const text = await page.locator(".ab-shell > .ab-scroll").innerText();
    for (const cuvant of CUVINTE_TEHNICE) expect(text).not.toContain(cuvant);
    expect(text.replace(/\s+/g, " ")).toMatch(/contor/i);
  });

  test("3. un bloc cu un singur apartament: el plateste toata lista", async ({ page }) => {
    const db = serviciu();
    const listaId = await ok(db.schema("intretinere").rpc("deschide_lista", { p_bloc_id: UNUL.bloc_id, p_luna: LUNA }), "deschide lista");
    const furnizor = await ok(db.schema("intretinere").from("furnizori").insert({
      asociatie_id: UNUL.asociatie_id, denumire: `E2E Furnizor ${STAMP}`, categorie_implicita: "Test", metoda_implicita: "apartamente", cod_implicit: "C10",
    }).select("id").single(), "furnizor");

    /* Douazeci de facturi pe aceeasi lista: ecranul locatarului, previzualizarea
       administratorului si PDF-ul pentru avizier trebuie sa le duca pe toate. */
    const facturi = [];
    for (let i = 0; i < 20; i += 1) {
      facturi.push({
        lista_id: listaId, tip: "factura", cod: `C${10 + i}`, categorie: `E2E cheltuiala ${i + 1}`,
        furnizor_id: furnizor.id, suma: 10 + i, metoda: ["apartamente", "persoane", "cota"][i % 3],
        serie_numar: `E2E-${i + 1}`,
      });
    }
    await ok(db.schema("intretinere").from("cheltuieli").insert(facturi), "cele 20 de facturi");
    const totalFacturi = facturi.reduce((s, f) => s + f.suma, 0);

    await intra(page, UNUL.telefon);
    await expect(buton(page, "Iesi")).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Facturi");
    await page.waitForTimeout(800);
    const inainte = await page.locator(".ab-shell > .ab-scroll").innerText();
    for (const cuvant of CUVINTE_TEHNICE) expect(inainte).not.toContain(cuvant);
    expect(inainte).toContain("E2E cheltuiala 20");

    await buton(page, "Publica lista").click();
    await expect(page.getByRole("dialog", { name: "Publica lista" })).toBeVisible();
    await buton(page, "Da, publica lista").click();
    await asteaptaToast(page, "Lista a fost publicata");

    const { data: rep } = await db.schema("intretinere").from("repartizari").select("suma").eq("lista_id", listaId);
    expect(rep.length, "un rand pe fiecare cheltuiala").toBeGreaterThanOrEqual(20);
    const repartizat = rep.reduce((s, r) => s + Number(r.suma), 0);
    const { data: chelt } = await db.schema("intretinere").from("cheltuieli").select("suma").eq("lista_id", listaId);
    const totalCuFond = chelt.reduce((s, c) => s + Number(c.suma), 0);
    expect(Math.round(repartizat * 100) / 100).toBe(Math.round(totalCuFond * 100) / 100);
    expect(totalCuFond).toBeGreaterThanOrEqual(totalFacturi);

    /* PDF-ul de avizier cu douazeci de coloane */
    const pdf = await descarca(page, () => buton(page, "Exporta PDF pentru avizier").click());
    const text = textPdf(pdf.octeti);
    expect(text).toContain("C29");
    expect(text).toContain("C10");
  });

  test("4. lista publicata nu se clinteste cand setarile asociatiei se schimba la mijlocul lunii", async ({ page }) => {
    const db = serviciu();
    const { data: lista } = await db.schema("intretinere").from("liste_lunare")
      .select("id, scadenta").eq("bloc_id", UNUL.bloc_id).eq("stare", "publicata").single();
    const scadentaInainte = lista.scadenta;

    const { data: datorii } = await db.schema("financiar").from("datorii")
      .select("id, scadenta, suma").eq("bloc_id", UNUL.bloc_id).eq("tip", "intretinere");
    expect(datorii.length).toBe(1);

    /* Setarile se schimba dupa publicare: alta zi de scadenta, alt procent de
       penalizare, alt termen de citire */
    await ok(db.schema("financiar").from("setari_financiare")
      .update({ zi_scadenta: 5, procent_penalizare_zi: 0.2, zile_gratie: 1 })
      .eq("asociatie_id", UNUL.asociatie_id), "setari financiare");
    await ok(db.schema("contorizare").from("setari_contorizare")
      .update({ zi_limita_citire: 2 }).eq("bloc_id", UNUL.bloc_id), "setari contorizare");

    const { data: dupa } = await db.schema("intretinere").from("liste_lunare")
      .select("scadenta").eq("id", lista.id).single();
    expect(dupa.scadenta, "scadenta listei publicate ramane cea anuntata").toBe(scadentaInainte);
    const { data: datoriiDupa } = await db.schema("financiar").from("datorii")
      .select("scadenta, suma").eq("bloc_id", UNUL.bloc_id).eq("tip", "intretinere");
    expect(datoriiDupa[0].scadenta, "scadenta datoriei ramane cea anuntata").toBe(datorii[0].scadenta);
    expect(Number(datoriiDupa[0].suma)).toBe(Number(datorii[0].suma));

    /* Iar locatarul vede acelasi termen pe ecran ca inainte de schimbare */
    await intra(page, LOCATAR_UNUL);
    await expect(buton(page, "Iesi")).toBeVisible({ timeout: 20000 });
    const acasa = await page.locator(".ab-shell > .ab-scroll").innerText();
    for (const cuvant of CUVINTE_TEHNICE) expect(acasa).not.toContain(cuvant);
    const zi = Number(scadentaInainte.slice(8, 10));
    expect(acasa).toContain(String(zi));
  });
});
