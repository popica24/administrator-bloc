/* =============================================================================
   Seed demo pentru baza de date locala (Docker)
   -----------------------------------------------------------------------------
   Rejoaca src/date-demo.js prin comenzile reale ale backend-ului, in ordinea in
   care s-au intamplat: creeaza-asociatie, inrolarea apartamentelor de pe
   hartie, publicarea listelor prin Edge Function-ul publica-lista (motorul de
   repartizare), platile, jobul de penalizari. Aceleasi date ca modul
   demonstrativ al aplicatiei, deci aceleasi cifre.

   Rulare, dupa `supabase db reset`:  npm run seed
============================================================================= */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import * as D from "../src/date-demo.js";
import { documentPdf } from "../src/pdf.js";
import { adresaContului, normalizeazaTelefon } from "../supabase/functions/_shared/telefon.js";

const URL_SUPABASE = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
/* Cheia service_role demo a stack-ului local (publica, identica pe orice
   instalare `supabase start`). Pentru alt mediu se da prin variabila. */
const CHEIE = process.env.SUPABASE_SERVICE_ROLE_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const db = createClient(URL_SUPABASE, CHEIE, { auth: { persistSession: false, autoRefreshToken: false } });
const POZA_CONTOR = readFileSync(new URL("./date-demo/contor.jpg", import.meta.url));
const POZA_SESIZARE = readFileSync(new URL("./date-demo/sesizare.jpg", import.meta.url));

const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const zi = () => new Date().toISOString().slice(0, 10);
const luna1 = (l) => `${l}-01`;

async function ok(promisiune, ce) {
  const { data, error } = await promisiune;
  if (error) throw new Error(`${ce}: ${error.message}`);
  return data;
}

async function functie(nume, corp) {
  const r = await fetch(`${URL_SUPABASE}/functions/v1/${nume}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CHEIE}`, "Content-Type": "application/json" },
    body: JSON.stringify(corp),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${nume}: ${j.eroare || JSON.stringify(j)}`);
  return j;
}

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

async function main() {
  const existenta = await ok(db.schema("organizare").from("asociatii").select("id").eq("cui", D.ASOCIATIE.cui), "verificare");
  if (existenta.length) {
    console.log("Datele demo exista deja. Ruleaza intai `supabase db reset`.");
    return;
  }

  /* Nomenclatorul: judetul si municipiul in care se afla blocul */
  const judet = await ok(db.schema("nomenclator").from("administratii_locale").insert({
    denumire: D.BLOC.judet.denumire, tip: "judet", judet: D.BLOC.judet.judet, judet_cod: D.BLOC.judet.judetCod, siruta: D.BLOC.judet.siruta,
  }).select().single(), "judet");
  await ok(db.schema("nomenclator").from("administratii_locale").insert({
    denumire: D.BLOC.uat.denumire, tip: D.BLOC.uat.tip, judet: D.BLOC.uat.judet, judet_cod: D.BLOC.uat.judetCod, siruta: D.BLOC.uat.siruta, parinte_id: judet.id,
  }), "uat");

  /* Asociatia, blocul si primul administrator, prin Edge Function-ul platformei */
  const adminCont = D.CONTURI.find((c) => c.rol === "administrator");
  const creata = await functie("creeaza-asociatie", {
    asociatie: D.ASOCIATIE,
    setari: D.SETARI_FINANCIARE,
    bloc: { ...D.BLOC, uat_siruta: D.BLOC.uat.siruta, ziLimitaCitire: D.ZI_LIMITA_CITIRE, rulmentPerApartament: D.FONDURI.find((f) => f.tip === "rulment").sumaPerApartament },
    administrator: { telefon: adminCont.telefon, parola: D.PAROLA_DEMO, nume: adminCont.nume, atestat: adminCont.atestat, activDin: "2026-05-01" },
  });
  const asoc = creata.asociatie_id;
  const bloc = creata.bloc_id;
  const admin = creata.administrator;
  console.log("asociatie", asoc, "bloc", bloc);

  /* Conturile locatarilor si administratorul inca neverificat */
  const profil = { admin };
  for (const c of D.CONTURI.filter((x) => x.rol !== "administrator")) {
    const numar = normalizeazaTelefon(c.telefon);
    const { data, error } = await db.auth.admin.createUser({
      email: adresaContului(numar), phone: `+4${numar}`, password: D.PAROLA_DEMO,
      email_confirm: true, phone_confirm: true, user_metadata: { nume: c.nume, telefon: numar },
    });
    if (error) throw new Error(`cont ${c.telefon}: ${error.message}`);
    profil[c.cheie] = data.user.id;
    if (c.rol === "administrator_in_asteptare") {
      await ok(db.schema("identitate").from("administratori").insert({ profil_id: data.user.id, numar_atestat: c.atestat, stare: "in_asteptare" }), "cerere admin");
    }
  }

  /* Documentele: fisierul in Storage, randul in comunicare.documente */
  const document = async (titlu, tip, data, extra = {}) => {
    const cale = `${asoc}/${bloc}/${data}-${slug(titlu)}.pdf`;
    const bytes = documentPdf({
      titlu,
      blocuri: [
        { tip: "text", text: `${D.ASOCIATIE.denumire}  |  ${D.BLOC.denumire}`, gri: true, marime: 9 },
        { tip: "titlu", text: titlu },
        { tip: "text", text: `Document din ${data}.`, gri: true },
        { tip: "spatiu", h: 16 },
        { tip: "text", text: "Copie demonstrativa. In aplicatia reala aici este documentul scanat incarcat de administrator." },
      ],
    });
    await ok(db.storage.from("documente").upload(cale, Buffer.from(bytes), { contentType: "application/pdf", upsert: true }), `upload ${titlu}`);
    return ok(db.schema("comunicare").from("documente").insert({
      asociatie_id: asoc, bloc_id: bloc, titlu, tip, cale, vizibil_locatarilor: true, incarcat_de: admin, creat_la: `${data}T10:00:00+03:00`, ...extra,
    }).select().single(), `document ${titlu}`);
  };
  const docuri = {};
  for (const d of D.DOCUMENTE) docuri[d.titlu] = await document(d.titlu, d.tip, d.data);
  const docPv = docuri["Proces verbal adunare generala, 12 martie 2026"];
  const docListaHartie = docuri["Lista de plata din mai 2026, de pe hartie"];

  /* Inrolarea de pe hartie: randuri propuse, confirmate unul cate unul */
  for (const a of D.APARTAMENTE) {
    const restanta = D.RESTANTE_INITIALE.find((r) => r.numar === a.numar);
    const rand = await ok(db.schema("organizare").from("inrolare_apartamente").insert({
      bloc_id: bloc, numar: a.numar, sursa: "operator", document_id: docListaHartie.id,
      date: {
        etaj: a.etaj, proprietar: a.proprietar, persoane: a.persoane, cota: a.cota, suprafata: a.mp, scutit_lift: a.scutitLift,
        luna_start: luna1(D.LUNA_PORNIRE),
        index_rece: D.indexPornire(a.numar, "rece"), index_calda: D.indexPornire(a.numar, "calda"),
        serie_rece: `R-D14-${a.numar.padStart(2, "0")}`, serie_calda: `C-D14-${a.numar.padStart(2, "0")}`,
        ...(restanta ? { restanta: restanta.suma, restanta_scadenta: restanta.scadenta, restanta_descriere: restanta.descriere } : {}),
      },
    }).select().single(), `inrolare ${a.numar}`);
    await ok(db.schema("organizare").rpc("confirma_inrolare", { p_inrolare_id: rand.id }), `confirmare ${a.numar}`);
  }
  await ok(db.rpc("proceseaza_evenimente_restante"), "ApartamentCreat");
  const apartamente = await ok(db.schema("organizare").from("apartamente").select("id, numar").eq("bloc_id", bloc), "apartamente");
  const ap = Object.fromEntries(apartamente.map((a) => [a.numar, a.id]));

  /* Contoarele generale de la subsol, cu indexul de pornire */
  const contoare = await ok(db.schema("contorizare").from("contoare").select("id, apartament_id, tip").eq("bloc_id", bloc), "contoare");
  const contor = {};
  contoare.forEach((c) => { contor[`${c.apartament_id}:${c.tip}`] = c.id; });
  for (const tip of ["rece", "calda"]) {
    const g = await ok(db.schema("contorizare").from("contoare").insert({ bloc_id: bloc, tip, serie: `GEN-${tip.toUpperCase()}-014`, amplasare: "subsol" }).select().single(), "contor general");
    contor[`null:${tip}`] = g.id;
    await ok(db.schema("contorizare").from("citiri").insert({
      contor_id: g.id, tip, bloc_id: bloc, luna: luna1(D.LUNA_PORNIRE), index_anterior: D.INDEX_PORNIRE_GENERAL[tip], index_curent: D.INDEX_PORNIRE_GENERAL[tip],
      sursa: "pornire", stare: "validata", document_id: docListaHartie.id, transmisa_la: "2026-05-31T12:00:00+03:00",
    }), "pornire general");
  }
  await ok(db.schema("organizare").rpc("activeaza_bloc", { p_bloc_id: bloc }), "activare bloc");

  /* Locatarii cu cont */
  for (const c of D.CONTURI.filter((x) => x.rol === "locatar")) {
    await ok(db.schema("identitate").from("locatari").insert({
      apartament_id: ap[c.apartament], bloc_id: bloc, profil_id: profil[c.cheie], calitate: c.calitate, activ_din: "2026-06-01",
    }), `locatar ${c.telefon}`);
  }
  const locatarAp = (numar) => {
    const c = D.CONTURI.find((x) => x.rol === "locatar" && x.apartament === numar);
    return c ? profil[c.cheie] : null;
  };

  await ok(db.schema("organizare").from("contacte").insert(D.CONTACTE.map((c, i) => ({
    asociatie_id: asoc, bloc_id: bloc, rol: c.rol, nume: c.nume, telefon: c.telefon, program: c.program || null,
    apartament_id: c.apartament ? ap[c.apartament] : null, ordine: i + 1,
  }))), "contacte");

  const furnizori = await ok(db.schema("intretinere").from("furnizori").insert(D.FURNIZORI.map((f) => ({
    asociatie_id: asoc, denumire: f.denumire, cui: f.cui, categorie_implicita: f.categorie, metoda_implicita: f.metoda,
    tip_apa_implicit: f.tipApa || null, cod_implicit: f.cod,
  }))).select(), "furnizori");
  const furnizor = Object.fromEntries(D.FURNIZORI.map((f) => [f.cheie, { ...f, id: furnizori.find((x) => x.denumire === f.denumire).id }]));

  await ok(db.schema("intretinere").from("cheltuieli_recurente").insert(D.RECURENTE.map((r) => ({
    bloc_id: bloc, tip: r.tip, cod: r.cod, categorie: r.categorie, suma: r.suma, metoda: r.metoda, hotarare: r.hotarare, document_id: docPv.id,
  }))), "recurente");

  const fonduri = await ok(db.schema("financiar").from("fonduri").select("id, tip").eq("bloc_id", bloc), "fonduri");
  for (const f of D.FONDURI) {
    const fondId = fonduri.find((x) => x.tip === f.tip).id;
    for (const m of f.miscari) {
      const d = m.document ? await document(m.document, "factura", m.data) : null;
      await ok(db.schema("financiar").from("miscari_fond").insert({
        fond_id: fondId, data: m.data, suma: m.suma, descriere: m.descriere, document_id: d ? d.id : null, creat_de: admin, creat_la: `${m.data}T12:00:00+03:00`,
      }), "miscare fond");
    }
  }

  /* Cronologia: citiri, publicari, plati si penalizari, in ordinea lor */
  const ultimIndex = {};
  const indexAnterior = (cheie, tip, numar) => {
    if (ultimIndex[cheie] == null) ultimIndex[cheie] = numar ? D.indexPornire(numar, tip) : D.INDEX_PORNIRE_GENERAL[tip];
    return ultimIndex[cheie];
  };
  const citeste = async (numar, tip, luna, consum, extra) => {
    const apId = numar ? ap[numar] : null;
    const cheie = `${apId}:${tip}`;
    const anterior = indexAnterior(cheie, tip, numar);
    const curent = round3(anterior + consum);
    await ok(db.schema("contorizare").from("citiri").insert({
      contor_id: contor[cheie], tip, bloc_id: bloc, apartament_id: apId, luna: luna1(luna), index_anterior: anterior, index_curent: curent,
      sursa: numar ? "locatar" : "administrator", stare: "validata", transmisa_de: numar ? locatarAp(numar) : admin, ...extra,
    }), `citire ${numar} ${tip} ${luna}`);
    ultimIndex[cheie] = curent;
  };

  const evenimente = [];
  for (const luna of D.LUNI_PUBLICATE) {
    evenimente.push({
      la: `${luna}-27T20:00:00+03:00`,
      fa: async (la) => {
        for (const a of D.APARTAMENTE) for (const tip of ["rece", "calda"]) {
          await citeste(a.numar, tip, luna, D.consumApartament(a.numar, luna, tip), { transmisa_la: la, verificata_la: la, verificata_de: admin });
        }
        for (const tip of ["rece", "calda"]) await citeste(null, tip, luna, D.CONTOR_GENERAL[luna][tip], { transmisa_la: la, verificata_la: la, verificata_de: admin });
      },
    });
    evenimente.push({
      la: D.PUBLICARI[luna].publicataLa,
      fa: async (la) => {
        const listaId = await ok(db.schema("intretinere").rpc("deschide_lista", { p_bloc_id: bloc, p_luna: luna1(luna) }), "deschide lista");
        await ok(db.schema("intretinere").from("liste_lunare").update({ scadenta: D.PUBLICARI[luna].scadenta }).eq("id", listaId), "scadenta");
        for (const f of D.FACTURI[luna]) {
          const fz = furnizor[f.furnizor];
          const scan = await document(`Factura ${f.serie}, ${fz.denumire}`, "factura", f.emisa);
          await ok(db.schema("intretinere").from("cheltuieli").insert({
            lista_id: listaId, tip: "factura", cod: fz.cod, categorie: fz.categorie, furnizor_id: fz.id, serie_numar: f.serie, suma: f.suma,
            metoda: fz.metoda, tip_apa: fz.tipApa || null, data_emitere: f.emisa, scadenta_furnizor: f.scadenta,
            achitata_furnizor_la: f.achitataLa && f.achitataLa <= zi() ? f.achitataLa : null, document_id: scan.id,
          }), `factura ${f.serie}`);
        }
        const r = await functie("publica-lista", { lista_id: listaId, publicata_la: la });
        console.log(`lista ${luna} publicata: ${r.total_repartizat} lei`);
      },
    });
  }
  for (const p of D.PLATI) {
    evenimente.push({
      la: p.data,
      fa: async (la) => {
        const lista = await ok(db.schema("intretinere").from("liste_lunare").select("id").eq("bloc_id", bloc).eq("luna", luna1(p.luna)).single(), "lista");
        const datorie = await ok(db.schema("financiar").from("datorii").select("suma").eq("lista_id", lista.id).eq("apartament_id", ap[p.numar]).eq("tip", "intretinere").single(), "datorie");
        /* Banii vin in numerar sau prin transfer, iar administratorul ii
           confirma in aplicatie: el este cel care inregistreaza plata. */
        await ok(db.schema("financiar").rpc("inregistreaza_plata", {
          p_apartament_id: ap[p.numar], p_suma: p.suma || Number(datorie.suma), p_metoda: p.metoda, p_la: la,
          p_inregistrata_de: admin,
        }), `plata ${p.numar} ${p.luna}`);
      },
    });
  }
  for (const z of D.CALCULE_PENALIZARI) {
    evenimente.push({ la: `${z}T00:05:00+03:00`, fa: async () => ok(db.schema("financiar").rpc("calculeaza_penalizari", { p_la: z }), "penalizari") });
  }
  evenimente.sort((a, b) => Date.parse(a.la) - Date.parse(b.la));
  for (const e of evenimente) await e.fa(e.la);
  await ok(db.rpc("proceseaza_evenimente_restante"), "evenimente");

  /* Luna in curs: lista in lucru si citirile transmise pana acum, cu poza */
  await ok(db.schema("intretinere").rpc("deschide_lista", { p_bloc_id: bloc, p_luna: luna1(D.LUNA_CIORNA) }), "ciorna");
  const c = D.CITIRI_LUNA_CURENTA;
  const cuPoza = async (numar, extra) => {
    const cale = `${bloc}/${ap[numar]}/contor-${D.LUNA_CIORNA}.jpg`;
    await ok(db.storage.from("poze").upload(cale, POZA_CONTOR, { contentType: "image/jpeg", upsert: true }), "poza contor");
    for (const tip of ["rece", "calda"]) {
      await citeste(numar, tip, D.LUNA_CIORNA, D.consumApartament(numar, D.LUNA_CIORNA, tip), { transmisa_la: c.dataTransmitere, poza_cale: cale, ...extra });
    }
  };
  for (const n of c.validate) await cuPoza(n, { stare: "validata", verificata_la: c.dataTransmitere, verificata_de: admin });
  for (const n of c.trimise) await cuPoza(n, { stare: "trimisa", verificata_de: null });
  for (const r of c.respinse) {
    /* citirea respinsa nu muta indexul de la care porneste urmatoarea */
    const inainte = ["rece", "calda"].map((tip) => [`${ap[r.numar]}:${tip}`, ultimIndex[`${ap[r.numar]}:${tip}`]]);
    await cuPoza(r.numar, { stare: "respinsa", motiv_respingere: r.motiv, verificata_la: c.dataTransmitere, verificata_de: admin });
    inainte.forEach(([k, v]) => { ultimIndex[k] = v; });
  }

  /* Sesizarile, cu conversatia si pozele lor */
  for (const s of D.SESIZARI) {
    const ses = await ok(db.schema("sesizari").from("sesizari").insert({
      bloc_id: bloc, apartament_id: ap[s.numar], autor_id: locatarAp(s.numar) || admin, categorie: s.categorie, titlu: s.titlu,
      descriere: s.descriere, stare: s.stare, creat_la: s.creataLa, preluata_la: s.preluataLa || null,
      preluata_de: s.preluataLa ? admin : null, rezolvata_la: s.rezolvataLa || null,
    }).select().single(), `sesizare ${s.cheie}`);
    for (const m of s.mesaje) {
      await ok(db.schema("sesizari").from("sesizari_mesaje").insert({ sesizare_id: ses.id, autor_id: admin, din_administratie: m.dinAdministratie, text: m.text, creat_la: m.la }), "mesaj");
    }
    for (let i = 0; i < s.poze; i += 1) {
      const cale = `${bloc}/${ap[s.numar]}/sesizare-${s.cheie}-${i + 1}.jpg`;
      await ok(db.storage.from("poze").upload(cale, POZA_SESIZARE, { contentType: "image/jpeg", upsert: true }), "poza sesizare");
      await ok(db.schema("sesizari").from("sesizari_poze").insert({ sesizare_id: ses.id, cale }), "poza");
    }
  }

  /* Avizierul si cine a citit fiecare anunt */
  for (const a of D.ANUNTURI) {
    const an = await ok(db.schema("comunicare").from("anunturi").insert({
      asociatie_id: asoc, bloc_id: bloc, autor_id: admin, titlu: a.titlu, corp: a.corp, urgent: a.urgent, publicat_la: a.publicatLa, creat_la: a.publicatLa,
    }).select().single(), "anunt");
    const cititori = a.cititDe.map(locatarAp).filter(Boolean);
    if (cititori.length) await ok(db.schema("comunicare").from("anunturi_citiri").insert(cititori.map((p) => ({ anunt_id: an.id, profil_id: p, citit_la: a.publicatLa }))), "citiri anunt");
  }

  /* Votul deschis, cu voturile de pe buletinele de hartie */
  const vot = await ok(db.schema("guvernanta").from("voturi").insert({
    asociatie_id: asoc, titlu: D.VOT.titlu, descriere: D.VOT.descriere, deschis_la: D.VOT.deschisLa, inchide_la: D.VOT.inchideLa,
    numarare: D.VOT.numarare, creat_de: admin, creat_la: D.VOT.deschisLa,
  }).select().single(), "vot");
  const optiuni = await ok(db.schema("guvernanta").from("voturi_optiuni").insert(D.VOT.optiuni.map((text, i) => ({ vot_id: vot.id, text, ordine: i + 1 }))).select(), "optiuni");
  const optiune = (i) => optiuni.find((o) => o.ordine === i + 1).id;
  await ok(db.schema("guvernanta").from("voturi_exprimate").insert(Object.entries(D.VOT.voturi).map(([numar, i]) => ({
    vot_id: vot.id, optiune_id: optiune(i), apartament_id: ap[numar], profil_id: null, creat_la: D.VOT.deschisLa,
  }))), "voturi");

  const adunare = await ok(db.schema("guvernanta").from("adunari_generale").insert({
    asociatie_id: asoc, data_ora: D.ADUNARE.dataOra, loc: D.ADUNARE.loc, ordine_de_zi: D.ADUNARE.ordineDeZi, convocata_de: admin, creat_la: D.ADUNARE.convocataLa,
  }).select().single(), "adunare");
  await ok(db.schema("guvernanta").from("adunari_prezente").insert(D.ADUNARE.prezente.map((numar) => ({
    adunare_id: adunare.id, apartament_id: ap[numar], confirmat_la: D.ADUNARE.convocataLa,
  }))), "prezente");

  /* Instiintarea de restanta trimisa pe 1 septembrie */
  const pIlie = locatarAp("3");
  await ok(db.schema("comunicare").from("notificari").insert({
    profil_id: pIlie, asociatie_id: asoc, tip: "restanta", titlu: "Instiintare de plata",
    corp: "Aveti sume neachitate trecute de scadenta. Va rugam sa le achitati ca sa opriti penalizarile.", trimisa_la: "2026-09-01T09:00:00+03:00",
  }), "instiintare");

  /* Notificarile generate de handlere poarta data rejucarii; le aducem la data
     evenimentului, iar pe cele mai vechi de doua saptamani le marcam citite. */
  const notificari = await ok(db.schema("comunicare").from("notificari").select("id, referinta, tip, trimisa_la"), "notificari");
  const liste = await ok(db.schema("intretinere").from("liste_lunare").select("id, publicata_la").eq("bloc_id", bloc), "liste");
  const plati = await ok(db.schema("financiar").from("plati").select("id, confirmata_la").eq("bloc_id", bloc), "plati");
  const acum = Date.now();
  for (const n of notificari) {
    /* Notificarile scrise direct (instiintarea de restanta) nu au referinta,
       dar au data lor: si ele intra sub regula celor doua saptamani, ca in
       sursa demonstrativa. */
    let la = n.trimisa_la;
    if (n.referinta && n.referinta.lista_id) la = (liste.find((l) => l.id === n.referinta.lista_id) || {}).publicata_la;
    if (n.referinta && n.referinta.plata_id) la = (plati.find((p) => p.id === n.referinta.plata_id) || {}).confirmata_la;
    if (!la) continue;
    const vechi = acum - Date.parse(la) > 14 * 86400000;
    await ok(db.schema("comunicare").from("notificari").update({ trimisa_la: la, citita_la: vechi ? la : null }).eq("id", n.id), "notificare");
  }

  const ramase = await ok(db.rpc("proceseaza_evenimente_restante"), "evenimente");
  console.log(`Gata. Evenimente procesate la final: ${ramase}.`);
}

main().catch((e) => {
  console.error("Seed esuat:", e.message);
  process.exit(1);
});
