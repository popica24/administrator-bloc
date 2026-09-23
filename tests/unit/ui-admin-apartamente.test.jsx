/* Lista apartamentelor si fisa unui apartament (ListaApartamente, FisaApartament) */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { pornesteAdmin, apasa, buton, butoane, scrie, toast, dialog, inDialog, dezactivat } from "./ui-admin-ajutor.js";
import { zonaCu } from "./ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const apDupaNumar = async (sursa, numar) => (await sursa.incarca()).apartamente.find((a) => a.numar === numar);
const deschideFisa = (numar) => apasa(buton(`Apartament ${numar}`));
const randuri = () => butoane(/^Apartament /).map((b) => b.getAttribute("aria-label").replace("Apartament ", ""));

/* [K9] Fisa arata "Sold la zi" din resturi; un avans (bani platiti si inca
   nealocati pe nicio datorie) nu aparea nicaieri. */
describe("[K9] fisa apartamentului, avansul", () => {
  it("arata avansul nealocat, cand exista", async () => {
    await pornesteAdmin({
      tab: "Apartamente",
      modifica: (d) => {
        const ap = d.apartamente.find((a) => a.numar === "1");
        d.plati.push({
          id: "pla-avans-k9", apartamentId: ap.id, suma: 250, metoda: "transfer", stare: "confirmata",
          confirmataLa: "2026-09-18T10:00:00Z", referinta: null, inregistrataDe: null, chitanta: null, alocari: [],
        });
      },
    });
    await deschideFisa("1");
    const f = inDialog("Apartament 1");
    expect(f.getByText("Avans nealocat: 250,00 lei. Se scade din urmatoarea lista.")).toBeTruthy();
  });
});

/* [B4] Fisa apartamentului si Sumarul administratorului trebuie sa numere la
   fel. restanta() aduna doar randurile cu rest pozitiv, iar financiar.situatie_bloc
   aduna restul tuturor datoriilor scadente: un apartament cu un credit pe un
   rand (o corectie in jos dupa o recalculare) aparea in Sumar la "fara
   restanta" si pe fisa lui cu "Restanta 400". */
describe("[B4] restanta apartamentului, aceeasi cifra peste tot", () => {
  it("creditul de pe un rand scade restanta aratata pe fisa", async () => {
    await pornesteAdmin({
      tab: "Apartamente",
      modifica: (d) => {
        const ap = d.apartamente.find((a) => a.numar === "1");
        d.datorii.push({
          id: "dat-b4-plus", apartamentId: ap.id, tip: "corectie", luna: "2026-08", listaId: null,
          suma: 400, rest: 400, scadenta: "2026-09-01", descriere: "Corectie in plus", documentId: null,
          creatLa: "2026-09-01T10:00:00Z",
        });
        d.datorii.push({
          id: "dat-b4-minus", apartamentId: ap.id, tip: "corectie", luna: "2026-08", listaId: null,
          suma: -400, rest: -400, scadenta: "2026-09-01", descriere: "Corectie in minus", documentId: null,
          creatLa: "2026-09-02T10:00:00Z",
        });
      },
    });
    const ap1 = within(buton("Apartament 1"));
    expect(ap1.queryByText(/^Restanta /)).toBeNull();
  });
});

describe("ListaApartamente", () => {
  it("arata toate apartamentele in ordine, cu etaj, persoane, cota si badge", async () => {
    await pornesteAdmin({ tab: "Apartamente" });
    expect(screen.getByText("20 apartamente, 49 persoane declarate")).toBeTruthy();
    expect(randuri()).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
    const ap1 = within(buton("Apartament 1"));
    expect(ap1.getByText("Etaj parter · 2 pers. · cota 4,01%")).toBeTruthy();
    expect(ap1.getByText("Achitat")).toBeTruthy();
    const ap17 = within(buton("Apartament 17"));
    expect(ap17.getByText("Etaj 4 · 3 pers. · cota 4,63%")).toBeTruthy();
    expect(ap17.getByText("In termen")).toBeTruthy();
    const ap11 = within(buton("Apartament 11"));
    expect(ap11.getByText("Restanta 2.917,41")).toBeTruthy();
  });

  it("totalul lunii pe fiecare rand vine din lista publicata", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const date = await sursa.incarca();
    const lista = date.liste.find((l) => l.stare === "publicata");
    const ap = date.apartamente.find((a) => a.numar === "17");
    const total = date.datorii.find((d) => d.listaId === lista.id && d.apartamentId === ap.id && d.tip === "intretinere").suma;
    expect(within(buton("Apartament 17")).getByText(total.toFixed(2).replace(".", ","))).toBeTruthy();
  });

  it("filtrele: cu sold si cu restante", async () => {
    await pornesteAdmin({ tab: "Apartamente" });
    await apasa(screen.getByText("Cu sold 6"));
    expect(randuri()).toEqual(["3", "6", "11", "15", "17", "19"]);
    await apasa(screen.getByText("Restante 5"));
    expect(randuri()).toEqual(["3", "6", "11", "15", "19"]);
    await apasa(screen.getByText("Toate 20"));
    expect(randuri()).toHaveLength(20);
  });

  it("cautarea dupa nume sau dupa numarul exact", async () => {
    await pornesteAdmin({ tab: "Apartamente" });
    await act(async () => { scrie("Cauta dupa nume sau numar", "  FAMILIA "); });
    expect(randuri()).toEqual(["3", "8", "11", "15", "19"]);
    await act(async () => { scrie("Cauta dupa nume sau numar", "1"); });
    expect(randuri()).toEqual(["1"]);
    await act(async () => { scrie("Cauta dupa nume sau numar", "nimeni"); });
    expect(screen.getByText("Niciun rezultat")).toBeTruthy();
    expect(randuri()).toHaveLength(0);
  });

  it("cautarea se combina cu filtrul", async () => {
    await pornesteAdmin({ tab: "Apartamente" });
    await apasa(screen.getByText("Restante 5"));
    await act(async () => { scrie("Cauta dupa nume sau numar", "familia"); });
    expect(randuri()).toEqual(["3", "11", "15", "19"]);
  });

  it("[NOU-1] numerele cu litera se ordoneaza langa numarul lor", async () => {
    /* Comparatorul Number(a) - Number(b) || localeCompare nu este consecvent pentru "3A" */
    await pornesteAdmin({
      tab: "Apartamente",
      modifica: (d) => { d.apartamente.find((a) => a.numar === "20").numar = "3A"; },
    });
    expect(randuri().slice(0, 5)).toEqual(["1", "2", "3", "3A", "4"]);
  });

  it("fara lista publicata, totalul lunii este 0 si fisa nu are defalcare", async () => {
    await pornesteAdmin({ tab: "Apartamente", modifica: (d) => { d.liste = d.liste.filter((l) => l.stare !== "publicata"); } });
    expect(within(buton("Apartament 1")).getByText("0,00")).toBeTruthy();
    await deschideFisa("1");
    expect(screen.queryByText(/Defalcarea intretinerii/)).toBeNull();
  });
});

describe("FisaApartament, date si sold", () => {
  it("deschide si inchide fisa", async () => {
    await pornesteAdmin({ tab: "Apartamente" });
    await deschideFisa("1");
    const f = inDialog("Apartament 1");
    expect(f.getAllByText("Gheorghe Voicu").length).toBe(2);
    expect(f.getByText("Parter")).toBeTruthy();
    expect(f.getByText("42,5 mp")).toBeTruthy();
    expect(f.getByText("Scutit")).toBeTruthy();
    expect(f.getByText("Nu are nimic de plata.")).toBeTruthy();
    await apasa(f.getByRole("button", { name: "Inchide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("apartament cu restanta: datoriile deschise, restul si defalcarea listei", async () => {
    await pornesteAdmin({ tab: "Apartamente" });
    await deschideFisa("15");
    const f = inDialog("Apartament 15");
    expect(f.getByText("Plateste")).toBeTruthy();
    expect(f.getByText("Intretinere iunie 2026, scadenta 25 iul 2026 (rest)")).toBeTruthy();
    expect(f.getByText("Intretinere august 2026, scadenta 25 sep 2026")).toBeTruthy();
    expect(f.getByText("Penalizare septembrie 2026, scadenta 1 sep 2026")).toBeTruthy();
    expect(f.getByText("Defalcarea intretinerii, august 2026")).toBeTruthy();
    expect(f.getByText("Total august")).toBeTruthy();
    expect(f.getAllByText("870,74").length).toBeGreaterThan(0);
  });

  it("restanta preluata si datorii de tip necunoscut sau fara luna", async () => {
    await pornesteAdmin({
      tab: "Apartamente",
      modifica: (d) => {
        const ap = d.apartamente.find((a) => a.numar === "11");
        d.datorii.push({ id: "dat-x", apartamentId: ap.id, tip: "taxa_speciala", luna: null, suma: 10, rest: 10, scadenta: "2026-12-01", listaId: null });
      },
    });
    await deschideFisa("11");
    const f = inDialog("Apartament 11");
    expect(f.getByText("Restanta preluata mai 2026, scadenta 25 mai 2026")).toBeTruthy();
    expect(f.getByText("taxa_speciala, scadenta 1 dec 2026")).toBeTruthy();
  });

  it("fara suprafata declarata apare liniuta", async () => {
    await pornesteAdmin({ tab: "Apartamente", modifica: (d) => { d.apartamente.find((a) => a.numar === "2").mp = null; } });
    await deschideFisa("2");
    expect(zonaCu(["Suprafata", "-"], 1).textContent).toBe("Suprafata-");
  });
});

describe("FisaApartament, incasare cash", () => {
  it("precompleteaza soldul, emite chitanta si o descarca", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "inregistreazaIncasare");
    const ap = await apDupaNumar(sursa, "3");
    await deschideFisa("3");
    await apasa("Inregistreaza incasare cash");
    const camp = screen.getByLabelText("Suma primita");
    expect(camp.value).toBe("2.319,36");
    await apasa("Emite chitanta");
    expect(spion).toHaveBeenCalledWith(ap.id, 2319.36, "numerar", expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4/));
    expect(toast().textContent).toBe("Incasare inregistrata, chitanta emisa");
    const f = inDialog("Apartament 3");
    expect(f.getByText("Incasare inregistrata: 2.319,36 lei")).toBeTruthy();
    expect(f.getByText("Chitanta AP118 nr. 000464. Locatarul o vede si in aplicatie.")).toBeTruthy();
    expect(f.getByText("Nu are nimic de plata.")).toBeTruthy();
    expect(screen.queryByLabelText("Suma primita")).toBeNull();

    const nume = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { nume.push(this.download); });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    await apasa("Descarca chitanta");
    expect(nume).toEqual(["chitanta-464.pdf"]);
  });

  it("fara sold, campul porneste gol si butonul e dezactivat pana se scrie o suma", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "inregistreazaIncasare");
    await deschideFisa("1");
    await apasa("Inregistreaza incasare cash");
    const camp = screen.getByLabelText("Suma primita");
    expect(camp.value).toBe("");
    expect(camp.getAttribute("placeholder")).toBe("0,00");
    expect(dezactivat(buton("Emite chitanta"))).toBe(true);
    await apasa("Emite chitanta");
    expect(spion).not.toHaveBeenCalled();
    await act(async () => { scrie("Suma primita", "abc"); });
    expect(dezactivat(buton("Emite chitanta"))).toBe(true);
    await act(async () => { scrie("Suma primita", "150,5"); });
    expect(dezactivat(buton("Emite chitanta"))).toBe(false);
    await apasa("Emite chitanta");
    expect(spion).toHaveBeenCalledWith((await apDupaNumar(sursa, "1")).id, 150.5, "numerar", expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4/));
    expect(inDialog("Apartament 1").getByText("Incasare inregistrata: 150,50 lei")).toBeTruthy();
  });

  it("banii veniti prin banca se confirma ca transfer", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "inregistreazaIncasare");
    const ap = await apDupaNumar(sursa, "3");
    await deschideFisa("3");
    await apasa("Inregistreaza incasare cash");
    await apasa(buton("Prin transfer bancar"));
    await apasa("Emite chitanta");
    expect(spion).toHaveBeenCalledWith(ap.id, 2319.36, "transfer", expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4/));
    expect(toast().textContent).toBe("Incasare inregistrata, chitanta emisa");
  });

  /* [B7] A doua incasare din aceeasi fisa pornea cu "Prin transfer bancar"
     preselectat, de la prima: daca administratorul nu observa, chitanta si
     registrul spuneau transfer pentru bani primiti in mana, iar stornare nu
     exista. */
  it("[B7] a doua incasare porneste iar de la numerar, nu de la transfer", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "inregistreazaIncasare");
    const ap = await apDupaNumar(sursa, "3");
    await deschideFisa("3");
    await apasa("Inregistreaza incasare cash");
    await apasa(buton("Prin transfer bancar"));
    await act(async () => { scrie("Suma primita", "100"); });
    await apasa("Emite chitanta");
    expect(spion).toHaveBeenLastCalledWith(ap.id, 100, "transfer", expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4/));

    await apasa("Inregistreaza incasare cash");
    await act(async () => { scrie("Suma primita", "50"); });
    await apasa("Emite chitanta");
    expect(spion).toHaveBeenLastCalledWith(ap.id, 50, "numerar", expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4/));
  });

  it("renunta inchide formularul fara incasare", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "inregistreazaIncasare");
    await deschideFisa("3");
    await apasa("Inregistreaza incasare cash");
    await apasa("Renunta");
    expect(screen.queryByLabelText("Suma primita")).toBeNull();
    expect(spion).not.toHaveBeenCalled();
  });

  /* [B2] Reincercarea dupa o cadere trimite aceeasi cheie a cererii: daca
     prima cerere ajunsese totusi la server, a doua intoarce aceeasi plata, in
     loc sa emita inca o chitanta pe aceiasi bani. */
  it("[B2] reincercarea dupa o eroare trimite aceeasi cheie a cererii", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "inregistreazaIncasare")
      .mockRejectedValueOnce(new Error("Serverul nu raspunde. Incearca din nou."));
    await deschideFisa("3");
    await apasa("Inregistreaza incasare cash");
    await apasa("Emite chitanta");
    expect(toast().textContent).toBe("Serverul nu raspunde. Incearca din nou.");
    await apasa("Emite chitanta");
    expect(spion).toHaveBeenCalledTimes(2);
    expect(spion.mock.calls[1][3]).toBe(spion.mock.calls[0][3]);
  });

  it("o incasare refuzata lasa formularul deschis, cu suma", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    vi.spyOn(sursa, "inregistreazaIncasare").mockRejectedValue(new Error("Suma trebuie sa fie mai mare decat zero."));
    await deschideFisa("3");
    await apasa("Inregistreaza incasare cash");
    await apasa("Emite chitanta");
    expect(toast().textContent).toBe("Suma trebuie sa fie mai mare decat zero.");
    expect(screen.getByLabelText("Suma primita").value).toBe("2.319,36");
  });

  it("o plata fara chitanta nu afiseaza cardul de chitanta", async () => {
    let faraChitanta = false;
    const { sursa } = await pornesteAdmin({
      tab: "Apartamente",
      modifica: (d) => { if (faraChitanta) d.plati.forEach((p) => { if (p.metoda === "numerar") p.chitanta = null; }); },
    });
    faraChitanta = true;
    await deschideFisa("3");
    await apasa("Inregistreaza incasare cash");
    await apasa("Emite chitanta");
    expect(sursa).toBeTruthy();
    expect(screen.queryByText(/Incasare inregistrata:/)).toBeNull();
    expect(buton("Inregistreaza incasare cash")).toBeTruthy();
  });

  it("[F3] dublu apasat pe 'Emite chitanta' inregistreaza o singura plata", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "inregistreazaIncasare");
    await deschideFisa("3");
    await apasa("Inregistreaza incasare cash");
    const b = buton("Emite chitanta");
    await act(async () => { fireEvent.click(b); fireEvent.click(b); });
    expect(spion).toHaveBeenCalledTimes(1);
  });

  it("[F5] '1.500' scris de administrator inseamna 1500 lei, nu 1,50", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "inregistreazaIncasare");
    await deschideFisa("3");
    await apasa("Inregistreaza incasare cash");
    await act(async () => { scrie("Suma primita", "1.500"); });
    await apasa("Emite chitanta");
    expect(spion.mock.calls[0][1]).toBe(1500);
  });
});

describe("FisaApartament, instiintare", () => {
  it("apartament cu cont, apartament fara cont, apartament fara restanta", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "trimiteInstiintare");
    await deschideFisa("3");
    await apasa("Trimite instiintare de plata");
    expect(spion).toHaveBeenLastCalledWith((await apDupaNumar(sursa, "3")).id);
    expect(toast().textContent).toBe("Instiintarea a fost trimisa in aplicatie");
    await apasa(inDialog("Apartament 3").getByRole("button", { name: "Inchide" }));

    await deschideFisa("11");
    await apasa("Trimite instiintare de plata");
    expect(toast().textContent).toBe("Apartamentul nu are cont in aplicatie. Instiintarea se da pe hartie.");
    await apasa(inDialog("Apartament 11").getByRole("button", { name: "Inchide" }));

    await deschideFisa("17");
    expect(dezactivat(buton("Trimite instiintare de plata"))).toBe(true);
  });

  it("o instiintare esuata arata doar eroarea", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    vi.spyOn(sursa, "trimiteInstiintare").mockRejectedValue(new Error("Nu merge"));
    await deschideFisa("3");
    await apasa("Trimite instiintare de plata");
    expect(toast().textContent).toBe("Nu merge");
  });
});

describe("FisaApartament, numarul de persoane", () => {
  it("schimba numarul de la o luna aleasa, cu motiv, si apare in istoric", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "schimbaPersoane");
    const ap = await apDupaNumar(sursa, "1");
    await deschideFisa("1");
    await apasa("Modifica numarul de persoane");
    const luna = screen.getByLabelText("Incepand cu luna");
    expect([...luna.options].map((o) => o.value)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(luna.value).toBe("2026-09");
    expect(dezactivat(buton("Salveaza"))).toBe(true);
    await act(async () => { scrie("Numar nou de persoane", "doi"); });
    expect(dezactivat(buton("Salveaza"))).toBe(true);
    await act(async () => {
      scrie("Numar nou de persoane", "3");
      fireEvent.change(luna, { target: { value: "2026-10" } });
      scrie("Motivul", "  Declaratie noua  ");
    });
    await apasa("Salveaza");
    expect(spion).toHaveBeenCalledWith(ap.id, 3, "2026-10", "Declaratie noua");
    expect(toast().textContent).toBe("Din octombrie 2026 se calculeaza 3 persoane");
    const f = inDialog("Apartament 1");
    expect(f.getByText("Din octombrie 2026, declaratie noua")).toBeTruthy();
    expect(f.getByText("3 pers.")).toBeTruthy();
    expect(screen.queryByLabelText("Numar nou de persoane")).toBeNull();

    /* Luna folosita nu mai poate fi aleasa a doua oara */
    await apasa("Modifica numarul de persoane");
    expect([...screen.getByLabelText("Incepand cu luna").options].map((o) => o.value)).toEqual(["2026-09", "2026-11"]);
    await apasa("Renunta");
    expect(screen.queryByLabelText("Numar nou de persoane")).toBeNull();
  });

  it("fara luna aleasa se foloseste prima luna libera", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "schimbaPersoane");
    await deschideFisa("1");
    await apasa("Modifica numarul de persoane");
    const luna = screen.getByLabelText("Incepand cu luna");
    /* Selectul fara nicio optiune aleasa trimite "" */
    await act(async () => {
      fireEvent.change(luna, { target: { value: "" } });
      scrie("Numar nou de persoane", "0");
    });
    await apasa("Salveaza");
    expect(spion).toHaveBeenCalledWith((await apDupaNumar(sursa, "1")).id, 0, "2026-09", "");
    expect(inDialog("Apartament 1").getByText("Din septembrie 2026")).toBeTruthy();
  });

  it("toate cele trei luni au deja o modificare: nu se poate salva", async () => {
    await pornesteAdmin({
      tab: "Apartamente",
      modifica: (d) => {
        const ap = d.apartamente.find((a) => a.numar === "1");
        ["2026-09", "2026-10", "2026-11"].forEach((l) => ap.istoricPersoane.push({ valabilDin: l, numar: 2, motiv: null }));
      },
    });
    await deschideFisa("1");
    await apasa("Modifica numarul de persoane");
    const luna = screen.getByLabelText("Incepand cu luna");
    expect(luna.options).toHaveLength(0);
    await act(async () => { scrie("Numar nou de persoane", "3"); });
    expect(dezactivat(buton("Salveaza"))).toBe(true);
    expect(inDialog("Apartament 1").getByText("Din noiembrie 2026")).toBeTruthy();
  });

  it("o modificare refuzata lasa formularul deschis", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    vi.spyOn(sursa, "schimbaPersoane").mockRejectedValue(new Error("Exista deja o modificare pentru luna aceasta. Istoricul nu se rescrie."));
    await deschideFisa("1");
    await apasa("Modifica numarul de persoane");
    await act(async () => { scrie("Numar nou de persoane", "3"); });
    await apasa("Salveaza");
    expect(toast().textContent).toMatch(/Exista deja o modificare/);
    expect(screen.getByLabelText("Numar nou de persoane").value).toBe("3");
  });
});

describe("FisaApartament, contul locatarului si accesul", () => {
  it("face contul pe numarul de telefon si arata parola o singura data", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "adaugaLocatar");
    const ap = await apDupaNumar(sursa, "2");
    await deschideFisa("2");
    expect(inDialog("Apartament 2").getByText("Nimeni din apartament nu are inca cont.")).toBeTruthy();
    await apasa("Adauga un locatar in aplicatie");
    scrie("Numele locatarului", " Ana Pop ");
    scrie("Numarul lui de telefon", "0722 000 041");
    await act(async () => { fireEvent.change(screen.getByLabelText("Ce este pentru apartament"), { target: { value: "chirias" } }); });
    await apasa("Fa contul");
    expect(spion).toHaveBeenCalledWith(ap.id, { nume: "Ana Pop", telefon: "0722 000 041", calitate: "chirias" });
    const { parola } = await spion.mock.results[0].value;
    const f = inDialog("Apartament 2");
    expect(f.getByText("Intra cu numarul 0722 000 041")).toBeTruthy();
    expect(f.getByText(parola)).toBeTruthy();
    await apasa("Gata");
    expect(inDialog("Apartament 2").getByText("Ana Pop")).toBeTruthy();
    expect(screen.queryByText(parola)).toBeNull();
  });

  it("butonul asteapta un nume si un numar intreg, iar refuzul ramane pe ecran", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    await deschideFisa("2");
    await apasa("Adauga un locatar in aplicatie");
    expect(dezactivat(buton("Fa contul"))).toBe(true);
    scrie("Numele locatarului", "Ana");
    scrie("Numarul lui de telefon", "0722");
    await act(async () => {});
    expect(dezactivat(buton("Fa contul"))).toBe(true);
    scrie("Numarul lui de telefon", "0722 000 042");
    await act(async () => {});
    expect(dezactivat(buton("Fa contul"))).toBe(false);

    vi.spyOn(sursa, "adaugaLocatar").mockRejectedValue(new Error("Exista deja un cont cu acest numar de telefon."));
    await apasa("Fa contul");
    expect(inDialog("Apartament 2").getByText("Exista deja un cont cu acest numar de telefon.")).toBeTruthy();
    await apasa("Renunta");
    expect(screen.queryByLabelText("Numele locatarului")).toBeNull();
  });

  /* [P1/P5] Un om cu doua apartamente are un singur numar: contul lui se leaga
     si de apartamentul al doilea, fara parola noua. */
  it("numarul care are deja cont se leaga de apartament, fara parola noua", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    await deschideFisa("2");
    await apasa("Adauga un locatar in aplicatie");
    scrie("Numele locatarului", "Elena Marinescu");
    scrie("Numarul lui de telefon", "0733 410 217");
    await apasa("Fa contul");
    const f = inDialog("Apartament 2");
    expect(f.getByText(/Omul avea deja cont pe acest numar/)).toBeTruthy();
    expect(f.getByText("Intra cu numarul 0733 410 217")).toBeTruthy();
    await apasa("Gata");
    expect(inDialog("Apartament 2").getAllByText("Elena Marinescu").length).toBeGreaterThan(0);
    const ap = await apDupaNumar(sursa, "2");
    expect(ap.locatari.map((l) => l.nume)).toContain("Elena Marinescu");
  });

  it("daca parola noua este refuzata, ecranul ramane cum era", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    vi.spyOn(sursa, "parolaNoua").mockRejectedValue(new Error("Nu merge acum."));
    await deschideFisa("17");
    await apasa("Parola noua");
    expect(toast().textContent).toBe("Nu merge acum.");
    expect(screen.queryByText(/Intra cu numarul/)).toBeNull();
  });

  it("parola noua se genereaza pentru un locatar care si-a uitat-o", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "parolaNoua");
    const ap = await apDupaNumar(sursa, "17");
    await deschideFisa("17");
    await apasa("Parola noua");
    const { parola } = await spion.mock.results[0].value;
    expect(spion).toHaveBeenCalledWith(ap.id, ap.locatari[0].id);
    const f = inDialog("Apartament 17");
    expect(f.getByText(/Omul avea deja cont|Contul este gata/)).toBeTruthy();
    expect(f.getByText(parola)).toBeTruthy();
    await apasa("Gata");
  });

  it("inchide accesul doar dupa confirmare", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "inchideAcces");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const ap = await apDupaNumar(sursa, "1");
    await deschideFisa("1");
    const f = inDialog("Apartament 1");
    expect(f.getByText("Proprietar · din 1 iun 2026 · 0741 002 101")).toBeTruthy();
    await apasa("Inchide accesul");
    expect(confirm).toHaveBeenCalledWith("Inchizi accesul lui Gheorghe Voicu la apartamentul 1? Istoricul ramane.");
    expect(spion).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await apasa("Inchide accesul");
    expect(spion).toHaveBeenCalledWith(ap.locatari[0].id);
    expect(toast().textContent).toBe("Accesul a fost inchis");
    expect(f.getByText("Gheorghe Voicu, acces inchis pe 19 sep 2026")).toBeTruthy();
    expect(f.getByText("Nimeni din apartament nu are inca cont.")).toBeTruthy();
  });

  it("locatar fara telefon", async () => {
    await pornesteAdmin({ tab: "Apartamente", modifica: (d) => { d.apartamente.find((a) => a.numar === "1").locatari[0].telefon = null; } });
    await deschideFisa("1");
    expect(inDialog("Apartament 1").getByText("Proprietar · din 1 iun 2026")).toBeTruthy();
  });
});

describe("FisaApartament, consum si istoric", () => {
  it("ultimele trei luni de consum si citirile lunii curente", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const date = await sursa.incarca();
    const ap = date.apartamente.find((a) => a.numar === "1");
    const c = (luna, tip) => date.citiri.find((x) => x.apartamentId === ap.id && x.luna === luna && x.tip === tip);
    await deschideFisa("1");
    const f = inDialog("Apartament 1");
    for (const luna of ["2026-09", "2026-08", "2026-07"]) {
      const txt = `rece ${c(luna, "rece").consum.toFixed(2).replace(".", ",")} · calda ${c(luna, "calda").consum.toFixed(2).replace(".", ",")} mc`;
      expect(f.getByText(txt)).toBeTruthy();
    }
    expect(f.queryByText(/iunie 2026/)).toBeNull();
    expect(f.getByText("Apa rece, septembrie 2026")).toBeTruthy();
    expect(f.getByText(`${c("2026-09", "rece").indexCurent.toFixed(1).replace(".", ",")} (validata)`)).toBeTruthy();
    expect(f.getByText("Din mai 2026, preluat de pe lista de plata din mai 2026")).toBeTruthy();
  });

  it("luna estimata, contor lipsa, luna fara apa calda si istoric fara motiv", async () => {
    await pornesteAdmin({
      tab: "Apartamente",
      modifica: (d) => {
        const ap = d.apartamente.find((a) => a.numar === "1");
        d.citiri = d.citiri.filter((c) => !(c.apartamentId === ap.id && ((c.luna === "2026-09" && c.tip === "rece") || (c.luna === "2026-08" && c.tip === "calda"))));
        d.citiri.filter((c) => c.apartamentId === ap.id && c.luna === "2026-07").forEach((c) => { c.sursa = "estimat"; });
        ap.istoricPersoane[0].motiv = null;
      },
    });
    await deschideFisa("1");
    const f = inDialog("Apartament 1");
    expect(f.getByText(/^rece - · calda/)).toBeTruthy();
    expect(f.getByText(/· calda - mc$/)).toBeTruthy();
    expect(f.getByText("iulie 2026 (estimat)")).toBeTruthy();
    expect(f.getByText("netransmis")).toBeTruthy();
    expect(f.getByText("Din mai 2026")).toBeTruthy();
  });
});

describe("FisaApartament, corectarea fisei (C3/E4)", () => {
  it("precompleteaza datele curente, salveaza corectia si actualizeaza fisa", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "schimbaFisaApartament");
    const ap = await apDupaNumar(sursa, "1");
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    expect(screen.getByLabelText("Proprietar").value).toBe("Gheorghe Voicu");
    expect(screen.getByLabelText("Etaj").value).toBe("0");
    expect(screen.getByLabelText("Suprafata").value).toBe("42,5");
    expect(screen.getByLabelText("Cota indiviza").value).toBe("4,01");
    expect(screen.getByRole("button", { name: "Scutit de plata liftului" }).getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      scrie("Proprietar", "Ion Constantinescu");
      scrie("Suprafata", "45");
    });
    await apasa("Salveaza corectia");
    expect(spion).toHaveBeenCalledWith(ap.id, { proprietar: "Ion Constantinescu", cota: 4.01, mp: 45, scutitLift: true, etaj: 0 });
    expect(toast().textContent).toBe("Fisa apartamentului a fost actualizata");
    const f = inDialog("Apartament 1");
    expect(f.getByText("Ion Constantinescu")).toBeTruthy();
    expect(f.getByText("45,0 mp")).toBeTruthy();
    expect(screen.queryByLabelText("Proprietar")).toBeNull();
  });

  it("[G5] o cota cu 4 zecimale (numeric(7,4)) nu se rotunjeste la precompletare", async () => {
    const { sursa } = await pornesteAdmin({
      tab: "Apartamente",
      modifica: (d) => {
        const a1 = d.apartamente.find((a) => a.numar === "1");
        const a2 = d.apartamente.find((a) => a.numar === "2");
        /* Suma blocului ramane 100%, dar ap. 1 are nevoie de 4 zecimale */
        a1.cota = 4.0067;
        a2.cota = 4.6333;
      },
    });
    const spion = vi.spyOn(sursa, "schimbaFisaApartament");
    const ap = await apDupaNumar(sursa, "1");
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    expect(screen.getByLabelText("Cota indiviza").value).toBe("4,0067");

    /* Corectarea doar a numelui nu are voie sa retrimita o cota rotunjita */
    await act(async () => { scrie("Proprietar", "Ion Constantinescu"); });
    await apasa("Salveaza corectia");
    expect(spion).toHaveBeenCalledWith(ap.id, expect.objectContaining({ cota: 4.0067 }));
  });

  it("un apartament fara suprafata declarata precompleteaza campul gol", async () => {
    await pornesteAdmin({ tab: "Apartamente", modifica: (d) => { d.apartamente.find((a) => a.numar === "2").mp = null; } });
    await deschideFisa("2");
    await apasa("Corecteaza datele apartamentului");
    expect(screen.getByLabelText("Suprafata").value).toBe("");
  });

  it("dezactiveaza scutirea de lift si trimite suprafata goala ca null", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "schimbaFisaApartament");
    const ap = await apDupaNumar(sursa, "1");
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    await act(async () => { scrie("Suprafata", ""); });
    await apasa(screen.getByRole("button", { name: "Scutit de plata liftului" }));
    await apasa("Salveaza corectia");
    expect(spion).toHaveBeenCalledWith(ap.id, { proprietar: "Gheorghe Voicu", cota: 4.01, mp: null, scutitLift: false, etaj: 0 });
  });

  it("butonul Salveaza este dezactivat fara proprietar sau cu cota invalida", async () => {
    await pornesteAdmin({ tab: "Apartamente" });
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    await act(async () => { scrie("Proprietar", "   "); });
    expect(dezactivat(buton("Salveaza corectia"))).toBe(true);
    await act(async () => { scrie("Proprietar", "Cineva"); scrie("Cota indiviza", "0"); });
    expect(dezactivat(buton("Salveaza corectia"))).toBe(true);
    await act(async () => { scrie("Cota indiviza", "4,01"); scrie("Etaj", ""); });
    expect(dezactivat(buton("Salveaza corectia"))).toBe(true);
  });

  it("o corectie refuzata de sursa lasa formularul deschis, cu mesajul ei", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    vi.spyOn(sursa, "schimbaFisaApartament").mockRejectedValue(new Error(
      "Cotele blocului ar ajunge la 105.0000 din 100. Schimba si celelalte apartamente, altfel lista nu se mai imparte corect.",
    ));
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    await act(async () => { scrie("Cota indiviza", "10"); });
    await apasa("Salveaza corectia");
    expect(toast().textContent).toBe("Cotele blocului ar ajunge la 105.0000 din 100. Schimba si celelalte apartamente, altfel lista nu se mai imparte corect.");
    expect(screen.getByLabelText("Cota indiviza").value).toBe("10");
  });

  it("renunta inchide formularul fara sa salveze", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "schimbaFisaApartament");
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    await act(async () => { scrie("Proprietar", "Altcineva"); });
    await apasa("Renunta");
    expect(screen.queryByLabelText("Proprietar")).toBeNull();
    expect(spion).not.toHaveBeenCalled();
  });
});

describe("FisaApartament, redistribuirea cotelor blocului (C3/E4)", () => {
  it("precompleteaza cota fiecarui apartament, arata totalul si blocheaza salvarea cat timp suma nu e 100", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "schimbaCoteleBlocului");
    const date = await sursa.incarca();
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    await apasa("Redistribuie cotele intregului bloc");

    expect(screen.getByLabelText("Ap. 1, Gheorghe Voicu").value).toBe("4,01");
    expect(screen.getByLabelText("Ap. 2, Ana Petrescu").value).toBe("4,63");
    expect(screen.getByText("100,00% din 100%")).toBeTruthy();
    expect(dezactivat(buton("Salveaza cotele blocului"))).toBe(false);

    await act(async () => { scrie("Ap. 1, Gheorghe Voicu", "10"); });
    expect(screen.getByText("105,99% din 100%")).toBeTruthy();
    expect(dezactivat(buton("Salveaza cotele blocului"))).toBe(true);

    await act(async () => { scrie("Ap. 1, Gheorghe Voicu", "5,01"); scrie("Ap. 2, Ana Petrescu", "3,63"); });
    expect(screen.getByText("100,00% din 100%")).toBeTruthy();
    expect(dezactivat(buton("Salveaza cotele blocului"))).toBe(false);

    await apasa("Salveaza cotele blocului");
    expect(spion).toHaveBeenCalledTimes(1);
    const trimise = spion.mock.calls[0][0];
    expect(trimise).toHaveLength(date.apartamente.length);
    const ap1 = date.apartamente.find((a) => a.numar === "1");
    const ap2 = date.apartamente.find((a) => a.numar === "2");
    expect(trimise.find((c) => c.apartamentId === ap1.id).cota).toBe(5.01);
    expect(trimise.find((c) => c.apartamentId === ap2.id).cota).toBe(3.63);
    expect(toast().textContent).toBe("Cotele blocului au fost actualizate");
    expect(screen.queryByLabelText("Ap. 1, Gheorghe Voicu")).toBeNull();
  });

  it("[G5] cotele cu 4 zecimale nu ajung 99,99% la precompletare, cu Salveaza dezactivat", async () => {
    await pornesteAdmin({
      tab: "Apartamente",
      modifica: (d) => {
        const a1 = d.apartamente.find((a) => a.numar === "1");
        const a2 = d.apartamente.find((a) => a.numar === "2");
        a1.cota = 4.0067;
        a2.cota = 4.6333;
      },
    });
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    await apasa("Redistribuie cotele intregului bloc");

    expect(screen.getByLabelText("Ap. 1, Gheorghe Voicu").value).toBe("4,0067");
    expect(screen.getByLabelText("Ap. 2, Ana Petrescu").value).toBe("4,6333");
    expect(screen.getByText("100,00% din 100%")).toBeTruthy();
    expect(dezactivat(buton("Salveaza cotele blocului"))).toBe(false);
  });

  it("renunta inchide editorul de cote fara sa salveze", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    const spion = vi.spyOn(sursa, "schimbaCoteleBlocului");
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    await apasa("Redistribuie cotele intregului bloc");
    await act(async () => { scrie("Ap. 1, Gheorghe Voicu", "10"); });
    await apasa("Renunta");
    expect(screen.queryByLabelText("Ap. 1, Gheorghe Voicu")).toBeNull();
    expect(spion).not.toHaveBeenCalled();
  });

  it("o redistribuire refuzata de sursa lasa editorul deschis, cu mesajul ei", async () => {
    const { sursa } = await pornesteAdmin({ tab: "Apartamente" });
    vi.spyOn(sursa, "schimbaCoteleBlocului").mockRejectedValue(new Error("Cotele trimise insumeaza 100.5000, nu 100. Corecteaza-le pe toate inainte de a le salva."));
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    await apasa("Redistribuie cotele intregului bloc");
    await apasa("Salveaza cotele blocului");
    expect(toast().textContent).toBe("Cotele trimise insumeaza 100.5000, nu 100. Corecteaza-le pe toate inainte de a le salva.");
    expect(screen.getByLabelText("Ap. 1, Gheorghe Voicu")).toBeTruthy();
  });
});

describe("FisaApartament, panoul e pazit cand are ceva scris (G6)", () => {
  it("o atingere pe fundal nu arunca la gunoi editorul de cote", async () => {
    await pornesteAdmin({ tab: "Apartamente" });
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    await apasa("Redistribuie cotele intregului bloc");
    await act(async () => { scrie("Ap. 1, Gheorghe Voicu", "10"); });

    const panou = dialog("Apartament 1");
    await act(async () => { fireEvent.click(panou.parentElement); });
    expect(screen.getByLabelText("Ap. 1, Gheorghe Voicu").value).toBe("10");
  });

  it("tasta Escape nu arunca la gunoi editorul de cote", async () => {
    await pornesteAdmin({ tab: "Apartamente" });
    await deschideFisa("1");
    await apasa("Corecteaza datele apartamentului");
    await apasa("Redistribuie cotele intregului bloc");
    await act(async () => { scrie("Ap. 1, Gheorghe Voicu", "10"); });

    const panou = dialog("Apartament 1");
    await act(async () => { fireEvent.keyDown(panou, { key: "Escape" }); });
    expect(screen.getByLabelText("Ap. 1, Gheorghe Voicu").value).toBe("10");
  });
});

describe("FisaApartament, fisa goala", () => {
  it("un apartament disparut dupa reincarcare inchide fisa", async () => {
    let ascunde = false;
    await pornesteAdmin({
      tab: "Apartamente",
      modifica: (d) => { if (ascunde) d.apartamente = d.apartamente.filter((a) => a.numar !== "3"); },
    });
    await deschideFisa("3");
    expect(dialog("Apartament 3")).toBeTruthy();
    ascunde = true;
    await apasa("Trimite instiintare de plata");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
