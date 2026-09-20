/* Panoul administratorului (AdminSumar) si cartonasele Kpi */
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { pornesteAdmin, apasa, buton, butoane, butonul, toast, randCu } from "./ui-admin-ajutor.js";
import { PAROLA, ADMIN } from "./ajutor.jsx";
import { creeazaSursaMock } from "../../src/sursa-mock.js";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* Tine minte numele fisierelor PDF descarcate, fara navigare in jsdom */
function prindeDescarcari() {
  const nume = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { nume.push(this.download); });
  const blob = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  return { nume, blob };
}

/* Numele tabului activ, fara badge-ul cu numar */
const tabActiv = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true").textContent.replace(/\d+$/, "");

describe("AdminSumar, cu datele demo", () => {
  it("arata lista publicata pe august, incasarile si procentul", async () => {
    const { sursa } = await pornesteAdmin();
    const date = await sursa.incarca();
    const lista = date.liste.find((l) => l.stare === "publicata");
    const datorii = date.datorii.filter((d) => d.listaId === lista.id && d.tip === "intretinere");
    const deIncasat = datorii.reduce((s, d) => s + d.suma, 0);
    const incasat = datorii.reduce((s, d) => s + d.suma - d.rest, 0);

    expect(screen.getByText("Panou administrator")).toBeTruthy();
    expect(screen.getByText("Asociatia de proprietari nr. 118 · 20 apartamente")).toBeTruthy();
    expect(screen.getByText("Lista de plata august 2026")).toBeTruthy();
    expect(screen.getByText("de incasat, termen 25 sep 2026")).toBeTruthy();
    expect(screen.getByText("Publicata 8 sep 2026")).toBeTruthy();
    expect(screen.getByText(`${Math.round((incasat / deIncasat) * 100)}%`)).toBeTruthy();
    expect(screen.getByText(`Au platit integral ${datorii.filter((d) => d.rest <= 0).length} din 20 apartamente.`)).toBeTruthy();
  });

  it("[H8] o corectie care scade restul fara o plata noua nu umfla incasat (fara alocare fantoma)", async () => {
    const baza = creeazaSursaMock();
    await baza.intra(ADMIN, PAROLA);
    const date0 = await baza.incarca();
    const lista = date0.liste.find((l) => l.stare === "publicata");
    const datoriiLista = date0.datorii.filter((d) => d.listaId === lista.id && d.tip === "intretinere");
    const deIncasat = datoriiLista.reduce((s, d) => s + d.suma, 0);
    const idDatorii = new Set(datoriiLista.map((d) => d.id));
    /* Incasarea reala: doar ce a fost alocat din plati confirmate pe aceste datorii */
    const incasatReal = round2(date0.plati.flatMap((p) => p.alocari).filter((a) => idDatorii.has(a.datorieId)).reduce((s, a) => s + a.suma, 0));
    const tintaId = datoriiLista.find((d) => d.rest > 0).id;

    await pornesteAdmin({
      modifica: (d) => {
        /* O corectie scade restul datoriei de intretinere fara nicio plata
           noua (docs/schema-propunere.md §11.4): d.suma - d.rest creste, dar
           nimeni nu a platit nimic in plus. */
        const dt = d.datorii.find((x) => x.id === tintaId);
        if (dt) dt.rest = round2(dt.rest - 50);
      },
    });
    expect(screen.getByText(`${Math.round((incasatReal / deIncasat) * 100)}%`)).toBeTruthy();
  });

  it("KPI-urile arata restantele, penalizarile, citirile, sesizarile si fondul de reparatii", async () => {
    await pornesteAdmin();
    expect(screen.getByText("7.013,65")).toBeTruthy();
    expect(screen.getByText("5 apartamente in urma")).toBeTruthy();
    expect(screen.getByText("17,11")).toBeTruthy();
    const citiri = within(buton("Citiri de verificat"));
    expect(citiri.getByText("8")).toBeTruthy();
    const ses = within(buton("Sesizari"));
    expect(ses.getByText("3")).toBeTruthy();
    expect(screen.getByText("19.228,60 lei")).toBeTruthy();
    /* Penalizarile nu sunt apasabile; fondul duce la tabul Fonduri (C3/E5) */
    expect(butoane("Penalizari")).toHaveLength(0);
    expect(buton("Fond de reparatii")).toBeTruthy();
  });

  it("[C3/E5] panoul Fond de reparatii duce la tabul Fonduri, din Apartamente", async () => {
    await pornesteAdmin();
    await apasa("Fond de reparatii");
    expect(tabActiv()).toBe("Apartamente");
    expect(screen.getByRole("button", { name: "Fonduri" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("lista in lucru apare ca sarcina si duce la facturi", async () => {
    await pornesteAdmin();
    expect(screen.getByText("Lista pe septembrie 2026 este in lucru")).toBeTruthy();
    expect(screen.getByText("1 cheltuiala adaugata. Locatarii o vad dupa publicare.")).toBeTruthy();
    await apasa(screen.getByText("Lista pe septembrie 2026 este in lucru"));
    expect(tabActiv()).toBe("Facturi");
  });

  it("facturile neplatite furnizorilor, cu si fara scadenta", async () => {
    await pornesteAdmin();
    expect(screen.getByText("3 facturi de platit catre furnizori")).toBeTruthy();
    expect(screen.getByText("Salubritate 2000, scadent 30 sep 2026")).toBeTruthy();
    expect(screen.getByText("Elmas Lift Service, scadent 5 oct 2026")).toBeTruthy();
    expect(screen.getByText("Deraton Serv, scadent 27 sep 2026")).toBeTruthy();
    await apasa("Vezi facturile");
    expect(tabActiv()).toBe("Facturi");
  });

  it("o singura factura neplatita, fara scadenta", async () => {
    await pornesteAdmin({
      modifica: (d) => {
        const neplatite = d.cheltuieli.filter((c) => c.tip === "factura" && !c.achitataLa && c.listaId !== d.liste[0].id);
        neplatite.slice(1).forEach((c) => { c.achitataLa = "2026-09-18"; });
        neplatite[0].scadentaFurnizor = null;
      },
    });
    expect(screen.getByText("O factura de platit catre furnizori")).toBeTruthy();
    expect(screen.getByText("Salubritate 2000")).toBeTruthy();
  });

  it("restantierii, cel mai vechi primul, cu penalizari doar unde exista", async () => {
    await pornesteAdmin();
    const ap11 = randCu("Familia Georgescu", "Instiintare");
    expect(within(ap11).getByText("117 zile intarziere, penalizari 14,89 lei")).toBeTruthy();
    const ap6 = randCu("Vasile Munteanu", "Instiintare");
    expect(within(ap6).getByText("25 de zile intarziere")).toBeTruthy();
    expect(within(ap6).getByText("536,77")).toBeTruthy();
    const intarzieri = screen.getAllByText(/zile intarziere/).map((e) => parseInt(e.textContent, 10));
    expect(intarzieri).toEqual([...intarzieri].sort((a, b) => b - a));
    expect(intarzieri[0]).toBe(117);
  });

  it("instiintarea catre un apartament cu cont si catre unul fara cont", async () => {
    const { sursa } = await pornesteAdmin();
    const spion = vi.spyOn(sursa, "trimiteInstiintare");
    const date = await sursa.incarca();
    const ap3 = date.apartamente.find((a) => a.numar === "3");
    const ap6 = date.apartamente.find((a) => a.numar === "6");

    await apasa(within(randCu("Familia Ilie", "Instiintare")).getByRole("button", { name: "Instiintare" }));
    expect(spion).toHaveBeenLastCalledWith(ap3.id);
    expect(toast().textContent).toBe("Instiintare trimisa in aplicatie pentru ap. 3");

    await apasa(within(randCu("Vasile Munteanu", "Instiintare")).getByRole("button", { name: "Instiintare" }));
    expect(spion).toHaveBeenLastCalledWith(ap6.id);
    expect(toast().textContent).toBe("Ap. 6 nu are cont in aplicatie. Instiintarea se da pe hartie.");
  });

  it("instiintarea care esueaza arata doar eroarea", async () => {
    const { sursa } = await pornesteAdmin();
    vi.spyOn(sursa, "trimiteInstiintare").mockRejectedValue(new Error("Retea cazuta"));
    await apasa(within(randCu("Familia Ilie", "Instiintare")).getByRole("button", { name: "Instiintare" }));
    expect(toast().textContent).toBe("Retea cazuta");
  });

  it("reminderul de plata merge la apartamentele cu sold", async () => {
    const { sursa } = await pornesteAdmin();
    const spion = vi.spyOn(sursa, "trimiteReminder");
    await apasa("Trimite reminder de plata");
    expect(spion).toHaveBeenCalledWith("plata");
    const r = await spion.mock.results[0].value;
    expect(r.apartamente).toBe(6);
    expect(toast().textContent).toBe(`Reminder trimis catre ${r.destinatari === 1 ? "1 locatar" : `${r.destinatari} locatari`}, din 6 apartamente cu sold`);
  });

  it("reminderul de plata care esueaza nu anunta trimiterea", async () => {
    const { sursa } = await pornesteAdmin();
    vi.spyOn(sursa, "trimiteReminder").mockRejectedValue(new Error("Nu s-a putut trimite"));
    await apasa("Trimite reminder de plata");
    expect(toast().textContent).toBe("Nu s-a putut trimite");
  });

  it("[K5, paritate] reminderul de plata ajunge si la restantieri, cu instiintarea in loc de 'se apropie termenul'", async () => {
    /* Pe 26 septembrie toate datoriile sunt trecute de scadenta: toti primesc instiintarea */
    const { sursa } = await pornesteAdmin({ zi: new Date("2026-09-26T09:00:00") });
    const spion = vi.spyOn(sursa, "trimiteReminder");
    await apasa("Trimite reminder de plata");
    const r = await spion.mock.results[0].value;
    expect(r.apartamente).toBe(6);
  });

  it("[G2/F4] exporta lista publicata ca PDF, cu numele fisierului de uz intern si o mentiune vizibila", async () => {
    await pornesteAdmin();
    const { nume, blob } = prindeDescarcari();
    expect(screen.getByText(/uz administrativ/i)).toBeTruthy();
    await apasa("Exporta lista PDF");
    expect(nume).toEqual(["lista-plata-2026-08-uz-intern.pdf"]);
    expect(blob.mock.calls[0][0].type).toBe("application/pdf");
  });

  it("KPI-urile duc la ecranele lor", async () => {
    await pornesteAdmin();
    await apasa("Restante");
    expect(tabActiv()).toBe("Apartamente");
    expect(butonul("Restante 5").getAttribute("aria-pressed")).toBe("true");

    await apasa(screen.getByRole("tab", { name: "Sumar" }));
    await apasa("Citiri de verificat");
    expect(screen.getByText(/Termen de citire/)).toBeTruthy();

    await apasa(screen.getByRole("tab", { name: "Sumar" }));
    await apasa("Sesizari");
    expect(screen.getByText("3 deschise")).toBeTruthy();
  });

  it("'Toate' de la restantieri deschide lista filtrata pe restante", async () => {
    await pornesteAdmin();
    await apasa(screen.getByText("Toate"));
    expect(butonul("Restante 5").getAttribute("aria-pressed")).toBe("true");
    expect(butoane(/^Apartament /)).toHaveLength(5);
  });

  it("actiunile rapide duc la facturi, apartamente, anunturi si vot", async () => {
    await pornesteAdmin();
    await apasa("Adauga factura");
    expect(tabActiv()).toBe("Facturi");
    await apasa(screen.getByRole("tab", { name: "Sumar" }));
    await apasa("Inregistreaza incasare");
    expect(tabActiv()).toBe("Apartamente");
    expect(butonul("Toate 20").getAttribute("aria-pressed")).toBe("true");
    await apasa(screen.getByRole("tab", { name: "Sumar" }));
    await apasa("Scrie un anunt");
    expect(tabActiv()).toBe("Comunicare");
    expect(buton("Scrie un anunt")).toBeTruthy();
    await apasa(screen.getByRole("tab", { name: "Sumar" }));
    await apasa("Deschide un vot");
    expect(buton("Deschide un vot nou")).toBeTruthy();
  });
});

describe("AdminSumar, stari rare", () => {
  it("fara lista publicata: indemn catre facturi", async () => {
    await pornesteAdmin({ modifica: (d) => { d.liste = d.liste.filter((l) => l.stare !== "publicata"); } });
    expect(screen.getByText("Nicio lista publicata")).toBeTruthy();
    expect(butoane("Exporta lista PDF")).toHaveLength(0);
    await apasa("Mergi la facturi");
    expect(tabActiv()).toBe("Facturi");
  });

  it("lista publicata fara nimic de incasat arata 0%", async () => {
    await pornesteAdmin({
      modifica: (d) => {
        const l = d.liste.find((x) => x.stare === "publicata");
        d.datorii = d.datorii.filter((x) => x.listaId !== l.id);
      },
    });
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByText("Au platit integral 0 din 20 apartamente.")).toBeTruthy();
  });

  it("fara restante, penalizari, citiri, sesizari, fond, ciorna si facturi neplatite", async () => {
    await pornesteAdmin({
      modifica: (d) => {
        d.datorii.forEach((x) => { x.rest = 0; });
        d.citiri.forEach((c) => { if (c.stare === "trimisa") c.stare = "validata"; });
        d.sesizari.forEach((s) => { s.stare = "rezolvata"; });
        d.fonduri = d.fonduri.filter((f) => f.tip !== "reparatii");
        d.liste = d.liste.filter((l) => l.stare !== "ciorna");
        d.cheltuieli.forEach((c) => { c.achitataLa = c.achitataLa || "2026-09-18"; });
      },
    });
    expect(screen.getByText("Nicio restanta")).toBeTruthy();
    expect(screen.getByText("0 apartamente in urma")).toBeTruthy();
    expect(screen.queryByText(/facturi? de platit catre furnizori/)).toBeNull();
    expect(screen.queryByText(/este in lucru/)).toBeNull();
    expect(screen.queryByText("Fond de reparatii")).toBeNull();
    expect(within(buton("Sesizari")).getByText("0")).toBeTruthy();
    expect(within(buton("Citiri de verificat")).getByText("0")).toBeTruthy();
  });
});
