/* Ajutoare comune pentru testele end-to-end.

   Testele conduc aplicatia reala peste stack-ul Supabase local. Unde ecranul nu
   poate produce o stare (un administrator respins, un presedinte, un fost
   locatar), starea se face aici, cu cheia de serviciu, exact ca dezvoltatorul
   din §8 al hartii functiilor. */

import { deflateSync } from "node:zlib";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { adresaContului, normalizeazaTelefon } from "../../supabase/functions/_shared/telefon.js";
import { expect } from "@playwright/test";

export const URL_SUPABASE = "http://127.0.0.1:54321";
export const CHEIE_SERVICIU = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const CHEIE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const PAROLA = "Bloc-D14-2026";

/* Ziua de azi asa cum o vad baza (Europe/Bucharest) si aplicatia (fusul din
   playwright.config.js). `new Date().toISOString()` da ziua UTC: intre 00:00 si
   03:00, ora Romaniei, aceea este inca ziua de ieri, iar testele care compara
   scadente sau leaga un locatar "de azi" cad fara ca aplicatia sa aiba ceva.
   Acelasi bug ca T2 din auditul 2. */
export const aziRo = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Bucharest" });
export const ziRo = (peste) =>
  new Date(Date.now() + peste * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/Bucharest" });

/* Ziua scrisa ca in aplicatie: "21 sep 2026" (dataRo din AdminBloc.jsx) */
const LUNI_SCURTE = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "noi", "dec"];
export function dataScurtaRo(iso = aziRo()) {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${LUNI_SCURTE[Number(m) - 1]} ${y}`;
}
/* Conturile demo, pe numarul lor de telefon (src/date-demo.js) */
export const CONTURI = {
  admin: "0745 210 118",
  elena: "0733 410 217",
  ilie: "0726 331 003",
  voicu: "0741 002 101",
  adminNou: "0755 900 800",
};

let cacheServiciu = null;
export function serviciu() {
  if (!cacheServiciu) {
    cacheServiciu = createClient(URL_SUPABASE, CHEIE_SERVICIU, { auth: { persistSession: false } });
  }
  return cacheServiciu;
}

/* Blocul demo D14 si asociatia lui, cautate o singura data pe rulare */
let cacheBloc = null;
export async function blocD14() {
  if (cacheBloc) return cacheBloc;
  const sb = serviciu();
  const { data, error } = await sb.schema("organizare").from("blocuri")
    .select("id, denumire, asociatie_id").ilike("denumire", "%D14%").single();
  if (error) throw new Error(`Nu gasesc blocul demo D14: ${error.message}`);
  cacheBloc = data;
  return data;
}

/* Identificatorii din baza se schimba la fiecare `supabase db reset && npm run
   seed`, deci niciun test nu are voie sa-i scrie de mana: se cauta aici, o
   singura data pe rulare, dupa ceva stabil (denumirea blocului, luna listei,
   titlul votului). */
/* [K6] O lista nu se mai publica peste citiri trimise. Testele care nu sunt
   despre citiri le trec pe validate cu cheia de serviciu, ca dupa un
   administrator care a terminat deja ecranul "Citiri contoare". `luna` este
   prima zi a lunii ("2026-09-01"). */
export async function verificaCitirileLunii(blocId, luna) {
  const { error } = await serviciu().schema("contorizare").from("citiri")
    .update({ stare: "validata", verificata_la: new Date().toISOString() })
    .eq("bloc_id", blocId).eq("luna", luna).eq("stare", "trimisa");
  if (error) throw new Error(`verificaCitirileLunii: ${error.message}`);
}

export async function asociatieD14() {
  return (await blocD14()).asociatie_id;
}

/* Dupa un `supabase db reset && npm run seed` toate identificatoarele sunt
   altele: ce s-a gasit o data pe rulare nu mai este valabil. */
export function uitaCache() {
  cacheBloc = null;
  cacheServiciu = null;
}

/* Lista lunara a lui D14: dupa stare ("ciorna" / "publicata") sau dupa luna */
export async function listaLunara({ stare, luna }) {
  const b = await blocD14();
  let q = serviciu().schema("intretinere").from("liste_lunare").select("*").eq("bloc_id", b.id);
  if (stare) q = q.eq("stare", stare);
  if (luna) q = q.eq("luna", luna);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  if (!data.length) throw new Error(`Nu gasesc lista ${stare || ""} ${luna || ""} a blocului D14`);
  return data.sort((x, y) => String(y.luna).localeCompare(String(x.luna)))[0];
}

export async function votDupaTitlu(titlu) {
  const { data, error } = await serviciu().schema("guvernanta").from("voturi")
    .select("*").eq("asociatie_id", await asociatieD14()).eq("titlu", titlu).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Nu gasesc votul "${titlu}"`);
  return data;
}

export async function apartamente() {
  const b = await blocD14();
  const { data, error } = await serviciu().schema("organizare").from("apartamente")
    .select("*").eq("bloc_id", b.id);
  if (error) throw new Error(error.message);
  return data.sort((x, y) => x.numar.localeCompare(y.numar, "ro", { numeric: true }));
}

export async function apartamentulNumarul(numar) {
  const toate = await apartamente();
  const ap = toate.find((a) => a.numar === String(numar));
  if (!ap) throw new Error(`Apartamentul ${numar} nu exista in D14`);
  return ap;
}

export async function profilDupaTelefon(telefon) {
  const { data, error } = await serviciu().schema("identitate").from("profiluri")
    .select("*").eq("telefon", normalizeazaTelefon(telefon)).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/* Cont nou in Auth, pe numar de telefon, ca cele facute de administrator din
   aplicatie (adresa interna vine din numar). */
export async function creeazaCont(telefon, nume) {
  const sb = serviciu();
  const numar = normalizeazaTelefon(telefon);
  const existent = await profilDupaTelefon(numar);
  if (existent) return existent.id;
  const { data, error } = await sb.auth.admin.createUser({
    email: adresaContului(numar), phone: `+4${numar}`, password: PAROLA,
    email_confirm: true, phone_confirm: true, user_metadata: { nume, telefon: numar },
  });
  if (error) throw new Error(`createUser ${numar}: ${error.message}`);
  return data.user.id;
}

export async function stergeCont(telefon) {
  const p = await profilDupaTelefon(telefon);
  if (!p) return;
  const sb = serviciu();
  await sb.schema("comunicare").from("anunturi_citiri").delete().eq("profil_id", p.id);
  await sb.schema("comunicare").from("notificari").delete().eq("profil_id", p.id);
  await sb.schema("guvernanta").from("voturi_exprimate").delete().eq("profil_id", p.id);
  await sb.schema("guvernanta").from("adunari_prezente").delete().eq("profil_id", p.id);
  await sb.schema("identitate").from("locatari").delete().eq("profil_id", p.id);
  await sb.schema("identitate").from("membri_asociatie").delete().eq("profil_id", p.id);
  await sb.schema("identitate").from("administratori").delete().eq("profil_id", p.id);
  await sb.auth.admin.deleteUser(p.id).catch(() => {});
}

/* Numerele conturilor temporare incep cu 0799: curatenia le sterge pe toate,
   deci conturile fixe ale testelor stau in alt interval (0798). */
export const TELEFON_TEMPORAR = "0799";
let contorTemporar = 0;
export const telefonTemporar = () => `${TELEFON_TEMPORAR}${String((Date.now() % 1000000) + (contorTemporar += 1)).padStart(6, "0")}`;

/* Conturile temporare ale rularilor trecute, ca baza demo sa nu creasca */
export async function curataConturiTemporare() {
  const { data } = await serviciu().schema("identitate").from("profiluri").select("telefon").like("telefon", `${TELEFON_TEMPORAR}%`);
  for (const p of data || []) await stergeCont(p.telefon);
}

/* Leaga un cont de un apartament, direct, fara Edge Function */
export async function legaDeApartament(profilId, apartamentId, calitate = "proprietar") {
  const b = await blocD14();
  const sb = serviciu();
  const { data } = await sb.schema("identitate").from("locatari")
    .select("id").eq("profil_id", profilId).eq("apartament_id", apartamentId).is("activ_pana", null).maybeSingle();
  if (data) return data.id;
  const { data: nou, error } = await sb.schema("identitate").from("locatari").insert({
    apartament_id: apartamentId, bloc_id: b.id, profil_id: profilId, calitate,
    activ_din: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  }).select("id").single();
  if (error) throw new Error(`legaDeApartament: ${error.message}`);
  return nou.id;
}

export async function soldApartament(apartamentId) {
  const { data, error } = await serviciu().schema("financiar").from("datorii_rest")
    .select("rest").eq("apartament_id", apartamentId).gt("rest", 0);
  if (error) throw new Error(error.message);
  return Math.round(data.reduce((s, d) => s + Number(d.rest), 0) * 100) / 100;
}

/* O datorie proaspata, scadenta in viitor (deci nu devine restanta si nu
   schimba lista restantierilor), pentru testele care chiar platesc. */
export async function datorieDeTest(apartamentId, suma, descriere = "Datorie de test e2e") {
  const b = await blocD14();
  const scadenta = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await serviciu().schema("financiar").from("datorii").insert({
    apartament_id: apartamentId, bloc_id: b.id, tip: "sold_initial",
    suma, scadenta, descriere,
  }).select("id").single();
  if (error) throw new Error(`datorieDeTest: ${error.message}`);
  return data.id;
}

/* ---------- navigare in aplicatie ---------- */

export async function deschide(page) {
  await page.goto("/");
  await expect(page.getByText("AdminBloc").first()).toBeVisible();
}

export async function intra(page, telefon, parola = PAROLA) {
  await page.goto("/");
  await page.getByRole("heading", { name: "Intra in cont" }).or(page.getByText("Intra in cont").first()).first().waitFor();
  /* Testele de aici verifica aplicatia peste stack-ul local. Daca ea a pornit
     fara adresa serverului, merge pe date din memorie: ecranele arata la fel,
     dar nimic nu ajunge in baza, iar sute de teste pica fara sa spuna de ce.
     Asa a fost pe CI pana la 21 septembrie. Mai bine un singur mesaj limpede. */
  if (await page.getByText("Mod demonstrativ, fara server").isVisible()) {
    throw new Error("Aplicatia a pornit in modul demonstrativ: lipsesc VITE_SUPABASE_URL si VITE_SUPABASE_ANON_KEY (vezi webServer.env in playwright.config.js).");
  }
  await page.getByLabel("Numarul tau de telefon").fill(telefon);
  await page.getByLabel("Parola").fill(parola);
  await page.getByRole("button", { name: "Intra", exact: true }).click();
}

export async function intraCa(page, cheie) {
  await intra(page, CONTURI[cheie]);
  await expect(page.getByRole("button", { name: "Iesi", exact: true })).toBeVisible({ timeout: 20000 });
}

/* Numele accesibil al unui tab include badge-ul: "Sesizari 2" */
export const tab = (page, nume) => page.getByRole("tab", { name: new RegExp(`^${nume}( \\d+)?$`) });

export async function mergiLaTab(page, nume) {
  await tab(page, nume).click();
}

export const buton = (page, nume) => page.getByRole("button", { name: nume, exact: true });

/* Mesajul zburator (role=status) al unei comenzi */
export async function asteaptaToast(page, fragment) {
  await expect(page.locator(".ab-toast")).toContainText(fragment, { timeout: 20000 });
}

/* Textul ecranului, fara bara de sus (care arata numele celui autentificat).
   Pentru verificari de tipul "nicaieri pe ecran nu scrie X". */
export const textEcran = (page) => page.locator(".ab-shell > .ab-scroll").innerText();
export const textTot = (page) => page.locator(".ab-shell").innerText();

/* Cuvintele care tradeaza un mesaj tehnic scapat pe ecran */
export const CUVINTE_TEHNICE = [
  "PGRST", "duplicate key", "violates", "row-level security", "constraint",
  "null value", "Failed to fetch", "TypeError", "undefined", "NaN",
  "Error:", "500", "permission denied", "does not exist", "invalid input",
];

export function fisierPoza(nume = "contor.jpg") {
  /* JPEG minim valid, 1x1 px, ca sa treaca de micsoreazaPoza si de bucket */
  const base64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    + "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAA"
    + "AAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
  return { name: nume, mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") };
}

/* O poza adevarata, cu laturile ei: telefonul tinut vertical da o poza mult
   mai inalta decat lata. PNG scris de mana (semnatura, IHDR, IDAT, IEND) ca
   sa nu aduca nicio librarie; aplicatia o trece oricum prin `micsoreazaPoza`,
   care o reduce la 1600 px si o salveaza JPEG. */
export function fisierPozaPortret(latime = 480, inaltime = 960, nume = "contor-portret.png") {
  const crcTabel = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i += 1) c = crcTabel[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const bucata = (tip, date) => {
    const lungime = Buffer.alloc(4);
    lungime.writeUInt32BE(date.length);
    const corp = Buffer.concat([Buffer.from(tip, "latin1"), date]);
    const suma = Buffer.alloc(4);
    suma.writeUInt32BE(crc32(corp));
    return Buffer.concat([lungime, corp, suma]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(latime, 0);
  ihdr.writeUInt32BE(inaltime, 4);
  ihdr[8] = 8; /* 8 biti pe canal */
  ihdr[9] = 2; /* truecolor RGB */
  const brut = Buffer.alloc(inaltime * (1 + latime * 3));
  for (let y = 0; y < inaltime; y += 1) {
    const rand = y * (1 + latime * 3);
    brut[rand] = 0;
    for (let x = 0; x < latime; x += 1) {
      const p = rand + 1 + x * 3;
      /* Dungi orizontale, ca pe rola unui contor */
      const val = y % 40 < 20 ? 30 : 220;
      brut[p] = val; brut[p + 1] = val; brut[p + 2] = val;
    }
  }
  const octeti = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bucata("IHDR", ihdr),
    bucata("IDAT", deflateSync(brut)),
    bucata("IEND", Buffer.alloc(0)),
  ]);
  return { name: nume, mimeType: "image/png", buffer: octeti };
}

/* ---------- descarcari si PDF ---------- */

/* Apasa butonul si intoarce { nume, octeti } ai fisierului descarcat */
export async function descarca(page, actiune) {
  const asteptare = page.waitForEvent("download");
  await actiune();
  const d = await asteptare;
  const cale = await d.path();
  const { readFile } = await import("node:fs/promises");
  return { nume: d.suggestedFilename(), octeti: await readFile(cale) };
}

/* Textul unui PDF scris de src/pdf.js: fluxurile nu sunt comprimate, deci
   ajunge sa adunam argumentele operatorului Tj. */
export function textPdf(octeti) {
  const brut = octeti.toString("latin1");
  const bucati = [];
  const re = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
  let m = re.exec(brut);
  while (m) {
    bucati.push(m[1].replace(/\\([()\\])/g, "$1"));
    m = re.exec(brut);
  }
  return bucati.join("\n");
}

export function fisierPdf(nume = "factura.pdf") {
  const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    + "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    + "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
    + "trailer<</Root 1 0 R>>\n%%EOF\n";
  return { name: nume, mimeType: "application/pdf", buffer: Buffer.from(pdf, "utf8") };
}

/* Datele demo, de la zero: unele scenarii (ciclul lunii, doua luni, anul nou)
   schimba starea blocului si o refac la loc.
   `supabase db reset` poate lasa oprit containerul care serveste Edge
   Functions, iar seed-ul are nevoie de el (publicarea listelor trece prin
   publica-lista): fara repornire, seed-ul cade, baza ramane goala si tot ce
   urmeaza in suita asteapta degeaba. */
export function refaBaza() {
  execSync("supabase db reset", { cwd: process.cwd(), stdio: "pipe", timeout: 600000 });
  try {
    execSync("supabase start", { cwd: process.cwd(), stdio: "pipe", timeout: 600000 });
  } catch { /* stiva pornita deja */ }
  execSync("npm run seed", { cwd: process.cwd(), stdio: "pipe", timeout: 600000 });
}
