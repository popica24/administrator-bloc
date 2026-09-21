/* Facturile si listele lunare (AdminFacturi): ciorna, previzualizare, publicare, export */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { pornesteAdmin, apasa, buton, butoane, toast, inDialog, dezactivat } from "./ui-admin-ajutor.js";
import { sursaDemo, ceasDemo, zonaCu, ADMIN, PAROLA } from "./ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const deschideFacturi = (opt) => pornesteAdmin({ tab: "Facturi", ...opt });

/* Blocul unei cheltuieli din lista, dupa categoria ei */
const randFactura = (categorie) => within(screen.getByText(categorie, { selector: "span" }).parentElement.parentElement.parentElement.parentElement);

/* O promisiune pe care testul o rezolva cand vrea */
function amanata() {
  let rezolva;
  const p = new Promise((r) => { rezolva = r; });
  return { p, rezolva };
}


const idLista = async (sursa, luna) => (await sursa.incarca()).liste.find((l) => l.luna === luna).id;

/* [K6] Lista nu se publica peste citiri trimise: sursa demo cu citirile din
   septembrie deja verificate, cum le-ar lasa administratorul inainte de publicare */
async function sursaCuCitiriVerificate() {
  ceasDemo();
  const s = sursaDemo();
  await s.intra(ADMIN, PAROLA);
  const d = await s.incarca();
  for (const c of d.citiri.filter((x) => x.luna === "2026-09" && x.stare === "trimisa")) await s.valideazaCitire(c.id, true);
  return s;
}

describe("AdminFacturi, lista in lucru", () => {
  /* [K6] Avertismentul despre citiri aparea doar daca lista avea apa, adica
     lipsea tocmai cand administratorul scotea apa de pe lista si publica */
  it("[K6] cardul listei spune cate citiri mai sunt de verificat, chiar fara apa pe lista", async () => {
    const { sursa } = await deschideFacturi();
    const trimise = (await sursa.incarca()).citiri.filter((x) => x.luna === "2026-09" && x.stare === "trimisa").length;
    expect(trimise).toBeGreaterThan(1);
    expect(screen.getByText(`Mai sunt ${trimise} citiri de verificat. Lista se publica dupa ce le validezi sau le respingi, din Apartamente, la Citiri contoare.`)).toBeTruthy();
  });

  it("[K6] la singular, cand mai ramane una", async () => {
    ceasDemo();
    const s = sursaDemo();
    await s.intra(ADMIN, PAROLA);
    const [, ...restul] = (await s.incarca()).citiri.filter((x) => x.luna === "2026-09" && x.stare === "trimisa");
    for (const c of restul) await s.valideazaCitire(c.id, true);
    await deschideFacturi({ sursa: s });
    expect(screen.getByText("Mai este o citire de verificat. Lista se publica dupa ce o validezi sau o respingi, din Apartamente, la Citiri contoare.")).toBeTruthy();
  });

  it("[K6] fara citiri de verificat, cardul nu mai spune nimic despre ele", async () => {
    await deschideFacturi({ sursa: await sursaCuCitiriVerificate() });
    expect(screen.queryByText(/de verificat\. Lista se publica/)).toBeNull();
  });

  it("arata ciorna pe septembrie cu fondul de reparatii", async () => {
    await deschideFacturi();
    expect(screen.getByText("septembrie 2026 · in lucru")).toBeTruthy();
    expect(screen.getByText("Lista in lucru, locatarii nu o vad inca")).toBeTruthy();
    expect(screen.queryByText(/Citiri validate/)).toBeNull();
    const fond = randFactura("Fond de reparatii");
    expect(fond.getByText("C9")).toBeTruthy();
    expect(fond.getByText("Asociatia de proprietari nr. 118 · Hotarare AG din 12.03.2026")).toBeTruthy();
    expect(fond.getByText("Pe cota indiviza")).toBeTruthy();
    expect(fond.getByText("Fond")).toBeTruthy();
    expect(fond.queryByRole("button", { name: /Marcheaza platita/ })).toBeNull();
    expect(screen.queryByText(/nu este inceputa/)).toBeNull();
    expect(buton("Publica lista")).toBeTruthy();
    expect(zonaCu(["Total", "1.600,00"]).textContent).toBe("Total1.600,00LEI");
  });

  it("[L3] randul fondului de reparatii nu se poate nici modifica, nici sterge", async () => {
    await deschideFacturi();
    expect(randFactura("Fond de reparatii").queryByRole("button", { name: "Modifica" })).toBeNull();
    /* [R3] "Sterge" ar fi golit fondul lunii, fara cale de intoarcere */
    expect(randFactura("Fond de reparatii").queryByRole("button", { name: "Sterge" })).toBeNull();
  });

  it("'Vezi factura' deschide documentul cheltuielii", async () => {
    const { sursa } = await deschideFacturi();
    const fereastra = { location: {}, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fereastra);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:doc");
    const spion = vi.spyOn(sursa, "deschideDocument");
    const d = await sursa.incarca();
    const c9 = d.cheltuieli.find((c) => c.cod === "C9" && c.listaId === d.liste[0].id);
    await apasa(randFactura("Fond de reparatii").getByRole("button", { name: "Vezi factura" }));
    expect(spion).toHaveBeenCalledWith(c9.documentId);
    expect(fereastra.location.href).toBe("blob:doc");
  });

  it("previzualizarea imparte fondul pe cote, fara sa salveze", async () => {
    const { sursa } = await deschideFacturi();
    const spion = vi.spyOn(sursa, "dateMotor");
    const publica = vi.spyOn(sursa, "publicaLista");
    await apasa("Calculeaza lista pe apartamente");
    expect(spion).toHaveBeenCalledWith(await idLista(sursa, "2026-09"));
    const rand = (t) => zonaCu(t, 1).parentElement.textContent;
    expect(rand("Ap. 1, Gheorghe Voicu")).toBe("Ap. 1, Gheorghe Voicu64,16 lei");
    expect(rand("Ap. 3, Familia Ilie")).toBe("Ap. 3, Familia Ilie96,32 lei");
    expect(rand("Total repartizat")).toBe("Total repartizat1.600,00 lei");
    expect(rand("Total facturi")).toBe("Total facturi1.600,00 lei");
    const ordine = screen.getAllByText(/^Ap\. \d+, /).map((e) => e.textContent.split(",")[0]);
    expect(ordine).toEqual(Array.from({ length: 20 }, (_, i) => `Ap. ${i + 1}`));
    expect(publica).not.toHaveBeenCalled();
  });

  it("un apartament fara repartizare in previzualizare apare cu 0", async () => {
    await deschideFacturi({
      modifica: (d) => { d.apartamente.push({ ...d.apartamente[0], id: "apa-nou", numar: "21", proprietar: "Apartament nou" }); },
    });
    await apasa("Calculeaza lista pe apartamente");
    expect(zonaCu(["Ap. 21, Apartament nou", "0,00 lei"]).textContent).toBe("Ap. 21, Apartament nou0,00 lei");
    expect(zonaCu(["Total repartizat", "1.600,00 lei"]).textContent).toBe("Total repartizat1.600,00 lei");
  });

  it("previzualizarea cu apa fara citiri arata problemele", async () => {
    const { sursa } = await deschideFacturi();
    const listaId = await idLista(sursa, "2026-09");
    const d = await sursa.incarca();
    const apa = d.furnizori.find((f) => f.cod === "C1");
    /* Factura de apa se adauga din formular, ca orice factura */
    await apasa(butoane("Adauga factura")[0]);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Furnizor"), { target: { value: apa.id } });
      fireEvent.change(screen.getByLabelText("Suma facturii"), { target: { value: "3000" } });
    });
    await apasa("Salveaza factura");
    expect(listaId).toBeTruthy();
    await apasa("Calculeaza lista pe apartamente");
    expect(screen.getByText("Lista nu se poate calcula inca:")).toBeTruthy();
    expect(screen.getByText(/C1: lipsesc citirile la apa rece pentru \d+ apartamente\./)).toBeTruthy();
    expect(screen.getByText(/Citiri validate: 6 din 20 apartamente\. Contorul general: necitit\./)).toBeTruthy();
    expect(randFactura("Apa rece si canalizare").getByText("Pe consum masurat, apa rece")).toBeTruthy();
  });

  it("previzualizarea care nu primeste datele motorului nu arata nimic", async () => {
    const { sursa } = await deschideFacturi();
    vi.spyOn(sursa, "dateMotor").mockRejectedValue(new Error("Lista nu exista."));
    await apasa("Calculeaza lista pe apartamente");
    expect(toast().textContent).toBe("Lista nu exista.");
    expect(screen.queryByText("Total repartizat")).toBeNull();
  });

  it("[L10] previzualizarea se sterge cand se schimba facturile", async () => {
    /* [R3] randul de fond nu mai are buton de stergere, deci adaugam si
       stergem o factura, ca in "sterge o cheltuiala doar dupa confirmare" */
    const sursa = sursaDemo();
    await sursa.intra(ADMIN, PAROLA);
    const listaId = await idLista(sursa, "2026-09");
    const idFactura = await sursa.salveazaCheltuiala({ listaId, furnizorNou: "Salubris", categorie: "Salubritate", cod: "C5", suma: 300, metoda: "apartamente" });
    await deschideFacturi({ sursa });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await apasa("Calculeaza lista pe apartamente");
    expect(screen.getByText("Total repartizat")).toBeTruthy();
    await apasa(randFactura("Salubritate").getByRole("button", { name: "Sterge" }));
    expect(toast().textContent).toBe("Cheltuiala a fost stearsa");
    expect(await sursa.incarca()).toBeTruthy();
    expect((await sursa.incarca()).cheltuieli.some((c) => c.id === idFactura)).toBe(false);
    expect(screen.queryByText("Total repartizat")).toBeNull();
  });

  it("[L12] previzualizarea pastreaza ordinea apartamentelor cand un numar are litera", async () => {
    await deschideFacturi({
      modifica: (d) => {
        /* Un apartament "3A" adaugat ultimul, cum il intoarce sursa demo */
        d.apartamente.find((a) => a.numar === "20").numar = "3A";
      },
    });
    await apasa("Calculeaza lista pe apartamente");
    const ordine = screen.getAllByText(/^Ap\. \w+, /).map((e) => e.textContent.split(",")[0].slice(4));
    expect(ordine.slice(0, 5)).toEqual(["1", "2", "3", "3A", "4"]);
  });

  it("sterge o cheltuiala doar dupa confirmare", async () => {
    /* randul de fond nu are buton de stergere [R3], deci se sterge o factura
       adaugata prin sursa, ca sa existe si in datele ei, nu doar pe ecran */
    const sursa = sursaDemo();
    await sursa.intra(ADMIN, PAROLA);
    const listaId = await idLista(sursa, "2026-09");
    const idFactura = await sursa.salveazaCheltuiala({ listaId, furnizorNou: "Salubris", categorie: "Salubritate", cod: "C5", suma: 300, metoda: "apartamente" });
    await deschideFacturi({ sursa });
    const spion = vi.spyOn(sursa, "stergeCheltuiala");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await apasa(randFactura("Salubritate").getByRole("button", { name: "Sterge" }));
    expect(confirm).toHaveBeenCalledWith("Stergi Salubritate?");
    expect(spion).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await apasa(randFactura("Salubritate").getByRole("button", { name: "Sterge" }));
    expect(spion).toHaveBeenCalledWith(idFactura);
    expect(toast().textContent).toBe("Cheltuiala a fost stearsa");
    expect(screen.queryByText("Salubritate")).toBeNull();
    /* randul de fond ramane: lista nu e goala si se poate publica */
    expect(randFactura("Fond de reparatii").getByText("C9")).toBeTruthy();
    expect(dezactivat(buton("Publica lista"))).toBe(false);
  });

  it("o ciorna fara nicio cheltuiala nu se poate publica si isi ofera butonul de adaugare", async () => {
    await deschideFacturi({
      modifica: (d) => {
        const ciorna = d.liste.find((l) => l.stare === "ciorna");
        d.cheltuieli = d.cheltuieli.filter((c) => c.listaId !== ciorna.id);
      },
    });
    expect(screen.getByText("Nicio cheltuiala")).toBeTruthy();
    expect(dezactivat(buton("Publica lista"))).toBe(true);
    expect(dezactivat(buton("Calculeaza lista pe apartamente"))).toBe(true);
    /* Gol are si el butonul de adaugare */
    expect(butoane("Adauga factura")).toHaveLength(2);
    await apasa(butoane("Adauga factura")[1]);
    expect(inDialog("Factura noua")).toBeTruthy();
  });

  it("starea citirilor cand lista are apa si toate citirile sunt validate", async () => {
    await deschideFacturi({
      modifica: (d) => {
        const ciorna = d.liste.find((l) => l.stare === "ciorna");
        d.cheltuieli.push({ id: "che-apa", listaId: ciorna.id, cod: "C1", tip: "factura", categorie: "Apa rece", furnizorId: null, furnizor: "Apa Canal", serie: null, suma: 100, metoda: "consum", tipApa: "rece", emisa: null, scadentaFurnizor: null, achitataLa: null, documentId: null });
        d.contoare.forEach((c) => {
          const x = d.citiri.filter((y) => y.contorId === c.id && y.luna === "2026-09");
          if (x.length) x.forEach((y) => { y.stare = "validata"; });
          else d.citiri.push({ id: `cit-${c.id}`, contorId: c.id, apartamentId: c.apartamentId, tip: c.tip, luna: "2026-09", indexAnterior: 0, indexCurent: 1, consum: 1, sursa: "locatar", stare: "validata" });
        });
      },
    });
    const stare = screen.getByText("Citiri validate: 20 din 20 apartamente. Contorul general: citit.");
    /* verde de "totul e gata", nu portocaliul care cere atentie */
    expect(stare.style.color).not.toBe(screen.getByText("Lista in lucru, locatarii nu o vad inca").style.color);
    const apa = randFactura("Apa rece");
    expect(apa.getByText("Apa Canal")).toBeTruthy();
    expect(apa.getByText("Neplatita furnizorului")).toBeTruthy();
    expect(apa.queryByRole("button", { name: "Vezi factura" })).toBeNull();
  });
});

describe("AdminFacturi, publicare", () => {
  it("confirmarea arata numarul de cheltuieli, suma si termenul, apoi publica", async () => {
    const { sursa } = await deschideFacturi({ sursa: await sursaCuCitiriVerificate() });
    const spion = vi.spyOn(sursa, "publicaLista");
    const listaId = await idLista(sursa, "2026-09");
    await apasa("Calculeaza lista pe apartamente");
    await apasa("Publica lista");
    const f = inDialog("Publica lista");
    expect(f.getByText("Publici lista pe septembrie 2026, cu 1 cheltuieli in valoare de 1.600,00 lei.")).toBeTruthy();
    expect(f.getByText(/Termenul de plata va fi 25 octombrie 2026\./)).toBeTruthy();
    await apasa(f.getByRole("button", { name: "Da, publica lista" }));
    expect(spion).toHaveBeenCalledWith(listaId);
    expect(toast().textContent).toBe("Lista a fost publicata. Locatarii o vad acum.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("septembrie 2026 · publicata")).toBeTruthy();
    const rand = (t) => zonaCu(t, 1).parentElement.textContent;
    expect(rand("Total facturi si fonduri")).toBe("Total facturi si fonduri1.600,00 lei");
    expect(rand("Total repartizat pe 20 apartamente")).toBe("Total repartizat pe 20 apartamente1.600,00 lei");
    expect(rand("Nealocat")).toBe("Nealocat0,00 lei");
    expect(screen.getByText("Publicata pe 19 septembrie 2026, termen de plata 25 octombrie 2026.")).toBeTruthy();
    /* Previzualizarea veche a disparut, iar lista noua se poate incepe */
    expect(screen.queryByText("Total repartizat")).toBeNull();
    expect(screen.getByText("Lista pe octombrie 2026 nu este inceputa")).toBeTruthy();
    expect(butoane("Adauga factura")).toHaveLength(0);
  });

  it("in timpul publicarii butonul arata 'Se publica...'; o eroare lasa foaia deschisa", async () => {
    const { sursa } = await deschideFacturi();
    const a = amanata();
    vi.spyOn(sursa, "publicaLista").mockReturnValue(a.p.then(() => { throw new Error("Lipsesc citirile"); }));
    await apasa("Publica lista");
    await apasa(inDialog("Publica lista").getByRole("button", { name: "Da, publica lista" }));
    const inLucru = inDialog("Publica lista").getByRole("button", { name: "Se publica..." });
    expect(dezactivat(inLucru)).toBe(true);
    await act(async () => { a.rezolva(); });
    await apasa(inDialog("Publica lista").getByRole("button", { name: "Inapoi" }));
    expect(toast().textContent).toBe("Lipsesc citirile");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(dezactivat(buton("Publica lista"))).toBe(false);
  });

  it("foaia de confirmare se inchide si din X", async () => {
    await deschideFacturi();
    await apasa("Publica lista");
    await apasa(inDialog("Publica lista").getByRole("button", { name: "Inchide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("[L15] confirmarea foloseste termenul salvat pe lista, daca exista", async () => {
    await deschideFacturi({ modifica: (d) => { d.liste.find((l) => l.stare === "ciorna").scadenta = "2026-10-30"; } });
    await apasa("Publica lista");
    expect(inDialog("Publica lista").getByText(/Termenul de plata va fi 30 octombrie 2026\./)).toBeTruthy();
  });

  it("incepe lista pe luna urmatoare dupa publicare", async () => {
    const { sursa } = await deschideFacturi({ sursa: await sursaCuCitiriVerificate() });
    const spion = vi.spyOn(sursa, "deschideLista");
    await apasa("Publica lista");
    await apasa(inDialog("Publica lista").getByRole("button", { name: "Da, publica lista" }));
    await apasa("Incepe lista pe octombrie 2026");
    expect(spion).toHaveBeenCalledWith("2026-10");
    expect(toast().textContent).toBe("Lista pe octombrie 2026 a fost inceputa");
    expect(screen.getByText("octombrie 2026 · in lucru")).toBeTruthy();
    expect(randFactura("Fond de reparatii").getByText("C9")).toBeTruthy();
    expect(screen.queryByText(/nu este inceputa/)).toBeNull();
  });
});

describe("AdminFacturi, liste publicate", () => {
  it("august: totaluri, badge-uri de plata catre furnizor si export", async () => {
    await deschideFacturi();
    await apasa(screen.getByText("aug 26"));
    expect(screen.getByText("august 2026 · publicata")).toBeTruthy();
    expect(zonaCu(["Total repartizat pe 20 apartamente", "12.154,95 lei"]).textContent).toBe("Total repartizat pe 20 apartamente12.154,95 lei");
    expect(randFactura("Salubritate").getByText("De platit pana 30 sep 2026")).toBeTruthy();
    expect(randFactura("Apa rece si canalizare").getByText("Platita furnizorului 16 sep 2026")).toBeTruthy();
    expect(randFactura("Apa rece si canalizare").getByText("Apa Canal 2000 Arges · ACA-448120")).toBeTruthy();
    expect(butoane("Modifica")).toHaveLength(0);
    expect(butoane("Sterge")).toHaveLength(0);
    expect(butoane("Calculeaza lista pe apartamente")).toHaveLength(0);

    const nume = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { nume.push(this.download); });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    await apasa("Exporta PDF pentru avizier");
    expect(nume).toEqual(["lista-plata-2026-08.pdf"]);
  });

  it("marcheaza o factura platita furnizorului si anuleaza plata", async () => {
    const { sursa } = await deschideFacturi();
    const spion = vi.spyOn(sursa, "marcheazaFacturaPlatita");
    const d = await sursa.incarca();
    const sal = d.cheltuieli.find((c) => c.categorie === "Salubritate" && c.listaId === d.liste[1].id);
    await apasa(screen.getByText("aug 26"));
    await apasa(randFactura("Salubritate").getByRole("button", { name: "Marcheaza platita" }));
    expect(spion).toHaveBeenLastCalledWith(sal.id, true);
    expect(toast().textContent).toBe("Factura marcata ca platita furnizorului");
    expect(randFactura("Salubritate").getByText("Platita furnizorului 19 sep 2026")).toBeTruthy();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await apasa(randFactura("Salubritate").getByRole("button", { name: "Anuleaza plata furnizor" }));
    expect(spion).toHaveBeenLastCalledWith(sal.id, false);
    expect(toast().textContent).toBe("Plata catre furnizor a fost anulata");
    expect(randFactura("Salubritate").getByText("De platit pana 30 sep 2026")).toBeTruthy();
  });

  it("factura fara scadenta si fara serie; lista publicata fara cheltuieli", async () => {
    await deschideFacturi({
      modifica: (d) => {
        const sal = d.cheltuieli.find((c) => c.categorie === "Salubritate" && c.listaId === d.liste[1].id);
        sal.scadentaFurnizor = null;
        sal.serie = null;
        d.cheltuieli = d.cheltuieli.filter((c) => c.listaId !== d.liste[2].id);
      },
    });
    await apasa(screen.getByText("aug 26"));
    expect(randFactura("Salubritate").getByText("Neplatita furnizorului")).toBeTruthy();
    expect(randFactura("Salubritate").getByText("Salubritate 2000")).toBeTruthy();
    await apasa(screen.getByText("iul 26"));
    expect(screen.getByText("Nicio cheltuiala")).toBeTruthy();
    expect(butoane("Adauga factura")).toHaveLength(0);
    expect(zonaCu(["Nealocat", "-11.219,10 lei"]).textContent).toBe("Nealocat-11.219,10 lei");
  });

  it("fara ciorna, pagina porneste pe lista publicata", async () => {
    await deschideFacturi({ modifica: (d) => { d.liste = d.liste.filter((l) => l.stare !== "ciorna"); } });
    expect(screen.getByText("august 2026 · publicata")).toBeTruthy();
    expect(screen.getByText("Lista pe septembrie 2026 nu este inceputa")).toBeTruthy();
  });
});

describe("AdminFacturi, fara nicio lista", () => {
  it("incepe prima lista pe luna curenta; o eroare nu schimba ecranul", async () => {
    const { sursa } = await deschideFacturi({ modifica: (d) => { d.liste = []; } });
    const spion = vi.spyOn(sursa, "deschideLista").mockRejectedValueOnce(new Error("Exista deja o lista pe luna aceasta."));
    /* Eticheta din antet plus tab-ul */
    expect(screen.getAllByText("Facturi")).toHaveLength(2);
    expect(screen.queryByText(/aug 26/)).toBeNull();
    expect(butoane("Publica lista")).toHaveLength(0);
    await apasa("Incepe lista pe septembrie 2026");
    expect(spion).toHaveBeenCalledWith("2026-09");
    expect(toast().textContent).toBe("Exista deja o lista pe luna aceasta.");
    expect(screen.getByText("Lista pe septembrie 2026 nu este inceputa")).toBeTruthy();
  });
});
