/* Utilizabilitate si regresii din auditul 2: F21 (pluralul romanesc peste 19),
   F22 (jargonul explicat pe loc), F23 (o singura intrare spre plata),
   F25 (confirmarea anularii platii catre furnizor), R5 (ordinea platilor),
   R7 (citirea estimata) si R8 (comparatorul citirilor). */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, ADMIN, LOCATAR } from "./ajutor.jsx";
import { apasa, tab, toast } from "./ui-baza-ajutor.jsx";

const AP = "apa-35";
const ecran = (c) => c.querySelector(".ab-scroll").textContent;

describe("[F21] pluralul romanesc peste nouasprezece cere de", () => {
  it("reminderele si butoanele de zile", async () => {
    const { container } = await pornesteApp({ email: ADMIN });
    await tab("Comunicare");
    await apasa("Remindere");
    expect(ecran(container)).toContain("La 30 de zile de la scadenta");
    expect(ecran(container)).toContain("Cu 5 zile inainte de termenul de citire");
    expect(screen.getAllByRole("button", { name: "30 de zile" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "15 zile" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "1 zi" }).length).toBeGreaterThan(0);
  });

  it("numarul de destinatari dintr-un reminder", async () => {
    const { sursa } = await pornesteApp({ email: ADMIN });
    vi.spyOn(sursa, "trimiteReminder").mockResolvedValue({ destinatari: 21, apartamente: 3 });
    await apasa("Trimite reminder de plata");
    expect(toast().textContent).toBe("Reminder trimis catre 21 de locatari, din 3 apartamente cu sold");
  });

  it("zilele de intarziere de pe fisa restantierului", async () => {
    const { container } = await pornesteApp({
      email: ADMIN,
      modifica: (d) => { d.datorii.filter((x) => x.rest > 0).forEach((x) => { x.scadenta = "2026-08-10"; }); },
    });
    expect(ecran(container)).toContain("40 de zile intarziere");
  });
});

describe("[F22] cuvintele de pe hartie, explicate acolo unde apar", () => {
  it("total repartizat si cota indiviza, pe ecranul de intretinere", async () => {
    const { container } = await pornesteApp({ email: LOCATAR });
    await tab("Plata");
    const text = ecran(container);
    expect(text).toContain("Repartizat inseamna impartit pe apartamente");
    expect(text).toContain("Cota indiviza este partea ta din proprietatea comuna a blocului");
  });

  it("fondul de rulment si fondul de reparatii, pe ecranul blocului", async () => {
    const { container } = await pornesteApp({ email: LOCATAR });
    await tab("Bloc");
    await apasa("Fonduri");
    const text = ecran(container);
    expect(text).toContain("Fondul de rulment este suma pusa deoparte de fiecare apartament");
    expect(text).toContain("Fondul de reparatii strange bani pentru lucrarile mari ale blocului");
  });
});

describe("[F23] Acasa are o singura intrare spre plata", () => {
  it("cardul de sus duce la plata, lista De facut nu repeta actiunea", async () => {
    await pornesteApp({ email: LOCATAR });
    expect(screen.getByRole("button", { name: "Cum platesc" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Plateste intretinerea" })).toBeNull();
  });
});

describe("[F25] anularea platii catre furnizor se confirma", () => {
  async function laFacturiPublicate() {
    const r = await pornesteApp({ email: ADMIN });
    await tab("Facturi");
    await apasa("aug 26");
    return r;
  }

  it("fara acord nu se anuleaza nimic", async () => {
    const { sursa } = await laFacturiPublicate();
    const marcheaza = vi.spyOn(sursa, "marcheazaFacturaPlatita");
    const intreaba = vi.spyOn(window, "confirm").mockReturnValue(false);
    await apasa("Anuleaza plata furnizor");
    expect(intreaba).toHaveBeenCalled();
    expect(marcheaza).not.toHaveBeenCalled();
  });

  it("cu acord, plata catre furnizor se anuleaza", async () => {
    const { sursa } = await laFacturiPublicate();
    const marcheaza = vi.spyOn(sursa, "marcheazaFacturaPlatita");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await apasa("Anuleaza plata furnizor");
    expect(marcheaza).toHaveBeenCalledTimes(1);
    expect(marcheaza.mock.calls[0][1]).toBe(false);
  });
});

describe("[R5] platile se ordoneaza dupa momentul lor, nu dupa sirul ISO", () => {
  it("schimbarea de fus orar nu inverseaza ultimele doua plati", async () => {
    const plata = (id, suma, confirmataLa) => ({
      id, apartamentId: AP, suma, stare: "confirmata", metoda: "transfer", confirmataLa,
      referinta: id, inregistrataDe: null, chitanta: null, alocari: [],
    });
    const { container } = await pornesteApp({
      email: LOCATAR,
      /* 23:30+02:00 este mai tarziu decat 00:10+03:00 din ziua urmatoare */
      modifica: (d) => {
        d.plati = [plata("pl-a", 111, "2026-09-10T00:10:00+03:00"), plata("pl-b", 222, "2026-09-09T23:30:00+02:00")];
      },
    });
    await tab("Plata");
    await apasa("Platile mele");
    const text = ecran(container);
    expect(text.indexOf("222,00")).toBeLessThan(text.indexOf("111,00"));
  });
});

describe("[R7] citirea estimata se vede ca estimare", () => {
  const cuEstimare = (d) => {
    d.citiri.filter((c) => c.apartamentId === AP && c.luna === "2026-09").forEach((c) => { c.sursa = "estimat"; c.stare = "validata"; });
  };

  it("nu scrie ca a verificat-o administratorul", async () => {
    const { container } = await pornesteApp({
      email: LOCATAR,
      modifica: (d) => {
        d.citiri.push({
          id: "cit-est-1", contorId: "con-111", apartamentId: AP, tip: "rece", luna: "2026-09",
          indexAnterior: 244.5, indexCurent: 250.1, consum: 5.6, sursa: "estimat", stare: "validata",
          transmisaLa: "2026-09-19T08:00:00+03:00", pozaCale: null, motivRespingere: null,
        }, {
          id: "cit-est-2", contorId: "con-112", apartamentId: AP, tip: "calda", luna: "2026-09",
          indexAnterior: 133.7, indexCurent: 137.2, consum: 3.5, sursa: "estimat", stare: "validata",
          transmisaLa: "2026-09-19T08:00:00+03:00", pozaCale: null, motivRespingere: null,
        });
        cuEstimare(d);
      },
    });
    await tab("Contoare");
    const text = ecran(container);
    expect(text).not.toContain("a fost verificat de administrator");
    expect(text).toContain("a fost completat cu o estimare");
    expect(screen.getAllByText("Estimat").length).toBeGreaterThan(0);
    expect(text).toContain("Estimarea se regleaza la prima citire reala");
  });
});

describe("[R8] citirile din aceeasi luna nu se amesteca", () => {
  it("indexul anterior nu depinde de ordinea randurilor din baza", async () => {
    const citire = (id, indexCurent) => ({
      id, contorId: "con-111", apartamentId: AP, tip: "rece", luna: "2026-08",
      indexAnterior: 230, indexCurent, consum: 1, sursa: "locatar", stare: "validata",
      transmisaLa: "2026-08-20T10:00:00+03:00", pozaCale: null, motivRespingere: null,
    });
    const { container } = await pornesteApp({
      email: LOCATAR,
      modifica: (d) => {
        d.citiri = d.citiri.filter((c) => c.contorId !== "con-111");
        d.citiri.push(citire("cit-a", 250), citire("cit-b", 255), citire("cit-c", 260));
      },
    });
    await tab("Contoare");
    expect(ecran(container)).toContain("Apa rece, index anterior 250,0");
  });
});
