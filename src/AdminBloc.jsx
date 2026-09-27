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
/* [K12, K22] ora aleasa in formular, ca ora a Romaniei, nu a dispozitivului */
import { instantRomania, dataOraRomania } from "./ora-romania.js";
/* Numarul de telefon este identitatea contului */
import { normalizeazaTelefon, telefonAfisat } from "../supabase/functions/_shared/telefon.js";

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
/* [K24] Ziua unei clipe, pe ora Romaniei, nu a telefonului */
const ziLocala = (iso) => dataOraRomania(iso).data;


const dataRo = (iso) => {
  const [y, m, d] = (iso.length > 10 ? ziLocala(iso) : iso).split("-");
  return `${Number(d)} ${LUNI_S[Number(m) - 1]} ${y}`;
};
const dataLunga = (iso) => {
  const [y, m, d] = (iso.length > 10 ? ziLocala(iso) : iso).split("-");
  return `${Number(d)} ${LUNI[Number(m) - 1]} ${y}`;
};
const oraRo = (iso) => dataOraRomania(iso).ora;

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
  consum: { eticheta: "Pe consum măsurat", explic: "Fiecare apartament plătește apa citită la contorul lui. Diferența dintre contorul general al blocului și suma contoarelor din apartamente se împarte pe persoane." },
  persoane: { eticheta: "Pe număr de persoane", explic: "Suma se împarte la totalul persoanelor declarate în bloc, apoi se înmulțește cu persoanele din apartament." },
  persoane_fara_lift: { eticheta: "Pe persoane, fără parter", explic: "Suma se împarte doar la persoanele din apartamentele care folosesc liftul. Apartamentele de la parter sunt scutite." },
  apartamente: { eticheta: "Egal pe apartament", explic: "Suma se împarte în părți egale la toate apartamentele din bloc." },
  cota: { eticheta: "Pe cotă indiviză", explic: "Suma se împarte proporțional cu cota parte din proprietatea comună, înscrisă în actul de proprietate." },
};

/* Pe hartie fiecare factura este o coloana. Locatarul isi citeste randul mai
   usor in cateva grupe cu subtotal. O factura cu un cod nelistat aici ajunge
   in grupa "Alte cheltuieli". [L6] Codul (C1, C2, ...) este doar pozitia pe
   lista de hartie a acestei asociatii si poate fi altul in alta asociatie
   (de exemplu salubritatea pe C1); grupa "Apa" nu se poate baza pe cod. Se
   bazeaza in schimb pe metoda "consum", singura folosita pentru apa. */
const GRUPE_CHELTUIELI = [
  { id: "bloc", eticheta: "Curent, lift și curățenie", coduri: ["C3", "C5", "C6", "C4", "C8"] },
  { id: "admin", eticheta: "Administrarea blocului", coduri: ["C7"] },
];

const CATEGORII_SESIZARI = [
  { value: "instalatii", label: "Instalații, apă, canalizare" },
  { value: "iluminat", label: "Iluminat și electrice" },
  { value: "acces", label: "Ușa, interfon, lift" },
  { value: "curatenie", label: "Curățenie și gunoi" },
  { value: "altele", label: "Altele" },
];
const etichetaCategorie = (v) => (CATEGORII_SESIZARI.find((c) => c.value === v) || { label: v }).label;

/* Sesizarile care apar cel mai des, gata scrise: un singur apasat */
const SESIZARI_RAPIDE = [
  { titlu: "Bec ars pe scară", categorie: "iluminat" },
  { titlu: "Geam spart", categorie: "altele" },
  { titlu: "Liftul nu merge", categorie: "acces" },
  { titlu: "Ușa de la intrare nu se închide", categorie: "acces" },
  { titlu: "Interfonul nu funcționează", categorie: "acces" },
  { titlu: "Curge apa pe scară sau în subsol", categorie: "instalatii" },
  { titlu: "Gunoi lăsat pe casa scării", categorie: "curatenie" },
];

const REMINDERE_INFO = {
  lista_publicata: { nume: "Anunț când se afișează lista de plată", cand: () => "În ziua publicării listei", trimiteAcum: false },
  citire_contoare: { nume: "Reamintire de citire a contoarelor", cand: (z) => `Cu ${pluralZile(z)} înainte de termenul de citire`, trimiteAcum: true, buton: "Reamintire de citire index" },
  plata: { nume: "Reamintire de plată", cand: (z) => `Cu ${pluralZile(z)} înainte de scadență`, trimiteAcum: true, buton: "Reamintire de plată" },
  restanta: { nume: "Înștiințare de restanță", cand: (z) => `La ${pluralZile(z)} de la scadență`, trimiteAcum: true, buton: "Înștiințare restanțieri" },
  adunare_generala: { nume: "Convocare adunare generală", cand: (z) => `Cu ${pluralZile(z)} înainte de data adunării`, trimiteAcum: false },
};
const ORDINE_REMINDERE = ["lista_publicata", "citire_contoare", "plata", "restanta", "adunare_generala"];

const TIPURI_DOCUMENTE = [
  { value: "lista_plata", label: "Lista de plată" },
  { value: "raport", label: "Raport" },
  { value: "proces_verbal", label: "Proces verbal" },
  { value: "contract", label: "Contract" },
  { value: "regulament", label: "Regulament" },
  { value: "factura", label: "Factura" },
  { value: "altul", label: "Alt document" },
];
const etichetaTipDocument = (v) => (TIPURI_DOCUMENTE.find((t) => t.value === v) || { label: v }).label;

const ROLURI_CONTACT = { administrator: "Administrator", presedinte: "Președinte", cenzor: "Cenzor", lift: "Urgențe lift", altul: "Contact" };

/* Cine vede blocul intreg. Scrie doar administratorul: presedintele si
   cenzorul verifica, si e bine ca cel care tine banii sa nu fie acelasi cu
   cel care il controleaza. */
const ROLURI_CONDUCERE = ["administrator", "presedinte", "cenzor"];
const ETICHETA_ROL = { administrator: "Administrator", presedinte: "Președinte", cenzor: "Cenzor" };

/* [B2] Cheia unei cereri de incasare: acelasi identificator la fiecare
   reincercare, ca serverul sa recunoasca a doua apasare pe aceiasi bani si sa
   intoarca plata deja inregistrata, in loc sa faca alta. crypto.randomUUID nu
   exista pe toate platformele (React Native), deci il compunem singuri. */
const cheieCerere = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = Math.floor(Math.random() * 16);
  return (c === "x" ? r : (r % 4) + 8).toString(16);
});
const doarVerifica = (date) => date.eu.rol === "presedinte" || date.eu.rol === "cenzor";
/* [C2] Presedintele sau cenzorul care locuieste in bloc: are si apartament,
   deci poate trece intre ecranele lui de locatar si panoul de verificare. */
const poateComuta = (date) => doarVerifica(date) && !!date.eu.apartamentId;

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
/* Mesajul vine de la sursa si se compara ca atare: ramane fara diacritice
   pana cand trec si mesajele din sursa/baza pe diacritice. */
const MESAJ_SESIUNE_EXPIRATA = "Sesiunea a expirat. Intra din nou in cont.";

const ETICHETE_DATORII = {
  intretinere: "Întreținere",
  penalizare: "Penalizare",
  sold_initial: "Restanță preluată",
  fond_rulment: "Fond de rulment",
  corectie: "Corecție",
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
/* [B4] Restanta apartamentului: tot ce e scadent si neplatit, adunat cu credit
   cu tot si taiat la zero -- exact ca financiar.situatie_bloc. Cat timp aduna
   doar randurile cu rest pozitiv, fisa apartamentului putea arata "Restanta
   400" pentru un om pe care Sumarul administratorului il numara la
   "fara restanta", pentru ca avea si un credit de 300 pe alt rand. */
const restanta = (date, apId) => Math.max(0,
  suma(datoriiApartament(date, apId).filter((d) => d.scadenta < date.azi), (d) => d.rest));
const penalizariDeschise = (date, apId) => suma(datoriiDeschise(date, apId).filter((d) => d.tip === "penalizare"), (d) => d.rest);
const datoriePeLista = (date, listaId, apId) => date.datorii.find((d) => d.listaId === listaId && d.apartamentId === apId && d.tip === "intretinere");
const explicatiePenalizare = (date, datorieId) => date.penalizari.find((p) => p.datorieId === datorieId) || null;
/* Oamenii blocului care au cont, cu apartamentul lor: din ei alege
   administratorul presedintele si cenzorul. */
const oameniiBlocului = (date) => date.apartamente
  .flatMap((a) => a.locatari.filter((l) => !l.activPana).map((l) => ({ profilId: l.profilId, nume: l.nume, apartament: a.numar })))
  .filter((o, i, toti) => toti.findIndex((x) => x.profilId === o.profilId) === i)
  .sort((a, b) => a.nume.localeCompare(b.nume, "ro"));

/* [K7] Cat s-a anulat dintr-o penalizare dupa recalcularea listei (negativ) */
const anulatDinPenalizare = (date, datorieId) =>
  suma(date.datorii.filter((d) => d.tip === "anulare_penalizare" && d.anuleazaDatorieId === datorieId), (d) => d.suma);
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
  const sens = dif > 0 ? `cu ${lei(dif)} mai mult` : dif < 0 ? `cu ${lei(-dif)} mai puțin` : "exact la fel";
  return `Întreținerea pe ${monthName(acum.luna)} este ${lei(acum.total)}. Pe ${monthName(inainte.luna)} a fost ${lei(inainte.total)}, deci luna aceasta plătești ${sens}.`;
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

/* Ce a acoperit o plata, in cuvinte, pentru chitanta.
   [B6] Randurile sunt cele inghetate la emitere: chitanta are numar si se pune
   la dosar, deci nu are voie sa spuna altceva maine, dupa ce o recalculare a
   mutat banii de pe o datorie pe alta. */
const etichetaRandChitanta = (r) => (
  r.tip === "intretinere" ? `Întreținere ${monthLabel(r.luna)}`
    : r.tip === "penalizare" ? `Penalizare ${monthLabel(r.luna)}`
      : r.tip === "avans" ? "Avans"
        : r.descriere || "Datorie");

function descriereAlocari(date, plata) {
  const randuri = plata.chitanta ? plata.chitanta.randuri : [];
  /* o plata care n-a acoperit nicio datorie ramane intreaga avans */
  if (randuri.every((r) => r.tip === "avans")) return ["Avans pentru listele următoare"];
  return randuri.map((r) => `${etichetaRandChitanta(r)}: ${lei(r.suma)}`);
}

const numarChitanta = (ch) => `${ch.serie} nr. ${String(ch.numar).padStart(6, "0")}`;

/* [T1] Incasarea stornata: ramane in registru si in istoric, dar nu se mai
   socoteste nicaieri. */
const esteStornata = (plata) => plata.stare === "rambursata";
/* Se storneaza doar ce a fost scris in luna curenta, dupa ziua scrierii. */
const lunaScrierii = (plata) => (plata.creatLa || "").slice(0, 7);

/* Chitanta ca PDF, pentru "isi descarca chitanta" */
function chitantaPdf(date, plata) {
  const a = date.asociatie;
  const ch = plata.chitanta;
  const pentru = ch.emisPentru;
  return documentPdf({
    titlu: `Chitanța ${numarChitanta(ch)}`,
    blocuri: [
      { tip: "text", text: a.denumire, bold: true, marime: 12 },
      { tip: "text", text: `CUI ${a.cui}  |  ${a.adresa}`, gri: true, marime: 9 },
      { tip: "text", text: `IBAN ${a.iban}, ${a.banca}`, gri: true, marime: 9 },
      { tip: "spatiu", h: 18 },
      { tip: "titlu", text: `CHITANȚA  ${numarChitanta(ch)}` },
      { tip: "text", text: `Data: ${dataLunga(ch.emisaLa)}, ora ${oraRo(ch.emisaLa)}`, marime: 10 },
      { tip: "spatiu", h: 10 },
      /* [B8] Chitanta nu stie cine a adus banii: poate fi chiriasul, un copil,
         un vecin. Stie pentru ce apartament au fost primiti, iar proprietarul
         este trecut ca atare, nu ca platitor.
         [S4] Apartamentul, blocul si proprietarul sunt cei de la emitere, nu
         cei de azi: dupa o vanzare, chitantele vechi nu se retiparesc pe
         numele noului proprietar. */
      { tip: "text", text: `Am primit pentru apartamentul ${pentru.apartament}, ${pentru.bloc},`, marime: 11 },
      { tip: "text", text: `suma de ${lei(plata.suma)}, reprezentând:`, marime: 11, bold: true },
      { tip: "text", text: `Proprietar la data emiterii: ${pentru.proprietar}`, gri: true, marime: 9 },
      { tip: "spatiu", h: 6 },
      ...descriereAlocari(date, plata).map((t) => ({ tip: "text", text: `  -  ${t}`, marime: 10 })),
      { tip: "spatiu", h: 10 },
      { tip: "text", text: `Modalitate: ${plata.metoda === "numerar" ? `numerar${plata.inregistrataDe ? `, incasat de ${plata.inregistrataDe}` : ""}` : `transfer bancar${plata.inregistrataDe ? `, confirmat de ${plata.inregistrataDe}` : ""}`}`, marime: 10 },
      { tip: "spatiu", h: 30 },
      { tip: "linie" },
      /* [T1] O chitanta stornata ramane in carnet, dar se vede de pe ea ca nu
         mai e buna de nimic. */
      ...(esteStornata(plata)
        ? [{ tip: "text", text: `ANULATĂ pe ${dataLunga(plata.stornataLa)}: ${plata.motivStornare}`, marime: 11, bold: true }]
        : []),
      { tip: "text", text: "Document emis electronic prin AdminBloc. Nu necesită semnătură și ștampilă.", gri: true, marime: 8 },
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
        rest: { text: "Restanțe", latime: LAT_LISTA.rest, dreapta: true, bold: true },
        pen: { text: "Penaliz.", latime: LAT_LISTA.pen, dreapta: true, bold: true },
        plata: { text: "De plată", latime: LAT_LISTA.plata, dreapta: true, bold: true },
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
    titlu: `Lista de plată ${monthLabel(lista.luna)}${interna ? " - uz intern" : ""}`,
    peLatime: true,
    subsol: `${date.asociatie.denumire}, ${date.bloc.denumire}. Lista generată din AdminBloc pe ${dataLunga(date.azi)}.${interna ? " Document intern, nu se afișează la avizier." : ""}`,
    blocuri: [
      { tip: "text", text: `${date.asociatie.denumire}  |  ${date.bloc.denumire}, ${date.bloc.adresa}`, gri: true, marime: 9 },
      { tip: "titlu", text: `Lista de plată pe ${monthLabel(lista.luna)}` },
      ...(interna ? [{ tip: "text", text: "Document intern, uz administrativ: conține numele proprietarilor și restanțele. Nu se afișează la avizier.", marime: 9, bold: true }] : []),
      { tip: "text", text: `Afișată pe ${dataLunga(lista.publicataLa || date.azi)}. Termen de plată: ${lista.scadenta ? dataLunga(lista.scadenta) : "-"}. Penalizări de ${num(date.setari.procentPenalizareZi)}% pe zi după ${date.setari.zileGratie} de zile de la scadență.`, marime: 9 },
      { tip: "spatiu", h: 6 },
      ...cheltuieli.map((c) => ({ tip: "text", marime: 8, text: `${c.cod}  ${c.categorie}  -  ${c.furnizor}${c.serie ? `, ${c.serie}` : ""}  -  ${lei(c.suma)}  -  ${METODE[c.metoda].eticheta.toLowerCase()}` })),
      { tip: "spatiu", h: 8 },
      ...blocuriTabel,
      { tip: "spatiu", h: 10 },
      { tip: "text", text: "Fiecare sumă se poate verifica în aplicație: apăsați pe rândul cheltuielii ca să vedeți factura și calculul complet.", gri: true, marime: 8 },
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
            <Press onPress={onClose} label="Închide" style={{ alignItems: "center", justifyContent: "center" }}>
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
      if (!url) throw new Error("Documentul nu are fișier atașat.");
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
      <Imagine uri={uri} latime={latime} inaltime={inaltime} alt="Poza atașată" />
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
              <RandCalcul st="Diferența pe coloană" dr={`${num(d.diferenta, 2)} mc`} accent />
              <Line style={{ marginTop: 2, marginBottom: 2 }} />
              <RandCalcul st={`Preț pe metru cub, ${lei(linie.sumaFactura, false)} ÷ ${num(d.contorGeneral, 2)}`} dr={`${num(d.pretMc, 4)} lei`} />
              <RandCalcul st="Consumul apartamentului" dr={`${num(d.consumPropriu)} mc`} />
              <RandCalcul st={`Cotă din diferență, ${d.persoane} din ${d.totalPersoane} pers.`} dr={`${num(d.cotaDiferenta)} mc`} />
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
              Consumul apartamentului este estimat pe media ultimelor trei luni, pentru că indexul nu a fost transmis la timp. Diferența se reglează când se citește contorul.
            </Txt>
          ) : null}

          {linie.metoda === "persoane_fara_lift" && b.valoare === 0 ? (
            <Txt size={12} color={C.ok} weight={600}>Apartamentul este scutit de lift, de aceea nu plătește nimic pe acest rând.</Txt>
          ) : null}

          {linie.rotunjire ? (
            <Txt size={11.5} color={C.muted}>
              La suma de mai sus se adaugă {lei(linie.rotunjire)} din rotunjirea la ban a întregii facturi, ca totalul împărțit să fie egal cu factura. Restul de rotunjire merge la apartamentul cu partea cea mai mare.
            </Txt>
          ) : null}

          <Box gap={2}>
            <Eyebrow>Documentul justificativ</Eyebrow>
            <Txt size={12.5} weight={600}>{linie.furnizor}</Txt>
            <Txt size={12} color={C.muted}>
              {linie.esteFond ? linie.serie : `Factura ${linie.serie || "fără număr"}, ${lei(linie.sumaFactura)}`}
            </Txt>
          </Box>

          {linie.documentId ? (
            <Btn label="Vezi documentul" variant="secondary" size="sm" onPress={() => deschideDocument(linie.documentId)} />
          ) : (
            <Txt size={11.5} color={C.muted}>Documentul nu a fost încă încărcat de administrator.</Txt>
          )}

          <Txt size={11.5} color={C.muted}>
            Apartamentul suportă {num(procent, 2)}% din această cheltuială.
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
  if (b.unitate === "%") return `cotă ${num(b.valoare)}% din ${lei(linie.sumaFactura)}`;
  if (b.unitate === "apartamente") return `1 din ${num(b.total, 0)} apartamente`;
  return `${num(b.valoare, 0)} din ${num(b.total, 0)} ${b.unitate}`;
}

function etichetaBaza(valoare, unitate) {
  if (unitate === "apartamente") return Number(valoare) === 1 ? "1 apartament" : `${num(valoare, 0)} apartamente`;
  if (unitate === "%") return `${num(valoare, 2)}%`;
  if (unitate === "persoane") return Number(valoare) === 1 ? "1 persoană" : `${num(valoare, 0)} persoane`;
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
    noua: ["Nouă", "danger"],
    in_lucru: ["În lucru", "warn"],
    rezolvata: ["Rezolvată", "ok"],
  }[stare] || [stare, "neutral"];
  return <Badge label={map[0]} tone={map[1]} />;
}

function StareCitireBadge({ citire }) {
  if (!citire) return <Badge label="Netransmis" tone="warn" />;
  if (citire.stare === "respinsa") return <Badge label="Respins" tone="danger" />;
  if (citire.sursa === "estimat") return <Badge label="Estimat" tone="warn" />;
  if (citire.sursa === "pornire") return <Badge label="Index de pornire" tone="info" />;
  if (citire.stare === "validata") return <Badge label="Validat" tone="ok" />;
  return <Badge label="Trimis, în verificare" tone="info" />;
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
      <Btn label={`Sună ${contact.telefon}`} variant="secondary" size="sm" onPress={() => deschideUrl(`tel:${contact.telefon.replace(/\s/g, "")}`)} />
    </Box>
  );
}

function CardContacte({ contacte }) {
  return (
    <Card gap={S.sm}>
      <Titlu sub="Oamenii care răspund de bloc">Pe cine suni</Titlu>
      {contacte.map((c, i) => (
        <Box key={c.id} gap={S.sm}>
          {i > 0 && <Line />}
          <ContactRand contact={c} />
        </Box>
      ))}
    </Card>
  );
}

/* Cum platesti: in numerar la administrator sau prin transfer bancar, cele
   doua cai prin care ajung banii la asociatie. Ecranul spune limpede ce are
   omul de facut, cu datele pe care asociatia le are deja. */
function CardCumPlatesti({ suma }) {
  const { date } = useApp();
  const ap = apartamentulMeu(date);
  const admin = date.contacte.find((c) => c.rol === "administrator");
  const a = date.asociatie;
  return (
    <Card gap={S.md}>
      <Titlu sub={`Ai de plată ${lei(suma)}`}>Cum plătești</Titlu>
      <Box gap={S.sm}>
        <Eyebrow>În numerar, la administrator</Eyebrow>
        {admin ? <ContactRand contact={admin} /> : <Txt size={13} color={C.muted}>Administratorul nu are un contact trecut în aplicație.</Txt>}
      </Box>
      {a.iban && (
        <>
          <Line />
          <Box gap={4}>
            <Eyebrow>Prin transfer bancar</Eyebrow>
            <Txt size={15} weight={700}>{a.iban}</Txt>
            <Txt size={12.5} color={C.inkSoft}>{a.banca}</Txt>
            <Txt size={12.5} color={C.inkSoft}>{a.denumire}</Txt>
            <Txt size={12.5} color={C.muted}>Scrie la detalii: apartament {ap.numar}, {date.bloc.denumire}</Txt>
          </Box>
        </>
      )}
      <Txt size={12} color={C.muted}>Chitanța o primești în Plățile mele, după ce administratorul înregistrează banii.</Txt>
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
      <AntetEcran eyebrow={`${date.bloc.denumire}, ap. ${ap.numar}`} titlu={`Bună, ${date.eu.nume.split(" ")[0]}`} />

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <Box style={{ padding: S.lg }} gap={S.md}>
          <Box row gap={S.sm} style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
            <Box gap={3}>
              <Eyebrow>{achitat ? "Totul este plătit" : "De plată acum"}</Eyebrow>
              <Lei value={Math.max(0, deDat)} size={34} weight={700} />
            </Box>
            {achitat ? <Badge label="Achitat" tone="ok" />
              : zile != null && zile >= 0 && !areRestanta ? <Badge label={zile === 0 ? "Scadent azi" : `Mai ai ${pluralZile(zile)}`} tone={zile > 5 ? "neutral" : "warn"} />
                : <Badge label="Termen depășit" tone="danger" />}
          </Box>
          {avans(date, ap.id) > 0 && (
            <Txt size={12.5} color={C.ok} weight={600}>Ai plătit în avans {lei(avans(date, ap.id))}. Se scad din următoarea listă.</Txt>
          )}
          {lista && (
            <Txt size={12.5} color={C.muted}>
              Lista pe {monthLabel(lista.luna)}, termen de plată {dataLunga(scadenta)}. După {date.setari.zileGratie} de zile de la scadență se calculează penalizări de {num(date.setari.procentPenalizareZi)}% pe zi.
            </Txt>
          )}
          {!achitat ? (
            <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
              <Btn label="Cum plătesc" onPress={() => go("plata")} />
              <Btn label="De unde vine suma" variant="secondary" onPress={() => go("plata")} />
            </Box>
          ) : ultimaPlata && ultimaPlata.chitanta ? (
            <Btn label="Descarcă ultima chitanță" variant="secondary" onPress={() => descarcaPdf(chitantaPdf(date, ultimaPlata), `chitanta-${ultimaPlata.chitanta.numar}.pdf`)} />
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
          <Titlu sub="Trimise de administrație">Mesaje noi</Titlu>
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
        <Titlu sub="Ce ai de făcut în perioada următoare">De făcut</Titlu>
        {!citireFacuta && (
          <SarcinaRand
            eticheta={citireRespinsa ? "Trimite din nou indexul la apă" : "Transmite indexul la apă"}
            detaliu={citireRespinsa ? "Administratorul a respins citirea trimisă. Vezi de ce." : `Termen ${dataLunga(termenCitire)}${zileIntre(date.azi, termenCitire) >= 0 ? `, mai sunt ${pluralZile(zileIntre(date.azi, termenCitire))}` : ""}`}
            tone={citireRespinsa ? "danger" : "warn"}
            onPress={() => go("consum")}
          />
        )}
        {votDeschis && (
          <SarcinaRand eticheta={`Votează: ${votDeschis.titlu}`} detaliu={`Votul se închide pe ${dataLunga(votDeschis.inchideLa)}`} tone="info" onPress={() => go("bloc", { tab: "vot" })} />
        )}
        {adunare && (
          <SarcinaRand eticheta="Confirmă prezența la adunarea generală" detaliu={`${dataLunga(adunare.dataOra)}, ora ${oraRo(adunare.dataOra)}`} tone="info" onPress={() => go("bloc", { tab: "vot" })} />
        )}
        {citireFacuta && achitat && !votDeschis && !adunare && (
          <Gol titlu="Nimic de făcut acum" text="Ai plătit tot și ai transmis indexul. Te anunțăm când apare ceva nou." />
        )}
      </Box>

      {date.anunturi.length > 0 && (
        <Box gap={S.sm}>
          <Titlu actiune={<Press onPress={() => go("bloc")}><Txt size={12.5} weight={700} color={C.accent}>Toate anunțurile</Txt></Press>}>
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
          <Titlu sub={`Apa rece pe persoană, ${monthLabel(ultimaLunaApa)}`}>Consumul tău față de bloc</Titlu>
          <Box gap={S.sm}>
            <ComparatieRand eticheta="Apartamentul tău" valoare={alMeuPePersoana} max={Math.max(alMeuPePersoana, media)} tone={C.accent} />
            <ComparatieRand eticheta="Media blocului" valoare={media} max={Math.max(alMeuPePersoana, media)} tone={C.lineStrong} />
          </Box>
          <Txt size={12} color={C.muted}>
            {alMeuPePersoana <= media
              ? `Consumi cu ${num(media - alMeuPePersoana)} mc mai puțin decât media pe persoană.`
              : `Consumi cu ${num(alMeuPePersoana - media)} mc mai mult decât media pe persoană.`}
          </Txt>
        </Card>
      )}

      {sesizariMele.length > 0 && (
        <Box gap={S.sm}>
          <Titlu>Sesizările tale</Titlu>
          {sesizariMele.map((s) => {
            const ultim = s.mesaje.filter((m) => m.dinAdministratie).slice(-1)[0];
            return (
              <Press key={s.id} onPress={() => go("sesizari")}>
                <Card pad={S.md} gap={S.xs}>
                  <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
                    <Txt size={13.5} weight={600}>{s.titlu}</Txt>
                    <StareBadge stare={s.stare} />
                  </Box>
                  {ultim && <Txt size={12.5} color={C.inkSoft}>Răspuns: {ultim.text}</Txt>}
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

  if (!listaId) {
    return (
      <Box gap={S.lg}>
        <AntetEcran eyebrow={`Apartament ${ap.numar}`} titlu="Întreținere" />
        <Gol titlu="Nicio listă publicată" text="Când administratorul publică lista de plată, o vezi aici cu fiecare calcul." />
      </Box>
    );
  }

  const def = defalcare(date, ap.id, listaId);
  const { cheltuieli, fonduri, datorii } = def.trepte;
  const istoric = istoricLunar(date, ap.id);
  const fraza = frazaComparatie(istoric);
  /* [T1] si incasarile stornate: omul are chitanta in mana, deci plata ramane
     in istoric, marcata anulata, cu motivul ei. */
  const plati = date.plati.filter((p) => p.apartamentId === ap.id).sort(dupaConfirmare);

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`Apartament ${ap.numar}, ${ap.persoane} persoane, cotă ${num(ap.cota)}%`} titlu="Întreținere" />

      <Segment
        value={tab}
        onChange={setTab}
        options={[{ value: "lista", label: "Lista de plată" }, { value: "istoric", label: "Plățile mele" }]}
      />

      {tab === "lista" ? (
        <>
          <AlegeLuna liste={publicate} value={listaId} onChange={setListaId} />

          <Card gap={S.md}>
            <Box row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <Box gap={3}>
                <Eyebrow>{def.esteCurenta ? "Total de plată acum" : `Lista pe ${monthLabel(def.lista.luna)}`}</Eyebrow>
                <Lei value={def.total} size={30} weight={700} />
              </Box>
              {def.esteCurenta ? (deDat <= 0 ? <Badge label="Achitat" tone="ok" /> : null)
                : <Badge label={def.achitat ? "Achitata" : "Neachitata"} tone={def.achitat ? "ok" : "danger"} />}
            </Box>
            <Box gap={6} style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.md }}>
              <RandCalcul st={`1. Cheltuielile lunii ${monthName(def.lista.luna)}`} dr={lei(cheltuieli.total)} />
              <RandCalcul st="2. Fonduri" dr={lei(fonduri.total)} />
              {datorii && datorii.corectieSuma !== 0 && <RandCalcul st="Corecție după recalculare (inclusă în cheltuielile de mai sus)" dr={lei(datorii.corectieSuma)} />}
              {datorii && datorii.platitDinLista > 0 && <RandCalcul st="Plătit deja din lista lunii" dr={lei(-datorii.platitDinLista)} />}
              {datorii && <RandCalcul st="3. Datorii din lunile trecute" dr={lei(datorii.total)} accent={datorii.total > 0} />}
              <Line style={{ marginTop: 2, marginBottom: 2 }} />
              <RandCalcul st={def.esteCurenta ? "Total de plată" : "Total lista"} dr={lei(def.total)} bold />
            </Box>
            <Txt size={12} color={C.muted}>
              {def.lista.scadenta ? `Termen de plată ${dataLunga(def.lista.scadenta)}. ` : ""}Mai jos este fiecare sumă pe rând. Apasă pe un rând ca să vezi factura și calculul complet.
            </Txt>
          </Card>

          {def.esteCurenta && deDat > 0 && <CardCumPlatesti suma={deDat} />}

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
                        eticheta={d.tip === "intretinere" ? `Întreținere ${monthLabel(d.luna)}, neplătită` : d.descriere}
                        formula={`${d.rest < d.suma ? `rest din ${lei(d.suma)}, ` : ""}scadență ${dataRo(d.scadenta)}${d.zile > 0 ? `, ${pluralZile(d.zile)} întârziere` : ""}`}
                        suma={d.rest}
                      >
                        {d.documentId ? <Btn label="Vezi lista de pe hârtie" variant="quiet" size="sm" style={{ paddingLeft: 0 }} onPress={() => deschideDocument(d.documentId)} /> : null}
                      </RandSuma>
                    </Box>
                  ))}
                  {datorii.penalizari.map((d) => (
                    <Box key={d.id}>
                      <Line />
                      <RandSuma
                        eticheta={`Penalizare calculată pe ${dataLunga(d.scadenta)}`}
                        formula={d.calcul ? `${lei(d.calcul.restNeachitat, false)} × ${num(d.calcul.procentZi)}% × ${d.calcul.zileTaxate} zile` : d.descriere}
                        suma={d.rest}
                      >
                        {d.calcul && (
                          <Txt size={11.5} color={C.muted}>
                            {d.descriere}. Suma neplătită era {lei(d.calcul.restNeachitat)}, cu {pluralZile(d.calcul.zileIntarziere)} de la scadență; primele {pluralZile(d.calcul.zileGratie)} nu se penalizează.
                          </Txt>
                        )}
                        {anulatDinPenalizare(date, d.id) < 0 && (
                          <Txt size={11.5} color={C.muted}>
                            Din ea s-au anulat {lei(-anulatDinPenalizare(date, d.id))} după recalcularea listei, fiindcă datoria pe care fusese calculată s-a micșorat.
                          </Txt>
                        )}
                      </RandSuma>
                    </Box>
                  ))}
                  <Txt size={11.5} color={C.muted} style={{ paddingBottom: S.md }}>
                    Penalizarea este de {num(date.setari.procentPenalizareZi)}% pe zi din suma neplătită, doar pentru zilele de după primele {date.setari.zileGratie} de întârziere, și nu poate depăși suma datorată. Se calculează pe data de 1 a fiecărei luni.
                  </Txt>
                </Box>
              )}
            </Card>
          )}

          <Card gap={S.sm} style={{ backgroundColor: C.accentSoft, borderColor: C.accentLine }}>
            <Txt size={13} weight={700} color={C.accentInk}>Verificarea repartiției</Txt>
            <RandCalcul st="Total facturi și fonduri pe luna" dr={lei(suma(date.cheltuieli.filter((c) => c.listaId === listaId), (c) => c.suma))} />
            <RandCalcul st={`Total repartizat pe cele ${def.lista.apartamente} apartamente`} dr={lei(def.lista.totalRepartizat)} />
            <Line style={{ backgroundColor: C.accentLine }} />
            <RandCalcul st="Diferența" dr={lei(suma(date.cheltuieli.filter((c) => c.listaId === listaId), (c) => c.suma) - def.lista.totalRepartizat)} bold />
            <Txt size={11.5} color={C.accentInk}>
              Suma facturilor primite de asociație este egală cu suma împărțită proprietarilor. Nimic nu rămâne nealocat și nimic nu se plătește de două ori.
            </Txt>
            <Explica termen="Total repartizat" text="Repartizat înseamnă împărțit pe apartamente. Totalul repartizat este cât s-a împărțit în luna aceasta la toate apartamentele, după regulile de mai sus." />
            <Explica termen="Cotă indiviză" text={`Cota indiviză este partea ta din proprietatea comună a blocului, scrisă în actul de proprietate. Apartamentul tău are ${num(ap.cota)}%, iar după cotă se împart cheltuielile care țin de clădire, nu de consum.`} />
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
            <Titlu sub="Totalul listei pe fiecare lună">Cât ai avut de plată</Titlu>
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
          <Titlu sub="Fiecare plată are chitanța ei">Plățile tale</Titlu>
          {plati.length === 0 ? (
            <Gol titlu="Nicio plată încă" text="După prima plată, chitanța apare aici și o poți descărca oricând." />
          ) : plati.map((p) => (
            <Card key={p.id} pad={S.md} gap={S.sm}>
              <Box row style={{ alignItems: "flex-start", gap: S.md }}>
                <Box flex={1} gap={2}>
                  <Txt size={13.5} weight={600} color={esteStornata(p) ? C.muted : C.ink}>{descriereAlocari(date, p).join(", ")}</Txt>
                  <Txt size={11.5} color={C.muted}>{dataLunga(p.confirmataLa)}, {p.metoda === "numerar" ? "numerar" : "transfer"}</Txt>
                  {p.chitanta && <Txt size={11.5} color={C.muted}>Chitanța {numarChitanta(p.chitanta)}</Txt>}
                </Box>
                <Box gap={4} style={{ alignItems: "flex-end" }}>
                  <Lei value={p.suma} size={14} color={esteStornata(p) ? C.muted : C.ink} />
                  {esteStornata(p) && <Badge label="Anulată" tone="danger" />}
                </Box>
              </Box>
              {/* [T1] plata nu se mai scade din ce are de platit: omul trebuie
                  sa afle de ce, langa chitanta pe care o are in mana. */}
              {esteStornata(p) && (
                <Txt size={12} color={C.danger}>
                  Anulată de administrator: {p.motivStornare}. Suma a intrat la loc în ce ai de plată.
                </Txt>
              )}
              {p.chitanta && <Btn label="Descarcă chitanța" variant="secondary" size="sm" onPress={() => descarcaPdf(chitantaPdf(date, p), `chitanta-${p.chitanta.numar}.pdf`)} />}
            </Card>
          ))}
        </Box>
      )}

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
        : n < x.minim ? "Indexul nou nu poate fi mai mic decât cel anterior. Verifică cifrele." : null;
    const hint = v === "" || eroare ? `Contor ${x.contor.serie}${x.contor.amplasare ? `, ${x.contor.amplasare}` : ""}`
      : n < x.anterior ? `Indexul este sub estimarea din luna trecută (${num(x.anterior, 1)}). Pe luna aceasta nu se calculează consum la acest contor.`
        : n - x.anterior > 60 ? "Consumul pare foarte mare. Verifică încă o dată cifrele."
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

  const numeTip = (t) => (t === "rece" ? "Apa rece" : "Apa caldă");

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`Apartament ${ap.numar}`} titlu="Contoare" />

      {contoare.length === 0 && (
        <Card gap={S.sm}>
          <Txt size={15} weight={700}>Apartamentul tău nu are niciun contor de apă</Txt>
          <Txt size={13} color={C.inkSoft}>Nu ai niciun index de transmis. Dacă ai montat un contor, spune-i administratorului să îl înregistreze.</Txt>
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
              Indexul nu a ajuns la timp, așa că administratorul a pus consumul mediu al ultimelor trei luni. Estimarea se reglează la prima citire reală: ce ai plătit în plus se scade atunci, ce ai plătit în minus se adaugă. Dacă cifra nu e bună, scrie-i administratorului la Sesizări.
            </Txt>
          ) : null}
          {citiriLuna.map((x) => (
            <RandCalcul key={x.contor.id} st={numeTip(x.contor.tip)} dr={`${num(x.citire.indexCurent, 1)}, consum ${num(x.citire.consum)} mc`} />
          ))}
          {!toateValidate && zileRamase >= 0 && (
            <>
              <Txt size={12.5} color={C.inkSoft}>Îl poți corecta până pe {dataLunga(termen)}. După validare intră în lista de plată pe {monthName(luna)}.</Txt>
              <Btn label="Corectează indexul" variant="secondary" size="sm" onPress={() => setCorecteaza(true)} />
            </>
          )}
        </Card>
      ) : null}

      {arataFormular && (
        <Card gap={S.lg}>
          <Box gap={3}>
            <Box row gap={S.sm} style={{ alignItems: "center" }}>
              <Badge label={zileRamase >= 0 ? `Termen ${dataRo(termen)}` : "Termen depășit"} tone={zileRamase >= 0 ? "warn" : "danger"} />
            </Box>
            <Txt size={16} weight={700}>Citirea pentru {monthName(luna)}</Txt>
            <Txt size={12.5} color={C.muted}>
              Scrie cifrele negre de pe cadran, fără cele roșii. Fotografiază contoarele, ca administratorul să poată verifica. Dacă nu transmiți până pe {dataLunga(termen)}, primești consum estimat pe media ultimelor trei luni.
            </Txt>
          </Box>

          {respinsa && (
            <Card pad={S.md} style={{ backgroundColor: C.dangerSoft, borderColor: C.dangerLine }} gap={2}>
              <Txt size={13} weight={700} color={C.danger}>Citirea trimisă a fost respinsă</Txt>
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
                <AlegeFisier label="Altă poză" onAles={alegePoza} size="sm" />
              </Box>
            ) : (
              <AlegeFisier label="Fotografiază contoarele" onAles={alegePoza} full />
            )}
          </Box>

          <Btn label={lucreaza ? "Se trimite..." : "Trimite indexul"} full size="lg" onPress={trimite} disabled={!potTrimite} />
          {!poza && randuri.every((r) => r.v !== "") && <Txt size={11.5} color={C.warn} weight={600}>Mai adaugă poza contoarelor, apoi poți trimite.</Txt>}
          {corecteaza && <Btn label="Renunță la corectare" variant="quiet" size="sm" onPress={() => setCorecteaza(false)} />}
        </Card>
      )}

      {istoric.length > 0 && (
        <Card gap={S.md}>
          <Titlu sub="Metri cubi pe lună, de la intrarea în aplicație">Cum a evoluat consumul</Titlu>
          <Segment small value={tipGrafic} onChange={setTipGrafic} options={[{ value: "rece", label: "Apa rece" }, { value: "calda", label: "Apa caldă" }]} />
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
        <Titlu sub="Indexurile transmise și validate">Istoric</Titlu>
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
                            {x.sursa !== "pornire" && <Txt size={11.5} color={C.muted}>{num(x.consum)} mc consumați</Txt>}
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
          <Txt size={13} weight={700}>De ce plătește blocul mai multă apă decât arată contoarele</Txt>
          <Txt size={12.5} color={C.inkSoft}>
            În {monthName(ultimaApa.l.luna)} contorul general de la subsol a înregistrat {num(ultimaApa.r.detaliu.contorGeneral, 1)} mc, iar contoarele din apartamente au însumat {num(ultimaApa.r.detaliu.sumaContoare, 1)} mc. Diferența de {num(ultimaApa.r.detaliu.diferenta, 1)} mc vine din pierderi pe coloană, robinete care picură și contoare care nu mai măsoară corect. Asociația plătește furnizorului tot ce arată contorul general, așa că diferența se împarte pe numărul de persoane: ție îți revin {num(ultimaApa.r.detaliu.cotaDiferenta)} mc.
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
        titlu="Sesizări"
        dreapta={<Btn label="Sesizare nouă" size="sm" onPress={() => setDeschis(true)} />}
      />

      <Segment
        value={tab}
        onChange={setTab}
        options={[{ value: "ale mele", label: "Ale mele" }, { value: "bloc", label: "Din tot blocul" }]}
      />

      {tab === "bloc" && (
        <Txt size={12} color={C.muted}>Vezi ce s-a semnalat deja, ca să nu scrii de două ori despre același lucru. Nu se vede cine a trimis sesizarea.</Txt>
      )}

      {vizibile.length === 0 ? (
        <Gol
          titlu={tab === "ale mele" ? "Nu ai trimis nicio sesizare" : "Nicio sesizare deschisă în bloc"}
          text="Când ceva nu funcționează pe scară sau în bloc, scrie aici. Administratorul vede sesizarea imediat."
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
                  <Eyebrow color={m.dinAdministratie ? C.accent : C.muted}>{m.dinAdministratie ? "Răspuns administrator" : "Mesajul tău"} · {dataRo(m.la)}</Eyebrow>
                  <Txt size={12.5} color={C.inkSoft}>{m.text}</Txt>
                </Box>
              ))}
              {s.aMea && s.stare !== "rezolvata" && (
                <Box row gap={S.sm} style={{ alignItems: "flex-end" }}>
                  <Box flex={1}>
                    <Field value={raspunsuri[s.id] || ""} onChange={(t) => setRaspunsuri({ ...raspunsuri, [s.id]: t })} placeholder="Adaugă un mesaj pentru administrator" />
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

      <Sheet open={deschis} onClose={() => setDeschis(false)} titlu="Sesizare nouă" pazit={areText(titlu, desc)}>
        <Eyebrow>Alege ce s-a întâmplat</Eyebrow>
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
        <Field label="Unde este și de când (opțional)" value={desc} onChange={setDesc} multiline placeholder="Etajul, locul exact, de când se întâmplă" />
        {/* [P2/K10] "Din tot blocul" nu mai aduce descrierea (vederea anonima,
           sesizari_bloc, o lasa afara), doar titlul, fara numele autorului;
           daca scrii detalii care te-ar putea identifica in titlu, el ramane
           vizibil. */}
        <Txt size={11.5} color={C.muted}>Alți locatari văd titlul la Din tot blocul, dar nu văd descrierea și nici numele tău. Nu scrie în titlu date care te-ar putea identifica.</Txt>
        <Box row gap={S.sm} style={{ alignItems: "center", flexWrap: "wrap" }}>
          {poze.map((p) => (
            <Box key={p.url} gap={2} style={{ alignItems: "center" }}>
              <Imagine uri={p.url} latime={56} inaltime={56} alt="Poza sesizare" />
              <Btn label="Șterge poza" variant="quiet" size="sm" onPress={() => stergePoza(p)} />
            </Box>
          ))}
          {poze.length < 3 && <AlegeFisier label={poze.length ? "Încă o poză" : "Adaugă o poză"} onAles={adaugaPoza} size="sm" />}
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
              <Txt size={12.5} weight={alMeu ? 700 : 400}>{o.text}{alMeu ? " · votul tău" : ""}</Txt>
              <Txt size={12.5} weight={700} mono>{pct}%</Txt>
            </Box>
            <Bar value={pct} tone={alMeu ? C.accent : C.lineStrong} />
            <Txt size={11} color={C.muted}>{o.voturi === 1 ? "1 vot" : `${o.voturi} voturi`}{vot.numarare === "cota" ? `, ${num(o.cote)}% din cote` : ""}</Txt>
          </Box>
        );
      })}
      <Txt size={11.5} color={C.muted}>
        Au votat {vot.votanti} din {vot.totalApartamente} apartamente. Votul se numără pe apartament{vot.numarare === "cota" ? ", ponderat cu cotă indiviză" : ""}.
      </Txt>
    </Box>
  );
}

function LocatarBloc({ parametri }) {
  const { date, voteaza, confirmaPrezenta, marcheazaAnunturiCitite, deschideDocument, deschideVerificarea } = useApp();
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

      {/* [C2] Presedintele si cenzorul care locuiesc in bloc au si
          apartamentul lor: ecranele acestea raman ale lor, iar verificarea
          blocului se deschide de aici, cand au nevoie de ea. */}
      {poateComuta(date) && (
        <Card gap={S.sm}>
          <Txt size={13} weight={700}>Ești {ETICHETA_ROL[date.eu.rol].toLowerCase()} al asociației</Txt>
          <Txt size={12.5} color={C.inkSoft}>
            Poți vedea tot blocul: banii, listele, facturile și documentele. Nu poți schimba nimic acolo.
          </Txt>
          <Btn label="Verifică blocul" full size="lg" onPress={() => deschideVerificarea(true)} />
        </Card>
      )}

      <Segment
        small
        value={tab}
        onChange={setTab}
        options={[
          { value: "avizier", label: "Avizier" },
          { value: "vot", label: "Vot și adunare" },
          { value: "acte", label: "Acte" },
          { value: "bani", label: "Fonduri" },
        ]}
      />

      {tab === "avizier" && (
        <Box gap={S.sm}>
          {date.anunturi.length === 0 && <Gol titlu="Avizierul este gol" text="Anunțurile administrației apar aici." />}
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
          {deschise.length === 0 && inchise.length === 0 && <Gol titlu="Niciun vot" text="Când administrația deschide un vot, îl găsești aici." />}
          {deschise.map((vot) => (
            <Card key={vot.id} gap={S.md}>
              <Box gap={3}>
                <Box row gap={S.sm}>
                  <Badge label="Vot deschis" tone="accent" />
                  <Badge label={`Se închide pe ${dataRo(vot.inchideLa)}`} />
                </Box>
                <Txt size={17} weight={700}>{vot.titlu}</Txt>
                <Txt size={13} color={C.inkSoft}>{vot.descriere}</Txt>
              </Box>
              <Line />
              {vot.votulMeu ? (
                <Box gap={S.md}>
                  <Txt size={12.5} color={C.ok} weight={600}>Apartamentul tău a votat. Rezultatele se actualizează pe măsură ce votează și ceilalți.</Txt>
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
                    Votul se înregistrează pe apartament, o singură dată, și apare în procesul verbal al adunării generale.
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
              <Titlu sub={`Convocare trimisă pe ${dataLunga(a.convocataLa)}`}>Adunarea generală din {dataLunga(a.dataOra)}</Titlu>
              <Txt size={13} color={C.inkSoft}>Ora {oraRo(a.dataOra)}, {a.loc}. Ordinea de zi: {a.ordineDeZi}</Txt>
              <Txt size={12} color={C.muted}>Au confirmat {a.prezente} din {a.totalApartamente} apartamente.</Txt>
              {a.prezentaMea ? (
                <Badge label="Ai confirmat că participi" tone="ok" />
              ) : (
                <Btn label="Confirm că particip" onPress={() => confirmaPrezenta(a.id, ap.id)} />
              )}
            </Card>
          ))}

          {inchise.map((vot) => (
            <Card key={vot.id} gap={S.md}>
              <Box gap={3}>
                <Badge label={`Închis pe ${dataRo(vot.inchideLa)}`} />
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
            Documentele asociației, disponibile oricând pentru orice proprietar: facturile, contractele, procesele verbale.
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
                <Eyebrow>Fond de reparații</Eyebrow>
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
            <Explica termen="Fond de reparații" text="Fondul de reparații strânge bani pentru lucrările mari ale blocului: acoperiș, instalații, lift. Se adună lunar de la toate apartamentele și se cheltuie numai pe bază de document." />
            <Explica termen="Fond de rulment" text="Fondul de rulment este suma pusă deoparte de fiecare apartament, ca asociația să poată plăti facturile până încasează întreținerea. Nu se consumă și se restituie când se vinde apartamentul." />
          </Card>
          )}

          {date.fonduri.map((f) => (
            <Card key={f.id} gap={S.md}>
              <Titlu sub={`${f.denumire}, fiecare intrare și ieșire`}>Unde s-au dus banii</Titlu>
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
            <Titlu sub="La nivel de bloc, fără nume">Situația încasărilor</Titlu>
            <Box gap={S.xs}>
              <Box row style={{ justifyContent: "space-between" }}>
                <Txt size={12.5} color={C.inkSoft}>Apartamente fără restanță</Txt>
                <Txt size={12.5} weight={700} mono>{date.situatieBloc.faraRestanta} din {date.situatieBloc.apartamente}</Txt>
              </Box>
              <Bar value={(date.situatieBloc.faraRestanta / Math.max(1, date.situatieBloc.apartamente)) * 100} />
            </Box>
            <Txt size={12.5} color={C.inkSoft}>
              Restanțele blocului sunt {lei(date.situatieBloc.restanteTotal)}. Ele întârzie plățile către furnizori, iar penalizările de la furnizori s-ar plăti din fondul comun.
            </Txt>
          </Card>
        </Box>
      )}

      <Sheet open={!!confirmVot} onClose={() => setConfirmVot(null)} titlu="Confirmă votul">
        {confirmVot && (
          <>
            <Txt size={14}>Votezi pentru:</Txt>
            <Card pad={S.md}><Txt size={15} weight={700}>{confirmVot.optiune.text}</Txt></Card>
            <Txt size={12.5} color={C.muted}>Votul nu se mai poate schimba după ce îl trimiți.</Txt>
            <Btn label="Da, trimite votul" full size="lg" onPress={async () => { const r = await voteaza(confirmVot.vot.id, confirmVot.optiune.id, ap.id); if (r.ok) setConfirmVot(null); }} />
            <Btn label="Înapoi" variant="secondary" full onPress={() => setConfirmVot(null)} />
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
  const { date, trimiteReminder, trimiteInstiintare, toastMsg, deschideVerificarea } = useApp();
  /* Presedintele si cenzorul verifica: vad tot, nu schimba nimic. */
  const verifica = doarVerifica(date);
  const st = statisticiAdmin(date);
  const lista = st.lista;
  const restanti = restantieri(date);
  const reparatii = date.fonduri.find((f) => f.tip === "reparatii");
  const ciorna = listaCiorna(date);

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`${date.asociatie.denumire} · ${st.totalApartamente} apartamente`} titlu="Panou administrator" />

      {/* [C2] Iesirea din verificare, pentru cine locuieste in bloc */}
      {poateComuta(date) && (
        <Btn label="Înapoi la apartamentul meu" variant="secondary" full onPress={() => deschideVerificarea(false)} />
      )}

      {lista ? (
        <Card gap={S.md}>
          <Box row gap={S.sm} style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
            <Box gap={3}>
              <Eyebrow>Lista de plată {monthLabel(lista.luna)}</Eyebrow>
              <Lei value={st.deIncasat} size={26} weight={700} />
              <Txt size={12} color={C.muted}>de încasat, termen {dataRo(lista.scadenta)}</Txt>
            </Box>
            <Badge label={`Publicată ${dataRo(lista.publicataLa)}`} tone="ok" />
          </Box>
          <Box gap={S.xs}>
            <Box row style={{ justifyContent: "space-between" }}>
              <Txt size={12.5} color={C.inkSoft}>Încasat până acum {lei(st.incasat)}</Txt>
              <Txt size={12.5} weight={700} mono>{st.deIncasat ? Math.round((st.incasat / st.deIncasat) * 100) : 0}%</Txt>
            </Box>
            <Bar value={st.deIncasat ? (st.incasat / st.deIncasat) * 100 : 0} height={8} />
            <Txt size={11.5} color={C.muted}>Au plătit integral {st.apAchitate} din {st.totalApartamente} apartamente.</Txt>
          </Box>
          <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
            {!verifica && (
              <Btn label="Trimite reminder de plată" size="sm" onPress={async () => {
                const r = await trimiteReminder("plata");
                if (r.ok) toastMsg(`Reminder trimis către ${plural(r.rezultat.destinatari, "locatar", "locatari")}, din ${plural(r.rezultat.apartamente, "apartament", "apartamente")} cu sold`);
              }} />
            )}
            <Btn label="Exportă lista PDF" size="sm" variant="secondary" onPress={() => descarcaPdf(listaPdfIntern(date, lista.id), `lista-plata-${lista.luna}-uz-intern.pdf`)} />
          </Box>
          {/* [G2/F4] Varianta de aici e cea interna (nume, restante, penalizari):
              acelasi continut ca la Facturi, deci acelasi nume de fisier "-uz-intern",
              ca sa nu se confunde cu PDF-ul de avizier la descarcare. */}
          <Txt size={11.5} color={C.muted}>PDF-ul de mai sus e de uz administrativ: conține proprietarii și restanțele, nu se afișează la avizier.</Txt>
        </Card>
      ) : (
        <Gol titlu="Nicio listă publicată" text="Adaugă facturile lunii și publică prima listă de plată." actiune={<Btn label="Mergi la facturi" size="sm" onPress={() => go("facturi")} />} />
      )}

      <Box row gap={S.sm}>
        <Kpi eticheta="Restanțe" valoare={lei(st.restante, false)} sub={`${st.apCuRestanta} apartamente în urmă`} tone={st.restante > 0 ? C.danger : C.ink} onPress={() => go("apartamente", { filtru: "restanta" })} />
        <Kpi eticheta="Penalizări" valoare={lei(st.penalizari, false)} sub="neachitate, calculate automat" tone={st.penalizari > 0 ? C.warn : C.ink} />
      </Box>
      <Box row gap={S.sm}>
        <Kpi eticheta="Citiri de verificat" valoare={String(st.citiriDeVerificat)} sub="indexuri trimise cu poză" tone={st.citiriDeVerificat ? C.warn : C.ink} onPress={() => go("apartamente", { tab: "citiri" })} />
        <Kpi eticheta="Sesizări" valoare={String(st.sesizariDeschise)} sub="deschise" tone={st.sesizariDeschise ? C.warn : C.ink} onPress={() => go("adminsesizari")} />
      </Box>
      {reparatii && <Kpi eticheta="Fond de reparații" valoare={lei(reparatii.sold)} sub="sold curent" onPress={() => go("apartamente", { tab: "fonduri" })} />}

      {ciorna && (
        <SarcinaRand
          eticheta={`Lista pe ${monthLabel(ciorna.luna)} este în lucru`}
          detaliu={`${plural(date.cheltuieli.filter((c) => c.listaId === ciorna.id).length, "cheltuială adăugată", "cheltuieli adăugate")}. Locatarii o văd după publicare.`}
          tone="accent"
          onPress={() => go("facturi")}
        />
      )}

      {st.facturiNeachitate.length > 0 && (
        <Card gap={S.sm} style={{ borderColor: C.warnLine, backgroundColor: C.warnSoft }}>
          <Txt size={13.5} weight={700} color={C.warn}>
            {st.facturiNeachitate.length === 1 ? "O factură de plătit către furnizori" : `${st.facturiNeachitate.length} facturi de plătit către furnizori`}
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
          Restanțieri
        </Titlu>
        {restanti.length === 0 ? (
          <Gol titlu="Nicio restanță" text="Toate apartamentele sunt la zi cu plata." />
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
                      {pluralZile(r.zile)} întârziere{r.penalizari > 0 ? `, penalizări ${lei(r.penalizari)}` : ""}
                    </Txt>
                  </Box>
                  <Box gap={4} style={{ alignItems: "flex-end" }}>
                    <Lei value={r.restanta} size={13} color={C.danger} />
                    {!verifica && (
                      <Btn label="Înștiințare" size="sm" variant="secondary" onPress={async () => {
                        const x = await trimiteInstiintare(r.ap.id);
                        if (x.ok) toastMsg(x.rezultat.destinatari ? `Înștiințare trimisă în aplicație pentru ap. ${r.ap.numar}` : `Ap. ${r.ap.numar} nu are cont în aplicație. Înștiințarea se dă pe hârtie.`);
                      }} />
                    )}
                  </Box>
                </Box>
              </Box>
            ))}
          </Card>
        )}
      </Box>

      {!verifica && (
        <Box gap={S.sm}>
          <Titlu>Acțiuni rapide</Titlu>
          <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
            <Btn label="Adaugă factură" variant="secondary" size="sm" onPress={() => go("facturi")} />
            <Btn label="Înregistrează încasare" variant="secondary" size="sm" onPress={() => go("apartamente")} />
            <Btn label="Scrie un anunț" variant="secondary" size="sm" onPress={() => go("adminbloc")} />
            <Btn label="Deschide un vot" variant="secondary" size="sm" onPress={() => go("adminbloc", { tab: "vot" })} />
          </Box>
        </Box>
      )}
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
  const verifica = doarVerifica(date);
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
            {!verifica && <Btn label="Înregistrează o ieșire" size="sm" variant="secondary" onPress={() => deschide(f.id)} />}
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

      <Sheet open={!!ies} onClose={inchide} titlu="Ieșire din fond" pazit={areText(suma, descriere)}>
        <Field label="Suma ieșită" value={suma} onChange={setSuma} placeholder="0,00" suffix="lei" inputMode="decimal" hint="Scrie suma ca număr pozitiv; ea se scade din fond." />
        <Field label="Pentru ce" value={descriere} onChange={setDescriere} placeholder="Reparație acoperiș, bloc scară A" />
        <Field label="Data" value={data} onChange={setData} type="date" />
        <Box row gap={S.sm} style={{ alignItems: "center" }}>
          <AlegeFisier label={fisier ? "Alt document" : "Atașează documentul"} accept="application/pdf,image/*" onAles={async (f2) => setFisier(await micsoreazaPoza(f2))} size="sm" />
          {fisier && <Txt size={12} color={C.ok} weight={600}>{fisier.name}</Txt>}
        </Box>
        <Eroare mesaj={eroare} />
        <Btn
          label="Înregistrează ieșirea"
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
      <Field value={cauta} onChange={setCauta} placeholder="Caută după nume sau număr" />
      <Segment
        small
        value={filtru}
        onChange={setFiltru}
        options={[
          { value: "toate", label: `Toate ${date.apartamente.length}` },
          { value: "neachitat", label: `Cu sold ${neachitate.length}` },
          { value: "restanta", label: `Restanțe ${cuRestanta.length}` },
        ]}
      />

      {rezultate.length === 0 ? (
        <Gol titlu="Niciun rezultat" text="Schimbă filtrul sau șterge textul din căutare." />
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
                        Etaj {a.etaj === 0 ? "parter" : a.etaj} · {a.persoane} pers. · cotă {num(a.cota)}%
                      </Txt>
                    </Box>
                    <Box gap={3} style={{ alignItems: "flex-end" }}>
                      <Lei value={totalLuna} size={13} />
                      {rest > 0 ? <Badge label={`Restanță ${lei(rest, false)}`} tone="danger" />
                        : s <= 0 ? <Badge label="Achitat" tone="ok" /> : <Badge label="În termen" />}
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
    date, inregistreazaIncasare, storneazaIncasare, trimiteInstiintare, schimbaPersoane, adaugaLocatar, parolaNoua, inchideAcces,
    schimbaFisaApartament, schimbaCoteleBlocului, toastMsg,
  } = useApp();
  const verifica = doarVerifica(date);
  const [actiune, setActiune] = useState(null);
  const [sumaIncasata, setSumaIncasata] = useState("");
  const [plataNoua, setPlataNoua] = useState(null);
  /* Cum au venit banii: in mana administratorului sau in contul asociatiei */
  const [metodaIncasare, setMetodaIncasare] = useState("numerar");
  /* [B5] Ziua in care au intrat banii: pentru un transfer, ea poate fi mai
     veche decat ziua in care administratorul vede extrasul si confirma. */
  const [dataIncasarii, setDataIncasarii] = useState("");
  /* [T1] Incasarea scrisa gresit, cu motivul pe care il vede si locatarul */
  const [deStornat, setDeStornat] = useState(null);
  const [motivStornare, setMotivStornare] = useState("");
  const [persoane, setPersoane] = useState("");
  const [dinLuna, setDinLuna] = useState("");
  const [motiv, setMotiv] = useState("");
  /* Contul locatarului: numele si numarul lui, apoi parola aratata o data */
  const [numeNou, setNumeNou] = useState("");
  const [telefonNou, setTelefonNou] = useState("");
  const [calitateNoua, setCalitateNoua] = useState("proprietar");
  const [contNou, setContNou] = useState(null);
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
  /* [B2] ... si nici o a doua incercare dupa un raspuns pierdut pe drum:
     cheia cererii este facuta cand se deschide formularul si ramane aceeasi
     pana cand incasarea reuseste. */
  const cheieIncasare = React.useRef(null);
  const [incaseaza, setIncaseaza] = useState(false);

  const ap = apId ? apartamentDupaId(date, apId) : null;
  const inchide = () => {
    setActiune(null); setPlataNoua(null); setContNou(null); setNumeNou(""); setTelefonNou(""); setSumaIncasata(""); setMetodaIncasare("numerar"); setDataIncasarii(""); setDeStornat(null); setMotivStornare(""); setPersoane(""); setMotiv(""); setEroare(null);
    setProprietarEd(""); setEtajEd(""); setMpEd(""); setCotaEd(""); setScutitLiftEd(false); setCoteBloc({});
    onClose();
  };
  if (!ap) return <Sheet open={false} onClose={inchide} titlu="" />;

  const lista = listaCurenta(date);
  const s = sold(date, ap.id);
  const deschise = datoriiDeschise(date, ap.id);
  /* [T1] Incasarile scrise luna aceasta: numai ele se mai pot storna */
  const incasariDeLuna = date.plati
    .filter((p) => p.apartamentId === ap.id && lunaScrierii(p) === date.azi.slice(0, 7))
    .sort(dupaConfirmare);
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
          <Box gap={2}><Eyebrow>Cotă indiviză</Eyebrow><Txt size={13}>{num(ap.cota)}%</Txt></Box>
          <Box gap={2}><Eyebrow>Suprafață</Eyebrow><Txt size={13}>{ap.mp ? `${num(ap.mp, 1)} mp` : "-"}</Txt></Box>
          <Box gap={2}><Eyebrow>Lift</Eyebrow><Txt size={13}>{ap.scutitLift ? "Scutit" : "Plătește"}</Txt></Box>
        </Box>
      </Card>

      <Card gap={S.sm}>
        <Box row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Eyebrow>Sold la zi</Eyebrow>
          <Lei value={s} size={18} weight={700} color={restanta(date, ap.id) > 0 ? C.danger : C.ink} />
        </Box>
        {avans(date, ap.id) > 0 && (
          <Txt size={12.5} color={C.ok} weight={600}>Avans nealocat: {lei(avans(date, ap.id))}. Se scade din următoarea listă.</Txt>
        )}
        {deschise.length === 0 ? (
          <Txt size={12.5} color={C.ok} weight={600}>Nu are nimic de plată.</Txt>
        ) : deschise.map((d) => (
          <RandCalcul
            key={d.id}
            st={`${ETICHETE_DATORII[d.tip] || d.tip}${d.luna ? ` ${monthLabel(d.luna)}` : ""}, scadență ${dataRo(d.scadenta)}${d.rest < d.suma ? " (rest)" : ""}`}
            dr={lei(d.rest)}
            accent={d.scadenta < date.azi}
          />
        ))}
      </Card>

      {plata && plata.chitanta ? (
        <Card gap={S.sm} style={{ backgroundColor: C.okSoft, borderColor: C.okLine }}>
          <Txt size={13.5} weight={700} color={C.ok}>Încasare înregistrată: {lei(plata.suma)}</Txt>
          <Txt size={12.5} color={C.inkSoft}>Chitanța {numarChitanta(plata.chitanta)}. Locatarul o vede și în aplicație.</Txt>
          <Btn label="Descarcă chitanța" size="sm" onPress={() => descarcaPdf(chitantaPdf(date, plata), `chitanta-${plata.chitanta.numar}.pdf`)} />
        </Card>
      ) : null}

      {actiune === "incasare" ? (
        <Card gap={S.md}>
          <Txt size={14} weight={700}>Confirmă banii primiți</Txt>
          <Segment
            small
            value={metodaIncasare}
            onChange={setMetodaIncasare}
            options={[{ value: "numerar", label: "În numerar" }, { value: "transfer", label: "Prin transfer bancar" }]}
          />
          {/* [F8] Nu exista nicio cale de a anula o chitanta emisa (nici in
             aplicatie, nici in registrul financiar): cel mai onest lucru pe
             care il poate face ecranul e sa spuna asta inainte de emitere,
             nu sa lase administratorul sa creada ca poate reveni. */}
          <Field label="Suma primită" value={sumaIncasata} onChange={setSumaIncasata} placeholder={lei(Math.max(0, s), false)} suffix="lei" inputMode="decimal" hint="Banii se alocă automat pe cea mai veche datorie. Chitanța se emite imediat; dacă ai greșit, o poți anula din această fișă cât timp suntem în aceeași lună." />
          {/* [B5] Extrasul se verifica peste cateva zile, dar banii au intrat
              atunci: data lor merge pe chitanta si in registru. */}
          {metodaIncasare === "transfer" && (
            <Field
              label="Data în care au intrat banii"
              value={dataIncasarii || date.azi}
              onChange={setDataIncasarii}
              type="date"
              hint="Ziua din extrasul de cont, nu ziua în care o confirmi."
            />
          )}
          <Eroare mesaj={eroare} />
          <Box row gap={S.sm}>
            <Btn label={incaseaza ? "Se emite..." : "Emite chitanța"} disabled={!(sumaCash > 0) || incaseaza} onPress={async () => {
              if (incasareInCurs.current) return;
              incasareInCurs.current = true;
              setIncaseaza(true);
              setEroare(null);
              if (!cheieIncasare.current) cheieIncasare.current = cheieCerere();
              const r = await inregistreazaIncasare(ap.id, sumaCash, metodaIncasare, cheieIncasare.current,
                metodaIncasare === "transfer" ? (dataIncasarii || date.azi) : null);
              incasareInCurs.current = false;
              setIncaseaza(false);
              /* [B7] metoda se intoarce la "numerar": altfel a doua incasare
                 din aceeasi fisa pornea cu "transfer bancar" preselectat, iar
                 chitanta spunea transfer pentru bani primiti in mana. */
              if (r.ok) {
                cheieIncasare.current = null;
                setPlataNoua(r.rezultat.plataId); setActiune(null); setSumaIncasata(""); setMetodaIncasare("numerar"); setDataIncasarii("");
              } else setEroare(r.mesaj);
            }} />
            <Btn label="Renunță" variant="secondary" onPress={() => setActiune(null)} />
          </Box>
        </Card>
      ) : actiune === "stornare" ? (
        <Card gap={S.md}>
          <Txt size={14} weight={700}>Anulează încasarea</Txt>
          <Txt size={12.5} color={C.inkSoft}>
            Suma intră la loc în ce are de plătit apartamentul, iar chitanța rămâne cu numărul ei, marcată anulată.
            Locatarul primește înștiințare cu motivul scris de tine.
          </Txt>
          <Field
            label="De ce o anulezi"
            value={motivStornare}
            onChange={setMotivStornare}
            placeholder="Suma a fost scrisă greșit"
            hint="Îl vede și locatarul, lângă plata anulată."
          />
          <Eroare mesaj={eroare} />
          <Box row gap={S.sm}>
            <Btn label="Stornează" disabled={!motivStornare.trim()} onPress={async () => {
              setEroare(null);
              const r = await storneazaIncasare(deStornat, motivStornare.trim());
              if (r.ok) { setActiune(null); setDeStornat(null); setMotivStornare(""); } else setEroare(r.mesaj);
            }} />
            <Btn label="Renunță" variant="secondary" onPress={() => { setActiune(null); setDeStornat(null); }} />
          </Box>
        </Card>
      ) : actiune === "persoane" ? (
        <Card gap={S.md}>
          <Txt size={14} weight={700}>Modifică numărul de persoane</Txt>
          <Txt size={12} color={C.muted}>Schimbarea se aplică de la luna aleasă. Listele deja publicate nu se schimbă.</Txt>
          <Field label="Număr nou de persoane" value={persoane} onChange={setPersoane} placeholder={String(ap.persoane)} inputMode="numeric" />
          <Picker label="Începând cu luna" value={dinLuna || (luniViitoare[0] || "")} onChange={setDinLuna} options={luniViitoare.map((l) => ({ value: l, label: monthLabel(l) }))} />
          <Field label="Motivul" value={motiv} onChange={setMotiv} placeholder="Declarație nouă, s-a mutat cineva" />
          <Box row gap={S.sm}>
            <Btn label="Salvează" disabled={persoane === "" || Number.isNaN(Number(persoane)) || !luniViitoare.length} onPress={async () => {
              const r = await schimbaPersoane(ap.id, Number(persoane), dinLuna || luniViitoare[0], motiv.trim());
              if (r.ok) { setActiune(null); setPersoane(""); setMotiv(""); }
            }} />
            <Btn label="Renunță" variant="secondary" onPress={() => setActiune(null)} />
          </Box>
        </Card>
      ) : actiune === "cont" ? (
        <Card gap={S.md}>
          <Txt size={14} weight={700}>Adaugă un locatar în aplicație</Txt>
          {contNou ? (
            <>
              <Txt size={12.5} color={C.inkSoft}>
                {contNou.parola
                  ? "Contul este gata. Dă-i omului numărul și parola de mai jos, pe hârtie sau la telefon. Parola nu se mai poate vedea după ce închizi."
                  /* [A7] Daca nu stie nimeni parola veche (un cont ramas de
                     la o incercare cazuta la mijloc), butonul "Parola noua"
                     de pe fisa o inlocuieste. */
                  : "Omul avea deja cont pe acest număr, așa că l-am legat și de apartamentul acesta. Intră cu parola pe care o știe deja; dacă nu o mai știe, apasă \"Parola nouă\"."}
              </Txt>
              <Box style={{ backgroundColor: C.accentSoft, borderRadius: R.md, padding: S.md, gap: 4 }}>
                <Txt size={13} color={C.accentInk}>Intră cu numărul {telefonAfisat(contNou.telefon)}</Txt>
                {contNou.parola && <Txt size={22} weight={700} mono color={C.accentInk}>{contNou.parola}</Txt>}
              </Box>
              <Btn label="Gata" variant="secondary" onPress={() => { setActiune(null); setContNou(null); setNumeNou(""); setTelefonNou(""); }} />
            </>
          ) : (
            <>
              <Txt size={12.5} color={C.muted}>
                Contul se face pe numărul de telefon al omului. Sistemul alege parola și ți-o arată o singură dată.
              </Txt>
              <Field label="Numele locatarului" value={numeNou} onChange={setNumeNou} placeholder="Prenume și nume" />
              <Field label="Numărul lui de telefon" value={telefonNou} onChange={setTelefonNou} placeholder="07xx xxx xxx" inputMode="tel" />
              <Picker label="Ce este pentru apartament" value={calitateNoua} onChange={setCalitateNoua} options={CALITATI} />
              <Eroare mesaj={eroare} />
              <Box row gap={S.sm}>
                <Btn
                  label="Fă contul"
                  disabled={!numeNou.trim() || !normalizeazaTelefon(telefonNou)}
                  onPress={async () => {
                    setEroare(null);
                    const r = await adaugaLocatar(ap.id, { nume: numeNou.trim(), telefon: telefonNou.trim(), calitate: calitateNoua });
                    if (r.ok) setContNou(r.rezultat); else setEroare(r.mesaj);
                  }}
                />
                <Btn label="Renunță" variant="secondary" onPress={() => { setActiune(null); setEroare(null); }} />
              </Box>
            </>
          )}
        </Card>
      ) : actiune === "fisa" ? (
        <Card gap={S.md}>
          <Txt size={14} weight={700}>Corectează datele apartamentului</Txt>
          <Field label="Proprietar" value={proprietarEd} onChange={setProprietarEd} placeholder="Numele proprietarului" />
          <Box row gap={S.sm}>
            <Box flex={1}><Field label="Etaj" value={etajEd} onChange={setEtajEd} placeholder="0 pentru parter" inputMode="numeric" /></Box>
            <Box flex={1}><Field label="Suprafață" value={mpEd} onChange={setMpEd} placeholder="0,0" suffix="mp" inputMode="decimal" /></Box>
          </Box>
          <Field
            label="Cotă indiviză"
            value={cotaEd}
            onChange={setCotaEd}
            placeholder="0,00"
            suffix="%"
            inputMode="decimal"
            hint="O corecție mică se salvează direct, cât timp suma cotelor blocului rămâne 100%."
          />
          <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.md }}>
            <Txt size={13} weight={600}>Scutit de plata liftului</Txt>
            <Switch value={scutitLiftEd} onChange={setScutitLiftEd} label="Scutit de plata liftului" />
          </Box>
          <Eroare mesaj={eroare} />
          <Box row gap={S.sm}>
            <Btn label="Salvează corecția" disabled={!fisaValida} onPress={async () => {
              setEroare(null);
              const r = await schimbaFisaApartament(ap.id, {
                proprietar: proprietarEd.trim(), cota: numarDin(cotaEd), mp: mpEd === "" ? null : numarDin(mpEd),
                scutitLift: scutitLiftEd, etaj: numarDin(etajEd),
              });
              if (r.ok) setActiune(null); else setEroare(r.mesaj);
            }} />
            <Btn label="Renunță" variant="secondary" onPress={() => setActiune(null)} />
          </Box>
          <Btn
            label="Redistribuie cotele întregului bloc"
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
            Cotele tuturor apartamentelor trebuie să însumeze 100%. Corectează câte apartamente e nevoie, apoi salvează o singură dată.
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
            <Btn label="Salvează cotele blocului" disabled={!coteValide} onPress={async () => {
              setEroare(null);
              const r = await schimbaCoteleBlocului(apOrdine.map((a) => ({ apartamentId: a.id, cota: numarDin(coteBloc[a.id]) })));
              if (r.ok) setActiune(null); else setEroare(r.mesaj);
            }} />
            <Btn label="Renunță" variant="secondary" onPress={() => setActiune(null)} />
          </Box>
        </Card>
      ) : verifica ? null : (
        <Box gap={S.sm}>
          {/* [T1] Greseala de casierie se repara aici: incasarile scrise luna
              aceasta se pot anula, cu motiv scris. Cele mai vechi nu: lunile
              inchise nu se mai clintesc. */}
          {incasariDeLuna.length > 0 && (
            <Card pad={0}>
              <Box style={{ padding: S.md }} gap={2}>
                <Eyebrow>Încasări scrise luna aceasta</Eyebrow>
              </Box>
              {incasariDeLuna.map((p, i) => (
                <Box key={p.id}>
                  {i > 0 && <Line />}
                  <Box style={{ padding: S.md }} gap={S.sm}>
                    <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
                      <Box gap={2} flex={1}>
                        <Txt size={13} weight={600}>{lei(p.suma)}, {p.metoda === "numerar" ? "numerar" : "transfer"}</Txt>
                        <Txt size={11.5} color={C.muted}>
                          {dataRo(p.confirmataLa)}{p.chitanta ? ` · chitanța ${numarChitanta(p.chitanta)}` : ""}
                        </Txt>
                      </Box>
                      {esteStornata(p)
                        ? <Badge label="Anulată" tone="danger" />
                        : <Btn label="Stornează încasarea" size="sm" variant="secondary" onPress={() => { setDeStornat(p.id); setMotivStornare(""); setEroare(null); setActiune("stornare"); }} />}
                    </Box>
                    {esteStornata(p) && <Txt size={12} color={C.muted}>{p.motivStornare}</Txt>}
                  </Box>
                </Box>
              ))}
            </Card>
          )}
          <Btn label="Înregistrează încasare cash" full onPress={() => { setSumaIncasata(s > 0 ? lei(s, false) : ""); setActiune("incasare"); }} />
          <Btn label="Trimite înștiințare de plată" variant="secondary" full disabled={restanta(date, ap.id) <= 0} onPress={async () => {
            const r = await trimiteInstiintare(ap.id);
            if (r.ok) toastMsg(r.rezultat.destinatari ? "Înștiințarea a fost trimisă în aplicație" : "Apartamentul nu are cont în aplicație. Înștiințarea se dă pe hârtie.");
          }} />
          <Btn label="Modifică numărul de persoane" variant="secondary" full onPress={() => { setDinLuna(luniViitoare[0] || ""); setActiune("persoane"); }} />
          <Btn label="Adaugă un locatar în aplicație" variant="secondary" full onPress={() => { setContNou(null); setEroare(null); setActiune("cont"); }} />
          <Btn
            label="Corectează datele apartamentului"
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
            <Eyebrow>Defalcarea întreținerii, {monthLabel(lista.luna)}</Eyebrow>
            <Txt size={11.5} color={C.muted}>Exact ce vede locatarul. Apasă pe un rând pentru calcul.</Txt>
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
        <Eyebrow>Consum apă</Eyebrow>
        {istoricConsum(date, ap.id).slice(-3).reverse().map((x) => (
          <RandCalcul key={x.luna} st={`${monthLabel(x.luna)}${x.estimat ? " (estimat)" : ""}`} dr={`rece ${x.rece == null ? "-" : num(x.rece)} · caldă ${x.calda == null ? "-" : num(x.calda)} mc`} />
        ))}
        {date.contoare.filter((c) => c.apartamentId === ap.id).map((c) => {
          const x = citireLuna(date, c.id, lunaCitire);
          return <RandCalcul key={c.id} st={`${c.tip === "rece" ? "Apa rece" : "Apa caldă"}, ${monthLabel(lunaCitire)}`} dr={x ? `${num(x.indexCurent, 1)} (${x.stare})` : "netransmis"} />;
        })}
      </Card>

      <Card gap={S.sm} pad={S.md}>
        <Eyebrow>Istoricul persoanelor</Eyebrow>
        {ap.istoricPersoane.map((p) => (
          <RandCalcul key={p.valabilDin} st={`Din ${monthLabel(p.valabilDin)}${p.motiv ? `, ${p.motiv.toLowerCase()}` : ""}`} dr={`${p.numar} pers.`} />
        ))}
      </Card>

      <Card gap={S.sm} pad={S.md}>
        <Eyebrow>Locatari cu cont în aplicație</Eyebrow>
        {ap.locatari.filter((l) => !l.activPana).length === 0 && <Txt size={12.5} color={C.muted}>Nimeni din apartament nu are încă cont.</Txt>}
        {ap.locatari.filter((l) => !l.activPana).map((l) => (
          <Box key={l.id} row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
            <Box flex={1} gap={1}>
              <Txt size={13} weight={600}>{l.nume}</Txt>
              <Txt size={11.5} color={C.muted}>{etichetaCalitate(l.calitate)} · din {dataRo(l.activDin)}{l.telefon ? ` · ${telefonAfisat(l.telefon)}` : ""}</Txt>
            </Box>
            {verifica ? null : (
            <Box row gap={S.xs}>
              <Btn label="Parola nouă" size="sm" variant="secondary" onPress={async () => {
                const r = await parolaNoua(ap.id, l.id);
                if (!r.ok) return;
                setContNou({ telefon: l.telefon, parola: r.rezultat.parola });
                setActiune("cont");
              }} />
              <Btn label="Închide accesul" size="sm" variant="danger" onPress={async () => {
                if (await confirma(`Închizi accesul lui ${l.nume} la apartamentul ${ap.numar}? Istoricul rămâne.`)) await inchideAcces(l.id);
              }} />
            </Box>
            )}
          </Box>
        ))}
        {ap.locatari.filter((l) => l.activPana).map((l) => (
          <Txt key={l.id} size={11.5} color={C.muted}>{l.nume}, acces închis pe {dataRo(l.activPana)}</Txt>
        ))}
      </Card>
    </Sheet>
  );
}

function AdminCitiri() {
  const { date, valideazaCitire, valideazaCitiriApartament, citesteContorGeneral, estimeazaCitiri, toastMsg } = useApp();
  const verifica = doarVerifica(date);
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
        <Kpi eticheta="De verificat" valoare={String(deVerificat.length)} sub="cu poza atașată" tone={deVerificat.length ? C.warn : C.ink} />
      </Box>

{!verifica && (
      <Card gap={S.md}>
        <Titlu sub="Contorul de la subsol, citit de administrator">Contorul general al blocului</Titlu>
        {contoareGen.map((c) => {
          const x = citireLuna(date, c.id, luna);
          const anterior = ultimIndexValabil(date, c.id, luna);
          const v = general[c.id] || "";
          const n = numarDin(v);
          return (
            <Box key={c.id} gap={S.xs}>
              <RandCalcul st={`${c.tip === "rece" ? "Apa rece" : "Apa caldă"}, index anterior ${num(anterior, 1)}`} dr={x ? `${num(x.indexCurent, 1)}, consum ${num(x.consum)} mc` : "necitit"} />
              <Box row gap={S.sm} style={{ alignItems: "flex-end" }}>
                <Box flex={1}>
                  <Field value={v} onChange={(t) => setGeneral({ ...general, [c.id]: t })} placeholder={x ? "Corectează indexul" : "Index nou"} inputMode="decimal"
                    hint={v !== "" && !Number.isNaN(n) && n >= anterior ? `Consum ${num(n - anterior)} mc` : null}
                    eroare={v !== "" && (Number.isNaN(n) || n < anterior) ? "Indexul nu poate fi mai mic decât cel anterior." : null} />
                </Box>
                <Btn label="Salvează" size="sm" disabled={v === "" || Number.isNaN(n) || n < anterior} onPress={async () => {
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
      )}

      {transmise < apartamente.length && (
        <Card gap={S.sm} pad={S.md} style={{ backgroundColor: C.warnSoft, borderColor: C.warnLine }}>
          <Txt size={13} weight={700} color={C.warn}>{apartamente.length - transmise} apartamente nu au transmis indexul</Txt>
          <Txt size={12} color={C.inkSoft}>După termen, le poți completa cu consumul estimat pe media ultimelor trei luni. Estimarea apare ca atare pe lista locatarului.</Txt>
          {!verifica && (
            <Btn label="Estimează citirile lipsă" size="sm" variant="secondary" onPress={async () => {
              if (!await confirma("Completezi cu estimare toate citirile netransmise pe această lună?")) return;
              const r = await estimeazaCitiri(luna);
              if (r.ok) toastMsg(`Au fost estimate ${r.rezultat.estimate} citiri`);
            }} />
          )}
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
                    <Txt size={12} color={C.inkSoft}>{contor.tip === "rece" ? "Rece" : "Caldă"}{citire ? `: ${num(citire.indexAnterior, 1)} → ${num(citire.indexCurent, 1)}, ${num(citire.consum)} mc` : ""}</Txt>
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
              {!verifica && x.contoare.some((c) => c.citire && c.citire.stare === "trimisa") && (
                <Box row gap={S.sm}>
                  <Btn label="Valideaza" size="sm" onPress={async () => { await valideazaCitiriApartament(x.ap.id, luna, true, null); }} />
                  <Btn label="Respinge" size="sm" variant="danger" onPress={() => { setRespinge(x); setMotiv(""); }} />
                </Box>
              )}
              {!verifica && !x.contoare.some((c) => c.citire && c.citire.stare === "trimisa") && validateDeRespins(x).length > 0 && (
                <Btn label="Respinge citirea validată" size="sm" variant="secondary" onPress={() => { setRespinge({ ...x, validate: validateDeRespins(x) }); setMotiv(""); }} />
              )}
            </Box>
          </Box>
        ))}
      </Card>

      <Sheet open={!!respinge} onClose={() => setRespinge(null)} titlu={respinge ? `Respinge citirea, ap. ${respinge.ap.numar}` : ""} pazit={areText(motiv)}>
        {respinge && respinge.validate && (
          <Txt size={12.5} color={C.inkSoft}>Citirea a fost deja validată. Dacă indexul este greșit, respinge-o: lista lunii nu s-a publicat încă, deci se mai poate corecta.</Txt>
        )}
        <Txt size={12.5} color={C.inkSoft}>Locatarul primește motivul în aplicație și poate trimite din nou indexul cu o poză nouă.</Txt>
        <Box row gap={S.xs} style={{ flexWrap: "wrap" }}>
          {["Poza este neclară, nu se văd cifrele.", "Indexul nu corespunde cu poza.", "Poza nu arată contorul apartamentului."].map((m) => (
            <Press key={m} onPress={() => setMotiv(m)} apasat={motiv === m} style={{ padding: "7px 10px", borderRadius: R.pill, border: `1px solid ${motiv === m ? C.accent : C.lineStrong}`, backgroundColor: motiv === m ? C.accentSoft : C.surface }}>
              <Txt size={12}>{m}</Txt>
            </Press>
          ))}
        </Box>
        <Field label="Motivul" value={motiv} onChange={setMotiv} multiline placeholder="Ce trebuie să corecteze locatarul" />
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
    <Sheet open={open} onClose={onClose} titlu={cheltuiala ? "Modifică factura" : "Factură nouă"} pazit={areText(categorie, sumaText, furnizorNou, serie)}>
      <Picker
        label="Furnizor"
        value={furnizorId}
        onChange={alegeFurnizor}
        options={[{ value: "", label: "Alege furnizorul..." }, ...furnizori.map((f) => ({ value: f.id, label: f.denumire }))]}
      />
      {!furnizorId && <Field label="Sau scrie un furnizor nou" value={furnizorNou} onChange={setFurnizorNou} placeholder="Numele firmei" />}
      <Field label="Ce cheltuială este" value={categorie} onChange={setCategorie} placeholder="Apa rece, salubritate, lift" />
      <Box row gap={S.sm}>
        <Box flex={2}><Field label="Suma facturii" value={sumaText} onChange={setSumaText} placeholder="0,00" suffix="lei" inputMode="decimal" /></Box>
        <Box flex={1}><Field label="Cod pe lista" value={cod} onChange={setCod} placeholder={codLiber()} eroare={dublura ? "Codul există deja" : null} /></Box>
      </Box>
      <Picker
        label="Cum se împarte"
        value={metoda}
        onChange={setMetoda}
        options={Object.entries(METODE).map(([k, v]) => ({ value: k, label: v.eticheta }))}
      />
      {metoda === "consum" && (
        <Segment value={tipApa} onChange={setTipApa} options={[{ value: "rece", label: "Apa rece" }, { value: "calda", label: "Apa caldă" }]} />
      )}
      <Card pad={S.md} gap={S.xs} style={{ backgroundColor: C.paperDeep, borderColor: C.lineStrong }}>
        <Txt size={12} color={C.inkSoft}>{METODE[metoda].explic}</Txt>
      </Card>
      <Field label="Serie și număr factură" value={serie} onChange={setSerie} placeholder="ACA-448120" />
      <Box row gap={S.sm}>
        <Box flex={1}><Field label="Emisă pe" value={emisa} onChange={setEmisa} type="date" /></Box>
        <Box flex={1}><Field label="Scadență furnizor" value={scadenta} onChange={setScadenta} type="date" /></Box>
      </Box>
      <Box row gap={S.sm} style={{ alignItems: "center" }}>
        <AlegeFisier label={fisier ? "Alt fișier" : "Atașează factura scanată"} accept="image/*,application/pdf" onAles={async (f) => setFisier(await micsoreazaPoza(f))} size="sm" />
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
              <RandCalcul st="Total împărțit" dr={lei(previzualizare.total)} bold />
            </>
          )}
          <Txt size={11} color={C.muted}>Nimic nu se salvează și locatarii nu văd nimic până la publicarea listei.</Txt>
        </Card>
      )}

      <Btn label={lucreaza ? "Se salvează..." : "Salvează factura"} full size="lg" disabled={!valid || lucreaza} onPress={salveaza} />
    </Sheet>
  );
}

function AdminFacturi() {
  const { date, deschideLista, stergeCheltuiala, publicaLista, marcheazaFacturaPlatita, dateMotor, deschideDocument } = useApp();
  const verifica = doarVerifica(date);
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
        eyebrow={lista ? `${monthLabel(lista.luna)} · ${lista.stare === "ciorna" ? "în lucru" : "publicată"}` : "Facturi"}
        titlu="Facturi și liste"
        dreapta={esteCiorna && !verifica ? <Btn label="Adaugă factură" size="sm" onPress={() => setFactura({})} /> : null}
      />

      {date.liste.length > 0 && <AlegeLuna liste={date.liste} value={listaId} onChange={(id) => { setListaId(id); setPreviz(null); }} />}

      {!listaCiorna(date) && (
        <Card gap={S.sm} pad={S.md}>
          <Txt size={13} weight={700}>Lista pe {monthLabel(lunaNoua)} nu este începută</Txt>
          <Txt size={12} color={C.muted}>Lista nouă pornește cu fondul de reparații deja completat. Adaugi facturile pe măsură ce vin.</Txt>
          {!verifica && <Btn label={`Începe lista pe ${monthLabel(lunaNoua)}`} size="sm" onPress={async () => { const r = await deschideLista(lunaNoua); if (r.ok) setListaId(r.rezultat); }} />}
        </Card>
      )}

      {lista && (
        <>
          {esteCiorna ? (
            <Card gap={S.sm} style={{ backgroundColor: C.infoSoft, borderColor: C.infoSoft }}>
              <Txt size={13} weight={700} color={C.info}>Lista în lucru, locatarii nu o văd încă</Txt>
              <Txt size={12} color={C.info}>
                Adaugă facturile lunii, verifică previzualizarea și publică. După publicare, sumele nu se mai schimbă; o corectura se face doar printr-o recalculare, vizibila pentru locatari.
              </Txt>
              {deVerificat > 0 && (
                <Txt size={12} color={C.warn} weight={600}>
                  {deVerificat === 1
                    ? "Mai este o citire de verificat. Lista se publică după ce o validezi sau o respingi, din Apartamente, la Citiri contoare."
                    : `Mai sunt ${plural(deVerificat, "citire", "citiri")} de verificat. Lista se publică după ce le validezi sau le respingi, din Apartamente, la Citiri contoare.`}
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
              <RandCalcul st="Total facturi și fonduri" dr={lei(totalFacturi)} />
              <RandCalcul st={`Total repartizat pe ${lista.apartamente} apartamente`} dr={lei(lista.totalRepartizat)} />
              <Line style={{ backgroundColor: C.accentLine }} />
              <RandCalcul st="Nealocat" dr={lei(totalFacturi - lista.totalRepartizat)} bold />
              <Txt size={11.5} color={C.accentInk}>Publicată pe {dataLunga(lista.publicataLa)}, termen de plată {dataLunga(lista.scadenta)}.</Txt>
            </Card>
          )}

          {cheltuieli.length === 0 ? (
            <Gol titlu="Nicio cheltuială" text="Adaugă prima factură a lunii." actiune={esteCiorna && !verifica ? <Btn label="Adaugă factură" size="sm" onPress={() => setFactura({})} /> : null} />
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
                        <Badge label={`Plătită furnizorului ${dataRo(c.achitataLa)}`} tone="ok" />
                      ) : (
                        <Badge label={c.scadentaFurnizor ? `De plătit până ${dataRo(c.scadentaFurnizor)}` : "Neplătită furnizorului"} tone="warn" />
                      )}
                    </Box>
                    <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
                      {c.documentId && <Btn label="Vezi factura" size="sm" variant="secondary" onPress={() => deschideDocument(c.documentId)} />}
                      {c.tip === "factura" && !verifica && (
                        <Btn label={c.achitataLa ? "Anulează plata furnizor" : "Marchează plătită"} size="sm" variant={c.achitataLa ? "quiet" : "secondary"} onPress={async () => {
                          /* [F25] Anularea sterge o informatie: se intreaba intai */
                          if (c.achitataLa && !await confirma(`Anulezi plata către ${c.furnizor} pentru ${c.categorie}?`)) return;
                          marcheazaFacturaPlatita(c.id, !c.achitataLa);
                        }} />
                      )}
                      {esteCiorna && !verifica && c.tip === "factura" && <Btn label="Modifică" size="sm" variant="secondary" onPress={() => setFactura({ cheltuiala: c })} />}
                      {esteCiorna && !verifica && c.tip === "factura" && <Btn label="Șterge" size="sm" variant="danger" onPress={async () => { if (await confirma(`Ștergi ${c.categorie}?`)) stergeCheltuiala(c.id); }} />}
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

          {/* [C9] Previzualizarea trece prin intretinere.date_pentru_motor, care
              este si paza Edge Function-ului publica-lista, deci cere blocul
              administrat: pentru conducere butonul dadea doar un mesaj tehnic.
              Ce s-a publicat deja se vede oricum, la fiecare apartament. */}
          {esteCiorna && !verifica ? (
            <Card gap={S.md}>
              <Titlu sub="Motorul calculează pe loc, fără să salveze nimic">Previzualizarea listei</Titlu>
              <Btn label="Calculează lista pe apartamente" variant="secondary" onPress={calculeazaPreviz} disabled={cheltuieli.length === 0} />
              {previz && previz.probleme && (
                <Box gap={S.xs}>
                  <Txt size={12.5} weight={700} color={C.warn}>Lista nu se poate calcula încă:</Txt>
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
              {!verifica && <Btn label="Publică lista" full size="lg" disabled={cheltuieli.length === 0 || lucreaza} onPress={() => setConfirmPublica(true)} />}
            </Card>
          ) : (
            <Card gap={S.sm}>
              <Titlu sub="Lista de la avizier, cu toate apartamentele">Exportă lista</Titlu>
              <Txt size={12.5} color={C.inkSoft}>PDF-ul are aceleași cifre ca aplicația: fiecare sumă vine din repartizarea salvată la publicare.</Txt>
              {/* [C8/X01] Varianta pentru avizier nu are nume, restante sau
                  penalizari: e pentru casa scarii, nu un tabel de datornici.
                  Varianta cu nume ramane, dar separata si marcata intern. */}
              <Btn label="Exportă PDF pentru avizier" size="sm" onPress={() => descarcaPdf(listaPdf(date, lista.id), `lista-plata-${lista.luna}.pdf`)} />
              <Line />
              <Txt size={12.5} color={C.inkSoft}>Varianta de uz administrativ, cu proprietari și restanțe. Nu se afișează în casa scării.</Txt>
              <Btn label="Exportă lista internă (uz administrativ)" size="sm" variant="secondary" onPress={() => descarcaPdf(listaPdfIntern(date, lista.id), `lista-plata-${lista.luna}-uz-intern.pdf`)} />
            </Card>
          )}
        </>
      )}

      <SheetFactura open={!!factura} onClose={() => setFactura(null)} lista={esteCiorna ? lista : null} cheltuiala={factura && factura.cheltuiala} />

      <Sheet open={confirmPublica} onClose={() => { setConfirmPublica(false); setEroare(null); }} titlu="Publică lista">
        {lista && (
          <>
            <Txt size={14}>Publici lista pe {monthLabel(lista.luna)}, cu {cheltuieli.length} cheltuieli în valoare de {lei(totalFacturi)}.</Txt>
            <Txt size={12.5} color={C.inkSoft}>
              Locatarii o văd imediat, fiecare cu calculul lui. Termenul de plată va fi {dataLunga(lista.scadenta || `${lunaUrmatoare(lista.luna)}-${pad2(date.setari.ziScadenta)}`)}. După publicare, facturile listei nu se mai pot modifica.
            </Txt>
            <Eroare mesaj={eroare} />
            <Btn label={lucreaza ? "Se publică..." : "Da, publică lista"} full size="lg" disabled={lucreaza} onPress={async () => {
              setLucreaza(true);
              setEroare(null);
              const r = await publicaLista(lista.id);
              setLucreaza(false);
              if (r.ok) { setConfirmPublica(false); setPreviz(null); } else setEroare(r.mesaj);
            }} />
            <Btn label="Înapoi" variant="secondary" full onPress={() => setConfirmPublica(false)} />
          </>
        )}
      </Sheet>
    </Box>
  );
}

function AdminSesizari() {
  const { date, preiaSesizare, rezolvaSesizare, scrieMesaj } = useApp();
  const verifica = doarVerifica(date);
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
      <AntetEcran eyebrow={`${date.sesizari.filter((x) => x.stare !== "rezolvata").length} deschise`} titlu="Sesizări" />

      {/* [C1] Ce a scris un om despre casa lui ramane intre el si
          administrator. Conducerea vede ca s-a reclamat si in ce stadiu este,
          fara apartament, fara text si fara poze. */}
      {verifica && (
        <Card gap={S.xs}>
          <Txt size={13} weight={700}>Le vezi fără nume</Txt>
          <Txt size={12.5} color={C.inkSoft}>
            Sesizarea este între locatar și administrator. Tu vezi ce s-a reclamat și dacă a fost rezolvată, nu și apartamentul, textul sau pozele.
          </Txt>
        </Card>
      )}

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
        <Gol titlu="Nimic aici" text="Nu există sesizări care să corespundă filtrului ales." />
      ) : (
        <Box gap={S.sm}>
          {vizibile.map((x) => (
            <Press key={x.id} onPress={() => { setSelectata(x.id); setText(""); }} label={x.titlu}>
              <Card pad={S.md} gap={S.sm}>
                <Box row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: S.sm }}>
                  <Box gap={2} flex={1}>
                    <Txt size={13.5} weight={600}>{x.titlu}</Txt>
                    <Txt size={11.5} color={C.muted}>
                      {x.apartamentNumar ? `Ap. ${x.apartamentNumar} · ` : ""}{etichetaCategorie(x.categorie)} · {dataRo(x.creataLa)}
                    </Txt>
                  </Box>
                  <StareBadge stare={x.stare} />
                </Box>
                {x.descriere && <Txt size={12.5} color={C.inkSoft} randuri={2}>{x.descriere}</Txt>}
                {x.stare !== "rezolvata" && (
                  <Txt size={11.5} weight={700} color={asteapta(x) > 3 ? C.danger : C.warn}>
                    {asteapta(x) === 0 ? "Trimisă azi" : `Așteaptă de ${pluralZile(asteapta(x))}`}
                  </Txt>
                )}
              </Card>
            </Press>
          ))}
        </Box>
      )}

      <Sheet open={!!s} onClose={() => setSelectata(null)} titlu={s ? (s.apartamentNumar ? `Ap. ${s.apartamentNumar}` : etichetaCategorie(s.categorie)) : ""}>
        {s && (
          <>
            <Card gap={S.sm}>
              <Box row gap={S.sm}><StareBadge stare={s.stare} /><Badge label={etichetaCategorie(s.categorie)} /></Box>
              <Txt size={16} weight={700}>{s.titlu}</Txt>
              {s.descriere
                ? <Txt size={13} color={C.inkSoft}>{s.descriere}</Txt>
                : <Txt size={13} color={C.muted}>Textul sesizării îl vede doar administratorul.</Txt>}
              <Txt size={11.5} color={C.muted}>
                Trimisă pe {dataLunga(s.creataLa)}, ora {oraRo(s.creataLa)}
                {s.preluataLa ? `. Preluată pe ${dataRo(s.preluataLa)}` : ""}
                {s.rezolvataLa ? `. Rezolvată pe ${dataRo(s.rezolvataLa)}` : ""}
              </Txt>
              {s.poze.length > 0 && (
                <Box row gap={S.xs}>
                  {s.poze.map((p) => <PozaStocata key={p.id} cale={p.cale} latime={72} inaltime={72} />)}
                </Box>
              )}
            </Card>

            {s.mesaje.length > 0 && (
              <Card gap={S.sm}>
                <Eyebrow>Conversația</Eyebrow>
                {s.mesaje.map((m) => (
                  <Box key={m.id} style={{ borderLeftWidth: 2, borderLeftStyle: "solid", borderLeftColor: m.dinAdministratie ? C.accent : C.lineStrong, paddingLeft: S.sm }} gap={2}>
                    <Eyebrow color={m.dinAdministratie ? C.accent : C.muted}>{m.dinAdministratie ? "Administrație" : m.autor} · {dataRo(m.la)} {oraRo(m.la)}</Eyebrow>
                    <Txt size={12.5} color={C.inkSoft}>{m.text}</Txt>
                  </Box>
                ))}
              </Card>
            )}

            {s.stare !== "rezolvata" && !verifica && (
              <>
                <Field label="Răspuns pentru proprietar" value={text} onChange={setText} multiline placeholder="Ce se întâmplă și până când" />
                <Btn label="Trimite răspunsul" full onPress={async () => { const r = await scrieMesaj(s.id, text); if (r.ok) setText(""); }} disabled={!text.trim()} />
                <Box gap={S.sm}>
                  <Eyebrow>Schimbă starea</Eyebrow>
                  <Box row gap={S.sm}>
                    {s.stare === "noua" && <Btn label="Preiau sesizarea" size="sm" variant="secondary" onPress={() => preiaSesizare(s.id)} />}
                    <Btn label="Marchează rezolvată" size="sm" onPress={async () => { const r = await rezolvaSesizare(s.id); if (r.ok) setSelectata(null); }} />
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
  const {
    date, publicaAnunt, seteazaReminder, trimiteReminder, deschideVot, reamintesteVot, convoacaAdunare,
    incarcaDocument, deschideDocument, numesteInConducere, adaugaInConducere, incheieMandat, toastMsg,
  } = useApp();
  const verifica = doarVerifica(date);
  const [tab, setTab] = useState(parametri && parametri.tab ? parametri.tab : "anunturi");
  const [sheet, setSheet] = useState(null);
  const [titlu, setTitlu] = useState("");
  const [corp, setCorp] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [optiuni, setOptiuni] = useState(["", ""]);
  const [inchideLa, setInchideLa] = useState("");
  const [numarare, setNumarare] = useState("apartament");
  /* Conducerea asociatiei: pe cine numim, in ce rol, si contul lui cand e din
     afara blocului (parola se arata o singura data). */
  const [rolNou, setRolNou] = useState("presedinte");
  const [peCine, setPeCine] = useState("");
  const [numeNou, setNumeNou] = useState("");
  const [telefonNou, setTelefonNou] = useState("");
  const [contNou, setContNou] = useState(null);
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
          { value: "anunturi", label: "Anunțuri" },
          { value: "remindere", label: "Remindere" },
          { value: "vot", label: "Vot și AG" },
          { value: "conducere", label: "Conducere" },
          { value: "acte", label: "Acte" },
        ]}
      />

      {tab === "anunturi" && (
        <Box gap={S.sm}>
          {!verifica && <Btn label="Scrie un anunț" full onPress={() => deschide("anunt")} />}
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
            Reminderele pleacă automat, ca notificare în aplicație, către locatarii cu cont. Pentru cei fără aplicație, înștiințarea rămâne pe hârtie.
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
                      {!verifica && <Switch value={r.activ} label={info.nume} onChange={(v) => seteazaReminder(r.tip, v, r.zile)} />}
                    </Box>
                    {!verifica && r.tip !== "lista_publicata" && r.activ && (
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
          {/* [C9] Conducerea nu trimite remindere: comanda cere blocul
              administrat, deci butonul nu facea decat sa dea un mesaj tehnic. */}
          {!verifica && (
          <Card gap={S.sm} pad={S.md}>
            <Eyebrow>Trimite acum</Eyebrow>
            <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
              {ORDINE_REMINDERE.filter((t) => REMINDERE_INFO[t].trimiteAcum).map((t) => (
                <Btn key={t} label={REMINDERE_INFO[t].buton} size="sm" variant="secondary" onPress={async () => {
                  const r = await trimiteReminder(t);
                  if (r.ok) toastMsg(`Trimis către ${plural(r.rezultat.destinatari, "locatar", "locatari")} cu cont, din ${plural(r.rezultat.apartamente, "apartament vizat", "apartamente vizate")}`);
                }} />
              ))}
            </Box>
          </Card>
          )}
        </Box>
      )}

      {tab === "vot" && (
        <Box gap={S.md}>
          {!verifica && (
            <Box row gap={S.sm}>
              <Btn label="Deschide un vot nou" size="sm" onPress={() => deschide("vot")} />
              <Btn label="Convoacă adunarea" size="sm" variant="secondary" onPress={() => deschide("adunare")} />
            </Box>
          )}
          {date.voturi.map((v) => {
            const deschis = new Date(v.inchideLa) > new Date();
            return (
              <Card key={v.id} gap={S.md}>
                <Box gap={3}>
                  <Badge label={deschis ? "Deschis" : "Închis"} tone={deschis ? "accent" : "neutral"} />
                  <Txt size={16} weight={700}>{v.titlu}</Txt>
                  <Txt size={12.5} color={C.muted}>Deschis pe {dataRo(v.deschisLa)}, se închide pe {dataRo(v.inchideLa)}</Txt>
                </Box>
                <Line />
                <RezultateVot vot={v} />
                <Box gap={S.xs}>
                  <Box row style={{ justifyContent: "space-between" }}>
                    <Txt size={12.5} color={C.inkSoft}>Prezența la vot</Txt>
                    <Txt size={12.5} weight={700} mono>{v.votanti} din {v.totalApartamente}</Txt>
                  </Box>
                  <Bar value={(v.votanti / Math.max(1, v.totalApartamente)) * 100} height={8} />
                  {v.nevotate && v.nevotate.length > 0 && <Txt size={11.5} color={C.muted}>Nu au votat: ap. {v.nevotate.join(", ")}</Txt>}
                </Box>
                {!verifica && deschis && v.nevotate && v.nevotate.length > 0 && (
                  <Btn label="Reamintește celor care nu au votat" size="sm" variant="secondary" onPress={async () => {
                    const r = await reamintesteVot(v.id);
                    if (r.ok) toastMsg(`Reminder trimis către ${plural(r.rezultat.destinatari, "locatar", "locatari")} cu cont, din ${plural(r.rezultat.apartamente, "apartament", "apartamente")}`);
                  }} />
                )}
              </Card>
            );
          })}
          {date.adunari.map((a) => (
            <Card key={a.id} gap={S.sm}>
              <Titlu sub={`${a.loc}, ora ${oraRo(a.dataOra)}`}>Adunarea generală din {dataLunga(a.dataOra)}</Titlu>
              <Txt size={12.5} color={C.inkSoft}>{a.ordineDeZi}</Txt>
              <Txt size={12} color={C.muted}>Au confirmat prezența {a.prezente} din {a.totalApartamente} apartamente.</Txt>
            </Card>
          ))}
        </Box>
      )}

      {tab === "conducere" && (
        <Box gap={S.sm}>
          <Txt size={12.5} color={C.muted}>
            Adunarea generală alege președintele și cenzorul; tu treci aici ce s-a hotărât. Ei văd tot blocul,
            dar nu pot schimbă nimic: nu încasează, nu publică liste și nu corectează fise.
          </Txt>

          {contNou && (
            <Card gap={S.sm} style={{ backgroundColor: C.accentSoft, borderColor: C.accentSoft }}>
              <Txt size={13} color={C.accentInk}>
                {contNou.parola
                  ? `Contul este gata. Intră cu numărul ${telefonAfisat(contNou.telefon)} și parola de mai jos; dă-i-le pe hârtie sau la telefon.`
                  : `Persoana avea deja cont pe numărul ${telefonAfisat(contNou.telefon)}. Intră cu parola pe care o știe; dacă nu o mai știe, i-o schimbă administratorul de pe fișa apartamentului.`}
              </Txt>
              {contNou.parola && <Txt size={22} weight={700} mono color={C.accentInk}>{contNou.parola}</Txt>}
              <Btn label="Gata" variant="secondary" size="sm" onPress={() => setContNou(null)} />
            </Card>
          )}

          <Card pad={0}>
            {date.conducere.length === 0 && (
              <Box style={{ padding: S.md }}>
                <Txt size={12.5} color={C.muted}>Nimeni nu are încă mandat de președinte sau de cenzor.</Txt>
              </Box>
            )}
            {date.conducere.map((m, i) => (
              <Box key={m.id}>
                {i > 0 && <Line />}
                <Box row style={{ padding: S.md, alignItems: "center", gap: S.sm }}>
                  <Box flex={1} gap={2}>
                    <Txt size={13} weight={600}>{m.nume}</Txt>
                    <Txt size={11.5} color={C.muted}>
                      {m.rol === "presedinte" ? "Președinte" : "Cenzor"} · din {dataRo(m.activDin)}
                      {m.activPana ? `, până pe ${dataRo(m.activPana)}` : ""}
                      {m.telefon ? ` · ${telefonAfisat(m.telefon)}` : ""}
                    </Txt>
                  </Box>
                  {m.activPana
                    ? <Badge label="Încheiat" tone="neutral" />
                    : verifica ? null : (
                      <Btn label="Încheie mandatul" size="sm" variant="danger" onPress={async () => {
                        if (await confirma(`Încheii mandatul lui ${m.nume}? Istoricul rămâne.`)) await incheieMandat(m.id);
                      }} />
                    )}
                </Box>
              </Box>
            ))}
          </Card>

          {!verifica && <Btn label="Numește un președinte sau un cenzor" full variant="secondary" onPress={() => deschide("conducere")} />}
        </Box>
      )}

      {tab === "acte" && (
        <Box gap={S.sm}>
          {!verifica && <Btn label="Încarcă un document" full onPress={() => deschide("document")} />}
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

      <Sheet open={sheet === "anunt"} onClose={() => setSheet(null)} titlu="Anunț nou" pazit={areText(titlu, corp)}>
        <Field label="Titlu" value={titlu} onChange={setTitlu} placeholder="Ce trebuie să știe proprietarii" />
        <Field label="Continut" value={corp} onChange={setCorp} multiline placeholder="Detalii, date, ore" />
        <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.md }}>
          <Box gap={2} flex={1}>
            <Txt size={13} weight={600}>Marchează ca urgent</Txt>
            <Txt size={11.5} color={C.muted}>Trimite și notificare imediat, tuturor locatarilor cu cont</Txt>
          </Box>
          <Switch value={urgent} onChange={setUrgent} label="Urgent" />
        </Box>
        <Btn label="Publică anunțul" full size="lg" disabled={!titlu.trim() || !corp.trim()} onPress={async () => cuRezultat(await publicaAnunt({ titlu, corp, urgent }))} />
      </Sheet>

      <Sheet open={sheet === "vot"} onClose={() => setSheet(null)} titlu="Vot nou" pazit={areText(titlu, corp, ...optiuni)}>
        <Field label="Ce se votează" value={titlu} onChange={setTitlu} placeholder="Înlocuirea ușii de la intrare" />
        <Field label="Detalii" value={corp} onChange={setCorp} multiline placeholder="Ofertele, costurile, de unde se plătesc" />
        <Eyebrow>Variantele de vot</Eyebrow>
        {optiuni.map((o, i) => (
          <Box key={i} row gap={S.sm} style={{ alignItems: "center" }}>
            <Box flex={1}>
              <Field value={o} onChange={(t) => setOptiuni(optiuni.map((x, j) => (j === i ? t : x)))} placeholder={`Varianta ${i + 1}`} />
            </Box>
            {/* [F3] O varianta in plus se scoate, dar un vot are nevoie de doua */}
            {optiuni.length > 2 && (
              <Btn label="Șterge varianta" variant="quiet" size="sm" onPress={() => setOptiuni(optiuni.filter((x, j) => j !== i))} />
            )}
          </Box>
        ))}
        {optiuni.length < 5 && <Btn label="Adaugă o variantă" size="sm" variant="quiet" onPress={() => setOptiuni([...optiuni, ""])} />}
        <Field label="Votul se închide pe" value={inchideLa} onChange={setInchideLa} type="date" />
        <Picker label="Cum se numără voturile" value={numarare} onChange={setNumarare} options={[{ value: "apartament", label: "Un vot pe apartament" }, { value: "cota", label: "Ponderat cu cotă indiviză" }]} />
        <Btn label="Deschide votul" full size="lg" disabled={!titlu.trim() || optiuni.filter((o) => o.trim()).length < 2 || !inchideLa} onPress={async () => cuRezultat(await deschideVot({ titlu, descriere: corp, optiuni, inchideLa, numarare }))} />
      </Sheet>

      <Sheet open={sheet === "adunare"} onClose={() => setSheet(null)} titlu="Convoacă adunarea generală" pazit={areText(dataAg, loc, corp)}>
        <Box row gap={S.sm}>
          <Box flex={2}><Field label="Data" value={dataAg} onChange={setDataAg} type="date" /></Box>
          <Box flex={1}><Field label="Ora" value={oraAg} onChange={setOraAg} type="time" /></Box>
        </Box>
        <Field label="Locul" value={loc} onChange={setLoc} placeholder="La parter, lângă boxe" />
        <Field label="Ordinea de zi" value={corp} onChange={setCorp} multiline placeholder="Ce se discută și ce se votează" />
        <Btn label="Trimite convocarea" full size="lg" disabled={!dataAg || !oraAg || !loc.trim() || !corp.trim()} onPress={async () => cuRezultat(
          await convoacaAdunare({ dataOra: instantRomania(dataAg, oraAg), loc, ordineDeZi: corp }),
          () => "Convocarea a fost trimisă locatarilor cu cont",
        )} />
      </Sheet>

      <Sheet open={sheet === "conducere"} onClose={() => setSheet(null)} titlu="Numește un președinte sau un cenzor" pazit={areText(numeNou, telefonNou)}>
        <Picker label="Mandatul" value={rolNou} onChange={setRolNou} options={[{ value: "presedinte", label: "Președinte" }, { value: "cenzor", label: "Cenzor" }]} />
        <Picker
          label="Cine"
          value={peCine}
          onChange={setPeCine}
          options={[
            { value: "", label: "Cineva din afara blocului" },
            ...oameniiBlocului(date).map((o) => ({ value: o.profilId, label: `${o.nume} (ap. ${o.apartament})` })),
          ]}
        />
        {peCine === "" && (
          <>
            <Txt size={12.5} color={C.muted}>
              Un cenzor poate fi si din afara blocului (un contabil, de exemplu). Ii facem cont pe numarul lui.
            </Txt>
            <Field label="Numele lui" value={numeNou} onChange={setNumeNou} placeholder="Prenume și nume" />
            <Field label="Numărul lui de telefon" value={telefonNou} onChange={setTelefonNou} placeholder="07xx xxx xxx" inputMode="tel" />
          </>
        )}
        <Btn
          label="Numește"
          full size="lg"
          disabled={peCine === "" && (!numeNou.trim() || !normalizeazaTelefon(telefonNou))}
          onPress={async () => {
            const r = peCine
              ? await numesteInConducere(peCine, rolNou)
              : await adaugaInConducere(numeNou.trim(), telefonNou.trim(), rolNou);
            if (!r.ok) return;
            setSheet(null);
            setNumeNou(""); setTelefonNou(""); setPeCine("");
            if (r.rezultat && r.rezultat.telefon) setContNou({ telefon: r.rezultat.telefon, parola: r.rezultat.parola });
          }}
        />
      </Sheet>

      <Sheet open={sheet === "document"} onClose={() => setSheet(null)} titlu="Document nou" pazit={areText(titlu)}>
        <Field label="Titlu" value={titlu} onChange={setTitlu} placeholder="Proces verbal adunare generală" />
        <Picker label="Tip" value={tipDoc} onChange={setTipDoc} options={TIPURI_DOCUMENTE} />
        <Box row gap={S.sm} style={{ alignItems: "center" }}>
          <AlegeFisier label={fisier ? "Alt fișier" : "Alege fișierul"} accept="application/pdf,image/*" onAles={setFisier} size="sm" />
          {fisier && <Txt size={12} color={C.ok} weight={600}>{fisier.name}</Txt>}
        </Box>
        <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.md }}>
          <Box gap={2} flex={1}>
            <Txt size={13} weight={600}>Vizibil tuturor locatarilor</Txt>
            <Txt size={11.5} color={C.muted}>Altfel îl vede doar administrația</Txt>
          </Box>
          <Switch value={vizibil} onChange={setVizibil} label="Vizibil locatarilor" />
        </Box>
        <Btn label="Încarcă documentul" full size="lg" disabled={!titlu.trim() || !fisier} onPress={async () => cuRezultat(await incarcaDocument({ titlu, tip: tipDoc, fisier, vizibil }))} />
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
  { key: "acasa", label: "Acasă", ecran: LocatarAcasa },
  { key: "plata", label: "Plata", ecran: LocatarPlata },
  { key: "consum", label: "Contoare", ecran: LocatarConsum },
  { key: "sesizari", label: "Sesizări", ecran: LocatarSesizari },
  { key: "bloc", label: "Bloc", ecran: LocatarBloc },
];

const TABURI_ADMIN = [
  { key: "sumar", label: "Sumar", ecran: AdminSumar },
  { key: "apartamente", label: "Apartamente", ecran: AdminApartamente },
  { key: "facturi", label: "Facturi", ecran: AdminFacturi },
  { key: "adminsesizari", label: "Sesizări", ecran: AdminSesizari },
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
  const { verificare } = useApp();
  /* Administratorul si conducerea care verifica (presedinte, cenzor) vad
     blocul intreg; locatarul, apartamentul lui. */
  /* [C2] Cine conduce si locuieste in bloc trece intre apartamentul lui si
     panoul de verificare: bara de sus spune unde se afla acum. */
  const conduceBlocul = ROLURI_CONDUCERE.includes(date.eu.rol) && !(poateComuta(date) && !verificare);
  const esteAdmin = conduceBlocul;
  const ap = !esteAdmin ? apartamentulMeu(date) : null;
  const initiale = date.bloc.denumire.replace(/^Bloc\s+/i, "").split(/[\s,]/)[0].slice(0, 3).toUpperCase();
  /* [P5] Un locatar legat de mai multe apartamente ale aceluiasi bloc
     (proprietar la unul, chirias la altul, de exemplu) poate alege intre
     ele; oricine are unul singur nu vede nimic in plus. */
  const apartamenteMele = !esteAdmin && date.eu.apartamenteMele && date.eu.apartamenteMele.length > 1
    ? date.eu.apartamenteMele.map((id) => date.apartamente.find((a) => a.id === id)).filter(Boolean)
    : null;
  const [alegeOpen, setAlegeOpen] = useState(false);
  const eticheta = conduceBlocul ? `${ETICHETA_ROL[date.eu.rol]}, ${date.bloc.denumire}` : `Apartament ${ap.numar}, ${date.bloc.denumire}`;
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
            <Press onPress={() => setAlegeOpen(true)} label="Schimbă apartamentul">
              <Txt size={11} color={C.accent} weight={700}>{eticheta} · Schimbă</Txt>
            </Press>
          ) : (
            <Txt size={11} color={C.muted}>{eticheta}</Txt>
          )}
        </Box>
      </Box>
      <Btn label="Ieși" size="sm" variant="secondary" onPress={onIesi} />
      {apartamenteMele && (
        <Sheet open={alegeOpen} onClose={() => setAlegeOpen(false)} titlu="Alege apartamentul">
          <Txt size={12.5} color={C.muted}>Ești legat de mai multe apartamente din {date.bloc.denumire}. Alege pe care îl vezi acum.</Txt>
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
            Ecranul nu s-a putut afișa. Datele tale sunt în siguranță. Încearcă din nou, iar dacă se repetă, ieși din cont și intră la loc.
          </Txt>
          <Btn label="Încearcă din nou" full size="lg" onPress={async () => {
            await this.props.onReincarca();
            this.setState({ aCrapat: false });
          }} />
          <Btn label="Ieși" variant="secondary" full onPress={this.props.onIesi} />
        </Card>
      </Box>
    );
  }
}

/* Ecranul de dinainte de intrarea in aplicatie. Contul nu se face de om:
   administratorul il creeaza si da omului parola. Aici se intra cu el. */
function EcranAutentificare() {
  const { intra, modDemo } = useApp();
  const [telefon, setTelefon] = useState("");
  const [parola, setParola] = useState("");
  const [lucreaza, setLucreaza] = useState(false);

  const numarBun = !!normalizeazaTelefon(telefon);
  const ruleaza = async (fn) => { setLucreaza(true); await fn(); setLucreaza(false); };

  return (
    <Box gap={S.lg} style={{ padding: S.lg, paddingTop: S.xxl }}>
      <Box gap={S.sm} style={{ alignItems: "flex-start" }}>
        <Box style={{ width: 44, height: 44, borderRadius: R.md, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" }}>
          <Txt size={15} weight={700} color={C.white}>AB</Txt>
        </Box>
        <Txt size={26} weight={700} style={{ letterSpacing: -0.5 }}>AdminBloc</Txt>
        <Txt size={14} color={C.inkSoft}>Vezi cât ai de plată, de ce atât și cum s-a ajuns la suma aceea.</Txt>
      </Box>

      <Card gap={S.md}>
        <Txt size={17} weight={700}>Intră în cont</Txt>
        <Field label="Numărul tău de telefon" value={telefon} onChange={setTelefon} placeholder="07xx xxx xxx" inputMode="tel" autoComplete="tel" />
        <Field label="Parola" value={parola} onChange={setParola} placeholder="Parola primită" type="password" autoComplete="current-password" />
        <Btn label={lucreaza ? "Se verifică..." : "Intră"} full size="lg" disabled={!numarBun || !parola || lucreaza} onPress={() => ruleaza(() => intra(telefon.trim(), parola))} />
        <Txt size={12.5} color={C.muted}>Nu ai cont? Cere-l administratorului blocului. El îl face pe numărul tău de telefon și îți dă parola.</Txt>
      </Card>

      {modDemo && (
        <Card gap={S.xs} pad={S.md} style={{ backgroundColor: C.infoSoft, borderColor: C.infoSoft }}>
          <Txt size={12} weight={700} color={C.info}>Mod demonstrativ, fără server</Txt>
          <Txt size={11.5} color={C.info}>Administrator: 0745 210 118. Locatar: 0733 410 217. Parola pentru ambele: Bloc-D14-2026. Datele se reiau de la zero la reîncărcarea paginii.</Txt>
        </Card>
      )}
    </Box>
  );
}

/* Contul exista, dar inca nu are acces la nimic */
function EcranFaraAcces() {
  const { date, iesi } = useApp();
  return (
    <Box gap={S.lg} style={{ padding: S.lg, paddingTop: S.xxl }}>
      <AntetEcran eyebrow={telefonAfisat(date.eu.telefon)} titlu={`Bună, ${date.eu.nume.split(" ")[0]}`} />
      <Card gap={S.sm}>
        <Txt size={15} weight={700}>Contul nu este legat de un apartament</Txt>
        <Txt size={13} color={C.inkSoft}>
          Administratorul blocului leagă contul de apartamentul tău. Sună-l sau treci pe la el;
          până atunci nu ai ce vedea aici.
        </Txt>
        {date.eu.motivRespingere && <Txt size={13} color={C.danger}>{date.eu.motivRespingere}</Txt>}
      </Card>
      <Btn label="Ieși din cont" variant="secondary" full onPress={iesi} />
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
  /* [C2] Presedintele care locuieste in bloc are doua vieti in aplicatie:
     apartamentul lui (ecranele de locatar) si verificarea blocului (panoul
     de citire). Aici se tine care dintre ele este deschisa. */
  const [verificare, setVerificare] = useState(false);
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
      const mesajEroare = e.message || "Datele nu au putut fi încărcate.";
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
          const mesajEroare = e.message || "A apărut o eroare. Încearcă din nou.";
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
      /* Intrarea in cont reuseste sau arunca, deci aici exista mereu sesiune */
      await reincarca();
      return s;
    };
    const toate = {
      toastMsg,
      reincarca,
      modDemo: sursa.tip === "demo",
      urlFisier: (cale) => sursa.urlFisier(cale),
      deschideDocument: (id) => deschideDupa(sursa.deschideDocument(id), toastMsg),

      intra: cmd(async (email, parola) => { await sursa.intra(email, parola); return intrat(); }, null, false),
      iesi: async () => {
        await sursa.iesi();
        setSesiune(null);
        setDate(null);
        setTab(null);
        setApartamentAles(null);
      },

      /* [P5] Schimba apartamentul activ, pentru un locatar legat de mai
         multe apartamente ale aceluiasi bloc: doar alegerea se schimba, nu
         se pierde nimic, alMeu() aduce deja datele tuturor apartamentelor
         lui la fiecare incarca(). */
      aleseApartament: cmd(async (apartamentId) => { setApartamentAles(apartamentId); return reincarca(apartamentId); }, null, false),

      transmiteCitire: cmd((x) => sursa.transmiteCitire(x), "Indexul a fost trimis administratorului"),
      adaugaSesizare: cmd((x) => sursa.adaugaSesizare(x), "Sesizarea a ajuns la administrator"),
      scrieMesaj: cmd((id, t) => sursa.scrieMesaj(id, t), "Mesajul a fost trimis"),
      voteaza: cmd((v, o, a) => sursa.voteaza(v, o, a), "Votul a fost înregistrat"),
      confirmaPrezenta: cmd((a, ap) => sursa.confirmaPrezenta(a, ap), "Prezența a fost confirmată"),
      marcheazaAnuntCitit: cmd((id) => sursa.marcheazaAnuntCitit(id), null, true, true, true),
      /* [K1] Avizierul cu mai multe anunturi necitite marca fiecare anunt cu o
         comanda proprie, deci cu o reincarcare completa proprie: N anunturi
         necitite porneau N reincarcari, iar fiecare reincarcare repornea
         efectul din LocatarBloc. O singura comanda marcheaza tot lotul si
         reincarca o singura data la final. */
      marcheazaAnunturiCitite: cmd((ids) => Promise.all(ids.map((id) => sursa.marcheazaAnuntCitit(id))), null, true, true, true),
      marcheazaNotificareCitita: cmd((id) => sursa.marcheazaNotificareCitita(id), null, true, true, true),

      deschideLista: cmd((l) => sursa.deschideLista(l), (r, l) => `Lista pe ${monthLabel(l)} a fost începută`),
      salveazaCheltuiala: cmd((x) => sursa.salveazaCheltuiala(x), (r, x) => (x.id ? "Factura a fost modificată" : "Factura a fost adăugată în lista în lucru")),
      stergeCheltuiala: cmd((id) => sursa.stergeCheltuiala(id), "Cheltuiala a fost ștearsă"),
      /* Citire, nu comanda: previzualizarea se poate cere din nou oricand */
      dateMotor: cmd((id) => sursa.dateMotor(id), null, false, false),
      publicaLista: cmd((id) => sursa.publicaLista(id), "Lista a fost publicată. Locatarii o văd acum."),
      marcheazaFacturaPlatita: cmd((id, p) => sursa.marcheazaFacturaPlatita(id, p), (r, id, p) => (p ? "Factura marcată ca plătită furnizorului" : "Plata către furnizor a fost anulată")),
      inregistreazaIncasare: cmd((ap, s, m, cheie, data) => sursa.inregistreazaIncasare(ap, s, m, cheie, data), "Încasare înregistrată, chitanța emisă"),
      storneazaIncasare: cmd((id, motiv) => sursa.storneazaIncasare(id, motiv), "Încasarea a fost anulată"),
      trimiteInstiintare: cmd((ap) => sursa.trimiteInstiintare(ap)),
      schimbaPersoane: cmd((ap, n, l, m) => sursa.schimbaPersoane(ap, n, l, m), (r, ap, n, l) => `Din ${monthLabel(l)} se calculează ${n} persoane`),
      adaugaLocatar: cmd((ap, x) => sursa.adaugaLocatar(ap, x), "Contul a fost creat"),
      parolaNoua: cmd((ap, l) => sursa.parolaNoua(ap, l), "Parola nouă a fost generată"),
      numesteInConducere: cmd((p, r) => sursa.numesteInConducere(p, r), "Mandatul a fost înregistrat"),
      adaugaInConducere: cmd((n, t, r) => sursa.adaugaInConducere(n, t, r), "Mandatul a fost înregistrat"),
      incheieMandat: cmd((m) => sursa.incheieMandat(m), "Mandatul a fost încheiat"),
      inchideAcces: cmd((id) => sursa.inchideAcces(id), "Accesul a fost închis"),
      schimbaFisaApartament: cmd((ap, x) => sursa.schimbaFisaApartament(ap, x), "Fișa apartamentului a fost actualizată"),
      schimbaCoteleBlocului: cmd((cote) => sursa.schimbaCoteleBlocului(cote), "Cotele blocului au fost actualizate"),
      inregistreazaIesireFond: cmd((x) => sursa.inregistreazaIesireFond(x), "Ieșirea din fond a fost înregistrată"),
      valideazaCitire: cmd((id, a, m) => sursa.valideazaCitire(id, a, m), (r, id, a) => (a ? "Citirea a fost validată" : "Citirea a fost respinsă, locatarul a fost anunțat")),
      /* [A5] O singura comanda pentru tot apartamentul: totul sau nimic */
      valideazaCitiriApartament: cmd((ap, l, a, m) => sursa.valideazaCitiriApartament(ap, l, a, m), (r, ap, l, a) => (a ? "Citirea a fost validată" : "Citirea a fost respinsă, locatarul a fost anunțat")),
      citesteContorGeneral: cmd((l, t, i) => sursa.citesteContorGeneral(l, t, i), "Indexul contorului general a fost salvat"),
      estimeazaCitiri: cmd((l) => sursa.estimeazaCitiri(l)),
      preiaSesizare: cmd((id) => sursa.preiaSesizare(id), "Sesizarea este în lucru"),
      rezolvaSesizare: cmd((id) => sursa.rezolvaSesizare(id), "Sesizarea a fost marcată rezolvată"),
      publicaAnunt: cmd((x) => sursa.publicaAnunt(x), (r, x) => (x.urgent ? "Anunț publicat și notificare trimisă" : "Anunț publicat la avizier")),
      seteazaReminder: cmd((t, a, z) => sursa.seteazaReminder(t, a, z)),
      trimiteReminder: cmd((t) => sursa.trimiteReminder(t)),
      deschideVot: cmd((x) => sursa.deschideVot(x), "Votul a fost deschis"),
      reamintesteVot: cmd((id) => sursa.reamintesteVot(id)),
      convoacaAdunare: cmd((x) => sursa.convoacaAdunare(x)),
      incarcaDocument: cmd((x) => sursa.incarcaDocument(x), "Documentul a fost încărcat"),
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
          if (!val.fundal) toastMsg("Așteaptă să se termine acțiunea anterioară.");
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

  const deschideVerificarea = useCallback((pornit) => {
    setVerificare(pornit);
    setTab(null);
    setParametri(null);
  }, []);
  const api = useMemo(
    () => ({ ...comenzi, date, verificare, deschideVerificarea }),
    [comenzi, date, verificare, deschideVerificarea],
  );

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
          <Txt size={12.5} color={C.muted}>Dacă ai stat mult cu aplicația deschisă, sesiunea s-a închis singură. Intră din nou în cont.</Txt>
          <Btn label="Încearcă din nou" full size="lg" onPress={reincarca} />
          <Btn label="Ieși din cont" variant="secondary" full onPress={comenzi.iesi} />
        </Card>
      </Box>
    );
  } else if (sesiune === undefined || (sesiune && !date)) {
    continut = (
      <Box style={{ padding: S.xl, alignItems: "center", justifyContent: "center" }} flex={1}>
        <Txt size={13} color={C.muted}>Se încarcă...</Txt>
      </Box>
    );
  } else if (!sesiune && !date) {
    continut = <EcranAutentificare />;
    cheie = "autentificare";
  } else if (!ROLURI_CONDUCERE.includes(date.eu.rol) && date.eu.rol !== "locatar") {
    continut = <EcranFaraAcces />;
    cheie = "fara-acces";
  } else {
    /* [C2] Cine conduce si locuieste in bloc porneste in apartamentul lui;
       panoul de verificare se deschide dintr-un buton, din tabul Bloc. */
    const esteAdmin = ROLURI_CONDUCERE.includes(date.eu.rol) && (!poateComuta(date) || verificare);
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
    cheie = `${date.eu.rol}${esteAdmin ? "-panou" : ""}-${tabActiv}`;
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
