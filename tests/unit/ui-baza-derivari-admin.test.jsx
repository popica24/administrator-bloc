/* Derivarile din sectiunea 4 vazute de administrator: statisticiAdmin,
   restantieri, penalizariDeschise si listaPdf (lista pentru avizier). */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, ADMIN } from "./ajutor.jsx";
import { tab, apasa, prindePdf } from "./ui-baza-ajutor.jsx";

const text = (c) => c.querySelector(".ab-scroll").textContent;

describe("statisticiAdmin pe Sumar", () => {
  it("incasarile listei curente, restantele, penalizarile si facturile neplatite", async () => {
    const { container } = await pornesteApp({ email: ADMIN });
    const t = text(container);
    expect(t).toContain("Lista de plata august 202612.154,95LEIde incasat, termen 25 sep 2026");
    expect(t).toContain("Publicata 8 sep 2026");
    expect(t).toContain("Incasat pana acum 7.467,42 lei61%");
    expect(t).toContain("Au platit integral 14 din 20 apartamente.");
    expect(t).toContain("Restante7.014,115 apartamente in urma");
    expect(t).toContain("Penalizari17,11neachitate");
    expect(t).toContain("Citiri de verificat8");
    expect(t).toContain("Sesizari3deschise");
    expect(t).toContain("3 facturi de platit catre furnizori");
    expect(t).toContain("Salubritate 2000, scadent 30 sep 20261.120,00LEI");
  });

  it("restantierii, cel mai vechi datornic primul, cu penalizarile lor", async () => {
    const { container } = await pornesteApp({ email: ADMIN });
    const t = text(container);
    const i11 = t.indexOf("Familia Georgescu117 zile intarziere, penalizari 14,89 lei2.917,95LEI");
    const i3 = t.indexOf("Familia Ilie56 de zile intarziere, penalizari 1,20 lei1.497,37LEI");
    const i6 = t.indexOf("Vasile Munteanu25 de zile intarziere536,77LEI");
    expect(i11).toBeGreaterThan(0);
    expect(i3).toBeGreaterThan(i11);
    expect(i6).toBeGreaterThan(i3);
  });

  it("o singura zi de intarziere si o factura fara scadenta la furnizor", async () => {
    const { container } = await pornesteApp({
      email: ADMIN,
      modifica: (d) => {
        d.datorii = d.datorii.filter((x) => x.scadenta >= "2026-09-19" || x.rest <= 0);
        d.datorii.push({ id: "dat-z", apartamentId: "apa-3", tip: "intretinere", luna: "2026-08", listaId: null, suma: 12, rest: 12, scadenta: "2026-09-18", descriere: "x", creatLa: "2026-09-01T00:00:00Z" });
        const f = d.cheltuieli.filter((c) => c.tip === "factura" && !c.achitataLa && c.listaId === "lis-807");
        f.forEach((c, i) => { if (i > 0) c.achitataLa = "2026-09-10"; else c.scadentaFurnizor = null; });
      },
    });
    const t = text(container);
    expect(t).toContain("Gheorghe Voicuo zi intarziere12,00LEI");
    expect(t).toContain("O factura de platit catre furnizori");
    expect(t).toContain("Restante12,001 apartamente in urma");
    expect(t).toContain("Penalizari0,00neachitate");
  });

  it("fara lista publicata si fara restante", async () => {
    const { container } = await pornesteApp({
      email: ADMIN,
      modifica: (d) => {
        d.liste = d.liste.filter((l) => l.stare !== "publicata");
        d.datorii = [];
        d.sesizari = [];
        d.citiri = [];
      },
    });
    const t = text(container);
    expect(t).toContain("Nicio lista publicata");
    expect(t).toContain("Nicio restanta");
    expect(t).toContain("Restante0,000 apartamente in urma");
    expect(t).toContain("Citiri de verificat0");
    expect(t).not.toContain("facturi de platit");
  });

  it("lista publicata fara nicio datorie: 0% incasat", async () => {
    const { container } = await pornesteApp({ email: ADMIN, modifica: (d) => { d.datorii = []; } });
    expect(text(container)).toContain("Incasat pana acum 0,00 lei0%");
  });
});

describe("listaPdf pentru avizier", () => {
  it("lista curenta: coloanele de restante, penalizari si total de plata", async () => {
    await pornesteApp({ email: ADMIN });
    const pdf = prindePdf();
    await apasa("Exporta lista PDF");
    const { nume, text: t } = await pdf.ultimul();
    expect(nume).toBe("lista-plata-2026-08-uz-intern.pdf");
    expect(t).toContain("Asociatia de proprietari nr. 118 | Bloc D14, scara A, Str. Nicolae Balcescu nr. 22, Pitesti");
    expect(t).toContain("Lista de plata pe august 2026");
    expect(t).toContain("Afisata pe 8 septembrie 2026. Termen de plata: 25 septembrie 2026. Penalizari de 0,02% pe zi dupa 30 de zile de la scadenta.");
    expect(t).toContain("C1 Apa rece si canalizare - Apa Canal 2000 Arges, ACA-448120 - 3.284,60 lei - pe consum masurat");
    expect(t).toContain("C9 Fond de reparatii - Asociatia de proprietari nr. 118, Hotarare AG din 12.03.2026 - 1.600,00 lei - pe cota indiviza");
    expect(t).toContain("Ap.\nProprietar\nPers.\nC1\nC2\nC3\nC4\nC5\nC6\nC7\nC8\nC9\nTotal luna\nRestante\nPenaliz.\nDe plata");
    /* ap. 3: 821,84 luna + 1.496,17 restante + 1,20 penalizari */
    expect(t).toContain("3\nFamilia Ilie\n4\n259,78\n191,22\n20,62\n91,43\n0,00\n73,47\n70,00\n19,00\n96,32\n821,84\n1.496,17\n1,20\n2.319,21");
    /* ap. 17 (Elena): fara restante, deci celulele de restante si penalizari sunt goale */
    expect(t).toContain("17\nElena Marinescu\n3\n203,45\n159,27\n20,62\n68,57\n48,00\n55,10\n70,00\n19,00\n74,08\n718,09\n\n\n718,09");
    /* ap. 1 a platit deja: de plata 0 */
    expect(t).toContain("504,86\n\n\n0,00\n2\nAna Petrescu");
    expect(t).toContain("TOTAL\n\n\n3.284,60\n2.418,00\n412,35\n1.120,00\n640,00\n900,00\n1.400,00\n380,00\n1.600,00\n12.154,95");
    expect(t).toContain("Fiecare suma se poate verifica in aplicatie");
    expect(t).toMatch(/Asociatia de proprietari nr\. 118, Bloc D14, scara A\. Lista generata din AdminBloc pe 19 septembrie 2026\. Document intern, nu se afiseaza la avizier\.[ ]{2}\|[ ]{2}pagina \d/);
    /* ordinea apartamentelor este numerica: 2 inainte de 10 */
    expect(t.indexOf("\n2\nAna Petrescu")).toBeLessThan(t.indexOf("\n10\nSanda Croitoru"));
  });

  /* [C8/X01] Varianta pentru avizier (spatiu public, casa scarii) nu are
     nicio identitate: fara proprietar, fara persoane, fara restante sau
     penalizari, indiferent daca lista e curenta sau trecuta. */
  it("[X01] varianta pentru avizier: doar apartamentul, cheltuielile si totalul lunii, fara nume si fara restante", async () => {
    await pornesteApp({
      email: ADMIN,
      modifica: (d) => {
        d.cheltuieli.find((c) => c.listaId === "lis-512" && c.cod === "C3").serie = null;
        const l = d.liste.find((x) => x.id === "lis-512");
        /* sir gol: ecranul Facturi inca se poate desena, PDF-ul foloseste rezervele */
        l.scadenta = "";
        l.publicataLa = "";
      },
    });
    await tab("Facturi");
    await apasa("iul 26");
    const pdf = prindePdf();
    await apasa("Exporta PDF pentru avizier");
    const { nume, text: t } = await pdf.ultimul();
    expect(nume).toBe("lista-plata-2026-07.pdf");
    expect(t).toContain("Lista de plata pe iulie 2026");
    expect(t).toContain("Afisata pe 19 septembrie 2026. Termen de plata: -.");
    expect(t).toContain("C3 Energie electrica parti comune - Enel Energie Muntenia - 388,20 lei - egal pe apartament");
    expect(t).toContain("Ap.\nC1\nC2\nC3\nC4\nC5\nC6\nC7\nC9\nTotal luna");
    expect(t).not.toContain("Proprietar");
    expect(t).not.toContain("Pers.");
    expect(t).not.toContain("Restante");
    expect(t).not.toContain("Penaliz.");
    expect(t).not.toContain("De plata");
    expect(t).not.toContain("Gheorghe Voicu");
    expect(t).toContain("TOTAL\n2.960,40");
  });

  /* [C8/X01] Varianta interna ramane cu numele si restantele, dar marcata
     clar ca document intern, uz administrativ, nu pentru avizier. */
  it("[X01] varianta interna: proprietar, restante si nume lungi taiate la cuvant, marcata document intern", async () => {
    await pornesteApp({
      email: ADMIN,
      modifica: (d) => {
        d.apartamente.find((a) => a.numar === "2").proprietar = "Ana Maria Petrescu Ionescu";
        const l = d.liste.find((x) => x.id === "lis-512");
        l.scadenta = "";
        l.publicataLa = "";
      },
    });
    await tab("Facturi");
    await apasa("iul 26");
    const pdf = prindePdf();
    await apasa("Exporta lista interna (uz administrativ)");
    const { nume, text: t } = await pdf.ultimul();
    expect(nume).toBe("lista-plata-2026-07-uz-intern.pdf");
    expect(t).toContain("Document intern, uz administrativ: contine numele proprietarilor si restantele. Nu se afiseaza la avizier.");
    expect(t).toContain("Document intern, nu se afiseaza la avizier.");
    expect(t).toContain("Total luna\n1\nGheorghe Voicu");
    expect(t).not.toContain("De plata");
    /* [F30] numele se scurteaza la cuvant, nu la jumatatea lui */
    expect(t).toContain("Ana Maria Petrescu.");
    expect(t).toContain("TOTAL\n\n\n2.960,40");
  });

  it("un apartament fara repartizari pe lista are celulele goale si ce a platit apare ca avans", async () => {
    await pornesteApp({
      email: ADMIN,
      modifica: (d) => { d.repartizari = d.repartizari.filter((r) => !(r.apartamentId === "apa-3" && r.listaId === "lis-807")); },
    });
    const pdf = prindePdf();
    await apasa("Exporta lista PDF");
    const { text: t } = await pdf.ultimul();
    expect(t).toContain("\n1\nGheorghe Voicu\n\n\n\n\n\n\n\n\n\n\n0,00\n\n\n-504,86\n2\nAna Petrescu");
  });

  /* Audit L12: Number("3A") este NaN, deci ordinea din PDF nu mai e cea de pe scara */
  it("[L12] apartamentul 3A apare intre 3 si 4", async () => {
    await pornesteApp({
      email: ADMIN,
      modifica: (d) => { d.apartamente.find((a) => a.numar === "20").numar = "3A"; },
    });
    const pdf = prindePdf();
    await apasa("Exporta lista PDF");
    const { text: t } = await pdf.ultimul();
    const i3 = t.indexOf("\n3\nFamilia Ilie");
    const i3a = t.indexOf("\n3A\nLavinia Costea");
    const i4 = t.indexOf("\n4\nRadu Pintea");
    expect(i3a).toBeGreaterThan(i3);
    expect(i3a).toBeLessThan(i4);
  });

  /* Audit L13: coloana Pers. e goala cand lista nu are nicio cheltuiala pe persoane */
  it.fails("[L13] coloana Pers. arata persoanele si fara metoda persoane", async () => {
    await pornesteApp({
      email: ADMIN,
      modifica: (d) => { d.cheltuieli.filter((c) => c.metoda === "persoane").forEach((c) => { c.metoda = "apartamente"; }); },
    });
    const pdf = prindePdf();
    await apasa("Exporta lista PDF");
    const { text: t } = await pdf.ultimul();
    expect(t).toContain("\n3\nFamilia Ilie\n4\n");
  });
});
