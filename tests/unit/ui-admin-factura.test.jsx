/* Formularul de factura cu previzualizarea pe apartamente (SheetFactura) */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { pornesteAdmin, apasa, butoane, toast, inDialog, dezactivat, asteapta } from "./ui-admin-ajutor.js";
import { zonaCu, inZona } from "./ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const f = () => inDialog(/^(Factură nouă|Modifică factura)$/);
const salveaza = () => f().getByRole("button", { name: /^(Salvează factura|Se salvează\.\.\.)$/ });

async function deschideFormular(opt) {
  const r = await pornesteAdmin({ tab: "Facturi", ...opt });
  await apasa(butoane("Adaugă factură")[0]);
  return r;
}

async function schimba(eticheta, valoare) {
  await act(async () => { fireEvent.change(f().getByLabelText(eticheta), { target: { value: valoare } }); });
  await asteapta();
}

const furnizor = async (sursa, cod) => (await sursa.incarca()).furnizori.find((x) => x.cod === cod);
const rand = (text) => zonaCu(text, 1).parentElement.textContent;

describe("SheetFactura, factura noua", () => {
  it("alegerea furnizorului precompleteaza categoria, metoda si codul; salvarea trimite tot", async () => {
    const { sursa } = await deschideFormular();
    const spion = vi.spyOn(sursa, "salveazaCheltuiala");
    const d = await sursa.incarca();
    const sal = d.furnizori.find((x) => x.cod === "C4");
    expect(f().getByLabelText("Cod pe lista").getAttribute("placeholder")).toBe("C10");
    expect(dezactivat(salveaza())).toBe(true);

    await schimba("Furnizor", sal.id);
    expect(f().queryByLabelText("Sau scrie un furnizor nou")).toBeNull();
    expect(f().getByLabelText("Ce cheltuială este").value).toBe("Salubritate");
    expect(f().getByLabelText("Cod pe lista").value).toBe("C4");
    expect(f().getByLabelText("Cum se împarte").value).toBe("persoane");
    expect(f().getByText(/Suma se împarte la totalul persoanelor declarate/)).toBeTruthy();
    expect(dezactivat(salveaza())).toBe(true);

    await schimba("Suma facturii", "1.225,00");
    await schimba("Serie și număr factură", "  SAL-40000 ");
    await schimba("Emisă pe", "2026-10-01");
    await schimba("Scadență furnizor", "2026-10-30");
    /* Previzualizarea: 1225 lei la 49 de persoane, 25 lei de persoana */
    expect(rand("Ap. 1, 2 persoane")).toBe("Ap. 1, 2 persoane50,00 lei");
    expect(rand("Ap. 2, 1 persoană")).toBe("Ap. 2, 1 persoană25,00 lei");
    expect(rand("Total împărțit")).toBe("Total împărțit1.225,00 lei");
    expect(f().getByText("Nimic nu se salvează și locatarii nu văd nimic până la publicarea listei.")).toBeTruthy();

    await apasa(salveaza());
    expect(spion).toHaveBeenCalledWith({
      id: null, listaId: d.liste[0].id, furnizorId: sal.id, furnizorNou: null, categorie: "Salubritate", cod: "C4",
      suma: 1225, metoda: "persoane", tipApa: null, serie: "SAL-40000", emisa: "2026-10-01", scadentaFurnizor: "2026-10-30", fisier: null,
    });
    expect(toast().textContent).toBe("Factura a fost adăugată în lista în lucru");
    expect(screen.queryByRole("dialog")).toBeNull();
    const randNou = inZona("Salubritate 2000 · SAL-40000", "De plătit până 30 oct 2026");
    expect(randNou.getByText("Salubritate 2000 · SAL-40000")).toBeTruthy();
    expect(randNou.getByText("De plătit până 30 oct 2026")).toBeTruthy();
  });

  it("furnizor nou, cod liber, fisier atasat si metoda schimbata", async () => {
    const { sursa } = await deschideFormular();
    const spion = vi.spyOn(sursa, "salveazaCheltuiala");
    await schimba("Sau scrie un furnizor nou", "  Firma Nouă SRL ");
    await schimba("Ce cheltuială este", " Reparație interfon ");
    await schimba("Suma facturii", "200");
    await schimba("Cum se împarte", "apartamente");
    expect(rand("Ap. 1, 1 apartament")).toBe("Ap. 1, 1 apartament10,00 lei");

    const pdf = new File(["%PDF"], "factura.pdf", { type: "application/pdf" });
    await act(async () => { fireEvent.change(f().getByLabelText("Atașează factura scanată"), { target: { files: [pdf] } }); });
    await asteapta();
    expect(f().getByText("factura.pdf")).toBeTruthy();
    expect(f().getByRole("button", { name: "Alt fișier" })).toBeTruthy();

    await apasa(salveaza());
    const arg = spion.mock.calls[0][0];
    expect(arg).toMatchObject({ furnizorId: null, furnizorNou: "Firma Nouă SRL", categorie: "Reparație interfon", cod: "C10", suma: 200, metoda: "apartamente", serie: "", emisa: null, scadentaFurnizor: null });
    expect(arg.fisier).toBe(pdf);
    const c = (await sursa.incarca()).cheltuieli.find((x) => x.cod === "C10");
    expect(c.documentId).toBeTruthy();

    /* Urmatorul cod liber sare peste C10 */
    await apasa(butoane("Adaugă factură")[0]);
    expect(f().getByLabelText("Cod pe lista").getAttribute("placeholder")).toBe("C11");
    expect(f().getByLabelText("Ce cheltuială este").value).toBe("");
  });

  it("codul folosit deja pe lista blocheaza salvarea", async () => {
    await deschideFormular();
    await schimba("Sau scrie un furnizor nou", "Firma");
    await schimba("Ce cheltuială este", "Ceva");
    await schimba("Suma facturii", "100");
    await schimba("Cod pe lista", "C9");
    expect(f().getByText("Codul există deja")).toBeTruthy();
    expect(dezactivat(salveaza())).toBe(true);
    await schimba("Cod pe lista", "C12");
    expect(f().queryByText("Codul există deja")).toBeNull();
    expect(dezactivat(salveaza())).toBe(false);
  });

  it("pe persoane fara lift, parterul apare scutit; rotunjirea se vede pe rand", async () => {
    const { sursa } = await deschideFormular();
    await schimba("Furnizor", (await furnizor(sursa, "C5")).id);
    await schimba("Suma facturii", "641");
    expect(rand("Ap. 1, scutit de lift")).toBe("Ap. 1, scutit de lift0,00 lei");
    expect(f().getAllByText(/ \+ rotunjire$/).length).toBeGreaterThan(0);
    expect(rand("Total împărțit")).toBe("Total împărțit641,00 lei");
  });

  it("apa pe consum fara citiri arata problemele in loc de sume", async () => {
    const { sursa } = await deschideFormular();
    await schimba("Furnizor", (await furnizor(sursa, "C2")).id);
    expect(f().getByRole("button", { name: "Apa caldă" }).getAttribute("aria-pressed")).toBe("true");
    await schimba("Suma facturii", "2000");
    expect(f().getByText(/C2: lipsesc citirile la apa calda pentru \d+ apartamente\./)).toBeTruthy();
    expect(f().getByText("C2: lipseste citirea contorului general pentru apa calda.")).toBeTruthy();
    expect(f().queryByText("Total împărțit")).toBeNull();
    await apasa(f().getByRole("button", { name: "Apa rece" }));
    expect(f().getByText(/C2: lipsesc citirile la apa rece/)).toBeTruthy();
    const spion = vi.spyOn(sursa, "salveazaCheltuiala");
    await apasa(salveaza());
    expect(spion.mock.calls[0][0]).toMatchObject({ metoda: "consum", tipApa: "rece", cod: "C2" });
  });

  it("un furnizor fara valori implicite si revenirea la 'Alege furnizorul'", async () => {
    await deschideFormular({ modifica: (d) => { d.furnizori.push({ id: "fur-gol", denumire: "Firma fără date", categorie: null, metoda: null, tipApa: null, cod: null }); } });
    await schimba("Cum se împarte", "cota");
    await schimba("Ce cheltuială este", "Scrisă de mana");
    await schimba("Furnizor", "fur-gol");
    expect(f().getByLabelText("Ce cheltuială este").value).toBe("");
    expect(f().getByLabelText("Cum se împarte").value).toBe("persoane");
    expect(f().getByLabelText("Cod pe lista").value).toBe("");
    await schimba("Ce cheltuială este", "Altceva");
    await schimba("Furnizor", "");
    /* Fara furnizor ales, campurile raman cum erau */
    expect(f().getByLabelText("Ce cheltuială este").value).toBe("Altceva");
    expect(f().getByLabelText("Sau scrie un furnizor nou")).toBeTruthy();
  });

  it("fara datele motorului nu apare previzualizarea, dar factura se poate salva", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Facturi" });
    vi.spyOn(sursa, "dateMotor").mockRejectedValue(new Error("Fără date"));
    await apasa(butoane("Adaugă factură")[0]);
    await schimba("Sau scrie un furnizor nou", "Firma");
    await schimba("Ce cheltuială este", "Ceva");
    await schimba("Suma facturii", "100");
    expect(f().queryByText("Cum cade suma pe apartamente")).toBeNull();
    expect(dezactivat(salveaza())).toBe(false);
  });

  it("un apartament pe care ecranul nu il are inca nu opreste previzualizarea", async () => {
    await deschideFormular({ modifica: (d) => { d.apartamente = d.apartamente.filter((a) => a.numar !== "20"); } });
    await schimba("Sau scrie un furnizor nou", "Firma");
    await schimba("Suma facturii", "100");
    /* Motorul are 20 de apartamente, ecranul 19: randul in plus apare fara numar */
    expect(f().getAllByText(/^Ap\. /)).toHaveLength(20);
    expect(rand("Total împărțit")).toBe("Total împărțit100,00 lei");
  });

  it("in timpul salvarii butonul arata 'Se salveaza...'; o eroare lasa formularul deschis", async () => {
    const { sursa } = await deschideFormular();
    let rezolva;
    vi.spyOn(sursa, "salveazaCheltuiala").mockReturnValue(new Promise((_, rej) => { rezolva = () => rej(new Error("Codul C10 există deja pe lista.")); }));
    await schimba("Sau scrie un furnizor nou", "Firma");
    await schimba("Ce cheltuială este", "Ceva");
    await schimba("Suma facturii", "100");
    await apasa(salveaza());
    expect(salveaza().textContent).toBe("Se salvează...");
    expect(dezactivat(salveaza())).toBe(true);
    await act(async () => { rezolva(); });
    await asteapta();
    expect(toast().textContent).toBe("Codul C10 există deja pe lista.");
    expect(salveaza().textContent).toBe("Salvează factura");
    await apasa(f().getByRole("button", { name: "Închide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SheetFactura, modificare", () => {
  const cuFacturi = (d) => {
    const ciorna = d.liste.find((l) => l.stare === "ciorna");
    const termo = d.furnizori.find((x) => x.cod === "C2");
    d.cheltuieli.push(
      { id: "che-t", listaId: ciorna.id, cod: "C2", tip: "factura", categorie: "Apa caldă", furnizorId: termo.id, furnizor: termo.denumire, serie: "TEP-1", suma: 2418, metoda: "consum", tipApa: "calda", emisa: "2026-10-04", scadentaFurnizor: "2026-10-28", achitataLa: null, documentId: null },
      { id: "che-g", listaId: ciorna.id, cod: "C8", tip: "factura", categorie: "Deratizare", furnizorId: null, furnizor: "Necunoscut", serie: null, suma: 380, metoda: "apartamente", tipApa: null, emisa: null, scadentaFurnizor: null, achitataLa: null, documentId: null },
    );
  };
  const randCheltuiala = (categorie) => inZona(categorie, "Modifică");

  it("formularul se precompleteaza din factura, iar codul propriu nu e dublura", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Facturi", modifica: cuFacturi });
    const termo = await furnizor(sursa, "C2");
    await apasa(randCheltuiala("Apa caldă").getByRole("button", { name: "Modifică" }));
    const m = inDialog("Modifică factura");
    expect(m.getByLabelText("Furnizor").value).toBe(termo.id);
    expect(m.getByLabelText("Ce cheltuială este").value).toBe("Apa caldă");
    expect(m.getByLabelText("Cod pe lista").value).toBe("C2");
    expect(m.getByLabelText("Suma facturii").value).toBe("2.418,00");
    expect(m.getByLabelText("Cum se împarte").value).toBe("consum");
    expect(m.getByRole("button", { name: "Apa caldă" }).getAttribute("aria-pressed")).toBe("true");
    expect(m.getByLabelText("Serie și număr factură").value).toBe("TEP-1");
    expect(m.getByLabelText("Emisă pe").value).toBe("2026-10-04");
    expect(m.getByLabelText("Scadență furnizor").value).toBe("2026-10-28");
    expect(m.queryByText("Codul există deja")).toBeNull();

    const spion = vi.spyOn(sursa, "salveazaCheltuiala").mockResolvedValue("che-t");
    await apasa(salveaza());
    expect(spion.mock.calls[0][0]).toMatchObject({ id: "che-t", cod: "C2", suma: 2418, tipApa: "calda", serie: "TEP-1" });
    expect(toast().textContent).toBe("Factura a fost modificată");
  });

  it("valorile lipsa din factura devin campuri goale", async () => {
    await pornesteAdmin({ tab: "Facturi", modifica: cuFacturi });
    await apasa(randCheltuiala("Deratizare").getByRole("button", { name: "Modifică" }));
    const m = inDialog("Modifică factura");
    expect(m.getByLabelText("Furnizor").value).toBe("");
    expect(m.getByLabelText("Serie și număr factură").value).toBe("");
    expect(m.getByLabelText("Emisă pe").value).toBe("");
    expect(m.getByLabelText("Scadență furnizor").value).toBe("");
    await schimba("Cum se împarte", "consum");
    expect(m.getByRole("button", { name: "Apa rece" }).getAttribute("aria-pressed")).toBe("true");
  });
});
