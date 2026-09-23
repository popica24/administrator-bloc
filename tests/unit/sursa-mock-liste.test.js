/* Sursa demo: lista lunara, facturile si publicarea cu motorul. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import * as motor from "../../supabase/functions/_shared/motor.js";
import { ceasDemo, ZI_DEMO, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";

/* Motorul real, cu posibilitatea de a-i falsifica un singur rezultat */
vi.mock("../../supabase/functions/_shared/motor.js", async (importOriginal) => {
  const m = await importOriginal();
  return { ...m, calculeazaLista: vi.fn(m.calculeazaLista) };
});

const apNr = (d, n) => d.apartamente.find((a) => a.numar === n);
const listaLuna = (d, luna) => d.liste.find((l) => l.luna === luna);
const cheltuieliLista = (d, listaId) => d.cheltuieli.filter((c) => c.listaId === listaId);

async function admin() {
  const s = creeazaSursaMock();
  await s.intra(ADMIN, PAROLA);
  const d = await s.incarca();
  return { s, d, ciorna: listaLuna(d, "2026-09"), furnizor: (cod) => d.furnizori.find((f) => f.cod === cod) };
}

const factura = (listaId, extra = {}) => ({
  listaId, furnizorId: null, categorie: "Energie electrica parti comune", cod: "C3", suma: "412.355", metoda: "apartamente",
  serie: "EEM-1", emisa: "2026-10-02", scadentaFurnizor: "2026-10-20", ...extra,
});

beforeEach(() => ceasDemo());

/* [K6] Lista nu se publica peste citiri trimise: administratorul le verifica
   intai. In datele demo, septembrie are cateva inca neverificate. */
async function verificaCitirile(s, luna = "2026-09") {
  const d = await s.incarca();
  for (const c of d.citiri.filter((x) => x.luna === luna && x.stare === "trimisa")) await s.valideazaCitire(c.id, true);
}

describe("deschideLista", () => {
  it("intoarce lista existenta a lunii", async () => {
    const { s, ciorna } = await admin();
    expect(await s.deschideLista("2026-09")).toBe(ciorna.id);
  });

  it("o luna noua primeste ciorna cu contributia recurenta la fond", async () => {
    const { s } = await admin();
    const id = await s.deschideLista("2026-10");
    const d = await s.incarca();
    expect(d.liste[0]).toMatchObject({ id, luna: "2026-10", stare: "ciorna", versiune: 1, scadenta: null });
    const [c] = cheltuieliLista(d, id);
    expect(c).toMatchObject({ cod: "C9", tip: "fond_reparatii", suma: 1600, metoda: "cota", serie: "Hotarare AG din 12.03.2026", furnizorId: null, achitataLa: null });
    expect(d.documente.find((x) => x.id === c.documentId).titlu).toBe("Proces verbal adunare generala, 12 martie 2026");
  });

  it("locatarul nu poate deschide liste", async () => {
    const s = creeazaSursaMock();
    await s.intra(LOCATAR, PAROLA);
    await expect(s.deschideLista("2026-10")).rejects.toThrow("Doar administratorul poate face asta.");
  });
});

describe("salveazaCheltuiala", () => {
  it("adauga factura unui furnizor existent, cu suma rotunjita la ban", async () => {
    const { s, ciorna, furnizor } = await admin();
    const id = await s.salveazaCheltuiala(factura(ciorna.id, { furnizorId: furnizor("C3").id, categorie: "  Energie  " }));
    const c = (await s.incarca()).cheltuieli.find((x) => x.id === id);
    expect(c).toEqual({
      id, listaId: ciorna.id, cod: "C3", tip: "factura", categorie: "Energie", furnizorId: furnizor("C3").id, furnizor: "Enel Energie Muntenia",
      serie: "EEM-1", suma: 412.36, metoda: "apartamente", tipApa: null, emisa: "2026-10-02", scadentaFurnizor: "2026-10-20", achitataLa: null, documentId: null,
    });
  });

  it("campurile optionale lipsa devin null", async () => {
    const { s, ciorna, furnizor } = await admin();
    const id = await s.salveazaCheltuiala(factura(ciorna.id, { furnizorId: furnizor("C3").id, serie: "", emisa: "", scadentaFurnizor: undefined }));
    const c = (await s.incarca()).cheltuieli.find((x) => x.id === id);
    expect(c).toMatchObject({ serie: null, emisa: null, scadentaFurnizor: null });
  });

  it("un furnizor nou se creeaza o data cu factura; scanarea devine document", async () => {
    const { s, ciorna } = await admin();
    const fisier = new File(["x"], "factura.pdf");
    const id = await s.salveazaCheltuiala(factura(ciorna.id, {
      furnizorNou: "  Apa Noua SRL ", cod: "C10", categorie: "Apa rece", metoda: "consum", tipApa: "rece", fisier, serie: "AN-7",
    }));
    const d = await s.incarca();
    const c = d.cheltuieli.find((x) => x.id === id);
    expect(c).toMatchObject({ furnizor: "Apa Noua SRL", tipApa: "rece", metoda: "consum" });
    expect(d.furnizori.find((f) => f.id === c.furnizorId)).toMatchObject({ denumire: "Apa Noua SRL", cui: null, categorie: "Apa rece", metoda: "consum", tipApa: "rece", cod: "C10" });
    expect(d.documente.find((x) => x.id === c.documentId)).toMatchObject({ titlu: "Factura AN-7", tip: "factura" });
  });

  it("scanarea fara serie se numeste doar Factura; furnizorul nou fara apa are tipApa null", async () => {
    const { s, ciorna } = await admin();
    const id = await s.salveazaCheltuiala(factura(ciorna.id, { furnizorNou: "Firma", cod: "C11", serie: "", fisier: new Blob(["x"]) }));
    const d = await s.incarca();
    const c = d.cheltuieli.find((x) => x.id === id);
    expect(d.documente.find((x) => x.id === c.documentId).titlu).toBe("Factura");
    expect(d.furnizori.find((f) => f.id === c.furnizorId).tipApa).toBeNull();
  });

  it("modifica o factura existenta si ii poate schimba scanarea", async () => {
    const { s, ciorna, furnizor } = await admin();
    const id = await s.salveazaCheltuiala(factura(ciorna.id, { furnizorId: furnizor("C3").id }));
    expect(await s.salveazaCheltuiala(factura(ciorna.id, { id, furnizorId: furnizor("C3").id, suma: 500 }))).toBe(id);
    let c = (await s.incarca()).cheltuieli.find((x) => x.id === id);
    expect(c).toMatchObject({ suma: 500, documentId: null });
    await s.salveazaCheltuiala(factura(ciorna.id, { id, furnizorId: furnizor("C3").id, suma: 501, fisier: new File(["y"], "n.pdf") }));
    c = (await s.incarca()).cheltuieli.find((x) => x.id === id);
    expect(c.suma).toBe(501);
    expect(c.documentId).not.toBeNull();
  });

  it("refuzurile: furnizor lipsa, cod dublat, lista gresita sau publicata, suma, apa fara tip, cheltuiala inexistenta", async () => {
    const { s, d, ciorna, furnizor } = await admin();
    const f = furnizor("C3").id;
    await expect(s.salveazaCheltuiala(factura(ciorna.id))).rejects.toThrow("Alege furnizorul facturii.");
    await expect(s.salveazaCheltuiala(factura(ciorna.id, { furnizorNou: "   " }))).rejects.toThrow("Alege furnizorul facturii.");
    await expect(s.salveazaCheltuiala(factura(ciorna.id, { furnizorId: f, cod: "C9" }))).rejects.toThrow("Codul C9 exista deja pe lista.");
    await expect(s.salveazaCheltuiala(factura("lis-0", { furnizorId: f }))).rejects.toThrow("Lista nu exista.");
    await expect(s.salveazaCheltuiala(factura(listaLuna(d, "2026-08").id, { furnizorId: f, cod: "C99" })))
      .rejects.toThrow("Lista este publicata. Cheltuielile ei nu se mai pot modifica.");
    await expect(s.salveazaCheltuiala(factura(ciorna.id, { furnizorId: f, suma: "0" }))).rejects.toThrow("Suma trebuie sa fie mai mare decat zero.");
    await expect(s.salveazaCheltuiala(factura(ciorna.id, { furnizorId: f, suma: "abc" }))).rejects.toThrow("Suma trebuie sa fie mai mare decat zero.");
    await expect(s.salveazaCheltuiala(factura(ciorna.id, { furnizorId: f, metoda: "consum", tipApa: null })))
      .rejects.toThrow("Alege daca factura este de apa rece sau de apa calda.");
    await expect(s.salveazaCheltuiala(factura(ciorna.id, { furnizorId: f, id: "che-0" }))).rejects.toThrow("Cheltuiala nu exista.");
    expect(cheltuieliLista(await s.incarca(), ciorna.id)).toHaveLength(1);
  });

  it("locatarul nu poate salva facturi", async () => {
    const s = creeazaSursaMock();
    await s.intra(LOCATAR, PAROLA);
    await expect(s.salveazaCheltuiala(factura("x"))).rejects.toThrow("Doar administratorul poate face asta.");
  });

  it("[L3] randul fondului nu devine factura: formularul de factura il refuza", async () => {
    const { s, ciorna } = await admin();
    const fond = (await s.incarca()).cheltuieli.find((c) => c.listaId === ciorna.id && c.cod === "C9");
    await expect(s.salveazaCheltuiala({ ...fond, id: fond.id, furnizorNou: "Asociatia", suma: 1700 }))
      .rejects.toThrow("Randul fondului de reparatii nu se modifica din formularul de factura.");
    const dupa = (await s.incarca()).cheltuieli.find((c) => c.id === fond.id);
    expect(dupa).toMatchObject({ tip: "fond_reparatii", suma: fond.suma, furnizorId: fond.furnizorId });
  });

  it("[L11] un cod dublat nu lasa in urma furnizorul nou", async () => {
    const { s, ciorna } = await admin();
    const inainte = (await s.incarca()).furnizori.length;
    await s.salveazaCheltuiala(factura(ciorna.id, { furnizorNou: "Orfan SRL", cod: "C9" })).catch(() => {});
    expect((await s.incarca()).furnizori).toHaveLength(inainte);
  });
});

describe("stergeCheltuiala", () => {
  it("sterge din ciorna; refuza pe lista publicata sau o cheltuiala inexistenta", async () => {
    const { s, d, ciorna } = await admin();
    const [fond] = cheltuieliLista(d, ciorna.id);
    await s.stergeCheltuiala(fond.id);
    expect(cheltuieliLista(await s.incarca(), ciorna.id)).toEqual([]);
    await expect(s.stergeCheltuiala(fond.id)).rejects.toThrow("Cheltuiala nu exista.");
    const publicata = cheltuieliLista(d, listaLuna(d, "2026-08").id)[0];
    await expect(s.stergeCheltuiala(publicata.id)).rejects.toThrow("Lista este publicata. Cheltuielile ei nu se mai pot sterge.");
  });
});

describe("dateMotor", () => {
  it("da motorului persoanele lunii, cheltuielile si consumul validat", async () => {
    const { s, ciorna } = await admin();
    const x = await s.dateMotor(ciorna.id);
    expect(x.apartamente).toHaveLength(20);
    expect(x.apartamente[0]).toEqual({ id: expect.any(String), numar: "1", persoane: 2, cota: 4.01, scutitLift: true });
    expect(x.cheltuieli).toEqual([{ id: expect.any(String), cod: "C9", suma: 1600, metoda: "cota", tipApa: null }]);
    /* in septembrie sunt validate 6 apartamente, iar contorul general nu e citit */
    expect(Object.keys(x.consum)).toHaveLength(6);
    expect(x.contorGeneral).toEqual({});
    const aug = await s.dateMotor(listaLuna((await s.incarca()), "2026-08").id);
    expect(aug.contorGeneral).toEqual({ rece: 428, calda: 196 });
  });
});

describe("publicaLista", () => {
  it("publica: repartizari, datorii, fond, scadenta implicita si notificari", async () => {
    const { s, ciorna } = await admin();
    await verificaCitirile(s);
    await s.publicaLista(ciorna.id);
    const d = await s.incarca();
    const l = listaLuna(d, "2026-09");
    expect(l).toMatchObject({ stare: "publicata", scadenta: "2026-10-25", publicataLa: ZI_DEMO.toISOString(), totalRepartizat: 1600, apartamente: 20 });
    const datorii = d.datorii.filter((x) => x.listaId === l.id);
    expect(datorii).toHaveLength(20);
    expect(datorii[0]).toMatchObject({ tip: "intretinere", luna: "2026-09", descriere: "Intretinere septembrie 2026", scadenta: "2026-10-25" });
    expect(Math.round(datorii.reduce((t, x) => t + x.suma, 0) * 100)).toBe(160000);
    const fond = d.fonduri.find((f) => f.tip === "reparatii");
    expect(fond.sold).toBe(19228.6 + 1600);
    expect(fond.miscari.find((m) => m.listaId === l.id)).toMatchObject({ suma: 1600, descriere: "Contributii fond reparatii, lista pe septembrie 2026" });

    await s.intra(LOCATAR, PAROLA);
    const n = (await s.incarca()).notificari[0];
    expect(n).toMatchObject({ tip: "lista_publicata", titlu: "Lista pe septembrie 2026 a fost publicata", cititaLa: null });
    expect(n.corp).toContain("Termenul de plata este 25 octombrie 2026.");
  });

  it("banii platiti in avans acopera datoria noua", async () => {
    const { s, ciorna } = await admin();
    await s.intra(LOCATAR, PAROLA);
    const e = await s.incarca();
    const rest = e.datorii.reduce((t, x) => t + x.rest, 0);
    await s.platesteCard({ apartamentId: e.eu.apartamentId, suma: rest + 50, card: { numar: "4242424242424242", expira: "12/29" } });
    await s.intra(ADMIN, PAROLA);
    await verificaCitirile(s);
    await s.publicaLista(ciorna.id);
    await s.intra(LOCATAR, PAROLA);
    const d = await s.incarca();
    const noua = d.datorii.find((x) => x.luna === "2026-09");
    expect(noua.rest).toBe(Math.round((noua.suma - 50) * 100) / 100);
  });

  it("fara reminderul activ nu trimite notificari; apartamentele cu 0 lei nu primesc datorie", async () => {
    const { s, d, ciorna, furnizor } = await admin();
    await s.seteazaReminder("lista_publicata", false);
    await s.stergeCheltuiala(cheltuieliLista(d, ciorna.id)[0].id);
    await s.salveazaCheltuiala(factura(ciorna.id, { furnizorId: furnizor("C5").id, cod: "C5", metoda: "persoane_fara_lift", suma: 640 }));
    await verificaCitirile(s);
    await s.publicaLista(ciorna.id);
    const dupa = await s.incarca();
    const l = listaLuna(dupa, "2026-09");
    const cuDatorie = dupa.datorii.filter((x) => x.listaId === l.id).map((x) => x.apartamentId);
    expect(cuDatorie).toHaveLength(16);
    ["1", "2", "3", "4"].forEach((n) => expect(cuDatorie).not.toContain(apNr(dupa, n).id));
    expect(dupa.repartizari.filter((r) => r.listaId === l.id)).toHaveLength(20);
    expect(dupa.fonduri.find((f) => f.tip === "reparatii").sold).toBe(19228.6);
    await s.intra(LOCATAR, PAROLA);
    expect((await s.incarca()).notificari.filter((n) => n.titlu.includes("septembrie"))).toEqual([]);
  });

  it("refuza: lista inexistenta, deja publicata, fara cheltuieli, date incomplete pentru motor", async () => {
    const { s, d, ciorna, furnizor } = await admin();
    await verificaCitirile(s);
    await expect(s.publicaLista("lis-0")).rejects.toThrow("Lista nu exista.");
    await expect(s.publicaLista(listaLuna(d, "2026-08").id)).rejects.toThrow("Lista este deja publicata.");
    await s.stergeCheltuiala(cheltuieliLista(d, ciorna.id)[0].id);
    await expect(s.publicaLista(ciorna.id)).rejects.toThrow("Lista nu are nicio cheltuiala.");
    await s.salveazaCheltuiala(factura(ciorna.id, { furnizorId: furnizor("C1").id, cod: "C1", metoda: "consum", tipApa: "rece", suma: 3000 }));
    await expect(s.publicaLista(ciorna.id)).rejects.toThrow("C1: lipseste citirea contorului general pentru apa rece.");
    expect(listaLuna(await s.incarca(), "2026-09").stare).toBe("ciorna");
  });

  /* [K6] Ca trigger-ul din baza: dupa publicare, o citire trimisa nu mai
     poate fi verificata de nicio comanda si ar ramane blocata. */
  it("[K6] refuza publicarea cat timp luna are citiri trimise, la plural si la singular", async () => {
    const { s, d, ciorna } = await admin();
    const trimise = d.citiri.filter((x) => x.luna === "2026-09" && x.stare === "trimisa");
    expect(trimise.length).toBeGreaterThan(1);
    await expect(s.publicaLista(ciorna.id)).rejects.toThrow(
      `Pe septembrie 2026 mai sunt ${trimise.length} citiri de verificat. Valideaza-le sau respinge-le, apoi publica lista.`);
    for (const c of trimise.slice(1)) await s.valideazaCitire(c.id, true);
    await expect(s.publicaLista(ciorna.id)).rejects.toThrow(
      "Pe septembrie 2026 mai este o citire de verificat. Valideaza-o sau respinge-o, apoi publica lista.");
    expect(listaLuna(await s.incarca(), "2026-09").stare).toBe("ciorna");
    await s.valideazaCitire(trimise[0].id, false, "Poza neclara.");
    await s.publicaLista(ciorna.id);
    expect(listaLuna(await s.incarca(), "2026-09").stare).toBe("publicata");
  });

  it("[K6] de la 20 de citiri in sus, mesajul spune \"de citiri\", ca in baza", async () => {
    const { s, d, ciorna } = await admin();
    const trimise = d.citiri.filter((x) => x.luna === "2026-09" && x.stare === "trimisa").length;
    const ap = apNr(d, "9");
    for (let i = trimise; i < 20; i += 1) {
      s.db.adauga("citiri", {
        contorId: `ctr-k6-${i}`, blocId: d.bloc.id, apartamentId: ap.id, tip: "rece", luna: "2026-09",
        indexAnterior: 0, indexCurent: 1, consum: 1, sursa: "locatar", stare: "trimisa", pozaCale: null,
      });
    }
    await expect(s.publicaLista(ciorna.id)).rejects.toThrow(
      "Pe septembrie 2026 mai sunt 20 de citiri de verificat. Valideaza-le sau respinge-le, apoi publica lista.");
  });

  it("refuza un rezultat al motorului care nu se inchide la ban", async () => {
    const { s, ciorna } = await admin();
    await verificaCitirile(s);
    const real = (await vi.importActual("../../supabase/functions/_shared/motor.js")).calculeazaLista;
    motor.calculeazaLista.mockImplementationOnce((date) => ({ ...real(date), totalRepartizat: 1599.99 }));
    await expect(s.publicaLista(ciorna.id)).rejects.toThrow("Totalul repartizat nu este egal cu totalul facturilor.");
    const d = await s.incarca();
    expect(listaLuna(d, "2026-09").stare).toBe("ciorna");
    expect(d.repartizari.filter((r) => r.listaId === ciorna.id)).toEqual([]);
  });

  it("locatarul nu poate publica si nu vede ciorna", async () => {
    const s = creeazaSursaMock();
    await s.intra(LOCATAR, PAROLA);
    await expect(s.publicaLista("lis-1")).rejects.toThrow("Doar administratorul poate face asta.");
    await expect(s.dateMotor("lis-1")).rejects.toThrow("Doar administratorul poate face asta.");
    await expect(s.stergeCheltuiala("che-1")).rejects.toThrow("Doar administratorul poate face asta.");
    expect(listaLuna(await s.incarca(), "2026-09")).toBeUndefined();
  });
});

describe("liste in afara ordinii lunilor", () => {
  it("lista pe decembrie are scadenta in ianuarie anul urmator", async () => {
    const { s } = await admin();
    const id = await s.deschideLista("2026-12");
    await s.publicaLista(id);
    expect((await s.incarca()).liste.find((l) => l.id === id).scadenta).toBe("2027-01-25");
  });

  it("o lista pe o luna veche se ordoneaza dupa luna; la scadente egale se plateste intai datoria creata mai devreme", async () => {
    ceasDemo(new Date("2026-05-01T09:00:00"));
    const { s, d } = await admin();
    /* o plata cu data mai veche decat platile rejucate, ca avansurile sa se ordoneze dupa data */
    await s.intra(LOCATAR, PAROLA);
    await s.platesteCard({ apartamentId: apNr(d, "17").id, suma: 5, card: { numar: "4242424242424242", expira: "12/29" } });
    await s.intra(ADMIN, PAROLA);
    const id = await s.deschideLista("2026-04");
    await s.publicaLista(id);
    const dupa = await s.incarca();
    expect(dupa.liste.map((l) => l.luna)).toEqual(["2026-09", "2026-08", "2026-07", "2026-06", "2026-04"]);
    const ap11 = apNr(dupa, "11").id;
    const aprilie = dupa.datorii.find((x) => x.listaId === id && x.apartamentId === ap11);
    const soldInitial = dupa.datorii.find((x) => x.apartamentId === ap11 && x.tip === "sold_initial");
    expect(aprilie.scadenta).toBe(soldInitial.scadenta);
    const { plataId } = await s.inregistreazaIncasare(ap11, 10, "numerar");
    const p = (await s.incarca()).plati.find((x) => x.id === plataId);
    expect(p.alocari).toEqual([{ datorieId: aprilie.id, suma: 10 }]);
  });
});

describe("marcheazaFacturaPlatita", () => {
  it("pune data de azi sau o sterge; factura inexistenta e refuzata", async () => {
    const { s, d } = await admin();
    const aug = listaLuna(d, "2026-08");
    const sal = cheltuieliLista(d, aug.id).find((c) => c.serie === "SAL-33128");
    expect(sal.achitataLa).toBeNull();
    await s.marcheazaFacturaPlatita(sal.id, true);
    expect((await s.incarca()).cheltuieli.find((c) => c.id === sal.id).achitataLa).toBe("2026-09-19");
    await s.marcheazaFacturaPlatita(sal.id, false);
    expect((await s.incarca()).cheltuieli.find((c) => c.id === sal.id).achitataLa).toBeNull();
    await expect(s.marcheazaFacturaPlatita("che-0", true)).rejects.toThrow("Factura nu exista.");
  });

  it("[§8] randul fondului de reparatii nu se poate marca platit", async () => {
    const { s, d } = await admin();
    const fond = cheltuieliLista(d, listaLuna(d, "2026-08").id).find((c) => c.tip === "fond_reparatii");
    await expect(s.marcheazaFacturaPlatita(fond.id, true)).rejects.toThrow();
  });
});
