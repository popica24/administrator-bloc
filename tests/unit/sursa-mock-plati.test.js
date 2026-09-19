/* Sursa demo: plata cu cardul, incasarea cash, alocarea pe datorii,
   chitantele si penalizarile rejucate din datele demo. */
import { describe, it, expect, beforeEach } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { ceasDemo, ZI_DEMO, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";

const ILIE = "familia.ilie@adminbloc.test";
const CARD_BUN = { numar: "4242 4242 4242 4242", expira: "12/29", cvc: "123", nume: "Elena Marinescu" };
const apNr = (d, n) => d.apartamente.find((a) => a.numar === n);
const restTotal = (d, apId) => Math.round(d.datorii.filter((x) => x.apartamentId === apId).reduce((t, x) => t + x.rest, 0) * 100) / 100;

async function ca(email, s = creeazaSursaMock()) {
  await s.intra(email, PAROLA);
  return { s, d: await s.incarca() };
}

beforeEach(() => ceasDemo());

describe("platesteCard", () => {
  it("plata confirmata: chitanta urmatoare, alocare pe datoria din august", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const aug = d.datorii.find((x) => x.luna === "2026-08" && x.tip === "intretinere");
    expect(aug.rest).toBe(aug.suma);
    const { plataId } = await s.platesteCard({ apartamentId: apId, suma: 100.004, card: CARD_BUN });
    const dupa = await s.incarca();
    const p = dupa.plati.find((x) => x.id === plataId);
    expect(p).toMatchObject({
      apartamentId: apId, suma: 100, metoda: "card", stare: "confirmata", confirmataLa: ZI_DEMO.toISOString(), inregistrataDe: null,
      chitanta: { serie: "AP118", numar: 464, emisaLa: ZI_DEMO.toISOString() }, alocari: [{ datorieId: aug.id, suma: 100 }],
    });
    expect(p.referinta).toMatch(/^SIM-[A-Z0-9]{1,8}$/);
    expect(dupa.datorii.find((x) => x.id === aug.id).rest).toBe(Math.round((aug.suma - 100) * 100) / 100);
    expect(dupa.setari.chitantaUltimulNumar).toBe(464);
  });

  it("restantierul plateste intai datoria cea mai veche", async () => {
    const { s, d } = await ca(ILIE);
    const apId = d.eu.apartamentId;
    const deschise = d.datorii.filter((x) => x.rest > 0).sort((a, b) => (a.scadenta < b.scadenta ? -1 : 1));
    expect(deschise.map((x) => x.scadenta)).toEqual(["2026-07-25", "2026-08-25", "2026-09-01", "2026-09-25"]);
    const suma = Math.round((deschise[0].rest + 10) * 100) / 100;
    const { plataId } = await s.platesteCard({ apartamentId: apId, suma, card: { numar: "5555555555554444" } });
    const p = (await s.incarca()).plati.find((x) => x.id === plataId);
    expect(p.alocari).toEqual([{ datorieId: deschise[0].id, suma: deschise[0].rest }, { datorieId: deschise[1].id, suma: 10 }]);
  });

  it("plata mai mare decat datoriile ramane avans si acopera lista urmatoare", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const rest = restTotal(d, apId);
    await s.platesteCard({ apartamentId: apId, suma: rest + 200, card: CARD_BUN });
    const dupa = await s.incarca();
    expect(restTotal(dupa, apId)).toBe(0);
    const p = dupa.plati[dupa.plati.length - 1];
    expect(Math.round(p.alocari.reduce((t, a) => t + a.suma, 0) * 100) / 100).toBe(rest);
  });

  it("refuza: card incomplet sau lipsa, card refuzat de banca, apartamentul altuia", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    await expect(s.platesteCard({ apartamentId: apId, suma: 10, card: { numar: "4242 4242 42" } })).rejects.toThrow("Numarul cardului nu este complet.");
    await expect(s.platesteCard({ apartamentId: apId, suma: 10, card: {} })).rejects.toThrow("Numarul cardului nu este complet.");
    await expect(s.platesteCard({ apartamentId: apId, suma: 10, card: { numar: "4000 0000 0000 0002" } })).rejects.toThrow("Banca a refuzat plata. Nu s-a retras niciun ban.");
    const { d: da } = await ca(ADMIN);
    await expect(s.platesteCard({ apartamentId: apNr(da, "3").id, suma: 10, card: CARD_BUN })).rejects.toThrow("Nu ai acces la acest apartament.");
    expect((await s.incarca()).plati).toHaveLength(d.plati.length);
  });

  it.fails("[§8] un numar de card de 12 cifre este refuzat, ca la procesator (minim 13)", async () => {
    const { s, d } = await ca(LOCATAR);
    await expect(s.platesteCard({ apartamentId: d.eu.apartamentId, suma: 10, card: { ...CARD_BUN, numar: "424242424242" } })).rejects.toThrow();
  });

  it.fails("[§8] cardul fara data de expirare LL/AA este refuzat", async () => {
    const { s, d } = await ca(LOCATAR);
    await expect(s.platesteCard({ apartamentId: d.eu.apartamentId, suma: 10, card: { numar: "4242424242424242", expira: "" } })).rejects.toThrow();
  });

  it.fails("[§8] o plata de 0 lei este refuzata", async () => {
    const { s, d } = await ca(LOCATAR);
    await expect(s.platesteCard({ apartamentId: d.eu.apartamentId, suma: 0, card: CARD_BUN })).rejects.toThrow();
  });
});

describe("inregistreazaNumerar", () => {
  it("incaseaza cash, cu chitanta si numele administratorului", async () => {
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const inainte = restTotal(d, ap3);
    const { plataId } = await s.inregistreazaNumerar(ap3, "250.5");
    const dupa = await s.incarca();
    const p = dupa.plati.find((x) => x.id === plataId);
    expect(p).toMatchObject({ suma: 250.5, metoda: "numerar", referinta: null, inregistrataDe: "Mihai Dobre", chitanta: { numar: 464 } });
    expect(restTotal(dupa, ap3)).toBe(Math.round((inainte - 250.5) * 100) / 100);
  });

  it("datoriile cu aceeasi scadenta se platesc in ordinea crearii", async () => {
    const { s, d } = await ca(ADMIN);
    const ap11 = apNr(d, "11").id;
    const toate = d.datorii.filter((x) => x.apartamentId === ap11 && x.rest > 0);
    await s.inregistreazaNumerar(ap11, restTotal(d, ap11));
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
    await expect(s.inregistreazaNumerar("apa-0", 10)).rejects.toThrow("Apartamentul nu exista.");
    await expect(s.inregistreazaNumerar(apNr(d, "3").id, "0")).rejects.toThrow("Suma trebuie sa fie mai mare decat zero.");
    await expect(s.inregistreazaNumerar(apNr(d, "3").id, "abc")).rejects.toThrow("Suma trebuie sa fie mai mare decat zero.");
  });

  it("locatarul nu poate inregistra cash", async () => {
    const { s, d } = await ca(LOCATAR);
    await expect(s.inregistreazaNumerar(d.eu.apartamentId, 10)).rejects.toThrow("Doar administratorul poate face asta.");
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
