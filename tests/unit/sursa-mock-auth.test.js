/* Sursa demo: sesiunea, inregistrarea, codurile de invitatie si ce vede
   fiecare rol la incarca(). */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { creeazaSursaMock, aziIso } from "../../src/sursa-mock.js";
import { ceasDemo, ZI_DEMO, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";

const ILIE = "familia.ilie@adminbloc.test";
const NEVERIFICAT = "admin.nou@adminbloc.test";
const apNr = (d, n) => d.apartamente.find((a) => a.numar === n);

async function ca(email, s = creeazaSursaMock()) {
  await s.intra(email, PAROLA);
  return s;
}

beforeEach(() => ceasDemo());

describe("aziIso", () => {
  it("este data locala, nu cea UTC", () => {
    expect(aziIso()).toBe("2026-09-19");
    ceasDemo(new Date(2026, 0, 1, 0, 30));
    expect(aziIso()).toBe("2026-01-01");
  });
});

describe("sesiunea", () => {
  it("fara sesiune: sesiuneCurenta si incarca intorc null", async () => {
    const s = creeazaSursaMock();
    expect(s.tip).toBe("demo");
    expect(await s.sesiuneCurenta()).toBeNull();
    expect(await s.incarca()).toBeNull();
  });

  it("intra accepta emailul cu majuscule si spatii, apoi iesi inchide sesiunea", async () => {
    const s = creeazaSursaMock();
    const ses = await s.intra("  Elena.Marinescu@AdminBloc.test ", PAROLA);
    expect(ses).toEqual({ profilId: expect.any(String), email: LOCATAR });
    expect(await s.sesiuneCurenta()).toBe(ses);
    await s.iesi();
    expect(await s.sesiuneCurenta()).toBeNull();
    expect(await s.incarca()).toBeNull();
  });

  it("parola gresita sau email necunoscut: acelasi mesaj", async () => {
    const s = creeazaSursaMock();
    await expect(s.intra(LOCATAR, "gresit")).rejects.toThrow("Emailul sau parola nu sunt corecte. Verifica-le si incearca din nou.");
    await expect(s.intra("nimeni@x.ro", PAROLA)).rejects.toThrow("Emailul sau parola nu sunt corecte. Verifica-le si incearca din nou.");
    expect(await s.sesiuneCurenta()).toBeNull();
  });

  it("orice comanda fara sesiune cere autentificare", async () => {
    const s = creeazaSursaMock();
    await expect(s.cereVerificareAdministrator({ numarAtestat: "X" })).rejects.toThrow("Nu esti autentificat.");
    await expect(s.deschideLista("2026-10")).rejects.toThrow("Nu esti autentificat.");
    await expect(s.marcheazaAnuntCitit("anu-1")).rejects.toThrow("Nu esti autentificat.");
  });
});

describe("inregistreaza", () => {
  it("creeaza contul, intra direct in el si nu are inca apartament", async () => {
    const s = creeazaSursaMock();
    const ses = await s.inregistreaza({ email: " ion@x.ro ", parola: "ParolaBuna1", nume: "  Ion Pop " });
    expect(ses.email).toBe("ion@x.ro");
    const d = await s.incarca();
    expect(d).toEqual({
      azi: "2026-09-19",
      eu: { profilId: ses.profilId, nume: "Ion Pop", telefon: null, email: "ion@x.ro", rol: "fara_apartament", apartamentId: null },
    });
    await s.iesi();
    await s.intra("ion@x.ro", "ParolaBuna1");
    expect((await s.incarca()).eu.nume).toBe("Ion Pop");
  });

  it("pastreaza telefonul", async () => {
    const s = creeazaSursaMock();
    await s.inregistreaza({ email: "a@x.ro", parola: "ParolaBuna1", nume: "A", telefon: "0700" });
    expect((await s.incarca()).eu.telefon).toBe("0700");
  });

  it("refuza un email existent (fara sa conteze majusculele) si parola scurta sau lipsa", async () => {
    const s = creeazaSursaMock();
    await expect(s.inregistreaza({ email: "ADMINISTRATOR@adminbloc.test", parola: "ParolaBuna1", nume: "X" }))
      .rejects.toThrow("Exista deja un cont cu acest email.");
    await expect(s.inregistreaza({ email: "b@x.ro", parola: "Scurta1", nume: "X" }))
      .rejects.toThrow("Parola trebuie sa aiba cel putin 10 caractere.");
    await expect(s.inregistreaza({ email: "b@x.ro", nume: "X" }))
      .rejects.toThrow("Parola trebuie sa aiba cel putin 10 caractere.");
    await expect(s.inregistreaza({ email: "b@x.ro", parola: "parolafaracifre", nume: "X" }))
      .rejects.toThrow("Parola trebuie sa aiba si litere mici, si litere mari, si cifre.");
  });
});

describe("cereVerificareAdministrator", () => {
  it("contul nou devine administrator in asteptare si nu vede niciun bloc", async () => {
    const s = creeazaSursaMock();
    await s.inregistreaza({ email: "adm@x.ro", parola: "ParolaBuna1", nume: "Adm" });
    await s.cereVerificareAdministrator({ numarAtestat: "AT-1", fisier: new File(["x"], "atestat.pdf") });
    const d = await s.incarca();
    expect(d.eu.rol).toBe("in_asteptare");
    expect(Object.keys(d)).toEqual(["azi", "eu"]);
  });

  it("merge si fara fisier", async () => {
    const s = creeazaSursaMock();
    await s.inregistreaza({ email: "adm@x.ro", parola: "ParolaBuna1", nume: "Adm" });
    await s.cereVerificareAdministrator({ numarAtestat: "AT-1" });
    const d = await s.incarca();
    expect(d.eu.rol).toBe("in_asteptare");
  });

  /* [J4] Backend-ul (identitate.cere_verificare_administrator) lasa pe
     oricine nu e deja aprobat sa retrimita cererea (numar de atestat
     corectat, eventual poza noua): cererea se intoarce mereu la
     in_asteptare. Mock-ul o refuza pe a doua necondiționat ("Cererea a fost
     deja trimisa."), ceea ce nu are corespondent in baza si bloca exact
     scenariul pe care J4 il repara in ecran (un administrator respins care
     vrea sa incerce din nou). */
  it("[J4] o a doua cerere, de la cineva neaprobat, actualizeaza atestatul in loc sa fie refuzata", async () => {
    const s = creeazaSursaMock();
    await s.inregistreaza({ email: "adm@x.ro", parola: "ParolaBuna1", nume: "Adm" });
    await s.cereVerificareAdministrator({ numarAtestat: "AT-1" });
    await s.cereVerificareAdministrator({ numarAtestat: "AT-2" });
    expect((await s.incarca()).eu.rol).toBe("in_asteptare");
    const { profilId } = await s.sesiuneCurenta();
    expect(s.db.administratori.find((a) => a.profilId === profilId).numarAtestat).toBe("AT-2");
  });

  /* [J4] Un administrator respins (stare pe care doar o cerere de
     dezvoltator din Studio > SQL o poate scrie astazi, ca in
     conturi-test.txt) trebuie sa poata retrimite cererea si sa redevina
     in_asteptare, exact ca unul in_asteptare. */
  it("[J4] un administrator respins retrimite cererea si redevine in asteptare", async () => {
    const s = creeazaSursaMock();
    await s.inregistreaza({ email: "adm@x.ro", parola: "ParolaBuna1", nume: "Adm" });
    await s.cereVerificareAdministrator({ numarAtestat: "AT-1" });
    const { profilId } = await s.sesiuneCurenta();
    const rand = s.db.administratori.find((a) => a.profilId === profilId);
    rand.stare = "respins";
    expect((await s.incarca()).eu.rol).toBe("respins");

    await s.cereVerificareAdministrator({ numarAtestat: "AT-1 corectat" });
    expect((await s.incarca()).eu.rol).toBe("in_asteptare");
    expect(rand.numarAtestat).toBe("AT-1 corectat");
  });

  it("[J4] o cerere de la cineva deja aprobat nu schimba nimic", async () => {
    const s = await ca(ADMIN);
    const { profilId } = await s.sesiuneCurenta();
    const rand = s.db.administratori.find((a) => a.profilId === profilId);
    const atestatDinainte = rand.numarAtestat;
    await s.cereVerificareAdministrator({ numarAtestat: "AT-ALTUL" });
    expect(rand.numarAtestat).toBe(atestatDinainte);
    expect(rand.stare).toBe("aprobat");
  });

  it("contul demo neverificat vede doar ecranul de asteptare", async () => {
    const d = await (await ca(NEVERIFICAT)).incarca();
    expect(d.eu).toMatchObject({ nume: "Cosmin Radu", rol: "in_asteptare", apartamentId: null });
    expect(d.bloc).toBeUndefined();
  });
});

describe("folosesteInvitatie", () => {
  async function codPentru(numar, calitate = "chirias") {
    const s = await ca(ADMIN);
    const d = await s.incarca();
    const cod = await s.invitaLocatar(apNr(d, numar).id, calitate);
    await s.iesi();
    return { s, cod, apId: apNr(d, numar).id };
  }

  it("leaga contul nou de apartament; codul se scrie oricum", async () => {
    const { s, cod, apId } = await codPentru("11");
    expect(cod).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    await s.inregistreaza({ email: "chirias@x.ro", parola: "ParolaBuna1", nume: "Chirias" });
    expect(await s.folosesteInvitatie(`  ${cod.toLowerCase()} `)).toEqual({ apartamentNumar: "11" });
    const d = await s.incarca();
    expect(d.eu).toMatchObject({ rol: "locatar", apartamentId: apId });
    expect(d.apartamente.map((a) => a.numar)).toEqual(["11"]);

    await s.intra(ADMIN, PAROLA);
    const a = apNr(await s.incarca(), "11");
    expect(a.locatari).toEqual([{ id: expect.any(String), nume: "Chirias", email: "chirias@x.ro", telefon: null, calitate: "chirias", activDin: "2026-09-19", activPana: null }]);
    expect(a.invitatii).toEqual([]);
  });

  it("codul folosit, inexistent sau expirat nu mai merge", async () => {
    const { s, cod } = await codPentru("11");
    await s.inregistreaza({ email: "u1@x.ro", parola: "ParolaBuna1", nume: "U1" });
    await expect(s.folosesteInvitatie("NUEXISTA")).rejects.toThrow("Codul nu este valabil. Cere administratorului un cod nou.");
    await s.folosesteInvitatie(cod);
    await s.inregistreaza({ email: "u2@x.ro", parola: "ParolaBuna1", nume: "U2" });
    await expect(s.folosesteInvitatie(cod)).rejects.toThrow("Codul nu este valabil.");

    const { s: s2, cod: cod2 } = await codPentru("15");
    await s2.inregistreaza({ email: "u3@x.ro", parola: "ParolaBuna1", nume: "U3" });
    ceasDemo(new Date("2026-10-20T09:00:00"));
    await expect(s2.folosesteInvitatie(cod2)).rejects.toThrow("Codul nu este valabil.");
  });

  it("codul nefolosit apare la administrator pana expira", async () => {
    const { s, cod } = await codPentru("11", "proprietar");
    await s.intra(ADMIN, PAROLA);
    expect(apNr(await s.incarca(), "11").invitatii).toEqual([{ id: expect.any(String), cod, calitate: "proprietar", expiraLa: new Date(ZI_DEMO.getTime() + 30 * 86400000).toISOString() }]);
    ceasDemo(new Date("2026-10-20T09:00:00"));
    expect(apNr(await s.incarca(), "11").invitatii).toEqual([]);
  });

  /* [J13] identitate.foloseste_invitatie() (migratia S11,
     revoca_invitatie_si_inchide_acces_corect) refuza cu "Esti deja legat de
     acest apartament." si nu consuma codul cand omul e deja legat activ de
     acelasi apartament -- "on conflict do nothing" nu mai lasa comanda sa
     para reusita fara niciun efect real. Mock-ul intorcea succes si consuma
     codul oricum: paritatea era doar in comentariu, nu si in cod. */
  it("[J13] codul folosit de cineva deja legat de apartament este refuzat, nu consumat", async () => {
    const { s, cod } = await codPentru("17", "proprietar");
    await s.intra(LOCATAR, PAROLA);
    await expect(s.folosesteInvitatie(cod)).rejects.toThrow("Esti deja legat de acest apartament.");
    await s.intra(ADMIN, PAROLA);
    const ap17 = apNr(await s.incarca(), "17");
    expect(ap17.locatari).toHaveLength(1);
    /* codul ramane nefolosit, nu disparut ca "deja consumat" */
    expect(ap17.invitatii).toEqual([{ id: expect.any(String), cod, calitate: "proprietar", expiraLa: expect.any(String) }]);
  });
});

describe("[P1/P5] un locatar legat de doua apartamente ale aceluiasi bloc", () => {
  it("vede ambele apartamente si poate alege care e activ, cu calitatea lui", async () => {
    const s = creeazaSursaMock();
    await s.intra(ADMIN, PAROLA);
    const d = await s.incarca();
    const ap3 = apNr(d, "3").id;
    const ap5 = apNr(d, "5").id;
    const ap9 = apNr(d, "9").id;
    const cod = await s.invitaLocatar(ap5, "chirias");
    await s.intra(ILIE, PAROLA);
    await s.folosesteInvitatie(cod);
    const dupa = await s.incarca();
    expect([...dupa.eu.apartamenteMele].sort()).toEqual([ap3, ap5].sort());
    expect(dupa.apartamente.map((a) => a.id).sort()).toEqual([ap3, ap5].sort());
    expect(dupa.eu).toMatchObject({ apartamentId: ap3, calitate: "proprietar" });

    const ales = await s.incarca(ap5);
    expect(ales.eu).toMatchObject({ apartamentId: ap5, calitate: "chirias" });

    /* apartamentul altcuiva e ignorat, ramane cel implicit */
    const ignorat = await s.incarca(ap9);
    expect(ignorat.eu.apartamentId).toBe(ap3);
  });
});

describe("incarca ca locatar", () => {
  it("vede doar apartamentul lui, listele publicate si randurile lui", async () => {
    const d = await (await ca(LOCATAR)).incarca();
    const ap = apNr(d, "17");
    expect(d.eu).toMatchObject({ nume: "Elena Marinescu", rol: "locatar", apartamentId: ap.id });
    expect(d.apartamente).toHaveLength(1);
    expect(ap).toMatchObject({ numar: "17", etaj: 4, persoane: 3, cota: 4.63, scutitLift: false, locatari: [], invitatii: [] });
    expect(ap.istoricPersoane).toEqual([{ valabilDin: "2026-05", numar: 3, motiv: "Preluat de pe lista de plata din mai 2026" }]);
    expect(d.liste.map((l) => l.luna)).toEqual(["2026-08", "2026-07", "2026-06"]);
    expect(d.liste.every((l) => l.stare === "publicata")).toBe(true);
    expect(d.repartizari.every((r) => r.apartamentId === ap.id)).toBe(true);
    /* 7 + 7 + 8 facturi si fondul de reparatii pe fiecare lista */
    expect(d.repartizari.length).toBe(25);
    expect(d.contoare.map((c) => c.tip)).toEqual(["rece", "calda"]);
    expect(d.citiri.every((c) => c.apartamentId === ap.id)).toBe(true);
    expect(d.datorii.every((x) => x.apartamentId === ap.id)).toBe(true);
    expect(d.plati.every((x) => x.apartamentId === ap.id)).toBe(true);
    expect(d.furnizori).toEqual([]);
    expect(d.remindere).toEqual([]);
    expect(d.bloc).toMatchObject({ denumire: "Bloc D14, scara A", localitate: "Pitesti, judetul Arges", stare: "activ" });
    expect(d.asociatie).toMatchObject({ denumire: "Asociatia de proprietari nr. 118", cui: "31245780" });
    expect(d.contacte.map((c) => c.rol)).toEqual(["administrator", "presedinte", "cenzor", "lift"]);
    expect(d.contacte[1]).toMatchObject({ apartamentNumar: "12", program: null });
    expect(d.contacte[0]).toMatchObject({ apartamentNumar: null, program: "Marti si joi, 17:00 - 19:00" });
  });

  it("sesizarile altora apar fara apartament si fara mesaje; ale lui complete", async () => {
    const d = await (await ca(LOCATAR)).incarca();
    const alta = d.sesizari.find((x) => x.titlu === "Scurgere la coloana de la subsol");
    expect(alta).toMatchObject({ aMea: false, apartamentId: null, apartamentNumar: null, mesaje: [], poze: [] });
    const aMea = d.sesizari.find((x) => x.titlu === "Bec ars pe palier la etajul 4");
    expect(aMea).toMatchObject({ aMea: true, apartamentNumar: "17" });
    expect(aMea.mesaje).toEqual([{ id: expect.any(String), text: "Am cumparat becul, se monteaza joi.", la: "2026-09-09T12:10:00+03:00", dinAdministratie: true, autor: "Mihai Dobre" }]);
    expect(aMea.poze).toEqual([{ id: expect.any(String), cale: "demo/sesizare-S1-1.jpg" }]);
    expect(d.sesizari.map((x) => x.creataLa)).toEqual([...d.sesizari.map((x) => x.creataLa)].sort().reverse());
  });

  it("anunturile, votul si adunarea: fara cifrele administratorului", async () => {
    const d = await (await ca(LOCATAR)).incarca();
    expect(d.anunturi.map((a) => [a.citit, a.cititori, a.totalLocatari])).toEqual([[false, null, null], [true, null, null], [true, null, null]]);
    expect(d.anunturi[0]).toMatchObject({ urgent: true, autor: "Mihai Dobre" });
    expect(d.voturi[0]).toMatchObject({ votulMeu: null, nevotate: null, votanti: 14, totalApartamente: 20, numarare: "apartament" });
    expect(d.voturi[0].optiuni.map((o) => [o.voturi, o.cote])).toEqual([[7, 35.34], [5, 25.31], [2, 8.64]]);
    expect(d.adunari[0]).toMatchObject({ prezente: 3, totalApartamente: 20, prezentaMea: false, convocataLa: "2026-09-18T10:00:00+03:00" });
  });

  it("notificarile mai vechi de doua saptamani sunt deja citite", async () => {
    const d = await (await ca(LOCATAR)).incarca();
    const n = d.notificari;
    expect(n.map((x) => x.trimisaLa)).toEqual(["2026-09-08T10:05:00+03:00", "2026-08-08T11:20:00+03:00", "2026-07-08T09:20:00+03:00"]);
    expect(n.map((x) => x.cititaLa)).toEqual([null, "2026-08-08T11:20:00+03:00", "2026-07-08T09:20:00+03:00"]);
    expect(n[0]).toMatchObject({ tip: "lista_publicata", titlu: "Lista pe august 2026 a fost publicata" });
    expect(n[0].corp).toContain("Termenul de plata este 25 septembrie 2026.");
  });

  it("restantierul are instiintarea de plata din 1 septembrie", async () => {
    const d = await (await ca(ILIE)).incarca();
    expect(d.notificari.find((n) => n.tip === "restanta")).toMatchObject({ titlu: "Instiintare de plata", cititaLa: "2026-09-01T09:00:00+03:00" });
  });
});

describe("incarca ca administrator", () => {
  it("vede tot blocul, cu lista in lucru si datele de administrare", async () => {
    const d = await (await ca(ADMIN)).incarca();
    expect(d.eu).toMatchObject({ rol: "administrator", apartamentId: null });
    expect(d.apartamente).toHaveLength(20);
    expect(d.liste.map((l) => [l.luna, l.stare, l.totalRepartizat, l.apartamente])).toEqual([
      ["2026-09", "ciorna", 0, 0], ["2026-08", "publicata", 12154.95, 20], ["2026-07", "publicata", 11219.1, 20], ["2026-06", "publicata", 11208, 20],
    ]);
    expect(d.furnizori).toHaveLength(8);
    expect(d.furnizori.find((f) => f.cod === "C3").tipApa).toBeNull();
    expect(d.remindere).toHaveLength(5);
    expect(apNr(d, "17").locatari).toHaveLength(1);
    expect(apNr(d, "2").locatari).toEqual([]);
    expect(d.situatieBloc).toEqual({ apartamente: 20, faraRestanta: 15, restanteTotal: 7013.65 });
    expect(d.anunturi.map((a) => [a.cititori, a.totalLocatari])).toEqual([[2, 3], [3, 3], [3, 3]]);
    expect(d.voturi[0].nevotate).toEqual(["1", "3", "11", "15", "17", "19"]);
    expect(d.sesizari.every((x) => x.apartamentNumar)).toBe(true);
    expect(d.setari).toMatchObject({ chitantaUltimulNumar: 463, ziLimitaCitire: 25 });
    expect(d.notificari).toEqual([]);
  });

  it("rotunjirea, fondurile si media consumului", async () => {
    const d = await (await ca(ADMIN)).incarca();
    const fond = d.fonduri.find((f) => f.tip === "reparatii");
    expect(fond.sold).toBe(19228.6);
    expect(fond.miscari.map((m) => m.data)).toEqual([...fond.miscari.map((m) => m.data)].sort().reverse());
    expect(fond.miscari.filter((m) => m.listaId)).toHaveLength(3);
    expect(fond.miscari.filter((m) => m.documentId)).toHaveLength(2);
    expect(d.fonduri.find((f) => f.tip === "rulment")).toMatchObject({ sold: 9600, sumaPerApartament: 480 });
    expect(Object.keys(d.consumMediu).sort()).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(d.consumMediu["2026-09"]).toEqual({ rece: 5.02, calda: 2.52, apartamente: 6, persoane: 49 });
    const cheltC9 = d.cheltuieli.find((c) => c.listaId === d.liste[0].id);
    expect(cheltC9).toMatchObject({ cod: "C9", tip: "fond_reparatii", furnizorId: null, furnizor: "Asociatia de proprietari nr. 118" });
    const lista = d.liste[1];
    const perCheltuiala = d.cheltuieli.filter((c) => c.listaId === lista.id).map((c) => [c.suma, d.repartizari.filter((r) => r.cheltuialaId === c.id).reduce((s, r) => s + Math.round(r.suma * 100), 0)]);
    perCheltuiala.forEach(([suma, bani]) => expect(bani).toBe(Math.round(suma * 100)));
  });

  it("platile au chitanta, alocari si numele celui care a incasat cash", async () => {
    const d = await (await ca(ADMIN)).incarca();
    expect(d.plati).toHaveLength(47);
    const numerar = d.plati.find((p) => p.metoda === "numerar");
    expect(numerar).toMatchObject({ inregistrataDe: "Mihai Dobre", referinta: null, chitanta: { serie: "AP118" } });
    const card = d.plati.find((p) => p.metoda === "card");
    expect(card.inregistrataDe).toBeNull();
    expect(card.referinta).toMatch(/^SIM-[A-Z0-9]+$/);
    expect(d.plati.map((p) => p.chitanta.numar).sort((a, b) => a - b)).toEqual(Array.from({ length: 47 }, (_, i) => 417 + i));
  });

  it("facturile platite dupa ziua de azi apar inca neplatite", async () => {
    ceasDemo(new Date("2026-09-10T09:00:00"));
    const d = await (await ca(ADMIN)).incarca();
    const aug = d.liste.find((l) => l.luna === "2026-08");
    const f = d.cheltuieli.filter((c) => c.listaId === aug.id);
    expect(f.find((c) => c.serie === "ACA-448120").achitataLa).toBeNull();
    expect(f.find((c) => c.serie === "SAL-33128").achitataLa).toBeNull();
    const iul = d.liste.find((l) => l.luna === "2026-07");
    expect(d.cheltuieli.find((c) => c.listaId === iul.id && c.serie === "ELM-2188").achitataLa).toBe("2026-09-02");
  });
});

describe("fisiere si documente", () => {
  it("urlFisier: nimic pentru cale lipsa sau necunoscuta", async () => {
    const s = await ca(ADMIN);
    expect(await s.urlFisier(null)).toBeNull();
    expect(await s.urlFisier("poze/nu-exista.jpg")).toBeNull();
  });

  it("urlFisier si deschideDocument dau URL-ul fisierului incarcat", async () => {
    const creat = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fisier");
    const s = await ca(ADMIN);
    const fisier = new File(["pdf"], "pv.pdf", { type: "application/pdf" });
    await s.incarcaDocument({ titlu: " PV adunare ", tip: "proces_verbal", fisier, vizibil: true });
    const doc = (await s.incarca()).documente[0];
    expect(doc).toMatchObject({ titlu: "PV adunare", vizibil: true });
    expect(await s.deschideDocument(doc.id)).toBe("blob:fisier");
    expect(creat).toHaveBeenLastCalledWith(fisier);
  });

  it("documentele fara fisier se deschid ca PDF generat", async () => {
    const creat = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf");
    const s = await ca(LOCATAR);
    const doc = (await s.incarca()).documente.find((x) => x.titlu.startsWith("Regulamentul"));
    expect(await s.deschideDocument(doc.id)).toBe("blob:pdf");
    const blob = creat.mock.calls[0][0];
    expect(blob.type).toBe("application/pdf");
    const continut = await blob.text();
    expect(continut.startsWith("%PDF-1.4")).toBe(true);
    expect(continut).toContain("(Regulamentul asociatiei de proprietari)");
    expect(continut).toContain("Incarcat pe 2025-09-02");
  });

  it("documentul inexistent este refuzat", async () => {
    const s = await ca(LOCATAR);
    await expect(s.deschideDocument("doc-0")).rejects.toThrow("Documentul nu exista.");
  });

  it("[paritate] un locatar nu poate deschide un document doar-admin, ca la RLS", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:contract");
    const s = await ca(ADMIN);
    await s.incarcaDocument({ titlu: "Contract ascuns", tip: "contract", fisier: new File(["x"], "c.pdf"), vizibil: false });
    const doc = (await s.incarca()).documente.find((x) => x.titlu === "Contract ascuns");
    await s.intra(LOCATAR, PAROLA);
    await expect(s.deschideDocument(doc.id)).rejects.toThrow("Documentul nu mai exista sau nu este disponibil.");
    /* administratorul il deschide fara probleme */
    await s.intra(ADMIN, PAROLA);
    await expect(s.deschideDocument(doc.id)).resolves.toBe("blob:contract");
  });
});
