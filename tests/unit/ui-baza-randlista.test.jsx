/* RandLista (sectiunea 7): randul din lista de plata care se desface in
   calculul complet, plus formulaScurta, etichetaBaza si RandCalcul.
   Cifrele vin din lista pe august 2026 a apartamentului 17 (Elena). */
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, act, within } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, LOCATAR } from "./ajutor.jsx";
import { tab } from "./ui-baza-ajutor.jsx";

const AP = "apa-35";
const AUG = "lis-807";

/* Porneste ca Elena, pe tabul Plata, lista pe august */
async function plata(modifica) {
  const r = await pornesteApp({ email: LOCATAR, modifica });
  await tab("Plata");
  return r;
}

/* Deschide randul cu eticheta data si intoarce zona desfacuta */
async function deschide(eticheta) {
  const rand = screen.getAllByRole("button").find((b) => (b.getAttribute("aria-label") || "").startsWith(`${eticheta}, `));
  expect(rand.getAttribute("aria-expanded")).toBe("false");
  await act(async () => { fireEvent.click(rand); });
  expect(rand.getAttribute("aria-expanded")).toBe("true");
  return { rand, zona: rand.nextElementSibling };
}

/* Textul unui rand de calcul: stanga si dreapta */
const calcul = (zona, st) => within(zona).getByText(st).parentElement.textContent;

/* Schimba repartizarea apartamentului pe cheltuiala cu codul dat din lista pe august */
function repartizare(date, cod) {
  const c = date.cheltuieli.find((x) => x.listaId === AUG && x.cod === cod);
  return { c, r: date.repartizari.find((x) => x.cheltuialaId === c.id && x.apartamentId === AP) };
}

describe("RandLista pe consum masurat", () => {
  it("arata formula scurta si toata derivarea apei reci", async () => {
    await plata();
    const rand = screen.getByRole("button", { name: "Apa rece si canalizare, 203,45 lei" });
    expect(rand.textContent).toContain("C1");
    expect(rand.textContent).toContain("26,51 mc × 7,6743 lei");
    expect(rand.textContent).toContain("+");

    const { zona } = await deschide("Apa rece si canalizare");
    expect(rand.textContent).toContain("−");
    expect(zona.textContent).toContain("Pe consum masurat");
    expect(zona.textContent).toContain("Fiecare apartament plateste apa citita la contorul lui.");
    expect(calcul(zona, "Contor general al blocului")).toBe("Contor general al blocului428,00 mc");
    expect(calcul(zona, "Suma contoarelor din apartamente")).toBe("Suma contoarelor din apartamente234,76 mc");
    expect(calcul(zona, "Diferenta pe coloana")).toBe("Diferenta pe coloana193,24 mc");
    expect(calcul(zona, "Pret pe metru cub, 3.284,60 ÷ 428,00")).toContain("7,6743 lei");
    expect(calcul(zona, "Consumul apartamentului")).toContain("14,68 mc");
    expect(calcul(zona, "Cota din diferenta, 3 din 49 pers.")).toContain("11,83 mc");
    expect(calcul(zona, "(14,68 + 11,83) × 7,6743")).toContain("203,45 lei");
    expect(zona.textContent).toContain("Apa Canal 2000 Arges");
    expect(zona.textContent).toContain("Factura ACA-448120, 3.284,60 lei");
    expect(zona.textContent).toContain("Apartamentul suporta 6,19% din aceasta cheltuiala.");
    expect(zona.textContent).not.toContain("estimat pe media");
    expect(zona.textContent).not.toContain("rotunjirea la ban");
  });

  it("se inchide la a doua apasare si se deschide si din tastatura", async () => {
    await plata();
    const rand = screen.getByRole("button", { name: "Apa calda menajera, 159,27 lei" });
    fireEvent.keyDown(rand, { key: "Enter" });
    expect(rand.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(rand, { key: " " });
    expect(rand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(rand, { key: "a" });
    expect(rand.getAttribute("aria-expanded")).toBe("false");
  });

  it("anunta consumul estimat cand indexul nu a fost transmis", async () => {
    await plata((d) => {
      d.citiri.push({ id: "cit-x", contorId: "con-111", apartamentId: AP, tip: "rece", luna: "2026-08", indexAnterior: 1, indexCurent: 2, consum: 1, sursa: "estimat", stare: "validata", transmisaLa: "2026-08-26T10:00:00+03:00" });
    });
    const { zona } = await deschide("Apa rece si canalizare");
    expect(zona.textContent).toContain("Consumul apartamentului este estimat pe media ultimelor trei luni");
    /* apa calda are citire reala, deci nu apare avertismentul */
    const { zona: calda } = await deschide("Apa calda menajera");
    expect(calda.textContent).not.toContain("estimat pe media");
  });

  it("scade rotunjirea din produs si o explica separat", async () => {
    await plata((d) => {
      const { r } = repartizare(d, "C1");
      r.suma = 203.46;
      r.rotunjire = 0.01;
    });
    const { zona } = await deschide("Apa rece si canalizare");
    expect(calcul(zona, "(14,68 + 11,83) × 7,6743")).toContain("203,45 lei");
    expect(zona.textContent).toContain("La suma de mai sus se adauga 0,01 lei din rotunjirea la ban a intregii facturi");
  });
});

describe("RandLista pe baza de calcul", () => {
  it("cota indiviza la fondul de reparatii, cu hotararea in loc de factura", async () => {
    await plata();
    const rand = screen.getByRole("button", { name: "Fond de reparatii, 74,08 lei" });
    expect(rand.textContent).toContain("cota 4,63% din 1.600,00 lei");
    const { zona } = await deschide("Fond de reparatii");
    expect(zona.textContent).toContain("Pe cota indiviza");
    expect(calcul(zona, "Suma de repartizat")).toBe("Suma de repartizat1.600,00 lei");
    expect(calcul(zona, "Baza de calcul, tot blocul")).toBe("Baza de calcul, tot blocul100,00%");
    expect(calcul(zona, "Baza apartamentului")).toBe("Baza apartamentului4,63%");
    expect(calcul(zona, "1.600,00 × 4,63 ÷ 100,00")).toContain("74,08 lei");
    expect(zona.textContent).toContain("Hotarare AG din 12.03.2026");
    expect(zona.textContent).not.toContain("Factura Hotarare");
    expect(zona.textContent).toContain("Apartamentul suporta 4,63% din aceasta cheltuiala.");
  });

  it("egal pe apartament: 1 din 20 apartamente", async () => {
    await plata();
    const rand = screen.getByRole("button", { name: "Energie electrica parti comune, 20,62 lei" });
    expect(rand.textContent).toContain("1 din 20 apartamente");
    const { zona } = await deschide("Energie electrica parti comune");
    expect(zona.textContent).toContain("Egal pe apartament");
    expect(calcul(zona, "Baza de calcul, tot blocul")).toContain("20 apartamente");
    expect(calcul(zona, "Baza apartamentului")).toContain("1 apartament");
    expect(calcul(zona, "412,35 × 1 ÷ 20")).toContain("20,62 lei");
  });

  it("pe persoane: 3 din 49 persoane", async () => {
    await plata();
    const rand = screen.getByRole("button", { name: "Salubritate, 68,57 lei" });
    expect(rand.textContent).toContain("3 din 49 persoane");
    const { zona } = await deschide("Salubritate");
    expect(zona.textContent).toContain("Pe numar de persoane");
    expect(calcul(zona, "Baza de calcul, tot blocul")).toContain("49 persoane");
    expect(calcul(zona, "Baza apartamentului")).toContain("3 persoane");
    expect(calcul(zona, "1.120,00 × 3 ÷ 49")).toContain("68,57 lei");
    expect(zona.textContent).toContain("Factura SAL-33128, 1.120,00 lei");
  });

  it("pe persoane fara parter, apartament care foloseste liftul", async () => {
    await plata();
    const { rand, zona } = await deschide("Intretinere ascensor");
    expect(rand.textContent).toContain("3 din 40 persoane");
    expect(zona.textContent).toContain("Pe persoane, fara parter");
    expect(zona.textContent).not.toContain("scutit de lift");
  });

  it("apartament scutit de lift: nu plateste nimic si spune de ce", async () => {
    await plata((d) => {
      const { r } = repartizare(d, "C5");
      r.suma = 0;
      r.baza = { valoare: 0, total: 40, unitate: "persoane" };
    });
    const rand = screen.getByRole("button", { name: "Intretinere ascensor, 0,00 lei" });
    expect(rand.textContent).toContain("scutit de lift");
    const { zona } = await deschide("Intretinere ascensor");
    expect(zona.textContent).toContain("Apartamentul este scutit de lift, de aceea nu plateste nimic pe acest rand.");
    expect(calcul(zona, "Baza apartamentului")).toContain("0 persoane");
    expect(zona.textContent).toContain("Apartamentul suporta 0,00% din aceasta cheltuiala.");
  });

  it("o singura persoana, alta unitate, factura fara numar si fara document", async () => {
    await plata((d) => {
      const s = repartizare(d, "C4");
      s.r.baza = { valoare: 1, total: 49, unitate: "persoane" };
      const u = repartizare(d, "C6");
      u.r.baza = { valoare: 12.5, total: 980, unitate: "mp" };
      u.r.rotunjire = undefined;
      u.c.serie = null;
      u.c.documentId = null;
    });
    const { zona } = await deschide("Salubritate");
    expect(calcul(zona, "Baza apartamentului")).toContain("1 persoana");

    const rand = screen.getByRole("button", { name: "Curatenie casa scarii, 55,10 lei" });
    expect(rand.textContent).toContain("13 din 980 mp");
    const { zona: z2 } = await deschide("Curatenie casa scarii");
    expect(calcul(z2, "Baza de calcul, tot blocul")).toContain("980,00 mp");
    expect(calcul(z2, "Baza apartamentului")).toContain("12,50 mp");
    expect(calcul(z2, "900,00 × 13 ÷ 980")).toContain("55,10 lei");
    expect(z2.textContent).toContain("Factura fara numar, 900,00 lei");
    expect(z2.textContent).toContain("Documentul nu a fost inca incarcat de administrator.");
    expect(within(z2).queryByText("Vezi documentul")).toBeNull();
  });

  it("o factura cu suma zero nu imparte la zero procentul", async () => {
    await plata((d) => {
      const { c, r } = repartizare(d, "C8");
      c.suma = 0;
      r.suma = 0;
    });
    const { zona } = await deschide("Deratizare si dezinsectie");
    expect(zona.textContent).toContain("Apartamentul suporta 0,00% din aceasta cheltuiala.");
  });

  /* Audit L14: cota cu 4 zecimale afisata cu 2, inmultirea nu mai reproduce suma */
  it.fails("[L14] cota cu patru zecimale se afiseaza intreaga in calcul", async () => {
    await plata((d) => {
      const { r } = repartizare(d, "C9");
      r.baza = { valoare: 4.0125, total: 100, unitate: "%" };
      r.suma = 64.2;
    });
    const { zona } = await deschide("Fond de reparatii");
    expect(zona.textContent).toContain("1.600,00 × 4,0125 ÷ 100");
  });
});
