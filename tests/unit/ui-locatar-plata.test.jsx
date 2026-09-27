/* Ecranul Plata al locatarului (LocatarPlata): lista in trei trepte, alegerea
   lunii (AlegeLuna), datoriile si penalizarile (RandSuma, TreaptaAntet),
   verificarea repartitiei, Platile mele si cum se plateste (CardCumPlatesti). */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { pornesteApp, zonaCu, textEcran } from "./ajutor.jsx";
import {
  ELENA, ILIE, VOICU, apasa, apasaButon, alegeSegment, deschideTab, prindeDescarcari, prindeFerestre, text,
} from "./ui-locatar-ajutor.jsx";
import { prindePdf } from "./ui-baza-ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const ecran = () => textEcran();
/* Cardul de sus: totalul si cele trei trepte scurte */
const cardTotal = () => zonaCu([/Apasă pe un rând ca să vezi factura/, /1\. Cheltuielile lunii /], 3);

async function laPlata(optiuni) {
  const r = await pornesteApp(optiuni);
  await deschideTab("Plata");
  return r;
}

/* Plata in numerar sau prin transfer, confirmata de administrator:
   ecranul spune omului exact ce are de facut, cu datele deja din baza. */
describe("Plata: cum plătești", () => {
  it("arata incasarea la administrator si datele pentru transfer bancar", async () => {
    await laPlata({ email: ELENA });
    const card = zonaCu([/Cum plătești/, /Prin transfer bancar/]);
    expect(text(card)).toContain("În numerar, la administrator");
    expect(text(card)).toContain("Mihai Dobre");
    expect(text(card)).toContain("Marti si joi, 17:00 - 19:00");
    expect(text(card)).toContain("Prin transfer bancar");
    expect(text(card)).toContain("RO49RNCB0082004512340001");
    expect(text(card)).toContain("BCR, sucursala Pitesti");
    expect(text(card)).toContain("Asociatia de proprietari nr. 118");
    expect(text(card)).toContain("Scrie la detalii: apartament 17, Bloc D14, scara A");
    expect(text(card)).toContain("Chitanța o primești în Plățile mele, după ce administratorul înregistrează banii.");
    expect(screen.getByRole("button", { name: "Sună 0745 210 118" })).toBeTruthy();
  });

  it("fara contact de administrator si fara IBAN, spune ce lipseste si nu arata transferul", async () => {
    await laPlata({
      email: ELENA,
      modifica: (d) => {
        d.contacte = d.contacte.filter((c) => c.rol !== "administrator");
        d.asociatie.iban = "";
      },
    });
    const card = zonaCu([/Cum plătești/, /În numerar, la administrator/]);
    expect(text(card)).toContain("Administratorul nu are un contact trecut în aplicație.");
    expect(text(card)).not.toContain("Prin transfer bancar");
  });

  it("cand nu are nimic de plata, nu mai arata cum se plateste", async () => {
    await laPlata({ email: VOICU });
    expect(screen.queryByText("Cum plătești")).toBeNull();
  });
});

describe("Plata: lista curentă", () => {
  it("fara lista publicata arata un ecran gol", async () => {
    await laPlata({ email: ELENA, modifica: (d) => { d.liste = []; } });
    expect(screen.getByText("Nicio listă publicată")).toBeTruthy();
    expect(screen.queryByText("Lista de plată")).toBeNull();
  });

  it("arata totalul si cele trei trepte", async () => {
    await laPlata({ email: ELENA });
    expect(screen.getByText("Apartament 17, 3 persoane, cotă 4,63%")).toBeTruthy();
    expect(screen.getByText("Total de plată acum")).toBeTruthy();
    const card = cardTotal();
    expect(text(card)).toContain("1. Cheltuielile lunii august");
    expect(text(card)).toContain("2. Fonduri74,08 lei");
    expect(text(card)).toContain("3. Datorii din lunile trecute0,00 lei");
    expect(text(card)).toContain("Total de plată718,09 lei");
    expect(text(card)).not.toContain("Plătit deja");
    expect(text(card)).toContain("Termen de plată 25 septembrie 2026. Mai jos este fiecare sumă pe rând.");
    expect(screen.getByText("Ai de plată 718,09 lei")).toBeTruthy();
    /* lunile, ca butoane: sunt doar trei liste */
    expect(screen.getByRole("button", { name: "aug 26" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("combobox", { name: "Luna" })).toBeNull();
  });

  it("grupeaza cheltuielile si arata fondul si lipsa datoriilor", async () => {
    await laPlata({ email: ELENA });
    for (const g of ["Apa", "Curent, lift și curățenie", "Administrarea blocului"]) expect(screen.getByText(g)).toBeTruthy();
    expect(screen.getByText("Cheltuielile lunii")).toBeTruthy();
    expect(screen.getAllByText("Fonduri").length).toBeGreaterThan(0);
    expect(screen.getByText("Nu ai datorii din lunile trecute.")).toBeTruthy();
    expect(screen.getByText("Datorii din lunile trecute")).toBeTruthy();
  });

  it("verificarea repartitiei: facturile lunii sunt egale cu totalul repartizat", async () => {
    await laPlata({ email: ELENA });
    const card = zonaCu(["Verificarea repartiției", "Diferența"]);
    expect(text(card)).toContain("Total facturi și fonduri pe luna12.154,95 lei");
    expect(text(card)).toContain("Total repartizat pe cele 20 apartamente12.154,95 lei");
    expect(text(card)).toContain("Diferența0,00 lei");
  });

  it("scade ce s-a platit deja din lista lunii, dupa alocarile reale", async () => {
    await laPlata({
      email: ELENA,
      modifica: (d) => {
        const dat = d.datorii.find((x) => x.luna === "2026-08");
        dat.rest = 518.09;
        d.plati.push({
          id: "pla-test-200", apartamentId: d.eu.apartamentId, suma: 200, metoda: "transfer", stare: "confirmata",
          inregistrataDe: null, confirmataLa: "2026-08-20T10:00:00+03:00", chitanta: null,
          alocari: [{ datorieId: dat.id, suma: 200 }],
        });
      },
    });
    const card = cardTotal();
    expect(text(card)).toContain("Plătit deja din lista lunii-200,00 lei");
    expect(text(card)).toContain("Total de plată518,09 lei");
    expect(screen.getByText("Ai de plată 518,09 lei")).toBeTruthy();
  });

  it("lista curenta platita integral: badge Achitat si fara buton de plata", async () => {
    await laPlata({ email: VOICU });
    expect(within(cardTotal()).getByText("Achitat")).toBeTruthy();
    expect(screen.queryByText("Cum plătești")).toBeNull();
  });

  it("doua contributii la fonduri apar amandoua in treapta 2", async () => {
    await laPlata({
      email: ELENA,
      modifica: (d) => {
        const fond = d.cheltuieli.find((c) => c.listaId === d.liste[0].id && c.tip !== "factura");
        const rep = d.repartizari.find((r) => r.cheltuialaId === fond.id);
        d.cheltuieli.push({ ...fond, id: "che-rulment", cod: "C10", tip: "fond_rulment", categorie: "Fond de rulment", suma: 400 });
        d.repartizari.push({ ...rep, cheltuialaId: "che-rulment", suma: 20 });
      },
    });
    expect(text(cardTotal())).toContain("2. Fonduri94,08 lei");
    const treapta = zonaCu(["Fond de reparatii", "Fond de rulment"], 8);
    expect(text(treapta)).toContain("Fond de reparatii");
    expect(text(treapta)).toContain("Fond de rulment");
  });

  it("fara contributie la fonduri nu apare treapta 2 detaliata", async () => {
    await laPlata({ email: ELENA, modifica: (d) => { d.cheltuieli = d.cheltuieli.filter((c) => c.tip === "factura"); } });
    expect(text(cardTotal())).toContain("2. Fonduri0,00 lei");
    expect(screen.queryByText("Fond de reparatii")).toBeNull();
  });

  it("fara termen pe lista nu scrie termenul de plata", async () => {
    let date;
    await pornesteApp({ email: ELENA, modifica: (d) => { date = d; } });
    /* Acasa cere termenul; il scoatem doar inainte de Plata */
    date.liste[0].scadenta = null;
    await deschideTab("Plata");
    expect(ecran()).not.toContain("Termen de plată");
    expect(ecran()).toContain("Mai jos este fiecare sumă pe rând.");
  });

  it("[L4] dupa o recalculare, totalul de plata este egal cu soldul", async () => {
    await laPlata({
      email: ELENA,
      modifica: (d) => {
        /* v1 = 700 lei, platita; v2 = 718,09 lei, diferenta ramane ca datorie de corectie pe aceeasi lista */
        const dat = d.datorii.find((x) => x.luna === "2026-08");
        dat.suma = 700;
        dat.rest = 0;
        d.datorii.push({ ...dat, id: "dat-corectie", tip: "corectie", suma: 18.09, rest: 18.09, descriere: "Corecție august 2026" });
      },
    });
    expect(text(cardTotal())).toContain("Total de plată18,09 lei");
  });

  it("[L6] grupa Apa contine doar apa, chiar daca salubritatea are codul C1", async () => {
    await laPlata({
      email: ELENA,
      modifica: (d) => {
        const lista = d.liste[0].id;
        const apa = d.cheltuieli.find((c) => c.listaId === lista && c.cod === "C1");
        const salubritate = d.cheltuieli.find((c) => c.listaId === lista && c.cod === "C4");
        apa.cod = "C4";
        salubritate.cod = "C1";
      },
    });
    const grupaApa = zonaCu(["Apa", "Apa rece si canalizare"], 3);
    expect(text(grupaApa)).not.toContain("Salubritate");
  });
});

describe("Plata: datorii si penalizari", () => {
  it("restantele cu zilele de intarziere si penalizarea cu formula", async () => {
    await laPlata({ email: ILIE });
    const card = cardTotal();
    expect(text(card)).toContain("3. Datorii din lunile trecute1.497,45 lei");
    expect(text(card)).toContain("Total de plată2.319,36 lei");
    const t = ecran();
    expect(t).toContain("Întreținere iunie 2026, neplătită");
    expect(t).toContain("scadență 25 iul 2026, 56 de zile întârziere748,64");
    expect(t).toContain("Întreținere iulie 2026, neplătită");
    expect(t).toContain("scadență 25 aug 2026, 25 de zile întârziere747,61");
    expect(t).toContain("Penalizare calculată pe 1 septembrie 2026");
    expect(t).toContain("748,64 × 0,02% × 8 zile1,20");
    expect(t).toContain("Penalizare pentru intretinere iunie 2026. Suma neplătită era 748,64 lei, cu 38 de zile de la scadență; primele 30 de zile nu se penalizează.");
    expect(t).toContain("Penalizarea este de 0,02% pe zi din suma neplătită, doar pentru zilele de după primele 30 de întârziere");
  });

  it("restanta preluata de pe hartie: rest partial, link la lista de pe hartie", async () => {
    const { open } = prindeFerestre();
    let docId;
    const { sursa } = await laPlata({
      email: ELENA,
      modifica: (d) => {
        docId = d.documente.find((x) => x.tip === "lista_plata").id;
        d.datorii.push(
          { id: "dat-si", apartamentId: d.eu.apartamentId, tip: "sold_initial", luna: "2026-05", listaId: null, suma: 967.2, rest: 500, scadenta: "2026-05-25", descriere: "Restanta preluata de pe lista de plata din mai 2026", documentId: docId, creatLa: "2026-05-31T12:00:00+03:00" },
          { id: "dat-fr", apartamentId: d.eu.apartamentId, tip: "fond_rulment", luna: "2026-09", listaId: null, suma: 480, rest: 480, scadenta: "2026-09-30", descriere: "Fond de rulment", documentId: null, creatLa: "2026-09-01T12:00:00+03:00" },
        );
      },
    });
    const spion = vi.spyOn(sursa, "deschideDocument");
    const t = ecran();
    expect(t).toContain("Restanta preluata de pe lista de plata din mai 2026rest din 967,20 lei, scadență 25 mai 2026, 117 zile întârziere500,00");
    /* datorie inca nescadenta: fara zile de intarziere, fara "rest din" */
    expect(t).toContain("Fond de rulmentscadență 30 sep 2026480,00");
    expect(screen.getAllByRole("button", { name: "Vezi lista de pe hârtie" })).toHaveLength(1);
    await apasaButon("Vezi lista de pe hârtie");
    expect(spion).toHaveBeenCalledWith(docId);
    expect(open).toHaveBeenCalled();
  });

  it("penalizare fara calcul salvat: formula este descrierea, sau lipseste", async () => {
    await laPlata({
      email: ILIE,
      modifica: (d) => {
        const pen = d.datorii.find((x) => x.tip === "penalizare");
        d.datorii.push({ ...pen, id: "dat-pen2", scadenta: "2026-09-02", descriere: null, rest: 0.5, suma: 0.5 });
        d.penalizari = [];
      },
    });
    const t = ecran();
    expect(t).toContain("Penalizare calculată pe 1 septembrie 2026Penalizare pentru intretinere iunie 20261,20");
    expect(t).toContain("Penalizare calculată pe 2 septembrie 20260,50");
    expect(t).not.toContain("Suma neplătită era");
  });
});

describe("Plata: alegerea lunii", () => {
  it("o luna trecuta platita: Achitata, fara datorii si fara buton de plata", async () => {
    await laPlata({ email: ELENA });
    await apasaButon("iul 26");
    expect(screen.getByText("Lista pe iulie 2026")).toBeTruthy();
    expect(screen.getByText("Achitata")).toBeTruthy();
    expect(text(cardTotal())).toContain("Total lista631,39 lei");
    expect(text(cardTotal())).not.toContain("3. Datorii");
    expect(screen.queryByText("Datorii din lunile trecute")).toBeNull();
    expect(screen.queryByText("Cum plătești")).toBeNull();
  });

  it("o luna trecuta neplatita: Neachitata", async () => {
    await laPlata({ email: ILIE });
    await apasaButon("iun 26");
    expect(screen.getByText("Neachitata")).toBeTruthy();
    expect(text(cardTotal())).toContain("Total lista748,64 lei");
  });

  it("cu mai mult de patru liste alegerea lunii devine lista derulanta", async () => {
    await laPlata({
      email: ELENA,
      modifica: (d) => {
        const l = d.liste[d.liste.length - 1];
        d.liste.push({ ...l, id: "lis-mai", luna: "2026-05" }, { ...l, id: "lis-apr", luna: "2026-04" });
      },
    });
    const luna = screen.getByRole("combobox", { name: "Luna" });
    expect([...luna.options].map((o) => o.textContent)).toEqual(["august 2026", "iulie 2026", "iunie 2026", "mai 2026", "aprilie 2026"]);
    await act(async () => { fireEvent.change(luna, { target: { value: luna.options[1].value } }); });
    expect(screen.getByText("Lista pe iulie 2026")).toBeTruthy();
  });
});

describe("Plata: Plățile mele", () => {
  it("fraza, graficul, lunile cu badge si platile cu chitanta", async () => {
    const descarcari = prindeDescarcari();
    const { sursa } = await laPlata({ email: ELENA });
    await alegeSegment("Plățile mele");
    expect(screen.getByText("Întreținerea pe august este 718,09 lei. Pe iulie a fost 631,39 lei, deci luna aceasta plătești cu 86,70 lei mai mult.")).toBeTruthy();
    const card = zonaCu(["Cât ai avut de plată", "iunie 2026"]);
    const t = text(card);
    expect(t).toContain("718aug 26");
    expect(t).toContain("august 2026718,09LEINeachitat");
    expect(t).toContain("iulie 2026631,39LEIAchitat");
    expect(t).toContain("iunie 2026655,45LEIAchitat");
    const d = await sursa.incarca();
    const plati = d.plati.slice().sort((a, b) => (a.confirmataLa < b.confirmataLa ? 1 : -1));
    const ecr = ecran();
    expect(ecr).toContain("Întreținere iulie 2026: 631,39 lei12 august 2026, transfer");
    expect(ecr).toContain("Întreținere iunie 2026: 655,45 lei14 iulie 2026, transfer");
    expect(ecr.indexOf("Întreținere iulie 2026: 631,39")).toBeLessThan(ecr.indexOf("Întreținere iunie 2026: 655,45"));
    expect(ecr).toContain(`Chitanța AP118 nr. ${String(plati[0].chitanta.numar).padStart(6, "0")}`);
    const butoane = screen.getAllByRole("button", { name: "Descarcă chitanța" });
    expect(butoane).toHaveLength(2);
    await apasa(butoane[0]);
    expect(descarcari).toEqual([`chitanta-${plati[0].chitanta.numar}.pdf`]);
  });

  /* [T1] Administratorul a stornat o incasare scrisa gresit. Plata nu dispare
     din istoric: omul are chitanta in mana si trebuie sa inteleaga de ce suma
     nu se mai scade din ce are de platit. */
  it("[T1] incasarea stornata ramane in istoric, taiata, cu motivul ei", async () => {
    await laPlata({
      email: ELENA,
      modifica: (d) => {
        /* cea mai noua plata, adica prima din lista de pe ecran */
        const p = d.plati.slice().sort((a, b) => (a.confirmataLa < b.confirmataLa ? 1 : -1))[0];
        p.stare = "rambursata";
        p.motivStornare = "Suma a fost scrisă greșit";
        p.stornataLa = "2026-09-18T10:00:00+03:00";
      },
    });
    await alegeSegment("Plățile mele");
    const t = ecran();
    expect(t).toContain("Anulată");
    expect(t).toContain("Anulată de administrator: Suma a fost scrisă greșit");
    /* chitanta ramane, cu numarul ei, si se vede de pe ea ca a fost anulata */
    const butoane = screen.getAllByRole("button", { name: "Descarcă chitanța" });
    expect(butoane.length).toBeGreaterThan(0);
    const pdf = prindePdf();
    await apasa(butoane[0]);
    expect((await pdf.ultimul()).text).toContain("ANULATA pe 18 septembrie 2026: Suma a fost scrisa gresit");
  });

  it("numerar, transfer si o plata fara chitanta", async () => {
    await laPlata({
      email: VOICU,
      modifica: (d) => {
        d.plati[1].metoda = "transfer";
        d.plati[2].chitanta = null;
        d.plati.reverse();
      },
    });
    await alegeSegment("Plățile mele");
    const t = ecran();
    /* cea mai noua plata prima, oricare ar fi ordinea primita */
    expect(t.indexOf("Întreținere august 2026")).toBeLessThan(t.indexOf("Întreținere iulie 2026"));
    expect(t.indexOf("Întreținere iulie 2026")).toBeLessThan(t.indexOf("Întreținere iunie 2026"));
    expect(t).toContain(", numerar");
    expect(t).toContain(", transfer");
    expect(screen.getAllByRole("button", { name: "Descarcă chitanța" })).toHaveLength(2);
    expect(screen.getAllByText(/^Chitanța AP118/)).toHaveLength(2);
  });

  it("fara nicio plata si fara fraza", async () => {
    await laPlata({ email: ILIE, modifica: (d) => { d.liste = d.liste.slice(0, 1); } });
    await alegeSegment("Plățile mele");
    expect(screen.getByText("Nicio plată încă")).toBeTruthy();
    expect(ecran()).not.toContain("deci luna aceasta plătești");
    expect(ecran()).toContain("august 2026821,91LEINeachitat");
  });

  it("[S2] Platile mele arata doar platile apartamentului propriu", async () => {
    await laPlata({
      email: ELENA,
      modifica: (d) => {
        /* presedintele care locuieste in bloc primeste prin RLS platile tuturor */
        d.plati.push({ id: "pla-strain", apartamentId: "apa-alt", suma: 300, metoda: "transfer", stare: "confirmata", confirmataLa: "2026-09-18T10:00:00+03:00", chitanta: null, alocari: [] });
      },
    });
    await alegeSegment("Plățile mele");
    expect(screen.queryByText("Avans pentru listele următoare")).toBeNull();
  });
});

