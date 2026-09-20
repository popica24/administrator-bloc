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

const pad = (n) => String(n).padStart(2, "0");

export function aziIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
/* Un camp gol din formular ("" sau necompletat) inseamna "fara valoare" */
const numarSauNull = (v) => (v === "" || v == null ? null : Number(v));

const TABELE = [
  "asociatii", "blocuri", "contacte", "apartamente", "persoane", "profiluri", "autentificari",
  "administratori", "membri", "locatari", "invitatii", "furnizori", "recurente", "liste",
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
const restDatorie = (db, d) => round2(d.suma - alocatDatorie(db, d.id));

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

function inregistreazaPlata(db, { apartamentId, suma, metoda, la, platitaDe = null, inregistrataDe = null }) {
  const ap = db.apartamente.find((a) => a.id === apartamentId);
  const plata = db.adauga("plati", {
    apartamentId, blocId: ap.blocId, suma: round2(suma), metoda, stare: "confirmata",
    procesator: metoda === "card" ? "simulat" : null,
    referintaProcesator: metoda === "card" ? `SIM-${Math.random().toString(36).slice(2, 10).toUpperCase()}` : null,
    platitaDe, inregistrataDe, confirmataLa: la, creatLa: la,
  });
  alocaPlata(db, plata);
  db.setari.chitantaUltimulNumar += 1;
  db.adauga("chitante", { plataId: plata.id, serie: db.setari.chitantaSerie, numar: db.setari.chitantaUltimulNumar, emisaLa: la, creatLa: la });
  return plata;
}

/* Penalizarile lunii: pentru fiecare datorie ramasa neachitata dupa zilele de
   gratie, rest x procent pe zi x zilele de intarziere de la ultimul calcul. */
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
      const rest = restDatorie(db, d);
      if (rest <= 0) return;
      /* Legea 196/2018: toate penalizarile unei datorii nu depasesc datoria */
      const plafon = round2(d.suma - db.penalizari.filter((p) => p.datorieSursaId === d.id).reduce((s, p) => s + p.suma, 0));
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
    .map((a) => ({ id: a.id, persoane: persoaneInLuna(db, a.id, lista.luna), cota: a.cota, scutitLift: a.scutitLift }));
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
  D.CONTURI.forEach((c) => {
    profil[c.cheie] = db.adauga("profiluri", { nume: c.nume, telefon: c.telefon, email: c.email });
    db.autentificari.push({ email: c.email, parola: D.PAROLA_DEMO, profilId: profil[c.cheie].id });
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
      const platitor = locatariActivi(db, ap[p.numar].id)[0];
      inregistreazaPlata(db, {
        apartamentId: ap[p.numar].id, suma: p.suma || datorie.suma, metoda: p.metoda, la,
        platitaDe: p.metoda === "card" && platitor ? platitor.profilId : null, inregistrataDe: p.metoda === "numerar" ? admin : null,
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
  if (legaturi.length) return { rol: "locatar", mandat: null, legaturi };
  if (adm && adm.stare === "in_asteptare") return { rol: "in_asteptare", legaturi };
  return { rol: "fara_apartament", legaturi };
}

function proiecteaza(db, profilId) {
  const profil = db.profiluri.find((p) => p.id === profilId);
  const { rol, mandat, legaturi } = rolul(db, profilId);
  const azi = aziIso();
  const eu = { profilId, nume: profil.nume, telefon: profil.telefon, email: profil.email, rol, apartamentId: legaturi[0] ? legaturi[0].apartamentId : null };
  if (rol !== "administrator" && rol !== "locatar") return { azi, eu };

  const esteAdmin = rol === "administrator";
  const bloc = esteAdmin
    ? db.blocuri.find((b) => b.asociatieId === mandat.asociatieId)
    : db.blocuri.find((b) => b.id === db.apartamente.find((a) => a.id === eu.apartamentId).blocId);
  const asociatie = db.asociatii.find((a) => a.id === bloc.asociatieId);
  const apBloc = db.apartamente.filter((a) => a.blocId === bloc.id);
  const vizibile = esteAdmin ? apBloc.map((a) => a.id) : [eu.apartamentId];
  const alMeu = (id) => vizibile.includes(id);
  const lunaAzi = lunaDe(azi);

  const apartamente = apBloc.filter((a) => alMeu(a.id)).map((a) => ({
    id: a.id, numar: a.numar, etaj: a.etaj, proprietar: a.proprietar, cota: a.cota, mp: a.mp, scutitLift: a.scutitLift,
    persoane: persoaneInLuna(db, a.id, lunaAzi),
    istoricPersoane: db.persoane.filter((p) => p.apartamentId === a.id).sort((x, y) => (x.valabilDin < y.valabilDin ? 1 : -1))
      .map((p) => ({ valabilDin: p.valabilDin, numar: p.numar, motiv: p.motiv })),
    locatari: esteAdmin ? db.locatari.filter((l) => l.apartamentId === a.id).map((l) => {
      const p = db.profiluri.find((x) => x.id === l.profilId);
      return { id: l.id, nume: p.nume, email: p.email, telefon: p.telefon, calitate: l.calitate, activDin: l.activDin, activPana: l.activPana };
    }) : [],
    invitatii: esteAdmin ? db.invitatii.filter((i) => i.apartamentId === a.id && !i.folositaLa && !i.revocataLa && i.expiraLa > acum())
      .map((i) => ({ id: i.id, cod: i.cod, calitate: i.calitate, expiraLa: i.expiraLa })) : [],
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
  }));
  const idDatorii = datorii.map((d) => d.id);
  const penalizari = db.penalizari.filter((p) => idDatorii.includes(p.datorieId)).map((p) => ({ ...p }));
  const plati = db.plati.filter((p) => p.blocId === bloc.id && alMeu(p.apartamentId)).map((p) => {
    const ch = db.chitante.find((c) => c.plataId === p.id);
    const inreg = p.inregistrataDe && db.profiluri.find((x) => x.id === p.inregistrataDe);
    return {
      id: p.id, apartamentId: p.apartamentId, suma: p.suma, metoda: p.metoda, stare: p.stare, confirmataLa: p.confirmataLa,
      referinta: p.referintaProcesator, inregistrataDe: inreg ? inreg.nume : null,
      chitanta: { serie: ch.serie, numar: ch.numar, emisaLa: ch.emisaLa },
      alocari: db.alocari.filter((a) => a.plataId === p.id).map((a) => ({ datorieId: a.datorieId, suma: a.suma })),
    };
  });

  const restantaAp = (apId) => round2(db.datorii.filter((d) => d.apartamentId === apId && d.scadenta < azi).reduce((s, d) => s + restDatorie(db, d), 0));
  const situatieBloc = {
    apartamente: apBloc.length,
    faraRestanta: apBloc.filter((a) => restantaAp(a.id) <= 0).length,
    restanteTotal: round2(apBloc.reduce((s, a) => s + restantaAp(a.id), 0)),
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
  const sesizari = db.sesizari.filter((s) => s.blocId === bloc.id).sort((a, b) => (a.creatLa < b.creatLa ? 1 : -1)).map((s) => {
    const aMea = s.apartamentId === eu.apartamentId;
    const complet = esteAdmin || aMea;
    return {
      id: s.id, aMea, titlu: s.titlu, categorie: s.categorie, stare: s.stare, creataLa: s.creatLa,
      preluataLa: s.preluataLa, rezolvataLa: s.rezolvataLa, descriere: s.descriere,
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
    .map((d) => ({ id: d.id, titlu: d.titlu, tip: d.tip, creatLa: d.creatLa, vizibil: d.vizibilLocatarilor, areFisier: !!d.cale }));

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
    notificari: db.notificari.filter((n) => n.profilId === profilId).sort((a, b) => (a.trimisaLa < b.trimisaLa ? 1 : -1))
      .map((n) => ({ id: n.id, tip: n.tip, titlu: n.titlu, corp: n.corp, trimisaLa: n.trimisaLa, cititaLa: n.cititaLa })),
  };
}

/* =============================================================================
   Sursa: sesiunea si comenzile
============================================================================= */

/* Cat cere Supabase Auth in supabase/config.toml */
const PAROLA_LUNGIME_MINIMA = 10;

const CARACTERE_COD = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genereazaCod = () => Array.from({ length: 8 }, () => CARACTERE_COD[Math.floor(Math.random() * CARACTERE_COD.length)]).join("");

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
  const salveazaFisier = (fisier, prefix) => {
    if (!fisier) return null;
    const cale = `${prefix}/${Date.now()}-${fisier.name || "fisier"}`;
    db.fisiere[cale] = fisier;
    return cale;
  };
  const gata = (x) => Promise.resolve(x);

  return {
    tip: "demo",

    async sesiuneCurenta() { return sesiune; },

    async intra(email, parola) {
      const a = db.autentificari.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
      if (!a || a.parola !== parola) eroare("Emailul sau parola nu sunt corecte.");
      sesiune = { profilId: a.profilId, email: a.email };
      return sesiune;
    },

    async iesi() { sesiune = null; },

    async inregistreaza({ email, parola, nume, telefon }) {
      if (db.autentificari.some((x) => x.email.toLowerCase() === email.trim().toLowerCase())) eroare("Exista deja un cont cu acest email.");
      /* Aceleasi reguli ca in Supabase Auth (supabase/config.toml, [auth]:
         minimum_password_length si password_requirements) */
      if (!parola || parola.length < PAROLA_LUNGIME_MINIMA) eroare(`Parola trebuie sa aiba cel putin ${PAROLA_LUNGIME_MINIMA} caractere.`);
      if (!/[a-z]/.test(parola) || !/[A-Z]/.test(parola) || !/[0-9]/.test(parola)) {
        eroare("Parola trebuie sa aiba si litere mici, si litere mari, si cifre.");
      }
      const p = db.adauga("profiluri", { nume: nume.trim(), telefon: telefon || null, email: email.trim() });
      db.autentificari.push({ email: email.trim(), parola, profilId: p.id });
      /* Paritate cu sursa Supabase (C1): acolo, signUp() nu deschide sesiune
         cat timp Auth cere confirmarea emailului, iar comanda intoarce null.
         Modul demonstrativ nu are confirmare reala prin email, deci reproduce
         acelasi raspuns pentru orice adresa cu eticheta "+cere-confirmare"
         (contul se creeaza, dar ramane fara sesiune, ca la Supabase). */
      if (email.trim().toLowerCase().includes("+cere-confirmare")) return null;
      sesiune = { profilId: p.id, email: email.trim() };
      return sesiune;
    },

    async cereVerificareAdministrator({ numarAtestat, fisier }) {
      const p = eu();
      if (db.administratori.some((a) => a.profilId === p.id)) eroare("Cererea a fost deja trimisa.");
      db.adauga("administratori", { profilId: p.id, numarAtestat, atestatCale: salveazaFisier(fisier, "atestate"), stare: "in_asteptare" });
    },

    async folosesteInvitatie(cod) {
      const p = eu();
      const inv = db.invitatii.find((i) => i.cod === String(cod).trim().toUpperCase());
      if (!inv || inv.revocataLa || inv.folositaLa || inv.expiraLa < acum()) eroare("Codul nu este valabil. Cere administratorului un cod nou.");
      const ap = db.apartamente.find((a) => a.id === inv.apartamentId);
      db.adauga("locatari", { apartamentId: ap.id, blocId: ap.blocId, profilId: p.id, calitate: inv.calitate, activDin: aziIso(), activPana: null });
      inv.folositaLa = acum();
      inv.folositaDe = p.id;
      return { apartamentNumar: ap.numar };
    },

    async incarca() {
      if (!sesiune) return null;
      return gata(proiecteaza(db, sesiune.profilId));
    },

    async urlFisier(cale) {
      if (!cale) return null;
      const f = db.fisiere[cale];
      return f ? URL.createObjectURL(f) : null;
    },

    async deschideDocument(documentId) {
      const d = db.documente.find((x) => x.id === documentId) || eroare("Documentul nu exista.");
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

    async platesteCard({ apartamentId, suma, card }) {
      cerLocatarPe(apartamentId);
      const cifre = String(card.numar || "").replace(/\s/g, "");
      if (cifre.length < 12) eroare("Numarul cardului nu este complet.");
      if (cifre.endsWith("0002")) eroare("Banca a refuzat plata. Nu s-a retras niciun ban.");
      const plata = inregistreazaPlata(db, { apartamentId, suma, metoda: "card", la: acum(), platitaDe: eu().id });
      return { plataId: plata.id };
    },

    async transmiteCitire({ apartamentId, luna, indexuri, poza }) {
      cerLocatarPe(apartamentId);
      const cale = salveazaFisier(poza, "poze");
      let trimise = 0;
      indexuri.forEach(({ contorId, index }) => {
        const c = db.contoare.find((x) => x.id === contorId && x.apartamentId === apartamentId) || eroare("Contorul nu este al apartamentului tau.");
        const existenta = db.citiri.find((x) => x.contorId === c.id && x.luna === luna && x.stare !== "respinsa");
        /* Un contor deja validat pe luna se sare; se trimit doar celelalte [A1] */
        if (existenta && existenta.stare === "validata") return;
        const anterioare = db.citiri.filter((x) => x.contorId === c.id && x.luna < luna && x.stare !== "respinsa").sort((a, b) => (a.luna < b.luna ? 1 : -1));
        let anterior = anterioare.length ? anterioare[0].indexCurent : 0;
        /* Sub o estimare prea mare se accepta indexul real, dar nu sub ultima
           citire reala [A2]. Cand nu exista nicio citire reala (toate cele
           anterioare sunt estimari), pragul este 0, ca in coalesce-ul din SQL [R6]. */
        if (Number(index) < anterior && anterioare[0].sursa === "estimat") {
          const [ultimReal] = [...anterioare.filter((x) => x.sursa !== "estimat").map((x) => x.indexCurent), 0];
          if (Number(index) >= ultimReal) anterior = round3(Number(index));
        }
        if (Number(index) < anterior) eroare("Indexul nou nu poate fi mai mic decat cel anterior.");
        trimise += 1;
        if (existenta) db.citiri.splice(db.citiri.indexOf(existenta), 1);
        db.adauga("citiri", {
          contorId: c.id, blocId: c.blocId, apartamentId, tip: c.tip, luna, indexAnterior: anterior, indexCurent: round3(Number(index)),
          consum: round3(Number(index) - anterior), sursa: "locatar", stare: "trimisa", pozaCale: cale, transmisaLa: acum(), transmisaDe: eu().id,
        });
      });
      if (trimise === 0) eroare("Indexul pe aceasta luna a fost deja validat.");
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
      if (acum() > new Date(v.inchideLa).toISOString()) eroare("Votul s-a inchis.");
      if (db.exprimate.some((e) => e.votId === votId && e.apartamentId === apartamentId)) eroare("Apartamentul a votat deja.");
      if (!db.optiuni.some((o) => o.id === optiuneId && o.votId === votId)) eroare("Optiunea nu apartine acestui vot.");
      db.adauga("exprimate", { votId, optiuneId, apartamentId, profilId: eu().id });
    },

    async confirmaPrezenta(adunareId, apartamentId) {
      cerLocatarPe(apartamentId);
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
      if (!furnizorId) {
        if (!(furnizorNou || "").trim()) eroare("Alege furnizorul facturii.");
        furnizorId = db.adauga("furnizori", { asociatieId: bloc.asociatieId, denumire: furnizorNou.trim(), cui: null, categorie: categorie.trim(), metoda, tipApa: tipApa || null, cod }).id;
      }
      if (db.cheltuieli.some((c) => c.listaId === listaId && c.cod === cod && c.id !== id)) eroare(`Codul ${cod} exista deja pe lista.`);
      const lista = db.liste.find((l) => l.id === listaId && l.blocId === bloc.id) || eroare("Lista nu exista.");
      if (lista.stare !== "ciorna") eroare("Lista este publicata. Cheltuielile ei nu se mai pot modifica.");
      if (!(Number(suma) > 0)) eroare("Suma trebuie sa fie mai mare decat zero.");
      if (metoda === "consum" && tipApa !== "rece" && tipApa !== "calda") eroare("Alege daca factura este de apa rece sau de apa calda.");
      const scan = fisier ? db.adauga("documente", {
        asociatieId: bloc.asociatieId, blocId: bloc.id, titlu: `Factura ${serie || ""}`.trim(), tip: "factura",
        cale: salveazaFisier(fisier, "documente"), vizibilLocatarilor: true, incarcatDe: eu().id,
      }) : null;
      const valori = {
        listaId, tip: "factura", cod, categorie: categorie.trim(), furnizorId, serie: serie || null, suma: round2(Number(suma)),
        metoda, tipApa: metoda === "consum" ? tipApa : null, emisa: emisa || null, scadentaFurnizor: scadentaFurnizor || null,
      };
      if (id) {
        const c = db.cheltuieli.find((x) => x.id === id && x.listaId === listaId) || eroare("Cheltuiala nu exista.");
        if (c.tip !== "factura") eroare("Randul fondului de reparatii nu se modifica din formularul de factura.");
        Object.assign(c, valori, scan ? { documentId: scan.id } : {});
        return c.id;
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
      c.achitataLa = platita ? aziIso() : null;
    },

    async inregistreazaNumerar(apartamentId, suma) {
      const { bloc } = cerAdmin();
      const ap = db.apartamente.find((a) => a.id === apartamentId && a.blocId === bloc.id) || eroare("Apartamentul nu exista.");
      if (!(Number(suma) > 0)) eroare("Suma trebuie sa fie mai mare decat zero.");
      const p = inregistreazaPlata(db, { apartamentId: ap.id, suma: Number(suma), metoda: "numerar", la: acum(), inregistrataDe: eu().id });
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
      cerAdmin();
      if (!(Number(numar) >= 0)) eroare("Numarul de persoane nu este valid.");
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
          eroare(`Cotele blocului ar ajunge la ${suma.toFixed(4)} din 100. Schimba si celelalte apartamente, altfel lista nu se mai imparte corect.`);
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
        eroare(`Cotele trimise insumeaza ${suma.toFixed(4)}, nu 100. Corecteaza-le pe toate inainte de a le salva.`);
      }
      cote2.forEach((c) => { apartamenteBloc.find((a) => a.id === c.apartamentId).cota = c.cota; });
    },

    /* Iesire din fond: toate verificarile trec inainte sa se incarce
       documentul (C6), ca niciun refuz sa nu lase un document orfan. In
       sursa Supabase, verificarea ieftina in JS acopera doar suma, descrierea
       si data (fara rotund suplimentar la server); existenta fondului ramane
       verificata acolo de RPC, dupa upload. Mock-ul nu are cost de retea,
       deci verifica totul, inclusiv fondul, inainte de "upload". */
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
        eroare(`Fondul are ${soldFond.toFixed(2)} lei; o iesire de ${(-sumaNoua).toFixed(2)} lei l-ar duce pe minus.`);
      }
      const document = db.adauga("documente", {
        asociatieId: bloc.asociatieId, blocId: bloc.id, titlu: descriere.trim(), tip: "factura",
        cale: salveazaFisier(fisier, "documente"), vizibilLocatarilor: true, incarcatDe: eu().id,
      });
      return db.adauga("miscari", {
        fondId: fond.id, data, suma: round2(sumaNoua), descriere: descriere.trim(), listaId: null, documentId: document.id, creatDe: eu().id,
      }).id;
    },

    async invitaLocatar(apartamentId, calitate) {
      cerAdmin();
      const inv = db.adauga("invitatii", { apartamentId, cod: genereazaCod(), calitate, creatDe: eu().id, expiraLa: new Date(Date.now() + 30 * 86400000).toISOString() });
      return inv.cod;
    },

    async inchideAcces(locatarId) {
      cerAdmin();
      const l = db.locatari.find((x) => x.id === locatarId) || eroare("Legatura nu exista.");
      l.activPana = aziIso();
    },

    async valideazaCitire(citireId, accepta, motiv) {
      cerAdmin();
      const c = db.citiri.find((x) => x.id === citireId) || eroare("Citirea nu exista.");
      if (c.stare !== "trimisa") eroare("Citirea a fost deja verificata.");
      if (!accepta && !(motiv || "").trim()) eroare("Scrie motivul, ca locatarul sa stie ce sa corecteze.");
      c.stare = accepta ? "validata" : "respinsa";
      c.motivRespingere = accepta ? null : motiv.trim();
      c.verificataLa = acum();
      if (!accepta) {
        locatariActivi(db, c.apartamentId).forEach((l) => notifica(db, {
          profilId: l.profilId, asociatieId: cerAdmin().bloc.asociatieId, tip: "citire",
          titlu: "Indexul trimis a fost respins", corp: `${motiv.trim()} Te rugam sa trimiti din nou indexul, cu o poza clara.`,
        }));
      }
    },

    async citesteContorGeneral(luna, tip, index) {
      const { bloc } = cerAdmin();
      const c = db.contoare.find((x) => x.blocId === bloc.id && !x.apartamentId && x.tip === tip);
      const anterioare = db.citiri.filter((x) => x.contorId === c.id && x.luna < luna && x.stare !== "respinsa").sort((a, b) => (a.luna < b.luna ? 1 : -1));
      const anterior = anterioare.length ? anterioare[0].indexCurent : 0;
      if (Number(index) < anterior) eroare("Indexul nou nu poate fi mai mic decat cel anterior.");
      const existenta = db.citiri.find((x) => x.contorId === c.id && x.luna === luna);
      if (existenta) db.citiri.splice(db.citiri.indexOf(existenta), 1);
      db.adauga("citiri", {
        contorId: c.id, blocId: bloc.id, apartamentId: null, tip, luna, indexAnterior: anterior, indexCurent: round3(Number(index)),
        consum: round3(Number(index) - anterior), sursa: "administrator", stare: "validata", transmisaLa: acum(),
      });
    },

    async estimeazaCitiri(luna) {
      const { bloc } = cerAdmin();
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
        const respinsa = db.citiri.find((x) => x.contorId === c.id && x.luna === luna && x.stare === "respinsa");
        if (respinsa) respinsa.stare = "respinsa";
        db.adauga("citiri", {
          contorId: c.id, blocId: bloc.id, apartamentId: c.apartamentId, tip: c.tip, luna, indexAnterior: anterior,
          indexCurent: round3(anterior + medie), consum: medie, sursa: "estimat", stare: "validata", transmisaLa: acum(),
        });
        n += 1;
      });
      return { estimate: n };
    },

    async preiaSesizare(id) {
      cerAdmin();
      const s = db.sesizari.find((x) => x.id === id) || eroare("Sesizarea nu exista.");
      if (s.stare === "noua") { s.stare = "in_lucru"; s.preluataLa = acum(); }
    },

    async rezolvaSesizare(id) {
      const { bloc } = cerAdmin();
      const s = db.sesizari.find((x) => x.id === id) || eroare("Sesizarea nu exista.");
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
      const r = db.remindere.find((x) => x.asociatieId === bloc.asociatieId && x.tip === tip);
      r.activ = activ;
      if (zile != null) r.zile = Number(zile);
    },

    async trimiteReminder(tip) {
      const { bloc } = cerAdmin();
      const azi = aziIso();
      const lunaAzi = lunaDe(azi);
      const apBloc = db.apartamente.filter((a) => a.blocId === bloc.id);
      let tinta = [];
      if (tip === "citire_contoare") {
        tinta = apBloc.filter((a) => !db.citiri.some((c) => c.apartamentId === a.id && c.luna === lunaAzi && c.stare !== "respinsa"));
      } else if (tip === "restanta") {
        tinta = apBloc.filter((a) => db.datorii.some((d) => d.apartamentId === a.id && d.scadenta < azi && restDatorie(db, d) > 0));
      } else {
        tinta = apBloc.filter((a) => db.datorii.some((d) => d.apartamentId === a.id && restDatorie(db, d) > 0));
      }
      const texte = {
        citire_contoare: ["Transmite indexul la apa", `Te rugam sa transmiti indexul contoarelor pana pe ${db.setari.ziLimitaCitire}.`],
        restanta: ["Instiintare de plata", "Aveti sume neachitate trecute de scadenta. Va rugam sa le achitati ca sa opriti penalizarile."],
        plata: ["Reamintire de plata", "Se apropie termenul de plata al intretinerii."],
      }[tip] || ["Mesaj de la administratie", ""];
      let n = 0;
      tinta.forEach((a) => locatariActivi(db, a.id).forEach((l) => {
        notifica(db, { profilId: l.profilId, asociatieId: bloc.asociatieId, tip, titlu: texte[0], corp: texte[1] });
        n += 1;
      }));
      return { apartamente: tinta.length, destinatari: n };
    },

    async deschideVot({ titlu, descriere, optiuni, inchideLa, numarare }) {
      const { bloc } = cerAdmin();
      const valide = optiuni.map((o) => o.trim()).filter(Boolean);
      if (valide.length < 2) eroare("Un vot are nevoie de cel putin doua variante.");
      if (!inchideLa || inchideLa <= aziIso()) eroare("Data de inchidere trebuie sa fie in viitor.");
      const v = db.adauga("voturi", { asociatieId: bloc.asociatieId, titlu: titlu.trim(), descriere: descriere.trim(), deschisLa: acum(), inchideLa: `${inchideLa}T20:00:00+03:00`, numarare, creatDe: eu().id });
      valide.forEach((text, i) => db.adauga("optiuni", { votId: v.id, text, ordine: i + 1 }));
      return v.id;
    },

    async reamintesteVot(votId) {
      const { bloc } = cerAdmin();
      const auVotat = new Set(db.exprimate.filter((e) => e.votId === votId).map((e) => e.apartamentId));
      const v = db.voturi.find((x) => x.id === votId);
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
      if (!dataOra || dataOra.slice(0, 10) <= aziIso()) eroare("Data adunarii trebuie sa fie in viitor.");
      const a = db.adauga("adunari", { asociatieId: bloc.asociatieId, dataOra, loc: loc.trim(), ordineDeZi: ordineDeZi.trim() });
      db.locatari.filter((l) => l.blocId === bloc.id && !l.activPana).forEach((l) => notifica(db, {
        profilId: l.profilId, asociatieId: bloc.asociatieId, tip: "adunare_generala", titlu: "Convocare la adunarea generala",
        corp: `${dataOra.slice(0, 10)}, ${loc.trim()}. ${ordineDeZi.trim()}`, referinta: { adunareId: a.id },
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
