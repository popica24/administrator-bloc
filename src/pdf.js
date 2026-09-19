/* =============================================================================
   Generator PDF minimal
   -----------------------------------------------------------------------------
   JavaScript pur, fara librarii si fara DOM: primeste continutul si intoarce
   octetii unui PDF 1.4 cu fonturile standard Helvetica. Ajunge pentru ce are
   nevoie aplicatia: chitanta locatarului si lista de plata pentru avizier.
   Textele sunt fara diacritice, ca restul aplicatiei, deci codarea
   WinAnsi a fonturilor standard le acopera complet.
============================================================================= */

/* Latimile caracterelor Helvetica, in miimi din marimea fontului. Doar cele
   de care avem nevoie ca sa aliniem cifrele la dreapta; restul primesc o
   latime medie. */
const LATIMI = {
  " ": 278, ",": 278, ".": 278, "-": 333, ":": 278, "/": 278, "%": 889, "(": 333, ")": 333,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  i: 222, l: 222, j: 222, t: 278, f: 278, r: 333, m: 833, w: 722, I: 278, M: 833, W: 944,
};

export function latimeText(text, marime, bold = false) {
  let s = 0;
  for (const ch of String(text)) s += LATIMI[ch] || (ch >= "A" && ch <= "Z" ? 667 : 520);
  return (s / 1000) * marime * (bold ? 1.06 : 1);
}

const escape = (t) => String(t).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/* Rupe un cuvant mai lung decat randul in bucati care incap [F29] */
function rupeCuvant(cuvant, latime, marime, bold) {
  const bucati = [];
  let rest = cuvant;
  while (latimeText(rest, marime, bold) > latime && rest.length > 1) {
    let n = rest.length - 1;
    while (n > 1 && latimeText(rest.slice(0, n), marime, bold) > latime) n -= 1;
    bucati.push(rest.slice(0, n));
    rest = rest.slice(n);
  }
  bucati.push(rest);
  return bucati;
}

/* Taie un text lung in randuri care incap in latimea data */
export function imparteText(text, latime, marime, bold = false) {
  const cuvinte = String(text).split(/\s+/)
    .flatMap((c) => (latimeText(c, marime, bold) > latime ? rupeCuvant(c, latime, marime, bold) : [c]));
  const randuri = [];
  let curent = "";
  cuvinte.forEach((c) => {
    const incercare = curent ? `${curent} ${c}` : c;
    if (latimeText(incercare, marime, bold) > latime && curent) {
      randuri.push(curent);
      curent = c;
    } else {
      curent = incercare;
    }
  });
  if (curent) randuri.push(curent);
  return randuri;
}

/* Scurteaza un nume ca sa incapa intr-o coloana, taind la cuvant [F30] */
export function scurteazaNume(text, latime, marime) {
  const intreg = String(text);
  if (latimeText(intreg, marime) <= latime) return intreg;
  const cuvinte = intreg.split(/\s+/);
  while (cuvinte.length > 1) {
    cuvinte.pop();
    const scurt = `${cuvinte.join(" ")}.`;
    if (latimeText(scurt, marime) <= latime) return scurt;
  }
  let unul = cuvinte[0];
  while (unul.length > 1 && latimeText(`${unul}.`, marime) > latime) unul = unul.slice(0, -1);
  return `${unul}.`;
}

/* Scrie octetii fisierului din lista de pagini. Fiecare pagina este un sir
   de operatori PDF deja formati. */
function scriePdf(pagini, latimePagina, inaltimePagina, titlu) {
  const obiecte = [];
  const adauga = (continut) => { obiecte.push(continut); return obiecte.length; };

  adauga("<< /Type /Catalog /Pages 2 0 R >>");
  adauga("PAGINI");
  const f1 = adauga("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = adauga("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = adauga(`<< /Title (${escape(titlu)}) /Producer (AdminBloc) >>`);

  const kids = [];
  pagini.forEach((flux) => {
    const c = adauga(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`);
    const p = adauga(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${latimePagina} ${inaltimePagina}] ` +
      `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`
    );
    kids.push(`${p} 0 R`);
  });
  obiecte[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const pozitii = [];
  obiecte.forEach((o, i) => {
    pozitii.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${obiecte.length + 1}\n0000000000 65535 f \n`;
  pozitii.forEach((p) => { out += `${String(p).padStart(10, "0")} 00000 n \n`; });
  out += `trailer\n<< /Size ${obiecte.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/* Construieste un document din blocuri simple, cu trecere automata la pagina
   urmatoare. Blocuri:
     { tip: "titlu", text }            titlu mare
     { tip: "text", text, bold, marime, culoare }
     { tip: "rand", coloane: [{ text, latime, dreapta, bold }], marime, fond }
     { tip: "linie" }
     { tip: "spatiu", h } */
export function documentPdf({ titlu, blocuri, peLatime = false, subsol }) {
  const W = peLatime ? 842 : 595;
  const H = peLatime ? 595 : 842;
  const M = 40;
  const pagini = [];
  let flux = [];
  let y = H - M;

  const paginaNoua = () => {
    if (subsol) {
      flux.push(`BT /F1 7 Tf 0.45 g ${M} 22 Td (${escape(`${subsol}  |  pagina ${pagini.length + 1}`)}) Tj ET 0 g`);
    }
    pagini.push(flux.join("\n"));
    flux = [];
    y = H - M;
  };
  const text = (t, x, yy, marime, bold, gri) => {
    flux.push(`BT /${bold ? "F2" : "F1"} ${marime} Tf ${gri ? "0.4 g " : ""}${x.toFixed(2)} ${yy.toFixed(2)} Td (${escape(t)}) Tj ET${gri ? " 0 g" : ""}`);
  };

  /* Antetul de tabel marcat cu `repeta` se redeseneaza pe fiecare pagina noua,
     altfel pagina a doua este o insiruire de cifre fara titluri [F27]. */
  let antet = null;
  const inaltimeRand = (b) => (b.marime || 9) * 1.7;
  const scrieRand = (b) => {
    const marime = b.marime || 9;
    const h = inaltimeRand(b);
    if (b.fond) flux.push(`0.93 g ${M} ${(y - h + 2).toFixed(2)} ${W - 2 * M} ${h.toFixed(2)} re f 0 g`);
    let x = M;
    b.coloane.forEach((c) => {
      const t = String(c.text ?? "");
      const w = c.latime;
      const tx = c.dreapta ? x + w - 3 - latimeText(t, marime, c.bold || b.bold) : x + 2;
      text(t, tx, y - marime - 2, marime, c.bold || b.bold, c.gri);
      x += w;
    });
    y -= h;
  };
  const asiguraSpatiu = (h) => {
    if (y - h >= M + 10) return;
    paginaNoua();
    if (antet) scrieRand(antet);
  };

  blocuri.forEach((b) => {
    if (b.tip === "titlu") {
      asiguraSpatiu(26);
      text(b.text, M, y - 16, 16, true);
      y -= 26;
    } else if (b.tip === "text") {
      const marime = b.marime || 10;
      imparteText(b.text, W - 2 * M, marime, b.bold).forEach((r) => {
        asiguraSpatiu(marime * 1.45);
        text(r, M, y - marime, marime, b.bold, b.gri);
        y -= marime * 1.45;
      });
    } else if (b.tip === "rand") {
      asiguraSpatiu(inaltimeRand(b));
      scrieRand(b);
      if (b.repeta) antet = b;
    } else if (b.tip === "linie") {
      asiguraSpatiu(6);
      flux.push(`0.6 G 0.5 w ${M} ${(y - 3).toFixed(2)} m ${W - M} ${(y - 3).toFixed(2)} l S 0 G`);
      y -= 6;
    } else if (b.tip === "spatiu") {
      y -= b.h || 10;
    }
  });
  paginaNoua();
  return scriePdf(pagini, W, H, titlu);
}
