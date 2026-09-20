/* =============================================================================
   Fixture pentru testele de integrare ale sursei Supabase
   -----------------------------------------------------------------------------
   Baza locala este comuna cu alte teste (pgTAP), iar aceste teste fac COMMIT.
   De aceea nu atingem datele demo D14 decat la citire: pentru orice flux care
   scrie, fiecare rulare isi construieste propria asociatie, cu CUI si emailuri
   unice, prin comenzile reale ale backend-ului (creeaza-asociatie,
   confirma_inrolare, activeaza_bloc), ca seed-ul. Testele se pot rula oricat
   de des, fara `supabase db reset`.
============================================================================= */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { URL_LOCAL, ANON_LOCAL, SERVICE_LOCAL, PAROLA_TEST } from "../setup-integrare.js";
import { creeazaSursaSupabase } from "../../src/sursa-supabase.js";

export { URL_LOCAL, ANON_LOCAL, SERVICE_LOCAL, PAROLA_TEST };

/* Clientul dezvoltatorului: adevarul din baza, peste RLS */
export const serviciu = createClient(URL_LOCAL, SERVICE_LOCAL, { auth: { persistSession: false, autoRefreshToken: false } });
export const db = (schema) => serviciu.schema(schema);

export async function ok(promisiune, ce = "fixture") {
  const { data, error } = await promisiune;
  if (error) throw new Error(`${ce}: ${error.message}`);
  return data;
}

let contor = 0;
export const unic = () => `${Date.now().toString(36)}${(contor += 1)}${Math.random().toString(36).slice(2, 6)}`;

/* Datele se decid in baza, care ruleaza pe ora Romaniei (migratia
   fus_orar_romania): `current_date` si `date_trunc('month', current_date)` sunt
   cele de la Bucuresti, nu din UTC. Intre miezul noptii de la Bucuresti si cel
   din UTC sunt doua-trei ore in care ziua (si, pe 1 ale lunii, luna) difera,
   asa ca fixture-ul le calculeaza tot pe ora Romaniei. */
const FORMAT_BUCURESTI = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
});
export const azi = () => FORMAT_BUCURESTI.format(new Date());

/* [J9] Ora serii (20:00) a unei zile date, ca ora a Romaniei — indiferent
   de fusul masinii care ruleaza testul. Acelasi procedeu ca in
   src/sursa-supabase.js (deschideVot) si src/sursa-mock.js
   (offsetRomania/oraSeriiRomania): testele care verifica ora de inchidere a
   unui vot trebuie sa astepte instantul UTC corect, chiar daca procesul de
   test forteaza un alt TZ. */
function offsetRomania(dataText) {
  const aprox = new Date(`${dataText}T20:00:00Z`);
  const ore = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Bucharest", timeZoneName: "shortOffset", hour12: false })
    .formatToParts(aprox).find((p) => p.type === "timeZoneName").value.replace("GMT+", "");
  return `+${ore.padStart(2, "0")}:00`;
}
export const oraSeriiRomania = (dataText) => `${dataText}T20:00:00${offsetRomania(dataText)}`;
export function lunaDelta(delta) {
  const [an, luna] = azi().split("-").map(Number);
  const t = new Date(Date.UTC(an, luna - 1 + delta, 1));
  return t.toISOString().slice(0, 7);
}
export const lunaCurenta = () => lunaDelta(0);
export const zi1 = (l) => `${l}-01`;

/* Fisiere de test: pozele demo (JPEG) si un PDF minim */
const POZA = readFileSync(new URL("../../scripts/date-demo/contor.jpg", import.meta.url));
export const pozaJpeg = (nume = "contor.jpg") => new File([POZA], nume, { type: "image/jpeg" });
export const pdf = (nume = "document.pdf") => new File([Buffer.from("%PDF-1.4\n%%EOF\n")], nume, { type: "application/pdf" });

/* O sursa noua, cu sesiunea ei (fiecare client tine sesiunea in memorie) */
export const sursaNoua = () => creeazaSursaSupabase(URL_LOCAL, ANON_LOCAL);
export async function intraCa(email, { incarca = true } = {}) {
  const s = sursaNoua();
  await s.intra(email, PAROLA_TEST);
  const date = incarca ? await s.incarca() : null;
  return { s, date };
}

/* Un cont nou, confirmat, cu sesiunea deschisa. Inregistrarea prin aplicatie
   nu mai deschide sesiune: Auth cere confirmarea emailului (config.toml,
   [auth.email] enable_confirmations), iar testele nu citesc cutia postala. */
export async function contNou({ email, nume, telefon } = {}) {
  const c = await creeazaCont({ email, nume, telefon });
  const s = sursaNoua();
  await s.intra(c.email, PAROLA_TEST);
  return { s, profilId: c.id, email: c.email };
}

export async function functie(nume, corp) {
  const r = await fetch(`${URL_LOCAL}/functions/v1/${nume}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_LOCAL}`, "Content-Type": "application/json" },
    body: JSON.stringify(corp),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${nume}: ${j.eroare || JSON.stringify(j)}`);
  return j;
}

export async function creeazaCont({ email, nume, telefon } = {}) {
  const e = email || `cont-${unic()}@adminbloc.test`;
  const metadate = {};
  if (nume !== undefined) metadate.nume = nume;
  if (telefon !== undefined) metadate.telefon = telefon;
  const { data, error } = await serviciu.auth.admin.createUser({ email: e, password: PAROLA_TEST, email_confirm: true, user_metadata: metadate });
  if (error) throw new Error(`cont ${e}: ${error.message}`);
  return { id: data.user.id, email: e };
}

/* Apartamentele implicite: cotele insumeaza 100; "2A" verifica sortarea */
export const APARTAMENTE = [
  { numar: "1", etaj: 0, persoane: 2, cota: 20, suprafata: 40, scutit_lift: true, index_rece: 10, index_calda: 5 },
  { numar: "2", etaj: 1, persoane: 3, cota: 30, suprafata: 55, index_rece: 20, index_calda: 8 },
  { numar: "2A", etaj: 1, persoane: 1, cota: 15, suprafata: 30, index_rece: 30, index_calda: 9 },
  { numar: "10", etaj: 3, persoane: 4, cota: 35, suprafata: 70, index_rece: 40, index_calda: 12 },
];

/* Contoarele generale pornesc de la aceste indexuri */
export const PORNIRE_GENERAL = { rece: 1000, calda: 500 };

/*
 * Construieste o asociatie noua, activa, cu administratorul ei.
 *   apartamente: [{ numar, etaj, persoane, cota, suprafata, scutit_lift, index_rece, index_calda, restanta, luna_start }]
 *   locatari:    [{ cheie, apartament, calitate, activDin, activPana, nume, telefon }]
 *   blocDoi:     true adauga al doilea bloc (neactivat) in aceeasi asociatie
 */
export async function creeazaBloc({ apartamente = APARTAMENTE, locatari = [], blocDoi = false, lunaStart = lunaDelta(-1) } = {}) {
  const id = unic();
  const cui = `RO${id}`.toUpperCase();
  const an = new Date().getUTCFullYear();
  const corp = (denumire) => ({
    asociatie: {
      denumire: `Asociatia de test ${id}`, cui, iban: "RO49AAAA1B31007593840000", banca: "Banca Test",
      adresa: "Str. Testelor nr. 1", telefon: "0700 000 000", email: `asociatie-${id}@adminbloc.test`,
    },
    setari: { chitantaSerie: `T${id.slice(-4).toUpperCase()}` },
    bloc: { denumire, adresa: "Str. Testelor nr. 1", etaje: 4, ziLimitaCitire: 25, rulmentPerApartament: 100 },
    administrator: {
      email: `admin-${id}@adminbloc.test`, parola: PAROLA_TEST, nume: `Administrator ${id}`, telefon: "0711 111 111",
      atestat: `AT-${id}`, activDin: `${an - 1}-01-01`,
    },
  });
  const creata = await functie("creeaza-asociatie", corp(`Bloc test ${id}`));
  const f = {
    id, cui, asociatieId: creata.asociatie_id, blocId: creata.bloc_id, adminId: creata.administrator,
    adminEmail: `admin-${id}@adminbloc.test`, denumireAsociatie: `Asociatia de test ${id}`, lunaStart,
    ap: {}, conturi: {}, locatari: {}, contoare: {}, general: {},
  };

  for (const a of apartamente) {
    const rand = await ok(db("organizare").from("inrolare_apartamente").insert({
      bloc_id: f.blocId, numar: a.numar, sursa: "operator",
      date: {
        etaj: a.etaj, proprietar: a.proprietar === undefined ? `Proprietar ${a.numar}` : a.proprietar, persoane: a.persoane, cota: a.cota,
        suprafata: a.suprafata, scutit_lift: a.scutit_lift, luna_start: zi1(a.luna_start || lunaStart),
        index_rece: a.index_rece, index_calda: a.index_calda, serie_rece: `R-${id}-${a.numar}`, serie_calda: `C-${id}-${a.numar}`,
        ...(a.restanta ? { restanta: a.restanta, restanta_scadenta: zi1(lunaStart), restanta_descriere: `Restanta de pe hartie ${a.numar}` } : {}),
      },
    }).select().single(), `inrolare ${a.numar}`);
    f.ap[a.numar] = await ok(db("organizare").rpc("confirma_inrolare", { p_inrolare_id: rand.id }), `confirmare ${a.numar}`);
  }
  await ok(serviciu.rpc("proceseaza_evenimente_restante"), "ApartamentCreat");

  const contoare = await ok(db("contorizare").from("contoare").select("id, apartament_id, tip").eq("bloc_id", f.blocId), "contoare");
  for (const c of contoare) {
    const numar = Object.keys(f.ap).find((n) => f.ap[n] === c.apartament_id);
    f.contoare[`${numar}:${c.tip}`] = c.id;
  }
  for (const tip of ["rece", "calda"]) {
    const g = await ok(db("contorizare").from("contoare").insert({ bloc_id: f.blocId, tip, serie: `GEN-${tip}-${id}`, amplasare: "subsol" }).select().single(), "contor general");
    f.general[tip] = g.id;
    await ok(db("contorizare").from("citiri").insert({
      contor_id: g.id, tip, bloc_id: f.blocId, luna: zi1(lunaStart), index_anterior: PORNIRE_GENERAL[tip], index_curent: PORNIRE_GENERAL[tip],
      sursa: "pornire", stare: "validata",
    }), "pornire general");
  }
  await ok(db("organizare").rpc("activeaza_bloc", { p_bloc_id: f.blocId }), "activare");

  for (const l of locatari) {
    const cont = await creeazaCont({ nume: l.nume === undefined ? `Locatar ${l.cheie} ${id}` : l.nume, telefon: l.telefon });
    f.conturi[l.cheie] = cont;
    const rand = await ok(db("identitate").from("locatari").insert({
      apartament_id: f.ap[l.apartament], bloc_id: f.blocId, profil_id: cont.id, calitate: l.calitate || "proprietar",
      activ_din: l.activDin || `${an - 1}-01-01`, activ_pana: l.activPana || null,
    }).select().single(), `locatar ${l.cheie}`);
    f.locatari[l.cheie] = rand.id;
  }

  if (blocDoi) {
    const doi = await functie("creeaza-asociatie", { ...corp(`Bloc doi ${id}`), administrator: undefined });
    f.blocDoiId = doi.bloc_id;
  }
  return f;
}

/* Inlocuieste fetch-ul global pe durata lui fn. interceptor(url, init, original)
   intoarce un Response (sau arunca) ca sa simuleze reteaua; undefined lasa
   cererea sa treaca. */
export async function cuFetch(interceptor, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url || String(input);
    const r = await interceptor(url, init || {}, original);
    return r === undefined ? original(input, init) : r;
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

export const json = (corp, status = 200) => new Response(JSON.stringify(corp), { status, headers: { "Content-Type": "application/json" } });
