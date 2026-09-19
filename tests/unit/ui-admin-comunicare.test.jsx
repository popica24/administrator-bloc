/* Comunicarea cu locatarii (AdminBlocEcran): anunturi, remindere, vot si AG, acte */
import { describe, it, expect, vi } from "vitest";
import { zonaCu } from "./ajutor.jsx";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { pornesteAdmin, apasa, buton, butoane, butonul, toast, inDialog, dezactivat, randCu } from "./ui-admin-ajutor.js";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const deschideComunicare = (opt) => pornesteAdmin({ tab: "Comunicare", ...opt });
const tab = (nume) => apasa(nume);
const scrieIn = async (foaie, eticheta, valoare) => {
  await act(async () => { fireEvent.change(inDialog(foaie).getByLabelText(eticheta), { target: { value: valoare } }); });
};
/* Randul reminderului din lista (primul text cu acel nume; "Trimite acum" vine dupa) */
/* Blocul reminderului: cel mai mic care are si comutatorul, si zilele */
const randReminder = (nume) => within(randCu(nume, nume).parentElement);

describe("Comunicare, anunturi", () => {
  it("lista anunturilor cu urgent, data si cititori", async () => {
    await deschideComunicare();
    expect(screen.getByText("Str. Nicolae Balcescu nr. 22, Pitesti")).toBeTruthy();
    expect(screen.getAllByText("Urgent")).toHaveLength(1);
    const urgent = within(zonaCu(["Oprire apa rece marti, 22 septembrie", "Citit de"], 3));
    expect(urgent.getByText("17 sep 2026")).toBeTruthy();
    expect(urgent.getByText(/^Citit de 2 din \d+ locatari cu cont$/)).toBeTruthy();
  });

  it("publica un anunt urgent, cu titlu si continut obligatorii", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "publicaAnunt");
    await apasa("Scrie un anunt");
    const f = () => inDialog("Anunt nou");
    expect(dezactivat(f().getByRole("button", { name: "Publica anuntul" }))).toBe(true);
    await scrieIn("Anunt nou", "Titlu", "Curatenie generala");
    expect(dezactivat(f().getByRole("button", { name: "Publica anuntul" }))).toBe(true);
    await scrieIn("Anunt nou", "Continut", "Sambata la 10.");
    await apasa(f().getByRole("button", { name: "Urgent" }));
    expect(f().getByRole("button", { name: "Urgent" }).getAttribute("aria-pressed")).toBe("true");
    await apasa(f().getByRole("button", { name: "Publica anuntul" }));
    expect(spion).toHaveBeenCalledWith({ titlu: "Curatenie generala", corp: "Sambata la 10.", urgent: true });
    expect(toast().textContent).toBe("Anunt publicat si notificare trimisa");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Curatenie generala")).toBeTruthy();
    expect(screen.getAllByText("Urgent")).toHaveLength(2);
  });

  it("un anunt obisnuit; formularul redeschis porneste gol", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "publicaAnunt");
    await apasa("Scrie un anunt");
    await scrieIn("Anunt nou", "Titlu", "Ciorna");
    await apasa(inDialog("Anunt nou").getByRole("button", { name: "Inchide" }));
    await apasa("Scrie un anunt");
    expect(inDialog("Anunt nou").getByLabelText("Titlu").value).toBe("");
    await scrieIn("Anunt nou", "Titlu", "Apa calda");
    await scrieIn("Anunt nou", "Continut", "Revine luni.");
    await apasa(inDialog("Anunt nou").getByRole("button", { name: "Publica anuntul" }));
    expect(spion).toHaveBeenCalledWith({ titlu: "Apa calda", corp: "Revine luni.", urgent: false });
    expect(toast().textContent).toBe("Anunt publicat la avizier");
  });

  it("un anunt refuzat lasa formularul deschis", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "publicaAnunt").mockRejectedValue(new Error("Refuzat"));
    await apasa("Scrie un anunt");
    await scrieIn("Anunt nou", "Titlu", "X");
    await scrieIn("Anunt nou", "Continut", "Y");
    await apasa(inDialog("Anunt nou").getByRole("button", { name: "Publica anuntul" }));
    expect(toast().textContent).toBe("Refuzat");
    expect(inDialog("Anunt nou")).toBeTruthy();
  });

  it("fara locatari cu cont, bara de citire ramane goala", async () => {
    await deschideComunicare({ modifica: (d) => { d.anunturi.forEach((a) => { a.totalLocatari = 0; a.cititori = 0; }); } });
    expect(screen.getAllByText("Citit de 0 din 0 locatari cu cont")).toHaveLength(3);
  });
});

describe("Comunicare, remindere", () => {
  it("lista reminderelor cu cand pleaca fiecare si zilele alese", async () => {
    await deschideComunicare();
    await tab("Remindere");
    expect(randReminder("Anunt cand se afiseaza lista de plata").getByText("In ziua publicarii listei")).toBeTruthy();
    expect(randReminder("Anunt cand se afiseaza lista de plata").queryByText("1 zi")).toBeNull();
    const citire = randReminder("Reamintire de citire a contoarelor");
    expect(citire.getByText("Cu 5 zile inainte de termenul de citire")).toBeTruthy();
    expect(butonul("5 zile", citire).getAttribute("aria-pressed")).toBe("true");
    expect(butonul("1 zi", citire).getAttribute("aria-pressed")).toBe("false");
    expect(randReminder("Instiintare de restanta").getByText("La 30 de zile de la scadenta")).toBeTruthy();
    const ag = randReminder("Convocare adunare generala");
    expect(ag.getByText("Cu 10 zile inainte de data adunarii")).toBeTruthy();
    expect(ag.getByRole("button", { name: "Convocare adunare generala" }).getAttribute("aria-pressed")).toBe("false");
    expect(ag.queryByText("10 zile")).toBeNull();
  });

  it("comutatorul si zilele schimba reminderul", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "seteazaReminder");
    await tab("Remindere");
    await apasa(butonul("1 zi", randReminder("Reamintire de plata")));
    expect(spion).toHaveBeenLastCalledWith("plata", true, 1);
    expect(randReminder("Reamintire de plata").getByText("Cu o zi inainte de scadenta")).toBeTruthy();
    await apasa(buton("Reamintire de plata", randReminder("Reamintire de plata")));
    expect(spion).toHaveBeenLastCalledWith("plata", false, 1);
    expect(randReminder("Reamintire de plata").queryByText("1 zi")).toBeNull();
    await apasa(buton("Convocare adunare generala"));
    expect(spion).toHaveBeenLastCalledWith("adunare_generala", true, 10);
    expect(randReminder("Convocare adunare generala").getByText("10 zile")).toBeTruthy();
  });

  it("trimite acum: citire, plata si restantieri", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "trimiteReminder");
    await tab("Remindere");
    const trimite = within(zonaCu(["Trimite acum", "Reamintire de plata"], 3));
    expect(trimite.getAllByRole("button").map((b) => b.textContent)).toEqual(["Reamintire de citire index", "Reamintire de plata", "Instiintare restantieri"]);
    await apasa(trimite.getByRole("button", { name: "Reamintire de citire index" }));
    expect(spion).toHaveBeenLastCalledWith("citire_contoare");
    const r = await spion.mock.results[0].value;
    expect(r.apartamente).toBe(10);
    expect(toast().textContent).toMatch(/^Trimis catre (1 locatar|\d+ locatari) cu cont, din 10 apartamente vizate$/);
    await apasa(trimite.getByRole("button", { name: "Instiintare restantieri" }));
    expect(spion).toHaveBeenLastCalledWith("restanta");
    expect(toast().textContent).toMatch(/din 5 apartamente vizate$/);
  });

  it("trimiterea esuata arata eroarea; un reminder lipsa nu apare", async () => {
    const { sursa } = await deschideComunicare({ modifica: (d) => { d.remindere = d.remindere.filter((r) => r.tip !== "restanta"); } });
    vi.spyOn(sursa, "trimiteReminder").mockRejectedValue(new Error("Nu s-a trimis"));
    await tab("Remindere");
    expect(screen.queryByText("Instiintare de restanta")).toBeNull();
    await apasa(butonul("Reamintire de plata", within(zonaCu(["Trimite acum", "Reamintire de plata"], 3))));
    expect(toast().textContent).toBe("Nu s-a trimis");
  });
});

describe("Comunicare, vot si adunare generala", () => {
  it("se deschide direct pe vot din sumar si arata votul deschis si adunarea", async () => {
    await pornesteAdmin();
    await apasa("Deschide un vot");
    expect(screen.getByText("Deschis")).toBeTruthy();
    expect(screen.getByText("Inlocuirea usii de la intrare")).toBeTruthy();
    expect(screen.getByText("Deschis pe 5 sep 2026, se inchide pe 3 oct 2026")).toBeTruthy();
    expect(screen.getByText("14 din 20")).toBeTruthy();
    expect(screen.getByText("Nu au votat: ap. 1, 3, 11, 15, 17, 19")).toBeTruthy();
    expect(screen.getByText("Adunarea generala din 3 octombrie 2026")).toBeTruthy();
    expect(screen.getByText(/^La parter, langa boxe, ora \d\d:30$/)).toBeTruthy();
    expect(screen.getByText("Au confirmat prezenta 3 din 20 apartamente.")).toBeTruthy();
  });

  it("reaminteste celor care nu au votat", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "reamintesteVot");
    const d = await sursa.incarca();
    await tab("Vot si AG");
    await apasa("Reaminteste celor care nu au votat");
    expect(spion).toHaveBeenCalledWith(d.voturi[0].id);
    expect(toast().textContent).toMatch(/^Reminder trimis catre (1 locatar|\d+ locatari) cu cont, din 6 apartamente$/);
  });

  it("reamintirea esuata arata eroarea", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "reamintesteVot").mockRejectedValue(new Error("Votul s-a inchis."));
    await tab("Vot si AG");
    await apasa("Reaminteste celor care nu au votat");
    expect(toast().textContent).toBe("Votul s-a inchis.");
  });

  it("vot inchis, vot fara lista de nevotanti si vot la care au votat toti", async () => {
    await deschideComunicare({
      modifica: (d) => {
        const v = d.voturi[0];
        d.voturi = [
          { ...v, id: "v1", titlu: "Vot inchis", inchideLa: "2026-09-10T18:00:00+03:00" },
          { ...v, id: "v2", titlu: "Vot fara lista", nevotate: null, votanti: 0, totalApartamente: 0 },
          { ...v, id: "v3", titlu: "Vot complet", nevotate: [] },
        ];
      },
    });
    await tab("Vot si AG");
    const card = (t) => within(zonaCu([t, "Prezenta la vot"]));
    expect(card("Vot inchis").getByText("Inchis")).toBeTruthy();
    expect(card("Vot inchis").getByText(/^Nu au votat:/)).toBeTruthy();
    expect(card("Vot inchis").queryByRole("button", { name: "Reaminteste celor care nu au votat" })).toBeNull();
    expect(card("Vot fara lista").getByText("0 din 0")).toBeTruthy();
    expect(card("Vot fara lista").queryByText(/^Nu au votat/)).toBeNull();
    expect(card("Vot complet").queryByText(/^Nu au votat/)).toBeNull();
    expect(butoane("Reaminteste celor care nu au votat")).toHaveLength(0);
  });

  it("deschide un vot cu pana la cinci variante", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "deschideVot");
    await tab("Vot si AG");
    await apasa("Deschide un vot nou");
    const f = () => inDialog("Vot nou");
    const deschide = () => f().getByRole("button", { name: "Deschide votul" });
    expect(dezactivat(deschide())).toBe(true);
    await scrieIn("Vot nou", "Ce se voteaza", "Vopsirea gardului");
    await scrieIn("Vot nou", "Detalii", "Doua culori");
    await scrieIn("Vot nou", "Varianta 1", "Verde");
    expect(dezactivat(deschide())).toBe(true);
    await scrieIn("Vot nou", "Varianta 2", "Gri");
    expect(dezactivat(deschide())).toBe(true);
    await scrieIn("Vot nou", "Votul se inchide pe", "2026-10-15");
    expect(dezactivat(deschide())).toBe(false);
    for (let i = 0; i < 3; i += 1) await apasa(f().getByRole("button", { name: "Adauga o varianta" }));
    expect(f().getByLabelText("Varianta 5")).toBeTruthy();
    expect(f().queryByRole("button", { name: "Adauga o varianta" })).toBeNull();
    await scrieIn("Vot nou", "Varianta 3", "Maro");
    await scrieIn("Vot nou", "Cum se numara voturile", "cota");
    await apasa(deschide());
    expect(spion).toHaveBeenCalledWith({ titlu: "Vopsirea gardului", descriere: "Doua culori", optiuni: ["Verde", "Gri", "Maro", "", ""], inchideLa: "2026-10-15", numarare: "cota" });
    expect(toast().textContent).toBe("Votul a fost deschis");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Vopsirea gardului")).toBeTruthy();
  });

  it("un vot refuzat lasa formularul deschis", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "deschideVot").mockRejectedValue(new Error("Data de inchidere trebuie sa fie in viitor."));
    await tab("Vot si AG");
    await apasa("Deschide un vot nou");
    await scrieIn("Vot nou", "Ce se voteaza", "X");
    await scrieIn("Vot nou", "Varianta 1", "Da");
    await scrieIn("Vot nou", "Varianta 2", "Nu");
    await scrieIn("Vot nou", "Votul se inchide pe", "2026-09-01");
    await apasa(inDialog("Vot nou").getByRole("button", { name: "Deschide votul" }));
    expect(toast().textContent).toBe("Data de inchidere trebuie sa fie in viitor.");
    expect(inDialog("Vot nou")).toBeTruthy();
    await apasa(inDialog("Vot nou").getByRole("button", { name: "Inchide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("convoaca adunarea generala cu data, ora, loc si ordinea de zi", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "convoacaAdunare");
    await tab("Vot si AG");
    await apasa("Convoaca adunarea");
    const f = () => inDialog("Convoaca adunarea generala");
    const trimite = () => f().getByRole("button", { name: "Trimite convocarea" });
    expect(f().getByLabelText("Ora").value).toBe("18:30");
    expect(dezactivat(trimite())).toBe(true);
    await scrieIn("Convoaca adunarea generala", "Data", "2026-10-20");
    await scrieIn("Convoaca adunarea generala", "Locul", "In curte");
    await scrieIn("Convoaca adunarea generala", "Ordinea de zi", "Bugetul pe 2027");
    expect(dezactivat(trimite())).toBe(false);
    await scrieIn("Convoaca adunarea generala", "Ora", "");
    expect(dezactivat(trimite())).toBe(true);
    await scrieIn("Convoaca adunarea generala", "Ora", "19:00");
    await apasa(trimite());
    expect(spion).toHaveBeenCalledWith({ dataOra: new Date("2026-10-20T19:00:00").toISOString(), loc: "In curte", ordineDeZi: "Bugetul pe 2027" });
    expect(toast().textContent).toBe("Convocarea a fost trimisa locatarilor cu cont");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Adunarea generala din 20 octombrie 2026")).toBeTruthy();
  });

  it("o convocare refuzata lasa formularul deschis", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "convoacaAdunare").mockRejectedValue(new Error("Data adunarii trebuie sa fie in viitor."));
    await tab("Vot si AG");
    await apasa("Convoaca adunarea");
    await scrieIn("Convoaca adunarea generala", "Data", "2026-09-01");
    await scrieIn("Convoaca adunarea generala", "Locul", "Aici");
    await scrieIn("Convoaca adunarea generala", "Ordinea de zi", "Ceva");
    await apasa(inDialog("Convoaca adunarea generala").getByRole("button", { name: "Trimite convocarea" }));
    expect(toast().textContent).toBe("Data adunarii trebuie sa fie in viitor.");
    expect(inDialog("Convoaca adunarea generala")).toBeTruthy();
    await apasa(inDialog("Convoaca adunarea generala").getByRole("button", { name: "Inchide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Comunicare, acte", () => {
  it("lista documentelor cu tip, data si vizibilitate; un document se deschide", async () => {
    const { sursa } = await deschideComunicare({
      modifica: (d) => { d.documente.find((x) => x.titlu === "Raport de cenzor pe anul 2025").vizibil = false; },
    });
    vi.spyOn(window, "open").mockReturnValue({ location: {}, close: vi.fn() });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:doc");
    const spion = vi.spyOn(sursa, "deschideDocument");
    const d = await sursa.incarca();
    await tab("Acte");
    const raport = within(buton("Deschide Raport de cenzor pe anul 2025"));
    expect(raport.getByText("Raport · 11 feb 2026")).toBeTruthy();
    expect(raport.getByText("Doar admin")).toBeTruthy();
    expect(within(buton("Deschide Regulamentul asociatiei de proprietari")).getByText("Public")).toBeTruthy();
    await apasa(buton("Deschide Regulamentul asociatiei de proprietari"));
    expect(spion).toHaveBeenCalledWith(d.documente.find((x) => x.titlu === "Regulamentul asociatiei de proprietari").id);
  });

  it("incarca un document vizibil doar administratiei", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "incarcaDocument");
    await tab("Acte");
    await apasa("Incarca un document");
    const f = () => inDialog("Document nou");
    const incarca = () => f().getByRole("button", { name: "Incarca documentul" });
    expect(f().getByLabelText("Tip").value).toBe("altul");
    await scrieIn("Document nou", "Titlu", "Proces verbal AG octombrie");
    expect(dezactivat(incarca())).toBe(true);
    await scrieIn("Document nou", "Tip", "proces_verbal");
    const pdf = new File(["%PDF"], "pv.pdf", { type: "application/pdf" });
    await act(async () => { fireEvent.change(f().getByLabelText("Alege fisierul"), { target: { files: [pdf] } }); });
    expect(f().getByText("pv.pdf")).toBeTruthy();
    expect(f().getByRole("button", { name: "Alt fisier" })).toBeTruthy();
    await apasa(f().getByRole("button", { name: "Vizibil locatarilor" }));
    await apasa(incarca());
    expect(spion).toHaveBeenCalledWith({ titlu: "Proces verbal AG octombrie", tip: "proces_verbal", fisier: pdf, vizibil: false });
    expect(toast().textContent).toBe("Documentul a fost incarcat");
    expect(within(buton("Deschide Proces verbal AG octombrie")).getByText("Doar admin")).toBeTruthy();
  });

  it("un document refuzat lasa formularul deschis", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "incarcaDocument").mockRejectedValue(new Error("Fisier prea mare"));
    await tab("Acte");
    await apasa("Incarca un document");
    await scrieIn("Document nou", "Titlu", "Act");
    await act(async () => { fireEvent.change(inDialog("Document nou").getByLabelText("Alege fisierul"), { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } }); });
    await apasa(inDialog("Document nou").getByRole("button", { name: "Incarca documentul" }));
    expect(toast().textContent).toBe("Fisier prea mare");
    expect(inDialog("Document nou")).toBeTruthy();
    await apasa(inDialog("Document nou").getByRole("button", { name: "Inchide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tab-ul anunturi revine la apasare", async () => {
    await deschideComunicare();
    await tab("Acte");
    await tab("Anunturi");
    expect(buton("Scrie un anunt")).toBeTruthy();
  });
});
