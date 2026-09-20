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

describe("folosesteInvitatie() in sursa demonstrativa: limita per cont (C15)", () => {
  const PAROLA = "Parola12345";

  it("limiteaza fiecare cont la 5 incercari gresite intr-un sfert de ora (C15)", async () => {
    await intra(ADMIN);
    const cod = await s.invitaLocatar(date.apartamente[0].id, "chirias");
    await s.inregistreaza({ email: `atacator-${Math.random()}@adminbloc.test`, parola: PAROLA, nume: "Atacator" });
    for (let i = 0; i < 5; i += 1) {
      await expect(s.folosesteInvitatie(`ZZZZZZZ${i}`)).rejects.toThrow("Codul nu este valabil. Cere administratorului un cod nou.");
    }
    await expect(s.folosesteInvitatie("ZZZZZZZZ"))
      .rejects.toThrow("Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.");
    /* Cat tine limita, nici codul bun al contului nu mai trece */
    await expect(s.folosesteInvitatie(cod))
      .rejects.toThrow("Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.");
  });

  it("un cont curat cu cod bun trece, oricat ar fi incercat altii (C16 reproiectat)", async () => {
    await intra(ADMIN);
    const cod = await s.invitaLocatar(date.apartamente[1].id, "chirias");
    /* Patru conturi isi epuizeaza fiecare limita proprie: 20 de incercari
       gresite in total. In baza, plafonul care nu depinde de cont se numara
       pe adresa cererii, deci un om de pe alta adresa nu e atins; modul
       demonstrativ nu are adrese, deci ramane doar limita pe cont. */
    for (let cont = 0; cont < 4; cont += 1) {
      await s.inregistreaza({ email: `atacator-${cont}-${Math.random()}@adminbloc.test`, parola: PAROLA, nume: "Atacator" });
      for (let i = 0; i < 5; i += 1) {
        await expect(s.folosesteInvitatie(`ZZZZZZZ${cont}${i}`)).rejects.toThrow("Codul nu este valabil. Cere administratorului un cod nou.");
      }
    }
    await s.inregistreaza({ email: `onest-${Math.random()}@adminbloc.test`, parola: PAROLA, nume: "Onest" });
    await expect(s.folosesteInvitatie(cod)).resolves.toMatchObject({ apartamentNumar: date.apartamente[1].numar });
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
       verifica doar in RPC (dupa upload) — nu se poate verifica ieftin, fara
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
