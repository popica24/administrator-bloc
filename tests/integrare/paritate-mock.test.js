/* Paritatea sursei demonstrative cu baza de date, pentru comenzile adaugate
   dupa auditul 2 (X06/D1, X05/D5).
   Fisierul sta langa testele de integrare pentru ca perechea lui, aceleasi
   comenzi prin sursa Supabase, este in acelasi director; mock-ul insa nu are
   nevoie de server, asa ca testele de aici ruleaza si cu stack-ul oprit. */
import { beforeEach, describe, expect, it } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { PAROLA_DEMO } from "../../src/date-demo.js";

const ADMIN = "0745 210 118";
const LOCATAR = "0733 410 217";

let s;
let date;

const intra = async (email) => {
  s = creeazaSursaMock();
  await s.intra(email, PAROLA_DEMO);
  date = await s.incarca();
};

describe("adaugaLocatar() in sursa demonstrativa", () => {
  /* Perechea din baza: tests/integrare/sursa-supabase-autentificare.test.js,
     "adaugaLocatar(): contul il face administratorul". */
  it("contul nou intra imediat cu numarul si parola primite", async () => {
    await intra(ADMIN);
    const r = await s.adaugaLocatar(date.apartamente[0].id, { nume: "Cont Nou", telefon: "0722 000 301", calitate: "chirias" });
    expect(r).toMatchObject({ telefon: "0722000301", parola: expect.stringMatching(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/) });
    await s.intra(r.telefon, r.parola);
    const dupa = await s.incarca();
    expect(dupa.eu).toMatchObject({ nume: "Cont Nou", rol: "locatar", telefon: "0722000301" });
  });

  it("acelasi numar pe al doilea apartament se leaga, fara parola noua", async () => {
    await intra(ADMIN);
    const intai = await s.adaugaLocatar(date.apartamente[0].id, { nume: "Doua", telefon: "0722 000 302" });
    const apoi = await s.adaugaLocatar(date.apartamente[1].id, { nume: "Doua", telefon: "0722 000 302" });
    expect(apoi.parola).toBeNull();
    expect(apoi.profilId).toBe(intai.profilId);
    await s.intra("0722000302", intai.parola);
    const dupa = await s.incarca();
    expect(dupa.apartamente).toHaveLength(2);
  });

  it("parola noua inlocuieste parola veche", async () => {
    await intra(ADMIN);
    const cont = await s.adaugaLocatar(date.apartamente[0].id, { nume: "Uituc", telefon: "0722 000 303" });
    const noua = await s.parolaNoua(date.apartamente[0].id, cont.locatarId);
    expect(noua.parola).not.toBe(cont.parola);
    await expect(s.intra("0722000303", cont.parola)).rejects.toThrow("Numarul de telefon sau parola nu sunt corecte. Verifica-le si incearca din nou.");
    await s.intra("0722000303", noua.parola);
    expect((await s.incarca()).eu.nume).toBe("Uituc");
  });
});

describe("schimbaFisaApartament() in sursa demonstrativa", () => {
  beforeEach(() => intra(ADMIN));

  it("schimba fisa si pastreaza restul apartamentului", async () => {
    const ap = date.apartamente[0];
    await s.schimbaFisaApartament(ap.id, { proprietar: "  Proprietar Nou  ", cota: ap.cota, mp: 44.5, scutitLift: !ap.scutitLift, etaj: 3 });
    const dupa = await s.incarca();
    expect(dupa.apartamente.find((a) => a.id === ap.id)).toMatchObject({
      proprietar: "Proprietar Nou", cota: ap.cota, mp: 44.5, scutitLift: !ap.scutitLift, etaj: 3,
    });
  });

  it("refuza cota care strica suma de 100 a blocului activ, cu mesajul bazei", async () => {
    const ap = date.apartamente[0];
    await expect(s.schimbaFisaApartament(ap.id, { proprietar: ap.proprietar, cota: ap.cota + 5, mp: ap.mp, scutitLift: ap.scutitLift, etaj: ap.etaj }))
      .rejects.toThrow(/^Cotele blocului ar ajunge la 105/);
    const dupa = await s.incarca();
    expect(dupa.apartamente.find((a) => a.id === ap.id).cota).toBe(ap.cota);
  });

  it("refuza numele gol, cota in afara intervalului, suprafata zero si etajul lipsa", async () => {
    const ap = date.apartamente[0];
    const fisa = (x) => ({ proprietar: ap.proprietar, cota: ap.cota, mp: ap.mp, scutitLift: ap.scutitLift, etaj: ap.etaj, ...x });
    await expect(s.schimbaFisaApartament(ap.id, fisa({ proprietar: "   " }))).rejects.toThrow("Scrie numele proprietarului.");
    await expect(s.schimbaFisaApartament(ap.id, fisa({ proprietar: null }))).rejects.toThrow("Scrie numele proprietarului.");
    await expect(s.schimbaFisaApartament(ap.id, fisa({ cota: "" }))).rejects.toThrow("Cota indiviza trebuie sa fie un numar intre 0 si 100.");
    await expect(s.schimbaFisaApartament(ap.id, fisa({ cota: 101 }))).rejects.toThrow("Cota indiviza trebuie sa fie un numar intre 0 si 100.");
    await expect(s.schimbaFisaApartament(ap.id, fisa({ etaj: "" }))).rejects.toThrow("Scrie etajul apartamentului.");
    await expect(s.schimbaFisaApartament(ap.id, fisa({ cota: 0 }))).rejects.toThrow("Cota indiviza trebuie sa fie un numar intre 0 si 100.");
    await expect(s.schimbaFisaApartament(ap.id, fisa({ cota: null }))).rejects.toThrow("Cota indiviza trebuie sa fie un numar intre 0 si 100.");
    await expect(s.schimbaFisaApartament(ap.id, fisa({ mp: 0 }))).rejects.toThrow("Suprafata trebuie sa fie mai mare decat zero.");
    await expect(s.schimbaFisaApartament(ap.id, fisa({ etaj: null }))).rejects.toThrow("Scrie etajul apartamentului.");
    await expect(s.schimbaFisaApartament("ap-inexistent", fisa({}))).rejects.toThrow("Apartamentul nu exista sau nu este in blocul tau.");
  });

  it("suprafata necompletata se sterge de pe fisa, si cand campul vine gol", async () => {
    const ap = date.apartamente[0];
    await s.schimbaFisaApartament(ap.id, { proprietar: ap.proprietar, cota: ap.cota, mp: null, scutitLift: ap.scutitLift, etaj: ap.etaj });
    expect((await s.incarca()).apartamente.find((a) => a.id === ap.id).mp).toBe(null);
    await s.schimbaFisaApartament(ap.id, { proprietar: ap.proprietar, cota: ap.cota, mp: "", scutitLift: ap.scutitLift, etaj: "0" });
    const dupa = (await s.incarca()).apartamente.find((a) => a.id === ap.id);
    expect(dupa).toMatchObject({ mp: null, etaj: 0 });
  });

  it("o cota schimbata cu cel mult 0,01 din suma blocului este acceptata", async () => {
    const ap = date.apartamente[0];
    await s.schimbaFisaApartament(ap.id, { proprietar: ap.proprietar, cota: ap.cota + 0.005, mp: ap.mp, scutitLift: ap.scutitLift, etaj: ap.etaj });
    expect((await s.incarca()).apartamente.find((a) => a.id === ap.id).cota).toBe(ap.cota + 0.005);
  });

  it("locatarul nu poate schimba fisa", async () => {
    await intra(LOCATAR);
    const ap = date.apartamente[0];
    await expect(s.schimbaFisaApartament(ap.id, { proprietar: "Furat", cota: ap.cota, mp: ap.mp, scutitLift: ap.scutitLift, etaj: ap.etaj }))
      .rejects.toThrow("Doar administratorul poate face asta.");
  });
});

describe("schimbaCoteleBlocului() in sursa demonstrativa (C4)", () => {
  beforeEach(() => intra(ADMIN));

  it("redistribuie cotele tuturor apartamentelor dintr-o data, cu suma verificata o singura data", async () => {
    const cote = date.apartamente.map((a, i) => ({ apartamentId: a.id, cota: i === 0 ? a.cota - 4 : i === 1 ? a.cota + 4 : a.cota }));
    await s.schimbaCoteleBlocului(cote);
    const dupa = await s.incarca();
    expect(dupa.apartamente.find((a) => a.id === cote[0].apartamentId).cota).toBe(date.apartamente[0].cota - 4);
    expect(dupa.apartamente.find((a) => a.id === cote[1].apartamentId).cota).toBe(date.apartamente[1].cota + 4);
  });

  it("refuza o suma diferita de 100, cu mesajul bazei, si nu schimba nimic", async () => {
    const cote = date.apartamente.map((a) => ({ apartamentId: a.id, cota: a.cota }));
    cote[0].cota += 7;
    await expect(s.schimbaCoteleBlocului(cote)).rejects.toThrow(/^Cotele trimise insumeaza 107/);
    const dupa = await s.incarca();
    expect(dupa.apartamente.find((a) => a.id === cote[0].apartamentId).cota).toBe(date.apartamente[0].cota);
  });

  it("refuza o lista incompleta, una goala si o cota in afara intervalului", async () => {
    const cote = date.apartamente.map((a) => ({ apartamentId: a.id, cota: a.cota }));
    await expect(s.schimbaCoteleBlocului(cote.slice(1)))
      .rejects.toThrow("Lista trebuie sa contina o singura cota pentru fiecare apartament din bloc, fara lipsuri sau duplicate.");
    await expect(s.schimbaCoteleBlocului([])).rejects.toThrow("Trimite cota fiecarui apartament din bloc.");
    const cuZero = cote.map((c, i) => (i === 0 ? { ...c, cota: 0 } : c));
    await expect(s.schimbaCoteleBlocului(cuZero)).rejects.toThrow("Cota indiviza trebuie sa fie un numar intre 0 si 100.");
  });

  it("locatarul nu redistribuie cotele", async () => {
    const cote = date.apartamente.map((a) => ({ apartamentId: a.id, cota: a.cota }));
    await intra(LOCATAR);
    await expect(s.schimbaCoteleBlocului(cote)).rejects.toThrow("Doar administratorul poate face asta.");
  });

  it("refuza lipsa listei", async () => {
    await expect(s.schimbaCoteleBlocului()).rejects.toThrow("Trimite cota fiecarui apartament din bloc.");
  });
});

describe("inregistreazaIesireFond() in sursa demonstrativa", () => {
  beforeEach(() => intra(ADMIN));

  const fisier = () => new File([new Uint8Array([1, 2, 3])], "factura.pdf", { type: "application/pdf" });

  it("scade soldul fondului si leaga documentul incarcat", async () => {
    const fond = date.fonduri.find((f) => f.tip === "reparatii");
    const id = await s.inregistreazaIesireFond({ fondId: fond.id, suma: -300, descriere: "  Reparatie instalatie  ", data: date.azi, fisier: fisier() });
    const dupa = await s.incarca();
    const f2 = dupa.fonduri.find((x) => x.id === fond.id);
    expect(f2.sold).toBe(Math.round((fond.sold - 300) * 100) / 100);
    const iesire = f2.miscari.find((m) => m.id === id);
    expect(iesire).toMatchObject({ suma: -300, descriere: "Reparatie instalatie", listaId: null });
    expect(dupa.documente.some((d) => d.id === iesire.documentId && d.titlu === "Reparatie instalatie")).toBe(true);
  });

  it("descrierea goala este refuzata fara sa incarce vreun document orfan (C6)", async () => {
    const fond = date.fonduri.find((f) => f.tip === "reparatii");
    const inainte = date.documente.length;
    await expect(s.inregistreazaIesireFond({ fondId: fond.id, suma: -10, descriere: "   ", data: date.azi, fisier: fisier() }))
      .rejects.toThrow("Scrie pentru ce au iesit banii din fond.");
    await expect(s.inregistreazaIesireFond({ fondId: fond.id, suma: -10, descriere: null, data: date.azi, fisier: fisier() }))
      .rejects.toThrow("Scrie pentru ce au iesit banii din fond.");
    expect((await s.incarca()).documente.length).toBe(inainte);
  });

  it("refuza iesirea fara document, cu suma pozitiva, zero sau necompletata, si cu data din viitor", async () => {
    const fond = date.fonduri.find((f) => f.tip === "reparatii");
    const inainte = date.documente.length;
    const baza = { fondId: fond.id, suma: -10, descriere: "Reparatie", data: date.azi };
    await expect(s.inregistreazaIesireFond({ ...baza })).rejects.toThrow("Alege documentul care justifica iesirea din fond.");
    await expect(s.inregistreazaIesireFond({ ...baza, suma: 10, fisier: fisier() })).rejects.toThrow("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
    await expect(s.inregistreazaIesireFond({ ...baza, suma: 0, fisier: fisier() })).rejects.toThrow("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
    await expect(s.inregistreazaIesireFond({ ...baza, suma: null, fisier: fisier() })).rejects.toThrow("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
    await expect(s.inregistreazaIesireFond({ ...baza, suma: "", fisier: fisier() })).rejects.toThrow("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
    await expect(s.inregistreazaIesireFond({ ...baza, data: "2999-01-01", fisier: fisier() })).rejects.toThrow("Data iesirii din fond nu poate fi in viitor.");
    await expect(s.inregistreazaIesireFond({ ...baza, data: null, fisier: fisier() })).rejects.toThrow("Data iesirii din fond nu poate fi in viitor.");
    await expect(s.inregistreazaIesireFond({ ...baza, fondId: "fon-inexistent", fisier: fisier() })).rejects.toThrow("Fondul nu exista sau nu este al unui bloc administrat de tine.");
    /* Divergenta fata de sursa Supabase (C6): acolo, existenta fondului se
       verifica doar in RPC (dupa upload), nu se poate verifica ieftin, fara
       o cerere in plus catre server. Soldul (G3, cel mai frecvent refuz) se
       verifica ieftin si acolo, din datele stiute de la ultimul incarca().
       Mock-ul nu are cost de retea, deci poate verifica totul, inclusiv
       fondul, inainte sa "incarce" documentul: niciun caz nu lasa orfan aici. */
    expect((await s.incarca()).documente.length).toBe(inainte);
  });

  it("locatarul nu scoate bani din fond", async () => {
    const fond = date.fonduri.find((f) => f.tip === "reparatii");
    await intra(LOCATAR);
    await expect(s.inregistreazaIesireFond({ fondId: fond.id, suma: -10, descriere: "Reparatie", data: date.azi, fisier: fisier() }))
      .rejects.toThrow("Doar administratorul poate face asta.");
  });

  it("refuza o iesire mai mare decat soldul fondului, fara sa scrie ceva (C5)", async () => {
    const fond = date.fonduri.find((f) => f.tip === "reparatii");
    await expect(s.inregistreazaIesireFond({ fondId: fond.id, suma: -(fond.sold + 1000), descriere: "Prea mult", data: date.azi, fisier: fisier() }))
      .rejects.toThrow(/l-ar duce pe minus\.$/);
    const dupa = await s.incarca();
    expect(dupa.fonduri.find((f) => f.id === fond.id).sold).toBe(fond.sold);
  });

  it("accepta o iesire exact egala cu soldul fondului, pana la zero (C5)", async () => {
    const fond = date.fonduri.find((f) => f.tip === "reparatii");
    await s.inregistreazaIesireFond({ fondId: fond.id, suma: -fond.sold, descriere: "Tot ce mai e in fond", data: date.azi, fisier: fisier() });
    const dupa = await s.incarca();
    expect(dupa.fonduri.find((f) => f.id === fond.id).sold).toBe(0);
  });
});

describe("transmiteCitire() cand toate citirile anterioare sunt estimari (R6)", () => {
  /* SQL-ul ia ultimul index real cu coalesce(..., 0), deci merge si cand nu
     exista niciunul; mock-ul citea reale[0].indexCurent si crapa. Starea se
     construieste estimand o luna dinaintea lunii de pornire: pentru luna
     urmatoare ei, singura citire anterioara este estimarea. */
  const LUNA_ESTIMATA = "2026-01";
  const LUNA_TRIMISA = "2026-02";

  it("accepta un index sub estimare, fara sa arunce, ca in baza de date", async () => {
    await intra(ADMIN);
    await s.estimeazaCitiri(LUNA_ESTIMATA);
    const dateAdmin = await s.incarca();
    const estimata = dateAdmin.citiri.find((c) => c.luna === LUNA_ESTIMATA && c.sursa === "estimat" && c.apartamentId);
    expect(estimata).toBeDefined();

    await s.intra("0741 002 101", PAROLA_DEMO);
    const d = await s.incarca();
    const contor = d.contoare.find((c) => c.id === estimata.contorId)
      || d.contoare.find((c) => c.apartamentId === d.eu.apartamentId);
    const anterioara = (await s.incarca()).citiri.find((c) => c.contorId === contor.id && c.luna === LUNA_ESTIMATA);
    expect(anterioara.sursa).toBe("estimat");

    await s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: LUNA_TRIMISA, indexuri: [{ contorId: contor.id, index: 0 }] });
    const dupa = await s.incarca();
    const noua = dupa.citiri.find((c) => c.contorId === contor.id && c.luna === LUNA_TRIMISA);
    expect(noua).toMatchObject({ indexAnterior: 0, indexCurent: 0, consum: 0, stare: "trimisa" });
  });
});
