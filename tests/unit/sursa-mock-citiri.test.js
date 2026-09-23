/* Sursa demo: citirile contoarelor, validarea, contorul general si estimarea. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { ceasDemo, ZI_DEMO, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";

const ILIE = "0726 331 003";
const VOICU = "0741 002 101";
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

/* [K6] O lista nu se mai publica peste citiri trimise, deci o citire trimisa
   pe o luna publicata nu mai apare prin comenzi. Pazele pentru ea raman, ca
   aparare pentru datele de dinainte de reparatie, iar testele lor refac starea
   aceea direct: citirile trimise trec pe "validata" cat se publica lista,
   apoi revin pe "trimisa". */
async function publicaPesteCitiriTrimise(s, listaId) {
  const lista = s.db.liste.find((l) => l.id === listaId);
  const trimise = s.db.citiri.filter((c) => c.luna === lista.luna && c.stare === "trimisa");
  trimise.forEach((c) => { c.stare = "validata"; });
  await s.publicaLista(listaId);
  trimise.forEach((c) => { c.stare = "trimisa"; });
}

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

    /* [J2] apartamentul 1 are septembrie deja validata, dar lista lunii nu e
       inca publicata: aici se vede "deja validat", nu paza noua a listei
       publicate (august, folosit inainte de J2, e deja publicat). */
    await s.intra(VOICU, PAROLA);
    const dv = await s.incarca();
    const { rece: receV, aug: augV } = contoare(dv, dv.eu.apartamentId);
    await expect(s.transmiteCitire({ apartamentId: dv.eu.apartamentId, luna: "2026-09", indexuri: [{ contorId: receV.id, index: augV.rece + 1 }] }))
      .rejects.toThrow("Indexul pe aceasta luna a fost deja validat.");
  });

  it("administratorul nu este locatar pe apartament", async () => {
    const { s, d } = await ca(ADMIN);
    await expect(s.transmiteCitire({ apartamentId: apNr(d, "17").id, luna: "2026-09", indexuri: [] })).rejects.toThrow("Nu ai acces la acest apartament.");
  });

  it("[§8] transmiterea pentru alta luna decat cea curenta este refuzata", async () => {
    const { s, d } = await ca(LOCATAR);
    const { rece, aug } = contoare(d, d.eu.apartamentId);
    await expect(s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-11", indexuri: [{ contorId: rece.id, index: aug.rece + 9 }] })).rejects.toThrow();
  });

  /* [J2] Singura comanda de scriere din contorizare fara paza "lista lunii e
     deja publicata": daca administratorul publica lista lunii curente mai
     devreme, un index transmis (sau retrimis) dupa aceea ramane "trimisa"
     pentru totdeauna, pentru ca valideazaCitire refuza sa mai verifice o
     luna publicata. */
  it("[J2] refuza transmiterea pe o luna a carei lista e deja publicata", async () => {
    const { s, d } = await ca(ADMIN);
    const septembrie = d.liste.find((l) => l.luna === "2026-09");
    await publicaPesteCitiriTrimise(s, septembrie.id);
    await s.intra(LOCATAR, PAROLA);
    const dd = await s.incarca();
    const { rece, aug } = contoare(dd, dd.eu.apartamentId);
    await expect(s.transmiteCitire({ apartamentId: dd.eu.apartamentId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 1 }] }))
      .rejects.toThrow("Lista lunii septembrie 2026 este deja publicata; nu se mai poate transmite un index.");
  });

  it("[§8] transmiterea este atomica: un index gresit nu salveaza nici celalalt", async () => {
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
    ceasDemo(new Date("2026-10-05T09:00:00"));
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

  it("valideaza sau respinge cu motiv; o citire validata nu se accepta a doua oara", async () => {
    const { s, rece, calda } = await trimise();
    expect(rece.stare).toBe("trimisa");
    await s.valideazaCitire(rece.id, true);
    await s.valideazaCitire(calda.id, false, "  Poza neclara.  ");
    const d = await s.incarca();
    expect(d.citiri.find((x) => x.id === rece.id)).toMatchObject({ stare: "validata", motivRespingere: null });
    expect(d.citiri.find((x) => x.id === calda.id)).toMatchObject({ stare: "respinsa", motivRespingere: "Poza neclara." });
    await expect(s.valideazaCitire(rece.id, true)).rejects.toThrow("Citirea a fost deja verificata.");
    await expect(s.valideazaCitire(calda.id, false, "iar")).rejects.toThrow("Citirea a fost deja verificata.");
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

  it("[paritate] refuza o luna a carei lista e deja publicata", async () => {
    const { s, d } = await ca(ADMIN);
    const ap9 = apNr(d, "9").id;
    const septembrie = d.liste.find((l) => l.luna === "2026-09");
    const rece = d.citiri.find((x) => x.apartamentId === ap9 && x.luna === "2026-09" && x.tip === "rece");
    await publicaPesteCitiriTrimise(s, septembrie.id);
    await expect(s.valideazaCitire(rece.id, true))
      .rejects.toThrow("Lista lunii septembrie 2026 este deja publicata; citirea nu se mai poate verifica.");
    expect((await s.incarca()).citiri.find((x) => x.id === rece.id).stare).toBe("trimisa");
  });

  it("[H1] validarea recalculeaza indexul anterior stale al lunilor de dupa, inca trimise", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const { rece, aug } = contoare(d, apId);
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 10 }] });
    ceasDemo(new Date("2026-10-05T09:00:00"));
    /* Octombrie e transmis cat timp septembrie e inca "trimisa": indexul lui
       anterior sare peste septembrie si ramane pe indexul lui august. */
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-10", indexuri: [{ contorId: rece.id, index: aug.rece + 25 }] });
    const octInainte = (await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-10");
    expect(octInainte).toMatchObject({ indexAnterior: aug.rece, consum: 25 });

    await s.intra(ADMIN, PAROLA);
    const sept = (await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-09");
    await s.valideazaCitire(sept.id, true);

    const octDupa = (await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-10");
    expect(octDupa).toMatchObject({ indexAnterior: aug.rece + 10, consum: 15 });
  });

  /* [J1] Ecranul AdminCitiri se deschide pe luna curenta: nimic nu il
     impiedica pe administrator sa valideze intai luna mai noua si abia apoi
     pe cea veche. Cascada H1 veche sarea peste octombrie (deja "validata")
     cand se valideaza septembrie, lasandu-i indexul anterior si consumul
     inghetate la valoarea calculata la transmitere (sarind peste septembrie). */
  it("[J1] validarea in ordine inversa (luna mai noua intai) nu lasa indexul anterior stale", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const { rece, aug } = contoare(d, apId);
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 10 }] });
    ceasDemo(new Date("2026-10-05T09:00:00"));
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-10", indexuri: [{ contorId: rece.id, index: aug.rece + 20 }] });

    await s.intra(ADMIN, PAROLA);
    const dd = await s.incarca();
    const sept2 = dd.citiri.find((x) => x.contorId === rece.id && x.luna === "2026-09");
    const oct2 = dd.citiri.find((x) => x.contorId === rece.id && x.luna === "2026-10");
    await s.valideazaCitire(oct2.id, true);
    await s.valideazaCitire(sept2.id, true);

    const octDupa2 = (await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-10");
    expect(octDupa2).toMatchObject({ indexAnterior: aug.rece + 10, consum: 10 });
  });

  /* [J1] O citire ramasa "trimisa" pe o luna a carei lista e deja publicata
     nu se mai atinge: banii acelei luni sunt deja calculati si inghetati. */
  it("[J1] cascada nu atinge o citire a unei luni deja publicate", async () => {
    const { s, d } = await ca(ADMIN);
    const ap9 = apNr(d, "9").id;
    const rece = d.contoare.find((c) => c.apartamentId === ap9 && c.tip === "rece");
    const mai = d.citiri.find((x) => x.contorId === rece.id && x.sursa === "pornire").indexCurent;
    /* Citire ramasa "trimisa" pe iunie, deja publicata */
    const stricata = s.db.adauga("citiri", {
      contorId: rece.id, blocId: d.bloc.id, apartamentId: ap9, tip: "rece", luna: "2026-06",
      indexAnterior: 111, indexCurent: 222, consum: 111, sursa: "locatar", stare: "trimisa", pozaCale: null,
    });
    /* Citire pe o luna fara lista (mai), ca sa poata fi validata */
    const declansator = s.db.adauga("citiri", {
      contorId: rece.id, blocId: d.bloc.id, apartamentId: ap9, tip: "rece", luna: "2026-05",
      indexAnterior: mai, indexCurent: mai + 5, consum: 5, sursa: "locatar", stare: "trimisa", pozaCale: null,
    });
    await s.valideazaCitire(declansator.id, true);
    const dupa = (await s.incarca()).citiri.find((x) => x.id === stricata.id);
    expect(dupa).toMatchObject({ indexAnterior: 111, consum: 111 });
  });
});

describe("[K2] respingerea unei citiri validate din greseala", () => {
  /* Ca in baza (e-k2-respinge-citire-validata.test.sql): dupa validare nu
     mai exista nicio comanda care sa schimbe citirea, iar un index gresit
     facea luna nepublicabila. Administratorul o poate respinge acum, cat timp
     lista lunii nu este publicata. */
  it("se respinge cu motiv, locatarul e anuntat, iar luna de dupa isi reface indexul anterior", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const { rece, aug } = contoare(d, apId);
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 900 }] });
    await s.intra(ADMIN, PAROLA);
    const sept = (await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-09");
    await s.valideazaCitire(sept.id, true);
    ceasDemo(new Date("2026-10-05T09:00:00"));
    await s.intra(LOCATAR, PAROLA);
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-10", indexuri: [{ contorId: rece.id, index: aug.rece + 950 }] });

    await s.intra(ADMIN, PAROLA);
    await s.valideazaCitire(sept.id, false, " Indexul pare scris gresit. ");
    const dupa = await s.incarca();
    expect(dupa.citiri.find((x) => x.id === sept.id)).toMatchObject({ stare: "respinsa", motivRespingere: "Indexul pare scris gresit." });
    expect(dupa.citiri.find((x) => x.contorId === rece.id && x.luna === "2026-10")).toMatchObject({ indexAnterior: aug.rece, consum: 950 });
    await s.intra(LOCATAR, PAROLA);
    expect((await s.incarca()).notificari[0]).toMatchObject({ tip: "citire", titlu: "Indexul trimis a fost respins" });
  });

  it("raman refuzate: acceptarea a doua oara, pornirea, contorul general si luna publicata", async () => {
    const { s, d } = await ca(ADMIN);
    const ap9 = apNr(d, "9").id;
    const rece9 = d.contoare.find((c) => c.apartamentId === ap9 && c.tip === "rece");
    const pornire = d.citiri.find((x) => x.contorId === rece9.id && x.sursa === "pornire");
    const august = d.citiri.find((x) => x.contorId === rece9.id && x.luna === "2026-08");
    const general = d.citiri.find((x) => !x.apartamentId && x.stare === "validata" && x.sursa !== "pornire");
    await expect(s.valideazaCitire(august.id, true)).rejects.toThrow("Citirea a fost deja verificata.");
    await expect(s.valideazaCitire(pornire.id, false, "gresit")).rejects.toThrow("Citirea a fost deja verificata.");
    await expect(s.valideazaCitire(general.id, false, "gresit")).rejects.toThrow("Citirea a fost deja verificata.");
    await expect(s.valideazaCitire(august.id, false, "gresit"))
      .rejects.toThrow("Lista lunii august 2026 este deja publicata; citirea nu se mai poate verifica.");
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

    await publicaPesteCitiriTrimise(s, septembrie.id);

    await expect(s.valideazaCitiriApartament(ap9, "2026-09", true, null))
      .rejects.toThrow("Lista lunii septembrie 2026 este deja publicata; citirile nu se mai pot verifica.");
    /* citirile raman neatinse, "trimise" */
    const dupa = (await s.incarca()).citiri.filter((x) => x.apartamentId === ap9 && x.luna === "2026-09");
    expect(dupa.every((x) => x.stare === "trimisa")).toBe(true);
  });

  it("[H1] recalculeaza si ea indexul anterior stale al lunilor de dupa, inca trimise", async () => {
    const { s, d } = await ca(LOCATAR);
    const apId = d.eu.apartamentId;
    const { rece, aug } = contoare(d, apId);
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: aug.rece + 10 }] });
    ceasDemo(new Date("2026-10-05T09:00:00"));
    await s.transmiteCitire({ apartamentId: apId, luna: "2026-10", indexuri: [{ contorId: rece.id, index: aug.rece + 25 }] });

    await s.intra(ADMIN, PAROLA);
    await s.valideazaCitiriApartament(apId, "2026-09", true, null);

    const octDupa = (await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-10");
    expect(octDupa).toMatchObject({ indexAnterior: aug.rece + 10, consum: 15 });
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

  /* [K18] Mesajul trebuie sa spuna numele lunii in romana ("iunie 2026"),
     nu sirul brut al lunii ("2026-06") -- P6, reparat in SQL, uitat aici. */
  it("[K18] refuzul unei luni publicate spune numele lunii in romana", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.citesteContorGeneral("2026-06", "rece", 99999))
      .rejects.toThrow("Lista lunii iunie 2026 este deja publicata; contorul general nu se mai poate schimba.");
  });

  it("[A3] o luna viitoare este refuzata", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.citesteContorGeneral("2027-03", "rece", 1)).rejects.toThrow("Nu poti citi contorul general pe o luna viitoare.");
  });

  it("[A3] un index peste indexul contorului general de pe luna urmatoare este refuzat", async () => {
    ceasDemo(new Date("2026-10-05T09:00:00"));
    const { s, d } = await ca(ADMIN);
    const gen = d.contoare.find((c) => !c.apartamentId && c.tip === "rece");
    const aug = d.citiri.find((x) => x.contorId === gen.id && x.luna === "2026-08").indexCurent;
    await s.citesteContorGeneral("2026-09", "rece", aug + 100);
    await s.citesteContorGeneral("2026-10", "rece", aug + 150);
    await expect(s.citesteContorGeneral("2026-09", "rece", aug + 200))
      .rejects.toThrow("nu poate fi mai mare decat indexul contorului general de pe luna urmatoare");
  });

  /* [J7] Plafonul e indexul CHIAR INREGISTRAT (indexCurent) al lunii
     urmatoare, nu indexAnterior-ul ei inghetat: o corectura in sus,
     legitima, care ramane sub indexul real al lunii urmatoare, trebuie
     acceptata (nu doar sub indexAnterior-ul acelei luni), iar cascada [J1]
     trebuie sa propage corectura mai departe. */
  it("[J7] o corectura in sus, sub indexul real al lunii urmatoare, este acceptata si recalculeaza lunile de dupa", async () => {
    ceasDemo(new Date("2026-10-05T09:00:00"));
    const { s, d } = await ca(ADMIN);
    const gen = d.contoare.find((c) => !c.apartamentId && c.tip === "rece");
    const aug = d.citiri.find((x) => x.contorId === gen.id && x.luna === "2026-08").indexCurent;
    await s.citesteContorGeneral("2026-09", "rece", aug + 100);
    await s.citesteContorGeneral("2026-10", "rece", aug + 150);
    /* aug+120 e peste vechiul plafon gresit (indexAnterior-ul lui octombrie, aug+100),
       dar sub indexul lui chiar inregistrat (indexCurent, aug+150) */
    await s.citesteContorGeneral("2026-09", "rece", aug + 120);
    const dupa = await s.incarca();
    const sept = dupa.citiri.find((x) => x.contorId === gen.id && x.luna === "2026-09");
    const oct = dupa.citiri.find((x) => x.contorId === gen.id && x.luna === "2026-10");
    expect(sept).toMatchObject({ indexCurent: aug + 120, consum: 120 });
    expect(oct).toMatchObject({ indexAnterior: aug + 120, consum: 30 });
  });

  it("[§8] un tip fara contor general da un mesaj clar", async () => {
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

  /* [J1] contorizare.estimeaza_citiri() insereaza citirea lipsa direct ca
     "validata", dar nu recalcula nimic dupa ea: daca luna urmatoare fusese
     deja transmisa/validata cat luna estimata inca lipsea, indexul ei
     anterior ramanea inghetat, sarind peste luna lipsa -- estimarea o umple
     abia acum, iar luna urmatoare trebuie recalculata (altfel ii dubleaza
     consumul). */
  it("[J1] estimarea recalculeaza indexul anterior stale al lunii de dupa, deja validata", async () => {
    ceasDemo(new Date("2026-09-26T09:00:00"));
    const { s, d } = await ca(ADMIN);
    const ap3 = apNr(d, "3").id;
    const { rece } = contoare(d, ap3);
    const aug = d.citiri.find((x) => x.contorId === rece.id && x.luna === "2026-08").indexCurent;
    /* Octombrie a fost deja citit si validat cat septembrie inca lipsea:
       indexul lui anterior a sarit peste septembrie, direct pe august. */
    const oct = s.db.adauga("citiri", {
      contorId: rece.id, blocId: d.bloc.id, apartamentId: ap3, tip: "rece", luna: "2026-10",
      indexAnterior: aug, indexCurent: aug + 30, consum: 30, sursa: "locatar", stare: "validata", pozaCale: null,
    });
    await s.estimeazaCitiri("2026-09");
    const dupa = await s.incarca();
    const sept = dupa.citiri.find((x) => x.contorId === rece.id && x.luna === "2026-09");
    expect(sept.sursa).toBe("estimat");
    const octDupa = dupa.citiri.find((x) => x.id === oct.id);
    expect(octDupa.indexAnterior).toBe(sept.indexCurent);
    expect(octDupa.consum).toBeCloseTo(aug + 30 - sept.indexCurent, 3);
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

  /* [J5] Cele trei surori (valideazaCitire, valideazaCitiriApartament,
     citesteContorGeneral) refuza o luna a carei lista e deja publicata:
     banii ei au fost deja calculati din citirile validate pana atunci.
     estimeazaCitiri nu avea aceasta paza (nici sursa-mock.js, nici
     contorizare.estimeaza_citiri() inainte de migratia H4): o estimare
     tarzie ar fi adaugat o citire noua dupa ce lista iesise, iar ecranul
     Contoare si lista publicata ar fi ajuns sa nu se mai potriveasca. */
  it("[J5] refuza o luna a carei lista e deja publicata", async () => {
    ceasDemo(new Date("2026-09-26T09:00:00"));
    const { s, d } = await ca(ADMIN);
    const septembrie = d.liste.find((l) => l.luna === "2026-09");
    await publicaPesteCitiriTrimise(s, septembrie.id);
    await expect(s.estimeazaCitiri("2026-09"))
      .rejects.toThrow("Lista lunii septembrie 2026 este deja publicata; citirile nu se mai pot estima.");
  });

  it("[A2] dupa o estimare prea mare, indexul real al lunii urmatoare este acceptat", async () => {
    /* [A6] dupa termenul de citire (25 septembrie) */
    ceasDemo(new Date("2026-09-26T09:00:00"));
    const { s } = await ca(ADMIN);
    await s.estimeazaCitiri("2026-09");
    await s.intra(ILIE, PAROLA);
    const d = await s.incarca();
    const { rece, aug } = contoare(d, d.eu.apartamentId);
    ceasDemo(new Date("2026-10-05T09:00:00"));
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
    ceasDemo(new Date("2026-10-05T09:00:00"));
    await expect(s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-10", indexuri: [{ contorId: rece.id, index: aug.rece - 1 }] }))
      .rejects.toThrow("Indexul nou nu poate fi mai mic decat cel anterior.");
  });
});

describe("media consumului", () => {
  it("o luna cu un singur tip validat are media celuilalt null", async () => {
    const { s, d } = await ca(LOCATAR);
    const { rece, aug } = contoare(d, d.eu.apartamentId);
    ceasDemo(new Date("2026-10-05T09:00:00"));
    await s.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-10", indexuri: [{ contorId: rece.id, index: aug.rece + 12 }] });
    await s.intra(ADMIN, PAROLA);
    const c = (await s.incarca()).citiri.find((x) => x.contorId === rece.id && x.luna === "2026-10");
    await s.valideazaCitire(c.id, true);
    expect((await s.incarca()).consumMediu["2026-10"]).toEqual({ rece: 4, calda: null, apartamente: 1, persoane: 49 });
  });
});
