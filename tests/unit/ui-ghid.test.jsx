/* Ecranul "Cum functioneaza aplicatia": cate o explicatie pentru fiecare
   functie, separat pentru locatar si pentru administrator. Se deschide din
   bara de sus si, inainte de a avea cont, de pe ecranul de intrare. */
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, ADMIN, LOCATAR } from "./ajutor.jsx";
import { apasa } from "./ui-baza-ajutor.jsx";

const TITLU = "Cum functioneaza aplicatia";
const ghid = () => within(screen.getByRole("dialog", { name: TITLU }));
const deschide = () => apasa(screen.getByRole("button", { name: TITLU }));
/* Eticheta taburilor, fara insigna cu numarul */
const eticheteTaburi = () => screen.getAllByRole("tab").map((t) => t.textContent.replace(/\d+$/, ""));
const sectiune = (titlu) => ghid().getByRole("button", { name: new RegExp(`^${titlu}`) });

describe("Cum functioneaza aplicatia, din cont", () => {
  it("locatarul: cate o sectiune pentru fiecare tab al lui, plus contul, fara ale administratorului", async () => {
    await pornesteApp({ email: LOCATAR });
    const taburi = eticheteTaburi();
    expect(taburi).toEqual(["Acasa", "Plata", "Contoare", "Sesizari", "Bloc"]);
    await deschide();
    /* Paza: un tab nou, fara explicatie, face testul sa pice */
    for (const t of [...taburi, "Contul tau"]) expect(sectiune(t)).toBeTruthy();
    expect(ghid().queryByRole("button", { name: /^Facturi/ })).toBeNull();
    expect(ghid().getByText(/orice suma se deschide in calculul, factura si documentul din spatele ei/)).toBeTruthy();
  });

  it("administratorul: cate o sectiune pentru fiecare tab al lui, plus contul, fara ale locatarului", async () => {
    await pornesteApp({ email: ADMIN });
    const taburi = eticheteTaburi();
    expect(taburi).toEqual(["Sumar", "Apartamente", "Facturi", "Sesizari", "Comunicare"]);
    await deschide();
    for (const t of [...taburi, "Contul tau"]) expect(sectiune(t)).toBeTruthy();
    expect(ghid().queryByRole("button", { name: /^Contoare/ })).toBeNull();
  });

  it("o sectiune se deschide la atingere, iar Du-ma acolo deschide tabul ei", async () => {
    await pornesteApp({ email: LOCATAR });
    await deschide();
    const plata = sectiune("Plata");
    expect(plata.getAttribute("aria-expanded")).toBe("false");
    expect(ghid().queryByText(/Nimic nu ramane nealocat/)).toBeNull();
    await apasa(plata);
    expect(sectiune("Plata").getAttribute("aria-expanded")).toBe("true");
    expect(ghid().getByText(/Nimic nu ramane nealocat/)).toBeTruthy();
    await apasa(ghid().getByRole("button", { name: "Du-ma la Plata" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tab", { name: /^Plata/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("a doua atingere inchide sectiunea; sectiunea contului nu duce nicaieri", async () => {
    await pornesteApp({ email: ADMIN });
    await deschide();
    await apasa(sectiune("Facturi"));
    expect(sectiune("Facturi").getAttribute("aria-expanded")).toBe("true");
    await apasa(sectiune("Facturi"));
    expect(sectiune("Facturi").getAttribute("aria-expanded")).toBe("false");
    await apasa(sectiune("Contul tau"));
    expect(ghid().getByText(/numarul atestatului/)).toBeTruthy();
    expect(ghid().queryByRole("button", { name: /^Du-ma la/ })).toBeNull();
  });
});

describe("Cum functioneaza aplicatia, inainte de cont", () => {
  it("pe ecranul de intrare alegi rolul; nu exista Du-ma acolo", async () => {
    await pornesteApp();
    await screen.findByText("Intra in cont");
    await deschide();
    expect(sectiune("Acasa")).toBeTruthy();
    expect(ghid().queryByRole("button", { name: /^Sumar/ })).toBeNull();
    await apasa(ghid().getByRole("button", { name: "Administrator" }));
    expect(sectiune("Sumar")).toBeTruthy();
    expect(ghid().queryByRole("button", { name: /^Acasa/ })).toBeNull();
    await apasa(sectiune("Sumar"));
    expect(ghid().queryByRole("button", { name: /^Du-ma la/ })).toBeNull();
    await apasa(ghid().getByRole("button", { name: "Inchide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Intra in cont")).toBeTruthy();
  });
});
