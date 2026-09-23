/* =============================================================================
   Datele demo ale blocului D14, scara A
   -----------------------------------------------------------------------------
   JavaScript pur, fara importuri. Descrie ce s-a intamplat in bloc de la
   intrarea in aplicatie (mai 2026) pana azi: apartamentele, facturile fiecarei
   luni, citirile, platile, sesizarile, anunturile.

   Nu contine nicio suma calculata. Cat plateste fiecare apartament iese din
   motorul de repartizare, cand lista se publica. Acelasi fisier este "rejucat"
   de sursa mock din aplicatie si de scriptul de seed pentru baza de date
   locala, ca amandoua sa ajunga la exact aceleasi cifre.
============================================================================= */

export const ASOCIATIE = {
  denumire: "Asociatia de proprietari nr. 118",
  cui: "31245780",
  iban: "RO49RNCB0082004512340001",
  banca: "BCR, sucursala Pitesti",
  adresa: "Str. Nicolae Balcescu nr. 22, Pitesti",
  telefon: "0745 210 118",
  email: "asociatia118@adminbloc.test",
};

export const SETARI_FINANCIARE = {
  procentPenalizareZi: 0.02,
  zileGratie: 30,
  ziScadenta: 25,
  chitantaSerie: "AP118",
  chitantaUltimulNumar: 416,
};

export const BLOC = {
  denumire: "Bloc D14, scara A",
  adresa: "Str. Nicolae Balcescu nr. 22, Pitesti",
  etaje: 4,
  uat: { denumire: "Pitesti", tip: "municipiu", judet: "Arges", judetCod: "AG", siruta: "13178" },
  judet: { denumire: "Arges", tip: "judet", judet: "Arges", judetCod: "AG", siruta: "38" },
};

export const ZI_LIMITA_CITIRE = 25;

/* Conturile de test. Parola este aceeasi pentru toate, ca sa fie usor de
   folosit la verificare; conturile exista doar in mediul local. */
export const PAROLA_DEMO = "Bloc-D14-2026";

export const CONTURI = [
  { cheie: "admin", email: "administrator@adminbloc.test", nume: "Mihai Dobre", telefon: "0745 210 118", rol: "administrator", atestat: "AT-AG-2019-0412" },
  { cheie: "elena", email: "elena.marinescu@adminbloc.test", nume: "Elena Marinescu", telefon: "0733 410 217", rol: "locatar", apartament: "17", calitate: "proprietar" },
  { cheie: "ilie", email: "familia.ilie@adminbloc.test", nume: "Dan Ilie", telefon: "0726 331 003", rol: "locatar", apartament: "3", calitate: "proprietar" },
  { cheie: "voicu", email: "gheorghe.voicu@adminbloc.test", nume: "Gheorghe Voicu", telefon: "0741 002 101", rol: "locatar", apartament: "1", calitate: "proprietar" },
  { cheie: "neverificat", email: "admin.nou@adminbloc.test", nume: "Cosmin Radu", telefon: "0755 900 800", rol: "administrator_in_asteptare", atestat: "AT-AG-2026-0077" },
];

export const CONTACTE = [
  { rol: "administrator", nume: "Mihai Dobre", telefon: "0745 210 118", program: "Marti si joi, 17:00 - 19:00" },
  { rol: "presedinte", nume: "Ioana Stancu", telefon: "0722 884 019", apartament: "12" },
  { rol: "cenzor", nume: "Radu Pintea", telefon: "0740 118 233", apartament: "4" },
  { rol: "lift", nume: "Elmas Lift Service", telefon: "0800 800 112", program: "Urgente lift, non stop" },
];

/* Parterul (ap. 1 - 4) este scutit de lift, regula uzuala in asociatii.
   Cota indiviza este suprafata apartamentului din suprafata totala (1.059,4 mp),
   rotunjita la doua zecimale; cotele insumeaza exact 100. */
export const APARTAMENTE = [
  { numar: "1", etaj: 0, proprietar: "Gheorghe Voicu", persoane: 2, cota: 4.01, mp: 42.5 },
  { numar: "2", etaj: 0, proprietar: "Ana Petrescu", persoane: 1, cota: 4.63, mp: 49.0 },
  { numar: "3", etaj: 0, proprietar: "Familia Ilie", persoane: 4, cota: 6.02, mp: 63.8 },
  { numar: "4", etaj: 0, proprietar: "Radu Pintea", persoane: 2, cota: 4.01, mp: 42.5 },
  { numar: "5", etaj: 1, proprietar: "Cristina Barbu", persoane: 3, cota: 4.63, mp: 49.0 },
  { numar: "6", etaj: 1, proprietar: "Vasile Munteanu", persoane: 2, cota: 6.02, mp: 63.8 },
  { numar: "7", etaj: 1, proprietar: "Adrian Neagu", persoane: 1, cota: 4.01, mp: 42.5 },
  { numar: "8", etaj: 1, proprietar: "Familia Dumitrescu", persoane: 4, cota: 6.02, mp: 63.8 },
  { numar: "9", etaj: 2, proprietar: "Mircea Olaru", persoane: 2, cota: 4.63, mp: 49.0 },
  { numar: "10", etaj: 2, proprietar: "Sanda Croitoru", persoane: 1, cota: 4.01, mp: 42.5 },
  { numar: "11", etaj: 2, proprietar: "Familia Georgescu", persoane: 5, cota: 6.02, mp: 63.8 },
  { numar: "12", etaj: 2, proprietar: "Ioana Stancu", persoane: 2, cota: 4.63, mp: 49.0 },
  { numar: "13", etaj: 3, proprietar: "Paul Enache", persoane: 3, cota: 6.02, mp: 63.8 },
  { numar: "14", etaj: 3, proprietar: "Doina Lupu", persoane: 1, cota: 4.01, mp: 42.5 },
  { numar: "15", etaj: 3, proprietar: "Familia Toma", persoane: 4, cota: 6.02, mp: 63.8 },
  { numar: "16", etaj: 3, proprietar: "Sorin Avram", persoane: 2, cota: 4.63, mp: 49.0 },
  { numar: "17", etaj: 4, proprietar: "Elena Marinescu", persoane: 3, cota: 4.63, mp: 49.0 },
  { numar: "18", etaj: 4, proprietar: "Nicolae Serban", persoane: 2, cota: 6.02, mp: 63.8 },
  { numar: "19", etaj: 4, proprietar: "Familia Nita", persoane: 3, cota: 4.01, mp: 42.5 },
  { numar: "20", etaj: 4, proprietar: "Lavinia Costea", persoane: 2, cota: 6.02, mp: 63.8 },
].map((a) => ({ ...a, scutitLift: a.etaj === 0 }));

/* Cheia leaga facturile de furnizor. Categoria, metoda si codul sunt
   valorile implicite cu care se precompleteaza formularul de factura. */
export const FURNIZORI = [
  { cheie: "apa", denumire: "Apa Canal 2000 Arges", cui: "RO15072240", categorie: "Apa rece si canalizare", metoda: "consum", tipApa: "rece", cod: "C1" },
  { cheie: "termo", denumire: "Termo Energy Pitesti", cui: "RO28774210", categorie: "Apa calda menajera", metoda: "consum", tipApa: "calda", cod: "C2" },
  { cheie: "enel", denumire: "Enel Energie Muntenia", cui: "RO14507322", categorie: "Energie electrica parti comune", metoda: "apartamente", cod: "C3" },
  { cheie: "salubritate", denumire: "Salubritate 2000", cui: "RO13900211", categorie: "Salubritate", metoda: "persoane", cod: "C4" },
  { cheie: "lift", denumire: "Elmas Lift Service", cui: "RO21009874", categorie: "Intretinere ascensor", metoda: "persoane_fara_lift", cod: "C5" },
  { cheie: "curatenie", denumire: "Maria Dinu, contract prestari", cui: null, categorie: "Curatenie casa scarii", metoda: "persoane", cod: "C6" },
  { cheie: "administrare", denumire: "Asociatia de proprietari nr. 118", cui: "31245780", categorie: "Administrare si cenzorat", metoda: "apartamente", cod: "C7" },
  { cheie: "deraton", denumire: "Deraton Serv", cui: "RO30551234", categorie: "Deratizare si dezinsectie", metoda: "apartamente", cod: "C8" },
];

/* Contributia lunara la fondul de reparatii, votata de adunarea generala */
export const RECURENTE = [
  { tip: "fond_reparatii", cod: "C9", categorie: "Fond de reparatii", suma: 1600, metoda: "cota", hotarare: "Hotarare AG din 12.03.2026" },
];

/* Luna zero: indexurile de pornire, preluate de pe foaia de citiri de hartie */
export const LUNA_PORNIRE = "2026-05";

/* Listele publicate si lista in lucru */
export const LUNI_PUBLICATE = ["2026-06", "2026-07", "2026-08"];
export const LUNA_CIORNA = "2026-09";

export const PUBLICARI = {
  "2026-06": { publicataLa: "2026-07-08T09:20:00+03:00", scadenta: "2026-07-25" },
  "2026-07": { publicataLa: "2026-08-08T11:20:00+03:00", scadenta: "2026-08-25" },
  "2026-08": { publicataLa: "2026-09-08T10:05:00+03:00", scadenta: "2026-09-25" },
};

/* Facturile fiecarei luni. achitataLa este data la care asociatia a platit
   furnizorul; null inseamna neplatita inca. */
export const FACTURI = {
  "2026-06": [
    { furnizor: "apa", suma: 2744.9, serie: "ACA-437765", emisa: "2026-07-03", scadenta: "2026-07-25", achitataLa: "2026-07-20" },
    { furnizor: "termo", suma: 2402.0, serie: "TEP-88120", emisa: "2026-07-04", scadenta: "2026-07-28", achitataLa: "2026-07-22" },
    { furnizor: "enel", suma: 401.1, serie: "EEM-764112", emisa: "2026-07-02", scadenta: "2026-07-20", achitataLa: "2026-07-15" },
    { furnizor: "salubritate", suma: 1120.0, serie: "SAL-32551", emisa: "2026-07-01", scadenta: "2026-07-30", achitataLa: "2026-07-24" },
    { furnizor: "lift", suma: 640.0, serie: "ELM-2151", emisa: "2026-07-05", scadenta: "2026-08-05", achitataLa: "2026-07-30" },
    { furnizor: "curatenie", suma: 900.0, serie: "CP-06/2026", emisa: "2026-07-01", scadenta: "2026-07-15", achitataLa: "2026-07-14" },
    { furnizor: "administrare", suma: 1400.0, serie: "AP-06/2026", emisa: "2026-07-01", scadenta: "2026-07-15", achitataLa: "2026-07-14" },
  ],
  "2026-07": [
    { furnizor: "apa", suma: 2960.4, serie: "ACA-441003", emisa: "2026-08-03", scadenta: "2026-08-25", achitataLa: "2026-08-21" },
    { furnizor: "termo", suma: 2210.5, serie: "TEP-89771", emisa: "2026-08-04", scadenta: "2026-08-28", achitataLa: "2026-08-24" },
    { furnizor: "enel", suma: 388.2, serie: "EEM-768401", emisa: "2026-08-02", scadenta: "2026-08-20", achitataLa: "2026-08-18" },
    { furnizor: "salubritate", suma: 1120.0, serie: "SAL-32904", emisa: "2026-08-01", scadenta: "2026-08-30", achitataLa: "2026-08-27" },
    { furnizor: "lift", suma: 640.0, serie: "ELM-2188", emisa: "2026-08-05", scadenta: "2026-09-05", achitataLa: "2026-09-02" },
    { furnizor: "curatenie", suma: 900.0, serie: "CP-07/2026", emisa: "2026-08-01", scadenta: "2026-08-15", achitataLa: "2026-08-14" },
    { furnizor: "administrare", suma: 1400.0, serie: "AP-07/2026", emisa: "2026-08-01", scadenta: "2026-08-15", achitataLa: "2026-08-14" },
  ],
  "2026-08": [
    { furnizor: "apa", suma: 3284.6, serie: "ACA-448120", emisa: "2026-09-03", scadenta: "2026-09-25", achitataLa: "2026-09-16" },
    { furnizor: "termo", suma: 2418.0, serie: "TEP-90233", emisa: "2026-09-04", scadenta: "2026-09-28", achitataLa: "2026-09-17" },
    { furnizor: "enel", suma: 412.35, serie: "EEM-771204", emisa: "2026-09-02", scadenta: "2026-09-20", achitataLa: "2026-09-15" },
    { furnizor: "salubritate", suma: 1120.0, serie: "SAL-33128", emisa: "2026-09-01", scadenta: "2026-09-30", achitataLa: null },
    { furnizor: "lift", suma: 640.0, serie: "ELM-2210", emisa: "2026-09-05", scadenta: "2026-10-05", achitataLa: null },
    { furnizor: "curatenie", suma: 900.0, serie: "CP-08/2026", emisa: "2026-09-01", scadenta: "2026-09-15", achitataLa: "2026-09-14" },
    { furnizor: "administrare", suma: 1400.0, serie: "AP-08/2026", emisa: "2026-09-01", scadenta: "2026-09-15", achitataLa: "2026-09-14" },
    { furnizor: "deraton", suma: 380.0, serie: "DRT-1180", emisa: "2026-08-28", scadenta: "2026-09-27", achitataLa: null },
  ],
};

/* Consumul lunii la contorul general al blocului, in metri cubi. Diferenta
   fata de suma contoarelor din apartamente este pierderea pe coloana. */
export const CONTOR_GENERAL = {
  "2026-06": { rece: 372.0, calda: 194.0 },
  "2026-07": { rece: 401.0, calda: 181.0 },
  "2026-08": { rece: 428.0, calda: 196.0 },
};

export const INDEX_PORNIRE_GENERAL = { rece: 18240.0, calda: 7410.0 };

/* Consumul unui apartament intr-o luna. Generat determinist, ca sa nu scriem
   20 x 4 randuri de mana, dar tras spre numarul de persoane. */
export function consumApartament(numar, luna, tip) {
  const ap = APARTAMENTE.find((a) => a.numar === numar);
  const baza = tip === "rece" ? 4.2 : 2.1;
  const seed = (Number(numar) * 37 + luna.charCodeAt(6) * 11 + (tip === "rece" ? 3 : 7)) % 19;
  return Math.round((baza * ap.persoane + (seed / 10) * 1.6) * 100) / 100;
}

export function indexPornire(numar, tip) {
  const n = Number(numar);
  return Math.round((tip === "rece" ? 150 + n * 3.1 : 80 + n * 1.7) * 10) / 10;
}

/* Citirile lunii in curs (septembrie), transmise pana azi. Restul
   apartamentelor nu au transmis inca. */
export const CITIRI_LUNA_CURENTA = {
  validate: ["1", "2", "4", "5", "7", "8"],
  trimise: ["9", "12", "14", "20"],
  respinse: [{ numar: "6", motiv: "Poza este neclara, nu se vad cifrele negre." }],
  dataTransmitere: "2026-09-16T19:40:00+03:00",
};

/* Restantele preluate de pe lista de hartie la intrarea in aplicatie */
export const RESTANTE_INITIALE = [
  { numar: "11", suma: 967.2, luna: "2026-05", scadenta: "2026-05-25", descriere: "Restanta preluata de pe lista de plata din mai 2026" },
];

/* Cine a platit si cand. Suma este tot ce datora apartamentul pentru acea
   lista, calculata de motor; o plata partiala are suma scrisa explicit. */
export const PLATI = [
  ...["1", "2", "4", "5", "6", "7", "8", "9", "10", "12", "13", "14", "16", "18", "19", "20"].map((numar, i) => ({
    numar, luna: "2026-06", data: `2026-07-${String(10 + (i % 12)).padStart(2, "0")}T18:00:00+03:00`, metoda: i % 3 === 0 ? "numerar" : "transfer",
  })),
  { numar: "17", luna: "2026-06", data: "2026-07-14T20:12:00+03:00", metoda: "transfer" },
  { numar: "15", luna: "2026-06", data: "2026-07-30T17:30:00+03:00", metoda: "numerar", suma: 200 },
  ...["1", "2", "4", "5", "7", "8", "9", "10", "12", "13", "14", "16", "18", "20"].map((numar, i) => ({
    numar, luna: "2026-07", data: `2026-08-${String(10 + (i % 12)).padStart(2, "0")}T18:00:00+03:00`, metoda: i % 3 === 0 ? "numerar" : "transfer",
  })),
  { numar: "17", luna: "2026-07", data: "2026-08-12T21:03:00+03:00", metoda: "transfer" },
  ...["1", "2", "4", "5", "7", "8", "9", "10", "12", "13", "14", "16", "18", "20"].map((numar, i) => ({
    numar, luna: "2026-08", data: `2026-09-${String(9 + (i % 9)).padStart(2, "0")}T18:00:00+03:00`, metoda: i % 3 === 0 ? "numerar" : "transfer",
  })),
];

/* Zilele in care jobul lunar a calculat penalizarile */
export const CALCULE_PENALIZARI = ["2026-07-01", "2026-08-01", "2026-09-01"];

export const FONDURI = [
  {
    tip: "reparatii", denumire: "Fond de reparatii", sumaPerApartament: null,
    miscari: [
      { data: "2026-05-31", suma: 20468.6, descriere: "Sold preluat din registrul fondurilor" },
      { data: "2026-06-11", suma: -3800, descriere: "Zugravit casa scarii, etajele 1 si 2", document: "Deviz zugravit casa scarii" },
      { data: "2026-07-18", suma: -2240, descriere: "Reparatie pompa hidrofor", document: "Factura reparatie hidrofor" },
    ],
  },
  {
    tip: "rulment", denumire: "Fond de rulment", sumaPerApartament: 480,
    miscari: [
      { data: "2026-05-31", suma: 9600, descriere: "Sold preluat din registrul fondurilor" },
    ],
  },
];

export const SESIZARI = [
  {
    cheie: "S1", numar: "17", titlu: "Bec ars pe palier la etajul 4", categorie: "iluminat",
    descriere: "Becul de langa ap. 17 nu mai porneste de doua zile.", stare: "in_lucru",
    creataLa: "2026-09-09T08:30:00+03:00", preluataLa: "2026-09-09T12:10:00+03:00", poze: 1,
    mesaje: [{ dinAdministratie: true, text: "Am cumparat becul, se monteaza joi.", la: "2026-09-09T12:10:00+03:00" }],
  },
  {
    cheie: "S2", numar: "11", titlu: "Scurgere la coloana de la subsol", categorie: "instalatii",
    descriere: "Se aude apa curgand permanent langa boxa 11.", stare: "noua",
    creataLa: "2026-09-15T20:05:00+03:00", poze: 2, mesaje: [],
  },
  {
    cheie: "S3", numar: "6", titlu: "Usa de la intrare nu se inchide singura", categorie: "acces",
    descriere: "Amortizorul nu mai trage usa pana la capat.", stare: "in_lucru",
    creataLa: "2026-09-04T17:45:00+03:00", preluataLa: "2026-09-05T09:00:00+03:00", poze: 0,
    mesaje: [{ dinAdministratie: true, text: "Comandat amortizor nou, livrare pe 22 septembrie.", la: "2026-09-05T09:00:00+03:00" }],
  },
  {
    cheie: "S4", numar: "17", titlu: "Interfon defect", categorie: "acces",
    descriere: "Nu se aude nimic la interfon.", stare: "rezolvata",
    creataLa: "2026-08-21T10:00:00+03:00", preluataLa: "2026-08-21T16:00:00+03:00", rezolvataLa: "2026-08-24T15:30:00+03:00", poze: 0,
    mesaje: [
      { dinAdministratie: true, text: "Vine tehnicianul luni.", la: "2026-08-21T16:00:00+03:00" },
      { dinAdministratie: true, text: "Inlocuit modulul de apel pe 24 august.", la: "2026-08-24T15:30:00+03:00" },
    ],
  },
  {
    cheie: "S5", numar: "2", titlu: "Gunoi depozitat pe casa scarii", categorie: "curatenie",
    descriere: "La etajul 1 sunt saci lasati de doua zile.", stare: "rezolvata",
    creataLa: "2026-09-02T08:15:00+03:00", preluataLa: "2026-09-02T11:00:00+03:00", rezolvataLa: "2026-09-03T10:00:00+03:00", poze: 1,
    mesaje: [{ dinAdministratie: true, text: "Discutat cu proprietarul, s-a eliberat spatiul.", la: "2026-09-03T10:00:00+03:00" }],
  },
];

/* Ce au citit locatarii: numerele apartamentelor care au deschis anuntul */
export const ANUNTURI = [
  {
    titlu: "Oprire apa rece marti, 22 septembrie", urgent: true, publicatLa: "2026-09-17T09:00:00+03:00",
    corp: "Apa Canal opreste furnizarea intre 09:00 si 16:00 pentru inlocuirea unei vane pe strada. Va recomandam sa faceti rezerva de seara.",
    cititDe: ["1", "3"],
  },
  {
    titlu: "Citirea contoarelor pana pe 25 septembrie", urgent: false, publicatLa: "2026-09-10T10:00:00+03:00",
    corp: "Transmiteti indexul din aplicatie sau lasati un bilet in cutia asociatiei. Cine nu transmite index primeste consum estimat pe media ultimelor trei luni.",
    cititDe: ["1", "3", "17"],
  },
  {
    titlu: "Lucrari la fatada, tronsonul dinspre parcare", urgent: false, publicatLa: "2026-09-04T12:00:00+03:00",
    corp: "Firma incepe pe 24 septembrie si estimeaza doua saptamani. Schela ocupa trei locuri de parcare, marcate cu banda.",
    cititDe: ["1", "3", "17"],
  },
];

export const DOCUMENTE = [
  { titlu: "Proces verbal adunare generala, 12 martie 2026", tip: "proces_verbal", data: "2026-03-14" },
  { titlu: "Contract intretinere ascensor Elmas 2026", tip: "contract", data: "2026-01-20" },
  { titlu: "Regulamentul asociatiei de proprietari", tip: "regulament", data: "2025-09-02" },
  { titlu: "Raport de cenzor pe anul 2025", tip: "raport", data: "2026-02-11" },
  { titlu: "Lista de plata din mai 2026, de pe hartie", tip: "lista_plata", data: "2026-06-08" },
];

export const VOT = {
  titlu: "Inlocuirea usii de la intrare",
  descriere: "Doua oferte pentru usa cu interfon si inchidere automata. Plata se face din fondul de reparatii, restul se colecteaza in trei rate lunare.",
  deschisLa: "2026-09-05T10:00:00+03:00",
  inchideLa: "2026-10-03T18:00:00+03:00",
  numarare: "apartament",
  optiuni: ["Oferta A, usa aluminiu, 14.200 lei", "Oferta B, usa PVC cu geam termopan, 9.800 lei", "Amanam decizia pentru anul viitor"],
  /* numarul apartamentului -> indexul optiunii alese */
  voturi: { 2: 0, 4: 0, 5: 1, 6: 0, 7: 2, 8: 0, 9: 1, 10: 0, 12: 0, 13: 1, 14: 1, 16: 2, 18: 0, 20: 1 },
};

export const ADUNARE = {
  dataOra: "2026-10-03T18:30:00+03:00",
  loc: "La parter, langa boxe",
  ordineDeZi: "Executia bugetului pe primul semestru, oferta pentru usa de la intrare si stabilirea cotei de fond de reparatii pentru 2027.",
  convocataLa: "2026-09-18T10:00:00+03:00",
  prezente: ["4", "12", "13"],
};

/* Cele cinci remindere automate din PDF, cu valorile implicite */
export const REMINDERE = [
  { tip: "lista_publicata", activ: true, zile: 0 },
  { tip: "citire_contoare", activ: true, zile: 5 },
  { tip: "plata", activ: true, zile: 3 },
  { tip: "restanta", activ: true, zile: 30 },
  { tip: "adunare_generala", activ: false, zile: 10 },
];
