/* =============================================================================
   Sursa de date in memorie (mod demonstrativ, fara server)
   -----------------------------------------------------------------------------
   Implementeaza aceeasi interfata ca sursa Supabase: incarca() intoarce
   datele vazute de utilizatorul autentificat, iar fiecare comanda modifica
   datele si intoarce un rezultat. Tabelele de aici au aceleasi nume si
   aceleasi reguli ca schemele din baza de date (docs/schema-propunere.md),
   ca aplicatia sa nu vada nicio diferenta intre cele doua surse.

   La pornire "rejoaca" date-demo.js: publica listele cu motorul real, aloca
   platile, calculeaza penalizarile, exact in ordinea in care s-au intamplat.
   Reincarcarea paginii reia totul de la capat.
============================================================================= */

import { calculeazaLista, round2 } from "../supabase/functions/_shared/motor.js";
import * as D from "./date-demo.js";
import { documentPdf } from "./pdf.js";
/* [K22] seara unei zile, ora Romaniei: acelasi calcul ca sursa Supabase si ecranul */
import { oraSeriiRomania, dataOraRomania, aziRomania } from "./ora-romania.js";
/* Contul se tine pe numar de telefon, ca in sursa Supabase */
import { normalizeazaTelefon } from "../supabase/functions/_shared/telefon.js";
import { genereazaParola } from "../supabase/functions/_shared/parola.js";

const pad = (n) => String(n).padStart(2, "0");

/* [K24] ziua Romaniei, nu a telefonului */
export function aziIso() {
  return aziRomania();
}

const zi = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const zileIntre = (a, b) => Math.round((zi(b) - zi(a)) / 86400000);
const adaugaZile = (iso, n) => new Date(zi(iso) + n * 86400000).toISOString().slice(0, 10);
const lunaUrmatoare = (l) => {
  let [y, m] = l.split("-").map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${pad(m)}`;
};
const lunaDe = (iso) => iso.slice(0, 7);
const LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const lunaText = (l) => `${LUNI[Number(l.slice(5, 7)) - 1]} ${l.slice(0, 4)}`;
const dataText = (d) => `${Number(d.slice(8, 10))} ${LUNI[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const acum = () => new Date().toISOString();
const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const eroare = (mesaj) => { throw new Error(mesaj); };

/* Formateaza un numar pe romaneste (punct la mii, virgula zecimala), la fel
   ca public.numar_ro() din baza, pentru mesajele de refuz aratate omului.
   Apelantii trimit mereu o valoare nenegativa (sumele sunt precalculate cu
   semnul potrivit inainte de a ajunge aici). */
function numarRo(n) {
  const [intreg, zecimal] = n.toFixed(2).split(".");
  return `${intreg.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${zecimal}`;
}


/* Un camp gol din formular ("" sau necompletat) inseamna "fara valoare" */
const numarSauNull = (v) => (v === "" || v == null ? null : Number(v));

const TABELE = [
  "asociatii", "blocuri", "contacte", "apartamente", "persoane", "profiluri", "autentificari",
  "administratori", "membri", "locatari", "furnizori", "recurente", "liste",
  "cheltuieli", "repartizari", "contoare", "citiri", "documente", "datorii", "plati", "alocari",
  "chitante", "penalizari", "fonduri", "miscari", "sesizari", "mesaje", "poze", "voturi",
  "optiuni", "exprimate", "adunari", "prezente", "anunturi", "citiriAnunturi", "remindere",
  "notificari",
];

/* =============================================================================
   Regulile domeniului, identice cu functiile din baza de date
============================================================================= */

function creeazaBaza() {
  const db = { setari: null, fisiere: {} };
  TABELE.forEach((t) => { db[t] = []; });
  let secventa = 0;
  db.adauga = (tabel, rand) => {
    secventa += 1;
    const r = { id: `${tabel.slice(0, 3)}-${secventa}`, creatLa: rand.creatLa || acum(), ...rand };
    db[tabel].push(r);
    return r;
  };
  return db;
}

function persoaneInLuna(db, apartamentId, luna) {
  const randuri = db.persoane
    .filter((p) => p.apartamentId === apartamentId && p.valabilDin <= luna)
    .sort((a, b) => (a.valabilDin < b.valabilDin ? 1 : -1));
  return randuri.length ? randuri[0].numar : 0;
}

const alocatDatorie = (db, datorieId) => round2(db.alocari.filter((a) => a.datorieId === datorieId).reduce((s, a) => s + a.suma, 0));
const alocatPlata = (db, plataId) => round2(db.alocari.filter((a) => a.plataId === plataId).reduce((s, a) => s + a.suma, 0));

/* [K16/F2] O corectie negativa (facuta la recalcularea unei liste
   republicate) nu ramane deschisa separat: daca are o datorie de
   intretinere sora (aceeasi lista, acelasi apartament), restul ei propriu
   e 0, iar reducerea apare in schimb pe restul datoriei surori -- la fel
   ca in financiar.datorii_rest. Fara sora, corectia isi pastreaza propriul
   rest (poate negativ), ca suma ei sa nu dispara din Sigma(rest). */
const areDatorieSora = (db, d) => db.datorii.some((s) => s.tip === "intretinere" && s.listaId === d.listaId && s.apartamentId === d.apartamentId);
const restDatorie = (db, d) => {
  if (d.tip === "corectie" && d.suma < 0 && areDatorieSora(db, d)) return 0;
  /* [K7] ca in financiar.datorii_rest: anularea nu are rest propriu, ci se
     scade din penalizarea ei */
  if (d.tip === "anulare_penalizare") return 0;
  const propriu = round2(d.suma - alocatDatorie(db, d.id));
  if (d.tip === "penalizare") {
    return round2(propriu + db.datorii.filter((x) => x.anuleazaDatorieId === d.id).reduce((s, x) => s + x.suma, 0));
  }
  if (d.tip !== "intretinere") return propriu;
  const reducere = db.datorii
    .filter((c) => c.tip === "corectie" && c.suma < 0 && c.listaId === d.listaId && c.apartamentId === d.apartamentId)
    .reduce((s, c) => s + round2(c.suma - alocatDatorie(db, c.id)), 0);
  return round2(propriu + reducere);
};

/* Alocarea unei plati pe datorii, incepand cu cea mai veche scadenta */
function alocaPlata(db, plata) {
  let ramas = round2(plata.suma - alocatPlata(db, plata.id));
  if (ramas <= 0) return;
  const deschise = db.datorii
    .filter((d) => d.apartamentId === plata.apartamentId && restDatorie(db, d) > 0)
    .sort((a, b) => (a.scadenta === b.scadenta ? (a.creatLa < b.creatLa ? -1 : 1) : a.scadenta < b.scadenta ? -1 : 1));
  deschise.forEach((d) => {
    if (ramas <= 0) return;
    const x = Math.min(ramas, restDatorie(db, d));
    db.adauga("alocari", { plataId: plata.id, datorieId: d.id, suma: round2(x) });
    ramas = round2(ramas - x);
  });
}

/* Banii platiti in avans se aloca pe datoriile aparute ulterior */
function alocaAvansuri(db, apartamentId) {
  db.plati
    .filter((p) => p.apartamentId === apartamentId && p.stare === "confirmata")
    .sort((a, b) => (a.confirmataLa < b.confirmataLa ? -1 : 1))
    .forEach((p) => alocaPlata(db, p));
}

/* Orice plata trece prin administrator, care o confirma: inregistrataDe este
   mereu cineva. platitaDe ramane pentru platile facute de locatar insusi. */
function inregistreazaPlata(db, { apartamentId, suma, metoda, la, platitaDe = null, inregistrataDe }) {
  const ap = db.apartamente.find((a) => a.id === apartamentId);
  const plata = db.adauga("plati", {
    apartamentId, blocId: ap.blocId, suma: round2(suma), metoda, stare: "confirmata",
    platitaDe, inregistrataDe, confirmataLa: la, creatLa: la,
  });
  alocaPlata(db, plata);
  db.setari.chitantaUltimulNumar += 1;
  db.adauga("chitante", { plataId: plata.id, serie: db.setari.chitantaSerie, numar: db.setari.chitantaUltimulNumar, emisaLa: la, creatLa: la });
  return plata;
}

/* Penalizarile lunii: pentru fiecare datorie ramasa neachitata dupa zilele de
   gratie, rest x procent pe zi x zilele de intarziere de la ultimul calcul. */
/* [K16/H3] Baza de calcul a unei datorii de intretinere: suma ei redusa de
   corectiile negative surori (aceeasi lista, acelasi apartament) -- exact
   formula din financiar.calculeaza_penalizari (migratia H3). Pentru orice
   alt tip de datorie, baza e chiar suma ei. */
function bazaIntretinere(db, d) {
  if (d.tip !== "intretinere") return d.suma;
  const corectii = db.datorii.filter((c) => c.tip === "corectie" && c.suma < 0 && c.listaId === d.listaId && c.apartamentId === d.apartamentId);
  return round2(d.suma + corectii.reduce((s, c) => s + c.suma, 0));
}

function calculeazaPenalizari(db, la) {
  const { procentPenalizareZi, zileGratie } = db.setari;
  db.datorii
    .filter((d) => d.tip !== "penalizare")
    .forEach((d) => {
      const inceput = adaugaZile(d.scadenta, zileGratie);
      const anterioare = db.penalizari.filter((p) => p.datorieSursaId === d.id).map((p) => p.lunaCalcul).sort();
      const dela = anterioare.length && anterioare[anterioare.length - 1] > inceput ? anterioare[anterioare.length - 1] : inceput;
      const zileTaxate = zileIntre(dela, la);
      if (zileTaxate <= 0) return;
      /* [K16/H3] baza corectata: o corectie negativa sora (aceeasi lista,
         acelasi apartament) reduce direct baza pe care se calculeaza restul
         si plafonul unei datorii de intretinere. */
      const baza = bazaIntretinere(db, d);
      const rest = round2(baza - alocatDatorie(db, d.id));
      if (rest <= 0) return;
      /* Legea 196/2018: toate penalizarile unei datorii nu depasesc datoria (corectata) */
      const plafon = round2(baza - db.penalizari.filter((p) => p.datorieSursaId === d.id).reduce((s, p) => s + p.suma, 0));
      const suma = Math.min(rest, plafon, round2((rest * procentPenalizareZi * zileTaxate) / 100));
      if (suma <= 0) return;
      const pen = db.adauga("datorii", {
        apartamentId: d.apartamentId, blocId: d.blocId, tip: "penalizare", luna: lunaDe(la), listaId: null,
        suma, scadenta: la, descriere: `Penalizare pentru ${d.descriere.toLowerCase()}`, creatLa: `${la}T00:05:00Z`,
      });
      db.adauga("penalizari", {
        datorieSursaId: d.id, datorieId: pen.id, lunaCalcul: la, restNeachitat: rest,
        zileIntarziere: zileIntre(d.scadenta, la), zileGratie, zileTaxate, procentZi: procentPenalizareZi, suma,
      });
      alocaAvansuri(db, d.apartamentId);
    });
}

function notifica(db, { profilId, asociatieId, tip, titlu, corp, la, referinta = null }) {
  /* In datele demo, mesajele mai vechi de doua saptamani sunt deja citite */
  const vechi = la && Date.now() - Date.parse(la) > 14 * 86400000;
  db.adauga("notificari", { profilId, asociatieId, tip, titlu, corp, canal: "aplicatie", trimisaLa: la || acum(), cititaLa: vechi ? la : null, referinta, creatLa: la || acum() });
}

const locatariActivi = (db, apartamentId) => db.locatari.filter((l) => l.apartamentId === apartamentId && !l.activPana);

/* [J1] Cascada extinsa (migratia 20260920190515): dupa ce o citire devine
   validata -- prin validare (valideazaCitire, valideazaCitiriApartament),
   estimare (estimeazaCitiri) sau citirea contorului general (J7) --
   recalculeaza indexAnterior (si, in cascada, consum) al citirilor mai noi
   ale aceluiasi contor, oricare le-ar fi starea (trimisa sau validata), mai
   putin respinsa, fara sa atinga o luna a carei lista e deja publicata
   (banii ei sunt inghetati de motor, invariantul central al aplicatiei).
   Citirea tocmai validata/estimata are ea insasi luna = dupaLuna < x.luna
   pentru orice x atins mai jos, deci lista de candidati gaseste mereu cel
   putin un candidat: fara fallback la 0. */
function recalculeazaViitorul(db, contorId, blocId, dupaLuna) {
  db.citiri
    .filter((x) => x.contorId === contorId && x.luna > dupaLuna && x.stare !== "respinsa")
    .filter((x) => !db.liste.some((l) => l.blocId === blocId && l.luna === x.luna && l.stare === "publicata"))
    .forEach((x) => {
      const anterioare = db.citiri
        .filter((y) => y.contorId === contorId && y.luna < x.luna && y.stare === "validata")
        .sort((a, b) => b.luna.localeCompare(a.luna));
      x.indexAnterior = anterioare[0].indexCurent;
      x.consum = round3(x.indexCurent - x.indexAnterior);
    });
}

function consumLuna(db, blocId, luna) {
  const consum = {};
  const general = {};
  db.citiri
    .filter((c) => c.blocId === blocId && c.luna === luna && c.stare === "validata" && c.sursa !== "pornire")
    .forEach((c) => {
      if (c.apartamentId) {
        consum[c.apartamentId] = consum[c.apartamentId] || {};
        consum[c.apartamentId][c.tip] = round3((consum[c.apartamentId][c.tip] || 0) + c.consum);
      } else {
        general[c.tip] = round3((general[c.tip] || 0) + c.consum);
      }
    });
  return { consum, contorGeneral: general };
}

function dateMotor(db, lista) {
  const apartamente = db.apartamente
    .filter((a) => a.blocId === lista.blocId)
    .map((a) => ({ id: a.id, numar: a.numar, persoane: persoaneInLuna(db, a.id, lista.luna), cota: a.cota, scutitLift: a.scutitLift }));
  const cheltuieli = db.cheltuieli
    .filter((c) => c.listaId === lista.id)
    .map((c) => ({ id: c.id, cod: c.cod, suma: c.suma, metoda: c.metoda, tipApa: c.tipApa }));
  return { apartamente, cheltuieli, ...consumLuna(db, lista.blocId, lista.luna) };
}

/* Publicarea: motorul calculeaza, rezultatul se scrie o singura data, iar
   Financiar reactioneaza la ListaPublicata cu datoriile si miscarea din fond. */
function publica(db, listaId, la, deCine) {
  const lista = db.liste.find((l) => l.id === listaId) || eroare("Lista nu exista.");
  if (lista.stare !== "ciorna") eroare("Lista este deja publicata.");
  /* [K6] ca trigger-ul din baza: dupa publicare, o citire trimisa nu mai
     poate fi verificata de nicio comanda si ar ramane blocata */
  const trimise = db.citiri.filter((c) => c.blocId === lista.blocId && c.luna === lista.luna && c.stare === "trimisa").length;
  if (trimise === 1) eroare(`Pe ${lunaText(lista.luna)} mai este o citire de verificat. Valideaza-o sau respinge-o, apoi publica lista.`);
  const de = trimise >= 20 && (trimise % 100 === 0 || trimise % 100 > 19) ? " de" : "";
  if (trimise > 1) eroare(`Pe ${lunaText(lista.luna)} mai sunt ${trimise}${de} citiri de verificat. Valideaza-le sau respinge-le, apoi publica lista.`);
  const cheltuieli = db.cheltuieli.filter((c) => c.listaId === lista.id);
  if (cheltuieli.length === 0) eroare("Lista nu are nicio cheltuiala.");
  const rezultat = calculeazaLista(dateMotor(db, lista));
  if (rezultat.totalCheltuieli !== rezultat.totalRepartizat) eroare("Totalul repartizat nu este egal cu totalul facturilor.");

  rezultat.repartizari.forEach((r) => db.adauga("repartizari", { ...r, listaId: lista.id, versiune: lista.versiune, blocId: lista.blocId }));
  lista.stare = "publicata";
  lista.publicataLa = la;
  lista.publicataDe = deCine;
  lista.scadenta = lista.scadenta || `${lunaUrmatoare(lista.luna)}-${pad(db.setari.ziScadenta)}`;

  /* Financiar: o datorie de intretinere pe apartament */
  const perAp = {};
  rezultat.repartizari.forEach((r) => { perAp[r.apartamentId] = round2((perAp[r.apartamentId] || 0) + r.suma); });
  Object.entries(perAp).forEach(([apartamentId, suma]) => {
    if (suma <= 0) return;
    db.adauga("datorii", {
      apartamentId, blocId: lista.blocId, tip: "intretinere", luna: lista.luna, listaId: lista.id, versiune: lista.versiune,
      suma, scadenta: lista.scadenta, descriere: `Intretinere ${lunaText(lista.luna)}`, creatLa: la,
    });
    alocaAvansuri(db, apartamentId);
  });

  /* Financiar: banii fondului de reparatii intra in fond */
  const fond = db.fonduri.find((f) => f.blocId === lista.blocId && f.tip === "reparatii");
  const sumaFond = round2(cheltuieli.filter((c) => c.tip === "fond_reparatii").reduce((s, c) => s + c.suma, 0));
  if (fond && sumaFond > 0) {
    db.adauga("miscari", { fondId: fond.id, data: la.slice(0, 10), suma: sumaFond, descriere: `Contributii fond reparatii, lista pe ${lunaText(lista.luna)}`, listaId: lista.id, creatLa: la });
  }

  /* Comunicare: reminderul "a iesit lista" */
  const bloc = db.blocuri.find((b) => b.id === lista.blocId);
  const reminder = db.remindere.find((r) => r.asociatieId === bloc.asociatieId && r.tip === "lista_publicata");
  if (reminder && reminder.activ) {
    db.apartamente.filter((a) => a.blocId === bloc.id).forEach((a) => {
      locatariActivi(db, a.id).forEach((l) => notifica(db, {
        profilId: l.profilId, asociatieId: bloc.asociatieId, tip: "lista_publicata", la,
        titlu: `Lista pe ${lunaText(lista.luna)} a fost publicata`, corp: `Vezi in aplicatie cat ai de plata si cum s-a calculat fiecare suma. Termenul de plata este ${dataText(lista.scadenta)}.`,
        referinta: { listaId: lista.id },
      }));
    });
  }
  return lista;
}

function deschideLista(db, blocId, luna) {
  const existenta = db.liste.find((l) => l.blocId === blocId && l.luna === luna);
  if (existenta) return existenta;
  const lista = db.adauga("liste", { blocId, luna, stare: "ciorna", versiune: 1, scadenta: null, publicataLa: null });
  db.recurente.filter((r) => r.blocId === blocId && r.activa).forEach((r) => {
    db.adauga("cheltuieli", {
      listaId: lista.id, tip: r.tip, cod: r.cod, categorie: r.categorie, furnizorId: null, serie: r.hotarare,
      suma: r.suma, metoda: r.metoda, tipApa: null, emisa: null, scadentaFurnizor: null, achitataLa: null, documentId: r.documentId,
    });
  });
  return lista;
}

/* =============================================================================
   Rejucarea datelor demo
============================================================================= */

function construiesteDemo() {
  const db = creeazaBaza();
  const asoc = db.adauga("asociatii", { ...D.ASOCIATIE });
  db.setari = { ...D.SETARI_FINANCIARE, ziLimitaCitire: D.ZI_LIMITA_CITIRE };
  const bloc = db.adauga("blocuri", {
    asociatieId: asoc.id, denumire: D.BLOC.denumire, adresa: D.BLOC.adresa, etaje: D.BLOC.etaje,
    localitate: `${D.BLOC.uat.denumire}, judetul ${D.BLOC.judet.denumire}`, stare: "activ",
  });

  const ap = {};
  D.APARTAMENTE.forEach((a) => {
    ap[a.numar] = db.adauga("apartamente", {
      blocId: bloc.id, numar: a.numar, etaj: a.etaj, proprietar: a.proprietar, cota: a.cota, mp: a.mp, scutitLift: a.scutitLift,
    });
    db.adauga("persoane", { apartamentId: ap[a.numar].id, valabilDin: D.LUNA_PORNIRE, numar: a.persoane, motiv: "Preluat de pe lista de plata din mai 2026" });
  });

  D.CONTACTE.forEach((c, i) => db.adauga("contacte", {
    asociatieId: asoc.id, blocId: bloc.id, rol: c.rol, nume: c.nume, telefon: c.telefon, program: c.program || null,
    apartamentNumar: c.apartament || null, ordine: i + 1,
  }));

  const furnizor = {};
  D.FURNIZORI.forEach((f) => { furnizor[f.cheie] = db.adauga("furnizori", { asociatieId: asoc.id, ...f }); });

  const profil = {};
  /* Conducerea (presedinte, cenzor) se creeaza la sfarsit, dupa toate
     celelalte date: identificatorii din sursa demo sunt o secventa unica, iar
     testele se sprijina pe ei (lis-807, che-12 si asa mai departe). */
  D.CONTURI.filter((c) => c.rol !== "presedinte" && c.rol !== "cenzor").forEach((c) => {
    profil[c.cheie] = db.adauga("profiluri", { nume: c.nume, telefon: normalizeazaTelefon(c.telefon) });
    db.autentificari.push({ telefon: normalizeazaTelefon(c.telefon), parola: D.PAROLA_DEMO, profilId: profil[c.cheie].id });
    if (c.rol === "administrator") {
      db.adauga("administratori", { profilId: profil[c.cheie].id, numarAtestat: c.atestat, stare: "aprobat" });
      db.adauga("membri", { asociatieId: asoc.id, profilId: profil[c.cheie].id, rol: "administrator", activDin: "2026-05-01", activPana: null });
    } else if (c.rol === "administrator_in_asteptare") {
      db.adauga("administratori", { profilId: profil[c.cheie].id, numarAtestat: c.atestat, stare: "in_asteptare" });
    } else {
      db.adauga("locatari", { apartamentId: ap[c.apartament].id, blocId: bloc.id, profilId: profil[c.cheie].id, calitate: c.calitate, activDin: "2026-06-01", activPana: null });
    }
  });
  const admin = profil.admin.id;

  D.REMINDERE.forEach((r) => db.adauga("remindere", { asociatieId: asoc.id, ...r }));

  const doc = (titlu, tip, data, extra = {}) =>
    db.adauga("documente", { asociatieId: asoc.id, blocId: bloc.id, titlu, tip, cale: null, vizibilLocatarilor: true, incarcatDe: admin, creatLa: `${data}T10:00:00+03:00`, ...extra });
  const docuri = {};
  D.DOCUMENTE.forEach((d) => { docuri[d.titlu] = doc(d.titlu, d.tip, d.data); });
  const docPv = docuri["Proces verbal adunare generala, 12 martie 2026"];
  const docListaHartie = docuri["Lista de plata din mai 2026, de pe hartie"];

  D.RECURENTE.forEach((r) => db.adauga("recurente", { blocId: bloc.id, ...r, activa: true, documentId: docPv.id }));

  /* Contoarele: cate unul de apa rece si unul de apa calda pe apartament,
     plus cele doua contoare generale de la subsol */
  const contor = { general: {} };
  ["rece", "calda"].forEach((tip) => {
    contor.general[tip] = db.adauga("contoare", { blocId: bloc.id, apartamentId: null, tip, serie: `GEN-${tip.toUpperCase()}-014`, amplasare: "subsol" });
  });
  D.APARTAMENTE.forEach((a) => {
    contor[a.numar] = {};
    ["rece", "calda"].forEach((tip) => {
      contor[a.numar][tip] = db.adauga("contoare", { blocId: bloc.id, apartamentId: ap[a.numar].id, tip, serie: `${tip === "rece" ? "R" : "C"}-D14-${pad(a.numar)}`, amplasare: "baie" });
    });
  });

  const ultimIndex = (contorId) => {
    const valabile = db.citiri.filter((c) => c.contorId === contorId && c.stare !== "respinsa").sort((a, b) => (a.luna < b.luna ? 1 : -1));
    return valabile[0].indexCurent;
  };
  const citeste = (c, luna, consum, extra) => {
    const anterior = ultimIndex(c.id);
    return db.adauga("citiri", {
      contorId: c.id, blocId: bloc.id, apartamentId: c.apartamentId, tip: c.tip, luna,
      indexAnterior: anterior, indexCurent: round3(anterior + consum), consum: round3(consum),
      sursa: "locatar", stare: "validata", pozaCale: null, motivRespingere: null, ...extra,
    });
  };

  /* Luna zero: indexurile de pornire de pe foaia de citiri */
  ["rece", "calda"].forEach((tip) => {
    const p = D.INDEX_PORNIRE_GENERAL[tip];
    db.adauga("citiri", { contorId: contor.general[tip].id, blocId: bloc.id, apartamentId: null, tip, luna: D.LUNA_PORNIRE, indexAnterior: p, indexCurent: p, consum: 0, sursa: "pornire", stare: "validata", transmisaLa: "2026-05-31T12:00:00+03:00", documentId: docListaHartie.id });
  });
  D.APARTAMENTE.forEach((a) => ["rece", "calda"].forEach((tip) => {
    const p = D.indexPornire(a.numar, tip);
    db.adauga("citiri", { contorId: contor[a.numar][tip].id, blocId: bloc.id, apartamentId: ap[a.numar].id, tip, luna: D.LUNA_PORNIRE, indexAnterior: p, indexCurent: p, consum: 0, sursa: "pornire", stare: "validata", transmisaLa: "2026-05-31T12:00:00+03:00", documentId: docListaHartie.id });
  }));

  D.RESTANTE_INITIALE.forEach((r) => db.adauga("datorii", {
    apartamentId: ap[r.numar].id, blocId: bloc.id, tip: "sold_initial", luna: r.luna, listaId: null,
    suma: r.suma, scadenta: r.scadenta, descriere: r.descriere, documentId: docListaHartie.id, creatLa: "2026-05-31T12:00:00+03:00",
  }));

  D.FONDURI.forEach((f) => {
    const fond = db.adauga("fonduri", { blocId: bloc.id, tip: f.tip, denumire: f.denumire, sumaPerApartament: f.sumaPerApartament });
    f.miscari.forEach((m) => db.adauga("miscari", {
      fondId: fond.id, data: m.data, suma: m.suma, descriere: m.descriere,
      documentId: m.document ? doc(m.document, "factura", m.data).id : null, creatLa: `${m.data}T12:00:00+03:00`,
    }));
  });

  /* Cronologia: citiri, publicari, plati si calculul penalizarilor */
  const evenimente = [];
  D.LUNI_PUBLICATE.forEach((luna) => {
    evenimente.push({
      la: `${luna}-27T20:00:00+03:00`,
      fa: (la) => {
        D.APARTAMENTE.forEach((a) => ["rece", "calda"].forEach((tip) => {
          citeste(contor[a.numar][tip], luna, D.consumApartament(a.numar, luna, tip), { transmisaLa: la, transmisaDe: null, verificataLa: la });
        }));
        ["rece", "calda"].forEach((tip) => citeste(contor.general[tip], luna, D.CONTOR_GENERAL[luna][tip], { sursa: "administrator", transmisaLa: la, verificataLa: la }));
      },
    });
    evenimente.push({
      la: D.PUBLICARI[luna].publicataLa,
      fa: (la) => {
        const lista = deschideLista(db, bloc.id, luna);
        lista.scadenta = D.PUBLICARI[luna].scadenta;
        db.cheltuieli.filter((c) => c.listaId === lista.id).forEach((c) => { c.creatLa = la; });
        D.FACTURI[luna].forEach((f) => {
          const fz = furnizor[f.furnizor];
          const scan = doc(`Factura ${f.serie}, ${fz.denumire}`, "factura", f.emisa);
          db.adauga("cheltuieli", {
            listaId: lista.id, tip: "factura", cod: fz.cod, categorie: fz.categorie, furnizorId: fz.id, serie: f.serie,
            suma: f.suma, metoda: fz.metoda, tipApa: fz.tipApa || null, emisa: f.emisa, scadentaFurnizor: f.scadenta,
            achitataLa: f.achitataLa && f.achitataLa <= aziIso() ? f.achitataLa : null, documentId: scan.id,
          });
        });
        publica(db, lista.id, la, admin);
      },
    });
  });
  D.PLATI.forEach((p) => evenimente.push({
    la: p.data,
    fa: (la) => {
      const lista = db.liste.find((l) => l.luna === p.luna);
      const datorie = db.datorii.find((d) => d.listaId === lista.id && d.apartamentId === ap[p.numar].id && d.tip === "intretinere");
      /* Banii ajung la asociatie in numerar sau prin transfer, iar
         administratorul ii confirma in aplicatie: el este cel care
         inregistreaza plata, indiferent de drumul banilor. */
      inregistreazaPlata(db, {
        apartamentId: ap[p.numar].id, suma: p.suma || datorie.suma, metoda: p.metoda, la, inregistrataDe: admin,
      });
    },
  }));
  D.CALCULE_PENALIZARI.forEach((z) => evenimente.push({ la: `${z}T00:05:00+03:00`, fa: () => calculeazaPenalizari(db, z) }));
  evenimente.sort((a, b) => Date.parse(a.la) - Date.parse(b.la)).forEach((e) => e.fa(e.la));

  /* Luna in curs: lista in lucru si citirile transmise pana acum */
  deschideLista(db, bloc.id, D.LUNA_CIORNA);
  const c = D.CITIRI_LUNA_CURENTA;
  const luna = D.LUNA_CIORNA;
  const transmite = (numar, extra) => ["rece", "calda"].forEach((tip) => citeste(contor[numar][tip], luna, D.consumApartament(numar, luna, tip), {
    transmisaLa: c.dataTransmitere, pozaCale: `demo/contor-${numar}.jpg`, ...extra,
  }));
  c.validate.forEach((n) => transmite(n, { stare: "validata", verificataLa: c.dataTransmitere }));
  c.trimise.forEach((n) => transmite(n, { stare: "trimisa" }));
  c.respinse.forEach((r) => transmite(r.numar, { stare: "respinsa", motivRespingere: r.motiv, verificataLa: c.dataTransmitere }));

  D.SESIZARI.forEach((s) => {
    const autor = locatariActivi(db, ap[s.numar].id)[0];
    const ses = db.adauga("sesizari", {
      blocId: bloc.id, apartamentId: ap[s.numar].id, autorId: autor ? autor.profilId : admin, categorie: s.categorie,
      titlu: s.titlu, descriere: s.descriere, stare: s.stare, creatLa: s.creataLa,
      preluataLa: s.preluataLa || null, rezolvataLa: s.rezolvataLa || null,
    });
    s.mesaje.forEach((m) => db.adauga("mesaje", { sesizareId: ses.id, autorId: admin, dinAdministratie: m.dinAdministratie, text: m.text, creatLa: m.la }));
    for (let i = 0; i < s.poze; i += 1) db.adauga("poze", { sesizareId: ses.id, cale: `demo/sesizare-${s.cheie}-${i + 1}.jpg` });
  });

  D.ANUNTURI.forEach((a) => {
    const an = db.adauga("anunturi", { asociatieId: asoc.id, blocId: bloc.id, autorId: admin, titlu: a.titlu, corp: a.corp, urgent: a.urgent, publicatLa: a.publicatLa, creatLa: a.publicatLa });
    a.cititDe.forEach((numar) => locatariActivi(db, ap[numar].id).forEach((l) => db.adauga("citiriAnunturi", { anuntId: an.id, profilId: l.profilId, cititLa: a.publicatLa })));
  });

  const vot = db.adauga("voturi", {
    asociatieId: asoc.id, titlu: D.VOT.titlu, descriere: D.VOT.descriere, deschisLa: D.VOT.deschisLa,
    inchideLa: D.VOT.inchideLa, numarare: D.VOT.numarare, creatDe: admin, creatLa: D.VOT.deschisLa,
  });
  const optiuni = D.VOT.optiuni.map((text, i) => db.adauga("optiuni", { votId: vot.id, text, ordine: i + 1 }));
  Object.entries(D.VOT.voturi).forEach(([numar, i]) => db.adauga("exprimate", {
    votId: vot.id, optiuneId: optiuni[i].id, apartamentId: ap[numar].id, profilId: null, creatLa: D.VOT.deschisLa,
  }));

  const adunare = db.adauga("adunari", { asociatieId: asoc.id, dataOra: D.ADUNARE.dataOra, loc: D.ADUNARE.loc, ordineDeZi: D.ADUNARE.ordineDeZi, creatLa: D.ADUNARE.convocataLa });
  D.ADUNARE.prezente.forEach((numar) => db.adauga("prezente", { adunareId: adunare.id, apartamentId: ap[numar].id, profilId: null, confirmatLa: D.ADUNARE.convocataLa }));

  locatariActivi(db, ap["3"].id).forEach((l) => notifica(db, {
    profilId: l.profilId, asociatieId: asoc.id, tip: "restanta", la: "2026-09-01T09:00:00+03:00",
    titlu: "Instiintare de plata", corp: "Aveti sume neachitate trecute de scadenta. Va rugam sa le achitati ca sa opriti penalizarile.",
  }));
  /* Conducerea asociatiei, la urma (vezi mai sus, despre identificatori) */
  D.CONTURI.filter((c) => c.rol === "presedinte" || c.rol === "cenzor").forEach((c) => {
    const p = db.adauga("profiluri", { nume: c.nume, telefon: normalizeazaTelefon(c.telefon) });
    db.autentificari.push({ telefon: normalizeazaTelefon(c.telefon), parola: D.PAROLA_DEMO, profilId: p.id });
    db.adauga("membri", { asociatieId: asoc.id, profilId: p.id, rol: c.rol, activDin: "2026-06-01", activPana: null });
  });

  return db;
}

/* =============================================================================
   Ce vede utilizatorul autentificat
============================================================================= */

function rolul(db, profilId) {
  const adm = db.administratori.find((a) => a.profilId === profilId);
  const mandat = db.membri.find((m) => m.profilId === profilId && m.rol === "administrator" && !m.activPana);
  const legaturi = db.locatari.filter((l) => l.profilId === profilId && !l.activPana);
  if (adm && adm.stare === "aprobat" && mandat) return { rol: "administrator", mandat, legaturi };
  /* [paritate identitate.eu()] conducerea care verifica: presedintele intai,
     apoi cenzorul. Vad tot blocul, fara sa poata schimba ceva. */
  const mandate = db.membri.filter((m) => m.profilId === profilId && (m.rol === "presedinte" || m.rol === "cenzor") && !m.activPana);
  const supraveghere = mandate.find((m) => m.rol === "presedinte") || mandate[0];
  if (supraveghere) return { rol: supraveghere.rol, mandat: supraveghere, legaturi };
  if (legaturi.length) return { rol: "locatar", mandat: null, legaturi };
  if (adm && adm.stare === "in_asteptare") return { rol: "in_asteptare", legaturi };
  return { rol: "fara_apartament", legaturi };
}

/* Rolurile care vad tot blocul (scriu doar administratorul) */
const conduce = (rol) => rol === "administrator" || rol === "presedinte" || rol === "cenzor";

function proiecteaza(db, profilId, apartamentAles) {
  const profil = db.profiluri.find((p) => p.id === profilId);
  const { rol, mandat, legaturi } = rolul(db, profilId);
  const azi = aziIso();
  const eu = { profilId, nume: profil.nume, telefon: profil.telefon, rol, apartamentId: legaturi[0] ? legaturi[0].apartamentId : null };
  if (!conduce(rol) && rol !== "locatar") return { azi, eu };

  /* [paritate] presedintele si cenzorul vad tot blocul, ca administratorul */
  const esteAdmin = conduce(rol);
  const bloc = esteAdmin
    ? db.blocuri.find((b) => b.asociatieId === mandat.asociatieId)
    : db.blocuri.find((b) => b.id === db.apartamente.find((a) => a.id === eu.apartamentId).blocId);
  const asociatie = db.asociatii.find((a) => a.id === bloc.asociatieId);
  const apBloc = db.apartamente.filter((a) => a.blocId === bloc.id);
  /* [P5] acelasi om poate fi legat de mai multe apartamente ale aceluiasi
     bloc (proprietar la unul, chirias la altul): toate legaturile lui din
     acest bloc raman vizibile dintr-o singura incarcare, iar apartamentAles
     (daca e chiar al lui) devine apartamentul activ. */
  if (!esteAdmin) {
    const legaturileBloc = legaturi.filter((l) => {
      const a = db.apartamente.find((x) => x.id === l.apartamentId);
      return a && a.blocId === bloc.id;
    });
    eu.apartamenteMele = legaturileBloc.map((l) => l.apartamentId);
    if (apartamentAles && eu.apartamenteMele.includes(apartamentAles)) eu.apartamentId = apartamentAles;
    /* [P1] calitatea la apartamentul activ, ca ecranele sa stie inainte sa
       lase omul sa incerce o actiune rezervata proprietarului (votul).
       eu.apartamentId e mereu cel implicit (in legaturileBloc prin
       constructia lui bloc) sau un apartamentAles deja validat mai sus,
       deci se gaseste mereu aici. */
    eu.calitate = legaturileBloc.find((l) => l.apartamentId === eu.apartamentId).calitate;
  }
  const vizibile = esteAdmin ? apBloc.map((a) => a.id) : eu.apartamenteMele;
  const alMeu = (id) => vizibile.includes(id);
  const lunaAzi = lunaDe(azi);

  const apartamente = apBloc.filter((a) => alMeu(a.id)).map((a) => ({
    id: a.id, numar: a.numar, etaj: a.etaj, proprietar: a.proprietar, cota: a.cota, mp: a.mp, scutitLift: a.scutitLift,
    persoane: persoaneInLuna(db, a.id, lunaAzi),
    istoricPersoane: db.persoane.filter((p) => p.apartamentId === a.id).sort((x, y) => (x.valabilDin < y.valabilDin ? 1 : -1))
      .map((p) => ({ valabilDin: p.valabilDin, numar: p.numar, motiv: p.motiv })),
    locatari: esteAdmin ? db.locatari.filter((l) => l.apartamentId === a.id).map((l) => {
      const p = db.profiluri.find((x) => x.id === l.profilId);
      return { id: l.id, profilId: l.profilId, nume: p.nume, telefon: p.telefon, calitate: l.calitate, activDin: l.activDin, activPana: l.activPana };
    }) : [],
  }));

  const liste = db.liste
    .filter((l) => l.blocId === bloc.id && (esteAdmin || l.stare === "publicata"))
    .sort((a, b) => (a.luna < b.luna ? 1 : -1))
    .map((l) => {
      const rep = db.repartizari.filter((r) => r.listaId === l.id && r.versiune === l.versiune);
      return {
        id: l.id, luna: l.luna, stare: l.stare, versiune: l.versiune, scadenta: l.scadenta, publicataLa: l.publicataLa,
        totalRepartizat: round2(rep.reduce((s, r) => s + r.suma, 0)), apartamente: new Set(rep.map((r) => r.apartamentId)).size,
      };
    });
  const idListe = liste.map((l) => l.id);

  const cheltuieli = db.cheltuieli.filter((c) => idListe.includes(c.listaId)).map((c) => {
    const f = db.furnizori.find((x) => x.id === c.furnizorId);
    return {
      id: c.id, listaId: c.listaId, cod: c.cod, tip: c.tip, categorie: c.categorie, furnizorId: c.furnizorId,
      furnizor: f ? f.denumire : asociatie.denumire, serie: c.serie, suma: c.suma, metoda: c.metoda, tipApa: c.tipApa,
      emisa: c.emisa, scadentaFurnizor: c.scadentaFurnizor, achitataLa: c.achitataLa, documentId: c.documentId,
    };
  });

  const repartizari = db.repartizari
    .filter((r) => idListe.includes(r.listaId) && alMeu(r.apartamentId) && r.versiune === db.liste.find((l) => l.id === r.listaId).versiune)
    .map((r) => ({ cheltuialaId: r.cheltuialaId, listaId: r.listaId, apartamentId: r.apartamentId, suma: r.suma, baza: r.baza, rotunjire: r.rotunjire, detaliu: r.detaliu }));

  const contoare = db.contoare.filter((c) => c.blocId === bloc.id && (esteAdmin || c.apartamentId === eu.apartamentId))
    .map((c) => ({ id: c.id, apartamentId: c.apartamentId, tip: c.tip, serie: c.serie, amplasare: c.amplasare }));
  const citiri = db.citiri.filter((c) => c.blocId === bloc.id && (esteAdmin || c.apartamentId === eu.apartamentId))
    .map((c) => ({
      id: c.id, contorId: c.contorId, apartamentId: c.apartamentId, tip: c.tip, luna: c.luna, indexAnterior: c.indexAnterior,
      indexCurent: c.indexCurent, consum: c.consum, sursa: c.sursa, stare: c.stare, pozaCale: c.pozaCale,
      motivRespingere: c.motivRespingere, transmisaLa: c.transmisaLa || null,
    }));

  /* Media blocului pe persoana, fara randurile altor apartamente */
  const consumMediu = {};
  [...new Set(db.citiri.filter((c) => c.blocId === bloc.id && c.apartamentId && c.stare === "validata" && c.sursa !== "pornire").map((c) => c.luna))].forEach((luna) => {
    const pers = apBloc.reduce((s, a) => s + persoaneInLuna(db, a.id, luna), 0);
    const rand = {};
    ["rece", "calda"].forEach((tip) => {
      const cit = db.citiri.filter((c) => c.blocId === bloc.id && c.apartamentId && c.luna === luna && c.tip === tip && c.stare === "validata");
      const apCu = new Set(cit.map((c) => c.apartamentId));
      const persCu = apBloc.filter((a) => apCu.has(a.id)).reduce((s, a) => s + persoaneInLuna(db, a.id, luna), 0);
      rand[tip] = persCu > 0 ? round2(cit.reduce((s, c) => s + c.consum, 0) / persCu) : null;
    });
    rand.apartamente = new Set(db.citiri.filter((c) => c.blocId === bloc.id && c.apartamentId && c.luna === luna && c.stare === "validata").map((c) => c.apartamentId)).size;
    rand.persoane = pers;
    consumMediu[luna] = rand;
  });

  const datorii = db.datorii.filter((d) => d.blocId === bloc.id && alMeu(d.apartamentId)).map((d) => ({
    id: d.id, apartamentId: d.apartamentId, tip: d.tip, luna: d.luna, listaId: d.listaId, suma: d.suma,
    scadenta: d.scadenta, descriere: d.descriere, rest: restDatorie(db, d), documentId: d.documentId || null, creatLa: d.creatLa,
    anuleazaDatorieId: d.anuleazaDatorieId || null,
  }));
  const idDatorii = datorii.map((d) => d.id);
  const penalizari = db.penalizari.filter((p) => idDatorii.includes(p.datorieId)).map((p) => ({ ...p }));
  const plati = db.plati.filter((p) => p.blocId === bloc.id && alMeu(p.apartamentId)).map((p) => {
    const ch = db.chitante.find((c) => c.plataId === p.id);
    const inreg = db.profiluri.find((x) => x.id === p.inregistrataDe);
    return {
      id: p.id, apartamentId: p.apartamentId, suma: p.suma, metoda: p.metoda, stare: p.stare, confirmataLa: p.confirmataLa,
      inregistrataDe: inreg.nume,
      chitanta: { serie: ch.serie, numar: ch.numar, emisaLa: ch.emisaLa },
      alocari: db.alocari.filter((a) => a.plataId === p.id).map((a) => ({ datorieId: a.datorieId, suma: a.suma })),
    };
  });

  const restantaAp = (apId) => round2(db.datorii.filter((d) => d.apartamentId === apId && d.scadenta < azi).reduce((s, d) => s + restDatorie(db, d), 0));
  const situatieBloc = {
    apartamente: apBloc.length,
    faraRestanta: apBloc.filter((a) => restantaAp(a.id) <= 0).length,
    /* [K4] ca in baza: doar cine datoreaza; un rest negativ nu scade restantele celorlalti */
    restanteTotal: round2(apBloc.reduce((s, a) => s + Math.max(restantaAp(a.id), 0), 0)),
  };

  const fonduri = db.fonduri.filter((f) => f.blocId === bloc.id).map((f) => {
    const miscari = db.miscari.filter((m) => m.fondId === f.id).sort((a, b) => (a.data < b.data ? 1 : -1));
    return {
      id: f.id, tip: f.tip, denumire: f.denumire, sumaPerApartament: f.sumaPerApartament,
      sold: round2(miscari.reduce((s, m) => s + m.suma, 0)),
      miscari: miscari.map((m) => ({ id: m.id, data: m.data, suma: m.suma, descriere: m.descriere, documentId: m.documentId || null, listaId: m.listaId || null })),
    };
  });

  const numarAp = (id) => db.apartamente.find((a) => a.id === id).numar;
  /* [K4] "a mea" nu inseamna doar acelasi apartament, ci ca eu locuiam acolo
     cand a fost scrisa sesizarea: altfel un chirias nou ar mosteni
     conversatia si pozele fostului locatar. */
  const legaturaCurenta = (apartamentId) => db.locatari.find((l) => l.profilId === eu.profilId && l.apartamentId === apartamentId && !l.activPana);
  const sesizari = db.sesizari.filter((s) => s.blocId === bloc.id).sort((a, b) => (a.creatLa < b.creatLa ? 1 : -1)).map((s) => {
    const legatura = legaturaCurenta(s.apartamentId);
    const aMea = !!legatura && s.creatLa >= legatura.activDin;
    const complet = esteAdmin || aMea;
    return {
      id: s.id, aMea, titlu: s.titlu, categorie: s.categorie, stare: s.stare, creataLa: s.creatLa,
      preluataLa: s.preluataLa, rezolvataLa: s.rezolvataLa,
      /* [K10] descrierea nu apare in vederea anonima (autorul se poate deduce). */
      descriere: complet ? s.descriere : null,
      apartamentId: complet ? s.apartamentId : null, apartamentNumar: complet ? numarAp(s.apartamentId) : null,
      mesaje: complet ? db.mesaje.filter((m) => m.sesizareId === s.id).sort((a, b) => (a.creatLa < b.creatLa ? -1 : 1)).map((m) => ({
        id: m.id, text: m.text, la: m.creatLa, dinAdministratie: m.dinAdministratie,
        autor: db.profiluri.find((p) => p.id === m.autorId).nume,
      })) : [],
      poze: complet ? db.poze.filter((p) => p.sesizareId === s.id).map((p) => ({ id: p.id, cale: p.cale })) : [],
    };
  });

  const profiluriLocatari = new Set(db.locatari.filter((l) => l.blocId === bloc.id && !l.activPana).map((l) => l.profilId));
  const anunturi = db.anunturi.filter((a) => a.asociatieId === asociatie.id && (!a.blocId || a.blocId === bloc.id))
    .sort((a, b) => (a.publicatLa < b.publicatLa ? 1 : -1)).map((a) => ({
      id: a.id, titlu: a.titlu, corp: a.corp, urgent: a.urgent, publicatLa: a.publicatLa,
      autor: db.profiluri.find((p) => p.id === a.autorId).nume,
      citit: db.citiriAnunturi.some((c) => c.anuntId === a.id && c.profilId === profilId),
      cititori: esteAdmin ? db.citiriAnunturi.filter((c) => c.anuntId === a.id && profiluriLocatari.has(c.profilId)).length : null,
      totalLocatari: esteAdmin ? profiluriLocatari.size : null,
    }));

  const documente = db.documente.filter((d) => d.asociatieId === asociatie.id && (esteAdmin || d.vizibilLocatarilor))
    .sort((a, b) => (a.creatLa < b.creatLa ? 1 : -1))
    .map((d) => ({ id: d.id, titlu: d.titlu, tip: d.tip, creatLa: d.creatLa, vizibil: d.vizibilLocatarilor}));

  const voturi = db.voturi.filter((v) => v.asociatieId === asociatie.id).sort((a, b) => (a.deschisLa < b.deschisLa ? 1 : -1)).map((v) => {
    const exprimate = db.exprimate.filter((e) => e.votId === v.id);
    const alMeuVot = exprimate.find((e) => e.apartamentId === eu.apartamentId);
    const auVotat = new Set(exprimate.map((e) => e.apartamentId));
    return {
      id: v.id, titlu: v.titlu, descriere: v.descriere, deschisLa: v.deschisLa, inchideLa: v.inchideLa, numarare: v.numarare,
      optiuni: db.optiuni.filter((o) => o.votId === v.id).sort((a, b) => a.ordine - b.ordine).map((o) => ({
        id: o.id, text: o.text, voturi: exprimate.filter((e) => e.optiuneId === o.id).length,
        cote: round2(exprimate.filter((e) => e.optiuneId === o.id).reduce((s, e) => s + db.apartamente.find((a) => a.id === e.apartamentId).cota, 0)),
      })),
      votanti: exprimate.length,
      totalApartamente: apBloc.length,
      votulMeu: alMeuVot ? alMeuVot.optiuneId : null,
      nevotate: esteAdmin ? apBloc.filter((a) => !auVotat.has(a.id)).map((a) => a.numar) : null,
    };
  });

  const adunari = db.adunari.filter((a) => a.asociatieId === asociatie.id).sort((a, b) => (a.dataOra < b.dataOra ? 1 : -1)).map((a) => {
    const prezente = db.prezente.filter((p) => p.adunareId === a.id);
    return {
      id: a.id, dataOra: a.dataOra, loc: a.loc, ordineDeZi: a.ordineDeZi, convocataLa: a.creatLa,
      documentId: a.documentId || null,
      prezente: prezente.length, totalApartamente: apBloc.length,
      prezentaMea: prezente.some((p) => p.apartamentId === eu.apartamentId),
    };
  });

  return {
    azi, eu,
    asociatie: { id: asociatie.id, denumire: asociatie.denumire, cui: asociatie.cui, iban: asociatie.iban, banca: asociatie.banca, adresa: asociatie.adresa, telefon: asociatie.telefon, email: asociatie.email },
    setari: { ...db.setari },
    bloc: { id: bloc.id, denumire: bloc.denumire, adresa: bloc.adresa, etaje: bloc.etaje, localitate: bloc.localitate, stare: bloc.stare },
    contacte: db.contacte.filter((c) => c.asociatieId === asociatie.id).sort((a, b) => a.ordine - b.ordine)
      .map((c) => ({ id: c.id, rol: c.rol, nume: c.nume, telefon: c.telefon, program: c.program, apartamentNumar: c.apartamentNumar })),
    apartamente, liste, cheltuieli, repartizari, contoare, citiri, consumMediu,
    datorii, penalizari, plati, situatieBloc, fonduri, sesizari, anunturi, documente, voturi, adunari,
    furnizori: esteAdmin ? db.furnizori.filter((f) => f.asociatieId === asociatie.id).map((f) => ({ id: f.id, denumire: f.denumire, cui: f.cui, categorie: f.categorie, metoda: f.metoda, tipApa: f.tipApa || null, cod: f.cod })) : [],
    remindere: esteAdmin ? db.remindere.filter((r) => r.asociatieId === asociatie.id).map((r) => ({ tip: r.tip, activ: r.activ, zile: r.zile })) : [],
    /* Conducerea asociatiei: mandatele de presedinte si de cenzor, cu
       istoricul lor (cele incheiate raman, cu data de incheiere). */
    conducere: esteAdmin
      ? db.membri.filter((m) => m.asociatieId === asociatie.id && m.rol !== "administrator")
        .map((m) => ({
          id: m.id, rol: m.rol, activDin: m.activDin, activPana: m.activPana,
          profilId: m.profilId,
          nume: db.profiluri.find((p) => p.id === m.profilId).nume,
          telefon: db.profiluri.find((p) => p.id === m.profilId).telefon,
        }))
        .sort((a, b) => (a.activPana ? 1 : 0) - (b.activPana ? 1 : 0) || a.rol.localeCompare(b.rol) || a.nume.localeCompare(b.nume))
      : [],
    notificari: db.notificari.filter((n) => n.profilId === profilId).sort((a, b) => (a.trimisaLa < b.trimisaLa ? 1 : -1))
      .map((n) => ({ id: n.id, tip: n.tip, titlu: n.titlu, corp: n.corp, trimisaLa: n.trimisaLa, cititaLa: n.cititaLa })),
  };
}

/* =============================================================================
   Sursa: sesiunea si comenzile
============================================================================= */

/* Cat cere Supabase Auth in supabase/config.toml */
const PAROLA_LUNGIME_MINIMA = 10;

export function creeazaSursaMock() {
  const db = construiesteDemo();
  let sesiune = null;

  const eu = () => (sesiune ? db.profiluri.find((p) => p.id === sesiune.profilId) : eroare("Nu esti autentificat."));
  const cerAdmin = () => {
    const r = rolul(db, eu().id);
    if (r.rol !== "administrator") eroare("Doar administratorul poate face asta.");
    return { ...r, bloc: db.blocuri.find((b) => b.asociatieId === r.mandat.asociatieId) };
  };
  const cerLocatarPe = (apartamentId) => {
    if (!locatariActivi(db, apartamentId).some((l) => l.profilId === eu().id)) eroare("Nu ai acces la acest apartament.");
  };
  const cerProprietarPe = (apartamentId) => {
    if (!locatariActivi(db, apartamentId).some((l) => l.profilId === eu().id && l.calitate === "proprietar")) {
      eroare("Doar proprietarul apartamentului poate vota (Legea 196/2018).");
    }
  };
  const salveazaFisier = (fisier, prefix) => {
    if (!fisier) return null;
    const cale = `${prefix}/${Date.now()}-${fisier.name || "fisier"}`;
    db.fisiere[cale] = fisier;
    return cale;
  };
  const gata = (x) => Promise.resolve(x);

  return {
    tip: "demo",
    /* [J4] Expusa doar pentru teste: paritatea cu accesul de dezvoltator
       din Studio > SQL (conturi-test.txt), singura cale prin care un
       administrator ajunge azi respins, si in baza reala. Ecranele nu o
       folosesc, doar comenzile de mai jos. */
    db,

    /* [K16, doar pentru teste] Acelasi motiv ca db (mai sus): declanseaza
       direct calculeazaPenalizari(), fara sa astepte rejucarea intregii
       cronologii demo, ca testele sa poata verifica plafonul corectat
       (H3) pe scenarii sintetice -- nicio comanda nu creeaza azi o datorie
       "corectie" (vezi antetul fisierului de test). */
    _calculeazaPenalizariPentruTeste(la) { calculeazaPenalizari(db, la); },

    async sesiuneCurenta() { return sesiune; },

    /* [R4] Mesajul spunea doar ce e gresit, fara niciun pas urmator.
       sursa-supabase.js traduce la fel eroarea Auth "Invalid login
       credentials", ca cele doua surse sa ramana la fel. */
    async intra(telefon, parola) {
      const numar = normalizeazaTelefon(telefon);
      const a = numar && db.autentificari.find((x) => x.telefon === numar);
      if (!a || a.parola !== parola) eroare("Numarul de telefon sau parola nu sunt corecte. Verifica-le si incearca din nou.");
      sesiune = { profilId: a.profilId };
      return sesiune;
    },

    async iesi() { sesiune = null; },

    async incarca(apartamentAles) {
      if (!sesiune) return null;
      return gata(proiecteaza(db, sesiune.profilId, apartamentAles));
    },

    async urlFisier(cale) {
      if (!cale) return null;
      const f = db.fisiere[cale];
      return f ? URL.createObjectURL(f) : null;
    },

    async deschideDocument(documentId) {
      const d = db.documente.find((x) => x.id === documentId) || eroare("Documentul nu exista.");
      /* [paritate] RLS pe comunicare.documente: un locatar vede doar
         documentele vizibile locatarilor; un document doar-admin, deschis
         direct dupa id, trebuie sa dea acelasi refuz ca la sursa Supabase
         (unde randul pur si simplu nu mai vine din select). */
      const esteAdmin = rolul(db, eu().id).rol === "administrator";
      if (!esteAdmin && !d.vizibilLocatarilor) eroare("Documentul nu mai exista sau nu este disponibil.");
      if (d.cale && db.fisiere[d.cale]) return URL.createObjectURL(db.fisiere[d.cale]);
      const bytes = documentPdf({
        titlu: d.titlu,
        blocuri: [
          { tip: "titlu", text: d.titlu },
          { tip: "text", text: `Incarcat pe ${d.creatLa.slice(0, 10)}`, gri: true },
          { tip: "spatiu", h: 20 },
          { tip: "text", text: "In modul demonstrativ documentele nu au fisier scanat. In aplicatia reala aici se deschide copia scanata incarcata de administrator." },
        ],
      });
      return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    },

    /* ---------- Locatar ---------- */

    async transmiteCitire({ apartamentId, luna, indexuri, poza }) {
      cerLocatarPe(apartamentId);
      /* [paritate, partial] contorizare.transmite_citire refuza orice luna
         diferita de luna curenta exacta. Mock-ul refuza doar lunile
         viitoare: paritatea completa ar bloca si retrimiterile pe luni
         trecute, pe care alte teste (inclusiv unul din afara ariei acestei
         reparatii, R6 din tests/integrare/paritate-mock.test.js, care nu
         fixeaza ceasul) le folosesc deliberat ca sa verifice lantul
         indexAnterior fara sa avanseze ceasul de fiecare data. */
      if (luna > lunaDe(aziIso())) eroare("Nu poti transmite indexul pentru o luna viitoare.");
      /* [J2] Singura comanda de scriere din contorizare fara paza "lista
         lunii e deja publicata", pe care surorile ei o au deja (valideaza_
         citire, valideaza_citiri_apartament, citeste_contor_general,
         estimeaza_citiri): fara ea, un index transmis dupa ce administratorul
         publica lista mai devreme decat sfarsitul lunii ramane "trimisa"
         pentru totdeauna (valideaza_citire refuza sa mai verifice o luna
         publicata). */
      const ap = db.apartamente.find((a) => a.id === apartamentId);
      if (db.liste.some((l) => l.blocId === ap.blocId && l.luna === luna && l.stare === "publicata")) {
        eroare(`Lista lunii ${lunaText(luna)} este deja publicata; nu se mai poate transmite un index.`);
      }
      /* [§8] transmiterea e atomica: intai se verifica toate indexurile,
         fara nicio scriere; abia apoi se scriu toate deodata, ca un index
         gresit sa nu lase alt contor pe jumatate salvat. */
      const planificate = indexuri.map(({ contorId, index }) => {
        const c = db.contoare.find((x) => x.id === contorId && x.apartamentId === apartamentId) || eroare("Contorul nu este al apartamentului tau.");
        const existenta = db.citiri.find((x) => x.contorId === c.id && x.luna === luna && x.stare !== "respinsa");
        /* Un contor deja validat pe luna se sare; se trimit doar celelalte [A1] */
        if (existenta && existenta.stare === "validata") return null;
        /* [A4] Indexul anterior vine doar din citiri validate, nu din cele
           doar trimise (netrecute inca prin administrator): altfel un index
           netrimis inca la verificare devine punctul de plecare al lunii
           urmatoare, iar o respingere ulterioara lasa luna urmatoare
           calculata pe o valoare pe care nimeni n-a validat-o. */
        const anterioare = db.citiri.filter((x) => x.contorId === c.id && x.luna < luna && x.stare === "validata").sort((a, b) => b.luna.localeCompare(a.luna));
        let anterior = anterioare.length ? anterioare[0].indexCurent : 0;
        /* Sub o estimare prea mare se accepta indexul real, dar nu sub ultima
           citire reala [A2]. Cand nu exista nicio citire reala (toate cele
           anterioare sunt estimari), pragul este 0, ca in coalesce-ul din SQL [R6]. */
        if (Number(index) < anterior && anterioare[0].sursa === "estimat") {
          const [ultimReal] = [...anterioare.filter((x) => x.sursa !== "estimat").map((x) => x.indexCurent), 0];
          if (Number(index) >= ultimReal) anterior = round3(Number(index));
        }
        if (Number(index) < anterior) eroare("Indexul nou nu poate fi mai mic decat cel anterior.");
        return { existenta, contor: c, anterior, curent: round3(Number(index)) };
      });
      const trimise = planificate.filter(Boolean);
      if (trimise.length === 0) eroare("Indexul pe aceasta luna a fost deja validat.");
      const cale = salveazaFisier(poza, "poze");
      trimise.forEach(({ existenta, contor: c, anterior, curent }) => {
        if (existenta) db.citiri.splice(db.citiri.indexOf(existenta), 1);
        db.adauga("citiri", {
          contorId: c.id, blocId: c.blocId, apartamentId, tip: c.tip, luna, indexAnterior: anterior, indexCurent: curent,
          consum: round3(curent - anterior), sursa: "locatar", stare: "trimisa", pozaCale: cale, transmisaLa: acum(), transmisaDe: eu().id,
        });
      });
    },

    async adaugaSesizare({ apartamentId, titlu, categorie, descriere, poze }) {
      cerLocatarPe(apartamentId);
      const ap = db.apartamente.find((a) => a.id === apartamentId);
      const s = db.adauga("sesizari", { blocId: ap.blocId, apartamentId, autorId: eu().id, categorie, titlu, descriere, stare: "noua", preluataLa: null, rezolvataLa: null });
      (poze || []).forEach((f) => db.adauga("poze", { sesizareId: s.id, cale: salveazaFisier(f, "sesizari") }));
      return s.id;
    },

    async scrieMesaj(sesizareId, text) {
      const s = db.sesizari.find((x) => x.id === sesizareId) || eroare("Sesizarea nu exista.");
      const esteAdmin = rolul(db, eu().id).rol === "administrator";
      if (!esteAdmin) cerLocatarPe(s.apartamentId);
      /* [paritate] sesizari.scrie_mesaj refuza un mesaj pe o sesizare deja
         rezolvata: conversatia se reia intr-o sesizare noua, daca problema revine. */
      if (s.stare === "rezolvata") eroare("Sesizarea este rezolvata. Scrie o sesizare noua daca problema a revenit.");
      db.adauga("mesaje", { sesizareId, autorId: eu().id, dinAdministratie: esteAdmin, text: text.trim() });
      if (esteAdmin && s.stare === "noua") { s.stare = "in_lucru"; s.preluataLa = acum(); }
      if (esteAdmin) {
        locatariActivi(db, s.apartamentId).forEach((l) => notifica(db, {
          profilId: l.profilId, asociatieId: db.blocuri.find((b) => b.id === s.blocId).asociatieId, tip: "sesizare",
          titlu: "Raspuns la sesizarea ta", corp: `${s.titlu}: ${text.trim()}`, referinta: { sesizareId },
        }));
      }
    },

    async voteaza(votId, optiuneId, apartamentId) {
      cerLocatarPe(apartamentId);
      const v = db.voturi.find((x) => x.id === votId) || eroare("Votul nu exista.");
      if (acum() >= new Date(v.inchideLa).toISOString()) eroare("Votul s-a inchis.");
      if (db.exprimate.some((e) => e.votId === votId && e.apartamentId === apartamentId)) eroare("Apartamentul a votat deja.");
      cerProprietarPe(apartamentId);
      if (!db.optiuni.some((o) => o.id === optiuneId && o.votId === votId)) eroare("Optiunea nu apartine acestui vot.");
      db.adauga("exprimate", { votId, optiuneId, apartamentId, profilId: eu().id });
    },

    async confirmaPrezenta(adunareId, apartamentId) {
      cerLocatarPe(apartamentId);
      /* [paritate] guvernanta.confirma_prezenta cere o adunare care exista
         si care nu a avut inca loc. */
      const a = db.adunari.find((x) => x.id === adunareId);
      if (!a || new Date(a.dataOra) <= new Date()) eroare("Adunarea nu exista sau a avut deja loc.");
      if (db.prezente.some((p) => p.adunareId === adunareId && p.apartamentId === apartamentId)) return;
      db.adauga("prezente", { adunareId, apartamentId, profilId: eu().id, confirmatLa: acum() });
    },

    async marcheazaAnuntCitit(anuntId) {
      const p = eu();
      if (!db.citiriAnunturi.some((c) => c.anuntId === anuntId && c.profilId === p.id)) db.adauga("citiriAnunturi", { anuntId, profilId: p.id, cititLa: acum() });
    },

    async marcheazaNotificareCitita(id) {
      const n = db.notificari.find((x) => x.id === id && x.profilId === eu().id);
      if (n && !n.cititaLa) n.cititaLa = acum();
    },

    /* ---------- Administrator ---------- */

    async deschideLista(luna) {
      const { bloc } = cerAdmin();
      return deschideLista(db, bloc.id, luna).id;
    },

    async salveazaCheltuiala({ id, listaId, furnizorId: idFurnizor, furnizorNou, categorie, cod, suma, metoda, tipApa, serie, emisa, scadentaFurnizor, fisier }) {
      const { bloc } = cerAdmin();
      let furnizorId = idFurnizor;
      const numeFurnizorNou = (furnizorNou || "").trim();
      /* [L11] Toate verificarile ruleaza inainte de orice scriere: altfel un
         cod dublat (sau orice alta respingere de mai jos) lasa in urma
         furnizorul nou, inserat deja cand se afla eroarea. */
      if (!furnizorId && !numeFurnizorNou) eroare("Alege furnizorul facturii.");
      if (db.cheltuieli.some((c) => c.listaId === listaId && c.cod === cod && c.id !== id)) eroare(`Codul ${cod} exista deja pe lista.`);
      const lista = db.liste.find((l) => l.id === listaId && l.blocId === bloc.id) || eroare("Lista nu exista.");
      if (lista.stare !== "ciorna") eroare("Lista este publicata. Cheltuielile ei nu se mai pot modifica.");
      if (!(Number(suma) > 0)) eroare("Suma trebuie sa fie mai mare decat zero.");
      if (metoda === "consum" && tipApa !== "rece" && tipApa !== "calda") eroare("Alege daca factura este de apa rece sau de apa calda.");
      const cheltuialaExistenta = id ? (db.cheltuieli.find((x) => x.id === id && x.listaId === listaId) || eroare("Cheltuiala nu exista.")) : null;
      if (cheltuialaExistenta && cheltuialaExistenta.tip !== "factura") eroare("Randul fondului de reparatii nu se modifica din formularul de factura.");

      if (!furnizorId) {
        furnizorId = db.adauga("furnizori", { asociatieId: bloc.asociatieId, denumire: numeFurnizorNou, cui: null, categorie: categorie.trim(), metoda, tipApa: tipApa || null, cod }).id;
      }
      const scan = fisier ? db.adauga("documente", {
        asociatieId: bloc.asociatieId, blocId: bloc.id, titlu: `Factura ${serie || ""}`.trim(), tip: "factura",
        cale: salveazaFisier(fisier, "documente"), vizibilLocatarilor: true, incarcatDe: eu().id,
      }) : null;
      const valori = {
        listaId, tip: "factura", cod, categorie: categorie.trim(), furnizorId, serie: serie || null, suma: round2(Number(suma)),
        metoda, tipApa: metoda === "consum" ? tipApa : null, emisa: emisa || null, scadentaFurnizor: scadentaFurnizor || null,
      };
      if (cheltuialaExistenta) {
        Object.assign(cheltuialaExistenta, valori, scan ? { documentId: scan.id } : {});
        return cheltuialaExistenta.id;
      }
      return db.adauga("cheltuieli", { ...valori, achitataLa: null, documentId: scan ? scan.id : null }).id;
    },

    async stergeCheltuiala(id) {
      cerAdmin();
      const c = db.cheltuieli.find((x) => x.id === id) || eroare("Cheltuiala nu exista.");
      const lista = db.liste.find((l) => l.id === c.listaId);
      if (lista.stare !== "ciorna") eroare("Lista este publicata. Cheltuielile ei nu se mai pot sterge.");
      db.cheltuieli.splice(db.cheltuieli.indexOf(c), 1);
    },

    async dateMotor(listaId) {
      cerAdmin();
      return dateMotor(db, db.liste.find((l) => l.id === listaId));
    },

    async publicaLista(listaId) {
      cerAdmin();
      publica(db, listaId, acum(), eu().id);
    },

    async marcheazaFacturaPlatita(cheltuialaId, platita) {
      cerAdmin();
      const c = db.cheltuieli.find((x) => x.id === cheltuialaId) || eroare("Factura nu exista.");
      /* [paritate] intretinere.marcheaza_factura_platita cere tip = 'factura':
         randul fondului de reparatii nu se marcheaza platit catre furnizor. */
      if (c.tip !== "factura") eroare("Factura nu exista.");
      c.achitataLa = platita ? aziIso() : null;
    },

    /* Administratorul confirma banii primiti: in mana lui sau in contul
       asociatiei. Aceleasi reguli ca financiar.inregistreaza_incasare. */
    async inregistreazaIncasare(apartamentId, suma, metoda) {
      const { bloc } = cerAdmin();
      const ap = db.apartamente.find((a) => a.id === apartamentId && a.blocId === bloc.id) || eroare("Apartamentul nu exista.");
      if (metoda !== "numerar" && metoda !== "transfer") eroare("Banii primiti sunt fie in numerar, fie prin transfer bancar.");
      /* [paritate] aceeasi rotunjire la ban ca la financiar.inregistreaza_plata:
         o suma care se rotunjeste la 0 lei e refuzata, nu doar cea scrisa 0. */
      if (!(round2(Number(suma)) > 0)) eroare("Suma trebuie sa fie mai mare decat zero.");
      const p = inregistreazaPlata(db, { apartamentId: ap.id, suma: Number(suma), metoda, la: acum(), inregistrataDe: eu().id });
      return { plataId: p.id };
    },

    async trimiteInstiintare(apartamentId) {
      const { bloc } = cerAdmin();
      const loc = locatariActivi(db, apartamentId);
      loc.forEach((l) => notifica(db, {
        profilId: l.profilId, asociatieId: bloc.asociatieId, tip: "restanta",
        titlu: "Instiintare de plata", corp: "Aveti sume neachitate trecute de scadenta. Va rugam sa le achitati ca sa opriti penalizarile.",
      }));
      return { destinatari: loc.length };
    },

    async schimbaPersoane(apartamentId, numar, dinLuna, motiv) {
      const { bloc } = cerAdmin();
      if (!db.apartamente.some((a) => a.id === apartamentId && a.blocId === bloc.id)) eroare("Apartamentul nu exista sau nu este in blocul tau.");
      /* [paritate] organizare.apartamente_persoane.numar_persoane e smallint:
         un numar fractionar este refuzat, nu doar unul negativ. */
      if (!Number.isInteger(Number(numar)) || !(Number(numar) >= 0)) eroare("Numarul de persoane nu este valid.");
      const existent = db.persoane.find((p) => p.apartamentId === apartamentId && p.valabilDin === dinLuna);
      if (existent) eroare("Exista deja o modificare pentru luna aceasta. Istoricul nu se rescrie.");
      db.adauga("persoane", { apartamentId, valabilDin: dinLuna, numar: Number(numar), motiv: motiv || null, modificatDe: eu().id });
    },

    /* Fisa apartamentului: aceleasi verificari ca organizare.schimba_fisa_apartament */
    async schimbaFisaApartament(apartamentId, { proprietar, cota, mp, scutitLift, etaj }) {
      const { bloc } = cerAdmin();
      const a = db.apartamente.find((x) => x.id === apartamentId && x.blocId === bloc.id) || eroare("Apartamentul nu exista sau nu este in blocul tau.");
      const cotaNoua = numarSauNull(cota);
      const mpNou = numarSauNull(mp);
      const etajNou = numarSauNull(etaj);
      if (!String(proprietar || "").trim()) eroare("Scrie numele proprietarului.");
      if (!(cotaNoua > 0) || cotaNoua > 100) eroare("Cota indiviza trebuie sa fie un numar intre 0 si 100.");
      if (mpNou != null && !(mpNou > 0)) eroare("Suprafata trebuie sa fie mai mare decat zero.");
      if (etajNou == null) eroare("Scrie etajul apartamentului.");
      if (bloc.stare === "activ" && cotaNoua !== a.cota) {
        const suma = round2(db.apartamente.filter((x) => x.blocId === bloc.id).reduce((s, x) => s + (x.id === a.id ? cotaNoua : x.cota), 0));
        if (Math.abs(suma - 100) > 0.01) {
          eroare(`Cotele blocului ar ajunge la ${numarRo(suma)} din 100. Schimba si celelalte apartamente, altfel lista nu se mai imparte corect.`);
        }
      }
      Object.assign(a, { proprietar: proprietar.trim(), cota: cotaNoua, mp: mpNou, scutitLift: !!scutitLift, etaj: etajNou });
    },

    /* Redistribuie cotele blocului dintr-o data, ca organizare.schimba_cotele_blocului (C4) */
    async schimbaCoteleBlocului(cote) {
      const { bloc } = cerAdmin();
      const lista = cote || [];
      if (!lista.length) eroare("Trimite cota fiecarui apartament din bloc.");
      const apartamenteBloc = db.apartamente.filter((a) => a.blocId === bloc.id);
      const idUnice = new Set(lista.map((c) => c.apartamentId));
      const acopera = idUnice.size === lista.length && idUnice.size === apartamenteBloc.length
        && apartamenteBloc.every((a) => idUnice.has(a.id));
      if (!acopera) eroare("Lista trebuie sa contina o singura cota pentru fiecare apartament din bloc, fara lipsuri sau duplicate.");
      const cote2 = lista.map((c) => ({ apartamentId: c.apartamentId, cota: numarSauNull(c.cota) }));
      if (cote2.some((c) => !(c.cota > 0) || c.cota > 100)) eroare("Cota indiviza trebuie sa fie un numar intre 0 si 100.");
      const suma = round4(cote2.reduce((s, c) => s + c.cota, 0));
      if (Math.abs(suma - 100) > 0.01) {
        eroare(`Cotele trimise insumeaza ${numarRo(suma)}, nu 100. Corecteaza-le pe toate inainte de a le salva.`);
      }
      cote2.forEach((c) => { apartamenteBloc.find((a) => a.id === c.apartamentId).cota = c.cota; });
    },

    /* Iesire din fond: toate verificarile trec inainte sa se incarce
       documentul (C6), ca niciun refuz sa nu lase un document orfan. In sursa
       Supabase, verificarea ieftina in JS acopera suma, descrierea, data si
       soldul (G3, cel mai frecvent refuz, cunoscut deja de la ultimul
       incarca()); doar existenta fondului ramane verificata acolo de RPC,
       dupa upload — nu se poate verifica ieftin, fara o cerere in plus catre
       server. Mock-ul nu are cost de retea, deci verifica totul, inclusiv
       fondul, inainte de "upload". */
    async inregistreazaIesireFond({ fondId, suma, descriere, data, fisier }) {
      const { bloc } = cerAdmin();
      if (!fisier) eroare("Alege documentul care justifica iesirea din fond.");
      const sumaNoua = numarSauNull(suma);
      if (sumaNoua == null || !(sumaNoua < 0)) eroare("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
      if (!(descriere || "").trim()) eroare("Scrie pentru ce au iesit banii din fond.");
      if (!data || data > aziIso()) eroare("Data iesirii din fond nu poate fi in viitor.");
      const fond = db.fonduri.find((f) => f.id === fondId && f.blocId === bloc.id) || eroare("Fondul nu exista sau nu este al unui bloc administrat de tine.");
      /* Fondul nu poate ajunge pe minus (C5): banii care ies sunt cei adunati de locatari */
      const soldFond = round2(db.miscari.filter((m) => m.fondId === fond.id).reduce((s, m) => s + m.suma, 0));
      if (round2(soldFond + sumaNoua) < 0) {
        eroare(`Fondul are ${numarRo(soldFond)} lei; o iesire de ${numarRo(-sumaNoua)} lei l-ar duce pe minus.`);
      }
      const document = db.adauga("documente", {
        asociatieId: bloc.asociatieId, blocId: bloc.id, titlu: descriere.trim(), tip: "factura",
        cale: salveazaFisier(fisier, "documente"), vizibilLocatarilor: true, incarcatDe: eu().id,
      });
      return db.adauga("miscari", {
        fondId: fond.id, data, suma: round2(sumaNoua), descriere: descriere.trim(), listaId: null, documentId: document.id, creatDe: eu().id,
      }).id;
    },

    /* [paritate] Edge Function-ul cont-locatar: verifica apartamentul, face
       contul cu o parola generata si il leaga de apartament. */
    async adaugaLocatar(apartamentId, { nume, telefon, calitate = "proprietar" }) {
      const { bloc } = cerAdmin();
      if (!db.apartamente.some((a) => a.id === apartamentId && a.blocId === bloc.id)) {
        eroare("Doar administratorul blocului poate face conturi.");
      }
      const numar = normalizeazaTelefon(telefon);
      if (!numar) eroare("Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx.");
      if (!String(nume || "").trim()) eroare("Scrie numele locatarului.");
      const ap = db.apartamente.find((a) => a.id === apartamentId);
      /* [P1/P5] Acelasi om poate avea doua apartamente: numarul lui are deja
         cont, deci contul se leaga si de apartamentul acesta, fara parola noua. */
      const contVechi = db.autentificari.find((x) => x.telefon === numar);
      if (contVechi) {
        if (db.locatari.some((l) => l.profilId === contVechi.profilId && l.apartamentId === apartamentId && !l.activPana)) {
          eroare("Contul este deja legat de acest apartament.");
        }
        const legat = db.adauga("locatari", { apartamentId, blocId: ap.blocId, profilId: contVechi.profilId, calitate, activDin: aziIso(), activPana: null });
        return { locatarId: legat.id, profilId: contVechi.profilId, telefon: numar, parola: null };
      }
      const parola = genereazaParola();
      const p = db.adauga("profiluri", { nume: nume.trim(), telefon: numar });
      db.autentificari.push({ telefon: numar, parola, profilId: p.id });
      const l = db.adauga("locatari", { apartamentId, blocId: ap.blocId, profilId: p.id, calitate, activDin: aziIso(), activPana: null });
      return { locatarId: l.id, profilId: p.id, telefon: numar, parola };
    },

    async parolaNoua(apartamentId, locatarId) {
      const { bloc } = cerAdmin();
      if (!db.apartamente.some((a) => a.id === apartamentId && a.blocId === bloc.id)) {
        eroare("Doar administratorul blocului poate face conturi.");
      }
      const l = db.locatari.find((x) => x.id === locatarId && x.apartamentId === apartamentId);
      if (!l) eroare("Locatarul nu este al acestui apartament.");
      const cont = db.autentificari.find((x) => x.profilId === l.profilId);
      const parola = genereazaParola();
      cont.parola = parola;
      return { parola };
    },

    /* [paritate] identitate.numeste_in_conducere / incheie_mandat */
    async numesteInConducere(profilId, rol) {
      const { bloc } = cerAdmin();
      if (rol !== "presedinte" && rol !== "cenzor") eroare("Mandatul este de presedinte sau de cenzor.");
      if (!db.profiluri.some((p) => p.id === profilId)) eroare("Persoana nu exista.");
      const vechi = db.membri.find((m) => m.asociatieId === bloc.asociatieId && m.profilId === profilId && m.rol === rol);
      if (vechi && !vechi.activPana) eroare("Persoana are deja acest mandat, in curs.");
      if (vechi) {
        vechi.activDin = aziIso();
        vechi.activPana = null;
        return vechi.id;
      }
      return db.adauga("membri", { asociatieId: bloc.asociatieId, profilId, rol, activDin: aziIso(), activPana: null }).id;
    },

    async incheieMandat(membruId) {
      const { bloc } = cerAdmin();
      const m = db.membri.find((x) => x.id === membruId && x.asociatieId === bloc.asociatieId
        && (x.rol === "presedinte" || x.rol === "cenzor") && !x.activPana);
      if (!m) eroare("Mandatul nu exista, s-a incheiat deja sau nu este in asociatia ta.");
      /* ca in baza: cel putin o zi de mandat, ca istoricul sa ramana citibil */
      const maine = adaugaZile(m.activDin, 1);
      m.activPana = aziIso() > maine ? aziIso() : maine;
    },

    async adaugaInConducere(nume, telefon, rol) {
      const { bloc } = cerAdmin();
      if (rol !== "presedinte" && rol !== "cenzor") eroare("Mandatul este de presedinte sau de cenzor.");
      const numar = normalizeazaTelefon(telefon);
      if (!numar) eroare("Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx.");
      if (!String(nume || "").trim()) eroare("Scrie numele persoanei.");
      const contVechi = db.autentificari.find((x) => x.telefon === numar);
      const profilId = contVechi ? contVechi.profilId : db.adauga("profiluri", { nume: nume.trim(), telefon: numar }).id;
      let parola = null;
      if (!contVechi) {
        parola = genereazaParola();
        db.autentificari.push({ telefon: numar, parola, profilId });
      }
      const vechi = db.membri.find((m) => m.asociatieId === bloc.asociatieId && m.profilId === profilId && m.rol === rol);
      if (vechi && !vechi.activPana) eroare("Persoana are deja acest mandat, in curs.");
      if (vechi) { vechi.activDin = aziIso(); vechi.activPana = null; } else {
        db.adauga("membri", { asociatieId: bloc.asociatieId, profilId, rol, activDin: aziIso(), activPana: null });
      }
      return { profil_id: profilId, telefon: numar, parola };
    },

    async inchideAcces(locatarId) {
      cerAdmin();
      const l = db.locatari.find((x) => x.id === locatarId) || eroare("Legatura nu exista.");
      l.activPana = aziIso();
    },

    async valideazaCitire(citireId, accepta, motiv) {
      const { bloc } = cerAdmin();
      const c = db.citiri.find((x) => x.id === citireId) || eroare("Citirea nu exista.");
      /* [K2] O citire de apartament validata din greseala se mai poate
         respinge (nu si accepta a doua oara); pornirea si contorul general,
         nu. Altfel un index gresit facea luna nepublicabila. */
      const corectie = c.stare === "validata" && !accepta && c.sursa !== "pornire" && !!c.apartamentId;
      if (c.stare !== "trimisa" && !corectie) eroare("Citirea a fost deja verificata.");
      /* [paritate] o luna a carei lista e deja publicata nu se mai poate
         verifica: banii ei au fost deja calculati din citirile validate
         pana atunci (la fel ca in valideazaCitiriApartament). */
      if (db.liste.some((l) => l.blocId === bloc.id && l.luna === c.luna && l.stare === "publicata")) {
        eroare(`Lista lunii ${lunaText(c.luna)} este deja publicata; citirea nu se mai poate verifica.`);
      }
      if (!accepta && !(motiv || "").trim()) eroare("Scrie motivul, ca locatarul sa stie ce sa corecteze.");
      c.stare = accepta ? "validata" : "respinsa";
      c.motivRespingere = accepta ? null : motiv.trim();
      c.verificataLa = acum();
      /* [H1/J1] Indexul anterior al citirilor mai noi ale aceluiasi contor,
         pentru lunile de dupa cea tocmai validata, era inghetat la
         transmitere si putea ramane stale (calculat sarind peste luna
         validata acum): se recalculeaza, in cascada, ca acelasi consum sa nu
         se numere de doua ori -- vezi recalculeazaViitorul. */
      if (accepta || corectie) recalculeazaViitorul(db, c.contorId, bloc.id, c.luna);
      if (!accepta) {
        locatariActivi(db, c.apartamentId).forEach((l) => notifica(db, {
          profilId: l.profilId, asociatieId: bloc.asociatieId, tip: "citire",
          titlu: "Indexul trimis a fost respins", corp: `${motiv.trim()} Te rugam sa trimiti din nou indexul, cu o poza clara.`,
        }));
      }
    },

    /* [A5] Valideaza sau respinge dintr-o data toate citirile "trimise" ale
       unui apartament, pe o luna: o singura schimbare, nu un apel separat pe
       fiecare contor. Un apel pe contor lasa apartamentul pe jumatate
       validat daca al doilea apel esueaza (retea, sesiune expirata) - exact
       bug-ul A1, pe care il repara si retrimiterea (asa cum ramane acum). */
    async valideazaCitiriApartament(apartamentId, luna, accepta, motiv) {
      const { bloc } = cerAdmin();
      const ap = db.apartamente.find((a) => a.id === apartamentId && a.blocId === bloc.id) || eroare("Apartamentul nu exista.");
      /* [paritate] ca in contorizare.valideaza_citiri_apartament: o luna a
         carei lista e deja publicata nu se mai poate verifica, altfel
         schimbam citirile din spatele unor bani deja calculati si platiti. */
      if (db.liste.some((l) => l.blocId === bloc.id && l.luna === luna && l.stare === "publicata")) {
        eroare(`Lista lunii ${lunaText(luna)} este deja publicata; citirile nu se mai pot verifica.`);
      }
      if (!accepta && !(motiv || "").trim()) eroare("Scrie motivul, ca locatarul sa stie ce sa corecteze.");
      const citiri = db.citiri.filter((c) => c.apartamentId === ap.id && c.luna === luna && c.stare === "trimisa");
      if (citiri.length === 0) eroare("Nu mai sunt citiri de verificat pentru acest apartament si aceasta luna.");
      citiri.forEach((c) => {
        c.stare = accepta ? "validata" : "respinsa";
        c.motivRespingere = accepta ? null : motiv.trim();
        c.verificataLa = acum();
        /* [H1/J1] aceeasi cascada extinsa ca in valideazaCitire, pe contorul
           acestei citiri -- vezi recalculeazaViitorul. */
        if (accepta) recalculeazaViitorul(db, c.contorId, bloc.id, c.luna);
      });
      if (!accepta) {
        locatariActivi(db, ap.id).forEach((l) => notifica(db, {
          profilId: l.profilId, asociatieId: bloc.asociatieId, tip: "citire",
          titlu: "Indexul trimis a fost respins", corp: `${motiv.trim()} Te rugam sa trimiti din nou indexul, cu o poza clara.`,
        }));
      }
      return { validate: citiri.length };
    },

    async citesteContorGeneral(luna, tip, index) {
      const { bloc } = cerAdmin();
      /* [A3] Nicio corectare pe o luna viitoare sau pe o luna a carei lista e
         deja publicata: banii pentru acea luna au fost deja calculati din
         vechea citire. */
      if (luna > lunaDe(aziIso())) eroare("Nu poti citi contorul general pe o luna viitoare.");
      if (db.liste.some((l) => l.blocId === bloc.id && l.luna === luna && l.stare === "publicata")) {
        /* [K18] numele lunii in romana ("iunie 2026"), nu sirul brut al lunii
           ("2026-06") -- P6, reparat in SQL, uitat aici. */
        eroare(`Lista lunii ${lunaText(luna)} este deja publicata; contorul general nu se mai poate schimba.`);
      }
      /* [§8] un tip fara contor general (de exemplu "gaz") trebuie sa dea un
         mesaj clar, nu un TypeError pe find(...).id mai jos. */
      const c = db.contoare.find((x) => x.blocId === bloc.id && !x.apartamentId && x.tip === tip)
        || eroare(`Blocul nu are contor general pentru apa ${tip}.`);
      const anterioare = db.citiri.filter((x) => x.contorId === c.id && x.luna < luna && x.stare !== "respinsa").sort((a, b) => (a.luna < b.luna ? 1 : -1));
      const anterior = anterioare.length ? anterioare[0].indexCurent : 0;
      if (Number(index) < anterior) eroare("Indexul nou nu poate fi mai mic decat cel anterior.");
      /* [J7] Plafonul e indexul CHIAR INREGISTRAT (indexCurent) al lunii
         urmatoare, nu indexAnterior-ul ei inghetat -- acela se recalculeaza
         mai jos, cu cascada, in loc sa blocheze definitiv o corectura in sus
         legitima. */
      const urmatoare = db.citiri.find((x) => x.contorId === c.id && x.luna === lunaUrmatoare(luna) && x.stare !== "respinsa");
      if (urmatoare && Number(index) > urmatoare.indexCurent) {
        eroare(`Indexul nou (${index}) nu poate fi mai mare decat indexul contorului general de pe luna urmatoare (${urmatoare.indexCurent}).`);
      }
      const existenta = db.citiri.find((x) => x.contorId === c.id && x.luna === luna);
      if (existenta) db.citiri.splice(db.citiri.indexOf(existenta), 1);
      db.adauga("citiri", {
        contorId: c.id, blocId: bloc.id, apartamentId: null, tip, luna, indexAnterior: anterior, indexCurent: round3(Number(index)),
        consum: round3(Number(index) - anterior), sursa: "administrator", stare: "validata", transmisaLa: acum(),
      });
      /* [J7] aceeasi cascada ca la contoarele de apartament (J1), pe contorul general. */
      recalculeazaViitorul(db, c.id, bloc.id, luna);
    },

    async estimeazaCitiri(luna) {
      const { bloc } = cerAdmin();
      /* [A6] O estimare inainte de termenul de citire ii blocheaza pe cei
         care n-au trimis inca indexul, desi mai au timp pana la termen. */
      const termen = `${luna}-${pad(db.setari.ziLimitaCitire)}`;
      if (aziIso() < termen) eroare(`Nu poti estima inainte de termenul de citire (${termen}).`);
      /* [J5] Aceeasi paza ca la cele trei surori (valideazaCitire,
         valideazaCitiriApartament, citesteContorGeneral) si ca in
         contorizare.estimeaza_citiri() (migratia H4): o luna a carei lista
         e deja publicata nu se mai poate estima, altfel apar citiri noi
         dupa ce banii lunii au fost deja calculati si inghetati. */
      if (db.liste.some((l) => l.blocId === bloc.id && l.luna === luna && l.stare === "publicata")) {
        eroare(`Lista lunii ${lunaText(luna)} este deja publicata; citirile nu se mai pot estima.`);
      }
      let n = 0;
      db.contoare.filter((c) => c.blocId === bloc.id && c.apartamentId).forEach((c) => {
        const areValida = db.citiri.some((x) => x.contorId === c.id && x.luna === luna && x.stare === "validata");
        if (areValida) return;
        const trimisa = db.citiri.find((x) => x.contorId === c.id && x.luna === luna && x.stare === "trimisa");
        if (trimisa) return;
        const istoric = db.citiri.filter((x) => x.contorId === c.id && x.luna < luna && x.stare === "validata" && x.sursa !== "pornire")
          .sort((a, b) => (a.luna < b.luna ? 1 : -1));
        const ultimele = istoric.slice(0, 3);
        const medie = ultimele.length ? round3(ultimele.reduce((s, x) => s + x.consum, 0) / ultimele.length) : 0;
        const anterior = istoric.length ? istoric[0].indexCurent
          : db.citiri.find((x) => x.contorId === c.id && x.sursa === "pornire").indexCurent;
        db.adauga("citiri", {
          contorId: c.id, blocId: bloc.id, apartamentId: c.apartamentId, tip: c.tip, luna, indexAnterior: anterior,
          indexCurent: round3(anterior + medie), consum: medie, sursa: "estimat", stare: "validata", transmisaLa: acum(),
        });
        /* [J1] o citire estimata devine "validata" direct, fara sa treaca
           prin valideazaCitire -- nimeni nu recalcula pana acum daca luna
           urmatoare fusese deja transmisa/validata sarind peste aceasta
           luna, lipsa. */
        recalculeazaViitorul(db, c.id, bloc.id, luna);
        n += 1;
      });
      return { estimate: n };
    },

    /* Divergenta cunoscuta fata de sesizari.preia_sesizare (K12): SQL arunca
       eroare cand nu mai e nimic de preluat (deja in lucru, alt bloc);
       mock-ul ramane permisiv si nu face nimic in acel caz, ca sa nu strice
       reincercarea idempotenta folosita de teste si de ecranul admin. */
    async preiaSesizare(id) {
      const { bloc } = cerAdmin();
      const s = db.sesizari.find((x) => x.id === id) || eroare("Sesizarea nu exista.");
      if (s.stare === "noua" && s.blocId === bloc.id) { s.stare = "in_lucru"; s.preluataLa = acum(); }
    },

    async rezolvaSesizare(id) {
      const { bloc } = cerAdmin();
      const s = db.sesizari.find((x) => x.id === id) || eroare("Sesizarea nu exista.");
      /* [paritate] sesizari.rezolva_sesizare refuza o sesizare deja rezolvata. */
      if (s.stare === "rezolvata") eroare("Sesizarea este deja rezolvata.");
      s.stare = "rezolvata";
      s.preluataLa = s.preluataLa || acum();
      s.rezolvataLa = acum();
      locatariActivi(db, s.apartamentId).forEach((l) => notifica(db, {
        profilId: l.profilId, asociatieId: bloc.asociatieId, tip: "sesizare", titlu: "Sesizare rezolvata", corp: s.titlu, referinta: { sesizareId: id },
      }));
    },

    async publicaAnunt({ titlu, corp, urgent }) {
      const { bloc } = cerAdmin();
      const a = db.adauga("anunturi", { asociatieId: bloc.asociatieId, blocId: bloc.id, autorId: eu().id, titlu: titlu.trim(), corp: corp.trim(), urgent: !!urgent, publicatLa: acum() });
      if (urgent) {
        db.locatari.filter((l) => l.blocId === bloc.id && !l.activPana).forEach((l) => notifica(db, {
          profilId: l.profilId, asociatieId: bloc.asociatieId, tip: "anunt", titlu: `Urgent: ${a.titlu}`, corp: a.corp, referinta: { anuntId: a.id },
        }));
      }
    },

    async seteazaReminder(tip, activ, zile) {
      const { bloc } = cerAdmin();
      const r = db.remindere.find((x) => x.asociatieId === bloc.asociatieId && x.tip === tip) || eroare(`Reminderul ${tip} nu exista.`);
      r.activ = activ;
      if (zile != null) r.zile = Number(zile);
    },

    async trimiteReminder(tip) {
      const { bloc } = cerAdmin();
      const azi = aziIso();
      const lunaAzi = lunaDe(azi);
      const apBloc = db.apartamente.filter((a) => a.blocId === bloc.id);
      const areSold = (a) => db.datorii.some((d) => d.apartamentId === a.id && restDatorie(db, d) > 0);
      const esteRestant = (a) => db.datorii.some((d) => d.apartamentId === a.id && d.scadenta < azi && restDatorie(db, d) > 0);
      const texteRestanta = ["Instiintare de plata", "Aveti sume neachitate trecute de scadenta. Va rugam sa le achitati ca sa opriti penalizarile."];
      let tinta = [];
      /* [K5] fiecare apartament cu sold, cu textul potrivit pentru fiecare */
      let mesajPentru = () => ["Mesaj de la administratie", ""];
      if (tip === "citire_contoare") {
        tinta = apBloc.filter((a) => !db.citiri.some((c) => c.apartamentId === a.id && c.luna === lunaAzi && c.stare !== "respinsa"));
        mesajPentru = () => ["Transmite indexul la apa", `Te rugam sa transmiti indexul contoarelor pana pe ${db.setari.ziLimitaCitire}.`];
      } else if (tip === "restanta") {
        tinta = apBloc.filter(esteRestant);
        mesajPentru = () => texteRestanta;
      } else if (tip === "plata") {
        /* [paritate] reminderul de plata pleaca la orice apartament cu sold:
           cel deja restant primeste instiintarea de restanta ("se apropie
           termenul" i-ar contrazice realitatea), nu mai e exclus din trimitere. */
        tinta = apBloc.filter(areSold);
        mesajPentru = (a) => (esteRestant(a) ? texteRestanta : ["Reamintire de plata", "Se apropie termenul de plata al intretinerii."]);
      } else {
        /* Un tip necunoscut (nefolosit de ecrane) tot ajunge la apartamentele
           cu sold, cu un text generic, ca sa nu ramana o comanda oarba. */
        tinta = apBloc.filter(areSold);
      }
      let n = 0;
      tinta.forEach((a) => {
        const [titlu, corp] = mesajPentru(a);
        const tipReal = tip === "plata" && esteRestant(a) ? "restanta" : tip;
        locatariActivi(db, a.id).forEach((l) => {
          notifica(db, { profilId: l.profilId, asociatieId: bloc.asociatieId, tip: tipReal, titlu, corp });
          n += 1;
        });
      });
      return { apartamente: tinta.length, destinatari: n };
    },

    async deschideVot({ titlu, descriere, optiuni, inchideLa, numarare }) {
      const { bloc } = cerAdmin();
      const valide = optiuni.map((o) => o.trim()).filter(Boolean);
      if (valide.length < 2) eroare("Un vot are nevoie de cel putin doua variante.");
      /* [§8] un vot se inchide seara (20:00), deci "azi" e inca in viitor:
         doar o data strict trecuta e refuzata. */
      if (!inchideLa || inchideLa < aziIso()) eroare("Data de inchidere trebuie sa fie in viitor.");
      const v = db.adauga("voturi", { asociatieId: bloc.asociatieId, titlu: titlu.trim(), descriere: descriere.trim(), deschisLa: acum(), inchideLa: oraSeriiRomania(inchideLa), numarare, creatDe: eu().id });
      valide.forEach((text, i) => db.adauga("optiuni", { votId: v.id, text, ordine: i + 1 }));
      return v.id;
    },

    async reamintesteVot(votId) {
      const { bloc } = cerAdmin();
      const v = db.voturi.find((x) => x.id === votId && x.asociatieId === bloc.asociatieId) || eroare("Votul nu exista.");
      if (acum() >= new Date(v.inchideLa).toISOString()) eroare("Votul s-a inchis. Nu se mai pot trimite reamintiri.");
      const auVotat = new Set(db.exprimate.filter((e) => e.votId === votId).map((e) => e.apartamentId));
      let n = 0;
      const tinta = db.apartamente.filter((a) => a.blocId === bloc.id && !auVotat.has(a.id));
      tinta.forEach((a) => locatariActivi(db, a.id).forEach((l) => {
        notifica(db, { profilId: l.profilId, asociatieId: bloc.asociatieId, tip: "vot", titlu: "Nu ai votat inca", corp: v.titlu, referinta: { votId } });
        n += 1;
      }));
      return { apartamente: tinta.length, destinatari: n };
    },

    async convoacaAdunare({ dataOra, loc, ordineDeZi }) {
      const { bloc } = cerAdmin();
      /* [§8] o adunare mai tarziu in aceeasi zi e acceptata: se compara ora
         intreaga, nu doar data (altfel orice adunare de azi era refuzata).
         Se compara momente, nu texte: ecranul trimite ora in UTC ("...Z"). */
      if (!dataOra || new Date(dataOra) < new Date()) eroare("Data adunarii trebuie sa fie in viitor.");
      const a = db.adauga("adunari", { asociatieId: bloc.asociatieId, dataOra, loc: loc.trim(), ordineDeZi: ordineDeZi.trim() });
      /* [K6, paritate] convocarea trebuie sa spuna si ora adunarii, nu doar
         data. [J8] data si ora Romaniei, nu feliate direct din sirul primit. */
      const { data: dataAdunarii, ora: oraAdunarii } = dataOraRomania(dataOra);
      db.locatari.filter((l) => l.blocId === bloc.id && !l.activPana).forEach((l) => notifica(db, {
        profilId: l.profilId, asociatieId: bloc.asociatieId, tip: "adunare_generala", titlu: "Convocare la adunarea generala",
        corp: `${dataText(dataAdunarii)}, ora ${oraAdunarii}, ${loc.trim()}. ${ordineDeZi.trim()}`, referinta: { adunareId: a.id },
      }));
      return a.id;
    },

    async incarcaDocument({ titlu, tip, fisier, vizibil }) {
      const { bloc } = cerAdmin();
      if (!fisier) eroare("Alege fisierul.");
      db.adauga("documente", { asociatieId: bloc.asociatieId, blocId: bloc.id, titlu: titlu.trim(), tip, cale: salveazaFisier(fisier, "documente"), vizibilLocatarilor: !!vizibil, incarcatDe: eu().id });
    },
  };
}
