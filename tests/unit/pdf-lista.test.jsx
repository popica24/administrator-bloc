/* [F26-F30] Lista de la avizier: coloanele se calculeaza din latimea paginii,
   antetul se repeta pe fiecare pagina, corpul tabelului este lizibil de pe
   perete, cuvintele lungi se rup si numele se scurteaza la cuvant. */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, ADMIN } from "./ajutor.jsx";
import { apasa, prindePdf, citesteBlob, tab } from "./ui-baza-ajutor.jsx";
import { latimeText, imparteText, scurteazaNume } from "../../src/pdf.js";

const LATIME_PAGINA = 842;
const MARGINE = 40;

/* Fiecare text scris in PDF, cu pozitia, marimea si pagina lui */
function textePdf(bytes) {
  const s = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const fluxuri = [...s.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => m[1]);
  return fluxuri.map((flux) => [...flux.matchAll(/BT \/(F\d) ([\d.]+) Tf (?:[\d.]+ g )?([\d.]+) ([\d.]+) Td \(((?:\\.|[^\\)])*)\) Tj/g)]
    .map((m) => ({
      bold: m[1] === "F2", marime: Number(m[2]), x: Number(m[3]), y: Number(m[4]),
      text: m[5].replace(/\\([\\()])/g, "$1"),
    })));
}

/* Exporta lista de plata a lunii curente, cu cate cheltuieli cere testul */
async function listaPdf(numarCheltuieli, proprietar) {
  await pornesteApp({
    email: ADMIN,
    modifica: (d) => {
      if (proprietar) d.apartamente[0].proprietar = proprietar;
      const lista = d.liste.find((l) => l.stare === "publicata");
      const model = d.cheltuieli.find((c) => c.listaId === lista.id);
      for (let i = d.cheltuieli.filter((c) => c.listaId === lista.id).length; i < numarCheltuieli; i += 1) {
        d.cheltuieli.push({ ...model, id: `che-plus-${i}`, cod: `C${20 + i}`, categorie: `Cheltuiala ${i}`, suma: 1234.56 });
      }
    },
  });
  const pdf = prindePdf();
  await apasa("Exportă lista PDF");
  const { blob } = pdf.descarcate[pdf.descarcate.length - 1];
  return textePdf(await citesteBlob(blob));
}

/* Exporta PDF-ul de avizier al listei publicate pe august, cu cate
   cheltuieli cere testul (aceeasi lista, alt buton, alta latime pe grup) */
async function listaPdfAvizier(numarCheltuieli) {
  await pornesteApp({
    email: ADMIN,
    modifica: (d) => {
      const lista = d.liste.find((l) => l.stare === "publicata");
      const model = d.cheltuieli.find((c) => c.listaId === lista.id);
      for (let i = d.cheltuieli.filter((c) => c.listaId === lista.id).length; i < numarCheltuieli; i += 1) {
        d.cheltuieli.push({ ...model, id: `che-plus-av-${i}`, cod: `C${20 + i}`, categorie: `Cheltuiala ${i}`, suma: 1234.56 });
      }
    },
  });
  await tab("Facturi");
  await apasa(screen.getByText("aug 26"));
  const pdf = prindePdf();
  await apasa("Exportă PDF pentru avizier");
  const { blob } = pdf.descarcate[pdf.descarcate.length - 1];
  return textePdf(await citesteBlob(blob));
}

/* [G9] Cand o felie normala goleste exact ce mai ramane, grupeazaCheltuieliPdf
   adauga un grup final gol: antetul sare direct de la ultima coloana de
   identitate ("Pers." sau "Ap.") la "Total luna", fara nicio coloana de
   cheltuiala intre ele - o pagina in plus, cu un rand pe apartament si un
   TOTAL, dar nicio cheltuiala. Textul e citit in ordinea din PDF (nu pe
   pagini: un grup poate incepe si continua pe aceeasi pagina cu precedentul). */
function textOrdonat(pagini) {
  return pagini.flat().map((t) => t.text).join("\n");
}

describe("[G9] ultimul grup de coloane nu ramane niciodata gol", () => {
  it.each([10, 11, 12, 13, 23, 24, 25, 26])("uz intern, cu %i cheltuieli", async (n) => {
    const text = textOrdonat(await listaPdf(n));
    expect(text).not.toContain("Pers.\nTotal luna");
  });

  it("avizier, cu 16 cheltuieli", async () => {
    const text = textOrdonat(await listaPdfAvizier(16));
    expect(text).not.toContain("Ap.\nTotal luna");
  });
});

describe("[F26] coloanele se calculeaza din latimea paginii", () => {
  it.each([8, 14, 24])("cu %i cheltuieli nimic nu iese din pagina", async (n) => {
    const pagini = await listaPdf(n);
    const iesite = pagini.flat().filter((t) => t.x + latimeText(t.text, t.marime, t.bold) > LATIME_PAGINA - MARGINE + 0.5);
    expect(iesite.map((t) => t.text)).toEqual([]);
    expect(pagini.flat().every((t) => t.x >= MARGINE - 0.5)).toBe(true);
  });
});

describe("[F27] antetul de coloane se repeta pe fiecare pagina", () => {
  it("pagina a doua nu este o insiruire de cifre fara titluri", async () => {
    const pagini = await listaPdf(24);
    expect(pagini.length).toBeGreaterThan(1);
    /* [C13] Cu multe cheltuieli, tabelul se imparte in grupuri de coloane;
       fiecare pagina apartine unui grup si repeta identitatea (Proprietar),
       dar "Total luna" apare doar in paginile ultimului grup. */
    pagini.forEach((pagina) => {
      const titluri = pagina.map((t) => t.text);
      expect(titluri).toContain("Proprietar");
    });
    expect(pagini.flat().map((t) => t.text)).toContain("Total luna");
  });
});

describe("[F28] corpul tabelului se citeste de pe perete", () => {
  it("randurile sunt scrise cu cel putin 9 puncte", async () => {
    const pagini = await listaPdf(8);
    const randuriTabel = pagini.flat().filter((t) => /^\d{1,3}(\.\d{3})*,\d{2}$/.test(t.text));
    expect(randuriTabel.length).toBeGreaterThan(10);
    expect(Math.min(...randuriTabel.map((t) => t.marime))).toBeGreaterThanOrEqual(9);
  });
});

describe("[F29] un cuvant mai lung decat coloana se rupe", () => {
  it("bucatile rezultate incap fiecare in latimea data", () => {
    const bucati = imparteText("Supercalifragilisticexpialidocious", 40, 10);
    expect(bucati.length).toBeGreaterThan(1);
    bucati.forEach((b) => expect(latimeText(b, 10)).toBeLessThanOrEqual(40));
    expect(bucati.join("")).toBe("Supercalifragilisticexpialidocious");
  });

  it("cuvintele scurte raman intregi", () => {
    expect(imparteText("unu doi trei", 1000, 10)).toEqual(["unu doi trei"]);
  });
});

describe("[F30] numele se scurteaza la cuvant, nu la jumatatea lui", () => {
  it("taie ultimul cuvant si pune punct", () => {
    const l = latimeText("Familia Georgescu.", 9.5) + 1;
    expect(scurteazaNume("Familia Georgescu", l, 9.5)).toBe("Familia Georgescu");
    expect(scurteazaNume("Familia Georgescu Popescu", l, 9.5)).toBe("Familia Georgescu.");
  });

  it("un singur cuvant prea lung se taie pe litere", () => {
    const scurt = scurteazaNume("Constantinescu", latimeText("Constan", 9.5), 9.5);
    expect(scurt.endsWith(".")).toBe(true);
    expect(latimeText(scurt, 9.5)).toBeLessThanOrEqual(latimeText("Constan", 9.5));
  });

  it("numele din PDF nu este taiat in mijlocul unui cuvant", async () => {
    const nume = "Alexandru Constantinescu Popa";
    const pagini = await listaPdf(24, nume);
    const scrise = pagini.flat().map((t) => t.text).filter((t) => t.startsWith("Alexandru"));
    expect(scrise.length).toBeGreaterThan(0);
    scrise.forEach((t) => {
      expect(t === nume || nume.startsWith(`${t.replace(/\.$/, "")} `)).toBe(true);
    });
  });
});

/* Randul unui apartament din tabel: doar pagina cu antetul "De plata" are
   coloanele financiare (grupul final, [C13]); randul e citit de la stanga
   la dreapta dupa pozitia x, ca ultima celula sa fie mereu "De plata". */
function randulApartamentului(pagini, apNumar) {
  for (const pagina of pagini) {
    if (!pagina.some((t) => t.text === "De plata")) continue;
    const cel = pagina.find((t) => t.text === apNumar);
    if (cel) return pagina.filter((t) => Math.abs(t.y - cel.y) < 0.3).sort((a, b) => a.x - b.x);
  }
  throw new Error(`Randul apartamentului ${apNumar} nu a fost gasit in pagina cu "De plata"`);
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* Formateaza ca in AdminBloc.jsx (lei(n, false)): "1.234,56", fara unitate */
function feiTest(n) {
  const neg = n < 0;
  const v = Math.abs(round2(n)).toFixed(2);
  const [int, dec] = v.split(".");
  return `${neg ? "-" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

/* Exporta lista interna a lunii curente dupa ce primul apartament a primit o
   corectie de recalculare: suma facturata (repartizarile curente) devine
   `sumaVeche * factor`, in loc de `sumaVeche` inghetata pe datoria de
   intretinere, fara nicio alta datorie si fara nicio plata. */
async function listaCuCorectie(factor) {
  let apNumar;
  let totalNou;
  await pornesteApp({
    email: ADMIN,
    modifica: (d) => {
      const lista = d.liste.find((l) => l.stare === "publicata");
      /* Ap. 17 (Elena): lista pe august neplatita, fara nicio alocare pe
         datoria de intretinere - deci nicio plata reala care sa se
         amestece cu corectia injectata mai jos. */
      const ap = d.apartamente.find((a) => a.numar === "17");
      apNumar = ap.numar;
      const dat = d.datorii.find((x) => x.listaId === lista.id && x.apartamentId === ap.id && x.tip === "intretinere");
      const sumaVeche = dat.suma;
      totalNou = round2(sumaVeche * factor);
      d.repartizari.filter((r) => r.apartamentId === ap.id && r.listaId === lista.id).forEach((r, i) => { r.suma = i === 0 ? totalNou : 0; });
      const corectie = round2(totalNou - sumaVeche);
      dat.rest = corectie < 0 ? round2(sumaVeche + corectie) : sumaVeche;
      d.datorii = d.datorii.filter((x) => x.apartamentId !== ap.id || x.id === dat.id);
      d.datorii.push({
        id: "dat-pdf-corectie", apartamentId: ap.id, listaId: lista.id, luna: lista.luna, tip: "corectie",
        suma: corectie, rest: corectie > 0 ? corectie : 0,
        scadenta: lista.scadenta, creatLa: "2026-08-21T10:00:00+03:00", documentId: null, descriere: "Corectie dupa recalcularea listei",
      });
    },
  });
  const pdf = prindePdf();
  await apasa("Exportă lista PDF");
  const { blob } = pdf.descarcate[pdf.descarcate.length - 1];
  const pagini = textePdf(await citesteBlob(blob));
  return { rand: randulApartamentului(pagini, apNumar), totalNou };
}

/* Audit K5: coloana "De plata" folosea suma - rest, care numara o corectie
   negativa de recalculare drept plata (F2 o scade direct din restul datoriei
   de intretinere, fara nicio plata noua). */
describe("[K5] coloana De plata dupa o recalculare", () => {
  it("recalculare in minus, fara nicio plata: De plata este totalul curent, nu suma - rest", async () => {
    const { rand, totalNou } = await listaCuCorectie(0.6);
    expect(rand[rand.length - 1].text).toBe(feiTest(totalNou));
  });

  it("recalculare in plus, fara nicio plata: De plata este totalul curent, nu de doua ori corectia", async () => {
    const { rand, totalNou } = await listaCuCorectie(1.4);
    expect(rand[rand.length - 1].text).toBe(feiTest(totalNou));
  });
});
