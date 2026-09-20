/* Motorul de repartizare: fiecare metoda, rotunjirea, verificarea datelor si
   proprietatea centrala: suma partilor unei cheltuieli este exact factura. */
import { describe, it, expect } from "vitest";
import { calculeazaLista, verificaDate, round2, round4, METODE } from "../../supabase/functions/_shared/motor.js";
import * as D from "../../src/date-demo.js";

const ap = (id, persoane, cota, scutitLift = false) => ({ id, persoane, cota, scutitLift });
const BLOC3 = [ap("a1", 2, 30), ap("a2", 1, 30, true), ap("a3", 3, 40)];
const cheltuiala = (metoda, suma, extra = {}) => ({ id: `ch-${metoda}`, cod: "C1", suma, metoda, ...extra });
const sumaPe = (rep, id) => rep.filter((r) => r.apartamentId === id).reduce((s, r) => s + r.suma, 0);
const bani = (n) => Math.round(n * 100);

describe("round2 si round4", () => {
  it("rotunjesc la 2 si la 4 zecimale, inclusiv cazurile .5", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.234)).toBe(-1.23);
    expect(round4(0.123456)).toBe(0.1235);
    expect(round4(2 / 3)).toBe(0.6667);
  });

  it("METODE are cele cinci metode ale bazei de date", () => {
    expect(METODE).toEqual(["consum", "persoane", "persoane_fara_lift", "apartamente", "cota"]);
  });
});

describe("metodele simple", () => {
  it("persoane: imparte dupa numarul de persoane", () => {
    const r = calculeazaLista({ apartamente: BLOC3, cheltuieli: [cheltuiala("persoane", 600)] });
    expect(r.repartizari.map((x) => x.suma)).toEqual([200, 100, 300]);
    expect(r.repartizari[0].baza).toEqual({ valoare: 2, total: 6, unitate: "persoane" });
    expect(r.repartizari[0].detaliu).toBeNull();
    expect(r.repartizari.every((x) => x.rotunjire === 0)).toBe(true);
    expect(r.totaluri).toEqual({ persoane: 6, persoaneFaraLift: 5, apartamente: 3, cota: 100 });
  });

  it("persoane_fara_lift: apartamentul scutit plateste 0, dar are rand", () => {
    const r = calculeazaLista({ apartamente: BLOC3, cheltuieli: [cheltuiala("persoane_fara_lift", 500)] });
    expect(r.repartizari.map((x) => x.suma)).toEqual([200, 0, 300]);
    expect(r.repartizari[1].baza).toEqual({ valoare: 0, total: 5, unitate: "persoane" });
  });

  it("apartamente: parti egale", () => {
    const r = calculeazaLista({ apartamente: BLOC3, cheltuieli: [cheltuiala("apartamente", 90)] });
    expect(r.repartizari.map((x) => x.suma)).toEqual([30, 30, 30]);
    expect(r.repartizari[2].baza).toEqual({ valoare: 1, total: 3, unitate: "apartamente" });
  });

  it("cota: imparte la suma cotelor, nu la 100", () => {
    const aps = [ap("a1", 1, 20), ap("a2", 1, 30)];
    const r = calculeazaLista({ apartamente: aps, cheltuieli: [cheltuiala("cota", 100)] });
    expect(r.totaluri.cota).toBe(50);
    expect(r.repartizari.map((x) => x.suma)).toEqual([40, 60]);
    expect(r.repartizari[0].baza).toEqual({ valoare: 20, total: 50, unitate: "%" });
  });

  it("intoarce totalurile si cate un rand pe apartament si cheltuiala", () => {
    const r = calculeazaLista({ apartamente: BLOC3, cheltuieli: [cheltuiala("persoane", 600), { ...cheltuiala("cota", 100), id: "x", cod: "C2" }] });
    expect(r.repartizari).toHaveLength(6);
    expect(r.repartizari.filter((x) => x.cheltuialaId === "x")).toHaveLength(3);
    expect(r.totalCheltuieli).toBe(700);
    expect(r.totalRepartizat).toBe(700);
    expect(sumaPe(r.repartizari, "a3")).toBe(340);
  });
});

describe("rotunjirea", () => {
  it("restul pozitiv merge la primul apartament cu partea cea mai mare", () => {
    const r = calculeazaLista({ apartamente: [ap("a1", 1, 1), ap("a2", 1, 1), ap("a3", 1, 1)], cheltuieli: [cheltuiala("apartamente", 100)] });
    expect(r.repartizari.map((x) => x.suma)).toEqual([33.34, 33.33, 33.33]);
    expect(r.repartizari.map((x) => x.rotunjire)).toEqual([0.01, 0, 0]);
  });

  it("restul negativ scade din apartamentul cu partea cea mai mare", () => {
    const r = calculeazaLista({ apartamente: [ap("a1", 1, 1), ap("a2", 1, 1), ap("a3", 1, 1)], cheltuieli: [cheltuiala("apartamente", 200)] });
    expect(r.repartizari.map((x) => x.suma)).toEqual([66.66, 66.67, 66.67]);
    expect(r.repartizari[0].rotunjire).toBe(-0.01);
  });

  it("la parti diferite, restul nu merge la primul, ci la cel mai mare", () => {
    const aps = [ap("a1", 1, 1), ap("a2", 2, 1), ap("a3", 4, 1)];
    const r = calculeazaLista({ apartamente: aps, cheltuieli: [cheltuiala("persoane", 100)] });
    /* 14.29 + 28.57 + 57.14 = 100 */
    expect(r.repartizari.map((x) => x.suma)).toEqual([14.29, 28.57, 57.14]);
    const aps2 = [ap("a1", 1, 1), ap("a2", 1, 1), ap("a3", 4, 1)];
    const r2 = calculeazaLista({ apartamente: aps2, cheltuieli: [cheltuiala("persoane", 100)] });
    /* 16.67 + 16.67 + 66.67 = 100.01, deci a3 primeste -0.01 */
    expect(r2.repartizari.map((x) => x.rotunjire)).toEqual([0, 0, -0.01]);
    expect(r2.repartizari[2].suma).toBe(66.66);
  });
});

describe("apa pe consum", () => {
  const aps = [ap("a1", 2, 50), ap("a2", 1, 50)];
  const consum = { a1: { rece: 10, calda: 4 }, a2: { rece: 5, calda: 2 } };

  it("consumul propriu plus partea din diferenta, pe persoane", () => {
    const r = calculeazaLista({ apartamente: aps, cheltuieli: [cheltuiala("consum", 180, { tipApa: "rece" })], consum, contorGeneral: { rece: 18 } });
    const [x, y] = r.repartizari;
    expect(x.detaliu).toEqual({
      tip: "rece", consumPropriu: 10, contorGeneral: 18, sumaContoare: 15, diferenta: 3,
      persoane: 2, totalPersoane: 3, cotaDiferenta: 2, pretMc: 10,
    });
    expect(x.baza).toEqual({ valoare: 12, total: 18, unitate: "mc" });
    expect(x.suma).toBe(120);
    expect(y.suma).toBe(60);
    expect(y.detaliu.cotaDiferenta).toBe(1);
  });

  it("apa calda foloseste contorul si consumul de apa calda", () => {
    const r = calculeazaLista({ apartamente: aps, cheltuieli: [cheltuiala("consum", 60, { tipApa: "calda" })], consum, contorGeneral: { calda: 6 } });
    expect(r.repartizari.map((x) => x.suma)).toEqual([40, 20]);
    expect(r.repartizari[0].detaliu.tip).toBe("calda");
  });

  it("consumul vine si ca text (din baza de date) si se rotunjeste la 2 zecimale", () => {
    const r = calculeazaLista({
      apartamente: aps, cheltuieli: [cheltuiala("consum", 100, { tipApa: "rece" })],
      consum: { a1: { rece: "10.004" }, a2: { rece: "9.996" } }, contorGeneral: { rece: 20 },
    });
    expect(r.repartizari.map((x) => x.detaliu.consumPropriu)).toEqual([10, 10]);
    expect(r.totalRepartizat).toBe(100);
  });

  it("fara persoane in bloc, diferenta nu se imparte (cota 0)", () => {
    const r = calculeazaLista({
      apartamente: [ap("a1", 0, 50), ap("a2", 0, 50)], cheltuieli: [cheltuiala("consum", 100, { tipApa: "rece" })],
      consum: { a1: { rece: 5 }, a2: { rece: 5 } }, contorGeneral: { rece: 10 },
    });
    expect(r.repartizari.map((x) => x.detaliu.cotaDiferenta)).toEqual([0, 0]);
    expect(r.repartizari.map((x) => x.suma)).toEqual([50, 50]);
  });

  it("[L1] diferenta negativa este refuzata de verificaDate", () => {
    const probleme = verificaDate({
      apartamente: [ap("a1", 1, 1), ap("a2", 1, 1), ap("a3", 1, 1)], cheltuieli: [cheltuiala("consum", 300, { tipApa: "rece" })],
      consum: { a1: { rece: 0 }, a2: { rece: 20 }, a3: { rece: 20 } }, contorGeneral: { rece: 30 },
    });
    expect(probleme.some((p) => /contor/.test(p) && /mic/.test(p))).toBe(true);
  });

  it("[R2] centimetrul ramas din diferenta ajunge la acelasi apartament indiferent de ordinea din lista de intrare", () => {
    /* Trei apartamente cu acelasi numar de persoane au ponderi identice, deci
       cota lor bruta din diferenta e exact egala (o egalitate garantata, nu
       una accidentala): distribuieExact trebuie sa desparta egalitatea dupa
       ceva stabil (id-ul apartamentului), nu dupa pozitia din lista primita. */
    const facApartamente = (ordine) => ordine.map((id) => ap(id, 1, 1));
    const consumEgal = { a1: { rece: 0 }, a2: { rece: 0 }, a3: { rece: 0 } };
    const cheltuieliApa = [cheltuiala("consum", 1, { tipApa: "rece" })];
    const contorGeneralMic = { rece: 0.01 };
    const dupaId = (r) => Object.fromEntries(r.repartizari.map((x) => [x.apartamentId, x.detaliu.cotaDiferenta]));

    const r1 = calculeazaLista({ apartamente: facApartamente(["a1", "a2", "a3"]), cheltuieli: cheltuieliApa, consum: consumEgal, contorGeneral: contorGeneralMic });
    const r2 = calculeazaLista({ apartamente: facApartamente(["a3", "a1", "a2"]), cheltuieli: cheltuieliApa, consum: consumEgal, contorGeneral: contorGeneralMic });
    expect(dupaId(r1)).toEqual(dupaId(r2));

    /* Aceeasi proprietate, verificata pe toate cele 6 permutari posibile ale
       celor trei apartamente ("amesteca intrarea"), pe suma finala platita. */
    const permutari = [
      ["a1", "a2", "a3"], ["a1", "a3", "a2"], ["a2", "a1", "a3"],
      ["a2", "a3", "a1"], ["a3", "a1", "a2"], ["a3", "a2", "a1"],
    ];
    const dupaSuma = (r) => Object.fromEntries(r.repartizari.map((x) => [x.apartamentId, x.suma]));
    const rezultate = permutari.map((ordine) => dupaSuma(calculeazaLista({
      apartamente: facApartamente(ordine), cheltuieli: cheltuieliApa, consum: consumEgal, contorGeneral: contorGeneralMic,
    })));
    rezultate.forEach((r) => expect(r).toEqual(rezultate[0]));
  });

  it("[L7] suma mc repartizati este egala cu contorul general (iunie, apa calda)", () => {
    const aps = D.APARTAMENTE.map((a) => ap(a.numar, a.persoane, a.cota, a.scutitLift));
    const consumIunie = Object.fromEntries(D.APARTAMENTE.map((a) => [a.numar, { calda: D.consumApartament(a.numar, "2026-06", "calda") }]));
    const r = calculeazaLista({
      apartamente: aps, cheltuieli: [cheltuiala("consum", 2402, { tipApa: "calda" })],
      consum: consumIunie, contorGeneral: { calda: 194 },
    });
    expect(round2(r.repartizari.reduce((s, x) => s + x.baza.valoare, 0))).toBe(194);
  });
});

describe("baza zero", () => {
  it("[L2] o baza zero este refuzata de verificaDate", () => {
    const probleme = verificaDate({ apartamente: [ap("a1", 2, 50, true), ap("a2", 1, 50, true)], cheltuieli: [cheltuiala("persoane_fara_lift", 300)] });
    expect(probleme.length).toBeGreaterThan(0);
  });

  it("[L2] diferenta de apa fara persoane in bloc este refuzata", () => {
    const probleme = verificaDate({
      apartamente: [ap("a1", 0, 50), ap("a2", 0, 50)], cheltuieli: [cheltuiala("consum", 100, { tipApa: "rece" })],
      consum: { a1: { rece: 5 }, a2: { rece: 5 } }, contorGeneral: { rece: 12 },
    });
    expect(probleme).toEqual(["C1: diferenta de apa nu se poate imparti, niciun apartament nu are persoane declarate."]);
  });

  it("[L2] fara persoane, lista nu se calculeaza: suma nu ajunge la un singur apartament", () => {
    expect(() => calculeazaLista({ apartamente: [ap("a1", 0, 50), ap("a2", 0, 50)], cheltuieli: [cheltuiala("persoane", 300)] }))
      .toThrow("niciun apartament nu are persoane declarate");
  });
});

describe("verificaDate", () => {
  it("date corecte: nicio problema", () => {
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: [cheltuiala("cota", 10)] })).toEqual([]);
  });

  it("fara apartamente (lipsa sau lista goala)", () => {
    expect(verificaDate({ cheltuieli: [] })).toEqual(["Blocul nu are apartamente."]);
    expect(verificaDate({ apartamente: [] })).toEqual(["Blocul nu are apartamente."]);
  });

  it("metoda necunoscuta si suma zero sau negativa", () => {
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: [{ cod: "C7", metoda: "suprafata", suma: 0 }] })).toEqual([
      'C7: metoda "suprafata" nu exista.',
      "C7: suma trebuie sa fie mai mare decat zero.",
    ]);
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: [{ cod: "C1", metoda: "cota", suma: -5 }] })).toEqual(["C1: suma trebuie sa fie mai mare decat zero."]);
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: [{ cod: "C1", metoda: "cota" }] })).toHaveLength(1);
  });

  it("apa fara tip: o singura problema, restul verificarilor se sar", () => {
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: [{ cod: "C1", metoda: "consum", suma: 10, tipApa: null }] }))
      .toEqual(["C1: alege daca este apa rece sau apa calda."]);
  });

  it("apa fara contor general sau cu contorul general zero", () => {
    const consum = { a1: { rece: 1 }, a2: { rece: 1 }, a3: { rece: 1 } };
    const c = [{ cod: "C1", metoda: "consum", suma: 10, tipApa: "rece" }];
    const mesaj = "C1: lipseste citirea contorului general pentru apa rece.";
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: c, consum })).toEqual([mesaj]);
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: c, consum, contorGeneral: { rece: 0 } })).toEqual([mesaj]);
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: c, consum, contorGeneral: { calda: 5 } })).toEqual([mesaj]);
  });

  it("apa cu citiri lipsa: fara consum, fara apartament, fara tipul cerut", () => {
    const c = [{ cod: "C2", metoda: "consum", suma: 10, tipApa: "calda" }];
    const g = { calda: 10 };
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: c, contorGeneral: g })).toEqual(["C2: lipsesc citirile la apa calda pentru 3 apartamente."]);
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: c, contorGeneral: g, consum: { a1: { calda: 1 }, a2: { rece: 3 } } }))
      .toEqual(["C2: lipsesc citirile la apa calda pentru 2 apartamente."]);
    expect(verificaDate({ apartamente: BLOC3, cheltuieli: c, contorGeneral: g, consum: { a1: { calda: 0 }, a2: { calda: 0 }, a3: { calda: 0 } } })).toEqual([]);
  });

  it("apa fara apartamente nu cade (apartamente lipsa)", () => {
    expect(verificaDate({ cheltuieli: [{ cod: "C1", metoda: "consum", suma: 10, tipApa: "rece" }], contorGeneral: { rece: 3 } }))
      .toEqual(["Blocul nu are apartamente."]);
  });

  it("[minor] L1: sumaContoare se calculeaza la fel ca in repartizeazaApa, rotunjit pe apartament, nu pe suma bruta", () => {
    /* Trei consumuri estimate, pe 3 zecimale (exact ce produce
       contorizare.estimeaza_citiri): 10.005 fiecare. Suma bruta e 30.015,
       care rotunjita o singura data da 30.02 — egala cu contorul general,
       deci L1 n-ar avea ce semnala. Dar repartizeazaApa rotunjeste FIECARE
       apartament la 2 zecimale INAINTE sa insumeze (10.01 x 3 = 30.03), mai
       mult decat contorul general: coloana ar iesi cu diferenta negativa pe
       lista locatarului, desi verificaDate a lasat lista sa treaca. */
    const apartamente = [ap("a1", 1, 33.34), ap("a2", 1, 33.33), ap("a3", 1, 33.33)];
    const consum = { a1: { rece: 10.005 }, a2: { rece: 10.005 }, a3: { rece: 10.005 } };
    const contorGeneral = { rece: 30.02 };
    const cheltuieli = [{ id: "ch1", cod: "C1", suma: 300, metoda: "consum", tipApa: "rece" }];

    expect(verificaDate({ apartamente, cheltuieli, consum, contorGeneral })).toEqual([
      "C1: contorul general (30.02 mc) este mai mic decat suma contoarelor din apartamente (30.03 mc). Verifica citirile la apa rece.",
    ]);
  });
});

describe("calculeazaLista refuza datele gresite", () => {
  it("arunca o eroare cu toate problemele in .probleme", () => {
    let e;
    try {
      calculeazaLista({ apartamente: [], cheltuieli: [{ cod: "C3", metoda: "x", suma: 1 }] });
    } catch (x) { e = x; }
    expect(e).toBeInstanceOf(Error);
    expect(e.probleme).toEqual(["Blocul nu are apartamente.", 'C3: metoda "x" nu exista.']);
    expect(e.message).toBe('Blocul nu are apartamente. C3: metoda "x" nu exista.');
  });

  it("lista fara cheltuieli da totaluri zero", () => {
    const r = calculeazaLista({ apartamente: BLOC3, cheltuieli: [] });
    expect(r).toMatchObject({ repartizari: [], totalCheltuieli: 0, totalRepartizat: 0 });
  });
});

/* Garduri interne: prin date normale nu se ajunge aici, pentru ca verificaDate
   refuza inainte. Le verificam ocolind verificarea, ca sa stim ca motorul nu
   calculeaza tacut cu date imposibile. */
describe("gardurile interne ale motorului", () => {
  it("o metoda acceptata de verificare, dar necunoscuta calculului, arunca", () => {
    METODE.push("suprafata");
    try {
      expect(() => calculeazaLista({ apartamente: BLOC3, cheltuieli: [cheltuiala("suprafata", 10)] }))
        .toThrow("Metoda de repartizare necunoscuta: suprafata");
    } finally {
      METODE.pop();
    }
  });

  it("contorul general care dispare intre verificare si calcul arunca", () => {
    let citiri = 0;
    const contorGeneral = { get rece() { citiri += 1; return citiri === 1 ? 10 : 0; } };
    expect(() => calculeazaLista({
      apartamente: BLOC3, cheltuieli: [cheltuiala("consum", 10, { tipApa: "rece" })],
      consum: { a1: { rece: 1 }, a2: { rece: 1 }, a3: { rece: 1 } }, contorGeneral,
    })).toThrow("Lipseste citirea contorului general pentru apa rece.");
  });
});

describe("blocul demo D14", () => {
  it("lista din iunie: totalul repartizat este totalul facturilor si fiecare cheltuiala se inchide la ban", () => {
    const aps = D.APARTAMENTE.map((a) => ap(a.numar, a.persoane, a.cota, a.scutitLift));
    const cheltuieli = D.FACTURI["2026-06"].map((f) => {
      const fz = D.FURNIZORI.find((x) => x.cheie === f.furnizor);
      return { id: f.serie, cod: fz.cod, suma: f.suma, metoda: fz.metoda, tipApa: fz.tipApa || null };
    });
    const consum = Object.fromEntries(D.APARTAMENTE.map((a) => [a.numar, {
      rece: D.consumApartament(a.numar, "2026-06", "rece"), calda: D.consumApartament(a.numar, "2026-06", "calda"),
    }]));
    const r = calculeazaLista({ apartamente: aps, cheltuieli, consum, contorGeneral: D.CONTOR_GENERAL["2026-06"] });
    expect(r.totalRepartizat).toBe(r.totalCheltuieli);
    cheltuieli.forEach((c) => {
      const s = r.repartizari.filter((x) => x.cheltuialaId === c.id).reduce((t, x) => t + bani(x.suma), 0);
      expect(s).toBe(bani(c.suma));
    });
    /* parterul este scutit de lift */
    expect(r.repartizari.filter((x) => x.cheltuialaId === "ELM-2151" && ["1", "2", "3", "4"].includes(x.apartamentId)).every((x) => x.suma === 0)).toBe(true);
  });
});

/* Generator determinist (mulberry32), ca testul sa dea mereu acelasi rezultat */
function aleator(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("proprietatea: suma partilor = factura, la ban", () => {
  it("pe 400 de liste aleatoare, fiecare cheltuiala se imparte exact", () => {
    const rnd = aleator(20260919);
    const intre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    for (let caz = 0; caz < 400; caz += 1) {
      const n = intre(1, 25);
      const apartamente = Array.from({ length: n }, (_, i) => ({
        id: `a${i}`, persoane: intre(0, 6), cota: intre(100, 900) / 100, scutitLift: rnd() < 0.2,
      }));
      /* o baza zero este refuzata de verificaDate [L2]: macar un apartament cu lift si persoane */
      if (!apartamente.some((a) => !a.scutitLift && a.persoane > 0)) Object.assign(apartamente[0], { persoane: 1, scutitLift: false });
      const consum = Object.fromEntries(apartamente.map((a) => [a.id, { rece: intre(0, 2000) / 100, calda: intre(0, 1000) / 100 }]));
      const sumaRece = apartamente.reduce((s, a) => s + consum[a.id].rece, 0);
      const sumaCalda = apartamente.reduce((s, a) => s + consum[a.id].calda, 0);
      const contorGeneral = { rece: round2(sumaRece + intre(1, 3000) / 100), calda: round2(sumaCalda + intre(1, 3000) / 100) };
      const cheltuieli = Array.from({ length: intre(1, 8) }, (_, i) => {
        const metoda = METODE[intre(0, 4)];
        return { id: `c${i}`, cod: `C${i}`, suma: intre(1, 1000000) / 100, metoda, tipApa: metoda === "consum" ? (rnd() < 0.5 ? "rece" : "calda") : null };
      });
      const r = calculeazaLista({ apartamente, cheltuieli, consum, contorGeneral });
      expect(r.repartizari).toHaveLength(n * cheltuieli.length);
      cheltuieli.forEach((c) => {
        const parti = r.repartizari.filter((x) => x.cheltuialaId === c.id);
        parti.forEach((x) => expect(bani(x.suma)).toBeCloseTo(x.suma * 100, 6));
        expect(parti.reduce((s, x) => s + bani(x.suma), 0)).toBe(bani(c.suma));
      });
      expect(r.totalRepartizat).toBe(r.totalCheltuieli);
    }
  });
});
