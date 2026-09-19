/* Datele din fixture (audit 2: T2).
   Baza ruleaza pe ora Romaniei (migratia fus_orar_romania), deci `current_date`
   si `date_trunc('month', current_date)` sunt cele de la Bucuresti. Fixture-ul
   le calcula in UTC: intre miezul noptii de la Bucuresti si miezul noptii UTC
   (2-3 ore, in fiecare noapte) testele cereau alta zi si, la inceput de luna,
   alta luna decat cea in care scria baza. Exact bug-ul X1, ramas in teste. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { azi, lunaCurenta, lunaDelta } from "./fixture.js";

afterEach(() => vi.useRealTimers());

const la = (iso) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

describe("ziua si luna se iau din ora Romaniei", () => {
  it("noaptea de 1 ale lunii: la Bucuresti e deja luna noua, desi in UTC nu", () => {
    la("2026-09-30T22:30:00Z"); /* 1 octombrie, 01:30, la Bucuresti */
    expect(azi()).toBe("2026-10-01");
    expect(lunaCurenta()).toBe("2026-10");
    expect(lunaDelta(-1)).toBe("2026-09");
    expect(lunaDelta(1)).toBe("2026-11");
  });

  it("iarna, decalajul este de doua ore, si tot se schimba ziua", () => {
    la("2026-01-31T22:30:00Z"); /* 1 februarie, 00:30, la Bucuresti */
    expect(azi()).toBe("2026-02-01");
    expect(lunaCurenta()).toBe("2026-02");
  });

  it("ziua normala de peste zi este aceeasi in ambele fusuri", () => {
    la("2026-06-15T09:00:00Z");
    expect(azi()).toBe("2026-06-15");
    expect(lunaCurenta()).toBe("2026-06");
    expect(lunaDelta(-7)).toBe("2025-11");
  });
});
