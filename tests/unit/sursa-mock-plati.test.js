/* Sursa demo: plata cu cardul, incasarea cash, alocarea pe datorii,
   chitantele si penalizarile rejucate din datele demo. */
import { describe, it, expect, beforeEach } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { ceasDemo, ZI_DEMO, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";

const ILIE = "0726 331 003";
const apNr = (d, n) => d.apartamente.find((a) => a.numar === n);
const round2 = (n) => Math.round(n * 100) / 100;
const restTotal = (d, apId) => Math.round(d.datorii.filter((x) => x.apartamentId === apId).reduce((t, x) => t + x.rest, 0) * 100) / 100;

async function ca(email, s = creeazaSursaMock()) {
  await s.intra(email, PAROLA);
  return { s, d: await s.incarca() };
}

beforeEach(() => ceasDemo());

describe("inregistreazaIncasare", () => {
  it("banii veniti prin banca se inregistreaza ca transfer, tot cu chitanta", async () => {
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const { plataId } = await s.inregistreazaIncasare(ap3, "100", "transfer");
    const p = (await s.incarca()).plati.find((x) => x.id === plataId);
    expect(p).toMatchObject({ suma: 100, metoda: "transfer", inregistrataDe: "Mihai Dobre" });
    expect(p.chitanta.numar).toBeGreaterThan(0);
  });

  /* [B2] paritate cu financiar.inregistreaza_incasare: aceeasi cheie a cererii
     (raspuns pierdut pe drum, administratorul apasa din nou) nu face a doua
     plata si a doua chitanta pe aceiasi bani. */
  it("[B2] aceeasi cheie a cererii intoarce aceeasi plata", async () => {
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const cheie = "cerere-de-test-1";
    const intai = await s.inregistreazaIncasare(ap3, "100", "numerar", cheie);
    const apoi = await s.inregistreazaIncasare(ap3, "100", "numerar", cheie);
    expect(apoi.plataId).toBe(intai.plataId);
    const dupa = await s.incarca();
    expect(dupa.plati.filter((x) => x.id === intai.plataId)).toHaveLength(1);
    const alta = await s.inregistreazaIncasare(ap3, "100", "numerar", "cerere-de-test-2");
    expect(alta.plataId).not.toBe(intai.plataId);
  });

  /* [B5] Data in care au intrat banii: ziua din extrasul de cont, nu ziua in
     care administratorul o confirma. */
  it("[B5] transferul primeste ziua lui, iar datele imposibile sunt refuzate", async () => {
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const { plataId } = await s.inregistreazaIncasare(ap3, "100", "transfer", null, "2026-09-11");
    const p = (await s.incarca()).plati.find((x) => x.id === plataId);
    expect(p.confirmataLa.slice(0, 10)).toBe("2026-09-11");
    expect(p.chitanta.emisaLa.slice(0, 10)).toBe("2026-09-11");
    await expect(s.inregistreazaIncasare(ap3, "100", "transfer", null, "2026-12-01"))
      .rejects.toThrow("Data in care au intrat banii nu poate fi in viitor.");
    await expect(s.inregistreazaIncasare(ap3, "100", "transfer", null, "2025-01-01"))
      .rejects.toThrow("Data in care au intrat banii nu poate fi mai veche de sase luni.");
  });

  /* [T1] Administratorul a scris gresit: suma, apartamentul, sau a confirmat un
     transfer care nu a intrat. Incasarea se storneaza, si atunci nu se mai
     socoteste nicaieri -- dar ramane in istoric, cu motivul ei. */
  it("[T1] stornarea scoate incasarea din socoteala si o lasa in istoric", async () => {
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const soldInainte = restTotal(d, ap3);
    const { plataId } = await s.inregistreazaIncasare(ap3, "100", "numerar");
    expect(restTotal(await s.incarca(), ap3)).toBe(round2(soldInainte - 100));

    await s.storneazaIncasare(plataId, "  Suma a fost scrisa gresit  ");
    const dupa = await s.incarca();
    expect(restTotal(dupa, ap3)).toBe(soldInainte);
    const plata = dupa.plati.find((p) => p.id === plataId);
    expect(plata).toMatchObject({ stare: "rambursata", motivStornare: "Suma a fost scrisa gresit" });
    expect(plata.chitanta.numar).toBeGreaterThan(0);
  });

  it("[T1] stornarea cere un motiv si nu se face de doua ori", async () => {
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const { plataId } = await s.inregistreazaIncasare(ap3, "50", "numerar");
    await expect(s.storneazaIncasare(plataId, "   ")).rejects.toThrow("Scrie de ce stornezi incasarea.");
    await s.storneazaIncasare(plataId, "Bani dati inapoi");
    await expect(s.storneazaIncasare(plataId, "Inca o data")).rejects.toThrow("Incasarea a fost deja stornata.");
  });

  it("[T1] o incasare scrisa luna trecuta nu se mai storneaza", async () => {
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const { plataId } = await s.inregistreazaIncasare(ap3, "50", "numerar");
    s.db.plati.find((p) => p.id === plataId).creatLa = "2026-08-15T10:00:00+03:00";
    await expect(s.storneazaIncasare(plataId, "Suma gresita"))
      .rejects.toThrow("Se storneaza doar incasarile inregistrate in luna aceasta.");
  });

  it("[T1] o incasare din alt bloc sau inexistenta este refuzata", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.storneazaIncasare("pla-0", "Suma gresita"))
      .rejects.toThrow("Incasarea nu exista sau nu este in blocul tau.");
  });

  it("[T1] stornarea fara niciun motiv scris este refuzata", async () => {
    const { s, d } = await ca(ADMIN);
    const { plataId } = await s.inregistreazaIncasare(apNr(d, "3").id, "50", "numerar");
    await expect(s.storneazaIncasare(plataId)).rejects.toThrow("Scrie de ce stornezi incasarea.");
  });

  it("[T1] locatarul nu storneaza incasari", async () => {
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const { plataId } = await s.inregistreazaIncasare(ap3, "50", "numerar");
    const { s: alLocatarului } = await ca(LOCATAR, s);
    await expect(alLocatarului.storneazaIncasare(plataId, "Vreau banii inapoi"))
      .rejects.toThrow("Doar administratorul poate face asta.");
  });

  /* [T1] Penalizarea taiata fiindca banii intrasera deja in cont se intoarce
     intreaga daca acea incasare se dovedeste gresita. */
  it("[T1] penalizarea anulata de o plata stornata se intoarce", async () => {
    const { s, d } = await ca(ADMIN);
    s.db.setari.procentPenalizareZi = 0.2;
    s.db.setari.zileGratie = 0;
    const ap = apNr(d, "14").id;
    s.db.adauga("datorii", {
      apartamentId: ap, blocId: d.bloc.id, tip: "intretinere", luna: "2026-05", listaId: "lst-test-t1",
      suma: 1000, scadenta: "2026-05-10", descriere: "Intretinere de test",
    });
    s._calculeazaPenalizariPentruTeste("2026-06-09");
    const penalizare = (await s.incarca()).datorii.find((x) => x.tip === "penalizare" && x.apartamentId === ap);
    expect(penalizare.suma).toBe(60);

    const { plataId } = await s.inregistreazaIncasare(ap, 1000, "transfer", null, "2026-05-30");
    expect((await s.incarca()).datorii.find((x) => x.id === penalizare.id).rest).toBe(40);

    await s.storneazaIncasare(plataId, "Transferul nu a intrat in cont");
    const dupa = await s.incarca();
    expect(dupa.datorii.find((x) => x.id === penalizare.id).rest).toBe(60);
  });

  it("alta metoda decat numerar sau transfer este refuzata", async () => {
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    await expect(s.inregistreazaIncasare(ap3, "100", "card"))
      .rejects.toThrow("Banii primiti sunt fie in numerar, fie prin transfer bancar.");
  });

  it("incaseaza cash, cu chitanta si numele administratorului", async () => {
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const inainte = restTotal(d, ap3);
    const { plataId } = await s.inregistreazaIncasare(ap3, "250.5", "numerar");
    const dupa = await s.incarca();
    const p = dupa.plati.find((x) => x.id === plataId);
    expect(p).toMatchObject({ suma: 250.5, metoda: "numerar", inregistrataDe: "Mihai Dobre", chitanta: { numar: 464 } });
    expect(restTotal(dupa, ap3)).toBe(Math.round((inainte - 250.5) * 100) / 100);
  });

  it("datoriile cu aceeasi scadenta se platesc in ordinea crearii", async () => {
    const { s, d } = await ca(ADMIN);
    const ap11 = apNr(d, "11").id;
    const toate = d.datorii.filter((x) => x.apartamentId === ap11 && x.rest > 0);
    await s.inregistreazaIncasare(ap11, restTotal(d, ap11), "numerar");
    const dupa = await s.incarca();
    expect(restTotal(dupa, ap11)).toBe(0);
    const p = dupa.plati[dupa.plati.length - 1];
    const ordine = p.alocari.map((a) => toate.find((x) => x.id === a.datorieId).scadenta);
    expect(ordine).toEqual([...ordine].sort());
    expect(p.alocari[0].datorieId).toBe(toate.find((x) => x.tip === "sold_initial").id);
    expect(dupa.situatieBloc.faraRestanta).toBe(d.situatieBloc.faraRestanta + 1);
  });

  it("refuza apartamentul inexistent si suma zero sau gresita", async () => {
    const { s, d } = await ca(ADMIN);
    await expect(s.inregistreazaIncasare("apa-0", 10, "numerar")).rejects.toThrow("Apartamentul nu exista.");
    await expect(s.inregistreazaIncasare(apNr(d, "3").id, "0", "numerar")).rejects.toThrow("Suma trebuie sa fie mai mare decat zero.");
    await expect(s.inregistreazaIncasare(apNr(d, "3").id, "abc", "numerar")).rejects.toThrow("Suma trebuie sa fie mai mare decat zero.");
  });

  it("[paritate NOU-2] o suma care se rotunjeste la 0 lei este refuzata", async () => {
    const { s, d } = await ca(ADMIN);
    await expect(s.inregistreazaIncasare(apNr(d, "3").id, "0.004", "numerar")).rejects.toThrow("Suma trebuie sa fie mai mare decat zero.");
  });

  it("locatarul nu poate inregistra cash", async () => {
    const { s, d } = await ca(LOCATAR);
    await expect(s.inregistreazaIncasare(d.eu.apartamentId, 10, "numerar")).rejects.toThrow("Doar administratorul poate face asta.");
  });
});

describe("trimiteInstiintare", () => {
  it("notifica locatarii apartamentului si spune cati au primit", async () => {
    const { s, d } = await ca(ADMIN);
    expect(await s.trimiteInstiintare(apNr(d, "3").id)).toEqual({ destinatari: 1 });
    expect(await s.trimiteInstiintare(apNr(d, "11").id)).toEqual({ destinatari: 0 });
    await s.intra(ILIE, PAROLA);
    expect((await s.incarca()).notificari[0]).toMatchObject({ tip: "restanta", titlu: "Instiintare de plata", trimisaLa: ZI_DEMO.toISOString(), cititaLa: null });
  });
});

describe("penalizarile din datele demo", () => {
  it("se calculeaza pe 1 ale lunii, dupa 30 de zile de gratie, 0,02% pe zi", async () => {
    const { d } = await ca(ADMIN);
    const soldInitial = d.datorii.find((x) => x.tip === "sold_initial");
    const pen = d.penalizari.filter((p) => p.datorieSursaId === soldInitial.id);
    expect(pen.map((p) => [p.lunaCalcul, p.zileTaxate, p.suma])).toEqual([["2026-07-01", 7, 1.35], ["2026-08-01", 31, 6], ["2026-09-01", 31, 6]]);
    expect(pen[0]).toMatchObject({ restNeachitat: 967.2, zileIntarziere: 37, zileGratie: 30, procentZi: 0.02 });
    const datoriiPen = d.datorii.filter((x) => x.tip === "penalizare");
    expect(datoriiPen).toHaveLength(d.penalizari.length);
    expect(datoriiPen.find((x) => x.id === pen[0].datorieId)).toMatchObject({
      luna: "2026-07", scadenta: "2026-07-01", listaId: null, descriere: "Penalizare pentru restanta preluata de pe lista de plata din mai 2026",
    });
  });

  it("datoriile platite la timp nu au penalizari", async () => {
    const { d } = await ca(LOCATAR);
    expect(d.penalizari).toEqual([]);
    expect(d.datorii.filter((x) => x.tip === "penalizare")).toEqual([]);
  });
});
