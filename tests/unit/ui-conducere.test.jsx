/* Conducerea asociatiei: presedintele si cenzorul vad tot blocul, dar nu pot
   schimba nimic; administratorul le trece mandatele in aplicatie (Comunicare
   > Conducere). */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { pornesteApp, sursaDemo, textEcran, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";
import { pornesteAdmin, apasa, buton, butoane, scrie, toast, inDialog, mergiLa } from "./ui-admin-ajutor.js";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const PRESEDINTE = "0722 118 005";
const CENZOR = "0730 415 900";

async function intraCa(telefon) {
  const s = sursaDemo();
  await s.intra(telefon, PAROLA);
  const r = await pornesteApp({ sursa: s });
  await screen.findByText("Panou administrator");
  return r;
}

const ecran = () => textEcran();

describe("presedintele si cenzorul vad blocul intreg", () => {
  it("presedintele are taburile administratorului si cifrele lui", async () => {
    await intraCa(PRESEDINTE);
    expect(screen.getByText("Presedinte, Bloc D14, scara A")).toBeTruthy();
    expect(screen.getByText("Panou administrator")).toBeTruthy();
    for (const t of ["Sumar", "Apartamente", "Facturi", "Sesizari", "Comunicare"]) {
      expect(screen.getByRole("tab", { name: new RegExp(`^${t}( \\d+)?$`) })).toBeTruthy();
    }
    const t = ecran();
    expect(t).toContain("Lista de plata august 2026");
    expect(t).toContain("Restante");
    expect(t).toContain("Fond de reparatii");
  });

  it("cenzorul, care nu are apartament in bloc, vede aceleasi ecrane", async () => {
    await intraCa(CENZOR);
    expect(screen.getByText("Cenzor, Bloc D14, scara A")).toBeTruthy();
    expect(screen.queryByText("Contul nu este legat de un apartament")).toBeNull();
    expect(ecran()).toContain("Lista de plata august 2026");
  });
});

describe("conducerea nu poate schimba nimic", () => {
  it("Sumar: fara reminder, fara instiintare si fara actiuni rapide", async () => {
    await intraCa(PRESEDINTE);
    expect(screen.queryByRole("button", { name: "Trimite reminder de plata" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Instiintare" })).toBeNull();
    expect(screen.queryByText("Actiuni rapide")).toBeNull();
    /* citirea ramane: PDF-ul de uz intern este exact ce verifica cenzorul */
    expect(screen.getByRole("button", { name: "Exporta lista PDF" })).toBeTruthy();
  });

  it("Apartamente: fisa se deschide, dar fara butoane care schimba ceva", async () => {
    await intraCa(PRESEDINTE);
    await mergiLa("Apartamente");
    await apasa(buton("Apartament 17"));
    const f = inDialog("Apartament 17");
    expect(f.getByText("Sold la zi")).toBeTruthy();
    expect(f.getByText("Defalcarea intretinerii, august 2026")).toBeTruthy();
    for (const nume of ["Inregistreaza incasare cash", "Trimite instiintare de plata", "Modifica numarul de persoane",
      "Adauga un locatar in aplicatie", "Corecteaza datele apartamentului", "Parola noua", "Inchide accesul"]) {
      expect(butoane(nume).length, nume).toBe(0);
    }
  });

  it("Citiri: le vede, dar nu valideaza si nu citeste contorul general", async () => {
    await intraCa(PRESEDINTE);
    await mergiLa("Apartamente");
    await apasa(screen.getByText("Citiri contoare"));
    expect(ecran()).toContain("De verificat");
    expect(screen.queryByText("Contorul general al blocului")).toBeNull();
    expect(butoane("Valideaza").length).toBe(0);
    expect(butoane("Respinge").length).toBe(0);
    expect(butoane("Estimeaza citirile lipsa").length).toBe(0);
  });

  it("Fonduri: soldul si miscarile se vad, iesirea nu se poate inregistra", async () => {
    await intraCa(PRESEDINTE);
    await mergiLa("Apartamente");
    await apasa(screen.getByText("Fonduri"));
    expect(ecran()).toContain("Fond de reparatii");
    expect(butoane("Inregistreaza o iesire").length).toBe(0);
  });

  it("Facturi: lista si defalcarea se vad, publicarea si stergerea nu", async () => {
    await intraCa(PRESEDINTE);
    await mergiLa("Facturi");
    expect(ecran().toLowerCase()).toContain("septembrie 2026 · in lucru");
    for (const nume of ["Adauga factura", "Publica lista", "Sterge", "Modifica", "Marcheaza platita"]) {
      expect(butoane(nume).length, nume).toBe(0);
    }
    /* [C9] previzualizarea trece prin aceeasi functie care pazeste publicarea
       (date_pentru_motor), deci butonul nu facea decat sa dea un mesaj tehnic */
    expect(butoane("Calculeaza lista pe apartamente").length).toBe(0);
  });

  /* [C1] Sesizarile raman intre locatar si administrator (H11). Ecranul nu
     mai poate arata ce a scris omul, dar nici nu are voie sa fie gol fara sa
     spuna de ce: conducerea vede ce s-a reclamat si in ce stadiu este. */
  it("Sesizari: le vede anonim, fara apartament, text sau poze", async () => {
    await intraCa(PRESEDINTE);
    await mergiLa("Sesizari");
    const t = ecran();
    expect(t).toContain("Le vezi fara nume");
    expect(t).toMatch(/Usa de la intrare nu se inchide singura/);
    expect(t).not.toMatch(/Ap\. \d/);
    await apasa(butoane(/Usa de la intrare/)[0]);
    expect(ecran()).toContain("Textul sesizarii il vede doar administratorul.");
    expect(screen.queryByLabelText("Raspuns pentru proprietar")).toBeNull();
    expect(butoane("Marcheaza rezolvata").length).toBe(0);
    expect(butoane("Preiau sesizarea").length).toBe(0);
  });

  it("Comunicare: anunturile, voturile si mandatele se vad, fara butoane de scris", async () => {
    await intraCa(PRESEDINTE);
    await mergiLa("Comunicare");
    expect(butoane("Scrie un anunt").length).toBe(0);
    await apasa(buton("Vot si AG"));
    expect(butoane("Deschide un vot nou").length).toBe(0);
    expect(butoane("Convoaca adunarea").length).toBe(0);
    expect(butoane("Reaminteste celor care nu au votat").length).toBe(0);
    await apasa(buton("Conducere"));
    expect(ecran()).toContain("Rodica Anton");
    expect(butoane("Numeste un presedinte sau un cenzor").length).toBe(0);
    expect(butoane("Incheie mandatul").length).toBe(0);
    await apasa(buton("Acte"));
    expect(butoane("Incarca un document").length).toBe(0);
  });

  it("Remindere: se vad setarile, dar comutatoarele lipsesc", async () => {
    await intraCa(PRESEDINTE);
    await mergiLa("Comunicare");
    await apasa(buton("Remindere"));
    expect(ecran()).toContain("Reminderele pleaca automat");
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    /* [C9] nici butoanele de trimis acum: comanda cere blocul administrat */
    expect(ecran()).not.toContain("Trimite acum");
    expect(butoane(/^Trimite reminderele/).length).toBe(0);
  });
});

describe("administratorul trece mandatele in aplicatie", () => {
  const laConducere = async (opt) => {
    const r = await pornesteAdmin({ tab: "Comunicare", ...opt });
    await apasa(buton("Conducere"));
    return r;
  };

  it("arata mandatele in curs, cu rolul si data de inceput", async () => {
    await laConducere();
    const t = ecran();
    expect(t).toContain("Rodica Anton");
    expect(t).toContain("Presedinte · din 1 iun 2026");
    expect(t).toContain("Sorin Tudose");
    expect(t).toContain("Cenzor · din 1 iun 2026");
  });

  it("numeste un locatar al blocului, ales din lista", async () => {
    const { sursa } = await laConducere();
    const spion = vi.spyOn(sursa, "numesteInConducere");
    await apasa(buton("Numeste un presedinte sau un cenzor"));
    const d = await sursa.incarca();
    const elena = d.apartamente.flatMap((a) => a.locatari).find((l) => l.nume === "Elena Marinescu");
    await apasa(screen.getByLabelText("Mandatul"));
    scrie("Mandatul", "cenzor");
    scrie("Cine", elena.profilId);
    await apasa(buton("Numeste"));
    expect(spion).toHaveBeenCalledWith(elena.profilId, "cenzor");
    expect(toast().textContent).toBe("Mandatul a fost inregistrat");
    expect(ecran()).toContain("Elena Marinescu");
  });

  it("numeste un cenzor din afara blocului, cu cont nou si parola aratata o data", async () => {
    const { sursa } = await laConducere();
    const spion = vi.spyOn(sursa, "adaugaInConducere");
    await apasa(buton("Numeste un presedinte sau un cenzor"));
    scrie("Numele lui", " Vasile Contabil ");
    scrie("Numarul lui de telefon", "0799 400 300");
    await apasa(buton("Numeste"));
    expect(spion).toHaveBeenCalledWith("Vasile Contabil", "0799 400 300", "presedinte");
    const t = ecran();
    expect(t).toContain("Intra cu numarul 0799 400 300");
    expect(t).toMatch(/[A-Z][a-z]+-[A-Z][a-z]+-\d{4}/);
    expect(t).toContain("Vasile Contabil");
  });

  it("incheie un mandat, cu confirmare, si il lasa in istoric", async () => {
    const { sursa } = await laConducere();
    const spion = vi.spyOn(sursa, "incheieMandat");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await apasa(butoane("Incheie mandatul")[0]);
    expect(spion).not.toHaveBeenCalled();

    window.confirm.mockReturnValue(true);
    await apasa(butoane("Incheie mandatul")[0]);
    expect(spion).toHaveBeenCalled();
    expect(toast().textContent).toBe("Mandatul a fost incheiat");
    expect(ecran()).toContain("Incheiat");
  });

  it("cineva care are deja cont primeste doar mandatul, fara parola noua", async () => {
    const { sursa } = await laConducere();
    /* numarul lui Gheorghe Voicu, locatar cu cont in demonstratie */
    await apasa(buton("Numeste un presedinte sau un cenzor"));
    scrie("Numele lui", "Gheorghe Voicu");
    scrie("Numarul lui de telefon", "0741 002 101");
    await apasa(buton("Numeste"));
    const t = ecran();
    expect(t).toContain("Persoana avea deja cont pe numarul 0741 002 101");
    expect(t).not.toMatch(/[A-Z][a-z]+-[A-Z][a-z]+-\d{4}/);
    const d = await sursa.incarca();
    expect(d.conducere.some((m) => m.nume === "Gheorghe Voicu" && !m.activPana)).toBe(true);
  });

  it("un mandat incheiat se poate redeschide, cu data de azi", async () => {
    const { sursa } = await laConducere();
    const cenzor = (await sursa.incarca()).conducere.find((m) => m.rol === "cenzor");
    await sursa.incheieMandat(cenzor.id);
    await sursa.numesteInConducere(cenzor.profilId, "cenzor");
    const dupa = (await sursa.incarca()).conducere.find((m) => m.profilId === cenzor.profilId && m.rol === "cenzor");
    expect(dupa).toMatchObject({ activDin: "2026-09-19", activPana: null });
  });

  it("dupa Gata, parola nu se mai vede pe ecran", async () => {
    await laConducere();
    await apasa(buton("Numeste un presedinte sau un cenzor"));
    scrie("Numele lui", "Vasile Contabil");
    scrie("Numarul lui de telefon", "0799 400 301");
    await apasa(buton("Numeste"));
    expect(ecran()).toMatch(/[A-Z][a-z]+-[A-Z][a-z]+-\d{4}/);
    await apasa(buton("Gata"));
    expect(ecran()).not.toMatch(/[A-Z][a-z]+-[A-Z][a-z]+-\d{4}/);
  });

  it("panoul se inchide si formularul se goleste dupa o numire din lista", async () => {
    const { sursa } = await laConducere();
    await apasa(buton("Numeste un presedinte sau un cenzor"));
    const d = await sursa.incarca();
    const ilie = d.apartamente.flatMap((a) => a.locatari).find((l) => l.nume === "Dan Ilie");
    scrie("Cine", ilie.profilId);
    await apasa(buton("Numeste"));
    expect(screen.queryByLabelText("Mandatul")).toBeNull();
    expect(ecran()).toContain("Dan Ilie");
  });

  it("un refuz lasa panoul deschis, cu mesajul pe ecran", async () => {
    const { sursa } = await laConducere();
    vi.spyOn(sursa, "adaugaInConducere").mockRejectedValue(new Error("Persoana are deja acest mandat, in curs."));
    await apasa(buton("Numeste un presedinte sau un cenzor"));
    scrie("Numele lui", "Cineva");
    scrie("Numarul lui de telefon", "0799 400 302");
    await apasa(buton("Numeste"));
    expect(toast().textContent).toBe("Persoana are deja acest mandat, in curs.");
    expect(screen.getByLabelText("Mandatul")).toBeTruthy();
  });

  it("un mandat fara numar de telefon nu arata un separator gol", async () => {
    await laConducere({ modifica: (d) => { d.conducere = d.conducere.map((m) => ({ ...m, telefon: null })); } });
    const t = ecran();
    expect(t).toContain("Presedinte · din 1 iun 2026");
    expect(t).not.toContain("din 1 iun 2026 · ");
  });

  it("panoul de numire se poate inchide fara sa numeasca pe nimeni", async () => {
    const { sursa } = await laConducere();
    const spion = vi.spyOn(sursa, "numesteInConducere");
    await apasa(buton("Numeste un presedinte sau un cenzor"));
    await apasa(screen.getByRole("button", { name: "Inchide" }));
    expect(screen.queryByLabelText("Mandatul")).toBeNull();
    expect(spion).not.toHaveBeenCalled();
  });

  it("fara niciun mandat, spune asta in loc sa lase un gol", async () => {
    await laConducere({ modifica: (d) => { d.conducere = []; } });
    expect(ecran()).toContain("Nimeni nu are inca mandat de presedinte sau de cenzor.");
  });
});

/* [C2] Legea 196/2018 cere ca presedintele sa fie proprietar in asociatie,
   deci presedintele care locuieste in bloc este regula, nu exceptia. Pana la
   auditul 4, numirea ii lua toate ecranele de locatar: nu mai transmitea
   indexul de apa, nu mai scria o sesizare si nu mai vota. */
describe("presedintele care locuieste in bloc", () => {
  async function elenaPresedinte() {
    const s = sursaDemo();
    await s.intra(ADMIN, PAROLA);
    const d = await s.incarca();
    const elena = d.apartamente.find((a) => a.numar === "17").locatari[0];
    await s.numesteInConducere(elena.profilId, "presedinte");
    await s.intra(LOCATAR, PAROLA);
    const r = await pornesteApp({ sursa: s });
    await screen.findByText("Apartament 17, Bloc D14, scara A");
    return r;
  }

  it("porneste in apartamentul lui, cu ecranele de locatar", async () => {
    await elenaPresedinte();
    for (const t of ["Acasa", "Plata", "Contoare", "Sesizari", "Bloc"]) {
      expect(screen.getByRole("tab", { name: new RegExp(`^${t}( \\d+)?$`) })).toBeTruthy();
    }
    expect(screen.queryByText("Panou administrator")).toBeNull();
  });

  it("isi transmite indexul si isi scrie sesizarea, ca orice locatar", async () => {
    await elenaPresedinte();
    await mergiLa("Contoare");
    expect(butoane("Trimite indexul").length).toBe(1);
    await mergiLa("Sesizari");
    expect(butoane("Sesizare noua").length).toBe(1);
  });

  it("deschide verificarea blocului din tabul Bloc si se intoarce de unde a plecat", async () => {
    await elenaPresedinte();
    await mergiLa("Bloc");
    expect(ecran()).toContain("Esti presedinte al asociatiei");
    await apasa(buton("Verifica blocul"));
    await screen.findByText("Panou administrator");
    expect(screen.getByText("Presedinte, Bloc D14, scara A")).toBeTruthy();
    /* si acolo tot nu scrie nimic */
    expect(butoane("Trimite reminder de plata").length).toBe(0);
    await apasa(buton("Inapoi la apartamentul meu"));
    await screen.findByText("Apartament 17, Bloc D14, scara A");
    expect(screen.getByRole("tab", { name: /^Acasa/ })).toBeTruthy();
  });
});
