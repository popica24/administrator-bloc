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

/* [K12] Instantul ISO al unei ore date a Romaniei (+02:00 iarna, +03:00
   vara), calculat cu Intl, la fel ca offsetRomania()/oraSeriiRomania() din
   sursa-mock.js si sursa-supabase.js (J9) - independent de fusul masinii
   care ruleaza testul. */
function instantRomania(dataText, oraText) {
  const aprox = new Date(`${dataText}T${oraText}:00Z`);
  const ore = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Bucharest", timeZoneName: "shortOffset", hour12: false })
    .formatToParts(aprox).find((p) => p.type === "timeZoneName").value.replace("GMT+", "");
  return new Date(`${dataText}T${oraText}:00+${ore.padStart(2, "0")}:00`).toISOString();
}

describe("Comunicare, anunțuri", () => {
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
    await apasa("Scrie un anunț");
    const f = () => inDialog("Anunț nou");
    expect(dezactivat(f().getByRole("button", { name: "Publică anunțul" }))).toBe(true);
    await scrieIn("Anunț nou", "Titlu", "Curățenie generală");
    expect(dezactivat(f().getByRole("button", { name: "Publică anunțul" }))).toBe(true);
    await scrieIn("Anunț nou", "Continut", "Sambata la 10.");
    await apasa(f().getByRole("button", { name: "Urgent" }));
    expect(f().getByRole("button", { name: "Urgent" }).getAttribute("aria-pressed")).toBe("true");
    await apasa(f().getByRole("button", { name: "Publică anunțul" }));
    expect(spion).toHaveBeenCalledWith({ titlu: "Curățenie generală", corp: "Sambata la 10.", urgent: true });
    expect(toast().textContent).toBe("Anunț publicat și notificare trimisă");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Curățenie generală")).toBeTruthy();
    expect(screen.getAllByText("Urgent")).toHaveLength(2);
  });

  it("un anunt obisnuit; formularul redeschis porneste gol", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "publicaAnunt");
    await apasa("Scrie un anunț");
    await scrieIn("Anunț nou", "Titlu", "Ciorna");
    await apasa(inDialog("Anunț nou").getByRole("button", { name: "Închide" }));
    await apasa("Scrie un anunț");
    expect(inDialog("Anunț nou").getByLabelText("Titlu").value).toBe("");
    await scrieIn("Anunț nou", "Titlu", "Apa caldă");
    await scrieIn("Anunț nou", "Continut", "Revine luni.");
    await apasa(inDialog("Anunț nou").getByRole("button", { name: "Publică anunțul" }));
    expect(spion).toHaveBeenCalledWith({ titlu: "Apa caldă", corp: "Revine luni.", urgent: false });
    expect(toast().textContent).toBe("Anunț publicat la avizier");
  });

  it("un anunt refuzat lasa formularul deschis", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "publicaAnunt").mockRejectedValue(new Error("Refuzat"));
    await apasa("Scrie un anunț");
    await scrieIn("Anunț nou", "Titlu", "X");
    await scrieIn("Anunț nou", "Continut", "Y");
    await apasa(inDialog("Anunț nou").getByRole("button", { name: "Publică anunțul" }));
    expect(toast().textContent).toBe("Refuzat");
    expect(inDialog("Anunț nou")).toBeTruthy();
  });

  /* [R1] O sesiune moarta la apasarea "Publica anuntul" trebuie sa duca omul
     direct la autentificare (ca orice alta comanda cu sesiunea expirata,
     [P3]) fara sa arunce ce a scris: textul ramane in formular, ascuns sub
     ecranul de autentificare, gata sa fie publicat dupa ce omul intra din
     nou in cont. */
  it("[R1] sesiune expirata la publicarea anuntului: se cere reautentificare, dar textul scris ramane", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "publicaAnunt").mockRejectedValue(new Error("Sesiunea a expirat. Intra din nou in cont."));
    await apasa("Scrie un anunț");
    await scrieIn("Anunț nou", "Titlu", "Curățenie generală");
    await scrieIn("Anunț nou", "Continut", "Sambata la 10.");
    await apasa(inDialog("Anunț nou").getByRole("button", { name: "Publică anunțul" }));
    expect(toast().textContent).toBe("Sesiunea a expirat. Intra din nou in cont.");
    expect(screen.getByText("Intră în cont")).toBeTruthy();
    expect(inDialog("Anunț nou").getByLabelText("Titlu").value).toBe("Curățenie generală");
    expect(inDialog("Anunț nou").getByLabelText("Continut").value).toBe("Sambata la 10.");
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
    expect(randReminder("Anunț când se afișează lista de plată").getByText("În ziua publicării listei")).toBeTruthy();
    expect(randReminder("Anunț când se afișează lista de plată").queryByText("1 zi")).toBeNull();
    const citire = randReminder("Reamintire de citire a contoarelor");
    expect(citire.getByText("Cu 5 zile înainte de termenul de citire")).toBeTruthy();
    expect(butonul("5 zile", citire).getAttribute("aria-pressed")).toBe("true");
    expect(butonul("1 zi", citire).getAttribute("aria-pressed")).toBe("false");
    expect(randReminder("Înștiințare de restanță").getByText("La 30 de zile de la scadență")).toBeTruthy();
    const ag = randReminder("Convocare adunare generală");
    expect(ag.getByText("Cu 10 zile înainte de data adunării")).toBeTruthy();
    expect(ag.getByRole("button", { name: "Convocare adunare generală" }).getAttribute("aria-pressed")).toBe("false");
    expect(ag.queryByText("10 zile")).toBeNull();
  });

  it("comutatorul si zilele schimba reminderul", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "seteazaReminder");
    await tab("Remindere");
    await apasa(butonul("1 zi", randReminder("Reamintire de plată")));
    expect(spion).toHaveBeenLastCalledWith("plata", true, 1);
    expect(randReminder("Reamintire de plată").getByText("Cu o zi înainte de scadență")).toBeTruthy();
    await apasa(buton("Reamintire de plată", randReminder("Reamintire de plată")));
    expect(spion).toHaveBeenLastCalledWith("plata", false, 1);
    expect(randReminder("Reamintire de plată").queryByText("1 zi")).toBeNull();
    await apasa(buton("Convocare adunare generală"));
    expect(spion).toHaveBeenLastCalledWith("adunare_generala", true, 10);
    expect(randReminder("Convocare adunare generală").getByText("10 zile")).toBeTruthy();
  });

  it("trimite acum: citire, plata si restantieri", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "trimiteReminder");
    await tab("Remindere");
    const trimite = within(zonaCu(["Trimite acum", "Reamintire de plată"], 3));
    expect(trimite.getAllByRole("button").map((b) => b.textContent)).toEqual(["Reamintire de citire index", "Reamintire de plată", "Înștiințare restanțieri"]);
    await apasa(trimite.getByRole("button", { name: "Reamintire de citire index" }));
    expect(spion).toHaveBeenLastCalledWith("citire_contoare");
    const r = await spion.mock.results[0].value;
    expect(r.apartamente).toBe(10);
    expect(toast().textContent).toMatch(/^Trimis către (1 locatar|\d+ locatari) cu cont, din 10 apartamente vizate$/);
    await apasa(trimite.getByRole("button", { name: "Înștiințare restanțieri" }));
    expect(spion).toHaveBeenLastCalledWith("restanta");
    expect(toast().textContent).toMatch(/din 5 apartamente vizate$/);
  });

  it("trimiterea esuata arata eroarea; un reminder lipsa nu apare", async () => {
    const { sursa } = await deschideComunicare({ modifica: (d) => { d.remindere = d.remindere.filter((r) => r.tip !== "restanta"); } });
    vi.spyOn(sursa, "trimiteReminder").mockRejectedValue(new Error("Nu s-a trimis"));
    await tab("Remindere");
    expect(screen.queryByText("Înștiințare de restanță")).toBeNull();
    await apasa(butonul("Reamintire de plată", within(zonaCu(["Trimite acum", "Reamintire de plată"], 3))));
    expect(toast().textContent).toBe("Nu s-a trimis");
  });
});

describe("Comunicare, vot si adunare generala", () => {
  it("se deschide direct pe vot din sumar si arata votul deschis si adunarea", async () => {
    await pornesteAdmin();
    await apasa("Deschide un vot");
    expect(screen.getByText("Deschis")).toBeTruthy();
    expect(screen.getByText("Inlocuirea usii de la intrare")).toBeTruthy();
    expect(screen.getByText("Deschis pe 5 sep 2026, se închide pe 3 oct 2026")).toBeTruthy();
    expect(screen.getByText("14 din 20")).toBeTruthy();
    expect(screen.getByText("Nu au votat: ap. 1, 3, 11, 15, 17, 19")).toBeTruthy();
    expect(screen.getByText("Adunarea generală din 3 octombrie 2026")).toBeTruthy();
    expect(screen.getByText(/^La parter, langa boxe, ora \d\d:30$/)).toBeTruthy();
    expect(screen.getByText("Au confirmat prezența 3 din 20 apartamente.")).toBeTruthy();
  });

  it("reaminteste celor care nu au votat", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "reamintesteVot");
    const d = await sursa.incarca();
    await tab("Vot și AG");
    await apasa("Reamintește celor care nu au votat");
    expect(spion).toHaveBeenCalledWith(d.voturi[0].id);
    expect(toast().textContent).toMatch(/^Reminder trimis către (1 locatar|\d+ locatari) cu cont, din 6 apartamente$/);
  });

  it("reamintirea esuata arata eroarea", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "reamintesteVot").mockRejectedValue(new Error("Votul s-a inchis."));
    await tab("Vot și AG");
    await apasa("Reamintește celor care nu au votat");
    expect(toast().textContent).toBe("Votul s-a inchis.");
  });

  it("vot inchis, vot fara lista de nevotanti si vot la care au votat toti", async () => {
    await deschideComunicare({
      modifica: (d) => {
        const v = d.voturi[0];
        d.voturi = [
          { ...v, id: "v1", titlu: "Vot închis", inchideLa: "2026-09-10T18:00:00+03:00" },
          { ...v, id: "v2", titlu: "Vot fără lista", nevotate: null, votanti: 0, totalApartamente: 0 },
          { ...v, id: "v3", titlu: "Vot complet", nevotate: [] },
        ];
      },
    });
    await tab("Vot și AG");
    const card = (t) => within(zonaCu([t, "Prezența la vot"]));
    expect(card("Vot închis").getByText("Închis")).toBeTruthy();
    expect(card("Vot închis").getByText(/^Nu au votat:/)).toBeTruthy();
    expect(card("Vot închis").queryByRole("button", { name: "Reamintește celor care nu au votat" })).toBeNull();
    expect(card("Vot fără lista").getByText("0 din 0")).toBeTruthy();
    expect(card("Vot fără lista").queryByText(/^Nu au votat/)).toBeNull();
    expect(card("Vot complet").queryByText(/^Nu au votat/)).toBeNull();
    expect(butoane("Reamintește celor care nu au votat")).toHaveLength(0);
  });

  it("deschide un vot cu pana la cinci variante", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "deschideVot");
    await tab("Vot și AG");
    await apasa("Deschide un vot nou");
    const f = () => inDialog("Vot nou");
    const deschide = () => f().getByRole("button", { name: "Deschide votul" });
    expect(dezactivat(deschide())).toBe(true);
    await scrieIn("Vot nou", "Ce se votează", "Vopsirea gardului");
    await scrieIn("Vot nou", "Detalii", "Două culori");
    await scrieIn("Vot nou", "Varianta 1", "Verde");
    expect(dezactivat(deschide())).toBe(true);
    await scrieIn("Vot nou", "Varianta 2", "Gri");
    expect(dezactivat(deschide())).toBe(true);
    await scrieIn("Vot nou", "Votul se închide pe", "2026-10-15");
    expect(dezactivat(deschide())).toBe(false);
    for (let i = 0; i < 3; i += 1) await apasa(f().getByRole("button", { name: "Adaugă o variantă" }));
    expect(f().getByLabelText("Varianta 5")).toBeTruthy();
    expect(f().queryByRole("button", { name: "Adaugă o variantă" })).toBeNull();
    await scrieIn("Vot nou", "Varianta 3", "Maro");
    await scrieIn("Vot nou", "Cum se numără voturile", "cota");
    await apasa(deschide());
    expect(spion).toHaveBeenCalledWith({ titlu: "Vopsirea gardului", descriere: "Două culori", optiuni: ["Verde", "Gri", "Maro", "", ""], inchideLa: "2026-10-15", numarare: "cota" });
    expect(toast().textContent).toBe("Votul a fost deschis");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Vopsirea gardului")).toBeTruthy();
  });

  it("un vot refuzat lasa formularul deschis", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "deschideVot").mockRejectedValue(new Error("Data de inchidere trebuie sa fie in viitor."));
    await tab("Vot și AG");
    await apasa("Deschide un vot nou");
    await scrieIn("Vot nou", "Ce se votează", "X");
    await scrieIn("Vot nou", "Varianta 1", "Da");
    await scrieIn("Vot nou", "Varianta 2", "Nu");
    await scrieIn("Vot nou", "Votul se închide pe", "2026-09-01");
    await apasa(inDialog("Vot nou").getByRole("button", { name: "Deschide votul" }));
    expect(toast().textContent).toBe("Data de inchidere trebuie sa fie in viitor.");
    expect(inDialog("Vot nou")).toBeTruthy();
    await apasa(inDialog("Vot nou").getByRole("button", { name: "Închide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("convoaca adunarea generala cu data, ora, loc si ordinea de zi", async () => {
    const { sursa } = await deschideComunicare();
    const spion = vi.spyOn(sursa, "convoacaAdunare");
    await tab("Vot și AG");
    await apasa("Convoacă adunarea");
    const f = () => inDialog("Convoacă adunarea generală");
    const trimite = () => f().getByRole("button", { name: "Trimite convocarea" });
    expect(f().getByLabelText("Ora").value).toBe("18:30");
    expect(dezactivat(trimite())).toBe(true);
    await scrieIn("Convoacă adunarea generală", "Data", "2026-10-20");
    await scrieIn("Convoacă adunarea generală", "Locul", "În curte");
    await scrieIn("Convoacă adunarea generală", "Ordinea de zi", "Bugetul pe 2027");
    expect(dezactivat(trimite())).toBe(false);
    await scrieIn("Convoacă adunarea generală", "Ora", "");
    expect(dezactivat(trimite())).toBe(true);
    await scrieIn("Convoacă adunarea generală", "Ora", "19:00");
    await apasa(trimite());
    expect(spion).toHaveBeenCalledWith({ dataOra: instantRomania("2026-10-20", "19:00"), loc: "În curte", ordineDeZi: "Bugetul pe 2027" });
    expect(toast().textContent).toBe("Convocarea a fost trimisă locatarilor cu cont");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Adunarea generală din 20 octombrie 2026")).toBeTruthy();
  });

  /* [K12] Fix J9 a corectat doar deschideVot (ora votului, in sursa): ora
     adunarii se construia inca cu new Date(`${data}T${ora}:00`), care
     citeste ora ca fiind cea a dispozitivului. Pe masina care ruleaza
     testele (Europe/Bucharest) bugul nu se vede - de-aia testul forteaza un
     alt fus, ca J9. */
  it("[K12] convoaca adunarea generala trimite ora Romaniei, indiferent de fusul dispozitivului", async () => {
    const ziOriginal = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      const { sursa } = await deschideComunicare();
      const spion = vi.spyOn(sursa, "convoacaAdunare");
      await tab("Vot și AG");
      await apasa("Convoacă adunarea");
      await scrieIn("Convoacă adunarea generală", "Data", "2026-10-20");
      await scrieIn("Convoacă adunarea generală", "Locul", "În curte");
      await scrieIn("Convoacă adunarea generală", "Ordinea de zi", "Bugetul pe 2027");
      await scrieIn("Convoacă adunarea generală", "Ora", "19:00");
      await apasa(inDialog("Convoacă adunarea generală").getByRole("button", { name: "Trimite convocarea" }));
      expect(spion).toHaveBeenCalledWith({ dataOra: instantRomania("2026-10-20", "19:00"), loc: "În curte", ordineDeZi: "Bugetul pe 2027" });
    } finally {
      process.env.TZ = ziOriginal;
    }
  });

  it("o convocare refuzata lasa formularul deschis", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "convoacaAdunare").mockRejectedValue(new Error("Data adunarii trebuie sa fie in viitor."));
    await tab("Vot și AG");
    await apasa("Convoacă adunarea");
    await scrieIn("Convoacă adunarea generală", "Data", "2026-09-01");
    await scrieIn("Convoacă adunarea generală", "Locul", "Aici");
    await scrieIn("Convoacă adunarea generală", "Ordinea de zi", "Ceva");
    await apasa(inDialog("Convoacă adunarea generală").getByRole("button", { name: "Trimite convocarea" }));
    expect(toast().textContent).toBe("Data adunarii trebuie sa fie in viitor.");
    expect(inDialog("Convoacă adunarea generală")).toBeTruthy();
    await apasa(inDialog("Convoacă adunarea generală").getByRole("button", { name: "Închide" }));
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
    await apasa("Încarcă un document");
    const f = () => inDialog("Document nou");
    const incarca = () => f().getByRole("button", { name: "Încarcă documentul" });
    expect(f().getByLabelText("Tip").value).toBe("altul");
    await scrieIn("Document nou", "Titlu", "Proces verbal AG octombrie");
    expect(dezactivat(incarca())).toBe(true);
    await scrieIn("Document nou", "Tip", "proces_verbal");
    const pdf = new File(["%PDF"], "pv.pdf", { type: "application/pdf" });
    await act(async () => { fireEvent.change(f().getByLabelText("Alege fișierul"), { target: { files: [pdf] } }); });
    expect(f().getByText("pv.pdf")).toBeTruthy();
    expect(f().getByRole("button", { name: "Alt fișier" })).toBeTruthy();
    await apasa(f().getByRole("button", { name: "Vizibil locatarilor" }));
    await apasa(incarca());
    expect(spion).toHaveBeenCalledWith({ titlu: "Proces verbal AG octombrie", tip: "proces_verbal", fisier: pdf, vizibil: false });
    expect(toast().textContent).toBe("Documentul a fost încărcat");
    expect(within(buton("Deschide Proces verbal AG octombrie")).getByText("Doar admin")).toBeTruthy();
  });

  it("un document refuzat lasa formularul deschis", async () => {
    const { sursa } = await deschideComunicare();
    vi.spyOn(sursa, "incarcaDocument").mockRejectedValue(new Error("Fișier prea mare"));
    await tab("Acte");
    await apasa("Încarcă un document");
    await scrieIn("Document nou", "Titlu", "Act");
    await act(async () => { fireEvent.change(inDialog("Document nou").getByLabelText("Alege fișierul"), { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } }); });
    await apasa(inDialog("Document nou").getByRole("button", { name: "Încarcă documentul" }));
    expect(toast().textContent).toBe("Fișier prea mare");
    expect(inDialog("Document nou")).toBeTruthy();
    await apasa(inDialog("Document nou").getByRole("button", { name: "Închide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tab-ul anunturi revine la apasare", async () => {
    await deschideComunicare();
    await tab("Acte");
    await tab("Anunțuri");
    expect(buton("Scrie un anunț")).toBeTruthy();
  });
});
