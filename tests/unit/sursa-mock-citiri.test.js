/* Sursa demo: citirile contoarelor, validarea, contorul general si estimarea. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { ceasDemo, ZI_DEMO, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";

const ILIE = "familia.ilie@adminbloc.test";
const apNr = (d, n) => d.apartamente.find((a) => a.numar === n);

async function ca(email, s = creeazaSursaMock()) {
  await s.intra(email, PAROLA);
  return { s, d: await s.incarca() };
}

/* Contoarele unui apartament si indexul lor din august */
function contoare(d, apId) {
  const c = d.contoare.filter((x) => x.apartamentId === apId);
  const rece = c.find((x) => x.tip === "rece");
  const calda = c.find((x) => x.tip === "calda");
  const index = (id) => d.citiri.find((x) => x.contorId === id && x.luna === "2026-08").indexCurent;
  return { rece, calda, aug: { rece: index(rece.id), calda: index(calda.id) } };
}

beforeEach(() => ceasDemo());

describe("transmiteCitire", () => {
  it("salveaza ambele indexuri ca trimise, cu poza si consumul fata de august", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const { rece, calda, aug } = contoare(d, apId);
    const poza = new File(["jpg"], "contor.jpg");
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 12.3456 }, { contorId: calda.id, index: String(aug.calda + 5) }], poza });
    const dupa = (await s.incarca()).citiri.filter((x) => x.luna === "2026-09");
    expect(dupa).toHaveLength(2);
    const r = dupa.find((x) => x.tip === "rece");
    expect(r).toMatchObject({ stare: "trimisa", sursa: "locatar", indexAnterior: aug.rece, consum: 12.346, transmisaLa: ZI_DEMO.toISOString() });
    expect(r.pozaCale).toMatch(/^poze\/\d+-contor\.jpg$/);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:poza");
    expect(await s.urlFisier(r.pozaCale)).toBe("blob:poza");
    expect(dupa.find((x) => x.tip === "calda").consum).toBe(5);
  });

  it("retrimiterea inlocuieste citirea trimisa; fara poza nu are cale", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const { rece, aug } = contoare(d, apId);
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 1 }] });
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 2 }] });
    const sept = (await s.incarca()).citiri.filter((x) => x.luna === "2026-09");
    expect(sept).toHaveLength(1);
    expect(sept[0]).toMatchObject({ consum: 2, pozaCale: null });
  });

  it("o luna fara citire anterioara porneste de la zero", async () => {
    const { s, d } = await ca(LOCATAR);
    const { rece } = contoare(d, d.eu.apartamentId);
    await s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-04", indexuri: [{ contorId: rece.id, index: 3 }] });
    expect((await s.incarca()).citiri.find((x) => x.luna === "2026-04")).toMatchObject({ indexAnterior: 0, consum: 3 });
  });

  it("indexul anterior este al celei mai recente luni, nu al ultimei citiri scrise", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const { rece, aug } = contoare(d, apId);
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-04", indexuri: [{ contorId: rece.id, index: 3 }] });
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 7 }] });
    expect((await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-09")).toMatchObject({ indexAnterior: aug.rece, consum: 7 });
  });

  it("refuza: apartamentul altuia, contorul altuia, index mai mic, luna deja validata", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const { rece, aug } = contoare(d, apId);
    const { d: da } = await ca(ADMIN);
    const alt = contoare(da, apNr(da, "3").id);
    await expect(s.transmiteCitire({ apartamentId: apNr(da, "3").id, luna: "2026-09", indexuri: [] })).rejects.toThrow("Nu ai acces la acest apartament.");
    await expect(s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: alt.rece.id, index: 999 }] })).rejects.toThrow("Contorul nu este al apartamentului tau.");
    await expect(s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece - 1 }] })).rejects.toThrow("Indexul nou nu poate fi mai mic decat cel anterior.");
    await expect(s.transmiteCitire({ apartamentId: apId, luna: "2026-08", indexuri: [{ contorId: rece.id, index: aug.rece + 1 }] })).rejects.toThrow("Indexul pe aceasta luna a fost deja validat.");
  });

  it("administratorul nu este locatar pe apartament", async () => {
    const { s, d } = await ca(ADMIN);
    await expect(s.transmiteCitire({ apartamentId: apNr(d, "17").id, luna: "2026-09", indexuri: [] })).rejects.toThrow("Nu ai acces la acest apartament.");
  });

  it.fails("[§8] transmiterea pentru alta luna decat cea curenta este refuzata", async () => {
    const { s, d } = await ca(LOCATAR);
    const { rece, aug } = contoare(d, d.eu.apartamentId);
    await expect(s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-11", indexuri: [{ contorId: rece.id, index: aug.rece + 9 }] })).rejects.toThrow();
  });

  it.fails("[§8] transmiterea este atomica: un index gresit nu salveaza nici celalalt", async () => {
    const { s, d } = await ca(LOCATAR);
    const { rece, calda, aug } = contoare(d, d.eu.apartamentId);
    await s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 3 }, { contorId: calda.id, index: aug.calda - 1 }] }).catch(() => {});
    expect((await s.incarca()).citiri.filter((x) => x.luna === "2026-09")).toEqual([]);
  });

  it("[A1] dupa o citire validata si una respinsa, retrimiterea ambelor merge", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const { rece, calda, aug } = contoare(d, apId);
    const indexuri = [{ contorId: rece.id, index: aug.rece + 3 }, { contorId: calda.id, index: aug.calda + 1 }];
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri });
    await s.intra(ADMIN, PAROLA);
    const sept = (await s.incarca()).citiri.filter((x) => x.apartamentId === apId && x.luna === "2026-09");
    await s.valideazaCitire(sept.find((x) => x.tip === "rece").id, true);
    await s.valideazaCitire(sept.find((x) => x.tip === "calda").id, false, "Poza neclara");
    await s.intra(LOCATAR, PAROLA);
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri });
  });

  it("[A4] indexul anterior vine doar din citirile validate, nu din cele trimise", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const { rece, aug } = contoare(d, apId);
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 10 }] });
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-10", indexuri: [{ contorId: rece.id, index: aug.rece + 15 }] });
    expect((await s.incarca()).citiri.find((x) => x.luna === "2026-10").indexAnterior).toBe(aug.rece);
  });
});

describe("valideazaCitire", () => {
  async function trimise() {
    const { s, d } = await ca(ADMIN);
    const ap9 = apNr(d, "9").id;
    const sept = d.citiri.filter((x) => x.apartamentId === ap9 && x.luna === "2026-09");
    return { s, d, rece: sept.find((x) => x.tip === "rece"), calda: sept.find((x) => x.tip === "calda") };
  }

  it("valideaza sau respinge cu motiv; o citire verificata nu se mai schimba", async () => {
    const { s, rece, calda } = await trimise();
    expect(rece.stare).toBe("trimisa");
    await s.valideazaCitire(rece.id, true);
    await s.valideazaCitire(calda.id, false, "  Poza neclara.  ");
    const d = await s.incarca();
    expect(d.citiri.find((x) => x.id === rece.id)).toMatchObject({ stare: "validata", motivRespingere: null });
    expect(d.citiri.find((x) => x.id === calda.id)).toMatchObject({ stare: "respinsa", motivRespingere: "Poza neclara." });
    await expect(s.valideazaCitire(rece.id, false, "x")).rejects.toThrow("Citirea a fost deja verificata.");
    await expect(s.valideazaCitire("cit-0", true)).rejects.toThrow("Citirea nu exista.");
  });

  it("respingerea fara motiv este refuzata", async () => {
    const { s, rece } = await trimise();
    await expect(s.valideazaCitire(rece.id, false)).rejects.toThrow("Scrie motivul, ca locatarul sa stie ce sa corecteze.");
    await expect(s.valideazaCitire(rece.id, false, "   ")).rejects.toThrow("Scrie motivul");
  });

  it("locatarul afla de respingere printr-o notificare", async () => {
    const { s, d } = await ca(LOCATAR);
    const { rece, aug } = contoare(d, d.eu.apartamentId);
    await s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 4 }] });
    await s.intra(ADMIN, PAROLA);
    const c = (await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-09");
    await s.valideazaCitire(c.id, false, "Cifrele nu se vad.");
    await s.intra(LOCATAR, PAROLA);
    expect((await s.incarca()).notificari[0]).toMatchObject({
      tip: "citire", titlu: "Indexul trimis a fost respins", corp: "Cifrele nu se vad. Te rugam sa trimiti din nou indexul, cu o poza clara.", cititaLa: null,
    });
  });
});

describe("valideazaCitiriApartament", () => {
  it("[A5] valideaza dintr-o data ambele contoare ale apartamentului", async () => {
    const { s, d } = await ca(ADMIN);
    const ap9 = apNr(d, "9").id;
    await s.valideazaCitiriApartament(ap9, "2026-09", true, null);
    const dupa = (await s.incarca()).citiri.filter((x) => x.apartamentId === ap9 && x.luna === "2026-09");
    expect(dupa.every((x) => x.stare === "validata")).toBe(true);
  });

  it("[A5] respinge dintr-o data ambele contoare, cu notificare", async () => {
    const { s, d } = await ca(LOCATAR);
    const { rece, calda, aug } = contoare(d, d.eu.apartamentId);
    await s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 4 }, { contorId: calda.id, index: aug.calda + 2 }] });
    await s.intra(ADMIN, PAROLA);
    const ap = (await s.incarca()).apartamente.find((a) => a.id === d.eu.apartamentId).id;
    const r = await s.valideazaCitiriApartament(ap, "2026-09", false, "  Poza neclara.  ");
    expect(r).toEqual({ validate: 2 });
    const respinse = (await s.incarca()).citiri.filter((x) => x.apartamentId === ap && x.luna === "2026-09");
    expect(respinse.every((x) => x.stare === "respinsa" && x.motivRespingere === "Poza neclara.")).toBe(true);
    await s.intra(LOCATAR, PAROLA);
    expect((await s.incarca()).notificari[0]).toMatchObject({ tip: "citire", titlu: "Indexul trimis a fost respins" });
  });

  it("refuza fara motiv la respingere; refuza un apartament inexistent sau fara nimic de verificat", async () => {
    const { s, d } = await ca(ADMIN);
    const ap9 = apNr(d, "9").id;
    await expect(s.valideazaCitiriApartament(ap9, "2026-09", false)).rejects.toThrow("Scrie motivul, ca locatarul sa stie ce sa corecteze.");
    await expect(s.valideazaCitiriApartament("apa-0", "2026-09", true, null)).rejects.toThrow("Apartamentul nu exista.");
    await s.valideazaCitiriApartament(ap9, "2026-09", true, null);
    await expect(s.valideazaCitiriApartament(ap9, "2026-09", true, null))
      .rejects.toThrow("Nu mai sunt citiri de verificat pentru acest apartament si aceasta luna.");
  });

  /* [paritate] contorizare.valideaza_citiri_apartament (si valideaza_citire,
     pe un singur contor) refuza o luna a carei lista e deja publicata: banii
     acelei luni au fost deja calculati din citirile validate pana atunci, o
     validare/respingere ulterioara le-ar schimba dupa ce lista a iesit.
     Lista curenta (septembrie) are o singura cheltuiala, fondul de reparatii
     pe cota indiviza, deci se poate publica fara nicio citire validata:
     ap. 9 ramane cu citirile "trimise" din CITIRI_LUNA_CURENTA. */
  it("[paritate] refuza o luna a carei lista e deja publicata", async () => {
    const { s, d } = await ca(ADMIN);
    const ap9 = apNr(d, "9").id;
    const septembrie = d.liste.find((l) => l.luna === "2026-09");
    expect(septembrie.stare).toBe("ciorna");
    const trimiseInainte = d.citiri.filter((x) => x.apartamentId === ap9 && x.luna === "2026-09" && x.stare === "trimisa");
    expect(trimiseInainte).toHaveLength(2);

    await s.publicaLista(septembrie.id);

    await expect(s.valideazaCitiriApartament(ap9, "2026-09", true, null))
      .rejects.toThrow("Lista lunii 2026-09-01 este deja publicata; citirile nu se mai pot verifica.");
    /* citirile raman neatinse, "trimise" */
    const dupa = (await s.incarca()).citiri.filter((x) => x.apartamentId === ap9 && x.luna === "2026-09");
    expect(dupa.every((x) => x.stare === "trimisa")).toBe(true);
  });
});

describe("citesteContorGeneral", () => {
  it("adauga citirea lunii si o inlocuieste la corectare", async () => {
    const { s, d } = await ca(ADMIN);
    const gen = d.contoare.find((c) => !c.apartamentId && c.tip === "rece");
    const aug = d.citiri.find((x) => x.contorId === gen.id && x.luna === "2026-08").indexCurent;
    await s.citesteContorGeneral("2026-09", "rece", aug + 400);
    await s.citesteContorGeneral("2026-09", "rece", String(aug + 410.5));
    const sept = (await s.incarca()).citiri.filter((x) => x.contorId === gen.id && x.luna === "2026-09");
    expect(sept).toHaveLength(1);
    expect(sept[0]).toMatchObject({ indexAnterior: aug, consum: 410.5, sursa: "administrator", stare: "validata", apartamentId: null });
    expect((await s.dateMotor(d.liste[0].id)).contorGeneral).toEqual({ rece: 410.5 });
  });

  it("fara citire anterioara porneste de la zero; indexul mai mic e refuzat", async () => {
    const { s } = await ca(ADMIN);
    await s.citesteContorGeneral("2026-01", "calda", 5);
    expect((await s.incarca()).citiri.find((x) => x.luna === "2026-01")).toMatchObject({ indexAnterior: 0, consum: 5 });
    await expect(s.citesteContorGeneral("2026-09", "calda", 10)).rejects.toThrow("Indexul nou nu poate fi mai mic decat cel anterior.");
  });

  it("locatarul nu poate citi contorul general", async () => {
    const { s } = await ca(LOCATAR);
    await expect(s.citesteContorGeneral("2026-09", "rece", 1)).rejects.toThrow("Doar administratorul poate face asta.");
  });

  it("[A3] corectarea unei luni publicate este refuzata", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.citesteContorGeneral("2026-06", "rece", 99999)).rejects.toThrow();
  });

  it("[A3] o luna viitoare este refuzata", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.citesteContorGeneral("2027-03", "rece", 1)).rejects.toThrow("Nu poti citi contorul general pe o luna viitoare.");
  });

  it("[A3] un index peste indexul de pornire al lunii urmatoare este refuzat", async () => {
    ceasDemo(new Date("2026-10-05T09:00:00"));
    const { s, d } = await ca(ADMIN);
    const gen = d.contoare.find((c) => !c.apartamentId && c.tip === "rece");
    const aug = d.citiri.find((x) => x.contorId === gen.id && x.luna === "2026-08").indexCurent;
    await s.citesteContorGeneral("2026-09", "rece", aug + 100);
    await s.citesteContorGeneral("2026-10", "rece", aug + 150);
    await expect(s.citesteContorGeneral("2026-09", "rece", aug + 200))
      .rejects.toThrow("nu poate fi mai mare decat indexul de pornire al lunii urmatoare");
  });

  it.fails("[§8] un tip fara contor general da un mesaj clar", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.citesteContorGeneral("2026-09", "gaz", 10)).rejects.toThrow(/contor/i);
  });
});

describe("estimeazaCitiri", () => {
  it("estimeaza pe media ultimelor trei luni doar contoarele fara citire", async () => {
    /* [A6] dupa termenul de citire (25 septembrie) */
    ceasDemo(new Date("2026-09-26T09:00:00"));
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const { rece } = contoare(d, ap3);
    const istoric = d.citiri.filter((x) => x.contorId === rece.id && x.stare === "validata" && x.sursa === "locatar").sort((a, b) => (a.luna < b.luna ? 1 : -1));
    const medie = Math.round((istoric.slice(0, 3).reduce((t, x) => t + x.consum, 0) / 3) * 1000) / 1000;

    /* 20 de apartamente x 2 contoare; 6 validate si 4 trimise se sar; cel respins (ap. 6) se estimeaza */
    expect(await s.estimeazaCitiri("2026-09")).toEqual({ estimate: 20 });
    const dupa = await s.incarca();
    const est = dupa.citiri.find((x) => x.contorId === rece.id && x.luna === "2026-09");
    expect(est).toMatchObject({ sursa: "estimat", stare: "validata", consum: medie, indexAnterior: istoric[0].indexCurent });
    expect(dupa.citiri.filter((x) => x.apartamentId === apNr(d, "6").id && x.luna === "2026-09").map((x) => x.stare).sort()).toEqual(["respinsa", "respinsa", "validata", "validata"]);
    expect(await s.estimeazaCitiri("2026-09")).toEqual({ estimate: 0 });
  });

  it("fara istoric estimeaza zero, de la indexul de pornire", async () => {
    const { s, d } = await ca(ADMIN);
    const { rece } = contoare(d, apNr(d, "1").id);
    const pornire = d.citiri.find((x) => x.contorId === rece.id && x.sursa === "pornire").indexCurent;
    expect(await s.estimeazaCitiri("2026-04")).toEqual({ estimate: 40 });
    expect((await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-04")).toMatchObject({ consum: 0, indexAnterior: pornire, indexCurent: pornire });
  });

  it("estimarea foloseste ultimele trei luni, chiar daca o luna veche a fost estimata dupa ele", async () => {
    /* [A6] dupa termenul de citire al lunii octombrie (25 octombrie) */
    ceasDemo(new Date("2026-10-26T09:00:00"));
    const { s, d } = await ca(ADMIN);
    const { rece } = contoare(d, apNr(d, "3").id);
    await s.estimeazaCitiri("2026-04");
    await s.estimeazaCitiri("2026-09");
    const dupa = await s.incarca();
    const valide = dupa.citiri.filter((x) => x.contorId === rece.id && x.stare === "validata" && x.sursa !== "pornire");
    const [iun, iul, aug, sept] = ["2026-06", "2026-07", "2026-08", "2026-09"].map((l) => valide.find((x) => x.luna === l));
    await s.estimeazaCitiri("2026-10");
    const oct = (await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-10");
    expect(oct.indexAnterior).toBe(sept.indexCurent);
    expect(oct.consum).toBe(Math.round(((iul.consum + aug.consum + sept.consum) / 3) * 1000) / 1000);
    expect(iun).toBeDefined();
  });

  it("locatarul nu poate estima", async () => {
    const { s } = await ca(ILIE);
    await expect(s.estimeazaCitiri("2026-09")).rejects.toThrow("Doar administratorul poate face asta.");
  });

  it("[A6] estimarea inainte de termenul de citire este refuzata", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.estimeazaCitiri("2026-09")).rejects.toThrow();
  });

  it("[A2] dupa o estimare prea mare, indexul real al lunii urmatoare este acceptat", async () => {
    /* [A6] dupa termenul de citire (25 septembrie) */
    ceasDemo(new Date("2026-09-26T09:00:00"));
    const { s } = await ca(ADMIN);
    await s.estimeazaCitiri("2026-09");
    await s.intra(ILIE, PAROLA);
    const d = await s.incarca();
    const { rece, aug } = contoare(d, d.eu.apartamentId);
    await s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-10", indexuri: [{ contorId: rece.id, index: aug.rece + 1 }] });
    /* citirea pleaca de la indexul real: consum 0, lantul continua de acolo */
    expect((await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-10"))
      .toMatchObject({ indexAnterior: aug.rece + 1, indexCurent: aug.rece + 1, consum: 0 });
  });

  it("[A2] sub ultima citire reala indexul ramane refuzat, chiar dupa o estimare", async () => {
    /* [A6] dupa termenul de citire (25 septembrie) */
    ceasDemo(new Date("2026-09-26T09:00:00"));
    const { s } = await ca(ADMIN);
    await s.estimeazaCitiri("2026-09");
    await s.intra(ILIE, PAROLA);
    const d = await s.incarca();
    const { rece, aug } = contoare(d, d.eu.apartamentId);
    await expect(s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-10", indexuri: [{ contorId: rece.id, index: aug.rece - 1 }] }))
      .rejects.toThrow("Indexul nou nu poate fi mai mic decat cel anterior.");
  });
});

describe("media consumului", () => {
  it("o luna cu un singur tip validat are media celuilalt null", async () => {
    const { s, d } = await ca(LOCATAR);
    const { rece, aug } = contoare(d, d.eu.apartamentId);
    await s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-10", indexuri: [{ contorId: rece.id, index: aug.rece + 12 }] });
    await s.intra(ADMIN, PAROLA);
    const c = (await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-10");
    await s.valideazaCitire(c.id, true);
    expect((await s.incarca()).consumMediu["2026-10"]).toEqual({ rece: 4, calda: null, apartamente: 1, persoane: 49 });
  });
});
