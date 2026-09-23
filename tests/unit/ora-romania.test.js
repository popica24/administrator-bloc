/* [K22] Ora Romaniei a unei zile si ore date, intr-un singur loc. Pana acum
   acelasi calcul exista in trei copii (sursa-mock.js, sursa-supabase.js,
   AdminBloc.jsx), iar reparatiile J9 si K12 au trebuit facute pe rand in
   fiecare. Testele ruleaza pe fusul fixat in vitest.config.js, dar rezultatul
   nu depinde de el: ora e mereu a Romaniei. */
import { describe, it, expect, vi } from "vitest";
import { instantRomania, oraSeriiRomania, dataOraRomania, aziRomania } from "../../src/ora-romania.js";

describe("ora Romaniei", () => {
  it("vara, ora 18:30 inseamna 15:30 UTC (+03:00)", () => {
    expect(instantRomania("2026-07-01", "18:30")).toBe("2026-07-01T15:30:00.000Z");
  });

  it("iarna, ora 18:30 inseamna 16:30 UTC (+02:00)", () => {
    expect(instantRomania("2026-12-15", "18:30")).toBe("2026-12-15T16:30:00.000Z");
  });

  it("in zilele in care se schimba ora, seara are decalajul noii ore", () => {
    /* 29 martie 2026: ora de vara incepe la 03:00; 25 octombrie: se termina la 04:00 */
    expect(instantRomania("2026-03-29", "20:00")).toBe("2026-03-29T17:00:00.000Z");
    expect(instantRomania("2026-10-25", "20:00")).toBe("2026-10-25T18:00:00.000Z");
  });

  it("seara unei zile, ca text cu decalajul Romaniei (forma pe care o pastreaza sursele)", () => {
    expect(oraSeriiRomania("2026-09-30")).toBe("2026-09-30T20:00:00+03:00");
    expect(oraSeriiRomania("2026-11-30")).toBe("2026-11-30T20:00:00+02:00");
  });

  it("[K24] data si ora Romaniei ale unei clipe, oricare ar fi fusul dispozitivului", () => {
    const fus = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(dataOraRomania("2026-08-12T18:03:00Z")).toEqual({ data: "2026-08-12", ora: "21:03" });
      expect(dataOraRomania("2026-12-31T22:30:00Z")).toEqual({ data: "2027-01-01", ora: "00:30" });
    } finally {
      process.env.TZ = fus;
    }
  });

  it("[K24] ziua de azi este a Romaniei, nu a telefonului", () => {
    const fus = process.env.TZ;
    process.env.TZ = "America/New_York";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T02:00:00Z"));
    try {
      expect(aziRomania()).toBe("2026-09-26");
    } finally {
      vi.useRealTimers();
      process.env.TZ = fus;
    }
  });
});
