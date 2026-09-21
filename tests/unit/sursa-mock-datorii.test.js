/* [K16] Sursa demo: netting-ul introdus de F2/H3 intre o corectie negativa
   si datoria de intretinere sora (aceeasi lista, acelasi apartament) -- pe
   restDatorie (financiar.datorii_rest) si pe plafonul penalizarilor
   (financiar.calculeaza_penalizari). Nicio comanda din aplicatie nu creeaza
   azi o datorie "corectie" (recalcularea unei liste republicate nu e inca
   expusa de nicio comanda), deci scenariile de mai jos scriu datoriile
   direct in `db` -- expusa doar pentru teste (vezi [J4] in sursa-mock.js). */
import { describe, it, expect, beforeEach } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { ceasDemo, PAROLA, ADMIN } from "./ajutor.jsx";

const apNr = (d, n) => d.apartamente.find((a) => a.numar === n);

async function admin() {
  const s = creeazaSursaMock();
  await s.intra(ADMIN, PAROLA);
  return { s, d: await s.incarca() };
}

beforeEach(() => ceasDemo());

describe("restDatorie", () => {
  it("[K16] o corectie negativa reduce restul datoriei surori de intretinere, pe aceeasi lista", async () => {
    const { s, d } = await admin();
    const ap = apNr(d, "9").id;
    const listaId = "lst-test-k16";
    const intretinere = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2026-08", listaId,
      suma: 300, scadenta: "2026-09-25", descriere: "Test intretinere",
    });
    const corectie = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "corectie", luna: "2026-08", listaId,
      suma: -120, scadenta: "2026-09-25", descriere: "Test corectie",
    });
    const dupa = await s.incarca();
    expect(dupa.datorii.find((x) => x.id === intretinere.id).rest).toBe(180);
    expect(dupa.datorii.find((x) => x.id === corectie.id).rest).toBe(0);
  });

  it("[K16] o corectie negativa fara datorie sora isi pastreaza propriul rest", async () => {
    const { s, d } = await admin();
    const ap = apNr(d, "9").id;
    const corectie = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "corectie", luna: "2026-08", listaId: "lst-orfana",
      suma: -50, scadenta: "2026-09-25", descriere: "Corectie fara sora",
    });
    const dupa = await s.incarca();
    expect(dupa.datorii.find((x) => x.id === corectie.id).rest).toBe(-50);
  });
});

describe("plafonul penalizarilor", () => {
  it("[K16] plafonul foloseste baza corectata (suma - corectia sora), nu suma bruta", async () => {
    const { s, d } = await admin();
    /* procent mare, ca o singura zi taxata sa atinga deja plafonul */
    s.db.setari.procentPenalizareZi = 50;
    const ap = apNr(d, "9").id;
    const listaId = "lst-test-k16b";
    const scadenta = "2025-01-25";
    const intretinere = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2025-01", listaId,
      suma: 300, scadenta, descriere: "Test intretinere",
    });
    s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "corectie", luna: "2025-01", listaId,
      suma: -250, scadenta, descriere: "Test corectie",
    });
    s._calculeazaPenalizariPentruTeste("2026-09-19");
    const dupa = await s.incarca();
    const total = dupa.penalizari.filter((p) => p.datorieSursaId === intretinere.id).reduce((sum, p) => sum + p.suma, 0);
    expect(total).toBe(50);
  });
});

describe("situatieBloc", () => {
  /* [K4] Ca financiar.situatie_bloc: totalul restantelor aduna doar
     apartamentele care datoreaza. Un apartament cu rest negativ (o corectie
     mai mare decat datoria lui) nu scade din restantele celorlalti. */
  it("[K4] un apartament cu rest scadent negativ nu micsoreaza restantele blocului", async () => {
    const { s, d } = await admin();
    const inainte = d.situatieBloc;
    s.db.adauga("datorii", {
      apartamentId: apNr(d, "9").id, blocId: d.bloc.id, tip: "corectie", luna: "2026-06", listaId: "lst-k4-orfana",
      suma: -75, scadenta: "2026-07-25", descriere: "Corectie mai mare decat datoria",
    });
    const dupa = (await s.incarca()).situatieBloc;
    expect(dupa.restanteTotal).toBe(inainte.restanteTotal);
  });
});
