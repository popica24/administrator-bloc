/* Generatorul PDF: structura fisierului (antet, obiecte, xref, trailer),
   textul scris, orientarea, paginarea si masurarea textului. */
import { describe, it, expect } from "vitest";
import { documentPdf, imparteText, latimeText } from "../../src/pdf.js";

const text = (bytes) => String.fromCharCode(...bytes);
const numarPagini = (s) => Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)[1]);
const fluxuri = (s) => [...s.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => m[1]);

describe("latimeText", () => {
  it("foloseste latimile Helvetica pentru cifre, litere mari si restul", () => {
    expect(latimeText("0", 10)).toBeCloseTo(5.56);
    expect(latimeText("A", 10)).toBeCloseTo(6.67);
    expect(latimeText("a", 10)).toBeCloseTo(5.2);
    expect(latimeText("il", 1000)).toBe(444);
    expect(latimeText("W M%", 1000)).toBe(944 + 278 + 833 + 889);
  });

  it("boldul este cu 6% mai lat, iar numerele se masoara ca text", () => {
    expect(latimeText("12", 10, true)).toBeCloseTo(11.12 * 1.06);
    expect(latimeText(12.5, 1000)).toBe(556 * 3 + 278);
    expect(latimeText("", 10)).toBe(0);
  });
});

describe("imparteText", () => {
  it("taie la cuvinte cand randul depaseste latimea", () => {
    const randuri = imparteText("unu doi trei patru cinci", latimeText("unu doi trei", 10) + 0.01, 10);
    expect(randuri).toEqual(["unu doi trei", "patru cinci"]);
  });

  /* [F29] Un cuvant mai lung decat randul se rupe, ca sa nu iasa din pagina */
  it("un cuvant mai lung decat randul se rupe in bucati care incap", () => {
    const randuri = imparteText("a Supercalifragilistic b", 20, 10);
    expect(randuri.join(" ").replace(/\s+/g, "")).toBe("aSupercalifragilisticb");
    randuri.forEach((r) => expect(latimeText(r, 10)).toBeLessThanOrEqual(20));
  });

  it("strange spatiile multiple si tine cont de bold", () => {
    expect(imparteText("x   y", 1000, 10)).toEqual(["x y"]);
    const w = latimeText("ab cd", 10) + 0.1;
    expect(imparteText("ab cd", w, 10)).toEqual(["ab cd"]);
    expect(imparteText("ab cd", w, 10, true)).toEqual(["ab", "cd"]);
  });

  it("textul gol nu produce niciun rand", () => {
    expect(imparteText("", 100, 10)).toEqual([]);
  });
});

describe("documentPdf: structura", () => {
  const bytes = documentPdf({ titlu: "Chitanța (AP118) nr. 417", blocuri: [{ tip: "titlu", text: "Chitanta" }] });
  const s = text(bytes);

  it("intoarce octeti cu antet PDF 1.4 si sfarsit %%EOF", () => {
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(s.startsWith("%PDF-1.4\n")).toBe(true);
    expect(s.endsWith("%%EOF")).toBe(true);
  });

  it("tabela xref indica exact inceputul fiecarui obiect", () => {
    const xref = Number(/startxref\n(\d+)\n%%EOF$/.exec(s)[1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const [, n] = /xref\n0 (\d+)\n/.exec(s.slice(xref)).map(Number);
    const intrari = s.slice(xref).split("\n").slice(3, 3 + n - 1);
    expect(intrari).toHaveLength(n - 1);
    intrari.forEach((rand, i) => {
      const poz = Number(rand.slice(0, 10));
      expect(s.slice(poz, poz + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(s).toContain(`trailer\n<< /Size ${n} /Root 1 0 R /Info 5 0 R >>`);
  });

  it("are catalogul, cele doua fonturi si titlul in Info, cu parantezele scapate", () => {
    expect(s).toContain("<< /Type /Catalog /Pages 2 0 R >>");
    expect(s).toContain("/BaseFont /Helvetica /Encoding /WinAnsiEncoding");
    expect(s).toContain("/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding");
    expect(s).toContain("/Title (Chitanta \\(AP118\\) nr. 417) /Producer (AdminBloc)");
  });

  it("lungimea fiecarui flux este cea declarata", () => {
    const m = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(s);
    expect(Number(m[1])).toBe(m[2].length);
  });

  it("implicit pagina este A4 in picioare, cu o singura pagina", () => {
    expect(s).toContain("/MediaBox [0 0 595 842]");
    expect(numarPagini(s)).toBe(1);
  });

  it("peLatime intoarce pagina", () => {
    const l = text(documentPdf({ titlu: "Lista", peLatime: true, blocuri: [] }));
    expect(l).toContain("/MediaBox [0 0 842 595]");
  });
});

describe("documentPdf: blocurile", () => {
  it("titlu, text normal, bold, gri si marime proprie", () => {
    const s = text(documentPdf({
      titlu: "t",
      blocuri: [
        { tip: "titlu", text: "Titlu mare" },
        { tip: "text", text: "Text simplu" },
        { tip: "text", text: "Text bold", bold: true, marime: 12 },
        { tip: "text", text: "Nota (gri) \\ cale", gri: true },
      ],
    }));
    expect(s).toContain("BT /F2 16 Tf 40.00 786.00 Td (Titlu mare) Tj ET");
    expect(s).toContain("BT /F1 10 Tf 40.00 766.00 Td (Text simplu) Tj ET");
    expect(s).toContain("BT /F2 12 Tf 40.00 749.50 Td (Text bold) Tj ET");
    expect(s).toContain("BT /F1 10 Tf 0.4 g 40.00 734.10 Td (Nota \\(gri\\) \\\\ cale) Tj ET 0 g");
  });

  it("randurile de tabel: coloane la stanga si la dreapta, fond, bold pe rand sau pe coloana, gri", () => {
    const s = text(documentPdf({
      titlu: "t",
      blocuri: [
        { tip: "rand", fond: true, bold: true, coloane: [{ text: "Ap.", latime: 50 }, { text: "Suma", latime: 100, dreapta: true }] },
        { tip: "rand", marime: 10, coloane: [{ text: 17, latime: 50, gri: true }, { text: null, latime: 60 }, { text: "12,50", latime: 100, dreapta: true, bold: true }] },
      ],
    }));
    /* fond: dreptunghi gri pe toata latimea */
    expect(s).toContain("0.93 g 40 788.70 515 15.30 re f 0 g");
    expect(s).toContain("BT /F2 9 Tf 42.00 791.00 Td (Ap.) Tj ET");
    const xSuma = 40 + 50 + 100 - 3 - latimeText("Suma", 9, true);
    expect(s).toContain(`BT /F2 9 Tf ${xSuma.toFixed(2)} 791.00 Td (Suma) Tj ET`);
    expect(s).toContain("BT /F1 10 Tf 0.4 g 42.00 774.70 Td (17) Tj ET 0 g");
    expect(s).toContain("BT /F1 10 Tf 92.00 774.70 Td () Tj ET");
    const x2 = 40 + 50 + 60 + 100 - 3 - latimeText("12,50", 10, true);
    expect(s).toContain(`BT /F2 10 Tf ${x2.toFixed(2)} 774.70 Td (12,50) Tj ET`);
    expect(s.match(/re f/g)).toHaveLength(1);
  });

  it("linia si spatiul muta pozitia; un bloc necunoscut este ignorat", () => {
    const s = text(documentPdf({
      titlu: "t",
      blocuri: [
        { tip: "linie" },
        { tip: "spatiu", h: 20 },
        { tip: "spatiu" },
        { tip: "imagine" },
        { tip: "text", text: "dupa" },
      ],
    }));
    expect(s).toContain("0.6 G 0.5 w 40 799.00 m 555 799.00 l S 0 G");
    /* 802 - 6 (linie) - 20 - 10 (spatiu implicit) - 10 (marimea textului) */
    expect(s).toContain("Td (dupa) Tj");
    expect(s).toContain("40.00 756.00 Td (dupa)");
  });

  it("fara subsol nu scrie numarul paginii", () => {
    const s = text(documentPdf({ titlu: "t", blocuri: [{ tip: "text", text: "x" }] }));
    expect(s).not.toContain("pagina");
  });
});

describe("documentPdf: paginarea", () => {
  it("un tabel lung trece pe pagini noi, fiecare cu subsolul si numarul ei", () => {
    const blocuri = Array.from({ length: 120 }, (_, i) => ({ tip: "rand", coloane: [{ text: `Ap. ${i + 1}`, latime: 100 }] }));
    const s = text(documentPdf({ titlu: "Lista", subsol: "Bloc D14", blocuri }));
    const n = numarPagini(s);
    /* 842 - 80 - 10 de spatiu util, 15,3 pe rand: 49 de randuri pe pagina */
    expect(n).toBe(3);
    const f = fluxuri(s);
    expect(f).toHaveLength(3);
    f.forEach((flux, i) => expect(flux).toContain(`(Bloc D14  |  pagina ${i + 1}) Tj ET 0 g`));
    expect(f[0]).toContain("(Ap. 49)");
    expect(f[0]).not.toContain("(Ap. 50)");
    expect(f[1]).toContain("(Ap. 50)");
    expect(f[2]).toContain("(Ap. 120)");
    expect(s.match(/\/Type \/Page \//g)).toHaveLength(3);
  });

  it("titlul, textul lung si linia trec si ele pe pagina urmatoare cand nu mai incap", () => {
    const umplutura = { tip: "spatiu", h: 740 };
    const s = text(documentPdf({
      titlu: "t",
      blocuri: [
        umplutura, { tip: "titlu", text: "T2" },
        umplutura, { tip: "linie" },
        umplutura, { tip: "text", text: "cuvant ".repeat(40) },
      ],
    }));
    const f = fluxuri(s);
    expect(f).toHaveLength(4);
    expect(f[0]).toBe("");
    expect(f[1]).toContain("(T2)");
    expect(f[2]).toContain("l S 0 G");
    expect(f[3]).toContain("(cuvant cuvant");
  });

  it("un paragraf lung se imparte in mai multe randuri de text", () => {
    const s = text(documentPdf({ titlu: "t", blocuri: [{ tip: "text", text: "cuvant ".repeat(200) }] }));
    expect(s.match(/Td \(cuvant/g).length).toBeGreaterThan(5);
  });

  it("[F9] diacriticele din nume se transliteraza, nu se strica", () => {
    const s = text(documentPdf({ titlu: "t", blocuri: [{ tip: "text", text: "Știrbu Țăranu" }] }));
    expect(s).toContain("(Stirbu Taranu)");
  });

  /* [J3] escape() rula pe sirul JS, dar octetii se trunchiaza mai departe
     (charCodeAt & 0xff): un caracter din afara Latin-1 care nu e o
     diacritica romaneasca (deci transliteraza() nu il atinge) putea cadea,
     dupa trunchiere, exact pe octetul '(' (0x28) -- de exemplu Ĩ (U+0128,
     128 & 0xff = 0x28) -- si strica sirul PDF delimitat de paranteze fara
     ca escape() sa fi vazut vreodata o paranteza in sirul original.
     J3 refuza fisierul in loc sa-l scrie stricat. */
  /* [K10] Dar refuzul lui J3 arunca dintr-un onPress, unde nimic nu-l prinde
     (o error boundary nu prinde handlerele de eveniment): butonul nu facea
     nimic si mesajul scris cu grija nu se vedea niciodata. "Kovács Győző"
     (ő = U+0151) il declansa. O chitanta nu are voie sa devina imposibila de
     descarcat din cauza unui nume, deci litera se transliterareaza acum mai
     departe, dupa normalizare Unicode (litera de baza fara semnul
     diacritic), iar daca tot nu incape intr-un octet (alt alfabet, un
     emoji), primeste un inlocuitor nevinovat, "?", in loc sa opreasca tot
     documentul; fara aceasta transliterare suplimentara, octetul trunchiat
     tot ar putea sa strice sirul PDF, ca in J3. */
  it("[K10] o litera din afara diacriticelor romanesti stiute se transliterareaza, nu se refuza", () => {
    const s = text(documentPdf({ titlu: "t", blocuri: [{ tip: "text", text: "Kovács Győző" }] }));
    expect(s).toContain("(Kovacs Gyozo)");
    expect(() => documentPdf({ titlu: "t", blocuri: [{ tip: "text", text: "Kovács Győző" }] })).not.toThrow();
  });

  it("[K10] Ĩ (fara decompunere in litere romanesti) se transliterareaza in I, fara sa strice sirul PDF", () => {
    const s = text(documentPdf({ titlu: "t", blocuri: [{ tip: "text", text: "CategorieĨ" }] }));
    expect(s).toContain("(CategorieI)");
  });

  it("[K10] un caracter fara nicio transliterare (alt alfabet, un emoji) primeste un inlocuitor, nu opreste documentul", () => {
    const s = text(documentPdf({ titlu: "t", blocuri: [{ tip: "text", text: "Un emoji 😀" }] }));
    expect(s).toContain("(Un emoji ?)");
  });

  it("textul din Latin-1 (chiar in afara diacriticelor romanesti stiute) se scrie normal", () => {
    const s = text(documentPdf({ titlu: "t", blocuri: [{ tip: "text", text: "Straße" }] }));
    expect(s).toContain("Stra");
  });
});
