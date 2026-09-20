/* Paritatea sursei demonstrative cu baza de date, pentru comenzile adaugate
   dupa auditul 2 (X06/D1, X05/D5).
   Fisierul sta langa testele de integrare pentru ca perechea lui — aceleasi
   comenzi prin sursa Supabase — este in acelasi director; mock-ul insa nu are
   nevoie de server, asa ca testele de aici ruleaza si cu stack-ul oprit. */
import { beforeEach, describe, expect, it } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { PAROLA_DEMO } from "../../src/date-demo.js";

const ADMIN = "administrator@adminbloc.test";
const LOCATAR = "elena.marinescu@adminbloc.test";

let s;
let date;

const intra = async (email) => {
  s = creeazaSursaMock();
  await s.intra(email, PAROLA_DEMO);
  date = await s.incarca();
};

describe("inregistreaza() in sursa demonstrativa (C1)", () => {
  it("un email obisnuit deschide sesiunea imediat", async () => {
    const s = creeazaSursaMock();
    const r = await s.inregistreaza({ email: "cont-nou@adminbloc.test", parola: "Parola12345", nume: "Cont Nou" });
    expect(r).toEqual({ profilId: expect.any(String), email: "cont-nou@adminbloc.test" });
    expect(await s.sesiuneCurenta()).toEqual(r);
  });

  it("un email cu eticheta +cere-confirmare reproduce cazul din Supabase: contul se creeaza, dar fara sesiune", async () => {
    const s = creeazaSursaMock();
    const r = await s.inregistreaza({ email: "cont-nou+cere-confirmare@adminbloc.test", parola: "Parola12345", nume: "Cont Fara Sesiune" });
    expect(r).toBeNull();
    expect(await s.sesiuneCurenta()).toBeNull();
    /* Contul exista totusi si poate intra normal dupa aceea */
    const dupa = await s.intra("cont-nou+cere-confirmare@adminbloc.test", "Parola12345");
    expect(dupa.email).toBe("cont-nou+cere-confirmare@adminbloc.test");
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

  it("titlul documentului cade pe o eticheta neutra cand descrierea e goala", async () => {
    const fond = date.fonduri.find((f) => f.tip === "reparatii");
    await expect(s.inregistreazaIesireFond({ fondId: fond.id, suma: -10, descriere: "   ", data: date.azi, fisier: fisier() }))
      .rejects.toThrow("Scrie pentru ce au iesit banii din fond.");
    await expect(s.inregistreazaIesireFond({ fondId: fond.id, suma: -10, descriere: null, data: date.azi, fisier: fisier() }))
      .rejects.toThrow("Scrie pentru ce au iesit banii din fond.");
    expect((await s.incarca()).documente.some((d) => d.titlu === "Iesire din fond")).toBe(true);
  });

  it("refuza iesirea fara document, cu suma pozitiva, zero sau necompletata, si cu data din viitor", async () => {
    const fond = date.fonduri.find((f) => f.tip === "reparatii");
    const baza = { fondId: fond.id, suma: -10, descriere: "Reparatie", data: date.azi };
    await expect(s.inregistreazaIesireFond({ ...baza })).rejects.toThrow("Alege documentul care justifica iesirea din fond.");
    await expect(s.inregistreazaIesireFond({ ...baza, suma: 10, fisier: fisier() })).rejects.toThrow("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
    await expect(s.inregistreazaIesireFond({ ...baza, suma: 0, fisier: fisier() })).rejects.toThrow("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
    await expect(s.inregistreazaIesireFond({ ...baza, suma: null, fisier: fisier() })).rejects.toThrow("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
    await expect(s.inregistreazaIesireFond({ ...baza, suma: "", fisier: fisier() })).rejects.toThrow("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
    await expect(s.inregistreazaIesireFond({ ...baza, data: "2999-01-01", fisier: fisier() })).rejects.toThrow("Data iesirii din fond nu poate fi in viitor.");
    await expect(s.inregistreazaIesireFond({ ...baza, data: null, fisier: fisier() })).rejects.toThrow("Data iesirii din fond nu poate fi in viitor.");
    await expect(s.inregistreazaIesireFond({ ...baza, fondId: "fon-inexistent", fisier: fisier() })).rejects.toThrow("Fondul nu exista sau nu este al unui bloc administrat de tine.");
  });

  it("locatarul nu scoate bani din fond", async () => {
    const fond = date.fonduri.find((f) => f.tip === "reparatii");
    await intra(LOCATAR);
    await expect(s.inregistreazaIesireFond({ fondId: fond.id, suma: -10, descriere: "Reparatie", data: date.azi, fisier: fisier() }))
      .rejects.toThrow("Doar administratorul poate face asta.");
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

    await s.intra("gheorghe.voicu@adminbloc.test", PAROLA_DEMO);
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
