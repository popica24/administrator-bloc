/* Datele demo ale blocului D14: consistenta lor interna, pe care se bazeaza
   atat sursa demo, cat si seed-ul bazei de date locale. */
import { describe, it, expect } from "vitest";
import * as D from "../../src/date-demo.js";

const numere = D.APARTAMENTE.map((a) => a.numar);

describe("consumApartament si indexPornire", () => {
  it("consumul este determinist, cu 2 zecimale, si depinde de persoane, luna si tip", () => {
    expect(D.consumApartament("17", "2026-06", "rece")).toBe(D.consumApartament("17", "2026-06", "rece"));
    /* ap. 17: 3 persoane; seed = (17*37 + '6'*11 + 3) % 19 */
    const seed = (17 * 37 + "6".charCodeAt(0) * 11 + 3) % 19;
    expect(D.consumApartament("17", "2026-06", "rece")).toBe(Math.round((4.2 * 3 + (seed / 10) * 1.6) * 100) / 100);
    const seedCald = (17 * 37 + "6".charCodeAt(0) * 11 + 7) % 19;
    expect(D.consumApartament("17", "2026-06", "calda")).toBe(Math.round((2.1 * 3 + (seedCald / 10) * 1.6) * 100) / 100);
    expect(D.consumApartament("17", "2026-07", "rece")).not.toBe(D.consumApartament("17", "2026-06", "rece"));
    numere.forEach((n) => ["rece", "calda"].forEach((tip) => {
      const c = D.consumApartament(n, "2026-08", tip);
      expect(c).toBeGreaterThan(0);
      expect(Math.round(c * 100) / 100).toBe(c);
    }));
  });

  it("indexul de pornire creste cu numarul apartamentului, cu o zecimala", () => {
    expect(D.indexPornire("1", "rece")).toBe(153.1);
    expect(D.indexPornire("1", "calda")).toBe(81.7);
    expect(D.indexPornire("20", "rece")).toBe(212);
    expect(D.indexPornire("20", "calda")).toBe(114);
  });
});

describe("consistenta datelor", () => {
  it("20 de apartamente cu cotele insumand exact 100, parterul scutit de lift", () => {
    expect(D.APARTAMENTE).toHaveLength(20);
    expect(new Set(numere).size).toBe(20);
    const cote = D.APARTAMENTE.reduce((s, a) => s + a.cota, 0);
    expect(Math.round(cote * 100) / 100).toBe(100);
    D.APARTAMENTE.forEach((a) => expect(a.scutitLift).toBe(a.etaj === 0));
    expect(D.APARTAMENTE.filter((a) => a.scutitLift).map((a) => a.numar)).toEqual(["1", "2", "3", "4"]);
  });

  it("conturile de locatar sunt pe apartamente existente; parola comuna", () => {
    expect(D.PAROLA_DEMO).toBe("Bloc-D14-2026");
    D.CONTURI.filter((c) => c.rol === "locatar").forEach((c) => expect(numere).toContain(c.apartament));
    expect(D.CONTURI.filter((c) => c.rol === "administrator")).toHaveLength(1);
  });

  it("fiecare luna publicata are facturi, contor general si publicare; furnizorii exista", () => {
    const chei = D.FURNIZORI.map((f) => f.cheie);
    D.LUNI_PUBLICATE.forEach((l) => {
      expect(D.FACTURI[l].length).toBeGreaterThan(0);
      D.FACTURI[l].forEach((f) => expect(chei).toContain(f.furnizor));
      expect(D.CONTOR_GENERAL[l].rece).toBeGreaterThan(0);
      expect(D.PUBLICARI[l].scadenta > D.PUBLICARI[l].publicataLa.slice(0, 10)).toBe(true);
    });
    expect(D.LUNI_PUBLICATE).not.toContain(D.LUNA_CIORNA);
    D.FURNIZORI.filter((f) => f.metoda === "consum").forEach((f) => expect(["rece", "calda"]).toContain(f.tipApa));
  });

  it("platile, sesizarile, voturile si prezentele sunt pe apartamente existente", () => {
    D.PLATI.forEach((p) => {
      expect(numere).toContain(p.numar);
      expect(D.LUNI_PUBLICATE).toContain(p.luna);
      expect(["card", "numerar"]).toContain(p.metoda);
    });
    D.SESIZARI.forEach((s) => expect(numere).toContain(s.numar));
    Object.keys(D.VOT.voturi).forEach((n) => expect(numere).toContain(n));
    Object.values(D.VOT.voturi).forEach((i) => expect(D.VOT.optiuni[i]).toBeDefined());
    D.ADUNARE.prezente.forEach((n) => expect(numere).toContain(n));
    const c = D.CITIRI_LUNA_CURENTA;
    [...c.validate, ...c.trimise, ...c.respinse.map((r) => r.numar)].forEach((n) => expect(numere).toContain(n));
  });

  it("cele cinci remindere si setarile financiare", () => {
    expect(D.REMINDERE.map((r) => r.tip)).toEqual(["lista_publicata", "citire_contoare", "plata", "restanta", "adunare_generala"]);
    expect(D.SETARI_FINANCIARE).toMatchObject({ zileGratie: 30, ziScadenta: 25, chitantaSerie: "AP118" });
    expect(D.RECURENTE[0]).toMatchObject({ tip: "fond_reparatii", metoda: "cota", suma: 1600 });
  });
});
