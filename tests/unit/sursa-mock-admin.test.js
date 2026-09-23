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
