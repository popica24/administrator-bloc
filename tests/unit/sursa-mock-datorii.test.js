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

const round2 = (n) => Math.round(n * 100) / 100;

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

  /* [B1] Corectura in sus, apoi in jos sub suma initiala: pana la auditul 4,
     corectiile negative erau scazute toate din randul de intretinere, fara sa
     fie compensate cu cele pozitive. Intretinerea ramanea cu rest negativ (pe
     care nicio plata nu-l mai putea consuma), iar corectia pozitiva cerea in
     continuare toata suma ei. */
  it("[B1] corectia negativa o anuleaza intai pe cea pozitiva, nu datoria de baza", async () => {
    const { s, d } = await admin();
    const ap = apNr(d, "9").id;
    const listaId = "lst-test-b1";
    const intretinere = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2026-08", listaId,
      suma: 300, scadenta: "2026-09-25", descriere: "Test intretinere",
    });
    const inSus = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "corectie", luna: "2026-08", listaId,
      suma: 250, scadenta: "2026-10-05", descriere: "Corectie in sus",
    });
    const inSusApoi = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "corectie", luna: "2026-08", listaId,
      suma: 150, scadenta: "2026-10-05", descriere: "Inca o corectie in sus",
    });
    const inJos = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "corectie", luna: "2026-08", listaId,
      suma: -600, scadenta: "2026-10-05", descriere: "Corectie in jos",
    });
    const dupa = await s.incarca();
    const rest = (id) => dupa.datorii.find((x) => x.id === id).rest;
    /* [B3] corectiile pozitive se anuleaza de la cea mai noua, iar datoria
       reala ramane pe randul de intretinere, cu scadenta lui */
    expect(rest(inSusApoi.id)).toBe(0);
    expect(rest(inSus.id)).toBe(0);
    expect(rest(intretinere.id)).toBe(100);
    expect(rest(inJos.id)).toBe(0);
  });

  /* [B1] Cand nu mai are ce reduce (totul e platit), ce ramane cade pe
     intretinere ca rest negativ: acolo il gaseste eliberarea alocarilor si il
     face avans. */
  it("[B1] reducerea care nu mai are ce sa scada ramane pe intretinere, ca avans", async () => {
    const { s, d } = await admin();
    const ap = apNr(d, "9").id;
    const listaId = "lst-test-b1b";
    const intretinere = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2026-08", listaId,
      suma: 300, scadenta: "2026-09-25", descriere: "Test intretinere",
    });
    const inJos = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "corectie", luna: "2026-08", listaId,
      suma: -500, scadenta: "2026-10-05", descriere: "Corectie in jos",
    });
    const dupa = await s.incarca();
    expect(dupa.datorii.find((x) => x.id === intretinere.id).rest).toBe(-200);
    expect(dupa.datorii.find((x) => x.id === inJos.id).rest).toBe(0);
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

/* [B5] Banii intra in cont pe 20, administratorul vede extrasul si ii confirma
   pe 2: zilele dintre ele nu sunt zile de intarziere, desi jobul de penalizari
   a rulat intre timp si le-a taxat. */
describe("[B5] plata cu data ei taie penalizarea zilelor deja acoperite", () => {
  it("penalizarea ramane doar pe zilele in care banii chiar lipseau", async () => {
    const { s, d } = await admin();
    s.db.setari.procentPenalizareZi = 0.2;
    s.db.setari.zileGratie = 0;
    const ap = apNr(d, "9").id;
    const datorie = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2026-08", listaId: "lst-test-b5",
      suma: 1000, scadenta: "2026-08-10", descriere: "Intretinere de test",
    });
    /* penalizarea s-a calculat pe 9 septembrie, pe 30 de zile de intarziere */
    s._calculeazaPenalizariPentruTeste("2026-09-09");
    const inainte = (await s.incarca()).datorii.filter((x) => x.tip === "penalizare" && x.apartamentId === ap);
    expect(inainte).toHaveLength(1);
    expect(inainte[0].suma).toBe(60);

    /* banii au intrat pe 30 august, deci 10 din cele 30 de zile nu se taxeaza */
    await s.inregistreazaIncasare(ap, 1000, "transfer", null, "2026-08-30");
    const dupa = await s.incarca();
    const penalizare = dupa.datorii.find((x) => x.id === inainte[0].id);
    expect(penalizare.rest).toBe(40);
    expect(dupa.datorii.find((x) => x.id === datorie.id).rest).toBe(0);
    const anulare = dupa.datorii.find((x) => x.tip === "anulare_penalizare" && x.anuleazaDatorieId === penalizare.id);
    expect(anulare.suma).toBe(-20);
  });

  /* Doua luni de penalizari pe doua datorii, o singura plata care le acopera pe
     amandoua: fiecare penalizare se indreapta cu zilele ei. */
  it("mai multe penalizari se indreapta fiecare cu zilele ei", async () => {
    const { s, d } = await admin();
    s.db.setari.procentPenalizareZi = 0.2;
    s.db.setari.zileGratie = 0;
    const ap = apNr(d, "11").id;
    s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2026-07", listaId: "lst-test-b5c",
      suma: 500, scadenta: "2026-07-10", descriere: "Intretinere iulie",
    });
    s._calculeazaPenalizariPentruTeste("2026-08-09");
    s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2026-08", listaId: "lst-test-b5d",
      suma: 500, scadenta: "2026-08-10", descriere: "Intretinere august",
    });
    s._calculeazaPenalizariPentruTeste("2026-09-09");

    await s.inregistreazaIncasare(ap, 1000, "transfer", null, "2026-07-15");
    const dupa = await s.incarca();
    const anulari = dupa.datorii.filter((x) => x.tip === "anulare_penalizare" && x.apartamentId === ap);
    expect(anulari.length).toBeGreaterThan(1);
    /* nicio penalizare nu ramane cu rest negativ */
    dupa.datorii.filter((x) => x.tip === "penalizare" && x.apartamentId === ap)
      .forEach((x) => expect(x.rest).toBeGreaterThanOrEqual(0));
  });

  /* Doua plati cu data lor pe aceeasi datorie: a doua indreapta penalizarea
     tinand cont de ce s-a anulat deja, fara sa scada de doua ori. */
  it("a doua plata cu data ei nu anuleaza inca o data ce s-a anulat deja", async () => {
    const { s, d } = await admin();
    s.db.setari.procentPenalizareZi = 0.2;
    s.db.setari.zileGratie = 0;
    const ap = apNr(d, "13").id;
    s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2026-05", listaId: "lst-test-b5f",
      suma: 1000, scadenta: "2026-05-10", descriere: "Intretinere de test",
    });
    s._calculeazaPenalizariPentruTeste("2026-06-09");
    const penalizare = (await s.incarca()).datorii.find((x) => x.tip === "penalizare" && x.apartamentId === ap);

    await s.inregistreazaIncasare(ap, 400, "transfer", null, "2026-05-30");
    const dupaPrima = (await s.incarca()).datorii.find((x) => x.id === penalizare.id).rest;
    await s.inregistreazaIncasare(ap, 600, "transfer", null, "2026-05-25");
    const dupaADoua = (await s.incarca()).datorii.find((x) => x.id === penalizare.id).rest;

    expect(dupaPrima).toBeLessThan(penalizare.suma);
    expect(dupaADoua).toBeLessThan(dupaPrima);
    expect(dupaADoua).toBeGreaterThanOrEqual(0);
  });

  /* O plata neinsemnata nu schimba penalizarea: dupa rotunjirea la ban, cifra
     ramane aceeasi, deci in registru nu intra niciun rand de anulare. */
  it("o plata de un ban nu misca penalizarea", async () => {
    const { s, d } = await admin();
    s.db.setari.procentPenalizareZi = 0.2;
    s.db.setari.zileGratie = 0;
    const ap = apNr(d, "12").id;
    /* datoria de test este cea mai veche a apartamentului, ca banul platit sa
       se duca pe ea, nu pe o datorie din datele demo */
    s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2026-05", listaId: "lst-test-b5e",
      suma: 1000, scadenta: "2026-05-10", descriere: "Intretinere de test",
    });
    s._calculeazaPenalizariPentruTeste("2026-06-09");
    await s.inregistreazaIncasare(ap, 0.01, "transfer", null, "2026-05-30");
    const dupa = await s.incarca();
    expect(dupa.datorii.filter((x) => x.tip === "anulare_penalizare" && x.apartamentId === ap)).toHaveLength(0);
  });

  it("plata de azi nu anuleaza nimic: banii chiar au lipsit pana azi", async () => {
    const { s, d } = await admin();
    s.db.setari.procentPenalizareZi = 0.2;
    s.db.setari.zileGratie = 0;
    const ap = apNr(d, "10").id;
    s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2026-08", listaId: "lst-test-b5b",
      suma: 1000, scadenta: "2026-08-10", descriere: "Intretinere de test",
    });
    s._calculeazaPenalizariPentruTeste("2026-09-09");
    await s.inregistreazaIncasare(ap, 1000, "numerar");
    const dupa = await s.incarca();
    expect(dupa.datorii.filter((x) => x.tip === "anulare_penalizare" && x.apartamentId === ap)).toHaveLength(0);
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

  /* [K7/B9] Plafonul se calculeaza net de anularile de penalizare: ce s-a
     anulat dupa o recalculare se poate cere din nou, daca datoria creste la
     loc. Sursa demonstrativa nu avea termenul acesta, desi baza il are. */
  it("[B9] plafonul tine cont de penalizarile anulate", async () => {
    const { s, d } = await admin();
    s.db.setari.procentPenalizareZi = 50;
    const ap = apNr(d, "9").id;
    const listaId = "lst-test-b9";
    const scadenta = "2025-01-25";
    const intretinere = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2025-01", listaId,
      suma: 300, scadenta, descriere: "Test intretinere",
    });
    s._calculeazaPenalizariPentruTeste("2026-09-18");
    const penalizare = (await s.incarca()).datorii.find((x) => x.tip === "penalizare" && x.apartamentId === ap);
    /* K7: jumatate din penalizare se anuleaza dupa o recalculare */
    s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "anulare_penalizare", luna: "2025-01", listaId: null,
      suma: -round2(penalizare.suma / 2), scadenta: "2026-09-18", descriere: "Penalizare anulata dupa recalcularea listei",
      anuleazaDatorieId: penalizare.id,
    });
    s._calculeazaPenalizariPentruTeste("2026-09-19");
    const dupa = await s.incarca();
    const cerute = dupa.penalizari.filter((p) => p.datorieSursaId === intretinere.id).reduce((sum, p) => sum + p.suma, 0);
    const anulate = dupa.datorii.filter((x) => x.tip === "anulare_penalizare" && x.apartamentId === ap)
      .reduce((sum, x) => sum + x.suma, 0);
    expect(round2(cerute + anulate)).toBe(300);
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

describe("[K7] anularea unei penalizari", () => {
  /* Ca financiar.datorii_rest: anularea se scade din restul penalizarii ei si
     nu are rest propriu. Sursa demo nu are recalculari, deci anularile nu
     apar din comenzi; regula ramane aceeasi, ca sursele sa fie un contract. */
  it("scade din restul penalizarii ei, nu are rest propriu si arata spre ea", async () => {
    const { s, d } = await admin();
    const ap = apNr(d, "9").id;
    const pen = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "penalizare", luna: "2026-09", suma: 30, scadenta: "2026-09-01", descriere: "Penalizare test",
    });
    const anulare = s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "anulare_penalizare", luna: "2026-09", suma: -10, scadenta: "2026-09-10",
      descriere: "Penalizare anulata dupa recalcularea listei", anuleazaDatorieId: pen.id,
    });
    const dupa = await s.incarca();
    expect(dupa.datorii.find((x) => x.id === pen.id)).toMatchObject({ rest: 20, anuleazaDatorieId: null });
    expect(dupa.datorii.find((x) => x.id === anulare.id)).toMatchObject({ rest: 0, anuleazaDatorieId: pen.id });
  });
});
