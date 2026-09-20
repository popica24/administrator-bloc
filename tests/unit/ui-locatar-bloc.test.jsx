/* Ecranul Bloc al locatarului (LocatarBloc): avizierul, votul cu confirmare
   si rezultatele (RezultateVot), adunarile, actele si fondurile. */
import { describe, it, expect, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { pornesteApp, sursaDemo, ceasDemo, zonaCu, textEcran, ADMIN } from "./ajutor.jsx";
import { ELENA, ILIE, apasa, apasaButon, alegeSegment, deschideTab, prindeFerestre, urlFalse, text } from "./ui-locatar-ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const ecran = () => textEcran();
const OFERTA_A = "Oferta A, usa aluminiu, 14.200 lei";
const OFERTA_B = "Oferta B, usa PVC cu geam termopan, 9.800 lei";
const AMANAM = "Amanam decizia pentru anul viitor";
/* Randul unei variante din rezultate: textul, procentul, bara si numarul de voturi */
const randVarianta = (textVarianta) => text(zonaCu([new RegExp(`^${textVarianta}`), /\d+%/, /\d+ (vot|voturi)/], 4));

async function laBloc(optiuni, subtab) {
  const r = await pornesteApp(optiuni);
  await deschideTab("Bloc");
  if (subtab) await alegeSegment(subtab);
  return r;
}

describe("Bloc: avizierul", () => {
  it("arata anunturile cu Urgent, data si autorul, apoi contactele", async () => {
    await laBloc({ email: ILIE });
    expect(screen.getByText("Str. Nicolae Balcescu nr. 22, Pitesti")).toBeTruthy();
    const urgent = zonaCu(["Oprire apa rece marti, 22 septembrie", "Urgent"]);
    expect(within(urgent).getByText("Urgent")).toBeTruthy();
    expect(text(urgent)).toContain("17 septembrie 2026 · Mihai Dobre");
    expect(text(urgent)).toContain("Apa Canal opreste furnizarea intre 09:00 si 16:00");
    expect(within(zonaCu(["Lucrari la fatada, tronsonul dinspre parcare", "Firma incepe pe 24 septembrie"])).queryByText("Urgent")).toBeNull();
    expect(screen.getByText("Pe cine suni")).toBeTruthy();
  });

  it("anunturile necitite se marcheaza citite cand avizierul e afisat", async () => {
    const { sursa } = await pornesteApp({ email: ELENA });
    const spion = vi.spyOn(sursa, "marcheazaAnuntCitit");
    const d = await sursa.incarca();
    const necitit = d.anunturi.find((a) => !a.citit);
    expect(screen.getAllByRole("tab").find((t) => t.textContent.startsWith("Bloc")).textContent).toBe("Bloc1");
    await deschideTab("Bloc");
    expect(spion).toHaveBeenCalledWith(necitit.id);
    expect(spion).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("tab").find((t) => t.textContent.startsWith("Bloc")).textContent).toBe("Bloc");
    /* pe alt subtab nu se mai marcheaza nimic */
    await alegeSegment("Acte");
    expect(spion).toHaveBeenCalledTimes(1);
  });

  it("[K1] deschiderea avizierului cu mai multe anunturi necitite face o singura reincarcare", async () => {
    ceasDemo();
    const sursa = sursaDemo();
    await sursa.intra(ADMIN, "Bloc-D14-2026");
    await sursa.publicaAnunt({ titlu: "Curatenie generala sambata", corp: "Va rugam sa eliberati casa scarii.", urgent: false });
    await sursa.publicaAnunt({ titlu: "Schimbarea yalei de la subsol", corp: "Cheile noi se ridica de la administrator.", urgent: false });
    await pornesteApp({ email: ELENA, sursa });
    /* trei anunturi necitite */
    expect(screen.getAllByRole("tab").find((t) => t.textContent.startsWith("Bloc")).textContent).toBe("Bloc3");
    const incarca = vi.spyOn(sursa, "incarca");
    await deschideTab("Bloc");
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(incarca.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("avizierul gol", async () => {
    await laBloc({ email: ELENA, modifica: (d) => { d.anunturi = []; } });
    expect(screen.getByText("Avizierul este gol")).toBeTruthy();
  });
});

describe("Bloc: votul", () => {
  it("alege o varianta, confirma si vede rezultatele cu votul propriu", async () => {
    const { sursa } = await laBloc({ email: ELENA }, "Vot si adunare");
    const spion = vi.spyOn(sursa, "voteaza");
    const d = await sursa.incarca();
    const vot = d.voturi[0];
    const card = zonaCu(["Inlocuirea usii de la intrare", "Vot deschis", "Votul se inregistreaza pe apartament"]);
    expect(within(card).getByText("Vot deschis")).toBeTruthy();
    expect(within(card).getByText("Se inchide pe 3 oct 2026")).toBeTruthy();
    expect(text(card)).toContain("Doua oferte pentru usa cu interfon si inchidere automata.");
    expect(text(card)).toContain("Votul se inregistreaza pe apartament, o singura data");

    /* Inapoi inchide confirmarea fara vot */
    await apasa(screen.getByRole("button", { name: OFERTA_B }));
    expect(text(screen.getByRole("dialog", { name: "Confirma votul" }))).toContain(`Votezi pentru:${OFERTA_B}Votul nu se mai poate schimba dupa ce il trimiti.`);
    await apasaButon("Inapoi");
    expect(screen.queryByRole("dialog")).toBeNull();

    await apasa(screen.getByRole("button", { name: OFERTA_A }));
    await apasaButon("Da, trimite votul");
    expect(spion).toHaveBeenCalledWith(vot.id, vot.optiuni[0].id, d.eu.apartamentId);
    expect(screen.getByRole("status").textContent).toBe("Votul a fost inregistrat");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Apartamentul tau a votat. Rezultatele se actualizeaza pe masura ce voteaza si ceilalti.")).toBeTruthy();
    /* 15 voturi: A 8, B 5, C 2 */
    expect(randVarianta("Oferta A")).toBe(`${OFERTA_A} · votul tau53%8 voturi`);
    expect(randVarianta("Oferta B")).toBe(`${OFERTA_B}33%5 voturi`);
    expect(randVarianta("Amanam")).toBe(`${AMANAM}13%2 voturi`);
    expect(ecran()).toContain("Au votat 15 din 20 apartamente. Votul se numara pe apartament.");
    expect(screen.queryByText("Alege o varianta")).toBeNull();
  });

  it("un vot refuzat lasa confirmarea deschisa; X o inchide", async () => {
    const { sursa } = await laBloc({ email: ELENA }, "Vot si adunare");
    vi.spyOn(sursa, "voteaza").mockRejectedValue(new Error("Votul s-a inchis."));
    await apasa(screen.getByRole("button", { name: AMANAM }));
    await apasaButon("Da, trimite votul");
    expect(screen.getByRole("status").textContent).toBe("Votul s-a inchis.");
    const dialog = screen.getByRole("dialog", { name: "Confirma votul" });
    await apasa(within(dialog).getByRole("button", { name: "Inchide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("votul inchis arata rezultatele; fara voturi deschise nu se poate alege", async () => {
    await laBloc({ email: ELENA, zi: new Date("2026-10-04T09:00:00") }, "Vot si adunare");
    expect(screen.getByText("Inchis pe 3 oct 2026")).toBeTruthy();
    expect(screen.queryByText("Vot deschis")).toBeNull();
    expect(randVarianta("Oferta A")).toBe(`${OFERTA_A}50%7 voturi`);
    expect(ecran()).toContain("Au votat 14 din 20 apartamente.");
    /* adunarea trecuta nu mai apare */
    expect(screen.queryByText(/Adunarea generala din/)).toBeNull();
  });

  it("numararea pe cota: procentul din cote si textul despre ponderare; un singur vot", async () => {
    await laBloc({
      email: ELENA,
      zi: new Date("2026-10-04T09:00:00"),
      modifica: (d) => {
        const v = d.voturi[0];
        v.numarare = "cota";
        v.optiuni[2].voturi = 1;
        v.optiuni[2].cote = 4.63;
      },
    }, "Vot si adunare");
    expect(randVarianta("Amanam")).toMatch(/^Amanam decizia pentru anul viitor\d+%1 vot, 4,63% din cote$/);
    expect(ecran()).toContain("Votul se numara pe apartament, ponderat cu cota indiviza.");
  });

  it("fara niciun vot exprimat procentele sunt zero", async () => {
    await laBloc({
      email: ELENA,
      zi: new Date("2026-10-04T09:00:00"),
      modifica: (d) => { d.voturi[0].optiuni.forEach((o) => { o.voturi = 0; }); d.voturi[0].votanti = 0; },
    }, "Vot si adunare");
    expect(randVarianta("Oferta A")).toBe(`${OFERTA_A}0%0 voturi`);
  });

  it("[K7] la numararea pe cota procentul este din cote, nu din apartamente", async () => {
    await laBloc({
      email: ELENA,
      zi: new Date("2026-10-04T09:00:00"),
      modifica: (d) => {
        const v = d.voturi[0];
        v.numarare = "cota";
        v.optiuni[0].voturi = 2; v.optiuni[0].cote = 8;
        v.optiuni[1].voturi = 1; v.optiuni[1].cote = 30;
        v.optiuni[2].voturi = 0; v.optiuni[2].cote = 0;
      },
    }, "Vot si adunare");
    /* 30 din 38 de cote = 79% */
    expect(randVarianta("Oferta B")).toMatch(/^Oferta B.*79%/);
  });

  it("un vot deschis la care apartamentul a votat deja arata direct rezultatele", async () => {
    await laBloc({ email: ELENA, modifica: (d) => { d.voturi[0].votulMeu = d.voturi[0].optiuni[1].id; } }, "Vot si adunare");
    expect(randVarianta("Oferta B")).toContain("· votul tau");
    expect(screen.queryByRole("button", { name: OFERTA_A })).toBeNull();
  });

  it("fara voturi arata Niciun vot, dar adunarea ramane", async () => {
    await laBloc({ email: ELENA, modifica: (d) => { d.voturi = []; } }, "Vot si adunare");
    expect(screen.getByText("Niciun vot")).toBeTruthy();
    expect(screen.getByText("Adunarea generala din 3 octombrie 2026")).toBeTruthy();
  });

  it("cu un vot inchis nu apare Niciun vot", async () => {
    await laBloc({ email: ELENA, modifica: (d) => { d.voturi[0].inchideLa = "2026-09-18T18:00:00+03:00"; } }, "Vot si adunare");
    expect(screen.queryByText("Niciun vot")).toBeNull();
    expect(screen.getByText("Inchis pe 18 sep 2026")).toBeTruthy();
  });
});

describe("Bloc: adunarea generala", () => {
  it("arata convocarea si confirma prezenta", async () => {
    const { sursa } = await laBloc({ email: ELENA }, "Vot si adunare");
    const spion = vi.spyOn(sursa, "confirmaPrezenta");
    const d = await sursa.incarca();
    const card = zonaCu(["Adunarea generala din 3 octombrie 2026", "Au confirmat"]);
    expect(text(card)).toContain("Convocare trimisa pe 18 septembrie 2026");
    expect(text(card)).toContain("Ora 18:30, La parter, langa boxe. Ordinea de zi: Executia bugetului pe primul semestru");
    expect(text(card)).toContain("Au confirmat 3 din 20 apartamente.");
    await apasaButon("Confirm ca particip");
    expect(spion).toHaveBeenCalledWith(d.adunari[0].id, d.eu.apartamentId);
    expect(screen.getByRole("status").textContent).toBe("Prezenta a fost confirmata");
    expect(screen.getByText("Ai confirmat ca participi")).toBeTruthy();
    expect(screen.getByText("Au confirmat 4 din 20 apartamente.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm ca particip" })).toBeNull();
  });
});

describe("Bloc: acte", () => {
  it("lista documentelor si deschiderea unuia", async () => {
    const { open } = prindeFerestre();
    urlFalse();
    const { sursa } = await laBloc({ email: ELENA }, "Acte");
    const spion = vi.spyOn(sursa, "deschideDocument");
    const d = await sursa.incarca();
    expect(screen.getByText(/Documentele asociatiei, disponibile oricand/)).toBeTruthy();
    const pv = screen.getByRole("button", { name: "Deschide Proces verbal adunare generala, 12 martie 2026" });
    expect(text(pv)).toContain("PDFProces verbal adunare generala, 12 martie 2026Proces verbal · 14 mar 2026›");
    expect(screen.getAllByRole("button", { name: /^Deschide / })).toHaveLength(d.documente.length);
    await apasa(pv);
    expect(spion).toHaveBeenCalledWith(d.documente.find((x) => x.titlu.startsWith("Proces verbal")).id);
    expect(open).toHaveBeenCalledWith("", "_blank");
  });
});

describe("Bloc: fonduri", () => {
  it("soldurile, miscarile cu documente si situatia incasarilor", async () => {
    prindeFerestre();
    urlFalse();
    const { sursa } = await laBloc({ email: ELENA }, "Fonduri");
    const spion = vi.spyOn(sursa, "deschideDocument");
    const d = await sursa.incarca();
    const t = ecran();
    expect(t).toContain("Fond de reparatii19.228,60LEIsold la 19 sep 2026");
    expect(t).toContain("Fond de rulment9.600,00LEI480,00 lei pe apartament");
    expect(t).toContain("Fond de reparatii, fiecare intrare si iesire");
    expect(t).toContain("Reparatie pompa hidrofor18 iul 2026Vezi documentul-2.240,00LEI");
    expect(t).toContain(`Apartamente fara restanta${d.situatieBloc.faraRestanta} din 20`);
    expect(d.situatieBloc.restanteTotal).toBe(7014.11);
    expect(t).toContain("Restantele blocului sunt 7.014,11 lei.");
    /* iesirile sunt cu rosu, intrarile cu verde */
    expect(screen.getByText("-2.240,00").parentElement.style.color)
      .not.toBe(screen.getByText("20.468,60").parentElement.style.color);
    const butoane = screen.getAllByRole("button", { name: "Vezi documentul" });
    expect(butoane).toHaveLength(2);
    await apasa(butoane[0]);
    const fond = d.fonduri.find((f) => f.tip === "reparatii");
    expect(spion).toHaveBeenCalledWith(fond.miscari.find((m) => m.documentId).documentId);
  });

  it("fara fonduri si fara apartamente in situatie", async () => {
    await laBloc({
      email: ELENA,
      modifica: (d) => { d.fonduri = []; d.situatieBloc = { apartamente: 0, faraRestanta: 0, restanteTotal: 0 }; },
    }, "Fonduri");
    expect(screen.queryByText("Fond de reparatii")).toBeNull();
    expect(screen.queryByText("Unde s-au dus banii")).toBeNull();
    expect(ecran()).toContain("Apartamente fara restanta0 din 0");
  });

  it("fondul de rulment fara suma pe apartament", async () => {
    await laBloc({ email: ELENA, modifica: (d) => { d.fonduri.find((f) => f.tip === "rulment").sumaPerApartament = null; } }, "Fonduri");
    expect(ecran()).not.toContain("pe apartament");
  });
});
