/* =============================================================================
   AdminBloc, mockup functional pentru administrarea unui bloc de locuinte
   -----------------------------------------------------------------------------
   Structura fisierului este gandita pentru portare rapida in React Native:

   1. TOKENS      -> devine theme.js (obiecte simple, fara CSS)
   2. HELPERS     -> pur JavaScript, se copiaza fara modificari
   3. MOCK DATA   -> devine un store (Zustand / Context), fara fetch
   4. ENGINE      -> logica de repartizare, pur JavaScript, se copiaza ca atare
   5. PRIMITIVE   -> Box/Txt/Btn, singurele componente care ating DOM-ul
   6. ECRANE      -> folosesc doar primitivele, deci se porteaza fara rescriere

   Harta de portare:
     <Box>            -> <View>
     <Txt>            -> <Text>
     <Btn>            -> <Pressable>
     .map() pe liste  -> <FlatList>
     style={{...}}    -> StyleSheet.create({...}) (aceleasi chei flexbox)
     onChange input   -> onChangeText TextInput
     ecranele/tab bar -> @react-navigation/bottom-tabs

   Regula respectata peste tot: layout doar cu flexbox, fara grid, fara
   pseudo-selectori, fara unitati CSS in afara de px, fara librarii externe.
============================================================================= */

import React, { useState, useMemo } from "react";

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
  muted: "#767B74",
  line: "#DBDDD5",
  lineStrong: "#C3C6BC",
  accent: "#2F5D50",
  accentSoft: "#DFE9E4",
  accentInk: "#1D3E35",
  warn: "#8A6410",
  warnSoft: "#F5EBD5",
  danger: "#93312A",
  dangerSoft: "#F6E3E0",
  ok: "#2C6142",
  okSoft: "#E1EDE4",
  info: "#2C4C6B",
  infoSoft: "#E0E8EF",
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

const LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie",
  "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const LUNI_S = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "noi", "dec"];

const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return `${LUNI[Number(m) - 1]} ${y}`;
};
const monthShort = (key) => {
  const [y, m] = key.split("-");
  return `${LUNI_S[Number(m) - 1]} ${y.slice(2)}`;
};

const zileDe = (isoDate, from = "2026-08-14") =>
  Math.round((new Date(isoDate) - new Date(from)) / 86400000);

const dataRo = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()} ${LUNI_S[d.getMonth()]} ${d.getFullYear()}`;
};

/* =============================================================================
   3. MOCK DATA
============================================================================= */

const BLOC = {
  nume: "Bloc D14, scara A",
  adresa: "Str. Nicolae Balcescu nr. 22, Pitesti",
  cod: "Asociatia de proprietari nr. 118",
  etaje: 4,
  administrator: { nume: "Mihai Dobre", tel: "0745 210 118", program: "Marti si joi, 17:00 - 19:00" },
  presedinte: { nume: "Ioana Stancu", tel: "0722 884 019", ap: 12 },
  cenzor: { nume: "Radu Pintea", tel: "0740 118 233", ap: 4 },
};

const LUNA_CURENTA = "2026-07";
const LUNI_DISPONIBILE = ["2026-07", "2026-06", "2026-05"];

/* Apartamentele. Parterul este ap. 1 - 4 si nu plateste lift, regula uzuala
   in asociatiile de proprietari. */
const APARTAMENTE = [
  { id: 1, nr: 1, et: 0, prop: "Gheorghe Voicu", pers: 2, cota: 3.62, mp: 42.5 },
  { id: 2, nr: 2, et: 0, prop: "Ana Petrescu", pers: 1, cota: 4.18, mp: 49.0 },
  { id: 3, nr: 3, et: 0, prop: "Familia Ilie", pers: 4, cota: 5.44, mp: 63.8 },
  { id: 4, nr: 4, et: 0, prop: "Radu Pintea", pers: 2, cota: 3.62, mp: 42.5 },
  { id: 5, nr: 5, et: 1, prop: "Cristina Barbu", pers: 3, cota: 4.18, mp: 49.0 },
  { id: 6, nr: 6, et: 1, prop: "Vasile Munteanu", pers: 2, cota: 5.44, mp: 63.8 },
  { id: 7, nr: 7, et: 1, prop: "Adrian Neagu", pers: 1, cota: 3.62, mp: 42.5 },
  { id: 8, nr: 8, et: 1, prop: "Familia Dumitrescu", pers: 4, cota: 5.44, mp: 63.8 },
  { id: 9, nr: 9, et: 2, prop: "Mircea Olaru", pers: 2, cota: 4.18, mp: 49.0 },
  { id: 10, nr: 10, et: 2, prop: "Sanda Croitoru", pers: 1, cota: 3.62, mp: 42.5 },
  { id: 11, nr: 11, et: 2, prop: "Familia Georgescu", pers: 5, cota: 5.44, mp: 63.8 },
  { id: 12, nr: 12, et: 2, prop: "Ioana Stancu", pers: 2, cota: 4.18, mp: 49.0 },
  { id: 13, nr: 13, et: 3, prop: "Paul Enache", pers: 3, cota: 5.44, mp: 63.8 },
  { id: 14, nr: 14, et: 3, prop: "Doina Lupu", pers: 1, cota: 3.62, mp: 42.5 },
  { id: 15, nr: 15, et: 3, prop: "Familia Toma", pers: 4, cota: 5.44, mp: 63.8 },
  { id: 16, nr: 16, et: 3, prop: "Sorin Avram", pers: 2, cota: 4.18, mp: 49.0 },
  { id: 17, nr: 17, et: 4, prop: "Elena Marinescu", pers: 3, cota: 4.18, mp: 49.0, esteUtilizator: true },
  { id: 18, nr: 18, et: 4, prop: "Nicolae Serban", pers: 2, cota: 5.44, mp: 63.8 },
  { id: 19, nr: 19, et: 4, prop: "Familia Nita", pers: 3, cota: 3.62, mp: 42.5 },
  { id: 20, nr: 20, et: 4, prop: "Lavinia Costea", pers: 2, cota: 5.44, mp: 63.8 },
];

const AP_UTILIZATOR = APARTAMENTE.find((a) => a.esteUtilizator);

/* Facturile lunii. Fiecare are metoda de repartizare declarata, exact asta
   este informatia pe care locatarul nu o vede niciodata pe hartie. */
const METODE = {
  consum: { eticheta: "Pe consum masurat", explic: "Suma se imparte proportional cu consumul citit la contorul din apartament." },
  persoane: { eticheta: "Pe numar de persoane", explic: "Suma se imparte la totalul persoanelor declarate in bloc, apoi se inmulteste cu persoanele din apartament." },
  apartamente: { eticheta: "Egal pe apartament", explic: "Suma se imparte in parti egale la cele 20 de apartamente." },
  cota: { eticheta: "Pe cota indiviza", explic: "Suma se imparte proportional cu cota parte din proprietatea comuna, inscrisa in actul de proprietate." },
  persoaneFaraParter: { eticheta: "Pe persoane, fara parter", explic: "Suma se imparte la persoanele de la etajele 1 si mai sus. Apartamentele de la parter nu contribuie." },
};

const FACTURI = {
  "2026-07": [
    { id: "F1", cod: "C1", furnizor: "Apa Canal 2000 Arges", categorie: "Apa rece si canalizare", suma: 3284.6, metoda: "consum", serie: "ACA-448120", emisa: "2026-08-03", scadenta: "2026-08-25", achitata: true, doc: "factura-apa-iulie.pdf" },
    { id: "F2", cod: "C2", furnizor: "Termo Energy Pitesti", categorie: "Apa calda menajera", suma: 2418.0, metoda: "consum", serie: "TEP-90233", emisa: "2026-08-04", scadenta: "2026-08-28", achitata: true, doc: "factura-apa-calda-iulie.pdf" },
    { id: "F3", cod: "C3", furnizor: "Enel Energie Muntenia", categorie: "Energie electrica parti comune", suma: 412.35, metoda: "apartamente", serie: "EEM-771204", emisa: "2026-08-02", scadenta: "2026-08-20", achitata: true, doc: "factura-curent-iulie.pdf" },
    { id: "F4", cod: "C4", furnizor: "Salubritate 2000", categorie: "Salubritate", suma: 1120.0, metoda: "persoane", serie: "SAL-33128", emisa: "2026-08-01", scadenta: "2026-08-30", achitata: false, doc: "factura-salubritate-iulie.pdf" },
    { id: "F5", cod: "C5", furnizor: "Elmas Lift Service", categorie: "Intretinere ascensor", suma: 640.0, metoda: "persoaneFaraParter", serie: "ELM-2210", emisa: "2026-08-05", scadenta: "2026-09-05", achitata: false, doc: "contract-lift-2026.pdf" },
    { id: "F6", cod: "C6", furnizor: "Maria Dinu, contract prestari", categorie: "Curatenie casa scarii", suma: 900.0, metoda: "persoane", serie: "CP-07/2026", emisa: "2026-08-01", scadenta: "2026-08-15", achitata: true, doc: "stat-plata-curatenie.pdf" },
    { id: "F7", cod: "C7", furnizor: "Asociatia de proprietari", categorie: "Administrare si cenzorat", suma: 1400.0, metoda: "apartamente", serie: "AP-07/2026", emisa: "2026-08-01", scadenta: "2026-08-15", achitata: true, doc: "stat-plata-administrare.pdf" },
    { id: "F8", cod: "C8", furnizor: "Deraton Serv", categorie: "Deratizare si dezinsectie", suma: 380.0, metoda: "apartamente", serie: "DRT-1180", emisa: "2026-07-28", scadenta: "2026-08-27", achitata: false, doc: "proces-verbal-deratizare.pdf" },
  ],
  "2026-06": [
    { id: "G1", cod: "C1", furnizor: "Apa Canal 2000 Arges", categorie: "Apa rece si canalizare", suma: 2960.4, metoda: "consum", serie: "ACA-441003", emisa: "2026-07-03", scadenta: "2026-07-25", achitata: true, doc: "factura-apa-iunie.pdf" },
    { id: "G2", cod: "C2", furnizor: "Termo Energy Pitesti", categorie: "Apa calda menajera", suma: 2210.5, metoda: "consum", serie: "TEP-89771", emisa: "2026-07-04", scadenta: "2026-07-28", achitata: true, doc: "factura-apa-calda-iunie.pdf" },
    { id: "G3", cod: "C3", furnizor: "Enel Energie Muntenia", categorie: "Energie electrica parti comune", suma: 388.2, metoda: "apartamente", serie: "EEM-768401", emisa: "2026-07-02", scadenta: "2026-07-20", achitata: true, doc: "factura-curent-iunie.pdf" },
    { id: "G4", cod: "C4", furnizor: "Salubritate 2000", categorie: "Salubritate", suma: 1120.0, metoda: "persoane", serie: "SAL-32904", emisa: "2026-07-01", scadenta: "2026-07-30", achitata: true, doc: "factura-salubritate-iunie.pdf" },
    { id: "G5", cod: "C5", furnizor: "Elmas Lift Service", categorie: "Intretinere ascensor", suma: 640.0, metoda: "persoaneFaraParter", serie: "ELM-2188", emisa: "2026-07-05", scadenta: "2026-08-05", achitata: true, doc: "contract-lift-2026.pdf" },
    { id: "G6", cod: "C6", furnizor: "Maria Dinu, contract prestari", categorie: "Curatenie casa scarii", suma: 900.0, metoda: "persoane", serie: "CP-06/2026", emisa: "2026-07-01", scadenta: "2026-07-15", achitata: true, doc: "stat-plata-curatenie.pdf" },
    { id: "G7", cod: "C7", furnizor: "Asociatia de proprietari", categorie: "Administrare si cenzorat", suma: 1400.0, metoda: "apartamente", serie: "AP-06/2026", emisa: "2026-07-01", scadenta: "2026-07-15", achitata: true, doc: "stat-plata-administrare.pdf" },
  ],
  "2026-05": [
    { id: "H1", cod: "C1", furnizor: "Apa Canal 2000 Arges", categorie: "Apa rece si canalizare", suma: 2744.9, metoda: "consum", serie: "ACA-437765", emisa: "2026-06-03", scadenta: "2026-06-25", achitata: true, doc: "factura-apa-mai.pdf" },
    { id: "H2", cod: "C2", furnizor: "Termo Energy Pitesti", categorie: "Apa calda menajera", suma: 2402.0, metoda: "consum", serie: "TEP-88120", emisa: "2026-06-04", scadenta: "2026-06-28", achitata: true, doc: "factura-apa-calda-mai.pdf" },
    { id: "H3", cod: "C3", furnizor: "Enel Energie Muntenia", categorie: "Energie electrica parti comune", suma: 401.1, metoda: "apartamente", serie: "EEM-764112", emisa: "2026-06-02", scadenta: "2026-06-20", achitata: true, doc: "factura-curent-mai.pdf" },
    { id: "H4", cod: "C4", furnizor: "Salubritate 2000", categorie: "Salubritate", suma: 1120.0, metoda: "persoane", serie: "SAL-32551", emisa: "2026-06-01", scadenta: "2026-06-30", achitata: true, doc: "factura-salubritate-mai.pdf" },
    { id: "H5", cod: "C5", furnizor: "Elmas Lift Service", categorie: "Intretinere ascensor", suma: 640.0, metoda: "persoaneFaraParter", serie: "ELM-2151", emisa: "2026-06-05", scadenta: "2026-07-05", achitata: true, doc: "contract-lift-2026.pdf" },
    { id: "H6", cod: "C6", furnizor: "Maria Dinu, contract prestari", categorie: "Curatenie casa scarii", suma: 900.0, metoda: "persoane", serie: "CP-05/2026", emisa: "2026-06-01", scadenta: "2026-06-15", achitata: true, doc: "stat-plata-curatenie.pdf" },
    { id: "H7", cod: "C7", furnizor: "Asociatia de proprietari", categorie: "Administrare si cenzorat", suma: 1400.0, metoda: "apartamente", serie: "AP-05/2026", emisa: "2026-06-01", scadenta: "2026-06-15", achitata: true, doc: "stat-plata-administrare.pdf" },
  ],
};

/* Fondul de reparatii se colecteaza pe cota indiviza, nu este factura. */
const FOND_REPARATII_LUNAR = 1600;

/* Contorul general al blocului si contoarele individuale, in metri cubi.
   Diferenta dintre ele este pierderea pe coloana, care se repartizeaza pe
   persoane. Este cel mai contestat rand din orice lista de plata. */
const CONTOR_GENERAL = {
  "2026-07": { rece: 428.0, calda: 196.0 },
  "2026-06": { rece: 401.0, calda: 181.0 },
  "2026-05": { rece: 372.0, calda: 194.0 },
};

/* Generator determinist de consumuri, ca sa nu scriem 20 x 3 randuri de mana */
function seedConsum(apId, luna, tip) {
  const base = tip === "rece" ? 4.2 : 2.1;
  const seed = (apId * 37 + luna.charCodeAt(6) * 11 + (tip === "rece" ? 3 : 7)) % 19;
  const ap = APARTAMENTE.find((a) => a.id === apId);
  return round2(base * ap.pers + (seed / 10) * 1.6);
}

const CONSUM = {};
LUNI_DISPONIBILE.forEach((luna) => {
  CONSUM[luna] = {};
  APARTAMENTE.forEach((ap) => {
    CONSUM[luna][ap.id] = {
      rece: seedConsum(ap.id, luna, "rece"),
      calda: seedConsum(ap.id, luna, "calda"),
    };
  });
});

/* Indexuri pentru ecranul de autocitire al locatarului */
const INDEXURI_MELE = [
  { luna: "2026-07", receVechi: 231.4, receNou: 244.1, caldaVechi: 118.9, caldaNou: 125.7, stare: "validat" },
  { luna: "2026-06", receVechi: 219.2, receNou: 231.4, caldaVechi: 112.4, caldaNou: 118.9, stare: "validat" },
  { luna: "2026-05", receVechi: 206.5, receNou: 219.2, caldaVechi: 105.8, caldaNou: 112.4, stare: "validat" },
  { luna: "2026-04", receVechi: 194.8, receNou: 206.5, caldaVechi: 99.1, caldaNou: 105.8, stare: "estimat" },
];

/* Soldurile. Valoare pozitiva inseamna datorie catre asociatie. */
const SOLDURI_INITIALE = {
  1: 0, 2: 0, 3: 412.8, 4: 0, 5: 0, 6: 188.4, 7: 0, 8: 0, 9: 0, 10: 0,
  11: 967.2, 12: 0, 13: 0, 14: 0, 15: 231.5, 16: 0, 17: 0, 18: 0, 19: 74.9, 20: 0,
};

/* Zile de intarziere pentru calculul penalizarilor */
const ZILE_INTARZIERE = { 3: 47, 6: 12, 11: 118, 15: 34, 19: 8 };
const PROCENT_PENALIZARE_ZI = 0.02; /* configurabil de administrator */

/* Platile au doar metadate aici. Sumele se iau din motorul de repartizare, ca
   sa nu existe doua adevaruri pentru aceeasi luna. */
const PLATI_META = [
  { id: "P1", luna: "2026-06", data: "2026-07-14", metoda: "Card online", chitanta: "CH-2026-0418" },
  { id: "P2", luna: "2026-05", data: "2026-06-12", metoda: "Card online", chitanta: "CH-2026-0361" },
];

const SESIZARI_INITIALE = [
  { id: "S1", ap: 17, titlu: "Bec ars pe palier la etajul 4", categorie: "Iluminat", desc: "Becul de langa ap. 17 nu mai porneste de doua zile.", stare: "in lucru", creata: "2026-08-09", raspuns: "Am cumparat becul, se monteaza joi.", poze: 1 },
  { id: "S2", ap: 11, titlu: "Scurgere la coloana de la subsol", categorie: "Instalatii", desc: "Se aude apa curgand permanent langa boxa 11.", stare: "noua", creata: "2026-08-13", raspuns: null, poze: 2 },
  { id: "S3", ap: 6, titlu: "Usa de la intrare nu se inchide singura", categorie: "Acces", desc: "Amortizorul nu mai trage usa pana la capat.", stare: "in lucru", creata: "2026-08-06", raspuns: "Comandat amortizor nou, livrare pe 18 august.", poze: 0 },
  { id: "S4", ap: 17, titlu: "Interfon defect", categorie: "Acces", desc: "Nu se aude nimic la interfon.", stare: "rezolvata", creata: "2026-07-21", raspuns: "Inlocuit modulul de apel pe 24 iulie.", poze: 0 },
  { id: "S5", ap: 2, titlu: "Gunoi depozitat pe casa scarii", categorie: "Curatenie", desc: "La etajul 1 sunt saci lasati de doua zile.", stare: "rezolvata", creata: "2026-08-02", raspuns: "Discutat cu proprietarul, s-a eliberat spatiul.", poze: 1 },
];

const ANUNTURI_INITIALE = [
  { id: "A1", titlu: "Oprire apa rece marti, 18 august", corp: "Apa Canal opreste furnizarea intre 09:00 si 16:00 pentru inlocuirea unei vane pe strada. Va recomandam sa faceti rezerva de seara.", data: "2026-08-12", important: true, autor: "Mihai Dobre" },
  { id: "A2", titlu: "Citirea contoarelor pana pe 25 august", corp: "Transmiteti indexul din aplicatie sau lasati un bilet in cutia asociatiei. Cine nu transmite index primeste consum estimat pe media ultimelor trei luni.", data: "2026-08-10", important: false, autor: "Mihai Dobre" },
  { id: "A3", titlu: "Lucrari la fatada, tronsonul dinspre parcare", corp: "Firma incepe pe 24 august si estimeaza doua saptamani. Schela ocupa trei locuri de parcare, marcate cu banda.", data: "2026-08-04", important: false, autor: "Ioana Stancu" },
];

const DOCUMENTE = [
  { id: "D1", nume: "Lista de plata iulie 2026", tip: "Lista de plata", data: "2026-08-08", marime: "184 KB" },
  { id: "D2", nume: "Situatia soldurilor la 31 iulie 2026", tip: "Raport", data: "2026-08-08", marime: "96 KB" },
  { id: "D3", nume: "Proces verbal adunare generala, 12 martie 2026", tip: "Proces verbal", data: "2026-03-14", marime: "212 KB" },
  { id: "D4", nume: "Contract intretinere ascensor Elmas 2026", tip: "Contract", data: "2026-01-20", marime: "1,1 MB" },
  { id: "D5", nume: "Regulamentul asociatiei de proprietari", tip: "Regulament", data: "2025-09-02", marime: "340 KB" },
  { id: "D6", nume: "Raport de cenzor pe anul 2025", tip: "Raport", data: "2026-02-11", marime: "128 KB" },
];

const VOT_INITIAL = {
  id: "V1",
  titlu: "Inlocuirea usii de la intrare",
  descriere: "Doua oferte pentru usa cu interfon si inchidere automata. Plata se face din fondul de reparatii, restul se colecteaza in trei rate lunare.",
  deschis: "2026-08-05",
  inchide: "2026-09-03",
  optiuni: [
    { id: "O1", text: "Oferta A, usa aluminiu, 14.200 lei", voturi: 7 },
    { id: "O2", text: "Oferta B, usa PVC cu geam termopan, 9.800 lei", voturi: 5 },
    { id: "O3", text: "Amanam decizia pentru anul viitor", voturi: 2 },
  ],
  votanti: 14,
};

const FONDURI = {
  reparatii: { sold: 18428.6, incasatAnual: 11200, cheltuitAnual: 7642.4 },
  rulment: { sold: 9600.0, perApartament: 480 },
};

const MISCARI_FOND = [
  { id: "M1", data: "2026-07-30", desc: "Incasari fond reparatii iulie", suma: 1600, tip: "intrare" },
  { id: "M2", data: "2026-07-18", desc: "Reparatie pompa hidrofor", suma: -2240, tip: "iesire", doc: "factura-hidrofor.pdf" },
  { id: "M3", data: "2026-06-30", desc: "Incasari fond reparatii iunie", suma: 1600, tip: "intrare" },
  { id: "M4", data: "2026-06-11", desc: "Zugravit casa scarii, etajele 1 si 2", suma: -3800, tip: "iesire", doc: "deviz-zugravit.pdf" },
  { id: "M5", data: "2026-05-30", desc: "Incasari fond reparatii mai", suma: 1600, tip: "intrare" },
];

const REMINDERE_CONFIG_INITIAL = [
  { id: "R1", nume: "Anunt cand se afiseaza lista de plata", activ: true, cand: "In ziua generarii listei" },
  { id: "R2", nume: "Reamintire de citire a contoarelor", activ: true, cand: "Cu 5 zile inainte de termen" },
  { id: "R3", nume: "Reamintire de plata", activ: true, cand: "Cu 3 zile inainte de scadenta" },
  { id: "R4", nume: "Instiintare de restanta", activ: true, cand: "La 30 de zile de la scadenta" },
  { id: "R5", nume: "Convocare adunare generala", activ: false, cand: "Cu 10 zile inainte de data" },
];

/* =============================================================================
   4. ENGINE, repartizarea cheltuielilor
   Aceasta este singura sursa de adevar pentru sume. Ecranele nu au numere
   scrise de mana, tot ce se afiseaza iese de aici, deci lista locatarului si
   raportul administratorului nu pot sa se contrazica.
============================================================================= */

const TOTAL_PERSOANE = APARTAMENTE.reduce((s, a) => s + a.pers, 0);
const TOTAL_PERSOANE_FARA_PARTER = APARTAMENTE.filter((a) => a.et > 0).reduce((s, a) => s + a.pers, 0);
const TOTAL_APARTAMENTE = APARTAMENTE.length;

function bazaRepartizare(ap, metoda, luna) {
  switch (metoda) {
    case "persoane":
      return { valoare: ap.pers, total: TOTAL_PERSOANE, um: "persoane" };
    case "persoaneFaraParter":
      return { valoare: ap.et > 0 ? ap.pers : 0, total: TOTAL_PERSOANE_FARA_PARTER, um: "persoane" };
    case "apartamente":
      return { valoare: 1, total: TOTAL_APARTAMENTE, um: "apartamente" };
    case "cota":
      return { valoare: ap.cota, total: 100, um: "%" };
    default:
      return { valoare: 1, total: TOTAL_APARTAMENTE, um: "apartamente" };
  }
}

/* Repartizarea apei tine cont de contorul general al blocului. Cine consuma
   plateste consumul propriu, iar diferenta neinregistrata de contoarele
   individuale se imparte pe persoane. */
function repartizeazaApa(factura, luna) {
  const tip = factura.categorie.includes("calda") ? "calda" : "rece";
  const general = CONTOR_GENERAL[luna][tip];
  const sumaIndividuala = APARTAMENTE.reduce((s, a) => s + CONSUM[luna][a.id][tip], 0);
  const diferenta = round2(general - sumaIndividuala);
  const pretMc = factura.suma / general;

  const parti = {};
  APARTAMENTE.forEach((ap) => {
    const propriu = CONSUM[luna][ap.id][tip];
    const cotaDiferenta = (diferenta * ap.pers) / TOTAL_PERSOANE;
    parti[ap.id] = {
      suma: round2((propriu + cotaDiferenta) * pretMc),
      detaliu: {
        tip,
        consumPropriu: propriu,
        contorGeneral: general,
        sumaContoare: round2(sumaIndividuala),
        diferenta,
        cotaDiferenta: round2(cotaDiferenta),
        pretMc: round2(pretMc),
      },
    };
  });
  return parti;
}

function repartizeazaSimplu(factura, luna) {
  const parti = {};
  APARTAMENTE.forEach((ap) => {
    const b = bazaRepartizare(ap, factura.metoda, luna);
    parti[ap.id] = {
      suma: b.total === 0 ? 0 : round2((factura.suma * b.valoare) / b.total),
      detaliu: { baza: b },
    };
  });
  return parti;
}

/* Rotunjirea la ban lasa mereu cateva bani in plus sau in minus fata de
   factura. Diferenta se aloca apartamentului cu cea mai mare cota, ca totalul
   repartizat sa fie egal la ban cu factura. */
function corecteazaRotunjirea(parti, sumaFactura) {
  const total = round2(Object.values(parti).reduce((s, p) => s + p.suma, 0));
  const rest = round2(sumaFactura - total);
  if (rest === 0) return parti;
  let idMax = null;
  let max = -Infinity;
  Object.entries(parti).forEach(([id, p]) => {
    if (p.suma > max) { max = p.suma; idMax = id; }
  });
  if (idMax) parti[idMax] = { ...parti[idMax], suma: round2(parti[idMax].suma + rest), rotunjire: rest };
  return parti;
}

function calculeazaLuna(luna) {
  const facturi = FACTURI[luna] || [];
  const randuri = facturi.map((f) => {
    const parti = f.metoda === "consum" ? repartizeazaApa(f, luna) : repartizeazaSimplu(f, luna);
    return { factura: f, parti: corecteazaRotunjirea(parti, f.suma) };
  });

  /* Fondul de reparatii, contributie lunara pe cota indiviza */
  const fond = {
    factura: {
      id: "FR", cod: "C9", furnizor: "Asociatia de proprietari", categorie: "Fond de reparatii",
      suma: FOND_REPARATII_LUNAR, metoda: "cota", serie: "Hotarare AG din 12.03.2026",
      emisa: null, scadenta: null, achitata: null, doc: "proces-verbal-ag-martie.pdf",
      esteFond: true,
    },
    parti: corecteazaRotunjirea(repartizeazaSimplu({ suma: FOND_REPARATII_LUNAR, metoda: "cota" }, luna), FOND_REPARATII_LUNAR),
  };
  randuri.push(fond);

  const perApartament = {};
  APARTAMENTE.forEach((ap) => {
    const linii = randuri
      .map((r) => ({
        cod: r.factura.cod,
        eticheta: r.factura.categorie,
        furnizor: r.factura.furnizor,
        metoda: r.factura.metoda,
        sumaFactura: r.factura.suma,
        serie: r.factura.serie,
        doc: r.factura.doc,
        esteFond: !!r.factura.esteFond,
        suma: r.parti[ap.id].suma,
        detaliu: r.parti[ap.id].detaliu,
        rotunjire: r.parti[ap.id].rotunjire,
      }))
      .filter((l) => l.suma > 0);
    const total = round2(linii.reduce((s, l) => s + l.suma, 0));
    perApartament[ap.id] = { linii, total };
  });

  const totalFacturi = round2(randuri.reduce((s, r) => s + r.factura.suma, 0));
  const totalRepartizat = round2(
    APARTAMENTE.reduce((s, ap) => s + perApartament[ap.id].total, 0)
  );

  return { luna, randuri, perApartament, totalFacturi, totalRepartizat };
}

const LISTE = {};
LUNI_DISPONIBILE.forEach((l) => { LISTE[l] = calculeazaLuna(l); });

function penalizare(apId) {
  const zile = ZILE_INTARZIERE[apId] || 0;
  const sold = SOLDURI_INITIALE[apId] || 0;
  if (zile <= 30 || sold <= 0) return 0;
  return round2((sold * PROCENT_PENALIZARE_ZI * (zile - 30)) / 100);
}

function deIncasat(apId, luna = LUNA_CURENTA) {
  return round2(LISTE[luna].perApartament[apId].total + (SOLDURI_INITIALE[apId] || 0) + penalizare(apId));
}

const PLATI_MELE = PLATI_META.map((p) => ({
  ...p,
  suma: LISTE[p.luna].perApartament[AP_UTILIZATOR.id].total,
}));

const STATISTICI = (() => {
  const lista = LISTE[LUNA_CURENTA];
  const totalLuna = lista.totalRepartizat;
  const restante = round2(APARTAMENTE.reduce((s, a) => s + (SOLDURI_INITIALE[a.id] || 0), 0));
  const penalizari = round2(APARTAMENTE.reduce((s, a) => s + penalizare(a.id), 0));
  const cuRestanta = APARTAMENTE.filter((a) => (SOLDURI_INITIALE[a.id] || 0) > 0).length;
  const achitate = APARTAMENTE.length - cuRestanta;
  return { totalLuna, restante, penalizari, cuRestanta, achitate, gradIncasare: Math.round((achitate / APARTAMENTE.length) * 100) };
})();

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

function Box({ row, gap, flex, style, className, children, ...rest }) {
  return (
    <div
      className={className}
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

function Txt({ size = 14, weight = 400, color = C.ink, mono, style, children, ...rest }) {
  return (
    <span
      style={{
        fontFamily: mono ? F.num : F.ui,
        fontSize: size,
        fontWeight: weight,
        color,
        lineHeight: 1.42,
        fontVariantNumeric: "tabular-nums",
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

function Press({ onPress, style, className = "", children, disabled, ...rest }) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={`ab-press ${className}`}
      onClick={disabled ? undefined : onPress}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPress && onPress(); }
      }}
      style={{ display: "flex", flexDirection: "column", opacity: disabled ? 0.45 : 1, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

function Btn({ label, onPress, variant = "primary", size = "md", full, disabled, style }) {
  const pal = {
    primary: { bg: C.accent, fg: "#FFFFFF", bd: C.accent },
    secondary: { bg: C.surface, fg: C.ink, bd: C.lineStrong },
    quiet: { bg: "transparent", fg: C.accent, bd: "transparent" },
    danger: { bg: C.dangerSoft, fg: C.danger, bd: "#E8CFCA" },
  }[variant];
  const pad = size === "sm" ? { padding: "6px 10px", fontSize: 12 } : { padding: "11px 16px", fontSize: 14 };
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
      <Txt size={pad.fontSize} weight={600} color={pal.fg}>{label}</Txt>
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
            style={{
              flex: 1,
              alignItems: "center",
              padding: small ? "5px 6px" : "8px 10px",
              borderRadius: R.sm,
              backgroundColor: activ ? C.surface : "transparent",
              border: `1px solid ${activ ? C.line : "transparent"}`,
            }}
          >
            <Txt size={small ? 11 : 13} weight={activ ? 700 : 500} color={activ ? C.ink : C.muted}>
              {o.label}
            </Txt>
          </Press>
        );
      })}
    </Box>
  );
}

function Field({ label, value, onChange, placeholder, suffix, hint, type = "text", multiline }) {
  const common = {
    width: "100%",
    fontFamily: F.ui,
    fontSize: 14,
    color: C.ink,
    backgroundColor: C.surface,
    border: `1px solid ${C.lineStrong}`,
    borderRadius: R.md,
    padding: "10px 12px",
    fontVariantNumeric: "tabular-nums",
  };
  return (
    <Box gap={S.xs}>
      {label && <Eyebrow>{label}</Eyebrow>}
      <Box row style={{ alignItems: "center", gap: S.sm }}>
        {multiline ? (
          <textarea
            className="ab-input"
            rows={3}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...common, resize: "vertical" }}
          />
        ) : (
          <input
            className="ab-input"
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            style={common}
          />
        )}
        {suffix && <Txt size={13} color={C.muted} weight={600}>{suffix}</Txt>}
      </Box>
      {hint && <Txt size={11} color={C.muted}>{hint}</Txt>}
    </Box>
  );
}

function Picker({ label, value, onChange, options }) {
  return (
    <Box gap={S.xs}>
      {label && <Eyebrow>{label}</Eyebrow>}
      <select
        className="ab-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontFamily: F.ui, fontSize: 14, color: C.ink, backgroundColor: C.surface,
          border: `1px solid ${C.lineStrong}`, borderRadius: R.md, padding: "10px 12px", width: "100%",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Box>
  );
}

function Switch({ value, onChange }) {
  return (
    <Press
      onPress={() => onChange(!value)}
      style={{
        width: 40, height: 24, borderRadius: R.pill, padding: 3,
        backgroundColor: value ? C.accent : C.lineStrong,
        flexDirection: "row", alignItems: "center",
        justifyContent: value ? "flex-end" : "flex-start",
      }}
    >
      <div style={{ width: 18, height: 18, borderRadius: R.pill, backgroundColor: "#FFFFFF" }} />
    </Press>
  );
}

/* Panou care urca de jos. Este singura miscare de tip slide din aplicatie. */
function Sheet({ open, onClose, titlu, children }) {
  if (!open) return null;
  return (
    <div
      className="ab-fade"
      onClick={onClose}
      style={{
        position: "absolute", inset: 0, backgroundColor: "rgba(20,24,21,.42)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end", zIndex: 40,
      }}
    >
      <div
        className="ab-slide-up ab-scroll"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: C.paper, borderTopLeftRadius: 18, borderTopRightRadius: 18,
          maxHeight: "88%", overflowY: "auto", borderTop: `1px solid ${C.line}`,
        }}
      >
        <Box style={{ position: "sticky", top: 0, backgroundColor: C.paper, zIndex: 1 }}>
          <Box row style={{ alignItems: "center", justifyContent: "space-between", padding: `${S.lg}px ${S.lg}px ${S.md}px` }}>
            <Txt size={16} weight={700}>{titlu}</Txt>
            <Press onPress={onClose} style={{ padding: 4 }}>
              <Txt size={20} color={C.muted} weight={400}>×</Txt>
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
      style={{
        position: "absolute", left: S.lg, right: S.lg, zIndex: 60,
        backgroundColor: C.ink, borderRadius: R.md, padding: "11px 14px",
      }}
    >
      <Txt size={13} weight={500} color="#F2F3F0">{mesaj}</Txt>
    </div>
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
    <Box row style={{ alignItems: "flex-end", justifyContent: "space-between", marginBottom: S.sm }}>
      <Box gap={2}>
        <Txt size={15} weight={700}>{children}</Txt>
        {sub && <Txt size={12} color={C.muted}>{sub}</Txt>}
      </Box>
      {actiune}
    </Box>
  );
}

/* Grafic de bare simplu, construit din View-uri, fara librarie de charting,
   ca sa functioneze identic pe web si pe mobil. */
function BareLunare({ serii, unitate = "mc", tone = C.accent }) {
  const max = Math.max(...serii.map((s) => s.valoare), 0.01);
  return (
    <Box row gap={S.sm} style={{ alignItems: "flex-end", height: 108 }}>
      {serii.map((s) => (
        <Box key={s.eticheta} flex={1} gap={S.xs} style={{ alignItems: "center" }}>
          <Txt size={10} weight={700} color={C.inkSoft}>{num(s.valoare, 1)}</Txt>
          <div
            style={{
              width: "100%",
              height: Math.max(4, (s.valoare / max) * 62),
              backgroundColor: s.accentuat ? tone : C.accentSoft,
              borderRadius: R.sm,
            }}
          />
          <Txt size={10} color={C.muted}>{s.eticheta}</Txt>
        </Box>
      ))}
    </Box>
  );
}

/* =============================================================================
   6. STARE PARTAJATA
   Un singur Context tine toata starea mutabila a mockup-ului. La integrarea cu
   un backend real, doar functiile de mai jos devin apeluri de retea.
============================================================================= */

const AppCtx = React.createContext(null);
const useApp = () => React.useContext(AppCtx);

/* =============================================================================
   7. ELEMENTUL SEMNATURA
   Randul din lista de intretinere care se desface si arata calculul complet.
   Restul aplicatiei este construit in jurul lui.
============================================================================= */

function RandLista({ linie, apartament }) {
  const [deschis, setDeschis] = useState(false);
  const m = METODE[linie.metoda];
  const procent = round2((linie.suma / linie.sumaFactura) * 100);

  return (
    <Box>
      <Press
        onPress={() => setDeschis(!deschis)}
        style={{ flexDirection: "row", alignItems: "center", gap: S.md, paddingTop: 11, paddingBottom: 11 }}
      >
        <Txt size={10} weight={700} color={C.muted} mono style={{ width: 20 }}>{linie.cod}</Txt>
        <Box flex={1} gap={1}>
          <Txt size={13.5} weight={600}>{linie.eticheta}</Txt>
          <Txt size={11} color={C.muted}>{m.eticheta}</Txt>
        </Box>
        <Lei value={linie.suma} size={14} />
        <Txt size={11} color={C.muted} style={{ width: 10, textAlign: "right" }}>{deschis ? "−" : "+"}</Txt>
      </Press>

      {deschis && (
        <Box
          className="ab-fade"
          gap={S.md}
          style={{
            borderLeft: `2px solid ${C.accent}`,
            paddingLeft: S.md,
            marginLeft: 4,
            marginBottom: S.md,
          }}
        >
          <Txt size={12.5} color={C.inkSoft}>{m.explic}</Txt>

          {linie.metoda === "consum" ? (
            <Box gap={6} style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.md }}>
              <RandCalcul st="Contor general al blocului" dr={`${num(linie.detaliu.contorGeneral, 1)} mc`} />
              <RandCalcul st="Suma contoarelor din apartamente" dr={`${num(linie.detaliu.sumaContoare, 1)} mc`} />
              <RandCalcul st="Diferenta pe coloana" dr={`${num(linie.detaliu.diferenta, 1)} mc`} accent />
              <Line style={{ marginTop: 2, marginBottom: 2 }} />
              <RandCalcul st="Pret pe metru cub" dr={`${num(linie.detaliu.pretMc)} lei`} />
              <RandCalcul st="Consumul apartamentului" dr={`${num(linie.detaliu.consumPropriu)} mc`} />
              <RandCalcul st={`Cota din diferenta, ${apartament.pers} din ${TOTAL_PERSOANE} pers.`} dr={`${num(linie.detaliu.cotaDiferenta)} mc`} />
              <Line style={{ marginTop: 2, marginBottom: 2 }} />
              <RandCalcul
                st={`(${num(linie.detaliu.consumPropriu)} + ${num(linie.detaliu.cotaDiferenta)}) × ${num(linie.detaliu.pretMc)}`}
                dr={lei(linie.suma)}
                bold
              />
            </Box>
          ) : (
            <Box gap={6} style={{ backgroundColor: C.paper, borderRadius: R.md, padding: S.md }}>
              <RandCalcul st="Suma de repartizat" dr={lei(linie.sumaFactura)} />
              <RandCalcul
                st="Baza de calcul, tot blocul"
                dr={etichetaBaza(linie.detaliu.baza.total, linie.detaliu.baza.um)}
              />
              <RandCalcul
                st="Baza apartamentului"
                dr={etichetaBaza(linie.detaliu.baza.valoare, linie.detaliu.baza.um)}
              />
              <Line style={{ marginTop: 2, marginBottom: 2 }} />
              <RandCalcul
                st={`${lei(linie.sumaFactura, false)} × ${num(linie.detaliu.baza.valoare, linie.detaliu.baza.um === "%" ? 2 : 0)} ÷ ${num(linie.detaliu.baza.total, linie.detaliu.baza.um === "%" ? 0 : 0)}`}
                dr={lei(linie.suma)}
                bold
              />
            </Box>
          )}

          {linie.rotunjire ? (
            <Txt size={11} color={C.muted}>
              Include {lei(linie.rotunjire)} din rotunjirea la ban a intregii repartitii.
            </Txt>
          ) : null}

          <Box gap={2}>
            <Eyebrow>Documentul justificativ</Eyebrow>
            <Txt size={12.5} weight={600}>{linie.furnizor}</Txt>
            <Txt size={12} color={C.muted}>
              {linie.esteFond ? linie.serie : `Factura ${linie.serie}, ${lei(linie.sumaFactura)}`}
            </Txt>
          </Box>

          <Box row gap={S.sm} style={{ alignItems: "center" }}>
            <Btn label="Vezi documentul" variant="secondary" size="sm" onPress={() => {}} />
            <Txt size={11} color={C.muted}>{linie.doc}</Txt>
          </Box>

          <Txt size={11} color={C.muted}>
            Apartamentul suporta {num(procent, 2)}% din aceasta cheltuiala.
          </Txt>
        </Box>
      )}
    </Box>
  );
}

function etichetaBaza(valoare, um) {
  if (um === "apartamente") return valoare === 1 ? "1 apartament" : `${num(valoare, 0)} apartamente`;
  if (um === "%") return `${num(valoare, 2)}%`;
  return `${num(valoare, 0)} ${um}`;
}

function RandCalcul({ st, dr, bold, accent }) {
  return (
    <Box row style={{ justifyContent: "space-between", alignItems: "baseline", gap: S.md }}>
      <Txt size={12} color={accent ? C.warn : bold ? C.ink : C.inkSoft} weight={bold ? 700 : 400}>{st}</Txt>
      <Txt size={12.5} weight={bold ? 700 : 600} mono color={accent ? C.warn : C.ink} style={{ whiteSpace: "nowrap" }}>{dr}</Txt>
    </Box>
  );
}

/* =============================================================================
   8. ECRANE LOCATAR
============================================================================= */

function AntetEcran({ eyebrow: eb, titlu, dreapta }) {
  return (
    <Box row style={{ alignItems: "flex-start", justifyContent: "space-between", marginBottom: S.lg }}>
      <Box gap={3}>
        <Eyebrow>{eb}</Eyebrow>
        <Txt size={22} weight={700} style={{ letterSpacing: -0.4 }}>{titlu}</Txt>
      </Box>
      {dreapta}
    </Box>
  );
}

function LocatarAcasa({ go }) {
  const { platit, sesizari, anunturi, indexTransmis } = useApp();
  const ap = AP_UTILIZATOR;
  const lista = LISTE[LUNA_CURENTA].perApartament[ap.id];
  const esteAchitat = platit.includes(LUNA_CURENTA);
  const scadenta = "2026-08-25";
  const zile = zileDe(scadenta);
  const consumLuna = CONSUM[LUNA_CURENTA][ap.id];
  const mediaBloc = round2(
    APARTAMENTE.reduce((s, a) => s + CONSUM[LUNA_CURENTA][a.id].rece / a.pers, 0) / APARTAMENTE.length
  );
  const alMeuPePersoana = round2(consumLuna.rece / ap.pers);
  const sesiuneaMea = sesizari.filter((s) => s.ap === ap.id && s.stare !== "rezolvata");

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`${BLOC.nume}, ap. ${ap.nr}`} titlu="Buna, Elena" />

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <Box style={{ padding: S.lg }} gap={S.md}>
          <Box row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <Box gap={3}>
              <Eyebrow>Intretinere {monthLabel(LUNA_CURENTA)}</Eyebrow>
              <Lei value={lista.total} size={34} weight={700} />
            </Box>
            <Badge label={esteAchitat ? "Achitat" : zile > 0 ? `${zile} zile` : "Scadent"} tone={esteAchitat ? "ok" : zile > 5 ? "neutral" : "warn"} />
          </Box>
          <Txt size={12.5} color={C.muted}>
            Termen de plata {dataRo(scadenta)}. Dupa 30 de zile de la scadenta se calculeaza penalizari de {num(PROCENT_PENALIZARE_ZI)}% pe zi.
          </Txt>
          {!esteAchitat && (
            <Box row gap={S.sm}>
              <Btn label="Plateste acum" onPress={() => go("plata")} />
              <Btn label="Vezi defalcarea" variant="secondary" onPress={() => go("plata")} />
            </Box>
          )}
          {esteAchitat && <Btn label="Descarca chitanta" variant="secondary" onPress={() => {}} />}
        </Box>
        <Line />
        <Press onPress={() => go("plata")} style={{ padding: S.md, paddingLeft: S.lg, paddingRight: S.lg, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Txt size={12.5} color={C.inkSoft}>
            {lista.linii.length} cheltuieli, fiecare cu factura la vedere
          </Txt>
          <Txt size={13} color={C.accent} weight={700}>›</Txt>
        </Press>
      </Card>

      <Box gap={S.sm}>
        <Titlu sub="Ce urmeaza in perioada urmatoare">De facut</Titlu>
        {!indexTransmis && (
          <SarcinaRand
            eticheta="Transmite indexul contoarelor"
            detaliu={`Termen 25 august, mai sunt ${zileDe("2026-08-25")} zile`}
            tone="warn"
            onPress={() => go("consum")}
          />
        )}
        {!esteAchitat && (
          <SarcinaRand
            eticheta={`Plateste intretinerea pe ${monthLabel(LUNA_CURENTA)}`}
            detaliu={`${lei(lista.total)}, termen ${dataRo(scadenta)}`}
            tone="accent"
            onPress={() => go("plata")}
          />
        )}
        <SarcinaRand
          eticheta="Voteaza pentru usa de la intrare"
          detaliu="Votul se inchide pe 3 septembrie"
          tone="info"
          onPress={() => go("bloc")}
        />
      </Box>

      <Box gap={S.sm}>
        <Titlu actiune={<Press onPress={() => go("bloc")}><Txt size={12} weight={700} color={C.accent}>Toate</Txt></Press>}>
          De la avizier
        </Titlu>
        {anunturi.slice(0, 2).map((a) => (
          <Card key={a.id} pad={S.md} gap={S.xs}>
            <Box row gap={S.sm} style={{ alignItems: "center" }}>
              {a.important && <Badge label="Urgent" tone="danger" />}
              <Txt size={11} color={C.muted}>{dataRo(a.data)}</Txt>
            </Box>
            <Txt size={13.5} weight={600}>{a.titlu}</Txt>
            <Txt size={12.5} color={C.inkSoft} style={{
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>{a.corp}</Txt>
          </Card>
        ))}
      </Box>

      <Card gap={S.md}>
        <Titlu sub="Apa rece consumata pe persoana in iulie">Consumul tau fata de bloc</Titlu>
        <Box gap={S.sm}>
          <ComparatieRand eticheta="Apartamentul tau" valoare={alMeuPePersoana} max={Math.max(alMeuPePersoana, mediaBloc)} tone={C.accent} />
          <ComparatieRand eticheta="Media blocului" valoare={mediaBloc} max={Math.max(alMeuPePersoana, mediaBloc)} tone={C.lineStrong} />
        </Box>
        <Txt size={12} color={C.muted}>
          {alMeuPePersoana <= mediaBloc
            ? `Consumi cu ${num(mediaBloc - alMeuPePersoana)} mc mai putin decat media pe persoana.`
            : `Consumi cu ${num(alMeuPePersoana - mediaBloc)} mc mai mult decat media pe persoana.`}
        </Txt>
      </Card>

      {sesiuneaMea.length > 0 && (
        <Box gap={S.sm}>
          <Titlu>Sesizarile tale</Titlu>
          {sesiuneaMea.map((s) => (
            <Press key={s.id} onPress={() => go("sesizari")}>
              <Card pad={S.md} gap={S.xs}>
                <Box row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Txt size={13.5} weight={600}>{s.titlu}</Txt>
                  <StareBadge stare={s.stare} />
                </Box>
                {s.raspuns && <Txt size={12.5} color={C.inkSoft}>Raspuns: {s.raspuns}</Txt>}
              </Card>
            </Press>
          ))}
        </Box>
      )}
    </Box>
  );
}

function SarcinaRand({ eticheta, detaliu, tone = "accent", onPress }) {
  const culoare = { warn: C.warn, accent: C.accent, info: C.info, danger: C.danger }[tone];
  return (
    <Press onPress={onPress}>
      <Card pad={S.md} style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
        <div style={{ width: 3, alignSelf: "stretch", backgroundColor: culoare, borderRadius: R.pill }} />
        <Box flex={1} gap={2}>
          <Txt size={13.5} weight={600}>{eticheta}</Txt>
          <Txt size={12} color={C.muted}>{detaliu}</Txt>
        </Box>
        <Txt size={14} color={C.muted}>›</Txt>
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
      <Bar value={(valoare / max) * 100} tone={tone} height={8} />
    </Box>
  );
}

function StareBadge({ stare }) {
  const map = {
    noua: ["Noua", "danger"],
    "in lucru": ["In lucru", "warn"],
    rezolvata: ["Rezolvata", "ok"],
  }[stare];
  return <Badge label={map[0]} tone={map[1]} />;
}

function LocatarPlata() {
  const { platit, plateste } = useApp();
  const [luna, setLuna] = useState(LUNA_CURENTA);
  const [tab, setTab] = useState("lista");
  const ap = AP_UTILIZATOR;
  const lista = LISTE[luna].perApartament[ap.id];
  const esteAchitat = platit.includes(luna);
  const cheltuieli = lista.linii.filter((l) => !l.esteFond);
  const fond = lista.linii.filter((l) => l.esteFond);
  const totalCheltuieli = round2(cheltuieli.reduce((s, l) => s + l.suma, 0));

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`Apartament ${ap.nr}, ${ap.pers} persoane, cota ${num(ap.cota)}%`} titlu="Intretinere" />

      <Segment
        value={tab}
        onChange={setTab}
        options={[{ value: "lista", label: "Lista de plata" }, { value: "istoric", label: "Platile mele" }]}
      />

      {tab === "lista" ? (
        <>
          <Segment
            small
            value={luna}
            onChange={setLuna}
            options={LUNI_DISPONIBILE.map((l) => ({ value: l, label: monthShort(l) }))}
          />

          <Card gap={S.md}>
            <Box row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <Box gap={3}>
                <Eyebrow>Total de plata, {monthLabel(luna)}</Eyebrow>
                <Lei value={lista.total} size={30} weight={700} />
              </Box>
              {esteAchitat && <Badge label="Achitat" tone="ok" />}
            </Box>
            {!esteAchitat && luna === LUNA_CURENTA && (
              <Btn label="Plateste cu cardul" full onPress={() => plateste(luna, lista.total)} />
            )}
            <Txt size={11.5} color={C.muted}>
              Apasa pe orice rand ca sa vezi factura din spatele lui si formula exacta de impartire.
            </Txt>
          </Card>

          <Card pad={0}>
            <Box style={{ padding: `${S.md}px ${S.lg}px` }}>
              <Eyebrow>Cheltuieli repartizate</Eyebrow>
            </Box>
            <Line />
            <Box style={{ paddingLeft: S.lg, paddingRight: S.lg }}>
              {cheltuieli.map((l, i) => (
                <Box key={l.cod}>
                  {i > 0 && <Line />}
                  <RandLista linie={l} apartament={ap} />
                </Box>
              ))}
            </Box>
            <Line />
            <Box row style={{ padding: `${S.md}px ${S.lg}px`, justifyContent: "space-between" }}>
              <Txt size={13} weight={700}>Subtotal cheltuieli</Txt>
              <Lei value={totalCheltuieli} size={14} weight={700} />
            </Box>
          </Card>

          <Card pad={0}>
            <Box style={{ padding: `${S.md}px ${S.lg}px` }}>
              <Eyebrow>Contributii la fonduri</Eyebrow>
            </Box>
            <Line />
            <Box style={{ paddingLeft: S.lg, paddingRight: S.lg }}>
              {fond.map((l) => <RandLista key={l.cod} linie={l} apartament={ap} />)}
            </Box>
          </Card>

          <Card gap={S.sm} style={{ backgroundColor: C.accentSoft, borderColor: "#CBDDD6" }}>
            <Txt size={13} weight={700} color={C.accentInk}>Verificarea repartitiei</Txt>
            <RandCalcul st="Total facturi si fonduri pe luna" dr={lei(LISTE[luna].totalFacturi)} />
            <RandCalcul st="Total repartizat pe cele 20 de apartamente" dr={lei(LISTE[luna].totalRepartizat)} />
            <Line style={{ backgroundColor: "#CBDDD6" }} />
            <RandCalcul st="Diferenta" dr={lei(LISTE[luna].totalFacturi - LISTE[luna].totalRepartizat)} bold />
            <Txt size={11.5} color={C.accentInk}>
              Suma facturilor primite de asociatie este egala cu suma repartizata catre proprietari. Nimic nu ramane nealocat.
            </Txt>
          </Card>
        </>
      ) : (
        <Box gap={S.sm}>
          {PLATI_MELE.map((p) => (
            <Card key={p.id} pad={S.md} style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
              <Box flex={1} gap={2}>
                <Txt size={13.5} weight={600}>Intretinere {monthLabel(p.luna)}</Txt>
                <Txt size={11.5} color={C.muted}>{dataRo(p.data)}, {p.metoda}</Txt>
                <Txt size={11} color={C.muted}>Chitanta {p.chitanta}</Txt>
              </Box>
              <Box gap={S.xs} style={{ alignItems: "flex-end" }}>
                <Lei value={p.suma} size={14} />
                <Badge label="Achitat" tone="ok" />
              </Box>
            </Card>
          ))}
          <Card gap={S.sm}>
            <Titlu sub="Intretinerea pe ultimele trei luni">Cat ai platit</Titlu>
            <BareLunare
              serii={LUNI_DISPONIBILE.slice().reverse().map((l, i, arr) => ({
                eticheta: LUNI_S[Number(l.split("-")[1]) - 1],
                valoare: LISTE[l].perApartament[AP_UTILIZATOR.id].total,
                accentuat: i === arr.length - 1,
              }))}
              unitate="lei"
            />
          </Card>
        </Box>
      )}
    </Box>
  );
}

function LocatarConsum() {
  const { indexTransmis, transmiteIndex, toastMsg } = useApp();
  const ap = AP_UTILIZATOR;
  const ultim = INDEXURI_MELE[0];
  const [rece, setRece] = useState("");
  const [calda, setCalda] = useState("");

  const consumRece = rece === "" ? null : round2(Number(rece) - ultim.receNou);
  const consumCalda = calda === "" ? null : round2(Number(calda) - ultim.caldaNou);
  const eroareRece = rece !== "" && Number(rece) < ultim.receNou;
  const eroareCalda = calda !== "" && Number(calda) < ultim.caldaNou;
  const potTrimite = rece !== "" && calda !== "" && !eroareRece && !eroareCalda;

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`Apartament ${ap.nr}`} titlu="Contoare" />

      {indexTransmis ? (
        <Card gap={S.sm} style={{ backgroundColor: C.okSoft, borderColor: "#C9DED0" }}>
          <Badge label="Trimis" tone="ok" />
          <Txt size={13.5} weight={600} color={C.ok}>Indexul pe august a ajuns la administrator</Txt>
          <Txt size={12.5} color={C.inkSoft}>
            Il poti corecta pana pe 25 august. Dupa validare intra in lista de plata pe august.
          </Txt>
        </Card>
      ) : (
        <Card gap={S.lg}>
          <Box gap={3}>
            <Box row gap={S.sm} style={{ alignItems: "center" }}>
              <Badge label={`Termen ${zileDe("2026-08-25")} zile`} tone="warn" />
            </Box>
            <Txt size={15} weight={700}>Citirea pentru august</Txt>
            <Txt size={12.5} color={C.muted}>
              Introdu cifrele negre de pe cadran, fara zecimalele rosii. Daca nu transmiti pana pe 25, primesti consum estimat pe media ultimelor trei luni.
            </Txt>
          </Box>

          <Box gap={S.md}>
            <Field
              label={`Apa rece, index anterior ${num(ultim.receNou, 1)}`}
              value={rece}
              onChange={setRece}
              placeholder={num(ultim.receNou, 1)}
              suffix="mc"
              type="number"
              hint={
                eroareRece
                  ? "Indexul nou nu poate fi mai mic decat cel anterior. Verifica cifrele."
                  : consumRece !== null
                    ? `Consum calculat: ${num(consumRece)} mc`
                    : null
              }
            />
            <Field
              label={`Apa calda, index anterior ${num(ultim.caldaNou, 1)}`}
              value={calda}
              onChange={setCalda}
              placeholder={num(ultim.caldaNou, 1)}
              suffix="mc"
              type="number"
              hint={
                eroareCalda
                  ? "Indexul nou nu poate fi mai mic decat cel anterior. Verifica cifrele."
                  : consumCalda !== null
                    ? `Consum calculat: ${num(consumCalda)} mc`
                    : null
              }
            />
          </Box>

          <Box row gap={S.sm}>
            <Btn label="Trimite indexul" onPress={transmiteIndex} disabled={!potTrimite} />
            <Btn label="Adauga poza contorului" variant="secondary" onPress={() => toastMsg("Camera nu este disponibila in mockup")} />
          </Box>
        </Card>
      )}

      <Card gap={S.md}>
        <Titlu sub="Apa rece, metri cubi pe luna">Cum a evoluat consumul</Titlu>
        <BareLunare
          serii={LUNI_DISPONIBILE.slice().reverse().map((l, i, arr) => ({
            eticheta: LUNI_S[Number(l.split("-")[1]) - 1],
            valoare: CONSUM[l][ap.id].rece,
            accentuat: i === arr.length - 1,
          }))}
        />
      </Card>

      <Box gap={S.sm}>
        <Titlu sub="Indexurile transmise si validate">Istoric</Titlu>
        <Card pad={0}>
          {INDEXURI_MELE.map((ix, i) => (
            <Box key={ix.luna}>
              {i > 0 && <Line />}
              <Box style={{ padding: S.md }} gap={S.sm}>
                <Box row style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Txt size={13} weight={700}>{monthLabel(ix.luna)}</Txt>
                  <Badge label={ix.stare === "validat" ? "Validat" : "Estimat"} tone={ix.stare === "validat" ? "ok" : "warn"} />
                </Box>
                <Box row gap={S.lg}>
                  <Box gap={2} flex={1}>
                    <Eyebrow>Apa rece</Eyebrow>
                    <Txt size={12.5} mono>{num(ix.receVechi, 1)} → {num(ix.receNou, 1)}</Txt>
                    <Txt size={11.5} color={C.muted}>{num(ix.receNou - ix.receVechi)} mc consumati</Txt>
                  </Box>
                  <Box gap={2} flex={1}>
                    <Eyebrow>Apa calda</Eyebrow>
                    <Txt size={12.5} mono>{num(ix.caldaVechi, 1)} → {num(ix.caldaNou, 1)}</Txt>
                    <Txt size={11.5} color={C.muted}>{num(ix.caldaNou - ix.caldaVechi)} mc consumati</Txt>
                  </Box>
                </Box>
              </Box>
            </Box>
          ))}
        </Card>
      </Box>

      <Card gap={S.sm} style={{ backgroundColor: C.paperDeep, borderColor: C.lineStrong }}>
        <Txt size={13} weight={700}>De ce plateste blocul mai mult decat suma contoarelor</Txt>
        <Txt size={12.5} color={C.inkSoft}>
          In iulie contorul de la subsol a inregistrat {num(CONTOR_GENERAL[LUNA_CURENTA].rece, 1)} mc, iar contoarele din apartamente au insumat {num(APARTAMENTE.reduce((s, a) => s + CONSUM[LUNA_CURENTA][a.id].rece, 0), 1)} mc. Diferenta vine din pierderi pe coloana, robinete care picura si contoare care nu mai masoara corect. Se imparte pe numarul de persoane.
        </Txt>
      </Card>
    </Box>
  );
}

const CATEGORII_SESIZARI = [
  { value: "Instalatii", label: "Instalatii, apa, canalizare" },
  { value: "Iluminat", label: "Iluminat si electrice" },
  { value: "Acces", label: "Usa, interfon, lift" },
  { value: "Curatenie", label: "Curatenie si gunoi" },
  { value: "Altele", label: "Altele" },
];

function LocatarSesizari() {
  const { sesizari, adaugaSesizare, toastMsg } = useApp();
  const ap = AP_UTILIZATOR;
  const [tab, setTab] = useState("ale mele");
  const [deschis, setDeschis] = useState(false);
  const [titlu, setTitlu] = useState("");
  const [categorie, setCategorie] = useState("Instalatii");
  const [desc, setDesc] = useState("");

  const vizibile = tab === "ale mele" ? sesizari.filter((s) => s.ap === ap.id) : sesizari;

  const trimite = () => {
    if (!titlu.trim()) return;
    adaugaSesizare({ titlu: titlu.trim(), categorie, desc: desc.trim(), ap: ap.id });
    setTitlu(""); setDesc(""); setDeschis(false);
  };

  return (
    <Box gap={S.lg}>
      <AntetEcran
        eyebrow={BLOC.nume}
        titlu="Sesizari"
        dreapta={<Btn label="Sesizare noua" size="sm" onPress={() => setDeschis(true)} />}
      />

      <Segment
        value={tab}
        onChange={setTab}
        options={[{ value: "ale mele", label: "Ale mele" }, { value: "bloc", label: "Din tot blocul" }]}
      />

      {vizibile.length === 0 ? (
        <Gol
          titlu="Nicio sesizare deschisa"
          text="Cand ceva nu functioneaza pe scara sau in apartament, scrie aici. Administratorul vede sesizarea imediat."
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
                    {s.categorie} · {dataRo(s.creata)}{tab === "bloc" ? ` · ap. ${s.ap}` : ""}
                  </Txt>
                </Box>
                <StareBadge stare={s.stare} />
              </Box>
              <Txt size={12.5} color={C.inkSoft}>{s.desc}</Txt>
              {s.poze > 0 && (
                <Box row gap={S.xs}>
                  {Array.from({ length: s.poze }).map((_, i) => (
                    <div key={i} style={{ width: 44, height: 44, borderRadius: R.sm, backgroundColor: C.paperDeep, border: `1px solid ${C.line}` }} />
                  ))}
                </Box>
              )}
              {s.raspuns && (
                <Box style={{ borderLeft: `2px solid ${C.accent}`, paddingLeft: S.sm }} gap={2}>
                  <Eyebrow color={C.accent}>Raspuns administrator</Eyebrow>
                  <Txt size={12.5} color={C.inkSoft}>{s.raspuns}</Txt>
                </Box>
              )}
            </Card>
          ))}
        </Box>
      )}

      <Sheet open={deschis} onClose={() => setDeschis(false)} titlu="Sesizare noua">
        <Field label="Despre ce este vorba" value={titlu} onChange={setTitlu} placeholder="Scrie pe scurt problema" />
        <Picker label="Categorie" value={categorie} onChange={setCategorie} options={CATEGORII_SESIZARI} />
        <Field label="Detalii" value={desc} onChange={setDesc} multiline placeholder="Unde este problema si de cand" />
        <Btn label="Adauga fotografie" variant="secondary" onPress={() => toastMsg("Camera nu este disponibila in mockup")} />
        <Btn label="Trimite sesizarea" full onPress={trimite} disabled={!titlu.trim()} />
      </Sheet>
    </Box>
  );
}

function LocatarBloc() {
  const { anunturi, vot, votulMeu, voteaza, toastMsg } = useApp();
  const [tab, setTab] = useState("avizier");
  const totalVoturi = vot.optiuni.reduce((s, o) => s + o.voturi, 0);

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={BLOC.adresa} titlu={BLOC.nume} />

      <Segment
        small
        value={tab}
        onChange={setTab}
        options={[
          { value: "avizier", label: "Avizier" },
          { value: "vot", label: "Vot" },
          { value: "acte", label: "Acte" },
          { value: "bani", label: "Bani" },
        ]}
      />

      {tab === "avizier" && (
        <Box gap={S.sm}>
          {anunturi.map((a) => (
            <Card key={a.id} gap={S.sm}>
              <Box row gap={S.sm} style={{ alignItems: "center" }}>
                {a.important && <Badge label="Urgent" tone="danger" />}
                <Txt size={11.5} color={C.muted}>{dataRo(a.data)} · {a.autor}</Txt>
              </Box>
              <Txt size={15} weight={700}>{a.titlu}</Txt>
              <Txt size={13} color={C.inkSoft}>{a.corp}</Txt>
            </Card>
          ))}
          <Card gap={S.sm}>
            <Titlu>Pe cine suni</Titlu>
            <ContactRand rol="Administrator" nume={BLOC.administrator.nume} detaliu={BLOC.administrator.program} tel={BLOC.administrator.tel} />
            <Line />
            <ContactRand rol="Presedinte" nume={BLOC.presedinte.nume} detaliu={`Apartament ${BLOC.presedinte.ap}`} tel={BLOC.presedinte.tel} />
            <Line />
            <ContactRand rol="Cenzor" nume={BLOC.cenzor.nume} detaliu={`Apartament ${BLOC.cenzor.ap}`} tel={BLOC.cenzor.tel} />
            <Line />
            <ContactRand rol="Urgente lift" nume="Elmas Lift Service" detaliu="Non stop" tel="0800 800 112" />
          </Card>
        </Box>
      )}

      {tab === "vot" && (
        <Box gap={S.md}>
          <Card gap={S.md}>
            <Box gap={3}>
              <Box row gap={S.sm}>
                <Badge label="Vot deschis" tone="accent" />
                <Badge label={`${zileDe(vot.inchide)} zile ramase`} />
              </Box>
              <Txt size={17} weight={700}>{vot.titlu}</Txt>
              <Txt size={13} color={C.inkSoft}>{vot.descriere}</Txt>
            </Box>
            <Line />
            {votulMeu ? (
              <Box gap={S.md}>
                <Txt size={12.5} color={C.ok} weight={600}>Ai votat. Rezultatele se actualizeaza in timp real.</Txt>
                {vot.optiuni.map((o) => {
                  const pct = totalVoturi ? Math.round((o.voturi / totalVoturi) * 100) : 0;
                  return (
                    <Box key={o.id} gap={S.xs}>
                      <Box row style={{ justifyContent: "space-between", gap: S.sm }}>
                        <Txt size={12.5} weight={votulMeu === o.id ? 700 : 400}>
                          {o.text}{votulMeu === o.id ? " · votul tau" : ""}
                        </Txt>
                        <Txt size={12.5} weight={700} mono>{pct}%</Txt>
                      </Box>
                      <Bar value={pct} tone={votulMeu === o.id ? C.accent : C.lineStrong} />
                      <Txt size={11} color={C.muted}>{o.voturi} voturi</Txt>
                    </Box>
                  );
                })}
                <Txt size={11.5} color={C.muted}>
                  Au votat {vot.votanti} din {TOTAL_APARTAMENTE} apartamente. Hotararea este valabila la peste jumatate din cotele indivize.
                </Txt>
              </Box>
            ) : (
              <Box gap={S.sm}>
                <Eyebrow>Alege o varianta</Eyebrow>
                {vot.optiuni.map((o) => (
                  <Press key={o.id} onPress={() => voteaza(o.id)}>
                    <Box row style={{
                      border: `1px solid ${C.lineStrong}`, borderRadius: R.md, padding: S.md,
                      alignItems: "center", gap: S.md, backgroundColor: C.surface,
                    }}>
                      <div style={{ width: 16, height: 16, borderRadius: R.pill, border: `2px solid ${C.lineStrong}` }} />
                      <Txt size={13} style={{ flex: 1 }}>{o.text}</Txt>
                    </Box>
                  </Press>
                ))}
                <Txt size={11.5} color={C.muted}>
                  Votul se inregistreaza pe apartament si apare in procesul verbal al adunarii generale.
                </Txt>
              </Box>
            )}
          </Card>

          <Card gap={S.sm}>
            <Titlu sub="Convocare trimisa pe 20 august">Adunarea generala din 3 septembrie</Titlu>
            <Txt size={12.5} color={C.inkSoft}>
              Ora 18:30, la parter langa boxe. Ordinea de zi: executia bugetului pe primul semestru, oferta pentru usa de la intrare, si stabilirea cotei de fond de reparatii pentru 2027.
            </Txt>
            <Box row gap={S.sm}>
              <Btn label="Particip" size="sm" onPress={() => toastMsg("Participarea a fost inregistrata")} />
              <Btn label="Trimit imputernicire" size="sm" variant="secondary" onPress={() => toastMsg("Formular de imputernicire trimis pe email")} />
            </Box>
          </Card>
        </Box>
      )}

      {tab === "acte" && (
        <Box gap={S.sm}>
          <Txt size={12.5} color={C.muted}>
            Toate documentele asociatiei, disponibile permanent pentru orice proprietar.
          </Txt>
          <Card pad={0}>
            {DOCUMENTE.map((d, i) => (
              <Box key={d.id}>
                {i > 0 && <Line />}
                <Press onPress={() => toastMsg(`Se deschide ${d.nume}`)}>
                  <Box row style={{ padding: S.md, alignItems: "center", gap: S.md }}>
                    <Box style={{
                      width: 34, height: 42, borderRadius: R.sm, backgroundColor: C.paperDeep,
                      border: `1px solid ${C.line}`, alignItems: "center", justifyContent: "center",
                    }}>
                      <Txt size={8} weight={700} color={C.muted}>PDF</Txt>
                    </Box>
                    <Box flex={1} gap={2}>
                      <Txt size={13} weight={600}>{d.nume}</Txt>
                      <Txt size={11.5} color={C.muted}>{d.tip} · {dataRo(d.data)} · {d.marime}</Txt>
                    </Box>
                    <Txt size={14} color={C.muted}>›</Txt>
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
            <Card flex={1} pad={S.md} gap={3}>
              <Eyebrow>Fond de reparatii</Eyebrow>
              <Lei value={FONDURI.reparatii.sold} size={19} />
              <Txt size={11} color={C.muted}>sold la 31 iulie</Txt>
            </Card>
            <Card flex={1} pad={S.md} gap={3}>
              <Eyebrow>Fond de rulment</Eyebrow>
              <Lei value={FONDURI.rulment.sold} size={19} />
              <Txt size={11} color={C.muted}>{lei(FONDURI.rulment.perApartament)} pe apartament</Txt>
            </Card>
          </Box>

          <Card gap={S.md}>
            <Titlu sub="Din fondul de reparatii, ultimele miscari">Unde s-au dus banii</Titlu>
            {MISCARI_FOND.map((m, i) => (
              <Box key={m.id} gap={S.sm}>
                {i > 0 && <Line />}
                <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm, paddingTop: i > 0 ? S.sm : 0 }}>
                  <Box gap={2} flex={1}>
                    <Txt size={13}>{m.desc}</Txt>
                    <Txt size={11} color={C.muted}>{dataRo(m.data)}{m.doc ? ` · ${m.doc}` : ""}</Txt>
                  </Box>
                  <Lei value={m.suma} size={13} color={m.suma < 0 ? C.danger : C.ok} />
                </Box>
              </Box>
            ))}
          </Card>

          <Card gap={S.md}>
            <Titlu sub={`${monthLabel(LUNA_CURENTA)}, la nivel de bloc`}>Situatia incasarilor</Titlu>
            <Box gap={S.xs}>
              <Box row style={{ justifyContent: "space-between" }}>
                <Txt size={12.5} color={C.inkSoft}>Apartamente fara restanta</Txt>
                <Txt size={12.5} weight={700} mono>{STATISTICI.achitate} din {TOTAL_APARTAMENTE}</Txt>
              </Box>
              <Bar value={STATISTICI.gradIncasare} />
            </Box>
            <Txt size={12.5} color={C.inkSoft}>
              Restantele totale ale blocului sunt {lei(STATISTICI.restante)}. Ele intarzie platile catre furnizori, de aceea apar penalizari care se suporta din fondul comun.
            </Txt>
          </Card>
        </Box>
      )}
    </Box>
  );
}

function ContactRand({ rol, nume, detaliu, tel }) {
  return (
    <Box row style={{ justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
      <Box gap={2} flex={1}>
        <Eyebrow>{rol}</Eyebrow>
        <Txt size={13} weight={600}>{nume}</Txt>
        <Txt size={11.5} color={C.muted}>{detaliu}</Txt>
      </Box>
      <Btn label={tel} variant="secondary" size="sm" onPress={() => {}} />
    </Box>
  );
}

/* =============================================================================
   9. ECRANE ADMINISTRATOR
============================================================================= */

function Kpi({ eticheta, valoare, sub, tone, flex = 1 }) {
  return (
    <Card flex={flex} pad={S.md} gap={3}>
      <Eyebrow>{eticheta}</Eyebrow>
      <Txt size={19} weight={700} color={tone || C.ink} style={{ letterSpacing: -0.3 }}>{valoare}</Txt>
      {sub && <Txt size={11} color={C.muted}>{sub}</Txt>}
    </Card>
  );
}

function AdminSumar({ go }) {
  const { sesizari, toastMsg, incasari } = useApp();
  const lista = LISTE[LUNA_CURENTA];
  const deschise = sesizari.filter((s) => s.stare !== "rezolvata").length;
  const restantieri = APARTAMENTE
    .filter((a) => (SOLDURI_INITIALE[a.id] || 0) > 0)
    .sort((a, b) => SOLDURI_INITIALE[b.id] - SOLDURI_INITIALE[a.id]);
  const incasat = APARTAMENTE.filter((a) => incasari.includes(a.id)).length;
  const facturiNeachitate = FACTURI[LUNA_CURENTA].filter((f) => !f.achitata);

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`${BLOC.cod} · ${TOTAL_APARTAMENTE} apartamente`} titlu="Panou administrator" />

      <Card gap={S.md}>
        <Box row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Box gap={3}>
            <Eyebrow>Lista de plata {monthLabel(LUNA_CURENTA)}</Eyebrow>
            <Lei value={lista.totalRepartizat} size={26} weight={700} />
          </Box>
          <Badge label="Afisata pe 8 aug" tone="ok" />
        </Box>
        <Box gap={S.xs}>
          <Box row style={{ justifyContent: "space-between" }}>
            <Txt size={12} color={C.inkSoft}>Incasat de la {incasat} din {TOTAL_APARTAMENTE} apartamente</Txt>
            <Txt size={12} weight={700} mono>{Math.round((incasat / TOTAL_APARTAMENTE) * 100)}%</Txt>
          </Box>
          <Bar value={(incasat / TOTAL_APARTAMENTE) * 100} height={8} />
        </Box>
        <Box row gap={S.sm}>
          <Btn label="Trimite reminder general" size="sm" onPress={() => toastMsg("Notificare trimisa catre 20 apartamente")} />
          <Btn label="Exporta lista" size="sm" variant="secondary" onPress={() => toastMsg("Lista exportata in PDF")} />
        </Box>
      </Card>

      <Box row gap={S.sm}>
        <Kpi eticheta="Restante" valoare={lei(STATISTICI.restante, false)} sub={`${STATISTICI.cuRestanta} apartamente`} tone={C.danger} />
        <Kpi eticheta="Penalizari" valoare={lei(STATISTICI.penalizari, false)} sub="calculate automat" tone={C.warn} />
      </Box>
      <Box row gap={S.sm}>
        <Kpi eticheta="Fond reparatii" valoare={lei(FONDURI.reparatii.sold, false)} sub="sold curent" />
        <Kpi eticheta="Sesizari" valoare={String(deschise)} sub="in asteptare" tone={deschise ? C.warn : C.ink} />
      </Box>

      {facturiNeachitate.length > 0 && (
        <Card gap={S.sm} style={{ borderColor: "#E8D7B4", backgroundColor: C.warnSoft }}>
          <Txt size={13.5} weight={700} color={C.warn}>
            {facturiNeachitate.length} facturi de platit catre furnizori
          </Txt>
          {facturiNeachitate.map((f) => (
            <Box key={f.id} row style={{ justifyContent: "space-between", gap: S.sm }}>
              <Txt size={12.5} color={C.inkSoft}>{f.furnizor}, scadent {dataRo(f.scadenta)}</Txt>
              <Lei value={f.suma} size={12.5} color={C.warn} />
            </Box>
          ))}
          <Btn label="Vezi facturile" size="sm" variant="secondary" onPress={() => go("facturi")} />
        </Card>
      )}

      <Box gap={S.sm}>
        <Titlu
          sub="Sortate dupa vechimea datoriei"
          actiune={<Press onPress={() => go("apartamente")}><Txt size={12} weight={700} color={C.accent}>Toate</Txt></Press>}
        >
          Restantieri
        </Titlu>
        <Card pad={0}>
          {restantieri.map((a, i) => (
            <Box key={a.id}>
              {i > 0 && <Line />}
              <Box row style={{ padding: S.md, alignItems: "center", gap: S.md }}>
                <Box style={{
                  width: 34, height: 34, borderRadius: R.sm, backgroundColor: C.dangerSoft,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Txt size={12} weight={700} color={C.danger}>{a.nr}</Txt>
                </Box>
                <Box flex={1} gap={2}>
                  <Txt size={13} weight={600}>{a.prop}</Txt>
                  <Txt size={11} color={C.muted}>
                    {ZILE_INTARZIERE[a.id]} zile intarziere
                    {penalizare(a.id) > 0 ? `, penalizari ${lei(penalizare(a.id))}` : ""}
                  </Txt>
                </Box>
                <Lei value={SOLDURI_INITIALE[a.id]} size={13} color={C.danger} />
              </Box>
            </Box>
          ))}
        </Card>
      </Box>

      <Box gap={S.sm}>
        <Titlu>Actiuni rapide</Titlu>
        <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
          <Btn label="Adauga factura" variant="secondary" size="sm" onPress={() => go("facturi")} />
          <Btn label="Scrie un anunt" variant="secondary" size="sm" onPress={() => go("adminbloc")} />
          <Btn label="Inregistreaza incasare" variant="secondary" size="sm" onPress={() => go("apartamente")} />
          <Btn label="Deschide un vot" variant="secondary" size="sm" onPress={() => go("adminbloc")} />
        </Box>
      </Box>
    </Box>
  );
}

function AdminApartamente() {
  const { incasari, incaseaza, toastMsg } = useApp();
  const [cauta, setCauta] = useState("");
  const [filtru, setFiltru] = useState("toate");
  const [selectat, setSelectat] = useState(null);

  const rezultate = APARTAMENTE.filter((a) => {
    const q = cauta.trim().toLowerCase();
    const potrivire = !q || a.prop.toLowerCase().includes(q) || String(a.nr).includes(q);
    const sold = SOLDURI_INITIALE[a.id] || 0;
    const dupaFiltru =
      filtru === "toate" ||
      (filtru === "restanta" && sold > 0) ||
      (filtru === "incasat" && incasari.includes(a.id));
    return potrivire && dupaFiltru;
  });

  const ap = selectat ? APARTAMENTE.find((a) => a.id === selectat) : null;
  const listaAp = ap ? LISTE[LUNA_CURENTA].perApartament[ap.id] : null;

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`${TOTAL_PERSOANE} persoane declarate`} titlu="Apartamente" />

      <Field value={cauta} onChange={setCauta} placeholder="Cauta dupa nume sau numar" />
      <Segment
        small
        value={filtru}
        onChange={setFiltru}
        options={[
          { value: "toate", label: `Toate ${APARTAMENTE.length}` },
          { value: "restanta", label: `Cu restanta ${STATISTICI.cuRestanta}` },
          { value: "incasat", label: `Incasate ${incasari.length}` },
        ]}
      />

      {rezultate.length === 0 ? (
        <Gol titlu="Niciun rezultat" text="Schimba filtrul sau sterge textul din cautare." />
      ) : (
        <Card pad={0}>
          {rezultate.map((a, i) => {
            const sold = SOLDURI_INITIALE[a.id] || 0;
            const total = LISTE[LUNA_CURENTA].perApartament[a.id].total;
            const platit = incasari.includes(a.id);
            return (
              <Box key={a.id}>
                {i > 0 && <Line />}
                <Press onPress={() => setSelectat(a.id)}>
                  <Box row style={{ padding: S.md, alignItems: "center", gap: S.md }}>
                    <Box style={{
                      width: 36, height: 36, borderRadius: R.sm,
                      backgroundColor: sold > 0 ? C.dangerSoft : platit ? C.okSoft : C.paperDeep,
                      alignItems: "center", justifyContent: "center",
                    }}>
                      <Txt size={12.5} weight={700} color={sold > 0 ? C.danger : platit ? C.ok : C.inkSoft}>{a.nr}</Txt>
                    </Box>
                    <Box flex={1} gap={2}>
                      <Txt size={13.5} weight={600}>{a.prop}</Txt>
                      <Txt size={11} color={C.muted}>
                        Etaj {a.et === 0 ? "parter" : a.et} · {a.pers} pers. · cota {num(a.cota)}%
                      </Txt>
                    </Box>
                    <Box gap={3} style={{ alignItems: "flex-end" }}>
                      <Lei value={total} size={13} />
                      {sold > 0 ? <Badge label={`Restanta ${lei(sold, false)}`} tone="danger" />
                        : platit ? <Badge label="Incasat" tone="ok" /> : <Badge label="In termen" />}
                    </Box>
                  </Box>
                </Press>
              </Box>
            );
          })}
        </Card>
      )}

      <Sheet open={!!ap} onClose={() => setSelectat(null)} titlu={ap ? `Apartament ${ap.nr}` : ""}>
        {ap && (
          <>
            <Card gap={S.sm}>
              <Txt size={16} weight={700}>{ap.prop}</Txt>
              <Box row gap={S.lg} style={{ flexWrap: "wrap" }}>
                <Box gap={2}><Eyebrow>Etaj</Eyebrow><Txt size={13}>{ap.et === 0 ? "Parter" : ap.et}</Txt></Box>
                <Box gap={2}><Eyebrow>Persoane</Eyebrow><Txt size={13}>{ap.pers}</Txt></Box>
                <Box gap={2}><Eyebrow>Cota indiviza</Eyebrow><Txt size={13}>{num(ap.cota)}%</Txt></Box>
                <Box gap={2}><Eyebrow>Suprafata</Eyebrow><Txt size={13}>{num(ap.mp, 1)} mp</Txt></Box>
              </Box>
            </Card>

            <Card gap={S.sm}>
              <Eyebrow>Situatie la zi</Eyebrow>
              <RandCalcul st={`Intretinere ${monthLabel(LUNA_CURENTA)}`} dr={lei(listaAp.total)} />
              <RandCalcul st="Restanta anterioara" dr={lei(SOLDURI_INITIALE[ap.id] || 0)} />
              <RandCalcul st="Penalizari" dr={lei(penalizare(ap.id))} />
              <Line />
              <RandCalcul st="Total de incasat" dr={lei(deIncasat(ap.id))} bold />
            </Card>

            <Card gap={S.sm} pad={S.md}>
              <Eyebrow>Consum in {monthLabel(LUNA_CURENTA)}</Eyebrow>
              <RandCalcul st="Apa rece" dr={`${num(CONSUM[LUNA_CURENTA][ap.id].rece)} mc`} />
              <RandCalcul st="Apa calda" dr={`${num(CONSUM[LUNA_CURENTA][ap.id].calda)} mc`} />
            </Card>

            <Card pad={0}>
              <Box style={{ padding: S.md }}><Eyebrow>Defalcarea intretinerii</Eyebrow></Box>
              <Line />
              <Box style={{ paddingLeft: S.md, paddingRight: S.md }}>
                {listaAp.linii.map((l, i) => (
                  <Box key={l.cod}>
                    {i > 0 && <Line />}
                    <Box row style={{ justifyContent: "space-between", paddingTop: 9, paddingBottom: 9, gap: S.sm }}>
                      <Txt size={12.5} color={C.inkSoft}>{l.eticheta}</Txt>
                      <Lei value={l.suma} size={12.5} unit={false} />
                    </Box>
                  </Box>
                ))}
              </Box>
            </Card>

            <Box gap={S.sm}>
              <Btn label="Inregistreaza incasarea" full onPress={() => { incaseaza(ap.id); setSelectat(null); }} disabled={incasari.includes(ap.id)} />
              <Btn label="Trimite instiintare de plata" variant="secondary" full onPress={() => toastMsg(`Instiintare trimisa catre ap. ${ap.nr}`)} />
              <Btn label="Modifica numarul de persoane" variant="secondary" full onPress={() => toastMsg("Formular disponibil in versiunea completa")} />
            </Box>
          </>
        )}
      </Sheet>
    </Box>
  );
}

function AdminFacturi() {
  const { toastMsg } = useApp();
  const [luna, setLuna] = useState(LUNA_CURENTA);
  const [deschis, setDeschis] = useState(false);
  const [furnizor, setFurnizor] = useState("");
  const [categorie, setCategorie] = useState("");
  const [suma, setSuma] = useState("");
  const [metoda, setMetoda] = useState("persoane");
  const lista = LISTE[luna];

  const previzualizare = useMemo(() => {
    const s = Number(suma);
    if (!s || metoda === "consum") return null;
    return APARTAMENTE.slice(0, 3).map((ap) => {
      const b = bazaRepartizare(ap, metoda, luna);
      return { ap, suma: b.total ? round2((s * b.valoare) / b.total) : 0, b };
    });
  }, [suma, metoda, luna]);

  return (
    <Box gap={S.lg}>
      <AntetEcran
        eyebrow={monthLabel(luna)}
        titlu="Facturi"
        dreapta={<Btn label="Adauga" size="sm" onPress={() => setDeschis(true)} />}
      />

      <Segment
        small
        value={luna}
        onChange={setLuna}
        options={LUNI_DISPONIBILE.map((l) => ({ value: l, label: monthShort(l) }))}
      />

      <Card gap={S.sm} style={{ backgroundColor: C.accentSoft, borderColor: "#CBDDD6" }}>
        <RandCalcul st="Total facturi si fonduri" dr={lei(lista.totalFacturi)} />
        <RandCalcul st="Total repartizat" dr={lei(lista.totalRepartizat)} />
        <Line style={{ backgroundColor: "#CBDDD6" }} />
        <RandCalcul st="Nealocat" dr={lei(lista.totalFacturi - lista.totalRepartizat)} bold />
      </Card>

      <Card pad={0}>
        {lista.randuri.map((r, i) => (
          <Box key={r.factura.id}>
            {i > 0 && <Line />}
            <Box style={{ padding: S.md }} gap={S.sm}>
              <Box row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: S.sm }}>
                <Box gap={3} flex={1}>
                  <Box row gap={S.sm} style={{ alignItems: "center" }}>
                    <Txt size={10} weight={700} mono color={C.muted}>{r.factura.cod}</Txt>
                    <Txt size={13.5} weight={600}>{r.factura.categorie}</Txt>
                  </Box>
                  <Txt size={11.5} color={C.muted}>{r.factura.furnizor}</Txt>
                </Box>
                <Lei value={r.factura.suma} size={14} />
              </Box>
              <Box row gap={S.sm} style={{ alignItems: "center", flexWrap: "wrap" }}>
                <Badge label={METODE[r.factura.metoda].eticheta} tone="accent" />
                {r.factura.esteFond ? (
                  <Badge label="Fond" tone="info" />
                ) : r.factura.achitata ? (
                  <Badge label="Platita furnizorului" tone="ok" />
                ) : (
                  <Badge label={`De platit pana ${dataRo(r.factura.scadenta)}`} tone="warn" />
                )}
              </Box>
            </Box>
          </Box>
        ))}
      </Card>

      <Card gap={S.sm}>
        <Titlu sub="Se genereaza din facturile de mai sus">Lista de plata</Titlu>
        <Txt size={12.5} color={C.inkSoft}>
          Ultima generare pe 8 august, ora 11:20. Orice modificare de factura cere regenerarea listei si trimite o notificare catre proprietari.
        </Txt>
        <Box row gap={S.sm}>
          <Btn label="Genereaza lista" size="sm" onPress={() => toastMsg("Lista regenerata si publicata catre 20 apartamente")} />
          <Btn label="Exporta PDF" size="sm" variant="secondary" onPress={() => toastMsg("Lista exportata pentru afisare la avizier")} />
        </Box>
      </Card>

      <Sheet open={deschis} onClose={() => setDeschis(false)} titlu="Factura noua">
        <Field label="Furnizor" value={furnizor} onChange={setFurnizor} placeholder="Numele firmei" />
        <Field label="Ce cheltuiala este" value={categorie} onChange={setCategorie} placeholder="Apa rece, salubritate, lift" />
        <Field label="Suma" value={suma} onChange={setSuma} placeholder="0,00" suffix="lei" type="number" />
        <Picker
          label="Cum se repartizeaza"
          value={metoda}
          onChange={setMetoda}
          options={Object.entries(METODE).map(([k, v]) => ({ value: k, label: v.eticheta }))}
        />
        <Card pad={S.md} gap={S.xs} style={{ backgroundColor: C.paperDeep, borderColor: C.lineStrong }}>
          <Txt size={12} color={C.inkSoft}>{METODE[metoda].explic}</Txt>
        </Card>

        {previzualizare && (
          <Card pad={S.md} gap={S.sm}>
            <Eyebrow>Cum ar arata pe primele trei apartamente</Eyebrow>
            {previzualizare.map((p) => (
              <RandCalcul
                key={p.ap.id}
                st={`Ap. ${p.ap.nr}, ${num(p.b.valoare, p.b.um === "%" ? 2 : 0)} ${p.b.um}`}
                dr={lei(p.suma)}
              />
            ))}
          </Card>
        )}

        <Btn label="Ataseaza factura scanata" variant="secondary" onPress={() => toastMsg("Incarcarea de fisiere nu este activa in mockup")} />
        <Btn
          label="Salveaza factura"
          full
          disabled={!furnizor.trim() || !suma}
          onPress={() => { setDeschis(false); setFurnizor(""); setCategorie(""); setSuma(""); toastMsg("Factura a fost adaugata la luna curenta"); }}
        />
      </Sheet>
    </Box>
  );
}

function AdminSesizari() {
  const { sesizari, schimbaStare, raspunde } = useApp();
  const [filtru, setFiltru] = useState("deschise");
  const [selectata, setSelectata] = useState(null);
  const [text, setText] = useState("");

  const vizibile = sesizari.filter((s) =>
    filtru === "toate" ? true : filtru === "deschise" ? s.stare !== "rezolvata" : s.stare === "rezolvata"
  );
  const s = selectata ? sesizari.find((x) => x.id === selectata) : null;

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={`${sesizari.filter((x) => x.stare !== "rezolvata").length} in lucru`} titlu="Sesizari" />

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
            <Press key={x.id} onPress={() => { setSelectata(x.id); setText(x.raspuns || ""); }}>
              <Card pad={S.md} gap={S.sm}>
                <Box row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: S.sm }}>
                  <Box gap={2} flex={1}>
                    <Txt size={13.5} weight={600}>{x.titlu}</Txt>
                    <Txt size={11.5} color={C.muted}>
                      Ap. {x.ap} · {x.categorie} · {dataRo(x.creata)}
                    </Txt>
                  </Box>
                  <StareBadge stare={x.stare} />
                </Box>
                <Txt size={12.5} color={C.inkSoft} style={{
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>{x.desc}</Txt>
              </Card>
            </Press>
          ))}
        </Box>
      )}

      <Sheet open={!!s} onClose={() => setSelectata(null)} titlu={s ? `Ap. ${s.ap}` : ""}>
        {s && (
          <>
            <Card gap={S.sm}>
              <Box row gap={S.sm}><StareBadge stare={s.stare} /><Badge label={s.categorie} /></Box>
              <Txt size={16} weight={700}>{s.titlu}</Txt>
              <Txt size={13} color={C.inkSoft}>{s.desc}</Txt>
              <Txt size={11.5} color={C.muted}>Trimisa pe {dataRo(s.creata)}</Txt>
              {s.poze > 0 && (
                <Box row gap={S.xs}>
                  {Array.from({ length: s.poze }).map((_, i) => (
                    <div key={i} style={{ width: 60, height: 60, borderRadius: R.sm, backgroundColor: C.paperDeep, border: `1px solid ${C.line}` }} />
                  ))}
                </Box>
              )}
            </Card>

            <Field label="Raspuns pentru proprietar" value={text} onChange={setText} multiline placeholder="Ce se intampla si pana cand" />
            <Btn label="Trimite raspunsul" full onPress={() => { raspunde(s.id, text); setSelectata(null); }} disabled={!text.trim()} />

            <Box gap={S.sm}>
              <Eyebrow>Schimba starea</Eyebrow>
              <Box row gap={S.sm}>
                <Btn label="Preiau" size="sm" variant="secondary" onPress={() => { schimbaStare(s.id, "in lucru"); setSelectata(null); }} />
                <Btn label="Marcheaza rezolvata" size="sm" onPress={() => { schimbaStare(s.id, "rezolvata"); setSelectata(null); }} />
              </Box>
            </Box>
          </>
        )}
      </Sheet>
    </Box>
  );
}

function AdminBlocEcran() {
  const { anunturi, adaugaAnunt, vot, remindere, comutaReminder, toastMsg } = useApp();
  const [tab, setTab] = useState("anunturi");
  const [deschis, setDeschis] = useState(false);
  const [titlu, setTitlu] = useState("");
  const [corp, setCorp] = useState("");
  const [important, setImportant] = useState(false);
  const totalVoturi = vot.optiuni.reduce((s, o) => s + o.voturi, 0);

  return (
    <Box gap={S.lg}>
      <AntetEcran eyebrow={BLOC.adresa} titlu="Comunicare" />

      <Segment
        small
        value={tab}
        onChange={setTab}
        options={[
          { value: "anunturi", label: "Anunturi" },
          { value: "remindere", label: "Remindere" },
          { value: "vot", label: "Vot" },
          { value: "acte", label: "Acte" },
        ]}
      />

      {tab === "anunturi" && (
        <Box gap={S.sm}>
          <Btn label="Scrie un anunt" full onPress={() => setDeschis(true)} />
          {anunturi.map((a) => (
            <Card key={a.id} gap={S.sm} pad={S.md}>
              <Box row style={{ justifyContent: "space-between", alignItems: "center" }}>
                <Box row gap={S.sm} style={{ alignItems: "center" }}>
                  {a.important && <Badge label="Urgent" tone="danger" />}
                  <Txt size={11.5} color={C.muted}>{dataRo(a.data)}</Txt>
                </Box>
                <Txt size={11.5} color={C.muted}>Vazut de 14 din 20</Txt>
              </Box>
              <Txt size={14} weight={700}>{a.titlu}</Txt>
              <Txt size={12.5} color={C.inkSoft}>{a.corp}</Txt>
            </Card>
          ))}
        </Box>
      )}

      {tab === "remindere" && (
        <Box gap={S.sm}>
          <Txt size={12.5} color={C.muted}>
            Notificarile pleaca automat catre toti proprietarii cu aplicatia instalata. Cei fara aplicatie primesc mesaj text.
          </Txt>
          <Card pad={0}>
            {remindere.map((r, i) => (
              <Box key={r.id}>
                {i > 0 && <Line />}
                <Box row style={{ padding: S.md, alignItems: "center", gap: S.md }}>
                  <Box flex={1} gap={2}>
                    <Txt size={13.5} weight={600}>{r.nume}</Txt>
                    <Txt size={11.5} color={C.muted}>{r.cand}</Txt>
                  </Box>
                  <Switch value={r.activ} onChange={() => comutaReminder(r.id)} />
                </Box>
              </Box>
            ))}
          </Card>
          <Card gap={S.sm} pad={S.md}>
            <Eyebrow>Trimite acum</Eyebrow>
            <Box row gap={S.sm} style={{ flexWrap: "wrap" }}>
              <Btn label="Reamintire de citire index" size="sm" variant="secondary" onPress={() => toastMsg("Trimis catre 6 apartamente fara index")} />
              <Btn label="Instiintare restantieri" size="sm" variant="secondary" onPress={() => toastMsg(`Trimis catre ${STATISTICI.cuRestanta} apartamente`)} />
            </Box>
          </Card>
        </Box>
      )}

      {tab === "vot" && (
        <Box gap={S.md}>
          <Card gap={S.md}>
            <Box gap={3}>
              <Badge label="Deschis" tone="accent" />
              <Txt size={16} weight={700}>{vot.titlu}</Txt>
              <Txt size={12.5} color={C.muted}>
                Deschis pe {dataRo(vot.deschis)}, se inchide pe {dataRo(vot.inchide)}
              </Txt>
            </Box>
            <Line />
            {vot.optiuni.map((o) => {
              const pct = totalVoturi ? Math.round((o.voturi / totalVoturi) * 100) : 0;
              return (
                <Box key={o.id} gap={S.xs}>
                  <Box row style={{ justifyContent: "space-between", gap: S.sm }}>
                    <Txt size={12.5}>{o.text}</Txt>
                    <Txt size={12.5} weight={700} mono>{o.voturi}</Txt>
                  </Box>
                  <Bar value={pct} />
                </Box>
              );
            })}
            <Line />
            <Box gap={S.xs}>
              <Box row style={{ justifyContent: "space-between" }}>
                <Txt size={12.5} color={C.inkSoft}>Prezenta la vot</Txt>
                <Txt size={12.5} weight={700} mono>{vot.votanti} din {TOTAL_APARTAMENTE}</Txt>
              </Box>
              <Bar value={(vot.votanti / TOTAL_APARTAMENTE) * 100} height={8} />
              <Txt size={11.5} color={C.muted}>
                Mai trebuie {Math.max(0, 11 - vot.votanti)} voturi pentru majoritatea ceruta de regulament.
              </Txt>
            </Box>
            <Box row gap={S.sm}>
              <Btn label="Reaminteste celor care nu au votat" size="sm" variant="secondary" onPress={() => toastMsg(`Trimis catre ${TOTAL_APARTAMENTE - vot.votanti} apartamente`)} />
            </Box>
          </Card>
          <Btn label="Deschide un vot nou" variant="secondary" full onPress={() => toastMsg("Formular disponibil in versiunea completa")} />
        </Box>
      )}

      {tab === "acte" && (
        <Box gap={S.sm}>
          <Btn label="Incarca un document" full onPress={() => toastMsg("Incarcarea de fisiere nu este activa in mockup")} />
          <Card pad={0}>
            {DOCUMENTE.map((d, i) => (
              <Box key={d.id}>
                {i > 0 && <Line />}
                <Box row style={{ padding: S.md, alignItems: "center", gap: S.md }}>
                  <Box flex={1} gap={2}>
                    <Txt size={13} weight={600}>{d.nume}</Txt>
                    <Txt size={11.5} color={C.muted}>{d.tip} · {dataRo(d.data)} · {d.marime}</Txt>
                  </Box>
                  <Badge label="Public" tone="ok" />
                </Box>
              </Box>
            ))}
          </Card>
        </Box>
      )}

      <Sheet open={deschis} onClose={() => setDeschis(false)} titlu="Anunt nou">
        <Field label="Titlu" value={titlu} onChange={setTitlu} placeholder="Ce trebuie sa stie proprietarii" />
        <Field label="Continut" value={corp} onChange={setCorp} multiline placeholder="Detalii, date, ore" />
        <Box row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Box gap={2}>
            <Txt size={13} weight={600}>Marcheaza ca urgent</Txt>
            <Txt size={11.5} color={C.muted}>Trimite notificare imediat</Txt>
          </Box>
          <Switch value={important} onChange={setImportant} />
        </Box>
        <Btn
          label="Publica anuntul"
          full
          disabled={!titlu.trim()}
          onPress={() => {
            adaugaAnunt({ titlu: titlu.trim(), corp: corp.trim(), important });
            setTitlu(""); setCorp(""); setImportant(false); setDeschis(false);
          }}
        />
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
      style={{
        borderTop: `1px solid ${C.line}`,
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
            style={{
              flex: 1,
              alignItems: "center",
              paddingTop: 9,
              paddingBottom: 7,
              borderTop: `2px solid ${esteActiv ? C.accent : "transparent"}`,
              marginTop: -1,
            }}
          >
            <Box row gap={4} style={{ alignItems: "center" }}>
              <Txt size={11} weight={esteActiv ? 700 : 500} color={esteActiv ? C.accent : C.muted}>
                {t.label}
              </Txt>
              {b ? (
                <div style={{
                  minWidth: 15, height: 15, borderRadius: R.pill, backgroundColor: C.danger,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                }}>
                  <Txt size={9} weight={700} color="#FFFFFF">{b}</Txt>
                </div>
              ) : null}
            </Box>
          </Press>
        );
      })}
    </Box>
  );
}

function BaraSus({ rol, onRol }) {
  return (
    <Box
      row
      style={{
        alignItems: "center",
        justifyContent: "space-between",
        padding: `${S.sm}px ${S.md}px`,
        borderBottom: `1px solid ${C.line}`,
        backgroundColor: C.surface,
        gap: S.md,
      }}
    >
      <Box row gap={S.sm} style={{ alignItems: "center" }}>
        <Box style={{
          width: 26, height: 26, borderRadius: R.sm, backgroundColor: C.accent,
          alignItems: "center", justifyContent: "center",
        }}>
          <Txt size={11} weight={700} color="#FFFFFF">D14</Txt>
        </Box>
        <Box gap={0}>
          <Txt size={12.5} weight={700}>{rol === "admin" ? "Administrator" : "Elena Marinescu"}</Txt>
          <Txt size={10.5} color={C.muted}>{rol === "admin" ? BLOC.administrator.nume : `Apartament ${AP_UTILIZATOR.nr}`}</Txt>
        </Box>
      </Box>
      <Box style={{ width: 168 }}>
        <Segment
          small
          value={rol}
          onChange={onRol}
          options={[{ value: "locatar", label: "Locatar" }, { value: "admin", label: "Admin" }]}
        />
      </Box>
    </Box>
  );
}

/* =============================================================================
   11. APLICATIA
============================================================================= */

export default function AdminBloc() {
  const [rol, setRol] = useState("locatar");
  const [tabLocatar, setTabLocatar] = useState("acasa");
  const [tabAdmin, setTabAdmin] = useState("sumar");

  const [sesizari, setSesizari] = useState(SESIZARI_INITIALE);
  const [anunturi, setAnunturi] = useState(ANUNTURI_INITIALE);
  const [vot, setVot] = useState(VOT_INITIAL);
  const [votulMeu, setVotulMeu] = useState(null);
  const [platit, setPlatit] = useState([]);
  const [indexTransmis, setIndexTransmis] = useState(false);
  const [incasari, setIncasari] = useState([1, 2, 4, 5, 7, 8, 9, 10, 12, 13, 14, 16, 18, 20]);
  const [remindere, setRemindere] = useState(REMINDERE_CONFIG_INITIAL);
  const [toast, setToast] = useState(null);

  const toastMsg = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  const api = {
    sesizari, anunturi, vot, votulMeu, platit, indexTransmis, incasari, remindere, toastMsg,

    adaugaSesizare: ({ titlu, categorie, desc, ap }) => {
      setSesizari((prev) => [
        { id: `S${Date.now()}`, ap, titlu, categorie, desc, stare: "noua", creata: "2026-08-14", raspuns: null, poze: 0 },
        ...prev,
      ]);
      toastMsg("Sesizarea a ajuns la administrator");
    },

    schimbaStare: (id, stare) => {
      setSesizari((prev) => prev.map((s) => (s.id === id ? { ...s, stare } : s)));
      toastMsg(stare === "rezolvata" ? "Sesizare marcata rezolvata" : "Sesizare preluata");
    },

    raspunde: (id, raspuns) => {
      setSesizari((prev) => prev.map((s) => (s.id === id ? { ...s, raspuns, stare: s.stare === "noua" ? "in lucru" : s.stare } : s)));
      toastMsg("Raspunsul a fost trimis proprietarului");
    },

    adaugaAnunt: ({ titlu, corp, important }) => {
      setAnunturi((prev) => [
        { id: `A${Date.now()}`, titlu, corp, important, data: "2026-08-14", autor: BLOC.administrator.nume },
        ...prev,
      ]);
      toastMsg(important ? "Anunt publicat si notificare trimisa" : "Anunt publicat la avizier");
    },

    voteaza: (optiuneId) => {
      setVot((prev) => ({
        ...prev,
        votanti: prev.votanti + 1,
        optiuni: prev.optiuni.map((o) => (o.id === optiuneId ? { ...o, voturi: o.voturi + 1 } : o)),
      }));
      setVotulMeu(optiuneId);
      toastMsg("Votul a fost inregistrat");
    },

    plateste: (luna, suma) => {
      setPlatit((prev) => [...prev, luna]);
      setIncasari((prev) => (prev.includes(AP_UTILIZATOR.id) ? prev : [...prev, AP_UTILIZATOR.id]));
      toastMsg(`Plata de ${lei(suma)} a fost inregistrata`);
    },

    transmiteIndex: () => {
      setIndexTransmis(true);
      toastMsg("Indexul a fost trimis administratorului");
    },

    incaseaza: (apId) => {
      setIncasari((prev) => (prev.includes(apId) ? prev : [...prev, apId]));
      toastMsg("Incasare inregistrata, chitanta trimisa in aplicatie");
    },

    comutaReminder: (id) => {
      setRemindere((prev) => prev.map((r) => (r.id === id ? { ...r, activ: !r.activ } : r)));
    },
  };

  const taburi = rol === "admin" ? TABURI_ADMIN : TABURI_LOCATAR;
  const tabActiv = rol === "admin" ? tabAdmin : tabLocatar;
  const setTab = rol === "admin" ? setTabAdmin : setTabLocatar;
  const Ecran = taburi.find((t) => t.key === tabActiv).ecran;

  const sesizariDeschise = sesizari.filter((s) => s.stare !== "rezolvata").length;
  const badgeuri = rol === "admin"
    ? { adminsesizari: sesizariDeschise }
    : { sesizari: sesizari.filter((s) => s.ap === AP_UTILIZATOR.id && s.stare !== "rezolvata").length };

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
          <BaraSus rol={rol} onRol={setRol} />

          <div
            className="ab-scroll"
            style={{ flex: 1, overflowY: "auto", padding: S.lg, paddingBottom: S.xxl }}
          >
            <div key={`${rol}-${tabActiv}`} className="ab-fade">
              <Ecran go={setTab} />
            </div>
          </div>

          <TabBar taburi={taburi} activ={tabActiv} onChange={setTab} badgeuri={badgeuri} />
          <Toast mesaj={toast} />
        </Box>
      </div>
    </AppCtx.Provider>
  );
}
