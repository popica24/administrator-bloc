/* Derivarile din sectiunea 4 vazute de locatar: defalcare, sold, datoriile
   sortate, istoricLunar, frazaComparatie, descriereAlocari si chitantaPdf.
   Apartamentul 17 (Elena): lista pe august 718,09 lei, neplatita, iunie si
   iulie platite cu cardul. */
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, zonaCu, LOCATAR } from "./ajutor.jsx";
import { tab, apasa, prindePdf } from "./ui-baza-ajutor.jsx";

const AP = "apa-35";
const AUG = "lis-807";
const IUL = "lis-512";

async function plata(modifica) {
  const r = await pornesteApp({ email: LOCATAR, modifica });
  await tab("Plata");
  return r;
}

const calcul = (st) => zonaCu(st, 1).parentElement.textContent;

const datorie = (x) => ({ apartamentId: AP, luna: null, listaId: null, documentId: null, creatLa: "2026-06-01T10:00:00+03:00", ...x });

/* O plata reala, cu alocarile ei, ca sa nu se mai deduca "platit" din
   suma - rest (K5): singura sursa de adevar pentru ce s-a incasat este
   suma alocarilor din registru. */
const plataReala = (id, suma, alocari) => ({
  id, apartamentId: AP, suma, metoda: "card", stare: "confirmata", referinta: `SIM-${id}`,
  inregistrataDe: null, confirmataLa: "2026-08-20T10:00:00+03:00", chitanta: null, alocari,
});

describe("defalcare pe lista curenta", () => {
  it("totalul listei curente este exact soldul, fara datorii vechi", async () => {
    await plata();
    expect(screen.getByText("Total de plata acum")).toBeTruthy();
    expect(calcul("1. Cheltuielile lunii august")).toBe("1. Cheltuielile lunii august644,01 lei");
    expect(calcul("2. Fonduri")).toBe("2. Fonduri74,08 lei");
    expect(calcul("3. Datorii din lunile trecute")).toBe("3. Datorii din lunile trecute0,00 lei");
    expect(calcul("Total de plata")).toBe("Total de plata718,09 lei");
    expect(screen.queryByText("Platit deja din lista lunii")).toBeNull();
    expect(screen.getByText("Nu ai datorii din lunile trecute.")).toBeTruthy();
    /* grupele: apa, bloc, administrare; fara "Alte cheltuieli" */
    expect(screen.getByText("Apa")).toBeTruthy();
    expect(screen.getByText("Curent, lift si curatenie")).toBeTruthy();
    expect(screen.getByText("Administrarea blocului")).toBeTruthy();
    expect(screen.queryByText("Alte cheltuieli")).toBeNull();
    expect(screen.getByRole("button", { name: "Plateste 718,09 lei cu cardul" })).toBeTruthy();
  });

  it("scade ce s-a platit deja din lista, dupa alocarile reale, si pune codurile necunoscute la Alte cheltuieli", async () => {
    await plata((d) => {
      d.plati.push(plataReala("pla-400", 400, [{ datorieId: "dat-1021", suma: 400 }]));
      d.datorii.find((x) => x.id === "dat-1021").rest = 318.09;
      d.cheltuieli.push({ id: "che-x", listaId: AUG, cod: "C10", tip: "factura", categorie: "Verificare hidranti", furnizor: "ISU Service", serie: "H-1", suma: 200, metoda: "apartamente", tipApa: null, documentId: null });
      d.repartizari.push({ cheltuialaId: "che-x", listaId: AUG, apartamentId: AP, suma: 10, baza: { valoare: 1, total: 20, unitate: "apartamente" }, rotunjire: 0, detaliu: null });
    });
    expect(screen.getByText("Alte cheltuieli")).toBeTruthy();
    expect(calcul("1. Cheltuielile lunii august")).toContain("654,01 lei");
    expect(calcul("Platit deja din lista lunii")).toContain("-400,00 lei");
  });

  /* Audit K5 (si L4): platitDinLista = suma - rest presupune ca orice scadere
     a restului e o plata. O recalculare o contrazice in ambele sensuri:
     in minus, corectia scade direct restul datoriei initiale (F2) fara nicio
     plata noua, deci apare o "plata" fantoma; in plus, corectia ramane o
     datorie deschisa separata, insa cheltuielile lunii (randul 1) deja arata
     suma noua, deci datoria de corectie o numara a doua oara. In ambele
     cazuri randurile afisate trebuie sa se adune exact la total (soldul). */
  describe("[K5] recalcularea listei curente", () => {
    it("fara nicio recalculare, randurile se aduna la total", async () => {
      await plata();
      expect(calcul("1. Cheltuielile lunii august")).toBe("1. Cheltuielile lunii august644,01 lei");
      expect(calcul("2. Fonduri")).toBe("2. Fonduri74,08 lei");
      expect(calcul("3. Datorii din lunile trecute")).toBe("3. Datorii din lunile trecute0,00 lei");
      expect(calcul("Total de plata")).toBe("Total de plata718,09 lei");
      expect(screen.queryByText(/Corectie dupa recalculare/)).toBeNull();
    });

    it("recalculare in minus: corectia scade direct restul, fara nicio plata fantoma", async () => {
      await plata((d) => {
        /* cheltuielile lunii scad la 600 lei (de la 718,09); corectia de
           -118,09 e o datorie sora, cu propriul rest fortat la 0 (F2), care
           scade direct restul datoriei de intretinere initiale */
        d.repartizari.filter((r) => r.apartamentId === AP && r.listaId === AUG).forEach((r, i) => { r.suma = i === 0 ? 600 : 0; });
        d.datorii.find((x) => x.id === "dat-1021").rest = 600;
        d.datorii.push(datorie({
          id: "dat-corectie-minus", listaId: AUG, luna: "2026-08", tip: "corectie", suma: -118.09, rest: 0,
          scadenta: "2026-09-25", creatLa: "2026-08-21T10:00:00+03:00", descriere: "Corectie dupa recalcularea listei",
        }));
      });
      expect(screen.queryByText("Platit deja din lista lunii")).toBeNull();
      expect(screen.getByText(/Corectie dupa recalculare/)).toBeTruthy();
      expect(calcul(/Corectie dupa recalculare/)).toContain("-118,09 lei");
      expect(calcul("3. Datorii din lunile trecute")).toBe("3. Datorii din lunile trecute0,00 lei");
      expect(calcul("Total de plata")).toBe("Total de plata600,00 lei");
      expect(screen.getByRole("button", { name: "Plateste 600,00 lei cu cardul" })).toBeTruthy();
    });

    it("recalculare in plus: corectia nu se mai numara de doua ori", async () => {
      await plata((d) => {
        /* cheltuielile lunii cresc la 900 lei (de la 718,09); corectia de
           +181,91 ramane o datorie deschisa separata, neplatita */
        d.repartizari.filter((r) => r.apartamentId === AP && r.listaId === AUG).forEach((r, i) => { r.suma = i === 0 ? 900 : 0; });
        d.datorii.push(datorie({
          id: "dat-corectie-plus", listaId: AUG, luna: "2026-08", tip: "corectie", suma: 181.91, rest: 181.91,
          scadenta: "2026-09-25", creatLa: "2026-08-21T10:00:00+03:00", descriere: "Corectie dupa recalcularea listei",
        }));
      });
      expect(screen.queryByText("Platit deja din lista lunii")).toBeNull();
      expect(calcul(/Corectie dupa recalculare/)).toContain("181,91 lei");
      expect(calcul("3. Datorii din lunile trecute")).toBe("3. Datorii din lunile trecute0,00 lei");
      expect(calcul("Total de plata")).toBe("Total de plata900,00 lei");
      expect(screen.getByRole("button", { name: "Plateste 900,00 lei cu cardul" })).toBeTruthy();
    });
  });

  it("aduna restantele si penalizarile, cu zilele de intarziere si calculul penalizarii", async () => {
    await plata((d) => {
      d.datorii.find((x) => x.id === "dat-704").rest = 131.39;
      d.datorii.push(datorie({ id: "dat-p1", tip: "penalizare", luna: "2026-09", suma: 1.5, rest: 1.5, scadenta: "2026-09-01", descriere: "Penalizare pentru intretinere iulie 2026" }));
      d.datorii.push(datorie({ id: "dat-p2", tip: "penalizare", luna: "2026-09", suma: 0.5, rest: 0.5, scadenta: "2026-09-01", descriere: "Penalizare veche, fara calcul" }));
      d.datorii.push(datorie({ id: "dat-v", tip: "sold_initial", suma: 50, rest: 50, scadenta: "2026-09-19", descriere: "Restanta preluata azi" }));
      d.penalizari.push({ id: "pen-1", datorieId: "dat-p1", restNeachitat: 131.39, zileIntarziere: 38, zileGratie: 30, zileTaxate: 8, procentZi: 0.02, suma: 1.5 });
    });
    expect(calcul("3. Datorii din lunile trecute")).toContain("183,39 lei");
    expect(calcul("Total de plata")).toContain("901,48 lei");
    expect(screen.getByText("Intretinere iulie 2026, neplatita")).toBeTruthy();
    expect(screen.getByText("rest din 631,39 lei, scadenta 25 aug 2026, 25 de zile intarziere")).toBeTruthy();
    /* scadenta azi: 0 zile, fara "intarziere" */
    expect(screen.getByText("Restanta preluata azi")).toBeTruthy();
    expect(screen.getByText("scadenta 19 sep 2026")).toBeTruthy();
    const pen = screen.getAllByText("Penalizare calculata pe 1 septembrie 2026");
    expect(pen).toHaveLength(2);
    expect(screen.getByText("131,39 × 0,02% × 8 zile")).toBeTruthy();
    expect(screen.getByText(/Suma neplatita era 131,39 lei, cu 38 de zile de la scadenta; primele 30 de zile nu se penalizeaza/)).toBeTruthy();
    expect(screen.getByText("Penalizare veche, fara calcul")).toBeTruthy();
    expect(screen.getByText(/Penalizarea este de 0,02% pe zi din suma neplatita/)).toBeTruthy();
  });

  it("[H8] o corectie negativa (credit) scade soldul, nu doar datoriile pozitive", async () => {
    await plata((d) => {
      d.datorii.push(datorie({ id: "dat-credit", tip: "corectie", suma: -40, rest: -40, scadenta: "2026-08-25", descriere: "Corectie credit" }));
    });
    expect(calcul("Total de plata")).toBe("Total de plata678,09 lei");
    expect(screen.getByRole("button", { name: "Plateste 678,09 lei cu cardul" })).toBeTruthy();
  });

  it("datoriile cu aceeasi scadenta apar in ordinea in care s-au creat", async () => {
    await plata((d) => {
      d.datorii.push(datorie({ id: "dat-b", tip: "corectie", suma: 20, rest: 20, scadenta: "2026-06-25", descriere: "Corectie a doua", creatLa: "2026-06-20T10:00:00+03:00" }));
      d.datorii.push(datorie({ id: "dat-a", tip: "corectie", suma: 10, rest: 10, scadenta: "2026-06-25", descriere: "Corectie prima", creatLa: "2026-06-10T10:00:00+03:00" }));
      d.datorii.push(datorie({ id: "dat-c", tip: "corectie", suma: 5, rest: 5, scadenta: "2026-06-25", descriere: "Corectie a treia", creatLa: "2026-06-30T10:00:00+03:00" }));
    });
    const texte = screen.getAllByText(/^Corectie (prima|a doua|a treia)$/).map((x) => x.textContent);
    expect(texte).toEqual(["Corectie prima", "Corectie a doua", "Corectie a treia"]);
  });
});

describe("defalcare pe o lista trecuta", () => {
  it("lista platita: doar luna, fara datorii, cu insigna Achitata", async () => {
    await plata();
    await apasa("iul 26");
    expect(screen.getByText("Lista pe iulie 2026")).toBeTruthy();
    expect(screen.getByText("Achitata")).toBeTruthy();
    expect(calcul("Total lista")).toContain("631,39 lei");
    expect(screen.queryByText("3. Datorii din lunile trecute")).toBeNull();
    expect(screen.queryByRole("button", { name: /cu cardul/ })).toBeNull();
    expect(calcul(`Total repartizat pe cele 20 apartamente`)).toContain("11.219,10 lei");
    expect(calcul("Diferenta")).toContain("0,00 lei");
  });

  it("lista neplatita si lista fara datorie inregistrata", async () => {
    await plata((d) => {
      d.datorii.find((x) => x.id === "dat-704").rest = 5;
      d.datorii = d.datorii.filter((x) => x.id !== "dat-406");
    });
    await apasa("iul 26");
    expect(screen.getByText("Neachitata")).toBeTruthy();
    await apasa("iun 26");
    /* fara datorie pe lista: nu se poate spune ca e achitata */
    expect(screen.getByText("Neachitata")).toBeTruthy();
  });
});

describe("istoricul si fraza de comparatie", () => {
  it("august fata de iulie: mai mult", async () => {
    await plata();
    await apasa("Platile mele");
    expect(screen.getByText("Intretinerea pe august este 718,09 lei. Pe iulie a fost 631,39 lei, deci luna aceasta platesti cu 86,70 lei mai mult.")).toBeTruthy();
    const card = zonaCu(["Cat ai avut de plata", "iunie 2026"]);
    expect(card.textContent).toContain("august 2026718,09LEINeachitat");
    expect(card.textContent).toContain("iulie 2026631,39LEIAchitat");
    expect(card.textContent).toContain("iunie 2026655,45LEIAchitat");
  });

  it("mai putin si exact la fel", async () => {
    await plata((d) => {
      d.repartizari.filter((r) => r.apartamentId === AP && r.listaId === IUL).forEach((r) => { r.suma = 100; });
    });
    await apasa("Platile mele");
    expect(screen.getByText(/platesti cu 81,91 lei mai putin\.$/)).toBeTruthy();
  });

  it("exact la fel, iar o lista fara datorie apare achitata", async () => {
    await plata((d) => {
      d.repartizari.filter((r) => r.apartamentId === AP && r.listaId === AUG).forEach((r) => { r.suma = r.cheltuialaId === "che-808" ? 80 : 0; });
      d.repartizari.filter((r) => r.apartamentId === AP && r.listaId === IUL).forEach((r) => { r.suma = 10; });
      d.datorii = d.datorii.filter((x) => x.listaId !== AUG);
    });
    await apasa("Platile mele");
    expect(screen.getByText(/platesti exact la fel\.$/)).toBeTruthy();
    expect(screen.queryByText("Neachitat")).toBeNull();
  });

  it("cu o singura lista publicata nu exista comparatie", async () => {
    await plata((d) => { d.liste = d.liste.filter((l) => l.id === AUG); });
    await apasa("Platile mele");
    expect(screen.queryByText(/Intretinerea pe/)).toBeNull();
    expect(screen.getByText("Cat ai avut de plata")).toBeTruthy();
  });

  it("fara nicio lista publicata", async () => {
    await plata((d) => { d.liste = []; });
    expect(screen.getByText("Nicio lista publicata")).toBeTruthy();
  });
});

describe("descriereAlocari si chitanta", () => {
  const plataNoua = (x) => ({ apartamentId: AP, metoda: "card", stare: "confirmata", referinta: "SIM-1", inregistrataDe: null, confirmataLa: "2026-09-10T12:00:00+03:00", chitanta: { serie: "AP118", numar: 470, emisaLa: "2026-09-10T12:34:00+03:00" }, alocari: [], ...x });

  it("descrie fiecare tip de datorie acoperit, avansul si datoriile necunoscute", async () => {
    await plata((d) => {
      d.datorii.push(datorie({ id: "dat-pen", tip: "penalizare", luna: "2026-07", suma: 3, rest: 0, scadenta: "2026-07-01", descriere: "Penalizare" }));
      d.datorii.push(datorie({ id: "dat-si", tip: "sold_initial", luna: "2026-05", suma: 40, rest: 0, scadenta: "2026-05-25", descriere: "Restanta preluata de pe hartie" }));
      d.plati.push(plataNoua({ id: "pla-a", suma: 100, alocari: [{ datorieId: "dat-pen", suma: 3 }, { datorieId: "dat-si", suma: 40 }, { datorieId: "dat-lipsa", suma: 7 }] }));
      d.plati.push(plataNoua({ id: "pla-b", suma: 25, alocari: [], confirmataLa: "2026-09-11T12:00:00+03:00", chitanta: null, metoda: "transfer" }));
    });
    await apasa("Platile mele");
    expect(screen.getByText("Penalizare iulie 2026: 3,00 lei, Restanta preluata de pe hartie: 40,00 lei, Datorie: 7,00 lei, Avans: 50,00 lei")).toBeTruthy();
    expect(screen.getByText("Avans pentru listele urmatoare")).toBeTruthy();
    expect(screen.getByText("11 septembrie 2026, transfer")).toBeTruthy();
    expect(screen.getByText("Intretinere iulie 2026: 631,39 lei")).toBeTruthy();
    expect(screen.getByText("Chitanta AP118 nr. 000440")).toBeTruthy();
    /* plata fara chitanta nu are buton de descarcare: 3 chitante, nu 4 */
    expect(screen.getAllByRole("button", { name: "Descarca chitanta" })).toHaveLength(3);
  });

  it("chitanta cu cardul are antetul asociatiei, platitorul, alocarile si referinta", async () => {
    await plata((d) => { d.plati.find((p) => p.id === "pla-727").referinta = "SIM-204W0EKK"; });
    await apasa("Platile mele");
    const pdf = prindePdf();
    await apasa("Descarca chitanta", 0);
    const { nume, text } = await pdf.ultimul();
    expect(nume).toBe("chitanta-440.pdf");
    expect(text).toContain("Asociatia de proprietari nr. 118");
    expect(text).toContain("CUI 31245780 | Str. Nicolae Balcescu nr. 22, Pitesti");
    expect(text).toContain("IBAN RO49RNCB0082004512340001, BCR, sucursala Pitesti");
    expect(text).toContain("CHITANTA  AP118 nr. 000440");
    expect(text).toContain("Data: 12 august 2026, ora 21:03");
    expect(text).toContain("Am primit de la Elena Marinescu, apartamentul 17, Bloc D14, scara A,");
    expect(text).toContain("suma de 631,39 lei, reprezentand:");
    expect(text).toContain("- Intretinere iulie 2026: 631,39 lei");
    expect(text).toContain("Modalitate: plata cu cardul, referinta SIM-204W0EKK");
    expect(text).toContain("Document emis electronic prin AdminBloc.");
  });

  it("chitanta in numerar, prin transfer si cu cardul fara referinta", async () => {
    await plata((d) => {
      d.plati.length = 0;
      d.plati.push(plataNoua({ id: "p1", suma: 10, metoda: "numerar", inregistrataDe: "Mihai Dobre", chitanta: { serie: "AP118", numar: 1, emisaLa: "2026-09-10T08:05:00+03:00" }, confirmataLa: "2026-09-14T12:00:00+03:00" }));
      d.plati.push(plataNoua({ id: "p2", suma: 20, metoda: "numerar", chitanta: { serie: "AP118", numar: 2, emisaLa: "2026-09-10T08:05:00+03:00" }, confirmataLa: "2026-09-13T12:00:00+03:00" }));
      d.plati.push(plataNoua({ id: "p3", suma: 30, metoda: "transfer", chitanta: { serie: "AP118", numar: 3, emisaLa: "2026-09-10T08:05:00+03:00" }, confirmataLa: "2026-09-12T12:00:00+03:00" }));
      d.plati.push(plataNoua({ id: "p4", suma: 40, metoda: "card", referinta: null, chitanta: { serie: "AP118", numar: 4, emisaLa: "2026-09-10T08:05:00+03:00" }, confirmataLa: "2026-09-11T12:00:00+03:00" }));
    });
    await apasa("Platile mele");
    const pdf = prindePdf();
    const texte = [];
    for (let i = 0; i < 4; i++) {
      await apasa("Descarca chitanta", i);
      texte.push((await pdf.ultimul()).text);
    }
    expect(pdf.descarcate.map((x) => x.nume)).toEqual(["chitanta-1.pdf", "chitanta-2.pdf", "chitanta-3.pdf", "chitanta-4.pdf"]);
    expect(texte[0]).toContain("Modalitate: numerar, incasat de Mihai Dobre");
    expect(texte[0]).toContain("- Avans pentru listele urmatoare");
    expect(texte[1]).toMatch(/Modalitate: numerar\n/);
    expect(texte[2]).toContain("Modalitate: transfer bancar");
    expect(texte[3]).toContain("Modalitate: plata cu cardul, referinta -");
    expect(texte[3]).toMatch(/Am primit de la .+, apartamentul \d+, Bloc D14, scara A,/);
    expect(within(document.body).getByText("14 septembrie 2026, numerar")).toBeTruthy();
  });

  /* Audit F9: pdf.js pastreaza doar octetul de jos, deci diacriticele devin alte litere */
  it("[F9] numele cu diacritice apare lizibil pe chitanta", async () => {
    await plata((d) => { d.apartamente[0].proprietar = "Ștefan Țăranu"; });
    await apasa("Platile mele");
    const pdf = prindePdf();
    await apasa("Descarca chitanta", 0);
    const { text } = await pdf.ultimul();
    expect(text).toMatch(/Am primit de la (Ștefan Țăranu|Stefan Taranu),/);
  });
});
