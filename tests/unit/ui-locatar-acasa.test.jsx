/* Ecranul Acasa al locatarului (LocatarAcasa) si elementele lui mici:
   AntetEcran, SarcinaRand, ComparatieRand, StareBadge, CardContacte, ContactRand. */
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { pornesteApp, zonaCu, textEcran } from "./ajutor.jsx";
import { ELENA, ILIE, VOICU, apasa, apasaButon, prindeDescarcari, text } from "./ui-locatar-ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const zi = (iso) => new Date(`${iso}T09:00:00`);
const ecran = () => textEcran();
const sarcina = (eticheta) => screen.getByRole("button", { name: eticheta });

describe("Acasa: soldul si badge-ul de termen", () => {
  it("arata suma de plata, termenul si textul despre penalizari", async () => {
    await pornesteApp({ email: ELENA });
    expect(screen.getByText("Buna, Elena")).toBeTruthy();
    expect(screen.getByText("Bloc D14, scara A, ap. 17")).toBeTruthy();
    expect(screen.getByText("De plata acum")).toBeTruthy();
    expect(screen.getAllByText("718,09").length).toBeGreaterThan(0);
    expect(screen.getByText("Mai ai 6 zile")).toBeTruthy();
    expect(ecran()).toContain("Lista pe august 2026, termen de plata 25 septembrie 2026. Dupa 30 de zile de la scadenta se calculeaza penalizari de 0,02% pe zi.");
    expect(screen.getByRole("button", { name: "Plateste acum" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "De unde vine suma" })).toBeTruthy();
  });

  it("cu 3 zile ramase badge-ul spune cate zile mai sunt", async () => {
    await pornesteApp({ email: ELENA, zi: zi("2026-09-22") });
    expect(screen.getByText("Mai ai 3 zile")).toBeTruthy();
  });

  it("cu o zi ramasa scrie la singular", async () => {
    await pornesteApp({ email: ELENA, zi: zi("2026-09-24") });
    expect(screen.getByText("Mai ai o zi")).toBeTruthy();
  });

  it("in ziua scadentei scrie Scadent azi", async () => {
    await pornesteApp({ email: ELENA, zi: zi("2026-09-25") });
    expect(screen.getByText("Scadent azi")).toBeTruthy();
    expect(ecran()).toContain("Termen 25 septembrie 2026, mai sunt 0 zile");
  });

  it("dupa scadenta arata Termen depasit, iar sarcinile nu mai numara zile", async () => {
    await pornesteApp({ email: ELENA, zi: zi("2026-09-26") });
    expect(screen.getByText("Termen depasit")).toBeTruthy();
    expect(within(sarcina("Transmite indexul la apa")).getByText("Termen 25 septembrie 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plateste acum" })).toBeTruthy();
  });

  it("fara lista publicata, dar cu datorii, nu arata termenul listei", async () => {
    await pornesteApp({ email: ILIE, modifica: (d) => { d.liste = []; } });
    expect(screen.getByText("Termen depasit")).toBeTruthy();
    expect(ecran()).not.toContain("termen de plata");
    expect(ecran()).toContain("De plata acum2.319,36");
    /* fara doua liste nu exista fraza de comparatie */
    expect(ecran()).not.toContain("deci luna aceasta platesti");
  });

  /* [E2] Cel mai vechi datornic vedea "Mai ai N zile" pentru ca badge-ul se
     uita doar la scadenta listei curente, ignorand o datorie mai veche deja
     scadenta (de exemplu preluata de pe alta lista sau o corectie). */
  it("[E2] cu o datorie mai veche deja scadenta, badge-ul arata Termen depasit chiar daca lista curenta nu e scadenta", async () => {
    await pornesteApp({
      email: ELENA,
      modifica: (d) => {
        const ap = d.apartamente.find((a) => a.id === d.eu.apartamentId);
        d.datorii.push({
          id: "datorie-veche-test", apartamentId: ap.id, tip: "intretinere", luna: "2026-07",
          listaId: null, suma: 50, scadenta: "2026-08-25", descriere: "Restanta veche",
          rest: 50, documentId: null, creatLa: "2026-08-01T00:00:00Z",
        });
      },
    });
    expect(screen.getByText("Termen depasit")).toBeTruthy();
    expect(screen.queryByText("Mai ai 6 zile")).toBeNull();
  });

  /* [K9] Soldul afisat era doar suma resturilor: o plata facuta inainte de
     lista (registrul: sold -250) aparea ca "0,00 lei, Achitat", fara nicio
     urma a banilor platiti in plus. */
  it("[K9] o plata facuta in avans apare ca avans, nu se pierde in Achitat", async () => {
    await pornesteApp({
      email: VOICU,
      modifica: (d) => {
        d.plati.push({
          id: "pla-avans-k9", apartamentId: d.eu.apartamentId, suma: 250, metoda: "transfer", stare: "confirmata",
          confirmataLa: "2026-09-18T10:00:00Z", referinta: null, inregistrataDe: null, chitanta: null, alocari: [],
        });
      },
    });
    expect(screen.getByText("Achitat")).toBeTruthy();
    expect(screen.getByText("Ai platit in avans 250,00 lei. Se scad din urmatoarea lista.")).toBeTruthy();
  });

  it("[K9] fara bani platiti in plus, nu spune nimic despre avans", async () => {
    await pornesteApp({ email: VOICU });
    expect(screen.queryByText(/in avans/)).toBeNull();
  });

  it("cand totul e platit arata Achitat si descarca ultima chitanta", async () => {
    const descarcari = prindeDescarcari();
    await pornesteApp({ email: VOICU });
    expect(screen.getByText("Totul este platit")).toBeTruthy();
    expect(screen.getByText("Achitat")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Plateste acum" })).toBeNull();
    await apasaButon("Descarca ultima chitanta");
    expect(descarcari).toHaveLength(1);
    expect(descarcari[0]).toMatch(/^chitanta-\d+\.pdf$/);
  });

  it("descarca chitanta platii celei mai noi, oricare ar fi ordinea primita", async () => {
    const descarcari = prindeDescarcari();
    const { sursa } = await pornesteApp({ email: VOICU, modifica: (d) => { d.plati.reverse(); } });
    const d = await sursa.incarca();
    const numere = d.plati.map((p) => p.chitanta.numar);
    await apasaButon("Descarca ultima chitanta");
    expect(descarcari).toEqual([`chitanta-${Math.max(...numere)}.pdf`]);
  });

  it("achitat, dar ultima plata fara chitanta: nu apare butonul de descarcare", async () => {
    await pornesteApp({ email: VOICU, modifica: (d) => { d.plati.forEach((p) => { p.chitanta = null; }); } });
    expect(screen.getByText("Totul este platit")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Descarca ultima chitanta" })).toBeNull();
  });

  it("achitat si fara nicio plata: nu apare butonul de descarcare", async () => {
    await pornesteApp({ email: VOICU, modifica: (d) => { d.plati = []; } });
    expect(screen.queryByRole("button", { name: "Descarca ultima chitanta" })).toBeNull();
  });
});

describe("Acasa: navigarea spre celelalte ecrane", () => {
  it("Plateste acum deschide Plata cu formularul cardului", async () => {
    await pornesteApp({ email: ELENA });
    await apasaButon("Plateste acum");
    expect(screen.getByRole("dialog", { name: "Plata cu cardul" })).toBeTruthy();
    expect(screen.getByText("Lista de plata")).toBeTruthy();
  });

  it("De unde vine suma deschide lista de plata fara formular", async () => {
    await pornesteApp({ email: ELENA });
    await apasaButon("De unde vine suma");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Verificarea repartitiei")).toBeTruthy();
  });

  it("fraza de comparatie compara ultimele doua liste si duce la Platile mele", async () => {
    await pornesteApp({ email: ELENA });
    const fraza = screen.getByText("Intretinerea pe august este 718,09 lei. Pe iulie a fost 631,39 lei, deci luna aceasta platesti cu 86,70 lei mai mult.");
    await apasa(fraza);
    expect(screen.getByText("Cat ai avut de plata")).toBeTruthy();
  });

  it("sarcina de plata duce la formularul cardului", async () => {
    await pornesteApp({ email: ELENA });
    await apasa(screen.getByRole("button", { name: "Plateste acum" }));
    expect(screen.getByRole("dialog", { name: "Plata cu cardul" })).toBeTruthy();
  });

  it("sarcina de citire duce la Contoare", async () => {
    await pornesteApp({ email: ELENA });
    expect(within(sarcina("Transmite indexul la apa")).getByText("Termen 25 septembrie 2026, mai sunt 6 zile")).toBeTruthy();
    await apasa(sarcina("Transmite indexul la apa"));
    expect(screen.getByText("Citirea pentru septembrie")).toBeTruthy();
  });

  it("sarcinile de vot si de adunare duc la tabul Vot si adunare", async () => {
    await pornesteApp({ email: ELENA });
    expect(within(sarcina("Voteaza: Inlocuirea usii de la intrare")).getByText("Votul se inchide pe 3 octombrie 2026")).toBeTruthy();
    expect(within(sarcina("Confirma prezenta la adunarea generala")).getByText("3 octombrie 2026, ora 18:30")).toBeTruthy();
    await apasa(sarcina("Voteaza: Inlocuirea usii de la intrare"));
    expect(screen.getByText("Alege o varianta")).toBeTruthy();
  });

  it("sarcina de adunare deschide tot tabul de vot", async () => {
    await pornesteApp({ email: ELENA });
    await apasa(sarcina("Confirma prezenta la adunarea generala"));
    expect(screen.getByRole("button", { name: "Confirm ca particip" })).toBeTruthy();
  });

  /* [P1] Un chirias nu poate vota (Legea 196/2018): sarcina "Voteaza" nu
     trebuie sa-l trimita la un formular pe care nu-l poate folosi. Adunarea
     ramane, ca oricine poate confirma prezenta. */
  it("[P1] chirias: fara sarcina de vot pe Acasa, dar cu cea de adunare", async () => {
    await pornesteApp({ email: ELENA, modifica: (d) => { d.eu.calitate = "chirias"; } });
    expect(screen.queryByText(/^Voteaza:/)).toBeNull();
    expect(within(sarcina("Confirma prezenta la adunarea generala")).getByText("3 octombrie 2026, ora 18:30")).toBeTruthy();
  });

  it("anunturile de la avizier: Urgent, Nou si legatura spre Bloc", async () => {
    await pornesteApp({ email: ELENA });
    const card = screen.getByText("Oprire apa rece marti, 22 septembrie").closest("[role=button]");
    expect(within(card).getByText("Urgent")).toBeTruthy();
    expect(within(card).getByText("Nou")).toBeTruthy();
    expect(within(card).getByText("17 sep 2026")).toBeTruthy();
    const alDoilea = screen.getByText("Citirea contoarelor pana pe 25 septembrie").closest("[role=button]");
    expect(within(alDoilea).queryByText("Urgent")).toBeNull();
    expect(within(alDoilea).queryByText("Nou")).toBeNull();
    /* doar ultimele doua anunturi */
    expect(screen.queryByText("Lucrari la fatada, tronsonul dinspre parcare")).toBeNull();
    await apasa(card);
    expect(screen.getByText("Str. Nicolae Balcescu nr. 22, Pitesti")).toBeTruthy();
  });

  it("Toate anunturile duce la Bloc", async () => {
    await pornesteApp({ email: ELENA });
    await apasa(screen.getByText("Toate anunturile"));
    expect(screen.getByRole("button", { name: "Avizier" })).toBeTruthy();
  });

  it("sesizarea proprie arata ultimul raspuns si duce la Sesizari", async () => {
    await pornesteApp({ email: ELENA });
    expect(screen.getByText("Sesizarile tale")).toBeTruthy();
    const card = screen.getByText("Bec ars pe palier la etajul 4").closest("[role=button]");
    expect(within(card).getByText("In lucru")).toBeTruthy();
    expect(text(card)).toContain("Raspuns: Am cumparat becul, se monteaza joi.");
    /* sesizarea rezolvata nu apare */
    expect(screen.queryByText("Interfon defect")).toBeNull();
    await apasa(card);
    expect(screen.getByRole("button", { name: "Sesizare noua" })).toBeTruthy();
  });
});

describe("Acasa: mesajele noi", () => {
  it("arata notificarea necitita si o marcheaza citita la Am citit", async () => {
    const { sursa } = await pornesteApp({ email: ELENA });
    const spion = vi.spyOn(sursa, "marcheazaNotificareCitita");
    const d = await sursa.incarca();
    const necitita = d.notificari.find((n) => !n.cititaLa);
    expect(screen.getByText("Mesaje noi")).toBeTruthy();
    expect(screen.getByText("Lista pe august 2026 a fost publicata")).toBeTruthy();
    expect(screen.getByText("8 sep 2026")).toBeTruthy();
    await apasaButon("Am citit");
    expect(spion).toHaveBeenCalledWith(necitita.id);
    expect(screen.queryByText("Mesaje noi")).toBeNull();
  });

  it("instiintarea de restanta apare cu rosu, iar o notificare fara corp nu are text", async () => {
    await pornesteApp({
      email: ILIE,
      modifica: (d) => {
        d.notificari.forEach((n) => { n.cititaLa = null; });
        d.notificari[0].corp = null;
      },
    });
    /* instiintarea de restanta se vede altfel decat un anunt obisnuit */
    const titlu = screen.getByText("Instiintare de plata");
    expect(titlu.style.color).not.toBe(screen.getByText("Lista pe iulie 2026 a fost publicata").style.color);
    /* doar primele trei necitite */
    expect(screen.getAllByRole("button", { name: "Am citit" })).toHaveLength(3);
    const primul = zonaCu(["Lista pe august 2026 a fost publicata", "Am citit"]);
    expect(text(primul)).not.toContain("Vezi in aplicatie");
  });
});

describe("Acasa: De facut", () => {
  it("citirea respinsa cere retrimiterea, cu ton de pericol", async () => {
    await pornesteApp({
      email: ELENA,
      modifica: (d) => {
        const c = d.contoare[0];
        d.citiri.push({ id: "cit-r", contorId: c.id, apartamentId: c.apartamentId, tip: c.tip, luna: "2026-09", indexAnterior: 244.5, indexCurent: 250, consum: 5.5, sursa: "locatar", stare: "respinsa", motivRespingere: "Poza neclara" });
      },
    });
    expect(within(sarcina("Trimite din nou indexul la apa")).getByText("Administratorul a respins citirea trimisa. Vezi de ce.")).toBeTruthy();
  });

  it("un apartament fara contoare primeste tot sarcina de citire", async () => {
    await pornesteApp({ email: VOICU, modifica: (d) => { d.contoare = []; } });
    expect(sarcina("Transmite indexul la apa")).toBeTruthy();
  });

  it("cu totul facut arata Nimic de facut acum", async () => {
    await pornesteApp({
      email: VOICU,
      modifica: (d) => {
        d.voturi.forEach((v) => { v.votulMeu = v.optiuni[0].id; });
        d.adunari.forEach((a) => { a.prezentaMea = true; });
      },
    });
    expect(screen.getByText("Nimic de facut acum")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Voteaza/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirma prezenta la adunarea generala" })).toBeNull();
  });

  it("un vot inchis si o adunare trecuta nu mai sunt sarcini", async () => {
    await pornesteApp({ email: VOICU, zi: new Date("2026-10-04T09:00:00") });
    expect(screen.queryByRole("button", { name: /Voteaza/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirma prezenta la adunarea generala" })).toBeNull();
  });

  it("[K8] sarcina Confirma prezenta arata cea mai apropiata adunare, nu cea mai indepartata", async () => {
    await pornesteApp({
      email: ELENA,
      modifica: (d) => {
        const a = d.adunari[0];
        /* sursa trimite adunarile descrescator dupa data */
        d.adunari = [{ ...a, id: "adu-departe", dataOra: "2026-11-20T18:00:00+02:00" }, a];
      },
    });
    expect(within(sarcina("Confirma prezenta la adunarea generala")).getByText("3 octombrie 2026, ora 18:30")).toBeTruthy();
  });
});

describe("Acasa: consumul fata de bloc", () => {
  it("consum mai mare decat media pe persoana", async () => {
    await pornesteApp({ email: ELENA });
    const card = zonaCu(["Consumul tau fata de bloc", "Apartamentul tau"]);
    expect(text(card)).toContain("Apa rece pe persoana, august 2026");
    /* 14,68 mc / 3 persoane = 4,89 mc; media blocului 4,79 */
    expect(text(card)).toContain("Apartamentul tau4,89 mc");
    expect(text(card)).toContain("Media blocului4,79 mc");
    expect(text(card)).toContain("Consumi cu 0,10 mc mai mult decat media pe persoana.");
  });

  it("consum mai mic decat media pe persoana", async () => {
    await pornesteApp({ email: VOICU });
    /* septembrie: 8,72 mc / 2 persoane = 4,36 mc; media 5,02 */
    expect(screen.getByText("Consumi cu 0,66 mc mai putin decat media pe persoana.")).toBeTruthy();
  });

  it("cu consum si medie zero barele stau goale", async () => {
    await pornesteApp({
      email: VOICU,
      modifica: (d) => {
        d.citiri.filter((c) => c.luna === "2026-09" && c.tip === "rece").forEach((c) => { c.consum = 0; });
        d.consumMediu["2026-09"].rece = 0;
      },
    });
    expect(screen.getByText("Consumi cu 0,00 mc mai putin decat media pe persoana.")).toBeTruthy();
  });

  it("fara media blocului pe luna nu apare comparatia", async () => {
    await pornesteApp({ email: ELENA, modifica: (d) => { d.consumMediu = {}; } });
    expect(screen.queryByText("Consumul tau fata de bloc")).toBeNull();
  });

  it("fara persoane declarate nu apare comparatia", async () => {
    await pornesteApp({
      email: ELENA,
      modifica: (d) => {
        const ap = d.apartamente[0];
        ap.persoane = 0;
        /* [A9] comparatia foloseste persoanele lunii citirii, nu pe cele de azi */
        if (ap.istoricPersoane[0]) ap.istoricPersoane[0].numar = 0;
      },
    });
    expect(screen.queryByText("Consumul tau fata de bloc")).toBeNull();
  });

  it("fara niciun consum validat nu apare comparatia", async () => {
    await pornesteApp({ email: ELENA, modifica: (d) => { d.citiri = d.citiri.filter((c) => c.sursa === "pornire"); } });
    expect(screen.queryByText("Consumul tau fata de bloc")).toBeNull();
  });

  it("[A9] consumul pe persoana imparte la persoanele din luna citirii, nu la cele de azi", async () => {
    await pornesteApp({
      email: ELENA,
      modifica: (d) => {
        const ap = d.apartamente[0];
        ap.persoane = 1;
        ap.istoricPersoane = [{ valabilDin: "2026-09", numar: 1, motiv: "S-a mutat fiul" }, ...ap.istoricPersoane];
      },
    });
    /* in august erau 3 persoane: 14,68 / 3 = 4,89 mc */
    expect(screen.getByText("Consumi cu 0,10 mc mai mult decat media pe persoana.")).toBeTruthy();
  });
});

describe("Acasa: sesizari, anunturi si contacte", () => {
  it("fara anunturi si fara sesizari deschise sectiunile lipsesc", async () => {
    await pornesteApp({ email: ILIE, modifica: (d) => { d.anunturi = []; } });
    expect(screen.queryByText("De la avizier")).toBeNull();
    expect(screen.queryByText("Sesizarile tale")).toBeNull();
  });

  it("o sesizare fara raspuns nu are randul Raspuns, iar o stare necunoscuta apare ca atare", async () => {
    await pornesteApp({
      email: ELENA,
      modifica: (d) => {
        const s = d.sesizari.find((x) => x.aMea && x.stare === "in_lucru");
        s.mesaje = [{ id: "m1", text: "Tot nu merge", la: "2026-09-10T10:00:00+03:00", dinAdministratie: false }];
        d.sesizari.push({ ...s, id: "ses-noua", titlu: "Balustrada slabita", stare: "noua", mesaje: [] });
        d.sesizari.push({ ...s, id: "ses-alta", titlu: "Cutia postala", stare: "suspendata", mesaje: [] });
      },
    });
    const card = screen.getByText("Bec ars pe palier la etajul 4").closest("[role=button]");
    expect(text(card)).not.toContain("Raspuns:");
    expect(within(screen.getByText("Balustrada slabita").closest("[role=button]")).getByText("Noua")).toBeTruthy();
    expect(within(screen.getByText("Cutia postala").closest("[role=button]")).getByText("suspendata")).toBeTruthy();
  });

  it("contactele: rolul, programul sau apartamentul, si butonul de apel", async () => {
    await pornesteApp({
      email: ELENA,
      modifica: (d) => {
        d.contacte.push({ id: "con-x", rol: "instalator", nume: "Ion Popa", telefon: "0700 000 001", program: null, apartamentNumar: null });
      },
    });
    const card = zonaCu(["Pe cine suni", "Presedinte"]);
    const t = text(card);
    expect(t).toContain("AdministratorMihai DobreMarti si joi, 17:00 - 19:00");
    expect(t).toContain("PresedinteIoana StancuApartament 12");
    expect(t).toContain("Urgente liftElmas Lift ServiceUrgente lift, non stop");
    /* rol necunoscut: apare codul rolului; fara program si fara apartament: fara detaliu */
    expect(t).toContain("instalatorIon PopaSuna 0700 000 001");
    const eroare = vi.spyOn(console, "error").mockImplementation(() => {});
    await apasaButon("Suna 0745 210 118");
    eroare.mockRestore();
    expect(screen.getByText("Buna, Elena")).toBeTruthy();
  });
});
