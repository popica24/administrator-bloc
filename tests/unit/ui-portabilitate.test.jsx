/* [F8-F12] Portabilitatea pe React Native: ecranele folosesc numai primitivele
   din sectiunea 5. Testul de mai jos citeste sursa si opreste regresiile:
   niciun <div>, niciun atribut aria/role, nicio proprietate CSS pe care React
   Native nu o cunoaste nu au voie sa reapara in sectiunile 7-10. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, sursaDemo, ceasDemo, ADMIN, LOCATAR, PAROLA } from "./ajutor.jsx";
import { apasa, tab } from "./ui-baza-ajutor.jsx";

const SURSA = readFileSync(resolve(process.cwd(), "src/AdminBloc.jsx"), "utf8");

/* Sectiunile 7-10: elementul semnatura, ecranele si shell-ul. Sectiunea 5
   (primitivele) si sectiunea 11 (aplicatia) au voie sa atinga DOM-ul. */
function sectiunileEcranelor() {
  const de_la = SURSA.indexOf("7. ELEMENTUL SEMNATURA");
  const pana_la = SURSA.indexOf("11. APLICATIA");
  expect(de_la).toBeGreaterThan(0);
  expect(pana_la).toBeGreaterThan(de_la);
  return SURSA.slice(de_la, pana_la);
}

const INTERZISE = [
  ["elemente DOM brute", /<div[\s>]/g],
  ["atribute aria", /\saria-[a-z]+=/g],
  ["atributul role", /\srole=/g],
  ["proprietati -webkit-", /Webkit[A-Z]/g],
  ["whiteSpace", /whiteSpace/g],
  ["scurtaturi de bordura pe o latura", /border(Left|Right|Top|Bottom):/g],
  ["inaltime procentuala", /height: "100%"/g],
  ["window.confirm sincron", /window\.confirm/g],
];

describe("[F8-F12] ecranele nu folosesc API-uri de browser", () => {
  it.each(INTERZISE)("sectiunile 7-10 nu contin %s", (_nume, tipar) => {
    expect(sectiunileEcranelor().match(tipar) || []).toEqual([]);
  });
});

describe("[F8] confirmarea este asteptata, nu presupusa", () => {
  it("stergerea unei cheltuieli asteapta raspunsul", async () => {
    ceasDemo();
    const sursa = sursaDemo();
    await sursa.intra(ADMIN, PAROLA);
    const ciorna = (await sursa.incarca()).liste.find((l) => l.stare === "ciorna");
    await sursa.salveazaCheltuiala({ listaId: ciorna.id, furnizorNou: "Deratizare SRL", categorie: "Deratizare", cod: "C12", suma: 300, metoda: "apartamente" });
    await pornesteApp({ email: ADMIN, sursa });
    const sterge = vi.spyOn(sursa, "stergeCheltuiala");
    vi.spyOn(window, "confirm").mockImplementation(() => Promise.resolve(false));
    await tab("Facturi");
    await apasa("Șterge");
    expect(sterge).not.toHaveBeenCalled();

    window.confirm.mockImplementation(() => Promise.resolve(true));
    await apasa("Șterge");
    expect(sterge).toHaveBeenCalledTimes(1);
  });

  it("estimarea citirilor asteapta raspunsul", async () => {
    const { sursa } = await pornesteApp({ email: ADMIN });
    const estimeaza = vi.spyOn(sursa, "estimeazaCitiri");
    vi.spyOn(window, "confirm").mockImplementation(() => Promise.resolve(false));
    await tab("Apartamente");
    await apasa("Citiri contoare");
    await apasa("Estimează citirile lipsă");
    expect(estimeaza).not.toHaveBeenCalled();

    window.confirm.mockImplementation(() => Promise.resolve(true));
    await apasa("Estimează citirile lipsă");
    expect(estimeaza).toHaveBeenCalledTimes(1);
  });
});

describe("primitivele pastreaza ce vede tehnologia de asistare", () => {
  it("segmentul, comutatorul, randul desfasurabil si taburile", async () => {
    await pornesteApp({ email: LOCATAR });
    const taburi = screen.getAllByRole("tab");
    expect(taburi.map((t) => t.getAttribute("aria-selected"))).toContain("true");

    await tab("Plata");
    const segment = screen.getByRole("button", { name: "Lista de plată" });
    expect(segment.getAttribute("aria-pressed")).toBe("true");

    const rand = screen.getByRole("button", { name: /^Salubritate, / });
    expect(rand.getAttribute("aria-expanded")).toBe("false");
    await apasa("Salubritate, 68,57 lei");
    expect(screen.getByRole("button", { name: /^Salubritate, / }).getAttribute("aria-expanded")).toBe("true");
  });

  it("textul scurtat la doua randuri ramane scurtat", async () => {
    await pornesteApp({ email: LOCATAR });
    const anunt = screen.getByText(/Apa Canal opreste furnizarea/i);
    expect(anunt.style.getPropertyValue("-webkit-line-clamp")).toBe("2");
  });
});
