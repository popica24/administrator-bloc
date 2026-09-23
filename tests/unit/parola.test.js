/* Parola pe care sistemul o face pentru contul creat de administrator. */
import { describe, it, expect } from "vitest";
import { genereazaParola } from "../../supabase/functions/_shared/parola.js";

const numere = (...valori) => (cate) => Uint32Array.from(valori.slice(0, cate));

describe("genereazaParola", () => {
  it("doua cuvinte si patru cifre, ca sa poata fi citita la telefon", () => {
    expect(genereazaParola(numere(3, 8, 4821))).toBe("Vecin-Lac-4821");
  });

  it("cifrele se completeaza pana la patru, ca lungimea sa fie mereu aceeasi", () => {
    expect(genereazaParola(numere(0, 1, 7))).toBe("Bloc-Casa-0007");
  });

  it("trece regulile cerute de Supabase Auth, oricare ar fi numerele", () => {
    for (let i = 0; i < 200; i += 1) {
      const p = genereazaParola();
      expect(p.length).toBeGreaterThanOrEqual(10);
      expect(/[A-Z]/.test(p)).toBe(true);
      expect(/[a-z]/.test(p)).toBe(true);
      expect(/\d/.test(p)).toBe(true);
    }
  });

  it("nu da aceeasi parola de doua ori la rand", () => {
    const multe = new Set(Array.from({ length: 50 }, () => genereazaParola()));
    expect(multe.size).toBeGreaterThan(40);
  });
});
