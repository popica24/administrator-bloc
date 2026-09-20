/* Comenzile adaugate dupa revocarea scrierilor directe (audit 2: X06/D1, X05/D5):
   schimbaFisaApartament si inregistreazaIesireFond, prin sursa Supabase, contra
   stack-ului local. Refuzurile de detaliu sunt acoperite de pgTAP; aici se
   verifica legatura dintre aplicatie si baza: apelul, documentul incarcat in
   Storage si forma datelor reincarcate. */
import { beforeAll, describe, expect, it } from "vitest";
import { creeazaBloc, db, intraCa, ok, pdf } from "./fixture.js";

let f;
let adm;
let date;

beforeAll(async () => {
  f = await creeazaBloc({ locatari: [{ cheie: "loc", apartament: "1" }] });
  ({ s: adm, date } = await intraCa(f.adminEmail));
});

describe("schimbaFisaApartament()", () => {
  it("schimba proprietarul, suprafata, scutirea de lift si etajul", async () => {
    const ap = date.apartamente.find((a) => a.numar === "1");
    await adm.schimbaFisaApartament(ap.id, { proprietar: "  Proprietar Nou  ", cota: ap.cota, mp: 44.5, scutitLift: false, etaj: 2 });
    const reincarcat = await adm.incarca();
    expect(reincarcat.apartamente.find((a) => a.numar === "1")).toMatchObject({
      proprietar: "Proprietar Nou", cota: 20, mp: 44.5, scutitLift: false, etaj: 2,
    });
  });

  it("refuza cota care strica suma de 100 a blocului activ", async () => {
    const ap = date.apartamente.find((a) => a.numar === "1");
    await expect(adm.schimbaFisaApartament(ap.id, { proprietar: "Proprietar Nou", cota: 25, mp: null, scutitLift: false, etaj: 2 }))
      .rejects.toThrow(/Cotele blocului ar ajunge la 105/);
    const r = await ok(db("organizare").from("apartamente").select("cota_indiviza").eq("id", ap.id).single());
    expect(Number(r.cota_indiviza)).toBe(20);
  });

  it("campurile goale din formular ajung necompletate in baza", async () => {
    const ap = date.apartamente.find((a) => a.numar === "1");
    await adm.schimbaFisaApartament(ap.id, { proprietar: "Proprietar Nou", cota: ap.cota, mp: "", scutitLift: false, etaj: "1" });
    const r = await ok(db("organizare").from("apartamente").select("suprafata_mp, etaj").eq("id", ap.id).single());
    expect(r).toEqual({ suprafata_mp: null, etaj: 1 });
    await expect(adm.schimbaFisaApartament(ap.id, { proprietar: "Proprietar Nou", cota: "", mp: "", scutitLift: false, etaj: "1" }))
      .rejects.toThrow("Cota indiviza trebuie sa fie un numar intre 0 si 100.");
  });

  it("refuza apartamentul altui bloc", async () => {
    await expect(adm.schimbaFisaApartament("00000000-0000-4000-8000-000000000000", { proprietar: "X", cota: 10, mp: null, scutitLift: false, etaj: 0 }))
      .rejects.toThrow("Apartamentul nu exista sau nu este in blocul tau.");
  });
});

describe("schimbaCoteleBlocului() (C4)", () => {
  it("redistribuie cotele tuturor apartamentelor blocului dintr-o data", async () => {
    const inainte = await adm.incarca();
    const cote = inainte.apartamente.map((a) => ({ apartamentId: a.id, cota: a.numar === "1" ? a.cota - 5 : a.numar === "2" ? a.cota + 5 : a.cota }));
    await adm.schimbaCoteleBlocului(cote);
    const dupa = await adm.incarca();
    expect(dupa.apartamente.find((a) => a.numar === "1").cota).toBe(inainte.apartamente.find((a) => a.numar === "1").cota - 5);
    expect(dupa.apartamente.find((a) => a.numar === "2").cota).toBe(inainte.apartamente.find((a) => a.numar === "2").cota + 5);
  });

  it("refuza o suma diferita de 100 si nu schimba nimic", async () => {
    const inainte = await adm.incarca();
    const cote = inainte.apartamente.map((a) => ({ apartamentId: a.id, cota: a.cota }));
    cote[0].cota += 3;
    await expect(adm.schimbaCoteleBlocului(cote)).rejects.toThrow(/insumeaza 103/);
    const dupa = await adm.incarca();
    expect(dupa.apartamente.find((a) => a.id === cote[0].apartamentId).cota).toBe(inainte.apartamente[0].cota);
  });

  it("refuza o lista incompleta", async () => {
    const inainte = await adm.incarca();
    const cote = inainte.apartamente.slice(1).map((a) => ({ apartamentId: a.id, cota: a.cota }));
    await expect(adm.schimbaCoteleBlocului(cote))
      .rejects.toThrow("Lista trebuie sa contina o singura cota pentru fiecare apartament din bloc, fara lipsuri sau duplicate.");
  });
});

describe("inregistreazaIesireFond()", () => {
  it("incarca documentul justificativ si scade soldul fondului", async () => {
    const inainte = await adm.incarca();
    const fond = inainte.fonduri.find((x) => x.tip === "reparatii");
    await ok(db("financiar").from("miscari_fond").insert({ fond_id: fond.id, data: inainte.azi, suma: 800, descriere: "Contributii fond reparatii" }));

    const id = await adm.inregistreazaIesireFond({ fondId: fond.id, suma: -300, descriere: "Reparatie instalatie", data: inainte.azi, fisier: pdf("factura-fond.pdf") });
    expect(id).toEqual(expect.any(String));

    const dupa = await adm.incarca();
    const f2 = dupa.fonduri.find((x) => x.tip === "reparatii");
    expect(f2.sold).toBe(500);
    const iesire = f2.miscari.find((m) => m.id === id);
    expect(iesire).toMatchObject({ suma: -300, descriere: "Reparatie instalatie", listaId: null });
    expect(iesire.documentId).toEqual(expect.any(String));
    expect(dupa.documente.some((d) => d.id === iesire.documentId && d.titlu === "Reparatie instalatie")).toBe(true);
  });

  it("refuza o iesire fara document justificativ", async () => {
    const d = await adm.incarca();
    const fond = d.fonduri.find((x) => x.tip === "reparatii");
    await expect(adm.inregistreazaIesireFond({ fondId: fond.id, suma: -10, descriere: "Fara acte", data: d.azi }))
      .rejects.toThrow("Alege documentul care justifica iesirea din fond.");
  });

  it("refuza o suma necompletata si o data necompletata", async () => {
    const d = await adm.incarca();
    const fond = d.fonduri.find((x) => x.tip === "reparatii");
    await expect(adm.inregistreazaIesireFond({ fondId: fond.id, suma: "", descriere: "Gol", data: d.azi, fisier: pdf("x.pdf") }))
      .rejects.toThrow("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
    await expect(adm.inregistreazaIesireFond({ fondId: fond.id, suma: -10, descriere: "Gol", data: "", fisier: pdf("x.pdf") }))
      .rejects.toThrow("Data iesirii din fond nu poate fi in viitor.");
  });

  it("fara descriere, documentul primeste o eticheta neutra, iar comanda refuza iesirea", async () => {
    const d = await adm.incarca();
    const fond = d.fonduri.find((x) => x.tip === "reparatii");
    await expect(adm.inregistreazaIesireFond({ fondId: fond.id, suma: -10, descriere: "", data: d.azi, fisier: pdf("x.pdf") }))
      .rejects.toThrow("Scrie pentru ce au iesit banii din fond.");
    expect((await adm.incarca()).documente.some((x) => x.titlu === "Iesire din fond")).toBe(true);
  });

  it("refuza o suma pozitiva", async () => {
    const d = await adm.incarca();
    const fond = d.fonduri.find((x) => x.tip === "reparatii");
    await expect(adm.inregistreazaIesireFond({ fondId: fond.id, suma: 10, descriere: "Bani in plus", data: d.azi, fisier: pdf("x.pdf") }))
      .rejects.toThrow("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
  });
});
