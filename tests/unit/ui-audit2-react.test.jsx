/* Constatarile de React din auditul 2: F3 (pozele si variantele se sterg),
   F4 (formularul de factura nu se reseteaza la reincarcare), F5 (campul de
   data primeste si un timestamp), F6 (contoarele generale pe id),
   F7 (temporizatorul si URL-urile temporare se elibereaza). */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, sursaDemo, ceasDemo, ADMIN, LOCATAR, PAROLA } from "./ajutor.jsx";
import { apasa, scrie, tab } from "./ui-baza-ajutor.jsx";

const dialog = () => screen.getByRole("dialog");
const fisier = (nume) => new File(["x"], nume, { type: "" });

/* O sursa demo in care lista in lucru are deja o factura adevarata */
async function cuFacturaInCiorna(modifica) {
  ceasDemo();
  const sursa = sursaDemo(modifica);
  await sursa.intra(ADMIN, PAROLA);
  const ciorna = (await sursa.incarca()).liste.find((l) => l.stare === "ciorna");
  await sursa.salveazaCheltuiala({
    listaId: ciorna.id, furnizorNou: "Deratizare SRL", categorie: "Deratizare la subsol",
    cod: "C12", suma: 300, metoda: "apartamente", serie: "DER-1", emisa: "2026-09-04", scadentaFurnizor: "2026-09-25",
  });
  return { sursa, ciorna };
}

async function alegeFisier(eticheta, nume = "poza.jpg") {
  const input = within(dialog()).getAllByLabelText(eticheta).find((x) => x.tagName === "INPUT");
  await act(async () => { fireEvent.change(input, { target: { files: [fisier(nume)] } }); });
}

describe("[F3] pozele atasate si variantele de vot se pot sterge", () => {
  it("locatarul scoate o poza pusa din greseala la sesizare", async () => {
    let n = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:poza-${++n}`);
    await pornesteApp({ email: LOCATAR });
    await tab("Sesizări");
    await apasa("Sesizare nouă");
    await alegeFisier("Adaugă o poză", "una.jpg");
    await alegeFisier("Încă o poză", "doua.jpg");
    expect(screen.getAllByAltText("Poza sesizare")).toHaveLength(2);

    await apasa("Șterge poza");
    const ramase = screen.getAllByAltText("Poza sesizare");
    expect(ramase).toHaveLength(1);
    expect(ramase[0].getAttribute("src")).toBe("blob:poza-2");
  });

  it("stergerea pozei elibereaza si URL-ul temporar", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:poza");
    const revoca = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await pornesteApp({ email: LOCATAR });
    await tab("Sesizări");
    await apasa("Sesizare nouă");
    await alegeFisier("Adaugă o poză");
    await apasa("Șterge poza");
    expect(revoca).toHaveBeenCalledWith("blob:poza");
  });

  it("administratorul scoate o varianta de vot in plus", async () => {
    await pornesteApp({ email: ADMIN });
    await tab("Comunicare");
    await apasa("Vot și AG");
    await apasa("Deschide un vot nou");
    /* doua variante: nu se poate cobori sub minimul necesar unui vot */
    expect(screen.queryAllByRole("button", { name: "Șterge varianta" })).toHaveLength(0);

    await apasa("Adaugă o variantă");
    await scrie("Varianta 1", "Da");
    await scrie("Varianta 2", "Nu");
    await scrie("Varianta 3", "Ma abtin");
    expect(screen.getAllByRole("button", { name: "Șterge varianta" })).toHaveLength(3);

    await apasa("Șterge varianta", 1);
    expect(screen.getByLabelText("Varianta 1").value).toBe("Da");
    expect(screen.getByLabelText("Varianta 2").value).toBe("Ma abtin");
    expect(screen.queryByLabelText("Varianta 3")).toBeNull();
  });
});

describe("[F4] formularul de factura ramane completat", () => {
  it("o reincarcare a datelor nu sterge ce a scris administratorul", async () => {
    const { sursa } = await cuFacturaInCiorna();
    await pornesteApp({ email: ADMIN, sursa });
    await tab("Facturi");
    await apasa("Adaugă factură");
    await scrie("Ce cheltuială este", "Dezinsectie");
    await scrie("Suma facturii", "480");
    /* o comanda din ecranul de dedesubt reincarca datele cat timp panoul e deschis */
    await apasa("Marchează plătită");
    expect(screen.getByLabelText("Ce cheltuială este").value).toBe("Dezinsectie");
    expect(screen.getByLabelText("Suma facturii").value).toBe("480");
  });

  it("un raspuns intarziat de la motor nu inlocuieste datele cerute a doua oara", async () => {
    const { sursa, ciorna } = await cuFacturaInCiorna();
    const proaspete = await sursa.dateMotor(ciorna.id);
    const vechi = { ...proaspete, apartamente: proaspete.apartamente.slice(0, 1) };
    const amanate = [];
    await pornesteApp({ email: ADMIN, sursa });
    vi.spyOn(sursa, "dateMotor").mockImplementation(() => new Promise((r) => { amanate.push(r); }));

    await tab("Facturi");
    await apasa("Adaugă factură");
    await apasa("Închide");
    await apasa("Adaugă factură");
    expect(amanate).toHaveLength(2);
    await act(async () => { amanate[1](proaspete); amanate[0](vechi); });

    await scrie("Suma facturii", "100");
    const previzualizare = screen.getByText("Cum cade suma pe apartamente").parentElement;
    expect(within(previzualizare).getByText(/^Ap\. 17,/)).toBeTruthy();
  });
});

describe("[F5] campul de data primeste si un timestamp complet", () => {
  it("data facturii ramane vizibila cand sursa trimite ora", async () => {
    const { sursa } = await cuFacturaInCiorna((d) => {
      const c = d.cheltuieli.find((x) => x.serie === "DER-1");
      if (!c) return;
      c.emisa = "2026-09-04T00:00:00+03:00";
      c.scadentaFurnizor = "2026-09-25T00:00:00+03:00";
    });
    await pornesteApp({ email: ADMIN, sursa });
    await tab("Facturi");
    await apasa("Modifică");
    expect(screen.getByLabelText("Emisă pe").value).toBe("2026-09-04");
    expect(screen.getByLabelText("Scadență furnizor").value).toBe("2026-09-25");
  });
});

describe("[F6] contoarele generale se tin pe id, nu pe tip", () => {
  it("doua coloane de apa rece au fiecare campul lui", async () => {
    await pornesteApp({
      email: ADMIN,
      modifica: (d) => {
        const g = d.contoare.find((c) => !c.apartamentId && c.tip === "rece");
        d.contoare.push({ ...g, id: "con-gen-2", serie: "GEN-RECE-2", amplasare: "subsol, scară B" });
      },
    });
    await tab("Apartamente");
    await apasa("Citiri contoare");
    const campuri = screen.getAllByLabelText("Index nou");
    expect(campuri).toHaveLength(3);
    /* primul si ultimul sunt amandoua apa rece: nu au voie sa se calce */
    await act(async () => { fireEvent.change(campuri[0], { target: { value: "5000" } }); });
    expect(campuri[0].value).toBe("5000");
    expect(campuri[2].value).toBe("");
  });
});

describe("[F7] curatenia dupa ecran", () => {
  it("temporizatorul mesajului se opreste la iesirea din aplicatie", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const { unmount } = await pornesteApp({ email: ADMIN });
    await tab("Comunicare");
    await apasa("Scrie un anunț");
    await scrie("Titlu", "Anunt");
    await scrie("Continut", "Text");
    await apasa("Publică anunțul");
    expect(screen.getByRole("status")).toBeTruthy();
    const opreste = vi.spyOn(globalThis, "clearTimeout");
    unmount();
    expect(opreste).toHaveBeenCalled();
  });

  it("inlocuirea pozei de la contoare elibereaza URL-ul vechi", async () => {
    let n = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:contor-${++n}`);
    const revoca = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await pornesteApp({ email: LOCATAR });
    await tab("Contoare");
    const input = () => screen.getAllByLabelText(/poză|Fotografiază/i).find((x) => x.tagName === "INPUT");
    await act(async () => { fireEvent.change(input(), { target: { files: [fisier("una.jpg")] } }); });
    await act(async () => { fireEvent.change(input(), { target: { files: [fisier("doua.jpg")] } }); });
    expect(revoca).toHaveBeenCalledWith("blob:contor-1");
    expect(screen.getByAltText("Poza contoarelor").getAttribute("src")).toBe("blob:contor-2");
  });
});
