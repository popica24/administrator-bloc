/* Sursa demo: comenzile administratorului pe apartamente, acces si documente. */
import { describe, it, expect, beforeEach } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { ceasDemo, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";

const NEVERIFICAT = "0755 900 800";
const apNr = (d, n) => d.apartamente.find((a) => a.numar === n);

async function ca(email, s = creeazaSursaMock()) {
  await s.intra(email, PAROLA);
  return { s, d: await s.incarca() };
}

beforeEach(() => ceasDemo());

describe("cerAdmin", () => {
  it("locatarul si administratorul neaprobat nu pot da comenzi de administrator", async () => {
    for (const email of [LOCATAR, NEVERIFICAT]) {
      const { s } = await ca(email);
      await expect(s.schimbaPersoane("apa-3", 2, "2026-10")).rejects.toThrow("Doar administratorul poate face asta.");
      await expect(s.adaugaLocatar("apa-3", { nume: "X", telefon: "0722000030" })).rejects.toThrow("Doar administratorul poate face asta.");
      await expect(s.inchideAcces("loc-1")).rejects.toThrow("Doar administratorul poate face asta.");
      await expect(s.trimiteInstiintare("apa-3")).rejects.toThrow("Doar administratorul poate face asta.");
      await expect(s.incarcaDocument({ titlu: "x" })).rejects.toThrow("Doar administratorul poate face asta.");
      await expect(s.valideazaCitire("cit-1", true)).rejects.toThrow("Doar administratorul poate face asta.");
      await expect(s.marcheazaFacturaPlatita("che-1", true)).rejects.toThrow("Doar administratorul poate face asta.");
    }
  });
});

describe("schimbaPersoane", () => {
  it("adauga o modificare de la o luna, fara sa rescrie istoricul", async () => {
    const { s, d } = await ca(ADMIN);
    const ap = apNr(d, "17");
    await s.schimbaPersoane(ap.id, "4", "2026-10", "S-a nascut un copil");
    await s.schimbaPersoane(ap.id, 0, "2026-11");
    let a = apNr(await s.incarca(), "17");
    expect(a.persoane).toBe(3);
    expect(a.istoricPersoane).toEqual([
      { valabilDin: "2026-11", numar: 0, motiv: null },
      { valabilDin: "2026-10", numar: 4, motiv: "S-a nascut un copil" },
      { valabilDin: "2026-05", numar: 3, motiv: "Preluat de pe lista de plata din mai 2026" },
    ]);
    ceasDemo(new Date("2026-10-15T09:00:00"));
    a = apNr(await s.incarca(), "17");
    expect(a.persoane).toBe(4);
    await expect(s.schimbaPersoane(ap.id, 5, "2026-10")).rejects.toThrow("Exista deja o modificare pentru luna aceasta. Istoricul nu se rescrie.");
  });

  it("o modificare retroactiva se ordoneaza dupa luna, nu dupa momentul scrierii", async () => {
    const { s, d } = await ca(ADMIN);
    const ap = apNr(d, "17").id;
    await s.schimbaPersoane(ap, 5, "2026-09");
    await s.schimbaPersoane(ap, 1, "2026-07");
    const a = apNr(await s.incarca(), "17");
    expect(a.istoricPersoane.map((p) => p.valabilDin)).toEqual(["2026-09", "2026-07", "2026-05"]);
    expect(a.persoane).toBe(5);
  });

  it("persoanele noi intra in repartizarea listei din luna lor", async () => {
    const { s, d } = await ca(ADMIN);
    await s.schimbaPersoane(apNr(d, "17").id, 10, "2026-09");
    const x = await s.dateMotor(d.liste[0].id);
    expect(x.apartamente.find((a) => a.id === apNr(d, "17").id).persoane).toBe(10);
  });

  it("refuza un numar negativ sau care nu e numar", async () => {
    const { s, d } = await ca(ADMIN);
    await expect(s.schimbaPersoane(apNr(d, "1").id, -1, "2026-10")).rejects.toThrow("Numarul de persoane nu este valid.");
    await expect(s.schimbaPersoane(apNr(d, "1").id, "doi", "2026-10")).rejects.toThrow("Numarul de persoane nu este valid.");
  });

  it("[§8] un numar fractionar de persoane este refuzat", async () => {
    const { s, d } = await ca(ADMIN);
    await expect(s.schimbaPersoane(apNr(d, "1").id, 2.5, "2026-10")).rejects.toThrow();
  });

  it("[NOU-3] modificarea pe un apartament inexistent este refuzata", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.schimbaPersoane("apa-0", 2, "2026-10")).rejects.toThrow();
  });
});

describe("adaugaLocatar, parolaNoua si inchideAcces", () => {
  it("contul nou primeste numarul, o parola si legatura cu apartamentul", async () => {
    const { s, d } = await ca(ADMIN);
    const ap = apNr(d, "2");
    const r = await s.adaugaLocatar(ap.id, { nume: " Ana Pop ", telefon: "0722 000 021", calitate: "chirias" });
    expect(r).toMatchObject({ telefon: "0722000021", parola: expect.stringMatching(/^[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/) });
    const locatari = apNr(await s.incarca(), "2").locatari;
    expect(locatari.map((l) => [l.nume, l.calitate, l.telefon])).toContainEqual(["Ana Pop", "chirias", "0722000021"]);
    /* omul intra imediat cu numarul si parola primite */
    await s.intra(r.telefon, r.parola);
    expect((await s.incarca()).eu).toMatchObject({ nume: "Ana Pop", rol: "locatar" });
  });

  it("refuza apartamentul altui bloc, numarul gresit, numele lipsa si numarul luat", async () => {
    const { s, d } = await ca(ADMIN);
    const ap = apNr(d, "2").id;
    await expect(s.adaugaLocatar("apa-0", { nume: "X", telefon: "0722000022" })).rejects.toThrow("Doar administratorul blocului poate face conturi.");
    await expect(s.adaugaLocatar(ap, { nume: "X", telefon: "0722" })).rejects.toThrow("Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx.");
    await expect(s.adaugaLocatar(ap, { nume: "  ", telefon: "0722000022" })).rejects.toThrow("Scrie numele locatarului.");
    await expect(s.adaugaLocatar(ap, { telefon: "0722000022" })).rejects.toThrow("Scrie numele locatarului.");
    await s.adaugaLocatar(ap, { nume: "Ana", telefon: "0722000022" });
    await expect(s.adaugaLocatar(ap, { nume: "Ana", telefon: "0722 000 022" })).rejects.toThrow("Contul este deja legat de acest apartament.");
  });

  it("parola noua inlocuieste parola veche a locatarului", async () => {
    const { s, d } = await ca(ADMIN);
    const ap = apNr(d, "2").id;
    const cont = await s.adaugaLocatar(ap, { nume: "Ana", telefon: "0722 000 023" });
    const r = await s.parolaNoua(ap, cont.locatarId);
    expect(r.parola).not.toBe(cont.parola);
    await expect(s.intra(cont.telefon, cont.parola)).rejects.toThrow();
    await s.intra(cont.telefon, r.parola);
    expect((await s.incarca()).eu.nume).toBe("Ana");
  });

  it("parola noua doar pe apartamentul administrat si doar pentru locatarul lui", async () => {
    const { s, d } = await ca(ADMIN);
    const ap = apNr(d, "2").id;
    const leg = apNr(d, "17").locatari[0];
    await expect(s.parolaNoua("apa-0", leg.id)).rejects.toThrow("Doar administratorul blocului poate face conturi.");
    await expect(s.parolaNoua(ap, leg.id)).rejects.toThrow("Locatarul nu este al acestui apartament.");
  });

  it("inchiderea accesului scoate locatarul din aplicatie si din notificari", async () => {
    const { s, d } = await ca(ADMIN);
    const leg = apNr(d, "17").locatari[0];
    await s.inchideAcces(leg.id);
    expect(apNr(await s.incarca(), "17").locatari[0]).toMatchObject({ id: leg.id, activPana: "2026-09-19" });
    expect(await s.trimiteInstiintare(apNr(d, "17").id)).toEqual({ destinatari: 0 });
    expect((await s.incarca()).anunturi[0].totalLocatari).toBe(2);
    const { d: dl } = await ca(LOCATAR, s);
    expect(dl.eu).toMatchObject({ rol: "fara_apartament", apartamentId: null });
  });

  it("inchiderea accesului pe un id inexistent este refuzata", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.inchideAcces("loc-0")).rejects.toThrow("Legatura nu exista.");
  });

});

describe("incarcaDocument", () => {
  it("documentul ascuns nu apare locatarilor; fisierul fara nume primeste unul generic", async () => {
    const { s } = await ca(ADMIN);
    await s.incarcaDocument({ titlu: " Contract ", tip: "contract", fisier: new Blob(["x"]), vizibil: false });
    const da = await s.incarca();
    expect(da.documente[0]).toMatchObject({ titlu: "Contract", tip: "contract", vizibil: false });
    const { d } = await ca(LOCATAR, s);
    expect(d.documente.find((x) => x.titlu === "Contract")).toBeUndefined();
    expect(d.documente).toHaveLength(da.documente.length - 1);
  });

  it("fara fisier este refuzat", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.incarcaDocument({ titlu: "x", tip: "altul" })).rejects.toThrow("Alege fisierul.");
  });

});

describe("conducerea asociatiei", () => {
  it("numeste, refuza rolul gresit, persoana inexistenta si mandatul dublu", async () => {
    const { s, d } = await ca(ADMIN);
    const elena = d.apartamente.flatMap((a) => a.locatari).find((l) => l.nume === "Elena Marinescu");
    await expect(s.numesteInConducere(elena.profilId, "administrator")).rejects.toThrow("Mandatul este de presedinte sau de cenzor.");
    await expect(s.numesteInConducere("pro-0", "cenzor")).rejects.toThrow("Persoana nu exista.");
    await s.numesteInConducere(elena.profilId, "cenzor");
    await expect(s.numesteInConducere(elena.profilId, "cenzor")).rejects.toThrow("Persoana are deja acest mandat, in curs.");
    const dupa = await s.incarca();
    expect(dupa.conducere.some((m) => m.profilId === elena.profilId && m.rol === "cenzor" && !m.activPana)).toBe(true);
  });

  it("un mandat inceput azi se incheie de maine, ca istoricul sa aiba o zi", async () => {
    const { s, d } = await ca(ADMIN);
    const voicu = d.apartamente.flatMap((a) => a.locatari).find((l) => l.nume === "Gheorghe Voicu");
    const id = await s.numesteInConducere(voicu.profilId, "presedinte");
    await s.incheieMandat(id);
    const m = (await s.incarca()).conducere.find((x) => x.id === id);
    expect(m.activPana).toBe("2026-09-20");
  });

  it("contul din afara blocului: pe cineva cunoscut il leaga, fara parola noua", async () => {
    const { s } = await ca(ADMIN);
    /* numarul lui Gheorghe Voicu, care are deja cont */
    const r = await s.adaugaInConducere("Gheorghe Voicu", "0741 002 101", "cenzor");
    expect(r.parola).toBeNull();
    await expect(s.adaugaInConducere("Gheorghe Voicu", "0741 002 101", "cenzor")).rejects.toThrow("Persoana are deja acest mandat, in curs.");
    const cenzor = (await s.incarca()).conducere.find((m) => m.profilId === r.profil_id && m.rol === "cenzor");
    await s.incheieMandat(cenzor.id);
    /* dupa incheiere, acelasi om poate fi numit din nou */
    const dinNou = await s.adaugaInConducere("Gheorghe Voicu", "0741 002 101", "cenzor");
    expect(dinNou.parola).toBeNull();
    expect((await s.incarca()).conducere.find((m) => m.id === cenzor.id).activPana).toBeNull();
  });

  it("incheierea unui mandat inexistent este refuzata, ca in baza", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.incheieMandat("mem-0")).rejects.toThrow("Mandatul nu exista, s-a incheiat deja sau nu este in asociatia ta.");
  });

  it("contul din afara blocului: rol gresit, numar gresit si nume lipsa sunt refuzate", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.adaugaInConducere("X", "0799400400", "administrator")).rejects.toThrow("Mandatul este de presedinte sau de cenzor.");
    await expect(s.adaugaInConducere("X", "0722", "cenzor")).rejects.toThrow("Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx.");
    await expect(s.adaugaInConducere("  ", "0799400400", "cenzor")).rejects.toThrow("Scrie numele persoanei.");
    await expect(s.adaugaInConducere(undefined, "0799400400", "cenzor")).rejects.toThrow("Scrie numele persoanei.");
  });

  it("acelasi om poate fi si presedinte, si cenzor: primeaza presedintele", async () => {
    const { s, d } = await ca(ADMIN);
    const ilie = d.apartamente.flatMap((a) => a.locatari).find((l) => l.nume === "Dan Ilie");
    await s.numesteInConducere(ilie.profilId, "cenzor");
    await s.numesteInConducere(ilie.profilId, "presedinte");
    await s.intra("0726 331 003", PAROLA);
    expect((await s.incarca()).eu.rol).toBe("presedinte");
  });

  it("locatarul si conducerea nu numesc pe nimeni", async () => {
    const { s } = await ca(LOCATAR);
    await expect(s.numesteInConducere("pro-1", "cenzor")).rejects.toThrow("Doar administratorul poate face asta.");
    await expect(s.incheieMandat("mem-1")).rejects.toThrow("Doar administratorul poate face asta.");
    await expect(s.adaugaInConducere("X", "0799400401", "cenzor")).rejects.toThrow("Doar administratorul poate face asta.");
  });
});
