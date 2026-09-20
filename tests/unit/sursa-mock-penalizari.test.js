/* Sursa demo rejucata pe o varianta a datelor demo: doi ani de calcule
   lunare, un procent mare de penalizare, o restanta de un ban si o luna in
   lucru mai veche decat listele publicate, cu citiri fara data de
   transmitere. Verifica regulile din rejucare care nu se vad pe datele
   obisnuite. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { ceasDemo, PAROLA, ADMIN } from "./ajutor.jsx";

const LUNI_CALCUL = vi.hoisted(() => Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2026, 6 + i, 1)).toISOString().slice(0, 10)));

vi.mock("../../src/date-demo.js", async (importOriginal) => {
  const D = await importOriginal();
  return {
    ...D,
    SETARI_FINANCIARE: { ...D.SETARI_FINANCIARE, procentPenalizareZi: 1 },
    CALCULE_PENALIZARI: LUNI_CALCUL,
    RESTANTE_INITIALE: [
      ...D.RESTANTE_INITIALE,
      { numar: "2", suma: 0.01, luna: "2026-05", scadenta: "2026-05-25", descriere: "Rest de un ban din mai 2026" },
    ],
    LUNA_CIORNA: "2026-04",
    CITIRI_LUNA_CURENTA: { validate: ["1"], trimise: ["1"], respinse: [] },
  };
});

const apNr = (d, n) => d.apartamente.find((a) => a.numar === n);

async function admin() {
  const s = creeazaSursaMock();
  await s.intra(ADMIN, PAROLA);
  return s.incarca();
}

beforeEach(() => ceasDemo());

describe("rejucarea pe date variate", () => {
  it("calculele lunare continua cat timp datoria ramane neplatita, pana la plafon", async () => {
    const d = await admin();
    const soldInitial = d.datorii.find((x) => x.tip === "sold_initial" && x.apartamentId === apNr(d, "11").id);
    const pen = d.penalizari.filter((p) => p.datorieSursaId === soldInitial.id);
    expect(pen.length).toBeGreaterThan(1);
    expect(pen.map((p) => p.lunaCalcul)).toEqual(LUNI_CALCUL.slice(0, pen.length));
    expect(pen.every((p) => p.suma > 0 && p.suma <= p.restNeachitat)).toBe(true);
    /* ultima penalizare atinge exact plafonul, dupa care calculul se opreste [F1] */
    expect(Math.round(pen.reduce((s, p) => s + p.suma, 0) * 100)).toBe(Math.round(soldInitial.suma * 100));
  });

  it("o restanta de un ban nu produce penalizari de 0 lei", async () => {
    const d = await admin();
    expect(d.penalizari.every((p) => p.suma > 0)).toBe(true);
    const unBan = d.datorii.find((x) => x.descriere === "Rest de un ban din mai 2026");
    expect(d.penalizari.filter((p) => p.datorieSursaId === unBan.id)).toEqual([]);
  });

  it("indexul anterior al unei luni vechi transmise de doua ori este ultimul index cunoscut", async () => {
    const d = await admin();
    const ap1 = apNr(d, "1").id;
    const rece = d.contoare.find((c) => c.apartamentId === ap1 && c.tip === "rece");
    const aug = d.citiri.find((x) => x.contorId === rece.id && x.luna === "2026-08");
    const aprilie = d.citiri.filter((x) => x.contorId === rece.id && x.luna === "2026-04");
    expect(aprilie.map((x) => x.stare)).toEqual(["validata", "trimisa"]);
    /* fara data de transmitere in date, citirea apare cu transmisaLa null */
    expect(aprilie.map((x) => x.transmisaLa)).toEqual([null, null]);
    expect(aprilie[0].indexAnterior).toBe(aug.indexCurent);
    expect(aprilie[1].indexAnterior).toBe(aug.indexCurent);
    expect(d.liste.map((l) => l.luna)).toEqual(["2026-08", "2026-07", "2026-06", "2026-04"]);
  });

  it("[F1] totalul penalizarilor unei datorii nu depaseste datoria", async () => {
    const d = await admin();
    const soldInitial = d.datorii.find((x) => x.tip === "sold_initial" && x.apartamentId === apNr(d, "11").id);
    const total = d.penalizari.filter((p) => p.datorieSursaId === soldInitial.id).reduce((t, p) => t + p.suma, 0);
    expect(total).toBeLessThanOrEqual(soldInitial.suma);
  });
});
