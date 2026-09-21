/* =============================================================================
   AdminBloc, administrarea transparenta a unui bloc de locuinte
   -----------------------------------------------------------------------------
   Structura fisierului este gandita pentru portare rapida in React Native:

   1. TOKENS      -> devine theme.js (obiecte simple, fara CSS)
   2. HELPERS     -> pur JavaScript, se copiaza fara modificari
   3. CONSTANTE   -> etichetele afisate, pur JavaScript
   4. DERIVARI    -> ce se afiseaza, calculat din datele incarcate, pur JavaScript
   5. PRIMITIVE   -> Box/Txt/Btn, singurele componente care ating DOM-ul
   6. STARE       -> un singur Context cu datele si comenzile
   7. RandLista   -> elementul semnatura
   8-9. ECRANE    -> folosesc doar primitivele, deci se porteaza fara rescriere
   10-11. SHELL SI APLICATIA

   Cifrele nu se calculeaza aici. Sumele din lista de plata sunt produse o
   singura data de motorul de repartizare (supabase/functions/_shared/motor.js)
   la publicarea listei si se citesc gata calculate. Datoriile, platile si
   penalizarile vin din registrul financiar. Ecranele doar le aduna si le
   explica, deci lista locatarului si raportul administratorului nu pot sa se
   contrazica.

   Harta de portare:
     <Box>            -> <View>
     <Txt>            -> <Text>
     <Btn>            -> <Pressable>
     <Imagine>        -> <Image>
     .map() pe liste  -> <FlatList>
     style={{...}}    -> StyleSheet.create({...}) (aceleasi chei flexbox)
     onChange input   -> onChangeText TextInput
     ecranele/tab bar -> @react-navigation/bottom-tabs

   Regula respectata peste tot: layout doar cu flexbox, fara grid, fara
   pseudo-selectori, fara unitati CSS in afara de px, fara librarii de UI.
============================================================================= */

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { calculeazaLista, verificaDate } from "../supabase/functions/_shared/motor.js";
import { documentPdf, scurteazaNume } from "./pdf.js";
import { creeazaSursa } from "./sursa.js";

/* =============================================================================
   1. TOKENS
   Paleta pleaca de la materialele locului: gri de beton, hartia listei de plata
   afisate la avizier si verdele de ulei de pe peretii casei scarii.
============================================================================= */

const C = {
  paper: "#EDEEE9",
  paperDeep: "#E3E5DE",
  surface: "#FFFFFF",
  ink: "#1A1D1B",
  inkSoft: "#4A4F4B",
  /* [F13] gri verificat pe hartie (5,19:1) si pe fundalul mai inchis (4,76:1) */
  muted: "#5F645E",
  line: "#DBDDD5",
  lineStrong: "#C3C6BC",
  accent: "#2F5D50",
  accentSoft: "#DFE9E4",
  accentLine: "#CBDDD6",
  accentInk: "#1D3E35",
  warn: "#8A6410",
  warnSoft: "#F5EBD5",
  warnLine: "#E8D7B4",
  danger: "#93312A",
  dangerSoft: "#F6E3E0",
  dangerLine: "#E8CFCA",
  ok: "#2C6142",
  okSoft: "#E1EDE4",
  okLine: "#C9DED0",
  info: "#2C4C6B",
  infoSoft: "#E0E8EF",
  white: "#FFFFFF",
  toast: "#F2F3F0",
  scrim: "rgba(20,24,21,.42)",
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
const R = { sm: 4, md: 8, lg: 12, pill: 999 };

const F = {
  ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  num: '"SF Mono", ui-monospace, "Roboto Mono", Menlo, monospace',
};

/* eyebrow: eticheta mica, majuscule, spatiata, ca pe formularele tipizate */
const eyebrow = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1.1,
  textTransform: "uppercase",
  color: C.muted,
};

/* =============================================================================
   2. HELPERS
============================================================================= */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const suma = (arr, f) => round2(arr.reduce((s, x) => s + f(x), 0));

/* Formatare romaneasca: 1.234,56 lei. Scrisa de mana ca sa nu depinda de Intl,
   care nu este garantat complet pe toate build-urile React Native. */
function lei(n, withUnit = true) {
  const neg = n < 0;
  const v = Math.abs(round2(n)).toFixed(2);
  const [int, dec] = v.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${grouped},${dec}${withUnit ? " lei" : ""}`;
}

function num(n, d = 2) {
  return Number(n).toFixed(d).replace(".", ",");
}

/* [G5] Cota indiviza e numeric(7,4) in baza. Precompletarea unui camp de
   corectie cu num() (2 zecimale) ar rotunji-o, iar o corectie care nu
   atinge cota ar retrimite valoarea rotunjita: dupa mai multe apartamente
   suma blocului se departeaza de 100%, fara ca nimeni sa fi umblat la vreo
   cota. Foloseste cele mai putine zecimale (2-4) care nu pierd nimic. */
function numCotaEd(n) {
  const x = Number(n);
  const patru = x.toFixed(4);
  for (let d = 2; d < 4; d += 1) {
    if (Number(x.toFixed(d)) === Number(patru)) return num(x, d);
  }
  return num(x, 4);
}

/* Citeste un numar scris romaneste ("1.234,5" sau "1234.5"). Punctul este
   separator zecimal daca nu exista virgula: asa scriu oamenii indexul
   contorului ("192.62" = 192,62 mc). */
function numarDin(text) {
  const t = String(text).trim().replace(/\s/g, "");
  if (!t) return NaN;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return Number(normal);
}

/* Citeste o suma in lei. Aici punctul urmat de grupuri de cate trei cifre
   separa miile, pentru ca asa se scriu banii romaneste: "1.500" inseamna o mie
   cinci sute, nu unu virgula cinci. Indexurile de contor nu trec pe aici. */
function sumaDin(text) {
  const t = String(text).trim().replace(/\s/g, "");
  if (!t.includes(",") && /^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  return numarDin(t);
}

const LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie",
  "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const LUNI_S = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "noi", "dec"];
const pad2 = (n) => String(n).padStart(2, "0");

/* O luna se scrie "2026-07" peste tot in aplicatie */
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return `${LUNI[Number(m) - 1]} ${y}`;
};
const monthShort = (key) => {
  const [y, m] = key.split("-");
  return `${LUNI_S[Number(m) - 1]} ${y.slice(2)}`;
};
const monthName = (key) => LUNI[Number(key.split("-")[1]) - 1];
const lunaUrmatoare = (key) => {
  let [y, m] = key.split("-").map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${pad2(m)}`;
};
const lunaDe = (iso) => iso.slice(0, 7);

/* Datele calendaristice se compara ca zile intregi, fara ore si fus orar */
const ziMs = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const zileIntre = (dela, pana) => Math.round((ziMs(pana) - ziMs(dela)) / 86400000);
const ziLocala = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/* [K12] Instantul (ISO) al unei date si ore alese in formular, ca ora a
   Romaniei (+02:00 iarna, +03:00 vara), calculat cu Intl - nu cu fusul
   dispozitivului. La fel ca offsetRomania()/oraSeriiRomania() din
   sursa-mock.js si sursa-supabase.js (fix J9, pentru ora fixa de inchidere
   a votului): convoacaAdunare trimitea data si ora adunarii cu
   `new Date(\`${data}T${ora}:00\`)`, care le citeste in fusul dispozitivului
   - un locatar aflat in strainatate vedea o alta ora decat cea aleasa de
   administrator. */
function instantRomania(dataText, oraText) {
  const aprox = new Date(`${dataText}T${oraText}:00Z`);
  const ore = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Bucharest", timeZoneName: "shortOffset", hour12: false })
    .formatToParts(aprox).find((p) => p.type === "timeZoneName").value.replace("GMT+", "");
  return new Date(`${dataText}T${oraText}:00+${ore.padStart(2, "0")}:00`).toISOString();
}

const dataRo = (iso) => {
  const [y, m, d] = (iso.length > 10 ? ziLocala(iso) : iso).split("-");
  return `${Number(d)} ${LUNI_S[Number(m) - 1]} ${y}`;
};
const dataLunga = (iso) => {
  const [y, m, d] = (iso.length > 10 ? ziLocala(iso) : iso).split("-");
  return `${Number(d)} ${LUNI[Number(m) - 1]} ${y}`;
};
const oraRo = (iso) => {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/* Formularul are ceva scris in el? Folosit ca sa nu se piarda la o atingere
   gresita pe fundal. */
const areText = (...valori) => valori.some((v) => String(v || "").trim().length > 0);

/* [F21] Peste nouasprezece, romana cere "de": 30 de zile, dar 21 de zile si
   101 zile. Regula se uita la ultimele doua cifre. */
const cuDe = (n) => n >= 20 && (n % 100 === 0 || n % 100 > 19);
const pluralZile = (n) => (n === 1 ? "o zi" : `${n}${cuDe(n) ? " de" : ""} zile`);
const plural = (n, unu, multi) => (n === 1 ? `1 ${unu}` : `${n}${cuDe(n) ? " de" : ""} ${multi}`);

/* =============================================================================
   3. CONSTANTE DE AFISARE
============================================================================= */

/* Cele cinci metode de repartizare. Cheile sunt valorile din baza de date. */
const METODE = {
  consum: { eticheta: "Pe consum masurat", explic: "Fiecare apartament plateste apa citita la contorul lui. Diferenta dintre contorul general al blocului si suma contoarelor din apartamente se imparte pe persoane." },
  persoane: { eticheta: "Pe numar de persoane", explic: "Suma se imparte la totalul persoanelor declarate in bloc, apoi se inmulteste cu persoanele din apartament." },
  persoane_fara_lift: { eticheta: "Pe persoane, fara parter", explic: "Suma se imparte doar la persoanele din apartamentele care folosesc liftul. Apartamentele de la parter sunt scutite." },
  apartamente: { eticheta: "Egal pe apartament", explic: "Suma se imparte in parti egale la toate apartamentele din bloc." },
  cota: { eticheta: "Pe cota indiviza", explic: "Suma se imparte proportional cu cota parte din proprietatea comuna, inscrisa in actul de proprietate." },
};

/* Pe hartie fiecare factura este o coloana. Locatarul isi citeste randul mai
   usor in cateva grupe cu subtotal. O factura cu un cod nelistat aici ajunge
   in grupa "Alte cheltuieli". [L6] Codul (C1, C2, ...) este doar pozitia pe
   lista de hartie a acestei asociatii si poate fi altul in alta asociatie
   (de exemplu salubritatea pe C1); grupa "Apa" nu se poate baza pe cod. Se
   bazeaza in schimb pe metoda "consum", singura folosita pentru apa. */
const GRUPE_CHELTUIELI = [
  { id: "bloc", eticheta: "Curent, lift si curatenie", coduri: ["C3", "C5", "C6", "C4", "C8"] },
  { id: "admin", eticheta: "Administrarea blocului", coduri: ["C7"] },
];

const CATEGORII_SESIZARI = [
  { value: "instalatii", label: "Instalatii, apa, canalizare" },
  { value: "iluminat", label: "Iluminat si electrice" },
  { value: "acces", label: "Usa, interfon, lift" },
  { value: "curatenie", label: "Curatenie si gunoi" },
  { value: "altele", label: "Altele" },
];
const etichetaCategorie = (v) => (CATEGORII_SESIZARI.find((c) => c.value === v) || { label: v }).label;

/* Sesizarile care apar cel mai des, gata scrise: un singur apasat */
const SESIZARI_RAPIDE = [
  { titlu: "Bec ars pe scara", categorie: "iluminat" },
  { titlu: "Geam spart", categorie: "altele" },
  { titlu: "Liftul nu merge", categorie: "acces" },
  { titlu: "Usa de la intrare nu se inchide", categorie: "acces" },
  { titlu: "Interfonul nu functioneaza", categorie: "acces" },
  { titlu: "Curge apa pe scara sau in subsol", categorie: "instalatii" },
  { titlu: "Gunoi lasat pe casa scarii", categorie: "curatenie" },
];

const REMINDERE_INFO = {
  lista_publicata: { nume: "Anunt cand se afiseaza lista de plata", cand: () => "In ziua publicarii listei", trimiteAcum: false },
  citire_contoare: { nume: "Reamintire de citire a contoarelor", cand: (z) => `Cu ${pluralZile(z)} inainte de termenul de citire`, trimiteAcum: true, buton: "Reamintire de citire index" },
  plata: { nume: "Reamintire de plata", cand: (z) => `Cu ${pluralZile(z)} inainte de scadenta`, trimiteAcum: true, buton: "Reamintire de plata" },
  restanta: { nume: "Instiintare de restanta", cand: (z) => `La ${pluralZile(z)} de la scadenta`, trimiteAcum: true, buton: "Instiintare restantieri" },
  adunare_generala: { nume: "Convocare adunare generala", cand: (z) => `Cu ${pluralZile(z)} inainte de data adunarii`, trimiteAcum: false },
};
const ORDINE_REMINDERE = ["lista_publicata", "citire_contoare", "plata", "restanta", "adunare_generala"];

const TIPURI_DOCUMENTE = [
  { value: "lista_plata", label: "Lista de plata" },
  { value: "raport", label: "Raport" },
  { value: "proces_verbal", label: "Proces verbal" },
  { value: "contract", label: "Contract" },
  { value: "regulament", label: "Regulament" },
  { value: "factura", label: "Factura" },
  { value: "altul", label: "Alt document" },
];
const etichetaTipDocument = (v) => (TIPURI_DOCUMENTE.find((t) => t.value === v) || { label: v }).label;

/* Regulile de parola cerute de backend (Supabase: minim 10, litere si cifre) */
const PAROLA_INDICIU = "Cel putin 10 caractere, cu litere mari, litere mici si cifre";
const PAROLA_EROARE = "Parola are nevoie de cel putin 10 caractere, o litera mare, o litera mica si o cifra.";
const parolaBuna = (p) => p.length >= 10 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);

const ROLURI_CONTACT = { administrator: "Administrator", presedinte: "Presedinte", cenzor: "Cenzor", lift: "Urgente lift", altul: "Contact" };

const CALITATI = [
  { value: "proprietar", label: "Proprietar" },
  { value: "chirias", label: "Chirias" },
  { value: "membru_familie", label: "Membru al familiei" },
];
const etichetaCalitate = (v) => (CALITATI.find((c) => c.value === v) || { label: v }).label;

/* [P3] Acelasi text pe care traduce() din sursa-supabase.js il intoarce
   pentru o sesiune moarta (JWT expirat sau "permission denied for schema").
   cmd() il cauta exact, ca sa scoata omul la autentificare, nu doar sa arate
   un toast si sa-l lase pe ecranul vechi. */
const MESAJ_SESIUNE_EXPIRATA = "Sesiunea a expirat. Intra din nou in cont.";

const ETICHETE_DATORII = {
  intretinere: "Intretinere",
  penalizare: "Penalizare",
  sold_initial: "Restanta preluata",
  fond_rulment: "Fond de rulment",
  corectie: "Corectie",
};

/* =============================================================================
   4. DERIVARI
   Functii pure care citesc datele incarcate si intorc exact ce afiseaza un
   ecran. Nu inventeaza cifre: aduna randuri din repartizari si din registrul
   financiar.
============================================================================= */

const listaCurenta = (date) => date.liste.find((l) => l.stare === "publicata") || null;
const listePublicate = (date) => date.liste.filter((l) => l.stare === "publicata");
const listaCiorna = (date) => date.liste.find((l) => l.stare === "ciorna") || null;
const listaDupaId = (date, id) => date.liste.find((l) => l.id === id);
const apartamentDupaId = (date, id) => date.apartamente.find((a) => a.id === id);
const apartamentulMeu = (date) => apartamentDupaId(date, date.eu.apartamentId);
/* Cheia de sortare a unei facturi dupa scadenta furnizorului: cele fara
   scadenta se aseaza la urma */
const scadentaSortare = (c) => c.scadentaFurnizor || "9999-99-99";
const ordineCod = (a, b) => Number(a.cod.slice(1)) - Number(b.cod.slice(1)) || a.cod.localeCompare(b.cod);
/* Apartamentele in ordinea de pe usa: 1, 2, 2A, 3, 10. Comparatia pe text cu
   cifrele citite ca numere este o ordine totala, deci rezultatul nu depinde de
   ordinea in care vin randurile din baza. */
const ordineNumar = (a, b) => a.numar.localeCompare(b.numar, "ro", { numeric: true });

/* Randurile listei unui apartament: fiecare cheltuiala cu partea lui */
function liniiLista(date, listaId, apId) {
  const rep = date.repartizari.filter((r) => r.listaId === listaId && r.apartamentId === apId);
  return date.cheltuieli
    .filter((c) => c.listaId === listaId)
    .map((c) => {
      const r = rep.find((x) => x.cheltuialaId === c.id);
      if (!r) return null;
      return {
        id: c.id, listaId, apartamentId: apId, cod: c.cod, eticheta: c.categorie, furnizor: c.furnizor, metoda: c.metoda, tipApa: c.tipApa,
        sumaFactura: c.suma, serie: c.serie, documentId: c.documentId, esteFond: c.tip !== "factura",
        suma: r.suma, baza: r.baza, detaliu: r.detaliu, rotunjire: r.rotunjire,
      };
    })
    .filter(Boolean)
    .sort(ordineCod);
}

const totalLista = (date, listaId, apId) => suma(liniiLista(date, listaId, apId), (l) => l.suma);

const datoriiApartament = (date, apId) => date.datorii
  .filter((d) => d.apartamentId === apId)
  .sort((a, b) => (a.scadenta === b.scadenta ? (a.creatLa < b.creatLa ? -1 : 1) : a.scadenta < b.scadenta ? -1 : 1));
const datoriiDeschise = (date, apId) => datoriiApartament(date, apId).filter((d) => d.rest > 0);

/* [H8] Soldul: tot ce a ramas neplatit, calculat din registru, niciodata
   stocat. Trebuie sa adune restul FIECAREI datorii, nu doar al celor cu rest
   pozitiv: o corectie negativa lasa un rest negativ (un credit), iar
   datoriiDeschise() il arunca (e filtrata pe rest > 0, ca sa arate doar ce
   mai e de platit). Fara acest credit in suma, soldul apare mai mare decat
   cel din registru. */
const sold = (date, apId) => suma(datoriiApartament(date, apId), (d) => d.rest);
/* [K9] Banii platiti si inca nealocati pe nicio datorie: un avans, care se
   scade din urmatoarea lista. Soldul din registru (financiar.solduri) este
   sold() minus acest avans; fara el, o plata facuta inainte de lista aparea
   doar ca "Achitat", fara nicio urma a banilor platiti in plus. */
const avans = (date, apId) => suma(date.plati.filter((p) => p.apartamentId === apId && p.stare === "confirmata"),
  (p) => p.suma - suma(p.alocari, (a) => a.suma));
const restanta = (date, apId) => suma(datoriiDeschise(date, apId).filter((d) => d.scadenta < date.azi), (d) => d.rest);
const penalizariDeschise = (date, apId) => suma(datoriiDeschise(date, apId).filter((d) => d.tip === "penalizare"), (d) => d.rest);
const datoriePeLista = (date, listaId, apId) => date.datorii.find((d) => d.listaId === listaId && d.apartamentId === apId && d.tip === "intretinere");
const explicatiePenalizare = (date, datorieId) => date.penalizari.find((p) => p.datorieId === datorieId) || null;
/* Corectiile aceleiasi liste (create de o recalculare): datorii sora ale
   datoriei de intretinere, cu acelasi apartament si aceeasi lista. */
const corectiiListei = (date, listaId, apId) => date.datorii.filter((d) => d.listaId === listaId && d.apartamentId === apId && d.tip === "corectie");
/* [K5] Suma reala incasata pe o datorie: din alocarile platilor (ca la
   `incasat` din statisticiAdmin), nu din suma - rest. O corectie negativa
   scade direct restul datoriei de intretinere fara nicio plata noua (F2), iar
   "suma - rest" ar numara-o drept plata fantoma. */
const incasatPeDatorie = (date, datorieId) => suma(date.plati.flatMap((p) => p.alocari.filter((a) => a.datorieId === datorieId)), (a) => a.suma);

/* Randul unui apartament din lista de plata, desfacut in trepte: cheltuielile
   lunii pe grupe, contributiile la fonduri si, doar pentru lista curenta,
   datoriile din lunile trecute. Pentru lista curenta totalul este exact
   soldul apartamentului. */
function defalcare(date, apId, listaId) {
  const lista = listaDupaId(date, listaId);
  const linii = liniiLista(date, listaId, apId);
  const cheltuieli = linii.filter((l) => !l.esteFond);
  const cunoscute = GRUPE_CHELTUIELI.flatMap((g) => g.coduri);
  const esteApa = (l) => l.metoda === "consum";
  const grupe = [
    { id: "apa", eticheta: "Apa", linii: cheltuieli.filter(esteApa) },
    ...GRUPE_CHELTUIELI.map((g) => ({ id: g.id, eticheta: g.eticheta, linii: cheltuieli.filter((l) => !esteApa(l) && g.coduri.includes(l.cod)) })),
    { id: "alte", eticheta: "Alte cheltuieli", linii: cheltuieli.filter((l) => !esteApa(l) && !cunoscute.includes(l.cod)) },
  ]
    .filter((g) => g.linii.length > 0)
    .map((g) => ({ ...g, total: suma(g.linii, (l) => l.suma) }));
  const fonduri = linii.filter((l) => l.esteFond);
  const totalLuna = suma(linii, (l) => l.suma);

  const datoriaListei = datoriePeLista(date, listaId, apId);
  const corectii = corectiiListei(date, listaId, apId);
  /* [K5] Incasarea reala pe aceasta lista: alocarile datoriei de intretinere
     si ale corectiilor ei (o corectie pozitiva poate primi si ea o plata).
     Cheltuielile lunii (randul 1) arata deja repartizarea curenta, dupa orice
     recalculare, deci corectiile nu se mai aduna separat - doar ce s-a platit
     efectiv din ele se scade aici. */
  const platitDinLista = datoriaListei
    ? suma([datoriaListei, ...corectii], (d) => incasatPeDatorie(date, d.id))
    : 0;
  const corectieSuma = suma(corectii, (d) => d.suma);
  const esteCurenta = listaCurenta(date) && listaCurenta(date).id === listaId;

  let datorii = null;
  if (esteCurenta) {
    /* [K5] "Datorii din lunile trecute" sunt datorii de pe ALTE liste: o
       corectie a acestei liste nu e o datorie veche, ci explicatia pentru ce
       arata randul 1 altfel decat suma inghetata la publicare - are randul ei
       explicit mai sus, "Corectie dupa recalculare". Fara aceasta excludere,
       o corectie pozitiva neplatita ar fi numarata de doua ori: o data in
       cheltuielile lunii (deja recalculate) si o data aici. */
    const altele = datoriiDeschise(date, apId).filter((d) => d.listaId !== listaId);
    const restante = altele.filter((d) => d.tip !== "penalizare").map((d) => ({
      ...d, zile: Math.max(0, zileIntre(d.scadenta, date.azi)),
    }));
    const penalizari = altele.filter((d) => d.tip === "penalizare").map((d) => ({ ...d, calcul: explicatiePenalizare(date, d.id) }));
    datorii = {
      restante, penalizari, platitDinLista, corectieSuma,
      total: round2(suma(restante, (d) => d.rest) + suma(penalizari, (d) => d.rest)),
    };
  }
  /* [L4] Totalul pentru lista curenta este exact soldul apartamentului
     (suma resturilor tuturor datoriilor deschise), nu o reconstructie din
     cheltuielile lunii minus ce s-a platit: dupa o recalculare, cheltuielile
     lunii si suma inghetata pe datoria de intretinere pot sa nu mai
     coincida (diferenta devine o datorie de corectie), iar reconstructia
     aduna sau pierde exact acea diferenta. Soldul, calculat din registru,
     nu poate diverge. */
  const total = esteCurenta ? round2(sold(date, apId)) : totalLuna;
  return {
    lista, linii, totalLuna, esteCurenta, datoriaListei,
    achitat: datoriaListei ? datoriaListei.rest <= 0 : false,
    trepte: {
      cheltuieli: { grupe, total: suma(cheltuieli, (l) => l.suma) },
      fonduri: { linii: fonduri, total: suma(fonduri, (l) => l.suma) },
      datorii,
    },
    total,
  };
}

/* Consumul validat al unui apartament intr-o luna, pe tip de apa */
function consumApartament(date, apId, luna, tip) {
  const cit = date.citiri.filter((c) => c.apartamentId === apId && c.luna === luna && c.tip === tip && c.stare === "validata" && c.sursa !== "pornire");
  return cit.length ? round2(suma(cit, (c) => c.consum)) : null;
}

/* [A9] Persoanele apartamentului valabile intr-o anumita luna, nu cele de
   azi: istoricPersoane vine sortat descrescator (cel mai recent prim), deci
   prima intrare valabila la sau inainte de luna ceruta e cea corecta. Fiecare
   apartament are cel putin intrarea de la crearea lui, deci exista mereu una
   valabila pentru orice luna cu citiri. */
function persoaneInLuna(ap, luna) {
  return ap.istoricPersoane.find((p) => p.valabilDin <= luna).numar;
}

/* Lunile cu consum validat, de la intrarea in aplicatie */
function istoricConsum(date, apId) {
  const luni = [...new Set(date.citiri.filter((c) => c.apartamentId === apId && c.stare === "validata" && c.sursa !== "pornire").map((c) => c.luna))].sort();
  return luni.map((luna) => ({
    luna,
    rece: consumApartament(date, apId, luna, "rece"),
    calda: consumApartament(date, apId, luna, "calda"),
    estimat: date.citiri.some((c) => c.apartamentId === apId && c.luna === luna && c.sursa === "estimat"),
  }));
}

/* Citirea curenta a unui contor (luna in curs), daca exista. [A10] Cand
   exista mai multe respingeri pe aceeasi luna (respinsa, retrimisa,
   respinsa din nou), se arata cea mai noua, nu prima gasita. */
const citireLuna = (date, contorId, luna) => {
  const cit = date.citiri.filter((c) => c.contorId === contorId && c.luna === luna);
  const nerespinsa = cit.find((c) => c.stare !== "respinsa");
  if (nerespinsa) return nerespinsa;
  const respinse = cit.filter((c) => c.stare === "respinsa").sort((a, b) => Date.parse(b.transmisaLa) - Date.parse(a.transmisaLa));
  return respinse[0] || null;
};
/* [R5] Momentele se compara ca momente: sirul ISO are decalajul in coada si
   se schimba la trecerea la ora de iarna. */
const dupaConfirmare = (a, b) => Date.parse(b.confirmataLa) - Date.parse(a.confirmataLa);

/* [R8] Comparatorul intoarce 0 pentru luni egale, deci ordinea randurilor
   venite din baza nu se mai schimba de la o sortare la alta. */
const citiriValabileInainte = (date, contorId, inainteDe) => date.citiri
  .filter((c) => c.contorId === contorId && c.stare !== "respinsa" && c.luna < inainteDe)
  .sort((a, b) => b.luna.localeCompare(a.luna));
const ultimIndexValabil = (date, contorId, inainteDe) => {
  const cit = citiriValabileInainte(date, contorId, inainteDe);
  return cit.length ? cit[0].indexCurent : 0;
};
/* Cel mai mic index pe care il accepta backend-ul: anteriorul, sau ultima
   citire reala cand anteriorul este o estimare prea mare [A2] */
const indexMinim = (date, contorId, inainteDe) => {
  const cit = citiriValabileInainte(date, contorId, inainteDe);
  if (!cit.length || cit[0].sursa !== "estimat") return ultimIndexValabil(date, contorId, inainteDe);
  const reale = cit.filter((c) => c.sursa !== "estimat");
  return reale.length ? reale[0].indexCurent : 0;
};

/* Istoricul intretinerii pe luni: cat a fost lista si daca e platita */
function istoricLunar(date, apId) {
  return listePublicate(date).map((l) => {
    const d = datoriePeLista(date, l.id, apId);
    return { lista: l, luna: l.luna, total: totalLista(date, l.id, apId), rest: d ? d.rest : 0, achitat: d ? d.rest <= 0 : true };
  });
}

/* Fraza pe care o cere omul: "luna asta X, luna trecuta Y, cu Z mai mult" */
function frazaComparatie(istoric) {
  if (istoric.length < 2) return null;
  const [acum, inainte] = istoric;
  const dif = round2(acum.total - inainte.total);
  const sens = dif > 0 ? `cu ${lei(dif)} mai mult` : dif < 0 ? `cu ${lei(-dif)} mai putin` : "exact la fel";
  return `Intretinerea pe ${monthName(acum.luna)} este ${lei(acum.total)}. Pe ${monthName(inainte.luna)} a fost ${lei(inainte.total)}, deci luna aceasta platesti ${sens}.`;
}

function statisticiAdmin(date) {
  const lista = listaCurenta(date);
  const datoriiLista = lista ? date.datorii.filter((d) => d.listaId === lista.id && d.tip === "intretinere") : [];
  const deIncasat = suma(datoriiLista, (d) => d.suma);
  /* [H8] `suma - rest` presupune ca orice scadere a restului vine dintr-o
     plata: o corectie negativa poate sa scada restul datoriei de intretinere
     a aceleiasi liste fara nicio plata noua (docs/schema-propunere.md
     §11.4), ceea ce arata o incasare fantoma egala cu corectia pentru un
     apartament care nu a platit nimic. Incasarea reala este suma alocarilor
     platilor pe aceste datorii. */
  const idDatoriiLista = new Set(datoriiLista.map((d) => d.id));
  const incasat = suma(date.plati.flatMap((p) => p.alocari.filter((a) => idDatoriiLista.has(a.datorieId))), (a) => a.suma);
  const apAchitate = datoriiLista.filter((d) => d.rest <= 0).length;
  const cuRestanta = date.apartamente.filter((a) => restanta(date, a.id) > 0);
  return {
    lista, deIncasat, incasat, apAchitate,
    totalApartamente: date.apartamente.length,
    restante: suma(date.apartamente, (a) => restanta(date, a.id)),
    apCuRestanta: cuRestanta.length,
    penalizari: suma(date.apartamente, (a) => penalizariDeschise(date, a.id)),
    sesizariDeschise: date.sesizari.filter((s) => s.stare !== "rezolvata").length,
    citiriDeVerificat: date.citiri.filter((c) => c.stare === "trimisa").length,
    /* Cea mai apropiata scadenta prima, ca administratorul sa stie ce plateste
       intai; cele fara scadenta la urma. Sursa nu garanteaza nicio ordine. */
    facturiNeachitate: date.cheltuieli
      .filter((c) => c.tip === "factura" && !c.achitataLa && (listaDupaId(date, c.listaId) || {}).stare === "publicata")
      .sort((a, b) => scadentaSortare(a).localeCompare(scadentaSortare(b)) || ordineCod(a, b)),
  };
}

/* Restantierii, cel mai vechi datornic primul */
function restantieri(date) {
  return date.apartamente
    .map((a) => {
      const vechi = datoriiDeschise(date, a.id).filter((d) => d.scadenta < date.azi);
      if (vechi.length === 0) return null;
      return {
        ap: a,
        restanta: suma(vechi, (d) => d.rest),
        zile: zileIntre(vechi[0].scadenta, date.azi),
        penalizari: penalizariDeschise(date, a.id),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.zile - a.zile);
}

/* Ce a acoperit o plata, in cuvinte, pentru chitanta */
function descriereAlocari(date, plata) {
  if (plata.alocari.length === 0) return ["Avans pentru listele urmatoare"];
  const randuri = plata.alocari.map((a) => {
    const d = date.datorii.find((x) => x.id === a.datorieId);
    const ce = !d ? "Datorie" : d.tip === "intretinere" ? `Intretinere ${monthLabel(d.luna)}` : d.tip === "penalizare" ? `Penalizare ${monthLabel(d.luna)}` : d.descriere;
    return `${ce}: ${lei(a.suma)}`;
  });
  const avans = round2(plata.suma - suma(plata.alocari, (a) => a.suma));
  if (avans > 0) randuri.push(`Avans: ${lei(avans)}`);
  return randuri;
}

const numarChitanta = (ch) => `${ch.serie} nr. ${String(ch.numar).padStart(6, "0")}`;

/* Chitanta ca PDF, pentru "isi descarca chitanta" */
function chitantaPdf(date, plata) {
  const ap = apartamentDupaId(date, plata.apartamentId);
  const a = date.asociatie;
  const ch = plata.chitanta;
  return documentPdf({
    titlu: `Chitanta ${numarChitanta(ch)}`,
    blocuri: [
      { tip: "text", text: a.denumire, bold: true, marime: 12 },
      { tip: "text", text: `CUI ${a.cui}  |  ${a.adresa}`, gri: true, marime: 9 },
      { tip: "text", text: `IBAN ${a.iban}, ${a.banca}`, gri: true, marime: 9 },
      { tip: "spatiu", h: 18 },
      { tip: "titlu", text: `CHITANTA  ${numarChitanta(ch)}` },
      { tip: "text", text: `Data: ${dataLunga(ch.emisaLa)}, ora ${oraRo(ch.emisaLa)}`, marime: 10 },
      { tip: "spatiu", h: 10 },
      { tip: "text", text: `Am primit de la ${ap.proprietar}, apartamentul ${ap.numar}, ${date.bloc.denumire},`, marime: 11 },
      { tip: "text", text: `suma de ${lei(plata.suma)}, reprezentand:`, marime: 11, bold: true },
      { tip: "spatiu", h: 6 },
      ...descriereAlocari(date, plata).map((t) => ({ tip: "text", text: `  -  ${t}`, marime: 10 })),
      { tip: "spatiu", h: 10 },
      { tip: "text", text: `Modalitate: ${plata.metoda === "card" ? `plata cu cardul, referinta ${plata.referinta || "-"}` : plata.metoda === "numerar" ? `numerar${plata.inregistrataDe ? `, incasat de ${plata.inregistrataDe}` : ""}` : "transfer bancar"}`, marime: 10 },
      { tip: "spatiu", h: 30 },
      { tip: "linie" },
      { tip: "text", text: "Document emis electronic prin AdminBloc. Nu necesita semnatura si stampila.", gri: true, marime: 8 },
    ],
  });
}

/* Lista de plata: un rand pe apartament, o coloana pe cheltuiala.
   [X01] Doua variante, cu aceleasi cifre:
   - varianta publica (`listaPdf`, pentru avizier, in casa scarii): doar
     apartamentul, cheltuielile si totalul lunii. Fara nume, fara restante,
     fara penalizari - astea nu sunt treaba vecinilor de pe scara.
   - varianta interna (`listaPdfIntern`, uz administrativ): proprietarul,
     persoanele si, pe lista curenta, restantele si penalizarile, exact ca
     inainte. Marcata clar ca document intern, niciodata pentru avizier. */
const LATIME_UTILA_LISTA = 842 - 2 * 40;
/* [F28] Corpul tabelului sta la 9,5 pt, ca sa se citeasca de pe perete. */
const MARIME_TABEL_LISTA = 9.5;
const LAT_LISTA = { ap: 20, prop: 110, pers: 22, ch: 44, tot: 52, rest: 48, pen: 46, plata: 52 };

/* [C13] Cu multe cheltuieli, ingustarea coloanelor la nesfarsit le face
   ilizibile mult inainte ca litera sa ajunga la pragul minim, iar sumele
   ajung sa se calce intre coloane. In loc sa se ingusteze, cheltuielile se
   grupeaza in "pagini de coloane" cate incap la marimea standard: fiecare
   grup e un tabel intreg, cu apartamentul (si, pe varianta interna,
   proprietarul) repetate, ca cineva care rasfoieste sa poata lega randurile
   intre grupuri. Doar ultimul grup mai are loc si pentru Total/Restante/
   Penalizari/De plata. */
function grupeazaCheltuieliPdf(cheltuieli, identWidth, extraWidth) {
  const disponibil = LATIME_UTILA_LISTA - identWidth;
  const perGrupNormal = Math.max(1, Math.floor(disponibil / LAT_LISTA.ch));
  const perGrupFinal = Math.max(1, Math.floor((disponibil - extraWidth) / LAT_LISTA.ch));
  const grupe = [];
  const ramase = cheltuieli.slice();
  /* [G9] O felie normala nu are voie sa goleasca complet ce mai ramane: daca
     ar face-o, grupul final (singurul cu Total/Restante/Penalizari/De plata)
     ar iesi gol, adica o pagina in plus fara nicio coloana de cheltuiala.
     Cat timp mai e ceva de facut, felia ia cel mult perGrupNormal, dar lasa
     mereu macar o cheltuiala pentru grupul final. */
  while (ramase.length > perGrupFinal) grupe.push(ramase.splice(0, Math.min(perGrupNormal, ramase.length - 1)));
  grupe.push(ramase);
  return grupe;
}

function construiesteListaPdf(date, listaId, interna) {
  const lista = listaDupaId(date, listaId);
  const cheltuieli = date.cheltuieli.filter((c) => c.listaId === listaId).sort(ordineCod);
  const esteCurenta = listaCurenta(date) && listaCurenta(date).id === listaId;
  const arataDatorii = interna && esteCurenta;
  const identWidth = LAT_LISTA.ap + (interna ? LAT_LISTA.prop + LAT_LISTA.pers : 0);
  const extraWidth = LAT_LISTA.tot + (arataDatorii ? LAT_LISTA.rest + LAT_LISTA.pen + LAT_LISTA.plata : 0);
  const grupe = grupeazaCheltuieliPdf(cheltuieli, identWidth, extraWidth);
  const apartamente = date.apartamente.slice().sort(ordineNumar);

  /* Asambleaza randul unui grup din celulele identitatii, cele ale
     cheltuielilor acelui grup si, doar pe ultimul grup, cele finale. */
  const randGrup = (grupCheltuieli, ultimulGrup, c) => [
    c.ap,
    ...(interna ? [c.prop, c.pers] : []),
    ...grupCheltuieli.map(c.cheltuiala),
    ...(ultimulGrup ? [c.total, ...(arataDatorii ? [c.rest, c.pen, c.plata] : [])] : []),
  ];

  const blocuriTabel = [];
  grupe.forEach((grupCheltuieli, ig) => {
    const ultimulGrup = ig === grupe.length - 1;
    if (ig > 0) blocuriTabel.push({ tip: "spatiu", h: 10 });
    blocuriTabel.push({
      tip: "rand", marime: MARIME_TABEL_LISTA, fond: true, repeta: true,
      coloane: randGrup(grupCheltuieli, ultimulGrup, {
        ap: { text: "Ap.", latime: LAT_LISTA.ap, bold: true },
        prop: { text: "Proprietar", latime: LAT_LISTA.prop, bold: true },
        pers: { text: "Pers.", latime: LAT_LISTA.pers, dreapta: true, bold: true },
        cheltuiala: (c) => ({ text: c.cod, latime: LAT_LISTA.ch, dreapta: true, bold: true }),
        total: { text: "Total luna", latime: LAT_LISTA.tot, dreapta: true, bold: true },
        rest: { text: "Restante", latime: LAT_LISTA.rest, dreapta: true, bold: true },
        pen: { text: "Penaliz.", latime: LAT_LISTA.pen, dreapta: true, bold: true },
        plata: { text: "De plata", latime: LAT_LISTA.plata, dreapta: true, bold: true },
      }),
    });
    apartamente.forEach((ap, i) => {
      const linii = liniiLista(date, listaId, ap.id);
      const totalL = suma(linii, (l) => l.suma);
      const rest = arataDatorii ? suma(datoriiDeschise(date, ap.id).filter((d) => d.tip !== "penalizare" && d.listaId !== listaId), (d) => d.rest) : 0;
      const pen = arataDatorii ? penalizariDeschise(date, ap.id) : 0;
      const dl = datoriePeLista(date, listaId, ap.id);
      /* [K5] Ca la ecranul locatarului: "de plata" se calculeaza din
         incasarile reale (alocarile din registru), nu din suma - rest, care
         ar numara o corectie a recalcularii drept plata. */
      const platit = dl ? suma([dl, ...corectiiListei(date, listaId, ap.id)], (d) => incasatPeDatorie(date, d.id)) : 0;
      blocuriTabel.push({
        tip: "rand", marime: MARIME_TABEL_LISTA, fond: i % 2 === 1,
        coloane: randGrup(grupCheltuieli, ultimulGrup, {
          ap: { text: ap.numar, latime: LAT_LISTA.ap },
          prop: { text: scurteazaNume(ap.proprietar, LAT_LISTA.prop - 4, MARIME_TABEL_LISTA), latime: LAT_LISTA.prop },
          /* [L13] Persoanele declarate ale apartamentului, nu baza unei
             cheltuieli repartizate pe persoane: coloana era goala cand
             nicio cheltuiala a lunii nu se imparte asa. */
          pers: { text: num(ap.persoane, 0), latime: LAT_LISTA.pers, dreapta: true },
          cheltuiala: (c) => {
            const l = linii.find((x) => x.id === c.id);
            return { text: l ? lei(l.suma, false) : "", latime: LAT_LISTA.ch, dreapta: true };
          },
          total: { text: lei(totalL, false), latime: LAT_LISTA.tot, dreapta: true, bold: true },
          rest: { text: rest ? lei(rest, false) : "", latime: LAT_LISTA.rest, dreapta: true },
          pen: { text: pen ? lei(pen, false) : "", latime: LAT_LISTA.pen, dreapta: true },
          plata: { text: lei(round2(totalL - platit + rest + pen), false), latime: LAT_LISTA.plata, dreapta: true, bold: true },
        }),
      });
    });
    blocuriTabel.push({ tip: "linie" });
    blocuriTabel.push({
      tip: "rand", marime: MARIME_TABEL_LISTA, bold: true,
      coloane: randGrup(grupCheltuieli, ultimulGrup, {
        ap: { text: ig === 0 ? "TOTAL" : "", latime: LAT_LISTA.ap },
        prop: { text: "", latime: LAT_LISTA.prop },
        pers: { text: "", latime: LAT_LISTA.pers },
        cheltuiala: (c) => ({ text: lei(c.suma, false), latime: LAT_LISTA.ch, dreapta: true }),
        total: { text: lei(suma(cheltuieli, (c) => c.suma), false), latime: LAT_LISTA.tot, dreapta: true },
        rest: { text: "", latime: LAT_LISTA.rest },
        pen: { text: "", latime: LAT_LISTA.pen },
        plata: { text: "", latime: LAT_LISTA.plata },
      }),
    });
  });

  return documentPdf({
    titlu: `Lista de plata ${monthLabel(lista.luna)}${interna ? " - uz intern" : ""}`,
    peLatime: true,
    subsol: `${date.asociatie.denumire}, ${date.bloc.denumire}. Lista generata din AdminBloc pe ${dataLunga(date.azi)}.${interna ? " Document intern, nu se afiseaza la avizier." : ""}`,
    blocuri: [
      { tip: "text", text: `${date.asociatie.denumire}  |  ${date.bloc.denumire}, ${date.bloc.adresa}`, gri: true, marime: 9 },
      { tip: "titlu", text: `Lista de plata pe ${monthLabel(lista.luna)}` },
      ...(interna ? [{ tip: "text", text: "Document intern, uz administrativ: contine numele proprietarilor si restantele. Nu se afiseaza la avizier.", marime: 9, bold: true }] : []),
      { tip: "text", text: `Afisata pe ${dataLunga(lista.publicataLa || date.azi)}. Termen de plata: ${lista.scadenta ? dataLunga(lista.scadenta) : "-"}. Penalizari de ${num(date.setari.procentPenalizareZi)}% pe zi dupa ${date.setari.zileGratie} de zile de la scadenta.`, marime: 9 },
      { tip: "spatiu", h: 6 },
      ...cheltuieli.map((c) => ({ tip: "text", marime: 8, text: `${c.cod}  ${c.categorie}  -  ${c.furnizor}${c.serie ? `, ${c.serie}` : ""}  -  ${lei(c.suma)}  -  ${METODE[c.metoda].eticheta.toLowerCase()}` })),
      { tip: "spatiu", h: 8 },
      ...blocuriTabel,
      { tip: "spatiu", h: 10 },
      { tip: "text", text: "Fiecare suma se poate verifica in aplicatie: apasati pe randul cheltuielii ca sa vedeti factura si calculul complet.", gri: true, marime: 8 },
    ],
  });
}

function listaPdf(date, listaId) { return construiesteListaPdf(date, listaId, false); }
function listaPdfIntern(date, listaId) { return construiesteListaPdf(date, listaId, true); }

/* =============================================================================
   5. PRIMITIVE
   Singurul loc din aplicatie care atinge DOM-ul. La portarea pe React Native
   se rescriu doar aceste componente, ecranele raman neschimbate.
============================================================================= */

/* Reset minim si cele doua efecte permise: un fade si un slide.
   Blocul acesta dispare la portare, React Native nu foloseste CSS. */

/* Inaltimea si zona sigura de jos, tratate doar in CSS.
   Pe iOS Safari 100vh este inaltimea cu barele browserului retrase, deci
   ultimii pixeli ai aplicatiei ajung sub bara de jos. 100dvh urmareste
   inaltimea reala, iar 100vh ramane ca rezerva pentru browserele vechi.
   env(safe-area-inset-bottom) tine tab bar-ul deasupra indicatorului de
   home, necesar pentru ca index.html cere viewport-fit=cover.
   La portare aceste doua reguli dispar, in React Native echivalentul este
   useSafeAreaInsets din react-native-safe-area-context. */
const BASE_CSS = `
  .ab-root *, .ab-root *::before, .ab-root *::after { box-sizing: border-box; }
  .ab-root { margin: 0; min-height: 100vh; min-height: 100dvh; }
  .ab-shell { height: 100vh; height: 100dvh; }
  .ab-tabbar { padding-bottom: 6px; padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px)); }
  .ab-toast { bottom: 84px; bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
  .ab-sheet-pad { padding-bottom: ${S.xxl}px; padding-bottom: calc(${S.xxl}px + env(safe-area-inset-bottom, 0px)); }
  .ab-press { cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; }
  .ab-press:active { opacity: .85; }
  .ab-press:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
  .ab-input:focus { outline: none; border-color: ${C.accent}; }
  .ab-fade { animation: abFade .18s ease-out both; }
  .ab-slide-up { animation: abSlide .2s ease-out both; }
  @keyframes abFade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes abSlide { from { transform: translateY(12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
  @media (prefers-reduced-motion: reduce) {
    .ab-fade, .ab-slide-up { animation: none !important; }
  }
  .ab-scroll::-webkit-scrollbar { width: 8px; }
  .ab-scroll::-webkit-scrollbar-thumb { background: ${C.lineStrong}; border-radius: 4px; }
`;

function Box({ row, gap, flex, style, className, rol, children, ...rest }) {
  return (
    <div
      className={className}
      role={rol}
      style={{
        display: "flex",
        flexDirection: row ? "row" : "column",
        gap: gap || 0,
        flex: flex,
        minWidth: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* `randuri` taie textul dupa atatea randuri (pe React Native: numberOfLines),
   `nowrap` il tine pe un singur rand. Ambele sunt proprietati ale primitivei,
   ca ecranele sa nu scrie CSS de browser. */
function Txt({ size = 14, weight = 400, color = C.ink, mono, randuri, nowrap, style, children, ...rest }) {
  const taiat = randuri
    ? { display: "-webkit-box", WebkitLineClamp: randuri, WebkitBoxOrient: "vertical", overflow: "hidden" }
    : null;
  return (
    <span
      style={{
        fontFamily: mono ? F.num : F.ui,
        fontSize: size,
        fontWeight: weight,
        color,
        lineHeight: 1.42,
        fontVariantNumeric: "tabular-nums",
        ...(nowrap ? { whiteSpace: "nowrap" } : null),
        ...taiat,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}

function Eyebrow({ children, color = C.muted, style }) {
  return <span style={{ ...eyebrow, color, fontFamily: F.ui, ...style }}>{children}</span>;
}

/* Suma de bani, elementul cel mai citit din toata aplicatia. */
function Lei({ value, size = 15, weight = 600, color = C.ink, unit = true }) {
  const txt = lei(value, false);
  return (
    <span style={{ fontFamily: F.ui, color, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      <span style={{ fontSize: size, fontWeight: weight, letterSpacing: -0.2 }}>{txt}</span>
      {unit && <span style={{ fontSize: Math.max(9, size * 0.55), fontWeight: 600, color: C.muted, marginLeft: 3 }}>LEI</span>}
    </span>
  );
}

/* Starile pe care le anunta un buton se dau ca proprietati (`apasat`,
   `desfasurat`, `ales`, `rol`), ca ecranele sa nu scrie atribute ARIA. */
const daNu = (v) => (v === undefined ? undefined : v ? "true" : "false");

function Press({ onPress, style, className = "", children, disabled, label, apasat, desfasurat, ales, rol = "button", ...rest }) {
  return (
    <div
      role={rol}
      aria-label={label}
      aria-pressed={daNu(apasat)}
      aria-expanded={daNu(desfasurat)}
      aria-selected={daNu(ales)}
      aria-disabled={disabled ? "true" : undefined}
      tabIndex={disabled ? -1 : 0}
      className={`ab-press ${className}`}
      onClick={disabled ? undefined : onPress}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPress && onPress(); }
      }}
      /* [F15] tinta de atingere de cel putin 44 x 44 px */
      style={{ display: "flex", flexDirection: "column", minHeight: 44, minWidth: 44, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

function Btn({ label, onPress, variant = "primary", size = "md", full, disabled, style }) {
  const palete = {
    primary: { bg: C.accent, fg: C.white, bd: C.accent },
    secondary: { bg: C.surface, fg: C.ink, bd: C.lineStrong },
    quiet: { bg: "transparent", fg: C.accent, bd: "transparent" },
    danger: { bg: C.dangerSoft, fg: C.danger, bd: C.dangerLine },
  };
  /* [F14] Butonul dezactivat nu se decoloreaza, isi schimba paleta: eticheta
     ramane lizibila, pentru ca tocmai ea spune ce mai are omul de facut. */
  const pal = disabled ? { bg: C.paperDeep, fg: C.muted, bd: C.lineStrong } : palete[variant];
  const pad = size === "sm" ? { padding: "7px 11px", fontSize: 12.5 } : size === "lg" ? { padding: "14px 18px", fontSize: 15.5 } : { padding: "11px 16px", fontSize: 14 };
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: pal.bg,
        border: `1px solid ${pal.bd}`,
        borderRadius: R.md,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: full ? "stretch" : "flex-start",
        ...pad,
        ...style,
      }}
    >
      <Txt size={pad.fontSize} weight={600} color={pal.fg} style={{ textAlign: "center" }}>{label}</Txt>
    </Press>
  );
}

function Card({ children, style, pad = S.lg, ...rest }) {
  return (
    <Box
      style={{
        backgroundColor: C.surface,
        border: `1px solid ${C.line}`,
        borderRadius: R.lg,
        padding: pad,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Box>
  );
}

function Badge({ label, tone = "neutral", size = 10 }) {
  const pal = {
    neutral: [C.paperDeep, C.inkSoft],
    ok: [C.okSoft, C.ok],
    warn: [C.warnSoft, C.warn],
    danger: [C.dangerSoft, C.danger],
    accent: [C.accentSoft, C.accentInk],
    info: [C.infoSoft, C.info],
  }[tone];
  return (
    <span
      style={{
        backgroundColor: pal[0],
        color: pal[1],
        fontFamily: F.ui,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        padding: "3px 7px",
        borderRadius: R.sm,
        whiteSpace: "nowrap",
        alignSelf: "flex-start",
      }}
    >
      {label}
    </span>
  );
}

function Line({ style }) {
  return <div style={{ height: 1, backgroundColor: C.line, ...style }} />;
}

function Bar({ value, tone = C.accent, height = 6, bg = C.paperDeep }) {
  return (
    <div style={{ height, backgroundColor: bg, borderRadius: R.pill, overflow: "hidden", width: "100%" }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: tone, borderRadius: R.pill }} />
    </div>
  );
}

function Segment({ options, value, onChange, small }) {
  return (
    <Box row style={{ backgroundColor: C.paperDeep, borderRadius: R.md, padding: 3 }}>
      {options.map((o) => {
        const activ = o.value === value;
        return (
          <Press
            key={o.value}
            onPress={() => onChange(o.value)}
            apasat={activ}
            style={{
              flex: 1,
              alignItems: "center",
              padding: small ? "6px 6px" : "9px 10px",
              borderRadius: R.sm,
              backgroundColor: activ ? C.surface : "transparent",
              border: `1px solid ${activ ? C.line : "transparent"}`,
            }}
          >
            <Txt size={small ? 11.5 : 13} weight={activ ? 700 : 500} color={activ ? C.ink : C.muted} style={{ textAlign: "center" }}>
              {o.label}
            </Txt>
          </Press>
        );
      })}
    </Box>
  );
}

function Field({ label, value, onChange, placeholder, suffix, hint, eroare, type = "text", multiline, autoComplete, inputMode }) {
  /* [F5] Campul de data cere "2026-09-04"; sursa poate trimite un timestamp
     intreg, iar atunci campul ar ramane gol. */
  const valoare = type === "date" && String(value).length > 10 ? ziLocala(String(value)) : value;
  const common = {
    width: "100%",
    fontFamily: F.ui,
    fontSize: 15,
    color: C.ink,
    backgroundColor: C.surface,
    border: `1px solid ${eroare ? C.danger : C.lineStrong}`,
    borderRadius: R.md,
    padding: "11px 12px",
    fontVariantNumeric: "tabular-nums",
  };
  const eticheta = label || placeholder;
  /* [F17] Eroarea nu este doar rosie, ci si legata de camp pentru cititorul de ecran */
  const idAjutor = React.useId();
  const marcaj = {
    "aria-invalid": eroare ? "true" : undefined,
    "aria-describedby": eroare || hint ? idAjutor : undefined,
  };
  return (
    <Box gap={S.xs}>
      {label && <Eyebrow>{label}</Eyebrow>}
      <Box row style={{ alignItems: "center", gap: S.sm }}>
        {multiline ? (
          <textarea
            className="ab-input"
            aria-label={eticheta}
            {...marcaj}
            rows={3}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...common, resize: "vertical" }}
          />
        ) : (
          <input
            className="ab-input"
            aria-label={eticheta}
            {...marcaj}
            type={type}
            value={valoare}
            placeholder={placeholder}
            autoComplete={autoComplete}
            inputMode={inputMode}
            onChange={(e) => onChange(e.target.value)}
            style={common}
          />
        )}
        {suffix && <Txt size={13} color={C.muted} weight={600}>{suffix}</Txt>}
      </Box>
      {eroare ? <Txt id={idAjutor} size={11.5} color={C.danger} weight={600}>{eroare}</Txt>
        : hint ? <Txt id={idAjutor} size={11.5} color={C.muted}>{hint}</Txt> : null}
    </Box>
  );
}

function Picker({ label, value, onChange, options }) {
  return (
    <Box gap={S.xs}>
      {label && <Eyebrow>{label}</Eyebrow>}
      <select
        className="ab-input"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontFamily: F.ui, fontSize: 15, color: C.ink, backgroundColor: C.surface,
          border: `1px solid ${C.lineStrong}`, borderRadius: R.md, padding: "11px 12px", width: "100%",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Box>
  );
}

function Switch({ value, onChange, label }) {
  return (
    <Press onPress={() => onChange(!value)} label={label} apasat={value} style={{ width: 44, alignItems: "center", justifyContent: "center" }}>
      <Box
        row
        style={{
          width: 44, height: 26, borderRadius: R.pill, padding: 3,
          backgroundColor: value ? C.accent : C.lineStrong,
          alignItems: "center",
          justifyContent: value ? "flex-end" : "flex-start",
        }}
      >
        <Box style={{ width: 20, height: 20, borderRadius: R.pill, backgroundColor: C.white }} />
      </Box>
    </Press>
  );
}

/* Elementele pe care le poate atinge Tab-ul dintr-un sheet. Fisierul ales cu
   AlegeFisier este mereu un <input type="file"> ascuns (display: none):
   omul apasa butonul vizibil, nu ajunge niciodata cu Tab pe el. */
const SELECTOR_FOCALIZABIL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="file"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Panou care urca de jos. Este singura miscare de tip slide din aplicatie. */
/* `pazit` inseamna ca formularul are ceva scris: atunci nici o atingere pe
   fundal, nici tasta Escape nu mai inchid panoul, ca sa nu arunce ce a scris
   omul. */
function Sheet({ open, onClose, titlu, pazit, children }) {
  const panou = React.useRef(null);
  /* [C18] Focusul dinainte de deschidere, ca sa revina acolo la inchidere,
     si o capcana de Tab: fara ea, tastatura ajunge in ecranul din spate,
     ascuns dupa scrim. */
  const inainteDeSheet = React.useRef(null);
  useEffect(() => {
    if (open) {
      inainteDeSheet.current = document.activeElement;
      panou.current.focus();
    } else if (inainteDeSheet.current) {
      inainteDeSheet.current.focus();
      inainteDeSheet.current = null;
    }
  }, [open]);
  if (!open) return null;
  /* Sheet-ul are mereu macar butonul "Inchide" (tabindex 0) in antet, deci
     lista de mai jos nu este niciodata goala. */
  const peTasta = (e) => {
    if (e.key === "Escape") { if (!pazit) onClose(); return; }
    if (e.key !== "Tab") return;
    const focalizabile = Array.from(panou.current.querySelectorAll(SELECTOR_FOCALIZABIL));
    const prim = focalizabile[0];
    const ultim = focalizabile[focalizabile.length - 1];
    /* [F5] La deschidere focusul e pe panoul insusi (tabIndex -1), care nu e
       in lista de mai sus: fara acest caz, primul Shift+Tab nu se potriveste
       cu nicio conditie si scapa in ecranul din spate, ascuns sub scrim. */
    if (e.shiftKey && (document.activeElement === prim || document.activeElement === panou.current)) {
      e.preventDefault();
      ultim.focus();
    } else if (!e.shiftKey && document.activeElement === ultim) {
      e.preventDefault();
      prim.focus();
    }
  };
  return (
    <div
      className="ab-fade"
      onClick={pazit ? undefined : onClose}
      style={{
        position: "absolute", inset: 0, backgroundColor: C.scrim,
        display: "flex", flexDirection: "column", justifyContent: "flex-end", zIndex: 40,
      }}
    >
      <div
        className="ab-slide-up ab-scroll"
        role="dialog"
        aria-modal="true"
        aria-label={titlu}
        ref={panou}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={peTasta}
        style={{
          backgroundColor: C.paper, borderTopLeftRadius: 18, borderTopRightRadius: 18,
          maxHeight: "90%", overflowY: "auto", borderTop: `1px solid ${C.line}`,
        }}
      >
        <Box style={{ position: "sticky", top: 0, backgroundColor: C.paper, zIndex: 1 }}>
          <Box row style={{ alignItems: "center", justifyContent: "space-between", padding: `${S.lg}px ${S.lg}px ${S.md}px` }}>
            <Txt size={16} weight={700}>{titlu}</Txt>
            <Press onPress={onClose} label="Inchide" style={{ alignItems: "center", justifyContent: "center" }}>
              <Txt size={22} color={C.muted} weight={400}>×</Txt>
            </Press>
          </Box>
          <Line />
        </Box>
        <Box className="ab-sheet-pad" style={{ paddingTop: S.lg, paddingLeft: S.lg, paddingRight: S.lg }} gap={S.md}>
          {children}
        </Box>
      </div>
    </div>
  );
}

function Toast({ mesaj }) {
  if (!mesaj) return null;
  return (
    <div
      className="ab-fade ab-toast"
      role="status"
      style={{
        position: "absolute", left: S.lg, right: S.lg, zIndex: 60,
        backgroundColor: C.ink, borderRadius: R.md, padding: "11px 14px",
      }}
    >
      <Txt size={13} weight={500} color={C.toast}>{mesaj}</Txt>
    </div>
  );
}

/* [F17] Eroarea unei comenzi de bani sau de publicare ramane pe ecran, nu
   doar 3,4 secunde in mesajul zburator. */
function Eroare({ mesaj }) {
  if (!mesaj) return null;
  return (
    <Card pad={S.md} style={{ backgroundColor: C.dangerSoft, borderColor: C.dangerLine }}>
      <Txt size={12.5} color={C.danger} weight={600}>{mesaj}</Txt>
    </Card>
  );
}

/* [F22] Un cuvant de pe hartia asociatiei, explicat chiar acolo unde apare */
function Explica({ termen, text }) {
  return (
    <Box gap={2}>
      <Eyebrow>{termen}</Eyebrow>
      <Txt size={11.5} color={C.inkSoft}>{text}</Txt>
    </Box>
  );
}

function Gol({ titlu, text, actiune }) {
  return (
    <Card style={{ alignItems: "center", padding: S.xl, gap: S.sm, borderStyle: "dashed" }}>
      <Txt size={14} weight={700}>{titlu}</Txt>
      <Txt size={13} color={C.muted} style={{ textAlign: "center" }}>{text}</Txt>
      {actiune}
    </Card>
  );
}

/* Antet de sectiune, cu numar de ordine cand continutul chiar este o serie */
function Titlu({ children, actiune, sub }) {
  return (
    <Box row style={{ alignItems: "flex-end", justifyContent: "space-between", marginBottom: S.sm, gap: S.sm }}>
      <Box gap={2} flex={1}>
        <Txt size={15} weight={700}>{children}</Txt>
        {sub && <Txt size={12} color={C.muted}>{sub}</Txt>}
      </Box>
      {actiune}
    </Box>
  );
}

/* Grafic de bare simplu, construit din View-uri, fara librarie de charting,
   ca sa functioneze identic pe web si pe mobil. */
function BareLunare({ serii, tone = C.accent, zecimale = 1 }) {
  const max = Math.max(...serii.map((s) => s.valoare || 0), 0.01);
  return (
    <Box row gap={S.sm} style={{ alignItems: "flex-end", height: 118 }}>
      {serii.map((s) => (
        <Box key={s.cheie} flex={1} gap={S.xs} style={{ alignItems: "center" }}>
          <Txt size={10} weight={700} color={C.inkSoft}>{s.valoare == null ? "-" : num(s.valoare, zecimale)}</Txt>
          <div
            style={{
              width: "100%",
              height: Math.max(4, ((s.valoare || 0) / max) * 64),
              backgroundColor: s.accentuat ? tone : C.accentSoft,
              border: s.estimat ? `1px dashed ${C.warn}` : "none",
              borderRadius: R.sm,
            }}
          />
          <Txt size={10} color={C.muted}>{s.eticheta}</Txt>
        </Box>
      ))}
    </Box>
  );
}

/* Imagine dintr-un URL; pe React Native devine <Image source={{ uri }} /> */
function Imagine({ uri, latime = 64, inaltime = 64, alt = "" }) {
  return (
    <img
      src={uri}
      alt={alt}
      style={{ width: latime, height: inaltime, objectFit: "cover", borderRadius: R.sm, border: `1px solid ${C.line}`, display: "block" }}
    />
  );
}

/* Loc de poza fara fisier: datele demo au poze doar descrise */
function PozaLipsa({ latime = 64, inaltime = 64, text = "poza" }) {
  return (
    <Box style={{ width: latime, height: inaltime, borderRadius: R.sm, backgroundColor: C.paperDeep, border: `1px solid ${C.line}`, alignItems: "center", justifyContent: "center" }}>
      <Txt size={9} weight={700} color={C.muted}>{text.toUpperCase()}</Txt>
    </Box>
  );
}

/* Alegerea unui fisier sau a unei poze. Pe telefon deschide camera sau
   galeria; pe React Native se inlocuieste cu expo-image-picker. */
function AlegeFisier({ label, accept = "image/*", onAles, variant = "secondary", full, size }) {
  const ref = React.useRef(null);
  return (
    <>
      <Btn label={label} variant={variant} full={full} size={size} onPress={() => ref.current && ref.current.click()} />
      <input
        ref={ref}
        type="file"
        accept={accept}
        aria-label={label}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (f) onAles(f);
        }}
      />
    </>
  );
}

/* Poza de la telefon are 3-5 MB. O micsoram la ~1600 px inainte de upload,
   ca indexul sa ramana lizibil si stocarea sa nu explodeze (§10.4). */
function micsoreazaPoza(fisier, laturaMax = 1600) {
  if (!fisier || !fisier.type || !fisier.type.startsWith("image/")) return Promise.resolve(fisier);
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(fisier);
    img.onload = () => {
      const k = Math.min(1, laturaMax / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (!blob) return resolve(fisier);
        resolve(new File([blob], (fisier.name || "poza").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
      }, "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(fisier); };
    img.src = url;
  });
}

const urlPrevizualizare = (fisier) => URL.createObjectURL(fisier);

/* Deschide un document sau un link de telefon; pe React Native: Linking.openURL */
function deschideUrl(url) {
  if (url.startsWith("tel:")) { window.location.href = url; return; }
  window.open(url, "_blank", "noopener");
}

/* Salveaza un PDF generat in aplicatie; pe React Native: expo-sharing */
function descarcaPdf(bytes, nume) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nume;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Deschide un URL care se obtine asincron (link semnat). Fereastra se
   deschide imediat, la apasare, altfel browserul o blocheaza. */
function deschideDupa(promisiuneUrl, laEroare) {
  const w = window.open("", "_blank");
  promisiuneUrl
    .then((url) => {
      if (!url) throw new Error("Documentul nu are fisier atasat.");
      if (w) w.location.href = url; else deschideUrl(url);
    })
    .catch((e) => {
      if (w) w.close();
      laEroare(e.message || "Documentul nu a putut fi deschis.");
    });
}

/* Intrebare da/nu inaintea unei actiuni greu de intors. Raspunsul vine ca
   promisiune, pentru ca pe React Native Alert.alert este asincron. */
const confirma = (mesaj) => Promise.resolve(window.confirm(mesaj));

/* =============================================================================
   6. STARE PARTAJATA
   Un singur Context tine datele incarcate si comenzile. Datele vin de la
   sursa (Supabase sau modul demonstrativ); comenzile sunt apeluri catre ea,
   urmate de reincarcarea datelor.
============================================================================= */

const AppCtx = React.createContext(null);
const useApp = () => React.useContext(AppCtx);

/* Poza stocata pe server: cere URL-ul semnat de la sursa */
function PozaStocata({ cale, latime = 64, inaltime = 64 }) {
  const { urlFisier } = useApp();
  const [uri, setUri] = useState(null);
  useEffect(() => {
    let viu = true;
    if (cale && !cale.startsWith("demo/")) urlFisier(cale).then((u) => { if (viu) setUri(u); });
    return () => { viu = false; };
  }, [cale, urlFisier]);
  if (!uri) return <PozaLipsa latime={latime} inaltime={inaltime} />;
  return (
    <Press onPress={() => deschideUrl(uri)} label="Deschide poza">
      <Imagine uri={uri} latime={latime} inaltime={inaltime} alt="Poza atasata" />
    </Press>
  );
}

/* =============================================================================
   7. ELEMENTUL SEMNATURA
   Randul din lista de intretinere care se desface si arata calculul complet.
   Restul aplicatiei este construit in jurul lui.
============================================================================= */

function RandLista({ linie }) {
  const { date, deschideDocument } = useApp();
  const lunaListei = listaDupaId(date, linie.listaId).luna;
  const estimat = linie.metoda === "consum" && date.citiri.some((c) =>
    c.apartamentId === linie.apartamentId && c.luna === lunaListei && c.tip === linie.tipApa && c.sursa === "estimat");
  const [deschis, setDeschis] = useState(false);
  const m = METODE[linie.metoda];
  const procent = linie.sumaFactura ? round2((linie.suma / linie.sumaFactura) * 100) : 0;
  const d = linie.detaliu;
  const b = linie.baza;

  return (
    <Box>
      <Press
        onPress={() => setDeschis(!deschis)}
        label={`${linie.eticheta}, ${lei(linie.suma)}`}
        desfasurat={deschis}
        style={{ flexDirection: "row", alignItems: "center", gap: S.md, paddingTop: 11, paddingBottom: 11 }}
      >
        <Txt size={10} weight={700} color={C.muted} mono style={{ width: 20 }}>{linie.cod}</Txt>
        <Box flex={1} gap={1}>
          <Txt size={13.5} weight={600}>{linie.eticheta}</Txt>
          <Txt size={11.5} color={C.inkSoft} mono>{formulaScurta(linie)}</Txt>
        </Box>
        <Lei value={linie.suma} size={14} color={linie.suma === 0 ? C.muted : C.ink} />
        <Txt size={12} color={C.muted} style={{ width: 10, textAlign: "right" }}>{deschis ? "−" : "+"}</Txt>
      </Press>

      {deschis && (
        <Box
          className="ab-fade"
          gap={S.md}
          style={{
            borderLeftWidth: 2,
            borderLeftStyle: "solid",
            borderLeftColor: C.accent,
            paddingLeft: S.md,
            marginLeft: 4,
            marginBottom: S.md,
          }}
        >
          <Box gap={2}>
            <Eyebrow>{m.eticheta}</Eyebrow>
            <Txt size={12.5} color={C.inkSoft}>{m.explic}</Txt>
          </Box>

          {linie.metoda === "consum" ? (
            <Box gap={6} style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.md }}>
              <RandCalcul st="Contor general al blocului" dr={`${num(d.contorGeneral, 2)} mc`} />
              <RandCalcul st="Suma contoarelor din apartamente" dr={`${num(d.sumaContoare, 2)} mc`} />
              <RandCalcul st="Diferenta pe coloana" dr={`${num(d.diferenta, 2)} mc`} accent />
              <Line style={{ marginTop: 2, marginBottom: 2 }} />
              <RandCalcul st={`Pret pe metru cub, ${lei(linie.sumaFactura, false)} ÷ ${num(d.contorGeneral, 2)}`} dr={`${num(d.pretMc, 4)} lei`} />
              <RandCalcul st="Consumul apartamentului" dr={`${num(d.consumPropriu)} mc`} />
              <RandCalcul st={`Cota din diferenta, ${d.persoane} din ${d.totalPersoane} pers.`} dr={`${num(d.cotaDiferenta)} mc`} />
              <Line style={{ marginTop: 2, marginBottom: 2 }} />
              <RandCalcul
                st={`(${num(d.consumPropriu)} + ${num(d.cotaDiferenta)}) × ${num(d.pretMc, 4)}`}
                dr={lei(round2(linie.suma - (linie.rotunjire || 0)))}
                bold
              />
            </Box>
          ) : (
            <Box gap={6} style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.md }}>
              <RandCalcul st="Suma de repartizat" dr={lei(linie.sumaFactura)} />
              <RandCalcul st="Baza de calcul, tot blocul" dr={etichetaBaza(b.total, b.unitate)} />
              <RandCalcul st="Baza apartamentului" dr={etichetaBaza(b.valoare, b.unitate)} />
              <Line style={{ marginTop: 2, marginBottom: 2 }} />
              <RandCalcul
                st={`${lei(linie.sumaFactura, false)} × ${b.unitate === "%" ? numCotaEd(b.valoare) : num(b.valoare, 0)} ÷ ${b.unitate === "%" ? numCotaEd(b.total) : num(b.total, 0)}`}
                dr={lei(round2(linie.suma - (linie.rotunjire || 0)))}
                bold
              />
            </Box>
          )}

          {estimat ? (
            <Txt size={12} color={C.warn} weight={600}>
              Consumul apartamentului este estimat pe media ultimelor trei luni, pentru ca indexul nu a fost transmis la timp. Diferenta se regleaza cand se citeste contorul.
            </Txt>
          ) : null}

          {linie.metoda === "persoane_fara_lift" && b.valoare === 0 ? (
            <Txt size={12} color={C.ok} weight={600}>Apartamentul este scutit de lift, de aceea nu plateste nimic pe acest rand.</Txt>
          ) : null}

          {linie.rotunjire ? (
            <Txt size={11.5} color={C.muted}>
              La suma de mai sus se adauga {lei(linie.rotunjire)} din rotunjirea la ban a intregii facturi, ca totalul impartit sa fie egal cu factura. Restul de rotunjire merge la apartamentul cu partea cea mai mare.
            </Txt>
          ) : null}

          <Box gap={2}>
            <Eyebrow>Documentul justificativ</Eyebrow>
            <Txt size={12.5} weight={600}>{linie.furnizor}</Txt>
            <Txt size={12} color={C.muted}>
              {linie.esteFond ? linie.serie : `Factura ${linie.serie || "fara numar"}, ${lei(linie.sumaFactura)}`}
            </Txt>
          </Box>

          {linie.documentId ? (
            <Btn label="Vezi documentul" variant="secondary" size="sm" onPress={() => deschideDocument(linie.documentId)} />
          ) : (
            <Txt size={11.5} color={C.muted}>Documentul nu a fost inca incarcat de administrator.</Txt>
          )}

          <Txt size={11.5} color={C.muted}>
            Apartamentul suporta {num(procent, 2)}% din aceasta cheltuiala.
          </Txt>
        </Box>
      )}
    </Box>
  );
}

/* Calculul pe scurt, afisat direct pe rand, ca locatarul sa vada de unde vine
   suma fara sa deschida randul. Calculul complet ramane in randul deschis. */
function formulaScurta(linie) {
  const d = linie.detaliu;
  const b = linie.baza;
  if (linie.metoda === "consum") return `${num(d.consumPropriu + d.cotaDiferenta)} mc × ${num(d.pretMc, 4)} lei`;
  if (linie.metoda === "persoane_fara_lift" && b.valoare === 0) return "scutit de lift";
  if (b.unitate === "%") return `cota ${num(b.valoare)}% din ${lei(linie.sumaFactura)}`;
  if (b.unitate === "apartamente") return `1 din ${num(b.total, 0)} apartamente`;
  return `${num(b.valoare, 0)} din ${num(b.total, 0)} ${b.unitate}`;
}

function etichetaBaza(valoare, unitate) {
  if (unitate === "apartamente") return Number(valoare) === 1 ? "1 apartament" : `${num(valoare, 0)} apartamente`;
  if (unitate === "%") return `${num(valoare, 2)}%`;
  if (unitate === "persoane") return Number(valoare) === 1 ? "1 persoana" : `${num(valoare, 0)} persoane`;
  return `${num(valoare, 2)} ${unitate}`;
}

function RandCalcul({ st, dr, bold, accent }) {
  return (
    <Box row style={{ justifyContent: "space-between", alignItems: "baseline", gap: S.md }}>
      <Txt size={12} color={accent ? C.warn : bold ? C.ink : C.inkSoft} weight={bold ? 700 : 400}>{st}</Txt>
      <Txt size={12.5} weight={bold ? 700 : 600} mono color={accent ? C.warn : C.ink} nowrap>{dr}</Txt>
    </Box>
  );
}

/* =============================================================================
   8. ECRANE LOCATAR
============================================================================= */

function AntetEcran({ eyebrow: eb, titlu, dreapta }) {
  return (
    <Box row style={{ alignItems: "flex-start", justifyContent: "space-between", marginBottom: S.lg, gap: S.sm }}>
      <Box gap={3} flex={1}>
        <Eyebrow>{eb}</Eyebrow>
        <Txt size={22} weight={700} style={{ letterSpacing: -0.4 }}>{titlu}</Txt>
      </Box>
      {dreapta}
    </Box>
  );
}

/* Antetul unei trepte din defalcare: numarul pasului, titlul si subtotalul */
function TreaptaAntet({ nr, titlu, total }) {
  return (
    <Box row gap={S.md} style={{ alignItems: "center", padding: `${S.md}px ${S.lg}px` }}>
      <Box style={{ width: 22, height: 22, borderRadius: R.pill, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <Txt size={12} weight={700} color={C.accentInk}>{nr}</Txt>
      </Box>
      <Txt size={14} weight={700} style={{ flex: 1 }}>{titlu}</Txt>
      <Lei value={total} size={15} weight={700} />
    </Box>
  );
}

/* Rand de suma fara factura in spate, cu calculul scris dedesubt */
function RandSuma({ eticheta, formula, suma: s, children }) {
  return (
    <Box style={{ paddingTop: 11, paddingBottom: 11 }} gap={S.xs}>
      <Box row gap={S.md} style={{ alignItems: "center" }}>
        <Box flex={1} gap={1}>
          <Txt size={13.5} weight={600}>{eticheta}</Txt>
          {formula && <Txt size={11.5} color={C.inkSoft} mono>{formula}</Txt>}
        </Box>
        <Lei value={s} size={14} />
      </Box>
      {children}
    </Box>
  );
}

function SarcinaRand({ eticheta, detaliu, tone = "accent", onPress }) {
  const culoare = { warn: C.warn, accent: C.accent, info: C.info, danger: C.danger }[tone];
  return (
    <Press onPress={onPress} label={eticheta}>
      <Card pad={S.md} style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
        <Box style={{ width: 3, alignSelf: "stretch", backgroundColor: culoare, borderRadius: R.pill }} />
        <Box flex={1} gap={2}>
          <Txt size={13.5} weight={600}>{eticheta}</Txt>
          <Txt size={12} color={C.muted}>{detaliu}</Txt>
        </Box>
        <Txt size={16} color={C.muted}>›</Txt>
      </Card>
    </Press>
  );
}

function ComparatieRand({ eticheta, valoare, max, tone }) {
  return (
    <Box gap={4}>
      <Box row style={{ justifyContent: "space-between" }}>
        <Txt size={12} color={C.inkSoft}>{eticheta}</Txt>
        <Txt size={12} weight={700} mono>{num(valoare)} mc</Txt>
      </Box>
      <Bar value={max ? (valoare / max) * 100 : 0} tone={tone} height={8} />
    </Box>
  );
}

function StareBadge({ stare }) {
  const map = {
    noua: ["Noua", "danger"],
    in_lucru: ["In lucru", "warn"],
    rezolvata: ["Rezolvata", "ok"],
  }[stare] || [stare, "neutral"];
  return <Badge label={map[0]} tone={map[1]} />;
}

function StareCitireBadge({ citire }) {
  if (!citire) return <Badge label="Netransmis" tone="warn" />;
  if (citire.stare === "respinsa") return <Badge label="Respins" tone="danger" />;
  if (citire.sursa === "estimat") return <Badge label="Estimat" tone="warn" />;
  if (citire.sursa === "pornire") return <Badge label="Index de pornire" tone="info" />;
  if (citire.stare === "validata") return <Badge label="Validat" tone="ok" />;
  return <Badge label="Trimis, in verificare" tone="info" />;
}

function ContactRand({ contact }) {
  const detaliu = contact.program || (contact.apartamentNumar ? `Apartament ${contact.apartamentNumar}` : "");
  return (
    <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
      <Box gap={2} flex={1}>
        <Eyebrow>{ROLURI_CONTACT[contact.rol] || contact.rol}</Eyebrow>
        <Txt size={13.5} weight={600}>{contact.nume}</Txt>
        {detaliu ? <Txt size={11.5} color={C.muted}>{detaliu}</Txt> : null}
      </Box>
      <Btn label={`Suna ${contact.telefon}`} variant="secondary" size="sm" onPress={() => deschideUrl(`tel:${contact.telefon.replace(/\s/g, "")}`)} />
    </Box>
  );
}

function CardContacte({ contacte }) {
  return (
    <Card gap={S.sm}>
      <Titlu sub="Oamenii care raspund de bloc">Pe cine suni</Titlu>
      {contacte.map((c, i) => (
        <Box key={c.id} gap={S.sm}>
          {i > 0 && <Line />}
          <ContactRand contact={c} />
        </Box>
      ))}
    </Card>
  );
}

/* Alegerea lunii: butoane cand sunt putine luni, lista derulanta cand sunt multe */
function AlegeLuna({ liste, value, onChange }) {
  if (liste.length <= 4) {
    return <Segment small value={value} onChange={onChange} options={liste.map((l) => ({ value: l.id, label: monthShort(l.luna) }))} />;
  }
  return <Picker label="Luna" value={value} onChange={onChange} options={liste.map((l) => ({ value: l.id, label: monthLabel(l.luna) }))} />;
}

/* Plata cu cardul. Formularul imita pagina procesatorului de plati: datele
   cardului merg la procesator, niciodata la asociatie. */
function SheetPlataCard({ open, onClose, apartamentId, sumaDePlata }) {
  const { date, platesteCard } = useApp();
  const [numar, setNumar] = useState("");
  const [expira, setExpira] = useState("");
  const [cvc, setCvc] = useState("");
  const [nume, setNume] = useState("");
  const [lucreaza, setLucreaza] = useState(false);
  const [eroare, setEroare] = useState(null);
  const [plataId, setPlataId] = useState(null);
  /* [H7/F8] O plata "in asteptare" (202) nu este confirmata inca de banca,
     dar nici un esec: nu apare in date.plati (doar platile confirmate se
     incarca), deci fara aceasta stare separata formularul ar reveni singur
     la "Plata cu cardul" si l-ar lasa pe om sa plateasca a doua oara. */
  const [asteptare, setAsteptare] = useState(null);

  const cifre = numar.replace(/\D/g, "");
  const valid = cifre.length >= 13 && /^\d{2}\/\d{2}$/.test(expira.trim()) && /^\d{3,4}$/.test(cvc.trim()) && nume.trim().length > 2;
  const plata = plataId ? date.plati.find((p) => p.id === plataId) : null;

  const inchide = () => { setNumar(""); setExpira(""); setCvc(""); setNume(""); setEroare(null); setPlataId(null); setAsteptare(null); onClose(); };
  const plateste = async () => {
    setLucreaza(true);
    setEroare(null);
    const r = await platesteCard({ apartamentId, suma: sumaDePlata, card: { numar: cifre, expira: expira.trim(), cvc: cvc.trim(), nume: nume.trim() } });
    setLucreaza(false);
    if (!r.ok) { setEroare(r.mesaj); return; }
    if (r.rezultat.inAsteptare) { setAsteptare(r.rezultat.mesaj); return; }
    setPlataId(r.rezultat.plataId);
  };

  return (
    <Sheet
      open={open}
      onClose={inchide}
      titlu={plata ? "Plata a reusit" : asteptare ? "Plata asteapta confirmarea" : "Plata cu cardul"}
      pazit={areText(numar, expira, cvc, nume)}
    >
      {asteptare ? (
        <>
          <Card gap={S.sm} style={{ backgroundColor: C.infoSoft, borderColor: C.infoSoft }}>
            <Badge label="In asteptare" tone="info" />
            <Txt size={14} weight={600} color={C.info}>{asteptare}</Txt>
            <Txt size={13} color={C.inkSoft}>
              Nu plati din nou: cand banca confirma plata, ea apare automat la Platile mele, cu chitanta.
            </Txt>
          </Card>
          <Btn label="Am inteles" variant="secondary" full onPress={inchide} />
        </>
      ) : plata ? (
        <>
          <Card gap={S.sm} style={{ backgroundColor: C.okSoft, borderColor: C.okLine }}>
            <Badge label="Platit" tone="ok" />
            <Lei value={plata.suma} size={28} weight={700} color={C.ok} />
            <Txt size={13} color={C.inkSoft}>
              Chitanta {plata.chitanta ? numarChitanta(plata.chitanta) : ""} a fost emisa pe {dataLunga(plata.confirmataLa)}. O gasesti oricand in Plata, la Platile mele.
            </Txt>
          </Card>
          {/* [J14] plata.chitanta poate lipsi (nu inca emisa): textul de mai
              sus deja o trateaza, dar butonul citea plata.chitanta.numar
              neconditionat. Ascuns, ca la Platile mele si la fisa
              apartamentului (p.chitanta &&). */}
          {plata.chitanta && (
            <Btn label="Descarca chitanta" full size="lg" onPress={() => descarcaPdf(chitantaPdf(date, plata), `chitanta-${plata.chitanta.numar}.pdf`)} />
          )}
          <Btn label="Gata" variant="secondary" full onPress={inchide} />
        </>
      ) : (
        <>
          <Card gap={S.xs} pad={S.md}>
            <Eyebrow>De plata</Eyebrow>
            <Lei value={sumaDePlata} size={26} weight={700} />
            <Txt size={12} color={C.muted}>Catre {date.asociatie.denumire}</Txt>
          </Card>
          <Field label="Numarul cardului" value={numar} onChange={setNumar} placeholder="0000 0000 0000 0000" inputMode="numeric" autoComplete="cc-number" />
          <Box row gap={S.sm}>
            <Box flex={1}><Field label="Expira" value={expira} onChange={setExpira} placeholder="LL/AA" autoComplete="cc-exp" /></Box>
            <Box flex={1}><Field label="Cod CVC" value={cvc} onChange={setCvc} placeholder="123" inputMode="numeric" autoComplete="cc-csc" /></Box>
          </Box>
          <Field label="Numele de pe card" value={nume} onChange={setNume} placeholder="ELENA MARINESCU" autoComplete="cc-name" />
          <Eroare mesaj={eroare} />
          <Btn label={lucreaza ? "Se proceseaza..." : `Plateste ${lei(sumaDePlata)}`} full size="lg" disabled={!valid || lucreaza} onPress={plateste} />
          <Txt size={11.5} color={C.muted}>
            Plata este procesata de procesatorul de plati. Datele cardului nu ajung la asociatie. Chitanta se emite imediat ce banca confirma plata.
          </Txt>
          <Card pad={S.md} style={{ backgroundColor: C.infoSoft, borderColor: C.infoSoft }} gap={2}>
            <Txt size={11.5} weight={700} color={C.info}>Procesator de test</Txt>
            <Txt size={11.5} color={C.info}>Merge orice numar de card de test, de exemplu 4242 4242 4242 4242. Cardul 4000 0000 0000 0002 este refuzat de banca.</Txt>
          </Card>
        </>
      )}
    </Sheet>
  );
}

function LocatarAcasa({ go }) {
  const { date, marcheazaNotificareCitita } = useApp();
  const ap = apartamentulMeu(date);
  const lista = listaCurenta(date);
  const deDat = sold(date, ap.id);
  const achitat = deDat <= 0;
  const scadenta = lista ? lista.scadenta : null;
  const zile = scadenta ? zileIntre(date.azi, scadenta) : null;
  /* [E2] Badge-ul nu se poate uita doar la scadenta listei curente: o datorie
     mai veche deja scadenta (alta lista, o corectie) face termenul depasit
     chiar daca lista curenta mai are zile pana la scadenta ei. */
  const areRestanta = restanta(date, ap.id) > 0;
  const ultimaPlata = date.plati.filter((p) => p.apartamentId === ap.id && p.stare === "confirmata").sort(dupaConfirmare)[0];
  const istoric = istoricLunar(date, ap.id);
  const fraza = frazaComparatie(istoric);

  const lunaCitire = lunaDe(date.azi);
  const termenCitire = `${lunaCitire}-${pad2(date.setari.ziLimitaCitire)}`;
  const contoare = date.contoare.filter((c) => c.apartamentId === ap.id);
  const citireFacuta = contoare.length > 0 && contoare.every((c) => { const x = citireLuna(date, c.id, lunaCitire); return x && x.stare !== "respinsa"; });
  const citireRespinsa = contoare.some((c) => { const x = citireLuna(date, c.id, lunaCitire); return x && x.stare === "respinsa"; });

  /* [P1] Doar proprietarul poate vota (Legea 196/2018, migratia K3). Ambele
     surse scriu eu.calitate la incarcare; `== null` e doar o plasa de
     siguranta, ca o calitate lipsa sa nu ascunda tacut sarcina, nu o
     asteptare reala azi. */
  const potVota = date.eu.calitate == null || date.eu.calitate === "proprietar";
  const votDeschis = potVota ? date.voturi.find((v) => !v.votulMeu && new Date(v.inchideLa) > new Date()) : null;
  /* [K8] Sursa trimite adunarile descrescator dupa data; sarcina trebuie sa
     arate cea mai apropiata adunare viitoare, nu cea mai indepartata. */
  const adunare = date.adunari
    .filter((a) => new Date(a.dataOra) > new Date() && !a.prezentaMea)
    .sort((x, y) => new Date(x.dataOra) - new Date(y.dataOra))[0];
  const necitite = date.notificari.filter((n) => !n.cititaLa).slice(0, 3);

  const istoricApa = istoricConsum(date, ap.id).filter((x) => !x.estimat && x.rece != null);
  const ultimaLunaApa = istoricApa.length ? istoricApa[istoricApa.length - 1].luna : null;
  const media = ultimaLunaApa && date.consumMediu[ultimaLunaApa] ? date.consumMediu[ultimaLunaApa].rece : null;
  const persoaneLunaApa = ultimaLunaApa ? persoaneInLuna(ap, ultimaLunaApa) : 0;
  const alMeuPePersoana = ultimaLunaApa && persoaneLunaApa ? round2(consumApartament(date, ap.id, ultimaLunaApa, "rece") / persoaneLunaApa) : null;
  const sesizariMele = date.sesizari.filter((s) => s.aMea && s.stare !== "rezolvata");

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`${date.bloc.denumire}, ap. ${ap.numar}`} titlu={`Buna, ${date.eu.nume.split(" ")[0]}`} />

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <Box style={{ padding: S.lg }} gap={S.md}>
          <Box row gap={S.sm} style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
            <Box gap={3}>
              <Eyebrow>{achitat ? "Totul este platit" : "De plata acum"}</Eyebrow>
              <Lei value={Math.max(0, deDat)} size={34} weight={700} />
            </Box>
            {achitat ? <Badge label="Achitat" tone="ok" />
              : zile != null && zile >= 0 && !areRestanta ? <Badge label={zile === 0 ? "Scadent azi" : `Mai ai ${pluralZile(zile)}`} tone={zile > 5 ? "neutral" : "warn"} />
                : <Badge label="Termen depasit" tone="danger" />}
          </Box>
          {avans(date, ap.id) > 0 && (
            <Txt size={12.5} color={C.ok} weight={600}>Ai platit in avans {lei(avans(date, ap.id))}. Se scad din urmatoarea lista.</Txt>
          )}
          {lista && (
            <Txt size={12.5} color={C.muted}>
              Lista pe {monthLabel(lista.luna)}, termen de plata {dataLunga(scadenta)}. Dupa {date.setari.zileGratie} de zile de la scadenta se calculeaza penalizari de {num(date.setari.procentPenalizareZi)}% pe zi.
            </Txt>
          )}
          {!achitat ? (
            <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
              <Btn label="Plateste acum" onPress={() => go("plata", { plateste: true })} />
              <Btn label="De unde vine suma" variant="secondary" onPress={() => go("plata")} />
            </Box>
          ) : ultimaPlata && ultimaPlata.chitanta ? (
            <Btn label="Descarca ultima chitanta" variant="secondary" onPress={() => descarcaPdf(chitantaPdf(date, ultimaPlata), `chitanta-${ultimaPlata.chitanta.numar}.pdf`)} />
          ) : null}
        </Box>
        {fraza && (
          <>
            <Line />
            <Press onPress={() => go("plata", { tab: "istoric" })} style={{ padding: S.md, paddingLeft: S.lg, paddingRight: S.lg, flexDirection: "row", gap: S.md, alignItems: "center" }}>
              <Txt size={12.5} color={C.inkSoft} style={{ flex: 1 }}>{fraza}</Txt>
              <Txt size={16} color={C.accent} weight={700}>›</Txt>
            </Press>
          </>
        )}
      </Card>

      {necitite.length > 0 && (
        <Box gap={S.sm}>
          <Titlu sub="Trimise de administratie">Mesaje noi</Titlu>
          {necitite.map((n) => (
            <Card key={n.id} pad={S.md} gap={S.xs} style={{ borderColor: n.tip === "restanta" ? C.dangerLine : C.accentLine }}>
              <Box row style={{ justifyContent: "space-between", gap: S.sm }}>
                <Txt size={13.5} weight={700} color={n.tip === "restanta" ? C.danger : C.ink}>{n.titlu}</Txt>
                <Txt size={11} color={C.muted}>{dataRo(n.trimisaLa)}</Txt>
              </Box>
              {n.corp ? <Txt size={12.5} color={C.inkSoft}>{n.corp}</Txt> : null}
              <Btn label="Am citit" variant="quiet" size="sm" style={{ paddingLeft: 0 }} onPress={() => marcheazaNotificareCitita(n.id)} />
            </Card>
          ))}
        </Box>
      )}

      <Box gap={S.sm}>
        <Titlu sub="Ce ai de facut in perioada urmatoare">De facut</Titlu>
        {!citireFacuta && (
          <SarcinaRand
            eticheta={citireRespinsa ? "Trimite din nou indexul la apa" : "Transmite indexul la apa"}
            detaliu={citireRespinsa ? "Administratorul a respins citirea trimisa. Vezi de ce." : `Termen ${dataLunga(termenCitire)}${zileIntre(date.azi, termenCitire) >= 0 ? `, mai sunt ${pluralZile(zileIntre(date.azi, termenCitire))}` : ""}`}
            tone={citireRespinsa ? "danger" : "warn"}
            onPress={() => go("consum")}
          />
        )}
        {votDeschis && (
          <SarcinaRand eticheta={`Voteaza: ${votDeschis.titlu}`} detaliu={`Votul se inchide pe ${dataLunga(votDeschis.inchideLa)}`} tone="info" onPress={() => go("bloc", { tab: "vot" })} />
        )}
        {adunare && (
          <SarcinaRand eticheta="Confirma prezenta la adunarea generala" detaliu={`${dataLunga(adunare.dataOra)}, ora ${oraRo(adunare.dataOra)}`} tone="info" onPress={() => go("bloc", { tab: "vot" })} />
        )}
        {citireFacuta && achitat && !votDeschis && !adunare && (
          <Gol titlu="Nimic de facut acum" text="Ai platit tot si ai transmis indexul. Te anuntam cand apare ceva nou." />
        )}
      </Box>

      {date.anunturi.length > 0 && (
        <Box gap={S.sm}>
          <Titlu actiune={<Press onPress={() => go("bloc")}><Txt size={12.5} weight={700} color={C.accent}>Toate anunturile</Txt></Press>}>
            De la avizier
          </Titlu>
          {date.anunturi.slice(0, 2).map((a) => (
            <Press key={a.id} onPress={() => go("bloc")}>
              <Card pad={S.md} gap={S.xs}>
                <Box row gap={S.sm} style={{ alignItems: "center" }}>
                  {a.urgent && <Badge label="Urgent" tone="danger" />}
                  {!a.citit && <Badge label="Nou" tone="accent" />}
                  <Txt size={11} color={C.muted}>{dataRo(a.publicatLa)}</Txt>
                </Box>
                <Txt size={13.5} weight={600}>{a.titlu}</Txt>
                <Txt size={12.5} color={C.inkSoft} randuri={2}>{a.corp}</Txt>
              </Card>
            </Press>
          ))}
        </Box>
      )}

      {media != null && alMeuPePersoana != null && (
        <Card gap={S.md}>
          <Titlu sub={`Apa rece pe persoana, ${monthLabel(ultimaLunaApa)}`}>Consumul tau fata de bloc</Titlu>
          <Box gap={S.sm}>
            <ComparatieRand eticheta="Apartamentul tau" valoare={alMeuPePersoana} max={Math.max(alMeuPePersoana, media)} tone={C.accent} />
            <ComparatieRand eticheta="Media blocului" valoare={media} max={Math.max(alMeuPePersoana, media)} tone={C.lineStrong} />
          </Box>
          <Txt size={12} color={C.muted}>
            {alMeuPePersoana <= media
              ? `Consumi cu ${num(media - alMeuPePersoana)} mc mai putin decat media pe persoana.`
              : `Consumi cu ${num(alMeuPePersoana - media)} mc mai mult decat media pe persoana.`}
          </Txt>
        </Card>
      )}

      {sesizariMele.length > 0 && (
        <Box gap={S.sm}>
          <Titlu>Sesizarile tale</Titlu>
          {sesizariMele.map((s) => {
            const ultim = s.mesaje.filter((m) => m.dinAdministratie).slice(-1)[0];
            return (
              <Press key={s.id} onPress={() => go("sesizari")}>
                <Card pad={S.md} gap={S.xs}>
                  <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
                    <Txt size={13.5} weight={600}>{s.titlu}</Txt>
                    <StareBadge stare={s.stare} />
                  </Box>
                  {ultim && <Txt size={12.5} color={C.inkSoft}>Raspuns: {ultim.text}</Txt>}
                </Card>
              </Press>
            );
          })}
        </Box>
      )}

      <CardContacte contacte={date.contacte} />
    </Box>
  );
}

function LocatarPlata({ parametri }) {
  const { date, deschideDocument } = useApp();
  const ap = apartamentulMeu(date);
  const publicate = listePublicate(date);
  const [listaId, setListaId] = useState(publicate[0] ? publicate[0].id : null);
  const [tab, setTab] = useState(parametri && parametri.tab === "istoric" ? "istoric" : "lista");
  const deDat = sold(date, ap.id);
  const [plata, setPlata] = useState(!!(parametri && parametri.plateste) && deDat > 0);

  if (!listaId) {
    return (
      <Box gap={S.lg}>
        <AntetEcran eyebrow={`Apartament ${ap.numar}`} titlu="Intretinere" />
        <Gol titlu="Nicio lista publicata" text="Cand administratorul publica lista de plata, o vezi aici cu fiecare calcul." />
      </Box>
    );
  }

  const def = defalcare(date, ap.id, listaId);
  const { cheltuieli, fonduri, datorii } = def.trepte;
  const istoric = istoricLunar(date, ap.id);
  const fraza = frazaComparatie(istoric);
  const plati = date.plati.filter((p) => p.apartamentId === ap.id && p.stare === "confirmata").sort(dupaConfirmare);

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`Apartament ${ap.numar}, ${ap.persoane} persoane, cota ${num(ap.cota)}%`} titlu="Intretinere" />

      <Segment
        value={tab}
        onChange={setTab}
        options={[{ value: "lista", label: "Lista de plata" }, { value: "istoric", label: "Platile mele" }]}
      />

      {tab === "lista" ? (
        <>
          <AlegeLuna liste={publicate} value={listaId} onChange={setListaId} />

          <Card gap={S.md}>
            <Box row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <Box gap={3}>
                <Eyebrow>{def.esteCurenta ? "Total de plata acum" : `Lista pe ${monthLabel(def.lista.luna)}`}</Eyebrow>
                <Lei value={def.total} size={30} weight={700} />
              </Box>
              {def.esteCurenta ? (deDat <= 0 ? <Badge label="Achitat" tone="ok" /> : null)
                : <Badge label={def.achitat ? "Achitata" : "Neachitata"} tone={def.achitat ? "ok" : "danger"} />}
            </Box>
            <Box gap={6} style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.md }}>
              <RandCalcul st={`1. Cheltuielile lunii ${monthName(def.lista.luna)}`} dr={lei(cheltuieli.total)} />
              <RandCalcul st="2. Fonduri" dr={lei(fonduri.total)} />
              {datorii && datorii.corectieSuma !== 0 && <RandCalcul st="Corectie dupa recalculare (inclusa in cheltuielile de mai sus)" dr={lei(datorii.corectieSuma)} />}
              {datorii && datorii.platitDinLista > 0 && <RandCalcul st="Platit deja din lista lunii" dr={lei(-datorii.platitDinLista)} />}
              {datorii && <RandCalcul st="3. Datorii din lunile trecute" dr={lei(datorii.total)} accent={datorii.total > 0} />}
              <Line style={{ marginTop: 2, marginBottom: 2 }} />
              <RandCalcul st={def.esteCurenta ? "Total de plata" : "Total lista"} dr={lei(def.total)} bold />
            </Box>
            {def.esteCurenta && deDat > 0 && (
              <Btn label={`Plateste ${lei(deDat)} cu cardul`} full size="lg" onPress={() => setPlata(true)} />
            )}
            <Txt size={12} color={C.muted}>
              {def.lista.scadenta ? `Termen de plata ${dataLunga(def.lista.scadenta)}. ` : ""}Mai jos este fiecare suma pe rand. Apasa pe un rand ca sa vezi factura si calculul complet.
            </Txt>
          </Card>

          <Card pad={0}>
            <TreaptaAntet nr={1} titlu="Cheltuielile lunii" total={cheltuieli.total} />
            {cheltuieli.grupe.map((g) => (
              <Box key={g.id}>
                <Line />
                <Box row style={{ padding: `${S.md}px ${S.lg}px 0`, justifyContent: "space-between", alignItems: "baseline" }}>
                  <Eyebrow>{g.eticheta}</Eyebrow>
                  <Lei value={g.total} size={12} weight={700} color={C.inkSoft} />
                </Box>
                <Box style={{ paddingLeft: S.lg, paddingRight: S.lg }}>
                  {g.linii.map((l, i) => (
                    <Box key={l.id}>
                      {i > 0 && <Line />}
                      <RandLista linie={l} />
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}
          </Card>

          {fonduri.linii.length > 0 && (
            <Card pad={0}>
              <TreaptaAntet nr={2} titlu="Fonduri" total={fonduri.total} />
              <Line />
              <Box style={{ paddingLeft: S.lg, paddingRight: S.lg }}>
                {fonduri.linii.map((l, i) => (
                  <Box key={l.id}>
                    {i > 0 && <Line />}
                    <RandLista linie={l} />
                  </Box>
                ))}
              </Box>
            </Card>
          )}

          {datorii && (
            <Card pad={0}>
              <TreaptaAntet nr={3} titlu="Datorii din lunile trecute" total={datorii.total} />
              <Line />
              {datorii.restante.length === 0 && datorii.penalizari.length === 0 ? (
                <Box style={{ padding: `${S.md}px ${S.lg}px` }}>
                  <Txt size={13} color={C.ok} weight={600}>Nu ai datorii din lunile trecute.</Txt>
                </Box>
              ) : (
                <Box style={{ paddingLeft: S.lg, paddingRight: S.lg }}>
                  {datorii.restante.map((d, i) => (
                    <Box key={d.id}>
                      {i > 0 && <Line />}
                      <RandSuma
                        eticheta={d.tip === "intretinere" ? `Intretinere ${monthLabel(d.luna)}, neplatita` : d.descriere}
                        formula={`${d.rest < d.suma ? `rest din ${lei(d.suma)}, ` : ""}scadenta ${dataRo(d.scadenta)}${d.zile > 0 ? `, ${pluralZile(d.zile)} intarziere` : ""}`}
                        suma={d.rest}
                      >
                        {d.documentId ? <Btn label="Vezi lista de pe hartie" variant="quiet" size="sm" style={{ paddingLeft: 0 }} onPress={() => deschideDocument(d.documentId)} /> : null}
                      </RandSuma>
                    </Box>
                  ))}
                  {datorii.penalizari.map((d) => (
                    <Box key={d.id}>
                      <Line />
                      <RandSuma
                        eticheta={`Penalizare calculata pe ${dataLunga(d.scadenta)}`}
                        formula={d.calcul ? `${lei(d.calcul.restNeachitat, false)} × ${num(d.calcul.procentZi)}% × ${d.calcul.zileTaxate} zile` : d.descriere}
                        suma={d.rest}
                      >
                        {d.calcul && (
                          <Txt size={11.5} color={C.muted}>
                            {d.descriere}. Suma neplatita era {lei(d.calcul.restNeachitat)}, cu {pluralZile(d.calcul.zileIntarziere)} de la scadenta; primele {pluralZile(d.calcul.zileGratie)} nu se penalizeaza.
                          </Txt>
                        )}
                      </RandSuma>
                    </Box>
                  ))}
                  <Txt size={11.5} color={C.muted} style={{ paddingBottom: S.md }}>
                    Penalizarea este de {num(date.setari.procentPenalizareZi)}% pe zi din suma neplatita, doar pentru zilele de dupa primele {date.setari.zileGratie} de intarziere, si nu poate depasi suma datorata. Se calculeaza pe data de 1 a fiecarei luni.
                  </Txt>
                </Box>
              )}
            </Card>
          )}

          <Card gap={S.sm} style={{ backgroundColor: C.accentSoft, borderColor: C.accentLine }}>
            <Txt size={13} weight={700} color={C.accentInk}>Verificarea repartitiei</Txt>
            <RandCalcul st="Total facturi si fonduri pe luna" dr={lei(suma(date.cheltuieli.filter((c) => c.listaId === listaId), (c) => c.suma))} />
            <RandCalcul st={`Total repartizat pe cele ${def.lista.apartamente} apartamente`} dr={lei(def.lista.totalRepartizat)} />
            <Line style={{ backgroundColor: C.accentLine }} />
            <RandCalcul st="Diferenta" dr={lei(suma(date.cheltuieli.filter((c) => c.listaId === listaId), (c) => c.suma) - def.lista.totalRepartizat)} bold />
            <Txt size={11.5} color={C.accentInk}>
              Suma facturilor primite de asociatie este egala cu suma impartita proprietarilor. Nimic nu ramane nealocat si nimic nu se plateste de doua ori.
            </Txt>
            <Explica termen="Total repartizat" text="Repartizat inseamna impartit pe apartamente. Totalul repartizat este cat s-a impartit in luna aceasta la toate apartamentele, dupa regulile de mai sus." />
            <Explica termen="Cota indiviza" text={`Cota indiviza este partea ta din proprietatea comuna a blocului, scrisa in actul de proprietate. Apartamentul tau are ${num(ap.cota)}%, iar dupa cota se impart cheltuielile care tin de cladire, nu de consum.`} />
          </Card>
        </>
      ) : (
        <Box gap={S.md}>
          {fraza && (
            <Card gap={S.xs} style={{ backgroundColor: C.accentSoft, borderColor: C.accentLine }}>
              <Txt size={14} weight={600} color={C.accentInk}>{fraza}</Txt>
            </Card>
          )}
          <Card gap={S.sm}>
            <Titlu sub="Totalul listei pe fiecare luna">Cat ai avut de plata</Titlu>
            <BareLunare
              zecimale={0}
              serii={istoric.slice(0, 6).reverse().map((x, i, arr) => ({ cheie: x.luna, eticheta: monthShort(x.luna), valoare: x.total, accentuat: i === arr.length - 1 }))}
            />
            {istoric.map((x) => (
              <Box key={x.luna} row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
                <Txt size={12.5} color={C.inkSoft}>{monthLabel(x.luna)}</Txt>
                <Box row gap={S.sm} style={{ alignItems: "center" }}>
                  <Lei value={x.total} size={12.5} />
                  <Badge label={x.achitat ? "Achitat" : "Neachitat"} tone={x.achitat ? "ok" : "danger"} />
                </Box>
              </Box>
            ))}
          </Card>
          <Titlu sub="Fiecare plata are chitanta ei">Platile tale</Titlu>
          {plati.length === 0 ? (
            <Gol titlu="Nicio plata inca" text="Dupa prima plata, chitanta apare aici si o poti descarca oricand." />
          ) : plati.map((p) => (
            <Card key={p.id} pad={S.md} gap={S.sm}>
              <Box row style={{ alignItems: "flex-start", gap: S.md }}>
                <Box flex={1} gap={2}>
                  <Txt size={13.5} weight={600}>{descriereAlocari(date, p).join(", ")}</Txt>
                  <Txt size={11.5} color={C.muted}>{dataLunga(p.confirmataLa)}, {p.metoda === "card" ? "card" : p.metoda === "numerar" ? "numerar" : "transfer"}</Txt>
                  {p.chitanta && <Txt size={11.5} color={C.muted}>Chitanta {numarChitanta(p.chitanta)}</Txt>}
                </Box>
                <Lei value={p.suma} size={14} />
              </Box>
              {p.chitanta && <Btn label="Descarca chitanta" variant="secondary" size="sm" onPress={() => descarcaPdf(chitantaPdf(date, p), `chitanta-${p.chitanta.numar}.pdf`)} />}
            </Card>
          ))}
        </Box>
      )}

      <SheetPlataCard open={plata} onClose={() => setPlata(false)} apartamentId={ap.id} sumaDePlata={deDat} />
    </Box>
  );
}

function LocatarConsum() {
  const { date, transmiteCitire } = useApp();
  const ap = apartamentulMeu(date);
  const luna = lunaDe(date.azi);
  const termen = `${luna}-${pad2(date.setari.ziLimitaCitire)}`;
  const zileRamase = zileIntre(date.azi, termen);
  const contoare = date.contoare.filter((c) => c.apartamentId === ap.id).sort((a, b) => (a.tip === "rece" ? -1 : 1) - (b.tip === "rece" ? -1 : 1));
  const [valori, setValori] = useState({});
  const [poza, setPoza] = useState(null);
  const [pozaUrl, setPozaUrl] = useState(null);
  const [corecteaza, setCorecteaza] = useState(false);
  const [lucreaza, setLucreaza] = useState(false);
  const [tipGrafic, setTipGrafic] = useState("rece");

  const citiriLuna = contoare.map((c) => ({
    contor: c, citire: citireLuna(date, c.id, luna), anterior: ultimIndexValabil(date, c.id, luna), minim: indexMinim(date, c.id, luna),
  }));
  /* [A12] O citire "pornire" e indexul de start al contorului (luna zero),
     nu o citire reala a lunii curente: nu trebuie sa blocheze transmiterea. */
  const toateTrimise = citiriLuna.length > 0 && citiriLuna.every((x) => x.citire && x.citire.stare !== "respinsa" && x.citire.sursa !== "pornire");
  const toateValidate = toateTrimise && citiriLuna.every((x) => x.citire.stare === "validata");
  /* [R7] O citire completata automat nu este o citire verificata de om */
  const estimat = citiriLuna.some((x) => x.citire && x.citire.sursa === "estimat");
  const respinsa = citiriLuna.find((x) => x.citire && x.citire.stare === "respinsa");
  /* [R5] Fara niciun contor, nu are ce sa apara: nici badge-ul de termen,
     nici cererea de poza, nici "Trimite indexul" (care ar raspunde doar
     "Scrie cel putin un index", fara nicio explicatie). */
  const arataFormular = contoare.length > 0 && (!toateTrimise || corecteaza);

  /* Se completeaza doar contoarele care nu sunt deja validate pe luna [A1].
     Eroarea opreste trimiterea; indiciul doar explica. */
  const randuri = citiriLuna.filter((x) => !(x.citire && x.citire.stare === "validata" && x.citire.sursa !== "pornire")).map((x) => {
    const v = valori[x.contor.id] || "";
    const n = numarDin(v);
    const eroare = v === "" ? null
      : Number.isNaN(n) ? "Scrie doar cifre."
        : n < x.minim ? "Indexul nou nu poate fi mai mic decat cel anterior. Verifica cifrele." : null;
    const hint = v === "" || eroare ? `Contor ${x.contor.serie}${x.contor.amplasare ? `, ${x.contor.amplasare}` : ""}`
      : n < x.anterior ? `Indexul este sub estimarea din luna trecuta (${num(x.anterior, 1)}). Pe luna aceasta nu se calculeaza consum la acest contor.`
        : n - x.anterior > 60 ? "Consumul pare foarte mare. Verifica inca o data cifrele."
          : `Consum calculat: ${num(n - x.anterior)} mc`;
    return { ...x, v, n, eroare, hint };
  });
  const potTrimite = randuri.every((r) => r.v !== "" && !r.eroare) && poza && !lucreaza;

  /* [F7] Poza inlocuita sau trimisa nu mai tine minte un URL temporar */
  const uitaPoza = () => { if (pozaUrl) URL.revokeObjectURL(pozaUrl); };
  const alegePoza = async (f) => {
    const mica = await micsoreazaPoza(f);
    uitaPoza();
    setPoza(mica);
    setPozaUrl(urlPrevizualizare(mica));
  };
  const trimite = async () => {
    setLucreaza(true);
    const r = await transmiteCitire({ apartamentId: ap.id, luna, indexuri: randuri.map((x) => ({ contorId: x.contor.id, index: x.n })), poza });
    setLucreaza(false);
    if (r.ok) { uitaPoza(); setValori({}); setPoza(null); setPozaUrl(null); setCorecteaza(false); }
  };

  const istoric = istoricConsum(date, ap.id);
  const ultimaApa = date.repartizari
    .filter((r) => r.detaliu && r.detaliu.tip === "rece")
    .map((r) => ({ r, l: listaDupaId(date, r.listaId) }))
    .sort((a, b) => (a.l.luna < b.l.luna ? 1 : -1))[0];

  const numeTip = (t) => (t === "rece" ? "Apa rece" : "Apa calda");

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`Apartament ${ap.numar}`} titlu="Contoare" />

      {contoare.length === 0 && (
        <Card gap={S.sm}>
          <Txt size={15} weight={700}>Apartamentul tau nu are niciun contor de apa</Txt>
          <Txt size={13} color={C.inkSoft}>Nu ai niciun index de transmis. Daca ai montat un contor, spune-i administratorului sa il inregistreze.</Txt>
        </Card>
      )}

      {toateTrimise && !corecteaza ? (
        <Card gap={S.sm} style={{ backgroundColor: estimat ? C.warnSoft : toateValidate ? C.okSoft : C.infoSoft, borderColor: estimat ? C.warnLine : toateValidate ? C.okLine : C.infoSoft }}>
          <Badge label={estimat ? "Estimat" : toateValidate ? "Validat" : "Trimis"} tone={estimat ? "warn" : toateValidate ? "ok" : "info"} />
          <Txt size={14} weight={700} color={estimat ? C.warn : toateValidate ? C.ok : C.info}>
            {estimat ? `Indexul pe ${monthName(luna)} a fost completat cu o estimare`
              : toateValidate ? `Indexul pe ${monthName(luna)} a fost verificat de administrator`
                : `Indexul pe ${monthName(luna)} a ajuns la administrator`}
          </Txt>
          {estimat ? (
            <Txt size={12.5} color={C.inkSoft}>
              Indexul nu a ajuns la timp, asa ca administratorul a pus consumul mediu al ultimelor trei luni. Estimarea se regleaza la prima citire reala: ce ai platit in plus se scade atunci, ce ai platit in minus se adauga. Daca cifra nu e buna, scrie-i administratorului la Sesizari.
            </Txt>
          ) : null}
          {citiriLuna.map((x) => (
            <RandCalcul key={x.contor.id} st={numeTip(x.contor.tip)} dr={`${num(x.citire.indexCurent, 1)}, consum ${num(x.citire.consum)} mc`} />
          ))}
          {!toateValidate && zileRamase >= 0 && (
            <>
              <Txt size={12.5} color={C.inkSoft}>Il poti corecta pana pe {dataLunga(termen)}. Dupa validare intra in lista de plata pe {monthName(luna)}.</Txt>
              <Btn label="Corecteaza indexul" variant="secondary" size="sm" onPress={() => setCorecteaza(true)} />
            </>
          )}
        </Card>
      ) : null}

      {arataFormular && (
        <Card gap={S.lg}>
          <Box gap={3}>
            <Box row gap={S.sm} style={{ alignItems: "center" }}>
              <Badge label={zileRamase >= 0 ? `Termen ${dataRo(termen)}` : "Termen depasit"} tone={zileRamase >= 0 ? "warn" : "danger"} />
            </Box>
            <Txt size={16} weight={700}>Citirea pentru {monthName(luna)}</Txt>
            <Txt size={12.5} color={C.muted}>
              Scrie cifrele negre de pe cadran, fara cele rosii. Fotografiaza contoarele, ca administratorul sa poata verifica. Daca nu transmiti pana pe {dataLunga(termen)}, primesti consum estimat pe media ultimelor trei luni.
            </Txt>
          </Box>

          {respinsa && (
            <Card pad={S.md} style={{ backgroundColor: C.dangerSoft, borderColor: C.dangerLine }} gap={2}>
              <Txt size={13} weight={700} color={C.danger}>Citirea trimisa a fost respinsa</Txt>
              <Txt size={12.5} color={C.danger}>{respinsa.citire.motivRespingere}</Txt>
            </Card>
          )}

          <Box gap={S.md}>
            {randuri.map((x) => (
              <Field
                key={x.contor.id}
                label={`${numeTip(x.contor.tip)}, index anterior ${num(x.anterior, 1)}`}
                value={x.v}
                onChange={(t) => setValori({ ...valori, [x.contor.id]: t })}
                placeholder={num(x.anterior, 1)}
                suffix="mc"
                inputMode="decimal"
                eroare={x.eroare}
                hint={x.hint}
              />
            ))}
          </Box>

          <Box gap={S.sm}>
            <Eyebrow>Poza contoarelor</Eyebrow>
            {pozaUrl ? (
              <Box row gap={S.md} style={{ alignItems: "center" }}>
                <Imagine uri={pozaUrl} latime={88} inaltime={88} alt="Poza contoarelor" />
                <AlegeFisier label="Alta poza" onAles={alegePoza} size="sm" />
              </Box>
            ) : (
              <AlegeFisier label="Fotografiaza contoarele" onAles={alegePoza} full />
            )}
          </Box>

          <Btn label={lucreaza ? "Se trimite..." : "Trimite indexul"} full size="lg" onPress={trimite} disabled={!potTrimite} />
          {!poza && randuri.every((r) => r.v !== "") && <Txt size={11.5} color={C.warn} weight={600}>Mai adauga poza contoarelor, apoi poti trimite.</Txt>}
          {corecteaza && <Btn label="Renunta la corectare" variant="quiet" size="sm" onPress={() => setCorecteaza(false)} />}
        </Card>
      )}

      {istoric.length > 0 && (
        <Card gap={S.md}>
          <Titlu sub="Metri cubi pe luna, de la intrarea in aplicatie">Cum a evoluat consumul</Titlu>
          <Segment small value={tipGrafic} onChange={setTipGrafic} options={[{ value: "rece", label: "Apa rece" }, { value: "calda", label: "Apa calda" }]} />
          <BareLunare
            serii={istoric.slice(-8).map((x, i, arr) => ({ cheie: x.luna, eticheta: monthShort(x.luna), valoare: x[tipGrafic], accentuat: i === arr.length - 1, estimat: x.estimat }))}
          />
          <Box gap={S.xs}>
            {istoric.slice().reverse().map((x) => {
              const media = date.consumMediu[x.luna];
              /* [J10] Persoanele acelei luni, nu cele de azi (ap.persoane):
                 media blocului de alaturi (date.consumMediu) e deja
                 calculata pe persoanele lunii ei, la fel ca la LocatarAcasa. */
              const persLuna = persoaneInLuna(ap, x.luna);
              const pePers = persLuna && x[tipGrafic] != null ? round2(x[tipGrafic] / persLuna) : null;
              return (
                <Box key={x.luna} row style={{ justifyContent: "space-between", gap: S.sm }}>
                  <Txt size={12} color={C.inkSoft}>{monthShort(x.luna)}{x.estimat ? " (estimat)" : ""}</Txt>
                  <Txt size={12} mono weight={600}>
                    {x[tipGrafic] == null ? "-" : `${num(x[tipGrafic])} mc`}
                    {pePers != null && media && media[tipGrafic] != null ? `  ·  ${num(pePers)} pe pers., bloc ${num(media[tipGrafic])}` : ""}
                  </Txt>
                </Box>
              );
            })}
          </Box>
        </Card>
      )}

      <Box gap={S.sm}>
        <Titlu sub="Indexurile transmise si validate">Istoric</Titlu>
        <Card pad={0}>
          {[...new Set(date.citiri.filter((c) => c.apartamentId === ap.id).map((c) => c.luna))].sort().reverse().map((l, i) => (
            <Box key={l}>
              {i > 0 && <Line />}
              <Box style={{ padding: S.md }} gap={S.sm}>
                <Txt size={13} weight={700}>{monthLabel(l)}</Txt>
                <Box row gap={S.lg}>
                  {contoare.map((c) => {
                    const x = citireLuna(date, c.id, l);
                    return (
                      <Box key={c.id} gap={3} flex={1}>
                        <Eyebrow>{numeTip(c.tip)}</Eyebrow>
                        {x ? (
                          <>
                            <Txt size={12.5} mono>{x.sursa === "pornire" ? num(x.indexCurent, 1) : `${num(x.indexAnterior, 1)} → ${num(x.indexCurent, 1)}`}</Txt>
                            {x.sursa !== "pornire" && <Txt size={11.5} color={C.muted}>{num(x.consum)} mc consumati</Txt>}
                          </>
                        ) : <Txt size={12} color={C.muted}>-</Txt>}
                        <StareCitireBadge citire={x} />
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </Box>
          ))}
        </Card>
      </Box>

      {ultimaApa && (
        <Card gap={S.sm} style={{ backgroundColor: C.paperDeep, borderColor: C.lineStrong }}>
          <Txt size={13} weight={700}>De ce plateste blocul mai multa apa decat arata contoarele</Txt>
          <Txt size={12.5} color={C.inkSoft}>
            In {monthName(ultimaApa.l.luna)} contorul general de la subsol a inregistrat {num(ultimaApa.r.detaliu.contorGeneral, 1)} mc, iar contoarele din apartamente au insumat {num(ultimaApa.r.detaliu.sumaContoare, 1)} mc. Diferenta de {num(ultimaApa.r.detaliu.diferenta, 1)} mc vine din pierderi pe coloana, robinete care picura si contoare care nu mai masoara corect. Asociatia plateste furnizorului tot ce arata contorul general, asa ca diferenta se imparte pe numarul de persoane: tie iti revin {num(ultimaApa.r.detaliu.cotaDiferenta)} mc.
          </Txt>
        </Card>
      )}
    </Box>
  );
}

function LocatarSesizari() {
  const { date, adaugaSesizare, scrieMesaj } = useApp();
  const ap = apartamentulMeu(date);
  const [tab, setTab] = useState("ale mele");
  const [deschis, setDeschis] = useState(false);
  const [titlu, setTitlu] = useState("");
  const [categorie, setCategorie] = useState("instalatii");
  const [desc, setDesc] = useState("");
  const [poze, setPoze] = useState([]);
  const [raspunsuri, setRaspunsuri] = useState({});
  const [lucreaza, setLucreaza] = useState(false);

  /* [K14] "Din tot blocul" arata sesizarile deschise ale altora, ale mele
     (indiferent de stare) si sesizarile altora rezolvate in ultimele 30 de
     zile: omul trebuie sa vada si ce s-a rezolvat de curand, nu doar ce e
     inca deschis, ca sa nu scrie din nou despre acelasi lucru. */
  const vizibile = tab === "ale mele"
    ? date.sesizari.filter((s) => s.aMea)
    : date.sesizari.filter((s) => s.aMea || s.stare !== "rezolvata" || zileIntre(s.rezolvataLa, date.azi) <= 30);

  const adaugaPoza = async (f) => {
    const mica = await micsoreazaPoza(f);
    setPoze((p) => [...p, { fisier: mica, url: urlPrevizualizare(mica) }].slice(0, 3));
  };
  /* [F3] O poza pusa din greseala se scoate; [F7] URL-ul ei se elibereaza */
  const stergePoza = (p) => {
    URL.revokeObjectURL(p.url);
    setPoze((x) => x.filter((y) => y !== p));
  };
  const trimite = async () => {
    setLucreaza(true);
    const r = await adaugaSesizare({ apartamentId: ap.id, titlu: titlu.trim(), categorie, descriere: desc.trim() || titlu.trim(), poze: poze.map((p) => p.fisier) });
    setLucreaza(false);
    if (r.ok) {
      poze.forEach((p) => URL.revokeObjectURL(p.url));
      setTitlu(""); setDesc(""); setPoze([]); setDeschis(false); setTab("ale mele");
    }
  };

  return (
    <Box gap={S.lg}>
      <AntetEcran
        eyebrow={date.bloc.denumire}
        titlu="Sesizari"
        dreapta={<Btn label="Sesizare noua" size="sm" onPress={() => setDeschis(true)} />}
      />

      <Segment
        value={tab}
        onChange={setTab}
        options={[{ value: "ale mele", label: "Ale mele" }, { value: "bloc", label: "Din tot blocul" }]}
      />

      {tab === "bloc" && (
        <Txt size={12} color={C.muted}>Vezi ce s-a semnalat deja, ca sa nu scrii de doua ori despre acelasi lucru. Nu se vede cine a trimis sesizarea.</Txt>
      )}

      {vizibile.length === 0 ? (
        <Gol
          titlu={tab === "ale mele" ? "Nu ai trimis nicio sesizare" : "Nicio sesizare deschisa in bloc"}
          text="Cand ceva nu functioneaza pe scara sau in bloc, scrie aici. Administratorul vede sesizarea imediat."
          actiune={<Btn label="Scrie o sesizare" size="sm" onPress={() => setDeschis(true)} />}
        />
      ) : (
        <Box gap={S.sm}>
          {vizibile.map((s) => (
            <Card key={s.id} pad={S.md} gap={S.sm}>
              <Box row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: S.sm }}>
                <Box gap={2} flex={1}>
                  <Txt size={13.5} weight={600}>{s.titlu}</Txt>
                  <Txt size={11.5} color={C.muted}>
                    {etichetaCategorie(s.categorie)} · {dataRo(s.creataLa)}{s.aMea && tab === "bloc" ? " · a ta" : ""}
                  </Txt>
                </Box>
                <StareBadge stare={s.stare} />
              </Box>
              <Txt size={12.5} color={C.inkSoft}>{s.descriere}</Txt>
              {s.poze.length > 0 && (
                <Box row gap={S.xs}>
                  {s.poze.map((p) => <PozaStocata key={p.id} cale={p.cale} latime={52} inaltime={52} />)}
                </Box>
              )}
              {s.mesaje.map((m) => (
                <Box key={m.id} style={{ borderLeftWidth: 2, borderLeftStyle: "solid", borderLeftColor: m.dinAdministratie ? C.accent : C.lineStrong, paddingLeft: S.sm }} gap={2}>
                  <Eyebrow color={m.dinAdministratie ? C.accent : C.muted}>{m.dinAdministratie ? "Raspuns administrator" : "Mesajul tau"} · {dataRo(m.la)}</Eyebrow>
                  <Txt size={12.5} color={C.inkSoft}>{m.text}</Txt>
                </Box>
              ))}
              {s.aMea && s.stare !== "rezolvata" && (
                <Box row gap={S.sm} style={{ alignItems: "flex-end" }}>
                  <Box flex={1}>
                    <Field value={raspunsuri[s.id] || ""} onChange={(t) => setRaspunsuri({ ...raspunsuri, [s.id]: t })} placeholder="Adauga un mesaj pentru administrator" />
                  </Box>
                  <Btn
                    label="Trimite"
                    size="sm"
                    disabled={!(raspunsuri[s.id] || "").trim()}
                    onPress={async () => {
                      const r = await scrieMesaj(s.id, raspunsuri[s.id]);
                      /* Din starea de acum, ca sa ramana ce s-a scris intre timp la alta sesizare */
                      if (r.ok) setRaspunsuri((x) => ({ ...x, [s.id]: "" }));
                    }}
                  />
                </Box>
              )}
            </Card>
          ))}
        </Box>
      )}

      <Sheet open={deschis} onClose={() => setDeschis(false)} titlu="Sesizare noua" pazit={areText(titlu, desc)}>
        <Eyebrow>Alege ce s-a intamplat</Eyebrow>
        <Box row gap={S.xs} style={{ flexWrap: "wrap" }}>
          {SESIZARI_RAPIDE.map((r) => {
            const ales = titlu === r.titlu;
            return (
              <Press
                key={r.titlu}
                onPress={() => { setTitlu(r.titlu); setCategorie(r.categorie); }}
                apasat={ales}
                style={{ padding: "8px 11px", borderRadius: R.pill, border: `1px solid ${ales ? C.accent : C.lineStrong}`, backgroundColor: ales ? C.accentSoft : C.surface }}
              >
                <Txt size={12.5} weight={ales ? 700 : 500} color={ales ? C.accentInk : C.ink}>{r.titlu}</Txt>
              </Press>
            );
          })}
        </Box>
        <Field label="Sau scrie pe scurt problema" value={titlu} onChange={setTitlu} placeholder="De exemplu: nu merge becul de la etajul 2" />
        <Picker label="Categorie" value={categorie} onChange={setCategorie} options={CATEGORII_SESIZARI} />
        <Field label="Unde este si de cand (optional)" value={desc} onChange={setDesc} multiline placeholder="Etajul, locul exact, de cand se intampla" />
        {/* [P2/K10] "Din tot blocul" nu mai aduce descrierea (vederea anonima,
           sesizari_bloc, o lasa afara), doar titlul, fara numele autorului;
           daca scrii detalii care te-ar putea identifica in titlu, el ramane
           vizibil. */}
        <Txt size={11.5} color={C.muted}>Alti locatari vad titlul la Din tot blocul, dar nu vad descrierea si nici numele tau. Nu scrie in titlu date care te-ar putea identifica.</Txt>
        <Box row gap={S.sm} style={{ alignItems: "center", flexWrap: "wrap" }}>
          {poze.map((p) => (
            <Box key={p.url} gap={2} style={{ alignItems: "center" }}>
              <Imagine uri={p.url} latime={56} inaltime={56} alt="Poza sesizare" />
              <Btn label="Sterge poza" variant="quiet" size="sm" onPress={() => stergePoza(p)} />
            </Box>
          ))}
          {poze.length < 3 && <AlegeFisier label={poze.length ? "Inca o poza" : "Adauga o poza"} onAles={adaugaPoza} size="sm" />}
        </Box>
        <Btn label={lucreaza ? "Se trimite..." : "Trimite sesizarea"} full size="lg" onPress={trimite} disabled={!titlu.trim() || lucreaza} />
      </Sheet>
    </Box>
  );
}

function RezultateVot({ vot }) {
  const total = vot.optiuni.reduce((s, o) => s + o.voturi, 0);
  /* [K7] La numararea pe cota, castigatorul se decide dupa cote, nu dupa
     numarul de apartamente care au votat: bara si procentul principal
     trebuie sa fie procentul din cotele exprimate, nu din voturi. */
  const totalCote = vot.numarare === "cota" ? vot.optiuni.reduce((s, o) => s + o.cote, 0) : 0;
  return (
    <Box gap={S.md}>
      {vot.optiuni.map((o) => {
        const pct = vot.numarare === "cota"
          ? (totalCote ? Math.round((o.cote / totalCote) * 100) : 0)
          : (total ? Math.round((o.voturi / total) * 100) : 0);
        const alMeu = vot.votulMeu === o.id;
        return (
          <Box key={o.id} gap={S.xs}>
            <Box row style={{ justifyContent: "space-between", gap: S.sm }}>
              <Txt size={12.5} weight={alMeu ? 700 : 400}>{o.text}{alMeu ? " · votul tau" : ""}</Txt>
              <Txt size={12.5} weight={700} mono>{pct}%</Txt>
            </Box>
            <Bar value={pct} tone={alMeu ? C.accent : C.lineStrong} />
            <Txt size={11} color={C.muted}>{o.voturi === 1 ? "1 vot" : `${o.voturi} voturi`}{vot.numarare === "cota" ? `, ${num(o.cote)}% din cote` : ""}</Txt>
          </Box>
        );
      })}
      <Txt size={11.5} color={C.muted}>
        Au votat {vot.votanti} din {vot.totalApartamente} apartamente. Votul se numara pe apartament{vot.numarare === "cota" ? ", ponderat cu cota indiviza" : ""}.
      </Txt>
    </Box>
  );
}

function LocatarBloc({ parametri }) {
  const { date, voteaza, confirmaPrezenta, marcheazaAnunturiCitite, deschideDocument } = useApp();
  const ap = apartamentulMeu(date);
  const [tab, setTab] = useState(parametri && parametri.tab ? parametri.tab : "avizier");
  const [confirmVot, setConfirmVot] = useState(null);
  /* [P1] Vezi comentariul din LocatarAcasa: doar proprietarul poate vota. */
  const potVota = date.eu.calitate == null || date.eu.calitate === "proprietar";

  /* Anunturile afisate pe ecran se considera citite, intr-o singura comanda
     [K1]: altfel fiecare anunt necitit ar porni propria reincarcare completa. */
  useEffect(() => {
    if (tab !== "avizier") return;
    const idNecitite = date.anunturi.filter((a) => !a.citit).map((a) => a.id);
    if (idNecitite.length > 0) marcheazaAnunturiCitite(idNecitite);
  }, [tab, date.anunturi, marcheazaAnunturiCitite]);

  const reparatii = date.fonduri.find((f) => f.tip === "reparatii");
  const rulment = date.fonduri.find((f) => f.tip === "rulment");
  const deschise = date.voturi.filter((v) => new Date(v.inchideLa) > new Date());
  const inchise = date.voturi.filter((v) => new Date(v.inchideLa) <= new Date());
  const adunari = date.adunari.filter((a) => new Date(a.dataOra) > new Date()).sort((x, y) => new Date(x.dataOra) - new Date(y.dataOra));

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={date.bloc.adresa} titlu={date.bloc.denumire} />

      <Segment
        small
        value={tab}
        onChange={setTab}
        options={[
          { value: "avizier", label: "Avizier" },
          { value: "vot", label: "Vot si adunare" },
          { value: "acte", label: "Acte" },
          { value: "bani", label: "Fonduri" },
        ]}
      />

      {tab === "avizier" && (
        <Box gap={S.sm}>
          {date.anunturi.length === 0 && <Gol titlu="Avizierul este gol" text="Anunturile administratiei apar aici." />}
          {date.anunturi.map((a) => (
            <Card key={a.id} gap={S.sm} style={a.urgent ? { borderColor: C.dangerLine } : null}>
              <Box row gap={S.sm} style={{ alignItems: "center" }}>
                {a.urgent && <Badge label="Urgent" tone="danger" />}
                <Txt size={11.5} color={C.muted}>{dataLunga(a.publicatLa)} · {a.autor}</Txt>
              </Box>
              <Txt size={15} weight={700}>{a.titlu}</Txt>
              <Txt size={13} color={C.inkSoft}>{a.corp}</Txt>
            </Card>
          ))}
          <CardContacte contacte={date.contacte} />
        </Box>
      )}

      {tab === "vot" && (
        <Box gap={S.md}>
          {deschise.length === 0 && inchise.length === 0 && <Gol titlu="Niciun vot" text="Cand administratia deschide un vot, il gasesti aici." />}
          {deschise.map((vot) => (
            <Card key={vot.id} gap={S.md}>
              <Box gap={3}>
                <Box row gap={S.sm}>
                  <Badge label="Vot deschis" tone="accent" />
                  <Badge label={`Se inchide pe ${dataRo(vot.inchideLa)}`} />
                </Box>
                <Txt size={17} weight={700}>{vot.titlu}</Txt>
                <Txt size={13} color={C.inkSoft}>{vot.descriere}</Txt>
              </Box>
              <Line />
              {vot.votulMeu ? (
                <Box gap={S.md}>
                  <Txt size={12.5} color={C.ok} weight={600}>Apartamentul tau a votat. Rezultatele se actualizeaza pe masura ce voteaza si ceilalti.</Txt>
                  <RezultateVot vot={vot} />
                </Box>
              ) : potVota ? (
                <Box gap={S.sm}>
                  <Eyebrow>Alege o varianta</Eyebrow>
                  {vot.optiuni.map((o) => (
                    <Press key={o.id} onPress={() => setConfirmVot({ vot, optiune: o })} label={o.text}>
                      <Box row style={{
                        border: `1px solid ${C.lineStrong}`, borderRadius: R.md, padding: S.md,
                        alignItems: "center", gap: S.md, backgroundColor: C.surface,
                      }}>
                        <Box style={{ width: 18, height: 18, borderRadius: R.pill, border: `2px solid ${C.lineStrong}` }} />
                        <Txt size={13.5} style={{ flex: 1 }}>{o.text}</Txt>
                      </Box>
                    </Press>
                  ))}
                  <Txt size={11.5} color={C.muted}>
                    Votul se inregistreaza pe apartament, o singura data, si apare in procesul verbal al adunarii generale.
                  </Txt>
                </Box>
              ) : (
                /* [P1] Un chirias sau un membru al familiei nu poate vota
                   (Legea 196/2018): fara variantele de raspuns, ca sa nu
                   incerce o actiune pe care backend-ul o refuza oricum. */
                <Txt size={12.5} color={C.inkSoft}>
                  Doar proprietarul apartamentului poate vota (Legea 196/2018). Vezi rezultatele aici dupa ce se incheie votul.
                </Txt>
              )}
            </Card>
          ))}

          {adunari.map((a) => (
            <Card key={a.id} gap={S.sm}>
              <Titlu sub={`Convocare trimisa pe ${dataLunga(a.convocataLa)}`}>Adunarea generala din {dataLunga(a.dataOra)}</Titlu>
              <Txt size={13} color={C.inkSoft}>Ora {oraRo(a.dataOra)}, {a.loc}. Ordinea de zi: {a.ordineDeZi}</Txt>
              <Txt size={12} color={C.muted}>Au confirmat {a.prezente} din {a.totalApartamente} apartamente.</Txt>
              {a.prezentaMea ? (
                <Badge label="Ai confirmat ca participi" tone="ok" />
              ) : (
                <Btn label="Confirm ca particip" onPress={() => confirmaPrezenta(a.id, ap.id)} />
              )}
            </Card>
          ))}

          {inchise.map((vot) => (
            <Card key={vot.id} gap={S.md}>
              <Box gap={3}>
                <Badge label={`Inchis pe ${dataRo(vot.inchideLa)}`} />
                <Txt size={15} weight={700}>{vot.titlu}</Txt>
              </Box>
              <RezultateVot vot={vot} />
            </Card>
          ))}
        </Box>
      )}

      {tab === "acte" && (
        <Box gap={S.sm}>
          <Txt size={12.5} color={C.muted}>
            Documentele asociatiei, disponibile oricand pentru orice proprietar: facturile, contractele, procesele verbale.
          </Txt>
          <Card pad={0}>
            {date.documente.map((d, i) => (
              <Box key={d.id}>
                {i > 0 && <Line />}
                <Press onPress={() => deschideDocument(d.id)} label={`Deschide ${d.titlu}`}>
                  <Box row style={{ padding: S.md, alignItems: "center", gap: S.md }}>
                    <Box style={{
                      width: 34, height: 42, borderRadius: R.sm, backgroundColor: C.paperDeep,
                      border: `1px solid ${C.line}`, alignItems: "center", justifyContent: "center",
                    }}>
                      <Txt size={8} weight={700} color={C.muted}>PDF</Txt>
                    </Box>
                    <Box flex={1} gap={2}>
                      <Txt size={13} weight={600}>{d.titlu}</Txt>
                      <Txt size={11.5} color={C.muted}>{etichetaTipDocument(d.tip)} · {dataRo(d.creatLa)}</Txt>
                    </Box>
                    <Txt size={16} color={C.muted}>›</Txt>
                  </Box>
                </Press>
              </Box>
            ))}
          </Card>
        </Box>
      )}

      {tab === "bani" && (
        <Box gap={S.md}>
          <Box row gap={S.sm}>
            {reparatii && (
              <Card flex={1} pad={S.md} gap={3}>
                <Eyebrow>Fond de reparatii</Eyebrow>
                <Lei value={reparatii.sold} size={19} />
                <Txt size={11} color={C.muted}>sold la {dataRo(date.azi)}</Txt>
              </Card>
            )}
            {rulment && (
              <Card flex={1} pad={S.md} gap={3}>
                <Eyebrow>Fond de rulment</Eyebrow>
                <Lei value={rulment.sold} size={19} />
                <Txt size={11} color={C.muted}>{rulment.sumaPerApartament ? `${lei(rulment.sumaPerApartament)} pe apartament` : ""}</Txt>
              </Card>
            )}
          </Box>

          {date.fonduri.length > 0 && (
          <Card gap={S.md} pad={S.md}>
            <Explica termen="Fond de reparatii" text="Fondul de reparatii strange bani pentru lucrarile mari ale blocului: acoperis, instalatii, lift. Se aduna lunar de la toate apartamentele si se cheltuie numai pe baza de document." />
            <Explica termen="Fond de rulment" text="Fondul de rulment este suma pusa deoparte de fiecare apartament, ca asociatia sa poata plati facturile pana incaseaza intretinerea. Nu se consuma si se restituie cand se vinde apartamentul." />
          </Card>
          )}

          {date.fonduri.map((f) => (
            <Card key={f.id} gap={S.md}>
              <Titlu sub={`${f.denumire}, fiecare intrare si iesire`}>Unde s-au dus banii</Titlu>
              {f.miscari.map((m, i) => (
                <Box key={m.id} gap={S.sm}>
                  {i > 0 && <Line />}
                  <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
                    <Box gap={2} flex={1}>
                      <Txt size={13}>{m.descriere}</Txt>
                      <Txt size={11} color={C.muted}>{dataRo(m.data)}</Txt>
                      {m.documentId && <Btn label="Vezi documentul" variant="quiet" size="sm" style={{ paddingLeft: 0 }} onPress={() => deschideDocument(m.documentId)} />}
                    </Box>
                    <Lei value={m.suma} size={13} color={m.suma < 0 ? C.danger : C.ok} />
                  </Box>
                </Box>
              ))}
            </Card>
          ))}

          <Card gap={S.md}>
            <Titlu sub="La nivel de bloc, fara nume">Situatia incasarilor</Titlu>
            <Box gap={S.xs}>
              <Box row style={{ justifyContent: "space-between" }}>
                <Txt size={12.5} color={C.inkSoft}>Apartamente fara restanta</Txt>
                <Txt size={12.5} weight={700} mono>{date.situatieBloc.faraRestanta} din {date.situatieBloc.apartamente}</Txt>
              </Box>
              <Bar value={(date.situatieBloc.faraRestanta / Math.max(1, date.situatieBloc.apartamente)) * 100} />
            </Box>
            <Txt size={12.5} color={C.inkSoft}>
              Restantele blocului sunt {lei(date.situatieBloc.restanteTotal)}. Ele intarzie platile catre furnizori, iar penalizarile de la furnizori s-ar plati din fondul comun.
            </Txt>
          </Card>
        </Box>
      )}

      <Sheet open={!!confirmVot} onClose={() => setConfirmVot(null)} titlu="Confirma votul">
        {confirmVot && (
          <>
            <Txt size={14}>Votezi pentru:</Txt>
            <Card pad={S.md}><Txt size={15} weight={700}>{confirmVot.optiune.text}</Txt></Card>
            <Txt size={12.5} color={C.muted}>Votul nu se mai poate schimba dupa ce il trimiti.</Txt>
            <Btn label="Da, trimite votul" full size="lg" onPress={async () => { const r = await voteaza(confirmVot.vot.id, confirmVot.optiune.id, ap.id); if (r.ok) setConfirmVot(null); }} />
            <Btn label="Inapoi" variant="secondary" full onPress={() => setConfirmVot(null)} />
          </>
        )}
      </Sheet>
    </Box>
  );
}

/* =============================================================================
   9. ECRANE ADMINISTRATOR
============================================================================= */

function Kpi({ eticheta, valoare, sub, tone, flex = 1, onPress }) {
  const continut = (
    <Card flex={flex} pad={S.md} gap={3} style={{ alignSelf: "stretch" }}>
      <Eyebrow>{eticheta}</Eyebrow>
      <Txt size={19} weight={700} color={tone || C.ink} style={{ letterSpacing: -0.3 }}>{valoare}</Txt>
      {sub && <Txt size={11} color={C.muted}>{sub}</Txt>}
    </Card>
  );
  return onPress ? <Press onPress={onPress} label={eticheta} style={{ flex }}>{continut}</Press> : continut;
}

function AdminSumar({ go }) {
  const { date, trimiteReminder, trimiteInstiintare, toastMsg } = useApp();
  const st = statisticiAdmin(date);
  const lista = st.lista;
  const restanti = restantieri(date);
  const reparatii = date.fonduri.find((f) => f.tip === "reparatii");
  const ciorna = listaCiorna(date);

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`${date.asociatie.denumire} · ${st.totalApartamente} apartamente`} titlu="Panou administrator" />

      {lista ? (
        <Card gap={S.md}>
          <Box row gap={S.sm} style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
            <Box gap={3}>
              <Eyebrow>Lista de plata {monthLabel(lista.luna)}</Eyebrow>
              <Lei value={st.deIncasat} size={26} weight={700} />
              <Txt size={12} color={C.muted}>de incasat, termen {dataRo(lista.scadenta)}</Txt>
            </Box>
            <Badge label={`Publicata ${dataRo(lista.publicataLa)}`} tone="ok" />
          </Box>
          <Box gap={S.xs}>
            <Box row style={{ justifyContent: "space-between" }}>
              <Txt size={12.5} color={C.inkSoft}>Incasat pana acum {lei(st.incasat)}</Txt>
              <Txt size={12.5} weight={700} mono>{st.deIncasat ? Math.round((st.incasat / st.deIncasat) * 100) : 0}%</Txt>
            </Box>
            <Bar value={st.deIncasat ? (st.incasat / st.deIncasat) * 100 : 0} height={8} />
            <Txt size={11.5} color={C.muted}>Au platit integral {st.apAchitate} din {st.totalApartamente} apartamente.</Txt>
          </Box>
          <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
            <Btn label="Trimite reminder de plata" size="sm" onPress={async () => {
              const r = await trimiteReminder("plata");
              if (r.ok) toastMsg(`Reminder trimis catre ${plural(r.rezultat.destinatari, "locatar", "locatari")}, din ${plural(r.rezultat.apartamente, "apartament", "apartamente")} cu sold`);
            }} />
            <Btn label="Exporta lista PDF" size="sm" variant="secondary" onPress={() => descarcaPdf(listaPdfIntern(date, lista.id), `lista-plata-${lista.luna}-uz-intern.pdf`)} />
          </Box>
          {/* [G2/F4] Varianta de aici e cea interna (nume, restante, penalizari):
              acelasi continut ca la Facturi, deci acelasi nume de fisier "-uz-intern",
              ca sa nu se confunde cu PDF-ul de avizier la descarcare. */}
          <Txt size={11.5} color={C.muted}>PDF-ul de mai sus e de uz administrativ: contine proprietarii si restantele, nu se afiseaza la avizier.</Txt>
        </Card>
      ) : (
        <Gol titlu="Nicio lista publicata" text="Adauga facturile lunii si publica prima lista de plata." actiune={<Btn label="Mergi la facturi" size="sm" onPress={() => go("facturi")} />} />
      )}

      <Box row gap={S.sm}>
        <Kpi eticheta="Restante" valoare={lei(st.restante, false)} sub={`${st.apCuRestanta} apartamente in urma`} tone={st.restante > 0 ? C.danger : C.ink} onPress={() => go("apartamente", { filtru: "restanta" })} />
        <Kpi eticheta="Penalizari" valoare={lei(st.penalizari, false)} sub="neachitate, calculate automat" tone={st.penalizari > 0 ? C.warn : C.ink} />
      </Box>
      <Box row gap={S.sm}>
        <Kpi eticheta="Citiri de verificat" valoare={String(st.citiriDeVerificat)} sub="indexuri trimise cu poza" tone={st.citiriDeVerificat ? C.warn : C.ink} onPress={() => go("apartamente", { tab: "citiri" })} />
        <Kpi eticheta="Sesizari" valoare={String(st.sesizariDeschise)} sub="deschise" tone={st.sesizariDeschise ? C.warn : C.ink} onPress={() => go("adminsesizari")} />
      </Box>
      {reparatii && <Kpi eticheta="Fond de reparatii" valoare={lei(reparatii.sold)} sub="sold curent" onPress={() => go("apartamente", { tab: "fonduri" })} />}

      {ciorna && (
        <SarcinaRand
          eticheta={`Lista pe ${monthLabel(ciorna.luna)} este in lucru`}
          detaliu={`${plural(date.cheltuieli.filter((c) => c.listaId === ciorna.id).length, "cheltuiala adaugata", "cheltuieli adaugate")}. Locatarii o vad dupa publicare.`}
          tone="accent"
          onPress={() => go("facturi")}
        />
      )}

      {st.facturiNeachitate.length > 0 && (
        <Card gap={S.sm} style={{ borderColor: C.warnLine, backgroundColor: C.warnSoft }}>
          <Txt size={13.5} weight={700} color={C.warn}>
            {st.facturiNeachitate.length === 1 ? "O factura de platit catre furnizori" : `${st.facturiNeachitate.length} facturi de platit catre furnizori`}
          </Txt>
          {st.facturiNeachitate.map((f) => (
            <Box key={f.id} row style={{ justifyContent: "space-between", gap: S.sm }}>
              <Txt size={12.5} color={C.inkSoft}>{f.furnizor}{f.scadentaFurnizor ? `, scadent ${dataRo(f.scadentaFurnizor)}` : ""}</Txt>
              <Lei value={f.suma} size={12.5} color={C.warn} />
            </Box>
          ))}
          <Btn label="Vezi facturile" size="sm" variant="secondary" onPress={() => go("facturi")} />
        </Card>
      )}

      <Box gap={S.sm}>
        <Titlu
          sub="Cel mai vechi datornic primul"
          actiune={<Press onPress={() => go("apartamente", { filtru: "restanta" })}><Txt size={12.5} weight={700} color={C.accent}>Toate</Txt></Press>}
        >
          Restantieri
        </Titlu>
        {restanti.length === 0 ? (
          <Gol titlu="Nicio restanta" text="Toate apartamentele sunt la zi cu plata." />
        ) : (
          <Card pad={0}>
            {restanti.map((r, i) => (
              <Box key={r.ap.id}>
                {i > 0 && <Line />}
                <Box row style={{ padding: S.md, alignItems: "center", gap: S.md }}>
                  <Box style={{ width: 34, height: 34, borderRadius: R.sm, backgroundColor: C.dangerSoft, alignItems: "center", justifyContent: "center" }}>
                    <Txt size={12} weight={700} color={C.danger}>{r.ap.numar}</Txt>
                  </Box>
                  <Box flex={1} gap={2}>
                    <Txt size={13} weight={600}>{r.ap.proprietar}</Txt>
                    <Txt size={11} color={C.muted}>
                      {pluralZile(r.zile)} intarziere{r.penalizari > 0 ? `, penalizari ${lei(r.penalizari)}` : ""}
                    </Txt>
                  </Box>
                  <Box gap={4} style={{ alignItems: "flex-end" }}>
                    <Lei value={r.restanta} size={13} color={C.danger} />
                    <Btn label="Instiintare" size="sm" variant="secondary" onPress={async () => {
                      const x = await trimiteInstiintare(r.ap.id);
                      if (x.ok) toastMsg(x.rezultat.destinatari ? `Instiintare trimisa in aplicatie pentru ap. ${r.ap.numar}` : `Ap. ${r.ap.numar} nu are cont in aplicatie. Instiintarea se da pe hartie.`);
                    }} />
                  </Box>
                </Box>
              </Box>
            ))}
          </Card>
        )}
      </Box>

      <Box gap={S.sm}>
        <Titlu>Actiuni rapide</Titlu>
        <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
          <Btn label="Adauga factura" variant="secondary" size="sm" onPress={() => go("facturi")} />
          <Btn label="Inregistreaza incasare" variant="secondary" size="sm" onPress={() => go("apartamente")} />
          <Btn label="Scrie un anunt" variant="secondary" size="sm" onPress={() => go("adminbloc")} />
          <Btn label="Deschide un vot" variant="secondary" size="sm" onPress={() => go("adminbloc", { tab: "vot" })} />
        </Box>
      </Box>
    </Box>
  );
}

function AdminApartamente({ parametri }) {
  const tabInitial = parametri && (parametri.tab === "citiri" || parametri.tab === "fonduri") ? parametri.tab : "fise";
  const [tab, setTab] = useState(tabInitial);
  return (
    <Box gap={S.lg}>
      <Segment
        value={tab}
        onChange={setTab}
        options={[
          { value: "fise", label: "Apartamente" },
          { value: "citiri", label: "Citiri contoare" },
          { value: "fonduri", label: "Fonduri" },
        ]}
      />
      {tab === "fise" ? <ListaApartamente filtruInitial={parametri && parametri.filtru} />
        : tab === "citiri" ? <AdminCitiri /> : <AdminFonduri />}
    </Box>
  );
}

/* Fondurile blocului, vazute de administrator (C3/E5): acelasi vocabular ca la
   locatar (LocatarBloc, tabul Fonduri), plus inregistrarea unei iesiri, cu
   documentul obligatoriu, ca §10.4 din harta functiilor. */
function AdminFonduri() {
  const { date, inregistreazaIesireFond, deschideDocument } = useApp();
  const [ies, setIes] = useState(null);
  const [suma, setSuma] = useState("");
  const [descriere, setDescriere] = useState("");
  const [data, setData] = useState(date.azi);
  const [fisier, setFisier] = useState(null);
  const [eroare, setEroare] = useState(null);

  const deschide = (fondId) => { setIes(fondId); setSuma(""); setDescriere(""); setData(date.azi); setFisier(null); setEroare(null); };
  const inchide = () => setIes(null);
  const s = sumaDin(suma);
  const valid = s > 0 && descriere.trim() && data && fisier;

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`${date.fonduri.length} fonduri ale blocului`} titlu="Fonduri" />
      {date.fonduri.map((f) => (
        <Card key={f.id} gap={S.md}>
          <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.md }}>
            <Box gap={2}>
              <Eyebrow>{f.denumire}</Eyebrow>
              <Lei value={f.sold} size={19} weight={700} />
            </Box>
            <Btn label="Inregistreaza o iesire" size="sm" variant="secondary" onPress={() => deschide(f.id)} />
          </Box>
          {f.miscari.map((m, i) => (
            <Box key={m.id} gap={S.sm}>
              {i > 0 && <Line />}
              <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
                <Box gap={2} flex={1}>
                  <Txt size={13}>{m.descriere}</Txt>
                  <Txt size={11} color={C.muted}>{dataRo(m.data)}</Txt>
                  {m.documentId && <Btn label="Vezi documentul" variant="quiet" size="sm" style={{ paddingLeft: 0 }} onPress={() => deschideDocument(m.documentId)} />}
                </Box>
                <Lei value={m.suma} size={13} color={m.suma < 0 ? C.danger : C.ok} />
              </Box>
            </Box>
          ))}
        </Card>
      ))}

      <Sheet open={!!ies} onClose={inchide} titlu="Iesire din fond" pazit={areText(suma, descriere)}>
        <Field label="Suma iesita" value={suma} onChange={setSuma} placeholder="0,00" suffix="lei" inputMode="decimal" hint="Scrie suma ca numar pozitiv; ea se scade din fond." />
        <Field label="Pentru ce" value={descriere} onChange={setDescriere} placeholder="Reparatie acoperis, bloc scara A" />
        <Field label="Data" value={data} onChange={setData} type="date" />
        <Box row gap={S.sm} style={{ alignItems: "center" }}>
          <AlegeFisier label={fisier ? "Alt document" : "Ataseaza documentul"} accept="application/pdf,image/*" onAles={async (f2) => setFisier(await micsoreazaPoza(f2))} size="sm" />
          {fisier && <Txt size={12} color={C.ok} weight={600}>{fisier.name}</Txt>}
        </Box>
        <Eroare mesaj={eroare} />
        <Btn
          label="Inregistreaza iesirea"
          full
          size="lg"
          disabled={!valid}
          onPress={async () => {
            setEroare(null);
            const r = await inregistreazaIesireFond({ fondId: ies, suma: -s, descriere: descriere.trim(), data, fisier });
            if (r.ok) inchide(); else setEroare(r.mesaj);
          }}
        />
      </Sheet>
    </Box>
  );
}

function ListaApartamente({ filtruInitial }) {
  const { date } = useApp();
  const [cauta, setCauta] = useState("");
  const [filtru, setFiltru] = useState(filtruInitial || "toate");
  const [selectat, setSelectat] = useState(null);
  const lista = listaCurenta(date);
  const totalPers = date.apartamente.reduce((s, a) => s + a.persoane, 0);

  const cuRestanta = date.apartamente.filter((a) => restanta(date, a.id) > 0);
  const neachitate = date.apartamente.filter((a) => sold(date, a.id) > 0);
  const rezultate = date.apartamente
    .slice()
    .sort(ordineNumar)
    .filter((a) => {
      const q = cauta.trim().toLowerCase();
      const potrivire = !q || a.proprietar.toLowerCase().includes(q) || a.numar.toLowerCase() === q;
      const dupaFiltru = filtru === "toate" || (filtru === "restanta" && restanta(date, a.id) > 0) || (filtru === "neachitat" && sold(date, a.id) > 0);
      return potrivire && dupaFiltru;
    });

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`${date.apartamente.length} apartamente, ${totalPers} persoane declarate`} titlu="Apartamente" />
      <Field value={cauta} onChange={setCauta} placeholder="Cauta dupa nume sau numar" />
      <Segment
        small
        value={filtru}
        onChange={setFiltru}
        options={[
          { value: "toate", label: `Toate ${date.apartamente.length}` },
          { value: "neachitat", label: `Cu sold ${neachitate.length}` },
          { value: "restanta", label: `Restante ${cuRestanta.length}` },
        ]}
      />

      {rezultate.length === 0 ? (
        <Gol titlu="Niciun rezultat" text="Schimba filtrul sau sterge textul din cautare." />
      ) : (
        <Card pad={0}>
          {rezultate.map((a, i) => {
            const rest = restanta(date, a.id);
            const s = sold(date, a.id);
            const totalLuna = lista ? totalLista(date, lista.id, a.id) : 0;
            return (
              <Box key={a.id}>
                {i > 0 && <Line />}
                <Press onPress={() => setSelectat(a.id)} label={`Apartament ${a.numar}`}>
                  <Box row style={{ padding: S.md, alignItems: "center", gap: S.md }}>
                    <Box style={{
                      width: 36, height: 36, borderRadius: R.sm,
                      backgroundColor: rest > 0 ? C.dangerSoft : s <= 0 ? C.okSoft : C.paperDeep,
                      alignItems: "center", justifyContent: "center",
                    }}>
                      <Txt size={12.5} weight={700} color={rest > 0 ? C.danger : s <= 0 ? C.ok : C.inkSoft}>{a.numar}</Txt>
                    </Box>
                    <Box flex={1} gap={2}>
                      <Txt size={13.5} weight={600}>{a.proprietar}</Txt>
                      <Txt size={11} color={C.muted}>
                        Etaj {a.etaj === 0 ? "parter" : a.etaj} · {a.persoane} pers. · cota {num(a.cota)}%
                      </Txt>
                    </Box>
                    <Box gap={3} style={{ alignItems: "flex-end" }}>
                      <Lei value={totalLuna} size={13} />
                      {rest > 0 ? <Badge label={`Restanta ${lei(rest, false)}`} tone="danger" />
                        : s <= 0 ? <Badge label="Achitat" tone="ok" /> : <Badge label="In termen" />}
                    </Box>
                  </Box>
                </Press>
              </Box>
            );
          })}
        </Card>
      )}

      <FisaApartament apId={selectat} onClose={() => setSelectat(null)} />
    </Box>
  );
}

/* Fisa apartamentului: tot ce stie asociatia despre el, cu actiunile lui */
function FisaApartament({ apId, onClose }) {
  const {
    date, inregistreazaNumerar, trimiteInstiintare, schimbaPersoane, invitaLocatar, inchideAcces,
    schimbaFisaApartament, schimbaCoteleBlocului, toastMsg,
  } = useApp();
  const [actiune, setActiune] = useState(null);
  const [sumaIncasata, setSumaIncasata] = useState("");
  const [plataNoua, setPlataNoua] = useState(null);
  const [persoane, setPersoane] = useState("");
  const [dinLuna, setDinLuna] = useState("");
  const [motiv, setMotiv] = useState("");
  const [calitate, setCalitate] = useState("proprietar");
  const [cod, setCod] = useState(null);
  /* [C3/E4] Corectarea fisei apartamentului: proprietar, etaj, suprafata,
     scutirea de lift si o cota mica. O corectie mai mare de cota, care ar
     strica suma de 100% a blocului, se face din editorul de mai jos. */
  const [proprietarEd, setProprietarEd] = useState("");
  const [etajEd, setEtajEd] = useState("");
  const [mpEd, setMpEd] = useState("");
  const [cotaEd, setCotaEd] = useState("");
  const [scutitLiftEd, setScutitLiftEd] = useState(false);
  /* Redistribuirea cotelor intregului bloc: o cota text per apartament */
  const [coteBloc, setCoteBloc] = useState({});
  const [eroare, setEroare] = useState(null);
  /* Un dublu apasat pe "Emite chitanta" nu trebuie sa emita doua chitante */
  const incasareInCurs = React.useRef(false);
  const [incaseaza, setIncaseaza] = useState(false);

  const ap = apId ? apartamentDupaId(date, apId) : null;
  const inchide = () => {
    setActiune(null); setPlataNoua(null); setCod(null); setSumaIncasata(""); setPersoane(""); setMotiv(""); setEroare(null);
    setProprietarEd(""); setEtajEd(""); setMpEd(""); setCotaEd(""); setScutitLiftEd(false); setCoteBloc({});
    onClose();
  };
  if (!ap) return <Sheet open={false} onClose={inchide} titlu="" />;

  const lista = listaCurenta(date);
  const s = sold(date, ap.id);
  const deschise = datoriiDeschise(date, ap.id);
  const linii = lista ? liniiLista(date, lista.id, ap.id) : [];
  const apOrdine = date.apartamente.slice().sort(ordineNumar);
  const totalCote = round2(apOrdine.reduce((sm, a) => sm + (numarDin(coteBloc[a.id]) || 0), 0));
  const coteValide = apOrdine.every((a) => numarDin(coteBloc[a.id]) > 0) && Math.abs(totalCote - 100) <= 0.01;
  const fisaValida = proprietarEd.trim() && numarDin(cotaEd) > 0 && !Number.isNaN(numarDin(etajEd))
    && (mpEd === "" || numarDin(mpEd) > 0);
  const lunaCitire = lunaDe(date.azi);
  const luniViitoare = [lunaDe(date.azi), lunaUrmatoare(lunaDe(date.azi)), lunaUrmatoare(lunaUrmatoare(lunaDe(date.azi)))]
    .filter((l) => !ap.istoricPersoane.some((p) => p.valabilDin === l));
  const plata = plataNoua ? date.plati.find((p) => p.id === plataNoua) : null;
  const sumaCash = sumaDin(sumaIncasata);
  /* [G6] Singura fisa fara pazit: o atingere pe fundal sau Escape arunca la
     gunoi orice s-a scris, inclusiv editorul de cote cu cate un camp pentru
     fiecare apartament din bloc. */
  const pazitFisa = actiune === "cote-bloc"
    ? Object.values(coteBloc).some((v) => areText(v))
    : areText(sumaIncasata, persoane, motiv, proprietarEd, etajEd, mpEd, cotaEd);

  return (
    <Sheet open={!!ap} onClose={inchide} titlu={`Apartament ${ap.numar}`} pazit={pazitFisa}>
      <Card gap={S.sm}>
        <Txt size={16} weight={700}>{ap.proprietar}</Txt>
        <Box row gap={S.lg} style={{ flexWrap: "wrap" }}>
          <Box gap={2}><Eyebrow>Etaj</Eyebrow><Txt size={13}>{ap.etaj === 0 ? "Parter" : ap.etaj}</Txt></Box>
          <Box gap={2}><Eyebrow>Persoane</Eyebrow><Txt size={13}>{ap.persoane}</Txt></Box>
          <Box gap={2}><Eyebrow>Cota indiviza</Eyebrow><Txt size={13}>{num(ap.cota)}%</Txt></Box>
          <Box gap={2}><Eyebrow>Suprafata</Eyebrow><Txt size={13}>{ap.mp ? `${num(ap.mp, 1)} mp` : "-"}</Txt></Box>
          <Box gap={2}><Eyebrow>Lift</Eyebrow><Txt size={13}>{ap.scutitLift ? "Scutit" : "Plateste"}</Txt></Box>
        </Box>
      </Card>

      <Card gap={S.sm}>
        <Box row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Eyebrow>Sold la zi</Eyebrow>
          <Lei value={s} size={18} weight={700} color={restanta(date, ap.id) > 0 ? C.danger : C.ink} />
        </Box>
        {avans(date, ap.id) > 0 && (
          <Txt size={12.5} color={C.ok} weight={600}>Avans nealocat: {lei(avans(date, ap.id))}. Se scade din urmatoarea lista.</Txt>
        )}
        {deschise.length === 0 ? (
          <Txt size={12.5} color={C.ok} weight={600}>Nu are nimic de plata.</Txt>
        ) : deschise.map((d) => (
          <RandCalcul
            key={d.id}
            st={`${ETICHETE_DATORII[d.tip] || d.tip}${d.luna ? ` ${monthLabel(d.luna)}` : ""}, scadenta ${dataRo(d.scadenta)}${d.rest < d.suma ? " (rest)" : ""}`}
            dr={lei(d.rest)}
            accent={d.scadenta < date.azi}
          />
        ))}
      </Card>

      {plata && plata.chitanta ? (
        <Card gap={S.sm} style={{ backgroundColor: C.okSoft, borderColor: C.okLine }}>
          <Txt size={13.5} weight={700} color={C.ok}>Incasare inregistrata: {lei(plata.suma)}</Txt>
          <Txt size={12.5} color={C.inkSoft}>Chitanta {numarChitanta(plata.chitanta)}. Locatarul o vede si in aplicatie.</Txt>
          <Btn label="Descarca chitanta" size="sm" onPress={() => descarcaPdf(chitantaPdf(date, plata), `chitanta-${plata.chitanta.numar}.pdf`)} />
        </Card>
      ) : null}

      {actiune === "incasare" ? (
        <Card gap={S.md}>
          <Txt size={14} weight={700}>Incasare in numerar</Txt>
          {/* [F8] Nu exista nicio cale de a anula o chitanta emisa (nici in
             aplicatie, nici in registrul financiar): cel mai onest lucru pe
             care il poate face ecranul e sa spuna asta inainte de emitere,
             nu sa lase administratorul sa creada ca poate reveni. */}
          <Field label="Suma primita" value={sumaIncasata} onChange={setSumaIncasata} placeholder={lei(Math.max(0, s), false)} suffix="lei" inputMode="decimal" hint="Banii se aloca automat pe cea mai veche datorie. Chitanta se emite imediat si nu poate fi anulata din aplicatie; verifica suma inainte de a continua." />
          <Eroare mesaj={eroare} />
          <Box row gap={S.sm}>
            <Btn label={incaseaza ? "Se emite..." : "Emite chitanta"} disabled={!(sumaCash > 0) || incaseaza} onPress={async () => {
              if (incasareInCurs.current) return;
              incasareInCurs.current = true;
              setIncaseaza(true);
              setEroare(null);
              const r = await inregistreazaNumerar(ap.id, sumaCash);
              incasareInCurs.current = false;
              setIncaseaza(false);
              if (r.ok) { setPlataNoua(r.rezultat.plataId); setActiune(null); setSumaIncasata(""); } else setEroare(r.mesaj);
            }} />
            <Btn label="Renunta" variant="secondary" onPress={() => setActiune(null)} />
          </Box>
        </Card>
      ) : actiune === "persoane" ? (
        <Card gap={S.md}>
          <Txt size={14} weight={700}>Modifica numarul de persoane</Txt>
          <Txt size={12} color={C.muted}>Schimbarea se aplica de la luna aleasa. Listele deja publicate nu se schimba.</Txt>
          <Field label="Numar nou de persoane" value={persoane} onChange={setPersoane} placeholder={String(ap.persoane)} inputMode="numeric" />
          <Picker label="Incepand cu luna" value={dinLuna || (luniViitoare[0] || "")} onChange={setDinLuna} options={luniViitoare.map((l) => ({ value: l, label: monthLabel(l) }))} />
          <Field label="Motivul" value={motiv} onChange={setMotiv} placeholder="Declaratie noua, s-a mutat cineva" />
          <Box row gap={S.sm}>
            <Btn label="Salveaza" disabled={persoane === "" || Number.isNaN(Number(persoane)) || !luniViitoare.length} onPress={async () => {
              const r = await schimbaPersoane(ap.id, Number(persoane), dinLuna || luniViitoare[0], motiv.trim());
              if (r.ok) { setActiune(null); setPersoane(""); setMotiv(""); }
            }} />
            <Btn label="Renunta" variant="secondary" onPress={() => setActiune(null)} />
          </Box>
        </Card>
      ) : actiune === "invita" ? (
        <Card gap={S.md}>
          <Txt size={14} weight={700}>Invita un locatar in aplicatie</Txt>
          {cod ? (
            <>
              <Txt size={12.5} color={C.inkSoft}>Da acest cod locatarului, pe hartie sau prin SMS. Este valabil 30 de zile si se foloseste o singura data.</Txt>
              <Box style={{ backgroundColor: C.accentSoft, borderRadius: R.md, padding: S.md, alignItems: "center" }}>
                <Txt size={26} weight={700} mono color={C.accentInk} style={{ letterSpacing: 4 }}>{cod}</Txt>
              </Box>
              <Btn label="Gata" variant="secondary" onPress={() => { setActiune(null); setCod(null); }} />
            </>
          ) : (
            <>
              <Picker label="Ce este pentru apartament" value={calitate} onChange={setCalitate} options={CALITATI} />
              <Box row gap={S.sm}>
                <Btn label="Genereaza codul" onPress={async () => { const r = await invitaLocatar(ap.id, calitate); if (r.ok) setCod(r.rezultat); }} />
                <Btn label="Renunta" variant="secondary" onPress={() => setActiune(null)} />
              </Box>
            </>
          )}
        </Card>
      ) : actiune === "fisa" ? (
        <Card gap={S.md}>
          <Txt size={14} weight={700}>Corecteaza datele apartamentului</Txt>
          <Field label="Proprietar" value={proprietarEd} onChange={setProprietarEd} placeholder="Numele proprietarului" />
          <Box row gap={S.sm}>
            <Box flex={1}><Field label="Etaj" value={etajEd} onChange={setEtajEd} placeholder="0 pentru parter" inputMode="numeric" /></Box>
            <Box flex={1}><Field label="Suprafata" value={mpEd} onChange={setMpEd} placeholder="0,0" suffix="mp" inputMode="decimal" /></Box>
          </Box>
          <Field
            label="Cota indiviza"
            value={cotaEd}
            onChange={setCotaEd}
            placeholder="0,00"
            suffix="%"
            inputMode="decimal"
            hint="O corectie mica se salveaza direct, cat timp suma cotelor blocului ramane 100%."
          />
          <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.md }}>
            <Txt size={13} weight={600}>Scutit de plata liftului</Txt>
            <Switch value={scutitLiftEd} onChange={setScutitLiftEd} label="Scutit de plata liftului" />
          </Box>
          <Eroare mesaj={eroare} />
          <Box row gap={S.sm}>
            <Btn label="Salveaza corectia" disabled={!fisaValida} onPress={async () => {
              setEroare(null);
              const r = await schimbaFisaApartament(ap.id, {
                proprietar: proprietarEd.trim(), cota: numarDin(cotaEd), mp: mpEd === "" ? null : numarDin(mpEd),
                scutitLift: scutitLiftEd, etaj: numarDin(etajEd),
              });
              if (r.ok) setActiune(null); else setEroare(r.mesaj);
            }} />
            <Btn label="Renunta" variant="secondary" onPress={() => setActiune(null)} />
          </Box>
          <Btn
            label="Redistribuie cotele intregului bloc"
            variant="quiet"
            full
            onPress={() => {
              setCoteBloc(Object.fromEntries(apOrdine.map((a) => [a.id, numCotaEd(a.cota)])));
              setActiune("cote-bloc");
            }}
          />
        </Card>
      ) : actiune === "cote-bloc" ? (
        <Card gap={S.md}>
          <Txt size={14} weight={700}>Redistribuie cotele blocului</Txt>
          <Txt size={12.5} color={C.muted}>
            Cotele tuturor apartamentelor trebuie sa insumeze 100%. Corecteaza cate apartamente e nevoie, apoi salveaza o singura data.
          </Txt>
          {apOrdine.map((a) => (
            <Field
              key={a.id}
              label={`Ap. ${a.numar}, ${a.proprietar}`}
              value={coteBloc[a.id]}
              onChange={(t) => setCoteBloc({ ...coteBloc, [a.id]: t })}
              suffix="%"
              inputMode="decimal"
            />
          ))}
          <Box row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <Txt size={13} weight={700}>Total</Txt>
            <Txt size={14} weight={700} color={Math.abs(totalCote - 100) <= 0.01 ? C.ok : C.danger}>{num(totalCote)}% din 100%</Txt>
          </Box>
          <Eroare mesaj={eroare} />
          <Box row gap={S.sm}>
            <Btn label="Salveaza cotele blocului" disabled={!coteValide} onPress={async () => {
              setEroare(null);
              const r = await schimbaCoteleBlocului(apOrdine.map((a) => ({ apartamentId: a.id, cota: numarDin(coteBloc[a.id]) })));
              if (r.ok) setActiune(null); else setEroare(r.mesaj);
            }} />
            <Btn label="Renunta" variant="secondary" onPress={() => setActiune(null)} />
          </Box>
        </Card>
      ) : (
        <Box gap={S.sm}>
          <Btn label="Inregistreaza incasare cash" full onPress={() => { setSumaIncasata(s > 0 ? lei(s, false) : ""); setActiune("incasare"); }} />
          <Btn label="Trimite instiintare de plata" variant="secondary" full disabled={restanta(date, ap.id) <= 0} onPress={async () => {
            const r = await trimiteInstiintare(ap.id);
            if (r.ok) toastMsg(r.rezultat.destinatari ? "Instiintarea a fost trimisa in aplicatie" : "Apartamentul nu are cont in aplicatie. Instiintarea se da pe hartie.");
          }} />
          <Btn label="Modifica numarul de persoane" variant="secondary" full onPress={() => { setDinLuna(luniViitoare[0] || ""); setActiune("persoane"); }} />
          <Btn label="Invita un locatar in aplicatie" variant="secondary" full onPress={() => setActiune("invita")} />
          <Btn
            label="Corecteaza datele apartamentului"
            variant="secondary"
            full
            onPress={() => {
              setProprietarEd(ap.proprietar); setEtajEd(String(ap.etaj)); setMpEd(ap.mp != null ? num(ap.mp, 1) : "");
              setCotaEd(numCotaEd(ap.cota)); setScutitLiftEd(ap.scutitLift); setActiune("fisa");
            }}
          />
        </Box>
      )}

      {lista && (
        <Card pad={0}>
          <Box style={{ padding: S.md }} gap={2}>
            <Eyebrow>Defalcarea intretinerii, {monthLabel(lista.luna)}</Eyebrow>
            <Txt size={11.5} color={C.muted}>Exact ce vede locatarul. Apasa pe un rand pentru calcul.</Txt>
          </Box>
          <Line />
          <Box style={{ paddingLeft: S.md, paddingRight: S.md }}>
            {linii.map((l, i) => (
              <Box key={l.id}>
                {i > 0 && <Line />}
                <RandLista linie={l} />
              </Box>
            ))}
          </Box>
          <Line />
          <Box row style={{ padding: S.md, justifyContent: "space-between" }}>
            <Txt size={13} weight={700}>Total {monthName(lista.luna)}</Txt>
            <Lei value={suma(linii, (l) => l.suma)} size={14} weight={700} />
          </Box>
        </Card>
      )}

      <Card gap={S.sm} pad={S.md}>
        <Eyebrow>Consum apa</Eyebrow>
        {istoricConsum(date, ap.id).slice(-3).reverse().map((x) => (
          <RandCalcul key={x.luna} st={`${monthLabel(x.luna)}${x.estimat ? " (estimat)" : ""}`} dr={`rece ${x.rece == null ? "-" : num(x.rece)} · calda ${x.calda == null ? "-" : num(x.calda)} mc`} />
        ))}
        {date.contoare.filter((c) => c.apartamentId === ap.id).map((c) => {
          const x = citireLuna(date, c.id, lunaCitire);
          return <RandCalcul key={c.id} st={`${c.tip === "rece" ? "Apa rece" : "Apa calda"}, ${monthLabel(lunaCitire)}`} dr={x ? `${num(x.indexCurent, 1)} (${x.stare})` : "netransmis"} />;
        })}
      </Card>

      <Card gap={S.sm} pad={S.md}>
        <Eyebrow>Istoricul persoanelor</Eyebrow>
        {ap.istoricPersoane.map((p) => (
          <RandCalcul key={p.valabilDin} st={`Din ${monthLabel(p.valabilDin)}${p.motiv ? `, ${p.motiv.toLowerCase()}` : ""}`} dr={`${p.numar} pers.`} />
        ))}
      </Card>

      <Card gap={S.sm} pad={S.md}>
        <Eyebrow>Locatari cu cont in aplicatie</Eyebrow>
        {ap.locatari.filter((l) => !l.activPana).length === 0 && <Txt size={12.5} color={C.muted}>Nimeni din apartament nu are inca cont.</Txt>}
        {ap.locatari.filter((l) => !l.activPana).map((l) => (
          <Box key={l.id} row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
            <Box flex={1} gap={1}>
              <Txt size={13} weight={600}>{l.nume}</Txt>
              <Txt size={11.5} color={C.muted}>{etichetaCalitate(l.calitate)} · din {dataRo(l.activDin)}{l.telefon ? ` · ${l.telefon}` : ""}</Txt>
            </Box>
            <Btn label="Inchide accesul" size="sm" variant="danger" onPress={async () => {
              if (await confirma(`Inchizi accesul lui ${l.nume} la apartamentul ${ap.numar}? Istoricul ramane.`)) await inchideAcces(l.id);
            }} />
          </Box>
        ))}
        {ap.invitatii.map((inv) => (
          <Txt key={inv.id} size={11.5} color={C.muted}>Cod nefolosit {inv.cod} ({etichetaCalitate(inv.calitate).toLowerCase()}), expira pe {dataRo(inv.expiraLa)}</Txt>
        ))}
        {ap.locatari.filter((l) => l.activPana).map((l) => (
          <Txt key={l.id} size={11.5} color={C.muted}>{l.nume}, acces inchis pe {dataRo(l.activPana)}</Txt>
        ))}
      </Card>
    </Sheet>
  );
}

function AdminCitiri() {
  const { date, valideazaCitire, valideazaCitiriApartament, citesteContorGeneral, estimeazaCitiri, toastMsg } = useApp();
  const luniCuCitiri = [...new Set([lunaDe(date.azi), ...date.citiri.filter((c) => c.sursa !== "pornire").map((c) => c.luna)])].sort().reverse();
  const [luna, setLuna] = useState(luniCuCitiri[0]);
  const [respinge, setRespinge] = useState(null);
  const [motiv, setMotiv] = useState("");
  /* [F6] Indexul se tine pe id-ul contorului: doua coloane de apa rece nu se calca */
  const [general, setGeneral] = useState({});

  const contoareGen = date.contoare.filter((c) => !c.apartamentId);
  const apartamente = date.apartamente.slice().sort(ordineNumar);
  const rand = (ap) => date.contoare.filter((c) => c.apartamentId === ap.id).map((c) => ({ contor: c, citire: citireLuna(date, c.id, luna) }));
  const toate = apartamente.map((ap) => ({ ap, contoare: rand(ap) }));
  const transmise = toate.filter((x) => x.contoare.every((c) => c.citire && c.citire.stare !== "respinsa")).length;
  const deVerificat = toate.filter((x) => x.contoare.some((c) => c.citire && c.citire.stare === "trimisa"));
  const termen = `${luna}-${pad2(date.setari.ziLimitaCitire)}`;
  const lunaPublicata = date.liste.some((l) => l.luna === luna && l.stare === "publicata");
  /* [K2] Citirile validate care se mai pot respinge: ale apartamentului, nu
     pornirea, si doar cat timp lista lunii nu este publicata */
  const validateDeRespins = (x) => (lunaPublicata ? [] : x.contoare.filter((c) => c.citire && c.citire.stare === "validata" && c.citire.sursa !== "pornire"));

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`Termen de citire ${dataLunga(termen)}`} titlu="Citiri contoare" />
      <Picker label="Luna" value={luna} onChange={setLuna} options={luniCuCitiri.map((l) => ({ value: l, label: monthLabel(l) }))} />

      <Box row gap={S.sm}>
        <Kpi eticheta="Transmise" valoare={`${transmise} din ${apartamente.length}`} sub="apartamente" />
        <Kpi eticheta="De verificat" valoare={String(deVerificat.length)} sub="cu poza atasata" tone={deVerificat.length ? C.warn : C.ink} />
      </Box>

      <Card gap={S.md}>
        <Titlu sub="Contorul de la subsol, citit de administrator">Contorul general al blocului</Titlu>
        {contoareGen.map((c) => {
          const x = citireLuna(date, c.id, luna);
          const anterior = ultimIndexValabil(date, c.id, luna);
          const v = general[c.id] || "";
          const n = numarDin(v);
          return (
            <Box key={c.id} gap={S.xs}>
              <RandCalcul st={`${c.tip === "rece" ? "Apa rece" : "Apa calda"}, index anterior ${num(anterior, 1)}`} dr={x ? `${num(x.indexCurent, 1)}, consum ${num(x.consum)} mc` : "necitit"} />
              <Box row gap={S.sm} style={{ alignItems: "flex-end" }}>
                <Box flex={1}>
                  <Field value={v} onChange={(t) => setGeneral({ ...general, [c.id]: t })} placeholder={x ? "Corecteaza indexul" : "Index nou"} inputMode="decimal"
                    hint={v !== "" && !Number.isNaN(n) && n >= anterior ? `Consum ${num(n - anterior)} mc` : null}
                    eroare={v !== "" && (Number.isNaN(n) || n < anterior) ? "Indexul nu poate fi mai mic decat cel anterior." : null} />
                </Box>
                <Btn label="Salveaza" size="sm" disabled={v === "" || Number.isNaN(n) || n < anterior} onPress={async () => {
                  const r = await citesteContorGeneral(luna, c.tip, n);
                  /* Din starea de acum, nu din cea de la apasare: altfel se
                     pierde ce s-a scris la celalalt contor in timpul salvarii */
                  if (r.ok) setGeneral((g) => ({ ...g, [c.id]: "" }));
                }} />
              </Box>
            </Box>
          );
        })}
      </Card>

      {transmise < apartamente.length && (
        <Card gap={S.sm} pad={S.md} style={{ backgroundColor: C.warnSoft, borderColor: C.warnLine }}>
          <Txt size={13} weight={700} color={C.warn}>{apartamente.length - transmise} apartamente nu au transmis indexul</Txt>
          <Txt size={12} color={C.inkSoft}>Dupa termen, le poti completa cu consumul estimat pe media ultimelor trei luni. Estimarea apare ca atare pe lista locatarului.</Txt>
          <Btn label="Estimeaza citirile lipsa" size="sm" variant="secondary" onPress={async () => {
            if (!await confirma("Completezi cu estimare toate citirile netransmise pe aceasta luna?")) return;
            const r = await estimeazaCitiri(luna);
            if (r.ok) toastMsg(`Au fost estimate ${r.rezultat.estimate} citiri`);
          }} />
        </Card>
      )}

      <Card pad={0}>
        {toate.map((x, i) => (
          <Box key={x.ap.id}>
            {i > 0 && <Line />}
            <Box style={{ padding: S.md }} gap={S.sm}>
              <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
                <Txt size={13.5} weight={700}>Ap. {x.ap.numar} · {x.ap.proprietar}</Txt>
              </Box>
              {x.contoare.map(({ contor, citire }) => (
                <Box key={contor.id} row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
                  <Box flex={1} gap={2}>
                    <Txt size={12} color={C.inkSoft}>{contor.tip === "rece" ? "Rece" : "Calda"}{citire ? `: ${num(citire.indexAnterior, 1)} → ${num(citire.indexCurent, 1)}, ${num(citire.consum)} mc` : ""}</Txt>
                    {citire && citire.motivRespingere && citire.stare === "respinsa" && <Txt size={11} color={C.danger}>{citire.motivRespingere}</Txt>}
                  </Box>
                  <StareCitireBadge citire={citire} />
                </Box>
              ))}
              {x.contoare.some((c) => c.citire && c.citire.pozaCale) && (
                <Box row gap={S.xs}>
                  {[...new Set(x.contoare.filter((c) => c.citire && c.citire.pozaCale).map((c) => c.citire.pozaCale))].map((cale) => <PozaStocata key={cale} cale={cale} latime={72} inaltime={72} />)}
                </Box>
              )}
              {x.contoare.some((c) => c.citire && c.citire.stare === "trimisa") && (
                <Box row gap={S.sm}>
                  <Btn label="Valideaza" size="sm" onPress={async () => { await valideazaCitiriApartament(x.ap.id, luna, true, null); }} />
                  <Btn label="Respinge" size="sm" variant="danger" onPress={() => { setRespinge(x); setMotiv(""); }} />
                </Box>
              )}
              {!x.contoare.some((c) => c.citire && c.citire.stare === "trimisa") && validateDeRespins(x).length > 0 && (
                <Btn label="Respinge citirea validata" size="sm" variant="secondary" onPress={() => { setRespinge({ ...x, validate: validateDeRespins(x) }); setMotiv(""); }} />
              )}
            </Box>
          </Box>
        ))}
      </Card>

      <Sheet open={!!respinge} onClose={() => setRespinge(null)} titlu={respinge ? `Respinge citirea, ap. ${respinge.ap.numar}` : ""} pazit={areText(motiv)}>
        {respinge && respinge.validate && (
          <Txt size={12.5} color={C.inkSoft}>Citirea a fost deja validata. Daca indexul este gresit, respinge-o: lista lunii nu s-a publicat inca, deci se mai poate corecta.</Txt>
        )}
        <Txt size={12.5} color={C.inkSoft}>Locatarul primeste motivul in aplicatie si poate trimite din nou indexul cu o poza noua.</Txt>
        <Box row gap={S.xs} style={{ flexWrap: "wrap" }}>
          {["Poza este neclara, nu se vad cifrele.", "Indexul nu corespunde cu poza.", "Poza nu arata contorul apartamentului."].map((m) => (
            <Press key={m} onPress={() => setMotiv(m)} apasat={motiv === m} style={{ padding: "7px 10px", borderRadius: R.pill, border: `1px solid ${motiv === m ? C.accent : C.lineStrong}`, backgroundColor: motiv === m ? C.accentSoft : C.surface }}>
              <Txt size={12}>{m}</Txt>
            </Press>
          ))}
        </Box>
        <Field label="Motivul" value={motiv} onChange={setMotiv} multiline placeholder="Ce trebuie sa corecteze locatarul" />
        <Btn label="Respinge citirea" variant="danger" full disabled={!motiv.trim()} onPress={async () => {
          if (respinge.validate) {
            /* Citire cu citire: o respingere refuzata la jumatate lasa o
               stare valida (una respinsa, una validata), care se reia */
            for (const { citire } of respinge.validate) {
              const r = await valideazaCitire(citire.id, false, motiv.trim());
              if (!r.ok) return;
            }
            setRespinge(null);
            return;
          }
          const r = await valideazaCitiriApartament(respinge.ap.id, luna, false, motiv.trim());
          if (r.ok) setRespinge(null);
        }} />
      </Sheet>
    </Box>
  );
}

/* Formularul de factura, cu previzualizarea pe toate apartamentele */
function SheetFactura({ open, onClose, lista, cheltuiala }) {
  const { date, salveazaCheltuiala, dateMotor } = useApp();
  const furnizori = date.furnizori;
  const [furnizorId, setFurnizorId] = useState("");
  const [furnizorNou, setFurnizorNou] = useState("");
  const [categorie, setCategorie] = useState("");
  const [cod, setCod] = useState("");
  const [sumaText, setSumaText] = useState("");
  const [metoda, setMetoda] = useState("persoane");
  const [tipApa, setTipApa] = useState("rece");
  const [serie, setSerie] = useState("");
  const [emisa, setEmisa] = useState("");
  const [scadenta, setScadenta] = useState("");
  const [fisier, setFisier] = useState(null);
  const [dm, setDm] = useState(null);
  const [lucreaza, setLucreaza] = useState(false);

  /* [F4] Efectul depinde de identitatea listei, nu de obiectul ei: altfel orice
     reincarcare a datelor ar goli formularul deschis. */
  const listaId = lista ? lista.id : null;
  useEffect(() => {
    if (!open || !listaId) return undefined;
    if (cheltuiala) {
      setFurnizorId(cheltuiala.furnizorId || "");
      setCategorie(cheltuiala.categorie);
      setCod(cheltuiala.cod);
      setSumaText(lei(cheltuiala.suma, false));
      setMetoda(cheltuiala.metoda);
      setTipApa(cheltuiala.tipApa || "rece");
      setSerie(cheltuiala.serie || "");
      setEmisa(cheltuiala.emisa || "");
      setScadenta(cheltuiala.scadentaFurnizor || "");
    } else {
      setFurnizorId(""); setFurnizorNou(""); setCategorie(""); setCod(""); setSumaText(""); setMetoda("persoane");
      setTipApa("rece"); setSerie(""); setEmisa(""); setScadenta("");
    }
    setFisier(null);
    /* Un raspuns care vine dupa inchiderea panoului nu mai are ce sa schimbe */
    let viu = true;
    dateMotor(listaId).then((r) => { if (viu) setDm(r.ok ? r.rezultat : null); });
    return () => { viu = false; };
  }, [open, listaId, cheltuiala, dateMotor]);

  const alegeFurnizor = (id) => {
    setFurnizorId(id);
    const f = furnizori.find((x) => x.id === id);
    if (f) {
      setCategorie(f.categorie || "");
      setMetoda(f.metoda || "persoane");
      setTipApa(f.tipApa || "rece");
      setCod(f.cod || "");
    }
  };

  const codLiber = () => {
    const folosite = date.cheltuieli.filter((c) => lista && c.listaId === lista.id).map((c) => Number(c.cod.slice(1)));
    let n = 10;
    while (folosite.includes(n)) n += 1;
    return `C${n}`;
  };
  const s = sumaDin(sumaText);
  const codFinal = cod || codLiber();
  const dublura = lista && date.cheltuieli.some((c) => c.listaId === lista.id && c.cod === codFinal && (!cheltuiala || c.id !== cheltuiala.id));

  const previzualizare = useMemo(() => {
    if (!dm || !(s > 0)) return null;
    const intrare = { ...dm, cheltuieli: [{ id: "nou", cod: codFinal, suma: s, metoda, tipApa: metoda === "consum" ? tipApa : null }] };
    const probleme = verificaDate(intrare);
    if (probleme.length) return { probleme };
    const rez = calculeazaLista(intrare);
    return { randuri: rez.repartizari, totaluri: rez.totaluri, total: rez.totalRepartizat };
  }, [dm, s, codFinal, metoda, tipApa]);

  const valid = s > 0 && categorie.trim() && (furnizorId || furnizorNou.trim()) && !dublura && (metoda !== "consum" || tipApa);
  const salveaza = async () => {
    setLucreaza(true);
    const r = await salveazaCheltuiala({
      id: cheltuiala ? cheltuiala.id : null, listaId: lista.id, furnizorId: furnizorId || null, furnizorNou: furnizorId ? null : furnizorNou.trim(),
      categorie: categorie.trim(), cod: codFinal, suma: s, metoda, tipApa: metoda === "consum" ? tipApa : null,
      serie: serie.trim(), emisa: emisa || null, scadentaFurnizor: scadenta || null, fisier,
    });
    setLucreaza(false);
    if (r.ok) onClose();
  };

  const numarAp = (id) => (date.apartamente.find((a) => a.id === id) || {}).numar;

  return (
    <Sheet open={open} onClose={onClose} titlu={cheltuiala ? "Modifica factura" : "Factura noua"} pazit={areText(categorie, sumaText, furnizorNou, serie)}>
      <Picker
        label="Furnizor"
        value={furnizorId}
        onChange={alegeFurnizor}
        options={[{ value: "", label: "Alege furnizorul..." }, ...furnizori.map((f) => ({ value: f.id, label: f.denumire }))]}
      />
      {!furnizorId && <Field label="Sau scrie un furnizor nou" value={furnizorNou} onChange={setFurnizorNou} placeholder="Numele firmei" />}
      <Field label="Ce cheltuiala este" value={categorie} onChange={setCategorie} placeholder="Apa rece, salubritate, lift" />
      <Box row gap={S.sm}>
        <Box flex={2}><Field label="Suma facturii" value={sumaText} onChange={setSumaText} placeholder="0,00" suffix="lei" inputMode="decimal" /></Box>
        <Box flex={1}><Field label="Cod pe lista" value={cod} onChange={setCod} placeholder={codLiber()} eroare={dublura ? "Codul exista deja" : null} /></Box>
      </Box>
      <Picker
        label="Cum se imparte"
        value={metoda}
        onChange={setMetoda}
        options={Object.entries(METODE).map(([k, v]) => ({ value: k, label: v.eticheta }))}
      />
      {metoda === "consum" && (
        <Segment value={tipApa} onChange={setTipApa} options={[{ value: "rece", label: "Apa rece" }, { value: "calda", label: "Apa calda" }]} />
      )}
      <Card pad={S.md} gap={S.xs} style={{ backgroundColor: C.paperDeep, borderColor: C.lineStrong }}>
        <Txt size={12} color={C.inkSoft}>{METODE[metoda].explic}</Txt>
      </Card>
      <Field label="Serie si numar factura" value={serie} onChange={setSerie} placeholder="ACA-448120" />
      <Box row gap={S.sm}>
        <Box flex={1}><Field label="Emisa pe" value={emisa} onChange={setEmisa} type="date" /></Box>
        <Box flex={1}><Field label="Scadenta furnizor" value={scadenta} onChange={setScadenta} type="date" /></Box>
      </Box>
      <Box row gap={S.sm} style={{ alignItems: "center" }}>
        <AlegeFisier label={fisier ? "Alt fisier" : "Ataseaza factura scanata"} accept="image/*,application/pdf" onAles={async (f) => setFisier(await micsoreazaPoza(f))} size="sm" />
        {fisier && <Txt size={12} color={C.ok} weight={600}>{fisier.name}</Txt>}
      </Box>

      {previzualizare && (
        <Card pad={S.md} gap={S.sm}>
          <Eyebrow>Cum cade suma pe apartamente</Eyebrow>
          {previzualizare.probleme ? (
            previzualizare.probleme.map((p) => <Txt key={p} size={12} color={C.warn} weight={600}>{p}</Txt>)
          ) : (
            <>
              {previzualizare.randuri.map((r) => (
                <RandCalcul
                  key={r.apartamentId}
                  st={`Ap. ${numarAp(r.apartamentId)}, ${metoda === "persoane_fara_lift" && r.baza.valoare === 0 ? "scutit de lift" : etichetaBaza(r.baza.valoare, r.baza.unitate)}${r.rotunjire ? " + rotunjire" : ""}`}
                  dr={lei(r.suma)}
                />
              ))}
              <Line />
              <RandCalcul st="Total impartit" dr={lei(previzualizare.total)} bold />
            </>
          )}
          <Txt size={11} color={C.muted}>Nimic nu se salveaza si locatarii nu vad nimic pana la publicarea listei.</Txt>
        </Card>
      )}

      <Btn label={lucreaza ? "Se salveaza..." : "Salveaza factura"} full size="lg" disabled={!valid || lucreaza} onPress={salveaza} />
    </Sheet>
  );
}

function AdminFacturi() {
  const { date, deschideLista, stergeCheltuiala, publicaLista, marcheazaFacturaPlatita, dateMotor, deschideDocument } = useApp();
  const [listaId, setListaId] = useState(() => (listaCiorna(date) || listaCurenta(date) || {}).id || null);
  const [factura, setFactura] = useState(null);
  const [previz, setPreviz] = useState(null);
  const [confirmPublica, setConfirmPublica] = useState(false);
  const [eroare, setEroare] = useState(null);
  const [lucreaza, setLucreaza] = useState(false);

  /* [L10] Previzualizarea ramanea veche dupa ce o factura se adauga, se
     modifica sau se sterge: totalul repartizat aratat langa totalul
     facturilor nu se mai potriveste. Orice comanda care schimba
     cheltuielile reincarca datele si schimba referinta date.cheltuieli;
     previzualizarea se sterge atunci, ca omul sa apese din nou "Calculeaza
     lista pe apartamente" pe datele proaspete. */
  useEffect(() => { setPreviz(null); }, [date.cheltuieli]);

  const lista = listaId ? listaDupaId(date, listaId) : null;
  const ultima = date.liste[0];
  const lunaNoua = ultima ? lunaUrmatoare(ultima.luna) : lunaDe(date.azi);
  const cheltuieli = lista ? date.cheltuieli.filter((c) => c.listaId === lista.id).sort(ordineCod) : [];
  const totalFacturi = suma(cheltuieli, (c) => c.suma);
  const esteCiorna = lista && lista.stare === "ciorna";

  const calculeazaPreviz = async () => {
    const r = await dateMotor(lista.id);
    if (!r.ok) return;
    const intrare = { ...r.rezultat, cheltuieli: cheltuieli.map((c) => ({ id: c.id, cod: c.cod, suma: c.suma, metoda: c.metoda, tipApa: c.tipApa })) };
    const probleme = verificaDate(intrare);
    if (probleme.length) { setPreviz({ probleme }); return; }
    const rez = calculeazaLista(intrare);
    const perAp = {};
    rez.repartizari.forEach((x) => { perAp[x.apartamentId] = round2((perAp[x.apartamentId] || 0) + x.suma); });
    setPreviz({ perAp, total: rez.totalRepartizat });
  };

  const citiriValidate = lista ? date.apartamente.filter((a) => date.contoare.filter((c) => c.apartamentId === a.id).every((c) => {
    const x = citireLuna(date, c.id, lista.luna);
    return x && x.stare === "validata";
  })).length : 0;
  const generalCitit = lista ? date.contoare.filter((c) => !c.apartamentId).every((c) => { const x = citireLuna(date, c.id, lista.luna); return x && x.stare === "validata"; }) : false;
  const areApa = cheltuieli.some((c) => c.metoda === "consum");
  /* [K6] Citirile trimise ale lunii opresc publicarea, cu sau fara apa pe lista */
  const deVerificat = lista ? date.citiri.filter((c) => c.luna === lista.luna && c.stare === "trimisa").length : 0;

  return (
    <Box gap={S.lg}>
      <AntetEcran
        eyebrow={lista ? `${monthLabel(lista.luna)} · ${lista.stare === "ciorna" ? "in lucru" : "publicata"}` : "Facturi"}
        titlu="Facturi si liste"
        dreapta={esteCiorna ? <Btn label="Adauga factura" size="sm" onPress={() => setFactura({})} /> : null}
      />

      {date.liste.length > 0 && <AlegeLuna liste={date.liste} value={listaId} onChange={(id) => { setListaId(id); setPreviz(null); }} />}

      {!listaCiorna(date) && (
        <Card gap={S.sm} pad={S.md}>
          <Txt size={13} weight={700}>Lista pe {monthLabel(lunaNoua)} nu este inceputa</Txt>
          <Txt size={12} color={C.muted}>Lista noua porneste cu fondul de reparatii deja completat. Adaugi facturile pe masura ce vin.</Txt>
          <Btn label={`Incepe lista pe ${monthLabel(lunaNoua)}`} size="sm" onPress={async () => { const r = await deschideLista(lunaNoua); if (r.ok) setListaId(r.rezultat); }} />
        </Card>
      )}

      {lista && (
        <>
          {esteCiorna ? (
            <Card gap={S.sm} style={{ backgroundColor: C.infoSoft, borderColor: C.infoSoft }}>
              <Txt size={13} weight={700} color={C.info}>Lista in lucru, locatarii nu o vad inca</Txt>
              <Txt size={12} color={C.info}>
                Adauga facturile lunii, verifica previzualizarea si publica. Dupa publicare, sumele nu se mai schimba; o corectura se face doar printr-o recalculare, vizibila pentru locatari.
              </Txt>
              {deVerificat > 0 && (
                <Txt size={12} color={C.warn} weight={600}>
                  {deVerificat === 1
                    ? "Mai este o citire de verificat. Lista se publica dupa ce o validezi sau o respingi, din Apartamente, la Citiri contoare."
                    : `Mai sunt ${plural(deVerificat, "citire", "citiri")} de verificat. Lista se publica dupa ce le validezi sau le respingi, din Apartamente, la Citiri contoare.`}
                </Txt>
              )}
              {areApa && (
                <Txt size={12} color={generalCitit && citiriValidate === date.apartamente.length ? C.ok : C.warn} weight={600}>
                  Citiri validate: {citiriValidate} din {date.apartamente.length} apartamente. Contorul general: {generalCitit ? "citit" : "necitit"}.
                </Txt>
              )}
            </Card>
          ) : (
            <Card gap={S.sm} style={{ backgroundColor: C.accentSoft, borderColor: C.accentLine }}>
              <RandCalcul st="Total facturi si fonduri" dr={lei(totalFacturi)} />
              <RandCalcul st={`Total repartizat pe ${lista.apartamente} apartamente`} dr={lei(lista.totalRepartizat)} />
              <Line style={{ backgroundColor: C.accentLine }} />
              <RandCalcul st="Nealocat" dr={lei(totalFacturi - lista.totalRepartizat)} bold />
              <Txt size={11.5} color={C.accentInk}>Publicata pe {dataLunga(lista.publicataLa)}, termen de plata {dataLunga(lista.scadenta)}.</Txt>
            </Card>
          )}

          {cheltuieli.length === 0 ? (
            <Gol titlu="Nicio cheltuiala" text="Adauga prima factura a lunii." actiune={esteCiorna ? <Btn label="Adauga factura" size="sm" onPress={() => setFactura({})} /> : null} />
          ) : (
            <Card pad={0}>
              {cheltuieli.map((c, i) => (
                <Box key={c.id}>
                  {i > 0 && <Line />}
                  <Box style={{ padding: S.md }} gap={S.sm}>
                    <Box row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: S.sm }}>
                      <Box gap={3} flex={1}>
                        <Box row gap={S.sm} style={{ alignItems: "center" }}>
                          <Txt size={10} weight={700} mono color={C.muted}>{c.cod}</Txt>
                          <Txt size={13.5} weight={600}>{c.categorie}</Txt>
                        </Box>
                        <Txt size={11.5} color={C.muted}>{c.furnizor}{c.serie ? ` · ${c.serie}` : ""}</Txt>
                      </Box>
                      <Lei value={c.suma} size={14} />
                    </Box>
                    <Box row gap={S.sm} style={{ alignItems: "center", flexWrap: "wrap" }}>
                      <Badge label={METODE[c.metoda].eticheta + (c.tipApa ? `, apa ${c.tipApa}` : "")} tone="accent" />
                      {c.tip !== "factura" ? (
                        <Badge label="Fond" tone="info" />
                      ) : c.achitataLa ? (
                        <Badge label={`Platita furnizorului ${dataRo(c.achitataLa)}`} tone="ok" />
                      ) : (
                        <Badge label={c.scadentaFurnizor ? `De platit pana ${dataRo(c.scadentaFurnizor)}` : "Neplatita furnizorului"} tone="warn" />
                      )}
                    </Box>
                    <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
                      {c.documentId && <Btn label="Vezi factura" size="sm" variant="secondary" onPress={() => deschideDocument(c.documentId)} />}
                      {c.tip === "factura" && (
                        <Btn label={c.achitataLa ? "Anuleaza plata furnizor" : "Marcheaza platita"} size="sm" variant={c.achitataLa ? "quiet" : "secondary"} onPress={async () => {
                          /* [F25] Anularea sterge o informatie: se intreaba intai */
                          if (c.achitataLa && !await confirma(`Anulezi plata catre ${c.furnizor} pentru ${c.categorie}?`)) return;
                          marcheazaFacturaPlatita(c.id, !c.achitataLa);
                        }} />
                      )}
                      {esteCiorna && c.tip === "factura" && <Btn label="Modifica" size="sm" variant="secondary" onPress={() => setFactura({ cheltuiala: c })} />}
                      {esteCiorna && c.tip === "factura" && <Btn label="Sterge" size="sm" variant="danger" onPress={async () => { if (await confirma(`Stergi ${c.categorie}?`)) stergeCheltuiala(c.id); }} />}
                    </Box>
                  </Box>
                </Box>
              ))}
              <Line />
              <Box row style={{ padding: S.md, justifyContent: "space-between" }}>
                <Txt size={13} weight={700}>Total</Txt>
                <Lei value={totalFacturi} size={14} weight={700} />
              </Box>
            </Card>
          )}

          {esteCiorna ? (
            <Card gap={S.md}>
              <Titlu sub="Motorul calculeaza pe loc, fara sa salveze nimic">Previzualizarea listei</Titlu>
              <Btn label="Calculeaza lista pe apartamente" variant="secondary" onPress={calculeazaPreviz} disabled={cheltuieli.length === 0} />
              {previz && previz.probleme && (
                <Box gap={S.xs}>
                  <Txt size={12.5} weight={700} color={C.warn}>Lista nu se poate calcula inca:</Txt>
                  {previz.probleme.map((p) => <Txt key={p} size={12} color={C.warn}>{p}</Txt>)}
                </Box>
              )}
              {previz && previz.perAp && (
                <Box gap={6}>
                  {date.apartamente.slice().sort(ordineNumar).map((a) => (
                    <RandCalcul key={a.id} st={`Ap. ${a.numar}, ${a.proprietar}`} dr={lei(previz.perAp[a.id] || 0)} />
                  ))}
                  <Line />
                  <RandCalcul st="Total repartizat" dr={lei(previz.total)} bold />
                  <RandCalcul st="Total facturi" dr={lei(totalFacturi)} />
                </Box>
              )}
              <Btn label="Publica lista" full size="lg" disabled={cheltuieli.length === 0 || lucreaza} onPress={() => setConfirmPublica(true)} />
            </Card>
          ) : (
            <Card gap={S.sm}>
              <Titlu sub="Lista de la avizier, cu toate apartamentele">Exporta lista</Titlu>
              <Txt size={12.5} color={C.inkSoft}>PDF-ul are aceleasi cifre ca aplicatia: fiecare suma vine din repartizarea salvata la publicare.</Txt>
              {/* [C8/X01] Varianta pentru avizier nu are nume, restante sau
                  penalizari: e pentru casa scarii, nu un tabel de datornici.
                  Varianta cu nume ramane, dar separata si marcata intern. */}
              <Btn label="Exporta PDF pentru avizier" size="sm" onPress={() => descarcaPdf(listaPdf(date, lista.id), `lista-plata-${lista.luna}.pdf`)} />
              <Line />
              <Txt size={12.5} color={C.inkSoft}>Varianta de uz administrativ, cu proprietari si restante. Nu se afiseaza in casa scarii.</Txt>
              <Btn label="Exporta lista interna (uz administrativ)" size="sm" variant="secondary" onPress={() => descarcaPdf(listaPdfIntern(date, lista.id), `lista-plata-${lista.luna}-uz-intern.pdf`)} />
            </Card>
          )}
        </>
      )}

      <SheetFactura open={!!factura} onClose={() => setFactura(null)} lista={esteCiorna ? lista : null} cheltuiala={factura && factura.cheltuiala} />

      <Sheet open={confirmPublica} onClose={() => { setConfirmPublica(false); setEroare(null); }} titlu="Publica lista">
        {lista && (
          <>
            <Txt size={14}>Publici lista pe {monthLabel(lista.luna)}, cu {cheltuieli.length} cheltuieli in valoare de {lei(totalFacturi)}.</Txt>
            <Txt size={12.5} color={C.inkSoft}>
              Locatarii o vad imediat, fiecare cu calculul lui. Termenul de plata va fi {dataLunga(lista.scadenta || `${lunaUrmatoare(lista.luna)}-${pad2(date.setari.ziScadenta)}`)}. Dupa publicare, facturile listei nu se mai pot modifica.
            </Txt>
            <Eroare mesaj={eroare} />
            <Btn label={lucreaza ? "Se publica..." : "Da, publica lista"} full size="lg" disabled={lucreaza} onPress={async () => {
              setLucreaza(true);
              setEroare(null);
              const r = await publicaLista(lista.id);
              setLucreaza(false);
              if (r.ok) { setConfirmPublica(false); setPreviz(null); } else setEroare(r.mesaj);
            }} />
            <Btn label="Inapoi" variant="secondary" full onPress={() => setConfirmPublica(false)} />
          </>
        )}
      </Sheet>
    </Box>
  );
}

function AdminSesizari() {
  const { date, preiaSesizare, rezolvaSesizare, scrieMesaj } = useApp();
  const [filtru, setFiltru] = useState("deschise");
  const [selectata, setSelectata] = useState(null);
  const [text, setText] = useState("");

  const vizibile = date.sesizari.filter((s) =>
    filtru === "toate" ? true : filtru === "deschise" ? s.stare !== "rezolvata" : s.stare === "rezolvata"
  ).sort((a, b) => (filtru === "deschise" ? (a.creataLa < b.creataLa ? -1 : 1) : 0));
  const s = selectata ? date.sesizari.find((x) => x.id === selectata) : null;
  const asteapta = (x) => zileIntre(ziLocala(x.creataLa), date.azi);

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`${date.sesizari.filter((x) => x.stare !== "rezolvata").length} deschise`} titlu="Sesizari" />

      <Segment
        small
        value={filtru}
        onChange={setFiltru}
        options={[
          { value: "deschise", label: "Deschise" },
          { value: "rezolvate", label: "Rezolvate" },
          { value: "toate", label: "Toate" },
        ]}
      />

      {vizibile.length === 0 ? (
        <Gol titlu="Nimic aici" text="Nu exista sesizari care sa corespunda filtrului ales." />
      ) : (
        <Box gap={S.sm}>
          {vizibile.map((x) => (
            <Press key={x.id} onPress={() => { setSelectata(x.id); setText(""); }} label={x.titlu}>
              <Card pad={S.md} gap={S.sm}>
                <Box row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: S.sm }}>
                  <Box gap={2} flex={1}>
                    <Txt size={13.5} weight={600}>{x.titlu}</Txt>
                    <Txt size={11.5} color={C.muted}>
                      Ap. {x.apartamentNumar} · {etichetaCategorie(x.categorie)} · {dataRo(x.creataLa)}
                    </Txt>
                  </Box>
                  <StareBadge stare={x.stare} />
                </Box>
                <Txt size={12.5} color={C.inkSoft} randuri={2}>{x.descriere}</Txt>
                {x.stare !== "rezolvata" && (
                  <Txt size={11.5} weight={700} color={asteapta(x) > 3 ? C.danger : C.warn}>
                    {asteapta(x) === 0 ? "Trimisa azi" : `Asteapta de ${pluralZile(asteapta(x))}`}
                  </Txt>
                )}
              </Card>
            </Press>
          ))}
        </Box>
      )}

      <Sheet open={!!s} onClose={() => setSelectata(null)} titlu={s ? `Ap. ${s.apartamentNumar}` : ""}>
        {s && (
          <>
            <Card gap={S.sm}>
              <Box row gap={S.sm}><StareBadge stare={s.stare} /><Badge label={etichetaCategorie(s.categorie)} /></Box>
              <Txt size={16} weight={700}>{s.titlu}</Txt>
              <Txt size={13} color={C.inkSoft}>{s.descriere}</Txt>
              <Txt size={11.5} color={C.muted}>
                Trimisa pe {dataLunga(s.creataLa)}, ora {oraRo(s.creataLa)}
                {s.preluataLa ? `. Preluata pe ${dataRo(s.preluataLa)}` : ""}
                {s.rezolvataLa ? `. Rezolvata pe ${dataRo(s.rezolvataLa)}` : ""}
              </Txt>
              {s.poze.length > 0 && (
                <Box row gap={S.xs}>
                  {s.poze.map((p) => <PozaStocata key={p.id} cale={p.cale} latime={72} inaltime={72} />)}
                </Box>
              )}
            </Card>

            {s.mesaje.length > 0 && (
              <Card gap={S.sm}>
                <Eyebrow>Conversatia</Eyebrow>
                {s.mesaje.map((m) => (
                  <Box key={m.id} style={{ borderLeftWidth: 2, borderLeftStyle: "solid", borderLeftColor: m.dinAdministratie ? C.accent : C.lineStrong, paddingLeft: S.sm }} gap={2}>
                    <Eyebrow color={m.dinAdministratie ? C.accent : C.muted}>{m.dinAdministratie ? "Administratie" : m.autor} · {dataRo(m.la)} {oraRo(m.la)}</Eyebrow>
                    <Txt size={12.5} color={C.inkSoft}>{m.text}</Txt>
                  </Box>
                ))}
              </Card>
            )}

            {s.stare !== "rezolvata" && (
              <>
                <Field label="Raspuns pentru proprietar" value={text} onChange={setText} multiline placeholder="Ce se intampla si pana cand" />
                <Btn label="Trimite raspunsul" full onPress={async () => { const r = await scrieMesaj(s.id, text); if (r.ok) setText(""); }} disabled={!text.trim()} />
                <Box gap={S.sm}>
                  <Eyebrow>Schimba starea</Eyebrow>
                  <Box row gap={S.sm}>
                    {s.stare === "noua" && <Btn label="Preiau sesizarea" size="sm" variant="secondary" onPress={() => preiaSesizare(s.id)} />}
                    <Btn label="Marcheaza rezolvata" size="sm" onPress={async () => { const r = await rezolvaSesizare(s.id); if (r.ok) setSelectata(null); }} />
                  </Box>
                </Box>
              </>
            )}
          </>
        )}
      </Sheet>
    </Box>
  );
}

function AdminBlocEcran({ parametri }) {
  const { date, publicaAnunt, seteazaReminder, trimiteReminder, deschideVot, reamintesteVot, convoacaAdunare, incarcaDocument, deschideDocument, toastMsg } = useApp();
  const [tab, setTab] = useState(parametri && parametri.tab ? parametri.tab : "anunturi");
  const [sheet, setSheet] = useState(null);
  const [titlu, setTitlu] = useState("");
  const [corp, setCorp] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [optiuni, setOptiuni] = useState(["", ""]);
  const [inchideLa, setInchideLa] = useState("");
  const [numarare, setNumarare] = useState("apartament");
  const [dataAg, setDataAg] = useState("");
  const [oraAg, setOraAg] = useState("18:30");
  const [loc, setLoc] = useState("");
  const [tipDoc, setTipDoc] = useState("altul");
  const [fisier, setFisier] = useState(null);
  const [vizibil, setVizibil] = useState(true);

  const deschide = (tip) => {
    setTitlu(""); setCorp(""); setUrgent(false); setOptiuni(["", ""]); setInchideLa(""); setNumarare("apartament");
    setDataAg(""); setOraAg("18:30"); setLoc(""); setTipDoc("altul"); setFisier(null); setVizibil(true);
    setSheet(tip);
  };
  const cuRezultat = (r, mesaj) => { if (r.ok) { if (mesaj) toastMsg(mesaj(r.rezultat)); setSheet(null); } };
  const remindere = ORDINE_REMINDERE.map((tip) => date.remindere.find((r) => r.tip === tip)).filter(Boolean);

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={date.bloc.adresa} titlu="Comunicare" />

      <Segment
        small
        value={tab}
        onChange={setTab}
        options={[
          { value: "anunturi", label: "Anunturi" },
          { value: "remindere", label: "Remindere" },
          { value: "vot", label: "Vot si AG" },
          { value: "acte", label: "Acte" },
        ]}
      />

      {tab === "anunturi" && (
        <Box gap={S.sm}>
          <Btn label="Scrie un anunt" full onPress={() => deschide("anunt")} />
          {date.anunturi.map((a) => (
            <Card key={a.id} gap={S.sm} pad={S.md}>
              <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
                <Box row gap={S.sm} style={{ alignItems: "center" }}>
                  {a.urgent && <Badge label="Urgent" tone="danger" />}
                  <Txt size={11.5} color={C.muted}>{dataRo(a.publicatLa)}</Txt>
                </Box>
                <Txt size={11.5} color={C.muted}>Citit de {a.cititori} din {a.totalLocatari} locatari cu cont</Txt>
              </Box>
              <Txt size={14} weight={700}>{a.titlu}</Txt>
              <Txt size={12.5} color={C.inkSoft}>{a.corp}</Txt>
              <Bar value={a.totalLocatari ? (a.cititori / a.totalLocatari) * 100 : 0} height={5} />
            </Card>
          ))}
        </Box>
      )}

      {tab === "remindere" && (
        <Box gap={S.sm}>
          <Txt size={12.5} color={C.muted}>
            Reminderele pleaca automat, ca notificare in aplicatie, catre locatarii cu cont. Pentru cei fara aplicatie, instiintarea ramane pe hartie.
          </Txt>
          <Card pad={0}>
            {remindere.map((r, i) => {
              const info = REMINDERE_INFO[r.tip];
              return (
                <Box key={r.tip}>
                  {i > 0 && <Line />}
                  <Box style={{ padding: S.md }} gap={S.sm}>
                    <Box row style={{ alignItems: "center", gap: S.md }}>
                      <Box flex={1} gap={2}>
                        <Txt size={13.5} weight={600}>{info.nume}</Txt>
                        <Txt size={11.5} color={C.muted}>{info.cand(r.zile)}</Txt>
                      </Box>
                      <Switch value={r.activ} label={info.nume} onChange={(v) => seteazaReminder(r.tip, v, r.zile)} />
                    </Box>
                    {r.tip !== "lista_publicata" && r.activ && (
                      <Box row gap={S.xs} style={{ flexWrap: "wrap" }}>
                        {[1, 3, 5, 7, 10, 15, 30].map((z) => (
                          <Press key={z} onPress={() => seteazaReminder(r.tip, true, z)} apasat={r.zile === z} style={{ padding: "4px 9px", borderRadius: R.pill, border: `1px solid ${r.zile === z ? C.accent : C.line}`, backgroundColor: r.zile === z ? C.accentSoft : C.surface }}>
                            <Txt size={11} weight={r.zile === z ? 700 : 500}>{plural(z, "zi", "zile")}</Txt>
                          </Press>
                        ))}
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Card>
          <Card gap={S.sm} pad={S.md}>
            <Eyebrow>Trimite acum</Eyebrow>
            <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
              {ORDINE_REMINDERE.filter((t) => REMINDERE_INFO[t].trimiteAcum).map((t) => (
                <Btn key={t} label={REMINDERE_INFO[t].buton} size="sm" variant="secondary" onPress={async () => {
                  const r = await trimiteReminder(t);
                  if (r.ok) toastMsg(`Trimis catre ${plural(r.rezultat.destinatari, "locatar", "locatari")} cu cont, din ${plural(r.rezultat.apartamente, "apartament vizat", "apartamente vizate")}`);
                }} />
              ))}
            </Box>
          </Card>
        </Box>
      )}

      {tab === "vot" && (
        <Box gap={S.md}>
          <Box row gap={S.sm}>
            <Btn label="Deschide un vot nou" size="sm" onPress={() => deschide("vot")} />
            <Btn label="Convoaca adunarea" size="sm" variant="secondary" onPress={() => deschide("adunare")} />
          </Box>
          {date.voturi.map((v) => {
            const deschis = new Date(v.inchideLa) > new Date();
            return (
              <Card key={v.id} gap={S.md}>
                <Box gap={3}>
                  <Badge label={deschis ? "Deschis" : "Inchis"} tone={deschis ? "accent" : "neutral"} />
                  <Txt size={16} weight={700}>{v.titlu}</Txt>
                  <Txt size={12.5} color={C.muted}>Deschis pe {dataRo(v.deschisLa)}, se inchide pe {dataRo(v.inchideLa)}</Txt>
                </Box>
                <Line />
                <RezultateVot vot={v} />
                <Box gap={S.xs}>
                  <Box row style={{ justifyContent: "space-between" }}>
                    <Txt size={12.5} color={C.inkSoft}>Prezenta la vot</Txt>
                    <Txt size={12.5} weight={700} mono>{v.votanti} din {v.totalApartamente}</Txt>
                  </Box>
                  <Bar value={(v.votanti / Math.max(1, v.totalApartamente)) * 100} height={8} />
                  {v.nevotate && v.nevotate.length > 0 && <Txt size={11.5} color={C.muted}>Nu au votat: ap. {v.nevotate.join(", ")}</Txt>}
                </Box>
                {deschis && v.nevotate && v.nevotate.length > 0 && (
                  <Btn label="Reaminteste celor care nu au votat" size="sm" variant="secondary" onPress={async () => {
                    const r = await reamintesteVot(v.id);
                    if (r.ok) toastMsg(`Reminder trimis catre ${plural(r.rezultat.destinatari, "locatar", "locatari")} cu cont, din ${plural(r.rezultat.apartamente, "apartament", "apartamente")}`);
                  }} />
                )}
              </Card>
            );
          })}
          {date.adunari.map((a) => (
            <Card key={a.id} gap={S.sm}>
              <Titlu sub={`${a.loc}, ora ${oraRo(a.dataOra)}`}>Adunarea generala din {dataLunga(a.dataOra)}</Titlu>
              <Txt size={12.5} color={C.inkSoft}>{a.ordineDeZi}</Txt>
              <Txt size={12} color={C.muted}>Au confirmat prezenta {a.prezente} din {a.totalApartamente} apartamente.</Txt>
            </Card>
          ))}
        </Box>
      )}

      {tab === "acte" && (
        <Box gap={S.sm}>
          <Btn label="Incarca un document" full onPress={() => deschide("document")} />
          <Card pad={0}>
            {date.documente.map((d, i) => (
              <Box key={d.id}>
                {i > 0 && <Line />}
                <Press onPress={() => deschideDocument(d.id)} label={`Deschide ${d.titlu}`}>
                  <Box row style={{ padding: S.md, alignItems: "center", gap: S.md }}>
                    <Box flex={1} gap={2}>
                      <Txt size={13} weight={600}>{d.titlu}</Txt>
                      <Txt size={11.5} color={C.muted}>{etichetaTipDocument(d.tip)} · {dataRo(d.creatLa)}</Txt>
                    </Box>
                    <Badge label={d.vizibil ? "Public" : "Doar admin"} tone={d.vizibil ? "ok" : "neutral"} />
                  </Box>
                </Press>
              </Box>
            ))}
          </Card>
        </Box>
      )}

      <Sheet open={sheet === "anunt"} onClose={() => setSheet(null)} titlu="Anunt nou" pazit={areText(titlu, corp)}>
        <Field label="Titlu" value={titlu} onChange={setTitlu} placeholder="Ce trebuie sa stie proprietarii" />
        <Field label="Continut" value={corp} onChange={setCorp} multiline placeholder="Detalii, date, ore" />
        <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.md }}>
          <Box gap={2} flex={1}>
            <Txt size={13} weight={600}>Marcheaza ca urgent</Txt>
            <Txt size={11.5} color={C.muted}>Trimite si notificare imediat, tuturor locatarilor cu cont</Txt>
          </Box>
          <Switch value={urgent} onChange={setUrgent} label="Urgent" />
        </Box>
        <Btn label="Publica anuntul" full size="lg" disabled={!titlu.trim() || !corp.trim()} onPress={async () => cuRezultat(await publicaAnunt({ titlu, corp, urgent }))} />
      </Sheet>

      <Sheet open={sheet === "vot"} onClose={() => setSheet(null)} titlu="Vot nou" pazit={areText(titlu, corp, ...optiuni)}>
        <Field label="Ce se voteaza" value={titlu} onChange={setTitlu} placeholder="Inlocuirea usii de la intrare" />
        <Field label="Detalii" value={corp} onChange={setCorp} multiline placeholder="Ofertele, costurile, de unde se platesc" />
        <Eyebrow>Variantele de vot</Eyebrow>
        {optiuni.map((o, i) => (
          <Box key={i} row gap={S.sm} style={{ alignItems: "center" }}>
            <Box flex={1}>
              <Field value={o} onChange={(t) => setOptiuni(optiuni.map((x, j) => (j === i ? t : x)))} placeholder={`Varianta ${i + 1}`} />
            </Box>
            {/* [F3] O varianta in plus se scoate, dar un vot are nevoie de doua */}
            {optiuni.length > 2 && (
              <Btn label="Sterge varianta" variant="quiet" size="sm" onPress={() => setOptiuni(optiuni.filter((x, j) => j !== i))} />
            )}
          </Box>
        ))}
        {optiuni.length < 5 && <Btn label="Adauga o varianta" size="sm" variant="quiet" onPress={() => setOptiuni([...optiuni, ""])} />}
        <Field label="Votul se inchide pe" value={inchideLa} onChange={setInchideLa} type="date" />
        <Picker label="Cum se numara voturile" value={numarare} onChange={setNumarare} options={[{ value: "apartament", label: "Un vot pe apartament" }, { value: "cota", label: "Ponderat cu cota indiviza" }]} />
        <Btn label="Deschide votul" full size="lg" disabled={!titlu.trim() || optiuni.filter((o) => o.trim()).length < 2 || !inchideLa} onPress={async () => cuRezultat(await deschideVot({ titlu, descriere: corp, optiuni, inchideLa, numarare }))} />
      </Sheet>

      <Sheet open={sheet === "adunare"} onClose={() => setSheet(null)} titlu="Convoaca adunarea generala" pazit={areText(dataAg, loc, corp)}>
        <Box row gap={S.sm}>
          <Box flex={2}><Field label="Data" value={dataAg} onChange={setDataAg} type="date" /></Box>
          <Box flex={1}><Field label="Ora" value={oraAg} onChange={setOraAg} type="time" /></Box>
        </Box>
        <Field label="Locul" value={loc} onChange={setLoc} placeholder="La parter, langa boxe" />
        <Field label="Ordinea de zi" value={corp} onChange={setCorp} multiline placeholder="Ce se discuta si ce se voteaza" />
        <Btn label="Trimite convocarea" full size="lg" disabled={!dataAg || !oraAg || !loc.trim() || !corp.trim()} onPress={async () => cuRezultat(
          await convoacaAdunare({ dataOra: instantRomania(dataAg, oraAg), loc, ordineDeZi: corp }),
          () => "Convocarea a fost trimisa locatarilor cu cont",
        )} />
      </Sheet>

      <Sheet open={sheet === "document"} onClose={() => setSheet(null)} titlu="Document nou" pazit={areText(titlu)}>
        <Field label="Titlu" value={titlu} onChange={setTitlu} placeholder="Proces verbal adunare generala" />
        <Picker label="Tip" value={tipDoc} onChange={setTipDoc} options={TIPURI_DOCUMENTE} />
        <Box row gap={S.sm} style={{ alignItems: "center" }}>
          <AlegeFisier label={fisier ? "Alt fisier" : "Alege fisierul"} accept="application/pdf,image/*" onAles={setFisier} size="sm" />
          {fisier && <Txt size={12} color={C.ok} weight={600}>{fisier.name}</Txt>}
        </Box>
        <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.md }}>
          <Box gap={2} flex={1}>
            <Txt size={13} weight={600}>Vizibil tuturor locatarilor</Txt>
            <Txt size={11.5} color={C.muted}>Altfel il vede doar administratia</Txt>
          </Box>
          <Switch value={vizibil} onChange={setVizibil} label="Vizibil locatarilor" />
        </Box>
        <Btn label="Incarca documentul" full size="lg" disabled={!titlu.trim() || !fisier} onPress={async () => cuRezultat(await incarcaDocument({ titlu, tip: tipDoc, fisier, vizibil }))} />
      </Sheet>
    </Box>
  );
}

/* =============================================================================
   10. NAVIGATIE SI SHELL
   Tab bar-ul de jos se mapeaza direct pe @react-navigation/bottom-tabs.
   Etichetele sunt text, fara librarie de iconite, ca sa nu apara dependinte
   noi la portare.
============================================================================= */

const TABURI_LOCATAR = [
  { key: "acasa", label: "Acasa", ecran: LocatarAcasa },
  { key: "plata", label: "Plata", ecran: LocatarPlata },
  { key: "consum", label: "Contoare", ecran: LocatarConsum },
  { key: "sesizari", label: "Sesizari", ecran: LocatarSesizari },
  { key: "bloc", label: "Bloc", ecran: LocatarBloc },
];

const TABURI_ADMIN = [
  { key: "sumar", label: "Sumar", ecran: AdminSumar },
  { key: "apartamente", label: "Apartamente", ecran: AdminApartamente },
  { key: "facturi", label: "Facturi", ecran: AdminFacturi },
  { key: "adminsesizari", label: "Sesizari", ecran: AdminSesizari },
  { key: "adminbloc", label: "Comunicare", ecran: AdminBlocEcran },
];

function TabBar({ taburi, activ, onChange, badgeuri }) {
  return (
    <Box
      row
      className="ab-tabbar"
      rol="tablist"
      style={{
        borderTopWidth: 1,
        borderTopStyle: "solid",
        borderTopColor: C.line,
        backgroundColor: C.surface,
      }}
    >
      {taburi.map((t) => {
        const esteActiv = t.key === activ;
        const b = badgeuri && badgeuri[t.key];
        return (
          <Press
            key={t.key}
            onPress={() => onChange(t.key)}
            rol="tab"
            ales={esteActiv}
            style={{
              flex: 1,
              /* [R3] Fara asta, cele 5 taburi cer impreuna 220 px (Press
                 impune minWidth: 44 fiecare, [F15]) si la 200% zoom
                 (o coloana de aprox. 206 px) ultimul tab iese din ecran,
                 fara scroll orizontal, iar zonele de atingere nu mai
                 corespund cu ce se vede. Latimea se poate ingusta oricat;
                 doar inaltimea tintei de atingere (minHeight: 44,
                 mostenit din Press) trebuie sa ramana de cel putin 44 px. */
              minWidth: 0,
              alignItems: "center",
              paddingTop: 11,
              paddingBottom: 9,
              borderTopWidth: 2,
              borderTopStyle: "solid",
              borderTopColor: esteActiv ? C.accent : "transparent",
              marginTop: -1,
            }}
          >
            <Box row gap={4} style={{ alignItems: "center", maxWidth: "100%" }}>
              {/* [R3] Eticheta se taie in loc sa impinga tabul in afara
                  ecranului: la 200% zoom, "Apartamente" si "Comunicare" nu
                  incap intregi. Pe React Native, randuri={1} devine
                  numberOfLines={1}. */}
              <Txt size={11.5} weight={esteActiv ? 700 : 500} color={esteActiv ? C.accent : C.muted} randuri={1}>
                {t.label}
              </Txt>
              {b ? (
                <Box style={{
                  minWidth: 15, height: 15, borderRadius: R.pill, backgroundColor: C.danger,
                  alignItems: "center", justifyContent: "center", paddingLeft: 4, paddingRight: 4,
                }}>
                  <Txt size={9} weight={700} color={C.white}>{b}</Txt>
                </Box>
              ) : null}
            </Box>
          </Press>
        );
      })}
    </Box>
  );
}

function BaraSus({ date, onIesi, onAlegeApartament }) {
  const esteAdmin = date.eu.rol === "administrator";
  const ap = !esteAdmin ? apartamentulMeu(date) : null;
  const initiale = date.bloc.denumire.replace(/^Bloc\s+/i, "").split(/[\s,]/)[0].slice(0, 3).toUpperCase();
  /* [P5] Un locatar legat de mai multe apartamente ale aceluiasi bloc
     (proprietar la unul, chirias la altul, de exemplu) poate alege intre
     ele; oricine are unul singur nu vede nimic in plus. */
  const apartamenteMele = !esteAdmin && date.eu.apartamenteMele && date.eu.apartamenteMele.length > 1
    ? date.eu.apartamenteMele.map((id) => date.apartamente.find((a) => a.id === id)).filter(Boolean)
    : null;
  const [alegeOpen, setAlegeOpen] = useState(false);
  const eticheta = esteAdmin ? `Administrator, ${date.bloc.denumire}` : `Apartament ${ap.numar}, ${date.bloc.denumire}`;
  return (
    <Box
      row
      style={{
        alignItems: "center",
        justifyContent: "space-between",
        padding: `${S.sm}px ${S.md}px`,
        borderBottomWidth: 1,
        borderBottomStyle: "solid",
        borderBottomColor: C.line,
        backgroundColor: C.surface,
        gap: S.md,
      }}
    >
      <Box row gap={S.sm} style={{ alignItems: "center" }} flex={1}>
        <Box style={{
          width: 28, height: 28, borderRadius: R.sm, backgroundColor: C.accent,
          alignItems: "center", justifyContent: "center",
        }}>
          <Txt size={11} weight={700} color={C.white}>{initiale}</Txt>
        </Box>
        <Box gap={0} flex={1}>
          <Txt size={13} weight={700}>{date.eu.nume}</Txt>
          {apartamenteMele ? (
            <Press onPress={() => setAlegeOpen(true)} label="Schimba apartamentul">
              <Txt size={11} color={C.accent} weight={700}>{eticheta} · Schimba</Txt>
            </Press>
          ) : (
            <Txt size={11} color={C.muted}>{eticheta}</Txt>
          )}
        </Box>
      </Box>
      <Btn label="Iesi" size="sm" variant="secondary" onPress={onIesi} />
      {apartamenteMele && (
        <Sheet open={alegeOpen} onClose={() => setAlegeOpen(false)} titlu="Alege apartamentul">
          <Txt size={12.5} color={C.muted}>Esti legat de mai multe apartamente din {date.bloc.denumire}. Alege pe care il vezi acum.</Txt>
          <Box gap={S.sm}>
            {apartamenteMele.map((a) => (
              <Press
                key={a.id}
                label={`Apartament ${a.numar}`}
                onPress={() => { setAlegeOpen(false); onAlegeApartament(a.id); }}
              >
                <Box row style={{
                  border: `1px solid ${a.id === ap.id ? C.accent : C.lineStrong}`, borderRadius: R.md, padding: S.md,
                  alignItems: "center", justifyContent: "space-between", backgroundColor: a.id === ap.id ? C.accentSoft : C.surface,
                }}>
                  <Txt size={14} weight={a.id === ap.id ? 700 : 500}>{`Apartament ${a.numar}`}</Txt>
                  {a.id === ap.id && <Badge label="Activ" tone="accent" />}
                </Box>
              </Press>
            ))}
          </Box>
        </Sheet>
      )}
    </Box>
  );
}

/* Granita de eroare: o exceptie la randarea unui ecran nu mai lasa omul in
   fata unei pagini albe. Singura componenta de tip clasa din aplicatie, pentru
   ca doar asa se prind exceptiile de randare; merge la fel si pe React Native. */
class GranitaEroare extends React.Component {
  constructor(props) {
    super(props);
    this.state = { aCrapat: false };
  }

  static getDerivedStateFromError() {
    return { aCrapat: true };
  }

  render() {
    if (!this.state.aCrapat) return this.props.children;
    return (
      <Box gap={S.md} style={{ padding: S.lg, paddingTop: S.xl }}>
        <Card gap={S.md}>
          <Txt size={18} weight={700}>Ceva n-a mers</Txt>
          <Txt size={13} color={C.inkSoft}>
            Ecranul nu s-a putut afisa. Datele tale sunt in siguranta. Incearca din nou, iar daca se repeta, iesi din cont si intra la loc.
          </Txt>
          <Btn label="Incearca din nou" full size="lg" onPress={async () => {
            await this.props.onReincarca();
            this.setState({ aCrapat: false });
          }} />
          <Btn label="Iesi" variant="secondary" full onPress={this.props.onIesi} />
        </Card>
      </Box>
    );
  }
}

/* Ecranele de dinainte de intrarea in aplicatie. Omul are nevoie doar de
   email si parola; locatarul nou mai are nevoie de codul de la administrator. */
function EcranAutentificare() {
  const { intra, inregistreaza, folosesteInvitatie, cereVerificareAdministrator, modDemo } = useApp();
  const [mod, setMod] = useState("intrare");
  const [email, setEmail] = useState("");
  const [parola, setParola] = useState("");
  const [nume, setNume] = useState("");
  const [telefon, setTelefon] = useState("");
  const [cod, setCod] = useState("");
  const [atestat, setAtestat] = useState("");
  const [fisier, setFisier] = useState(null);
  const [lucreaza, setLucreaza] = useState(false);
  /* Cand backend-ul cere confirmarea adresei, inregistrarea nu deschide o
     sesiune, deci pasul 2 se amana pana dupa prima intrare in cont. */
  const [confirmare, setConfirmare] = useState(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ruleaza = async (fn) => { setLucreaza(true); await fn(); setLucreaza(false); };
  const antet = (
    <Box gap={S.sm} style={{ alignItems: "flex-start" }}>
      <Box style={{ width: 44, height: 44, borderRadius: R.md, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" }}>
        <Txt size={15} weight={700} color={C.white}>AB</Txt>
      </Box>
      <Txt size={26} weight={700} style={{ letterSpacing: -0.5 }}>AdminBloc</Txt>
      <Txt size={14} color={C.inkSoft}>Vezi cat ai de plata, de ce atat si cum s-a ajuns la suma aceea.</Txt>
    </Box>
  );

  if (confirmare) {
    return (
      <Box gap={S.lg} style={{ padding: S.lg, paddingTop: S.xxl }}>
        {antet}
        <Card gap={S.md}>
          <Badge label="Aproape gata" tone="info" />
          <Txt size={17} weight={700}>Confirma adresa de email</Txt>
          <Txt size={13} color={C.inkSoft}>
            Ti-am trimis un mesaj la {confirmare.email}. Deschide-l si apasa pe link, apoi intra in cont cu parola aleasa acum.
          </Txt>
          {confirmare.cod ? (
            <Txt size={13} color={C.inkSoft}>
              Pastreaza codul {confirmare.cod}. Il scrii dupa prima intrare in cont si te leaga de apartamentul tau.
            </Txt>
          ) : (
            <Txt size={13} color={C.inkSoft}>
              Dupa prima intrare in cont trimiti numarul atestatului {confirmare.atestat}, ca sa iti verificam calitatea de administrator.
            </Txt>
          )}
          <Btn label="Am confirmat, intru in cont" full size="lg" onPress={() => { setConfirmare(null); setMod("intrare"); }} />
        </Card>
      </Box>
    );
  }

  return (
    <Box gap={S.lg} style={{ padding: S.lg, paddingTop: S.xxl }}>
      {antet}

      {mod === "intrare" && (
        <Card gap={S.md}>
          <Txt size={17} weight={700}>Intra in cont</Txt>
          <Field label="Email" value={email} onChange={setEmail} placeholder="nume@exemplu.ro" type="email" autoComplete="email" />
          <Field label="Parola" value={parola} onChange={setParola} placeholder="Parola ta" type="password" autoComplete="current-password" />
          <Btn label={lucreaza ? "Se verifica..." : "Intra"} full size="lg" disabled={!emailValid || !parola || lucreaza} onPress={() => ruleaza(() => intra(email.trim(), parola))} />
        </Card>
      )}

      {mod === "locatar" && (
        <Card gap={S.md}>
          <Txt size={17} weight={700}>Am un cod de la administrator</Txt>
          <Txt size={12.5} color={C.muted}>Codul de 8 caractere il primesti de la administrator, pe hartie sau prin SMS. Te leaga de apartamentul tau.</Txt>
          <Field label="Codul primit" value={cod} onChange={(t) => setCod(t.toUpperCase())} placeholder="ABCD2345" />
          <Field label="Numele tau" value={nume} onChange={setNume} placeholder="Prenume si nume" autoComplete="name" />
          <Field label="Telefon" value={telefon} onChange={setTelefon} placeholder="07xx xxx xxx" autoComplete="tel" inputMode="tel" />
          <Field label="Email" value={email} onChange={setEmail} placeholder="nume@exemplu.ro" type="email" autoComplete="email" />
          <Field
            label="Alege o parola"
            value={parola}
            onChange={setParola}
            placeholder={PAROLA_INDICIU}
            type="password"
            autoComplete="new-password"
            eroare={parola && !parolaBuna(parola) ? PAROLA_EROARE : null}
          />
          <Btn
            label={lucreaza ? "Se creeaza contul..." : "Creeaza contul"}
            full size="lg"
            disabled={lucreaza || cod.trim().length < 6 || !nume.trim() || !emailValid || !parolaBuna(parola)}
            onPress={() => ruleaza(async () => {
              const r = await inregistreaza({ email: email.trim(), parola, nume: nume.trim(), telefon: telefon.trim() });
              if (!r.ok) return;
              if (!r.rezultat) { setConfirmare({ email: email.trim(), cod: cod.trim() }); return; }
              await folosesteInvitatie(cod.trim());
            })}
          />
        </Card>
      )}

      {mod === "administrator" && (
        <Card gap={S.md}>
          <Txt size={17} weight={700}>Cont de administrator</Txt>
          <Txt size={12.5} color={C.muted}>Dupa inregistrare verificam atestatul de administrator. Pana la aprobare contul nu vede datele niciunei asociatii.</Txt>
          <Field label="Numele tau" value={nume} onChange={setNume} placeholder="Prenume si nume" autoComplete="name" />
          <Field label="Telefon" value={telefon} onChange={setTelefon} placeholder="07xx xxx xxx" autoComplete="tel" inputMode="tel" />
          <Field label="Email" value={email} onChange={setEmail} placeholder="nume@exemplu.ro" type="email" autoComplete="email" />
          <Field
            label="Alege o parola"
            value={parola}
            onChange={setParola}
            placeholder={PAROLA_INDICIU}
            type="password"
            autoComplete="new-password"
            eroare={parola && !parolaBuna(parola) ? PAROLA_EROARE : null}
          />
          <Field label="Numarul atestatului" value={atestat} onChange={setAtestat} placeholder="Seria si numarul de pe atestat" />
          <Box row gap={S.sm} style={{ alignItems: "center" }}>
            <AlegeFisier label={fisier ? "Alta poza" : "Fotografiaza atestatul"} onAles={async (f) => setFisier(await micsoreazaPoza(f))} size="sm" />
            {fisier && <Txt size={12} color={C.ok} weight={600}>Poza atasata</Txt>}
          </Box>
          <Btn
            label={lucreaza ? "Se trimite..." : "Trimite cererea"}
            full size="lg"
            disabled={lucreaza || !nume.trim() || !emailValid || !parolaBuna(parola) || !atestat.trim()}
            onPress={() => ruleaza(async () => {
              const r = await inregistreaza({ email: email.trim(), parola, nume: nume.trim(), telefon: telefon.trim() });
              if (!r.ok) return;
              if (!r.rezultat) { setConfirmare({ email: email.trim(), atestat: atestat.trim() }); return; }
              await cereVerificareAdministrator({ numarAtestat: atestat.trim(), fisier });
            })}
          />
        </Card>
      )}

      <Box gap={S.sm}>
        {mod !== "intrare" && <Btn label="Am deja cont, vreau sa intru" variant="secondary" full onPress={() => setMod("intrare")} />}
        {mod !== "locatar" && <Btn label="Am un cod de la administrator" variant="secondary" full onPress={() => setMod("locatar")} />}
        {mod !== "administrator" && <Btn label="Sunt administrator si vreau cont" variant="quiet" full onPress={() => setMod("administrator")} />}
      </Box>

      {modDemo && (
        <Card gap={S.xs} pad={S.md} style={{ backgroundColor: C.infoSoft, borderColor: C.infoSoft }}>
          <Txt size={12} weight={700} color={C.info}>Mod demonstrativ, fara server</Txt>
          <Txt size={11.5} color={C.info}>Administrator: administrator@adminbloc.test. Locatar: elena.marinescu@adminbloc.test. Parola pentru ambele: Bloc-D14-2026. Datele se reiau de la zero la reincarcarea paginii.</Txt>
        </Card>
      )}
    </Box>
  );
}

/* Contul exista, dar inca nu are acces la nimic */
function EcranFaraAcces() {
  const { date, folosesteInvitatie, cereVerificareAdministrator, iesi } = useApp();
  const [cod, setCod] = useState("");
  const [atestat, setAtestat] = useState("");
  const [fisier, setFisier] = useState(null);
  const rol = date.eu.rol;
  return (
    <Box gap={S.lg} style={{ padding: S.lg, paddingTop: S.xxl }}>
      <AntetEcran eyebrow={date.eu.email || ""} titlu={`Buna, ${date.eu.nume.split(" ")[0]}`} />
      {rol === "in_asteptare" && (
        <Card gap={S.sm}>
          <Badge label="In verificare" tone="warn" />
          <Txt size={15} weight={700}>Contul de administrator asteapta verificarea</Txt>
          <Txt size={13} color={C.inkSoft}>Verificam atestatul si te legam de asociatia pe care o administrezi. Pana atunci contul nu vede datele niciunei asociatii. Te anuntam pe email.</Txt>
        </Card>
      )}
      {/* [K19] "Pentru detalii, scrie-ne la adresa de suport." contrazicea
          formularul de retrimitere ([J4]) chiar de sub el, iar motivul
          respingerii - exact ce omul are nevoie ca sa corecteze cererea -
          nu se arata niciodata. Acum mesajul arata motivul, cand exista, si
          indruma spre acelasi loc unde duce si formularul de mai jos. */}
      {rol === "respins" && (
        <Card gap={S.sm}>
          <Badge label="Respins" tone="danger" />
          <Txt size={15} weight={700}>Cererea de administrator a fost respinsa</Txt>
          {date.eu.motivRespingere && <Txt size={13} color={C.danger}>{date.eu.motivRespingere}</Txt>}
          <Txt size={13} color={C.inkSoft}>Poti retrimite cererea mai jos, cu atestatul corectat.</Txt>
        </Card>
      )}
      {rol === "fara_apartament" && (
        <Card gap={S.md}>
          <Txt size={15} weight={700}>Leaga contul de apartamentul tau</Txt>
          <Txt size={13} color={C.inkSoft}>Scrie codul primit de la administrator. Daca nu ai cod, cere-l administratorului blocului.</Txt>
          <Field label="Codul primit" value={cod} onChange={(t) => setCod(t.toUpperCase())} placeholder="ABCD2345" />
          <Btn label="Foloseste codul" full size="lg" disabled={cod.trim().length < 6} onPress={() => folosesteInvitatie(cod.trim())} />
        </Card>
      )}
      {/* [J4] Backend-ul lasa pe oricine nu e deja aprobat (in_asteptare sau
          respins) sa retrimita cererea, cu atestatul corectat, si o intoarce
          mereu la in_asteptare: un respins nu are de ce sa ramana blocat pe
          "scrie-ne la suport" cand are aceeasi cale inainte ca un fara_apartament. */}
      {(rol === "fara_apartament" || rol === "respins") && (
        <Card gap={S.md}>
          <Txt size={15} weight={700}>Esti administrator de bloc?</Txt>
          <Txt size={13} color={C.inkSoft}>Trimite numarul atestatului si o poza cu el. Verificam si te legam de asociatia pe care o administrezi.</Txt>
          <Field label="Numarul atestatului" value={atestat} onChange={setAtestat} placeholder="Seria si numarul de pe atestat" />
          <Box row gap={S.sm} style={{ alignItems: "center" }}>
            <AlegeFisier label={fisier ? "Alta poza" : "Fotografiaza atestatul"} onAles={async (f) => setFisier(await micsoreazaPoza(f))} size="sm" />
            {fisier && <Txt size={12} color={C.ok} weight={600}>Poza atasata</Txt>}
          </Box>
          <Btn
            label="Trimite cererea de administrator"
            variant="secondary"
            full
            disabled={!atestat.trim()}
            onPress={() => cereVerificareAdministrator({ numarAtestat: atestat.trim(), fisier })}
          />
        </Card>
      )}
      <Btn label="Iesi din cont" variant="secondary" full onPress={iesi} />
    </Box>
  );
}

/* =============================================================================
   11. APLICATIA
============================================================================= */

export default function AdminBloc() {
  const [sursa] = useState(() => creeazaSursa());
  const [sesiune, setSesiune] = useState(undefined);
  const [date, setDate] = useState(null);
  /* [P5] Apartamentul ales de un locatar legat de mai multe apartamente ale
     aceluiasi bloc (proprietar la unul, chirias la altul, de exemplu):
     `null` inseamna "cel ales de identitate.eu()", care ramane alegerea
     pentru toata lumea cu un singur apartament. */
  const [apartamentAles, setApartamentAles] = useState(null);
  const [tab, setTab] = useState(null);
  const [parametri, setParametri] = useState(null);
  const [toast, setToast] = useState(null);
  /* [S3] Prima incarcare cazuta (sesiune expirata, retea) nu lasa omul in
     fata unui "Se incarca..." fara sfarsit. */
  const [eroareIncarcare, setEroareIncarcare] = useState(null);
  const temporizator = React.useRef(null);
  /* Numele comenzilor aflate in aer, ca a doua apasare sa nu porneasca inca una */
  const inCurs = React.useRef(new Set());

  const toastMsg = useCallback((m) => {
    setToast(m);
    clearTimeout(temporizator.current);
    temporizator.current = setTimeout(() => setToast(null), 3400);
  }, []);

  /* [F7] Temporizatorul mesajului nu ramane in urma aplicatiei */
  useEffect(() => () => clearTimeout(temporizator.current), []);

  const reincarca = useCallback(async (apartamentPreferat) => {
    try {
      const d = await sursa.incarca(apartamentPreferat !== undefined ? apartamentPreferat : apartamentAles);
      setDate(d);
      setEroareIncarcare(null);
      /* [C2] incarca() intoarce null cand sesiunea a expirat intre timp (nu o
         eroare): fara asta "sesiune" ar ramane setat si omul ar ramane blocat
         pe "Se incarca..." la nesfarsit, fara nicio cale de a intra din nou. */
      if (!d) setSesiune(null);
      return d;
    } catch (e) {
      const mesajEroare = e.message || "Datele nu au putut fi incarcate.";
      toastMsg(mesajEroare);
      /* [P3] O sesiune moarta nu se arata doar intr-un toast, aici sau in
         orice comanda care reincarca dupa ea: omul trebuie dus direct la
         autentificare, cu ecranul care arata date invechite inlaturat.
         `undefined` (distinct de `null`, folosit mai sus pentru sesiunea
         golita fara eroare) ii spune lui cmd() ca toastul a fost deja aratat,
         ca sa nu-l suprascrie cu mesajul de succes al comenzii. */
      if (mesajEroare === MESAJ_SESIUNE_EXPIRATA) {
        setSesiune(null);
        return undefined;
      }
      setEroareIncarcare(mesajEroare);
      return null;
    }
  }, [sursa, toastMsg, apartamentAles]);

  useEffect(() => {
    let viu = true;
    sursa.sesiuneCurenta().then(async (s) => {
      if (!viu) return;
      setSesiune(s);
      /* [E3] Punctul de plecare al istoricului taburilor: fara el, primul tab
         nu are nicio urma in istoric si "Inapoi" nu se mai poate opri pe el. */
      window.history.replaceState({ tab: null, parametri: null }, "");
      if (s) await reincarca();
    });
    return () => { viu = false; };
  }, [sursa, reincarca]);

  /* [E3] Taburile nu lasau nicio urma in istoricul browserului: "Inapoi" iesea
     direct din aplicatie, ca de pe o pagina obisnuita. Pe React Native tab
     bar-ul de jos (@react-navigation/bottom-tabs) tine singur istoricul
     ecranelor, deci acest efect nu are echivalent acolo. */
  useEffect(() => {
    /* [G14] O intrare straina in istoric (fara state pus de aplicatie) nu are
       stare de-a noastra: nu are ce tab sa restaureze, deci nu face nimic. */
    const laInapoi = (e) => { if (!e.state) return; setTab(e.state.tab); setParametri(e.state.parametri); };
    window.addEventListener("popstate", laInapoi);
    return () => window.removeEventListener("popstate", laInapoi);
  }, []);

  /* Fiecare comanda: apel catre sursa, apoi datele proaspete. Rezultatul este
     { ok, rezultat }, ca ecranul sa stie daca poate inchide formularul. */
  const comenzi = useMemo(() => {
    /* `fundal`: comanda porneste singura, dintr-un efect, nu dintr-o apasare
       a omului (de exemplu, marcarea ca citit a fiecarui anunt necitit cand
       se deschide avizierul). O reintrare a unei asemenea comenzi, prinsa de
       paza de mai jos, nu are ce sa-i explice omului: el nu a apasat nimic
       de doua ori [G10]. */
    const cmd = (fn, mesaj, reinc = true, unic = true, fundal = false) => {
      const comanda = async (...args) => {
        try {
          const rezultat = await fn(...args);
          if (reinc) {
            const d = await reincarca();
            /* [P3] reincarca() a gasit sesiunea moarta: a aratat deja
               toastul potrivit si a scos omul la autentificare. Mesajul de
               succes al comenzii nu mai are ce sa explice pe un ecran care
               oricum dispare. */
            if (d === undefined) return { ok: true, rezultat };
          }
          if (mesaj) toastMsg(typeof mesaj === "function" ? mesaj(rezultat, ...args) : mesaj);
          return { ok: true, rezultat };
        } catch (e) {
          const mesajEroare = e.message || "A aparut o eroare. Incearca din nou.";
          toastMsg(mesajEroare);
          /* [P3] Comanda insasi a lovit sesiunea moarta (fara sa mai ajunga
             la reincarcare): acelasi rezultat, direct la autentificare. */
          if (mesajEroare === MESAJ_SESIUNE_EXPIRATA) setSesiune(null);
          return { ok: false, eroare: e, mesaj: mesajEroare };
        }
      };
      comanda.esteComanda = unic;
      comanda.fundal = fundal;
      return comanda;
    };
    const intrat = async () => {
      const s = await sursa.sesiuneCurenta();
      setSesiune(s);
      setTab(null);
      setApartamentAles(null);
      window.history.replaceState({ tab: null, parametri: null }, "");
      if (s) await reincarca();
      return s;
    };
    const toate = {
      toastMsg,
      reincarca,
      modDemo: sursa.tip === "demo",
      urlFisier: (cale) => sursa.urlFisier(cale),
      deschideDocument: (id) => deschideDupa(sursa.deschideDocument(id), toastMsg),

      intra: cmd(async (email, parola) => { await sursa.intra(email, parola); return intrat(); }, null, false),
      inregistreaza: cmd(async (x) => { await sursa.inregistreaza(x); return intrat(); }, null, false),
      folosesteInvitatie: cmd((c) => sursa.folosesteInvitatie(c), (r) => `Contul a fost legat de apartamentul ${r.apartamentNumar}`),
      cereVerificareAdministrator: cmd((x) => sursa.cereVerificareAdministrator(x), "Cererea a fost trimisa spre verificare"),
      iesi: async () => {
        await sursa.iesi();
        setSesiune(null);
        setDate(null);
        setTab(null);
        setApartamentAles(null);
      },

      /* [P5] Schimba apartamentul activ, pentru un locatar legat de mai
         multe apartamente ale aceluiasi bloc: doar alegerea se schimba, nu
         se pierde nimic — alMeu() aduce deja datele tuturor apartamentelor
         lui la fiecare incarca(). */
      aleseApartament: cmd(async (apartamentId) => { setApartamentAles(apartamentId); return reincarca(apartamentId); }, null, false),

      platesteCard: cmd((x) => sursa.platesteCard(x), (r) => (r.inAsteptare ? r.mesaj : "Plata a fost confirmata de banca")),
      transmiteCitire: cmd((x) => sursa.transmiteCitire(x), "Indexul a fost trimis administratorului"),
      adaugaSesizare: cmd((x) => sursa.adaugaSesizare(x), "Sesizarea a ajuns la administrator"),
      scrieMesaj: cmd((id, t) => sursa.scrieMesaj(id, t), "Mesajul a fost trimis"),
      voteaza: cmd((v, o, a) => sursa.voteaza(v, o, a), "Votul a fost inregistrat"),
      confirmaPrezenta: cmd((a, ap) => sursa.confirmaPrezenta(a, ap), "Prezenta a fost confirmata"),
      marcheazaAnuntCitit: cmd((id) => sursa.marcheazaAnuntCitit(id), null, true, true, true),
      /* [K1] Avizierul cu mai multe anunturi necitite marca fiecare anunt cu o
         comanda proprie, deci cu o reincarcare completa proprie: N anunturi
         necitite porneau N reincarcari, iar fiecare reincarcare repornea
         efectul din LocatarBloc. O singura comanda marcheaza tot lotul si
         reincarca o singura data la final. */
      marcheazaAnunturiCitite: cmd((ids) => Promise.all(ids.map((id) => sursa.marcheazaAnuntCitit(id))), null, true, true, true),
      marcheazaNotificareCitita: cmd((id) => sursa.marcheazaNotificareCitita(id), null, true, true, true),

      deschideLista: cmd((l) => sursa.deschideLista(l), (r, l) => `Lista pe ${monthLabel(l)} a fost inceputa`),
      salveazaCheltuiala: cmd((x) => sursa.salveazaCheltuiala(x), (r, x) => (x.id ? "Factura a fost modificata" : "Factura a fost adaugata in lista in lucru")),
      stergeCheltuiala: cmd((id) => sursa.stergeCheltuiala(id), "Cheltuiala a fost stearsa"),
      /* Citire, nu comanda: previzualizarea se poate cere din nou oricand */
      dateMotor: cmd((id) => sursa.dateMotor(id), null, false, false),
      publicaLista: cmd((id) => sursa.publicaLista(id), "Lista a fost publicata. Locatarii o vad acum."),
      marcheazaFacturaPlatita: cmd((id, p) => sursa.marcheazaFacturaPlatita(id, p), (r, id, p) => (p ? "Factura marcata ca platita furnizorului" : "Plata catre furnizor a fost anulata")),
      inregistreazaNumerar: cmd((ap, s) => sursa.inregistreazaNumerar(ap, s), "Incasare inregistrata, chitanta emisa"),
      trimiteInstiintare: cmd((ap) => sursa.trimiteInstiintare(ap)),
      schimbaPersoane: cmd((ap, n, l, m) => sursa.schimbaPersoane(ap, n, l, m), (r, ap, n, l) => `Din ${monthLabel(l)} se calculeaza ${n} persoane`),
      invitaLocatar: cmd((ap, c) => sursa.invitaLocatar(ap, c), "Codul de invitatie a fost generat"),
      inchideAcces: cmd((id) => sursa.inchideAcces(id), "Accesul a fost inchis"),
      schimbaFisaApartament: cmd((ap, x) => sursa.schimbaFisaApartament(ap, x), "Fisa apartamentului a fost actualizata"),
      schimbaCoteleBlocului: cmd((cote) => sursa.schimbaCoteleBlocului(cote), "Cotele blocului au fost actualizate"),
      inregistreazaIesireFond: cmd((x) => sursa.inregistreazaIesireFond(x), "Iesirea din fond a fost inregistrata"),
      valideazaCitire: cmd((id, a, m) => sursa.valideazaCitire(id, a, m), (r, id, a) => (a ? "Citirea a fost validata" : "Citirea a fost respinsa, locatarul a fost anuntat")),
      /* [A5] O singura comanda pentru tot apartamentul: totul sau nimic */
      valideazaCitiriApartament: cmd((ap, l, a, m) => sursa.valideazaCitiriApartament(ap, l, a, m), (r, ap, l, a) => (a ? "Citirea a fost validata" : "Citirea a fost respinsa, locatarul a fost anuntat")),
      citesteContorGeneral: cmd((l, t, i) => sursa.citesteContorGeneral(l, t, i), "Indexul contorului general a fost salvat"),
      estimeazaCitiri: cmd((l) => sursa.estimeazaCitiri(l)),
      preiaSesizare: cmd((id) => sursa.preiaSesizare(id), "Sesizarea este in lucru"),
      rezolvaSesizare: cmd((id) => sursa.rezolvaSesizare(id), "Sesizarea a fost marcata rezolvata"),
      publicaAnunt: cmd((x) => sursa.publicaAnunt(x), (r, x) => (x.urgent ? "Anunt publicat si notificare trimisa" : "Anunt publicat la avizier")),
      seteazaReminder: cmd((t, a, z) => sursa.seteazaReminder(t, a, z)),
      trimiteReminder: cmd((t) => sursa.trimiteReminder(t)),
      deschideVot: cmd((x) => sursa.deschideVot(x), "Votul a fost deschis"),
      reamintesteVot: cmd((id) => sursa.reamintesteVot(id)),
      convoacaAdunare: cmd((x) => sursa.convoacaAdunare(x)),
      incarcaDocument: cmd((x) => sursa.incarcaDocument(x), "Documentul a fost incarcat"),
    };

    /* [F1] Dublul apasat: cat timp o comanda este in aer, a doua apasare pe
       acelasi buton nu mai porneste nimic. Protectia sta aici, o data pentru
       toate, ca niciun ecran sa nu o poata uita. */
    const protejate = {};
    Object.keys(toate).forEach((nume) => {
      const val = toate[nume];
      if (!val || !val.esteComanda) { protejate[nume] = val; return; }
      protejate[nume] = async (...args) => {
        /* [C10] Cheia include argumentele: "Instiintare" pe apartamentul 3 nu
           trebuie sa blocheze "Instiintare" pe apartamentul 5, apasat imediat
           dupa. Doar aceeasi comanda cu aceleasi argumente se blocheaza.
           [G14] Un File nu are proprietati proprii pentru JSON.stringify (ar
           scrie "{}" pentru oricare), deci doua documente diferite trimise cu
           acelasi text (aceeasi suma/descriere/data, poze diferite) s-ar
           bloca reciproc: fiecare File e scris cu numele, marimea si data lui. */
        const cheie = `${nume}:${JSON.stringify(args, (k, v) => (
          v instanceof File ? `File:${v.name}:${v.size}:${v.lastModified}` : v
        ))}`;
        if (inCurs.current.has(cheie)) {
          /* [E6] O reintrare blocata trebuie sa se simta, nu sa fie tacuta -
             dar doar cand omul a apasat ceva de doua ori. O comanda de
             fundal [G10] care se reia singura nu are ce sa-i explice. */
          if (!val.fundal) toastMsg("Asteapta sa se termine actiunea anterioara.");
          return { ok: false, inCurs: true, mesaj: null };
        }
        inCurs.current.add(cheie);
        try {
          return await val(...args);
        } finally {
          inCurs.current.delete(cheie);
        }
      };
    });
    return protejate;
  }, [sursa, reincarca, toastMsg]);

  const api = useMemo(() => ({ ...comenzi, date }), [comenzi, date]);

  const go = useCallback((t, p) => {
    const parametriNoi = p ? { ...p, _n: Date.now() } : null;
    setTab(t);
    setParametri(parametriNoi);
    /* [E3] pushState lasa o urma in istoric, ca "Inapoi" sa revina la tabul de dinainte */
    window.history.pushState({ tab: t, parametri: parametriNoi }, "");
  }, []);

  let continut;
  let bara = null;
  let tabBar = null;
  /* Cheia ecranului: la schimbarea ei granita de eroare se reaseaza */
  let cheie = "pornire";
  /* [R1] O sesiune moarta in timpul folosirii (nu la prima incarcare) nu
     trebuie sa arunce ecranul de dedesubt, cu tot ce a scris omul in el:
     ecranul ramane montat, cu datele lui vechi, si doar se acopera cu
     autentificarea, ca omul sa nu poata interactiona cu date invechite
     [P3] dar sa gaseasca totul neatins dupa ce intra din nou in cont. */
  const sesiuneMoartaPesteEcran = !sesiune && !!date;
  if (sesiune && !date && eroareIncarcare) {
    cheie = "incarcare-esuata";
    continut = (
      <Box gap={S.lg} style={{ padding: S.lg, paddingTop: S.xxl }}>
        <Card gap={S.md}>
          <Txt size={18} weight={700}>Nu am putut deschide contul</Txt>
          <Txt size={13} color={C.inkSoft}>{eroareIncarcare}</Txt>
          <Txt size={12.5} color={C.muted}>Daca ai stat mult cu aplicatia deschisa, sesiunea s-a inchis singura. Intra din nou in cont.</Txt>
          <Btn label="Incearca din nou" full size="lg" onPress={reincarca} />
          <Btn label="Iesi din cont" variant="secondary" full onPress={comenzi.iesi} />
        </Card>
      </Box>
    );
  } else if (sesiune === undefined || (sesiune && !date)) {
    continut = (
      <Box style={{ padding: S.xl, alignItems: "center", justifyContent: "center" }} flex={1}>
        <Txt size={13} color={C.muted}>Se incarca...</Txt>
      </Box>
    );
  } else if (!sesiune && !date) {
    continut = <EcranAutentificare />;
    cheie = "autentificare";
  } else if (date.eu.rol !== "administrator" && date.eu.rol !== "locatar") {
    continut = <EcranFaraAcces />;
    cheie = "fara-acces";
  } else {
    const esteAdmin = date.eu.rol === "administrator";
    const taburi = esteAdmin ? TABURI_ADMIN : TABURI_LOCATAR;
    const tabActiv = taburi.find((t) => t.key === tab) ? tab : taburi[0].key;
    const Ecran = taburi.find((t) => t.key === tabActiv).ecran;
    const badgeuri = esteAdmin
      ? {
        adminsesizari: date.sesizari.filter((s) => s.stare === "noua").length,
        apartamente: date.citiri.filter((c) => c.stare === "trimisa").length,
      }
      : {
        sesizari: date.sesizari.filter((s) => s.aMea && s.stare !== "rezolvata").length,
        bloc: date.anunturi.filter((a) => !a.citit).length,
        acasa: date.notificari.filter((n) => !n.cititaLa).length,
      };
    cheie = `${date.eu.rol}-${tabActiv}`;
    bara = <BaraSus date={date} onIesi={comenzi.iesi} onAlegeApartament={comenzi.aleseApartament} />;
    continut = (
      <div key={`${date.eu.rol}-${tabActiv}-${parametri ? parametri._n : ""}`} className="ab-fade">
        <Ecran go={go} parametri={parametri} />
      </div>
    );
    tabBar = <TabBar taburi={taburi} activ={tabActiv} onChange={(t) => go(t)} badgeuri={badgeuri} />;
  }

  return (
    <AppCtx.Provider value={api}>
      <div className="ab-root" style={{ fontFamily: F.ui, backgroundColor: C.paperDeep, display: "flex", justifyContent: "center" }}>
        <style>{BASE_CSS}</style>
        <Box
          className="ab-shell"
          style={{
            width: "100%",
            maxWidth: 520,
            backgroundColor: C.paper,
            borderLeft: `1px solid ${C.line}`,
            borderRight: `1px solid ${C.line}`,
            position: "relative",
            overflow: "hidden",
          }}
        >
          {bara}
          <div
            className="ab-scroll"
            style={{ flex: 1, overflowY: "auto", paddingTop: tabBar ? S.lg : 0, paddingLeft: tabBar ? S.lg : 0, paddingRight: tabBar ? S.lg : 0, paddingBottom: S.xxl }}
          >
            <GranitaEroare key={cheie} onIesi={comenzi.iesi} onReincarca={reincarca}>{continut}</GranitaEroare>
          </div>
          {tabBar}
          {/* [R1] Acopera ecranul vechi, nu-l inlocuieste: vezi
              sesiuneMoartaPesteEcran mai sus. */}
          {sesiuneMoartaPesteEcran && (
            <div className="ab-fade" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 55, overflowY: "auto", backgroundColor: C.paper }}>
              <EcranAutentificare />
            </div>
          )}
          <Toast mesaj={toast} />
        </Box>
      </div>
    </AppCtx.Provider>
  );
}
