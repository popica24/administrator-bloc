/* Pagina publica "Cum functioneaza AdminBloc" (cum-functioneaza/), fara
   autentificare. Lista din deschidere se calculeaza in pagina, cu sursa demo
   si motorul real, deci cifrele de aici sunt aceleasi cu cele din aplicatie. */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import PaginaPublica, { Socoteala } from "../../src/pagina-publica.jsx";
import { GHID } from "../../src/ghid.js";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { ceasDemo } from "./ajutor.jsx";

beforeEach(() => ceasDemo());

async function deschide() {
  render(<PaginaPublica />);
  return screen.findByRole("table", { name: /Lista de intretinere pe august 2026/ });
}

/* Ce a calculat motorul pentru lista din august, direct din sursa demo */
async function repartizareaDin(cod, numar) {
  const s = creeazaSursaMock();
  await s.intra("administrator@adminbloc.test", "Bloc-D14-2026");
  const d = await s.incarca();
  const lista = d.liste.find((l) => l.luna === "2026-08");
  const c = d.cheltuieli.find((x) => x.listaId === lista.id && x.cod === cod);
  const ap = d.apartamente.find((a) => a.numar === numar);
  return { r: d.repartizari.find((x) => x.cheltuialaId === c.id && x.apartamentId === ap.id), lista };
}

const socoteala = () => within(screen.getByRole("region", { name: "Socoteala sumei alese" }));
/* Textul socotelii, intreg: o cifra poate aparea in mai multi pasi */
const textSocoteala = () => screen.getByRole("region", { name: "Socoteala sumei alese" }).textContent;

describe("pagina publica, lista din deschidere", () => {
  it("are un rand pe apartament si o coloana pe cheltuiala, cu sumele calculate de motor", async () => {
    const tabel = await deschide();
    expect(within(tabel).getAllByRole("row")).toHaveLength(21);
    const { r } = await repartizareaDin("C1", "17");
    const casuta = within(tabel).getByRole("button", { name: "Ap. 17, Apa rece si canalizare: 203,45 lei" });
    expect(r.suma).toBe(203.45);
    expect(casuta.textContent).toBe("203,45");
  });

  it("socoteala apei reci a apartamentului 17 e deschisa de la inceput, pas cu pas", async () => {
    await deschide();
    expect(screen.getByRole("button", { name: "Ap. 17, Apa rece si canalizare: 203,45 lei" }).getAttribute("aria-pressed")).toBe("true");
    const t = textSocoteala();
    for (const bucata of ["3.284,60 lei", "428 mc", "7,6743 lei pe mc", "14,68 mc", "11,83 mc", "26,51 mc", "= 203,45 lei"]) expect(t).toContain(bucata);
  });

  it("atingerea altei sume ii deschide socoteala: salubritatea, pe persoane", async () => {
    await deschide();
    const casuta = screen.getByRole("button", { name: "Ap. 17, Salubritate: 68,57 lei" });
    await act(async () => { casuta.click(); });
    expect(casuta.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Ap. 17, Apa rece si canalizare: 203,45 lei" }).getAttribute("aria-pressed")).toBe("false");
    const t = textSocoteala();
    for (const bucata of ["1.120,00 lei", "3 din 49 persoane", "= 68,57 lei"]) expect(t).toContain(bucata);
  });

  it("pe cota si pe apartament, socoteala spune baza fiecaruia", async () => {
    await deschide();
    await act(async () => { screen.getByRole("button", { name: /^Ap\. 17, Fond de reparatii: / }).click(); });
    expect(socoteala().getByText(/din 100 %/)).toBeTruthy();
    await act(async () => { screen.getByRole("button", { name: /^Ap\. 17, Administrare si cenzorat: / }).click(); });
    expect(socoteala().getByText(/1 din 20 apartamente/)).toBeTruthy();
  });

  it("o suma cu rotunjire la ban spune cat si de ce", async () => {
    await deschide();
    await act(async () => { screen.getByRole("button", { name: /^Ap\. 1, Energie electrica parti comune: / }).click(); });
    expect(textSocoteala()).toContain("Suma contine o rotunjire la ban de -0,05 lei");
  });

  it("o factura fara serie nu lasa un spatiu gol in socoteala", () => {
    render(<Socoteala
      c={{ categorie: "Curatenie", furnizor: "Curat SRL", serie: null, suma: 100, metoda: "apartamente" }}
      ap={{ numar: "3" }}
      r={{ suma: 5, rotunjire: 0, detaliu: null, baza: { valoare: 1, total: 20, unitate: "apartamente" } }}
    />);
    expect(screen.getByText("Curatenie, factura Curat SRL: 100,00 lei, impartita in parti egale, pe apartament.")).toBeTruthy();
  });

  it("o cheltuiala fara furnizor, de exemplu un fond, isi spune doar numele", () => {
    render(<Socoteala
      c={{ categorie: "Fond de rulment", furnizor: null, serie: null, suma: 400, metoda: "cota" }}
      ap={{ numar: "5" }}
      r={{ suma: 20, rotunjire: 0, detaliu: null, baza: { valoare: 5, total: 100, unitate: "%" } }}
    />);
    expect(screen.getByText("Fond de rulment: 400,00 lei, impartita pe cota indiviza.")).toBeTruthy();
  });

  it("verificarea de sub lista: totalul facturilor este egal cu totalul impartit", async () => {
    await deschide();
    const { lista } = await repartizareaDin("C1", "17");
    expect(lista.totalRepartizat).toBe(12154.95);
    expect(screen.getByText("Facturile lunii: 12.154,95 lei. Impartit pe apartamente: 12.154,95 lei. Nealocat: 0,00 lei.")).toBeTruthy();
  });
});

describe("pagina publica, continutul", () => {
  it("o luna, de la factura la chitanta, are pasii in ordine", async () => {
    await deschide();
    const pasi = within(screen.getByRole("list", { name: "O luna, de la factura la chitanta" })).getAllByRole("listitem");
    expect(pasi).toHaveLength(6);
    expect(pasi[3].textContent).toMatch(/publica lista/);
  });

  it("fiecare functie a fiecarui rol apare, din src/ghid.js", async () => {
    await deschide();
    for (const [rol, titlu] of [["locatar", "Ce vede locatarul"], ["administrator", "Ce vede administratorul"]]) {
      const zona = within(screen.getByRole("region", { name: titlu }));
      for (const sec of GHID[rol]) {
        expect(zona.getByRole("heading", { name: sec.titlu })).toBeTruthy();
        for (const p of sec.puncte) expect(zona.getByText(p)).toBeTruthy();
      }
    }
  });

  it("duce la aplicatie, fara sa ceara cont pentru a citi pagina", async () => {
    await deschide();
    const link = screen.getByRole("link", { name: "Deschide aplicatia" });
    expect(link.getAttribute("href")).toBe("../");
    expect(screen.queryByText("Intra in cont")).toBeNull();
  });
});
