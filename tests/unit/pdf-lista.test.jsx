/* [F26-F30] Lista de la avizier: coloanele se calculeaza din latimea paginii,
   antetul se repeta pe fiecare pagina, corpul tabelului este lizibil de pe
   perete, cuvintele lungi se rup si numele se scurteaza la cuvant. */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, ADMIN } from "./ajutor.jsx";
import { apasa, prindePdf, citesteBlob } from "./ui-baza-ajutor.jsx";
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
  await apasa("Exporta lista PDF");
  const { blob } = pdf.descarcate[pdf.descarcate.length - 1];
  return textePdf(await citesteBlob(blob));
}

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
