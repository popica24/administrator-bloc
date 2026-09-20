/* Sursa demo: sesizarile, mesajele si starea lor. */
import { describe, it, expect, beforeEach } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { ceasDemo, ZI_DEMO, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";

const ILIE = "familia.ilie@adminbloc.test";
const ACUM = ZI_DEMO.toISOString();
const dupaTitlu = (d, t) => d.sesizari.find((x) => x.titlu === t);

async function ca(email, s = creeazaSursaMock()) {
  await s.intra(email, PAROLA);
  return { s, d: await s.incarca() };
}

beforeEach(() => ceasDemo());

describe("adaugaSesizare", () => {
  it("locatarul deschide o sesizare noua, cu poze", async () => {
    const { s, d } = await ca(LOCATAR);
    const poze = [new File(["a"], "a.jpg"), new File(["b"], "b.jpg")];
    const id = await s.adaugaSesizare({ apartamentId: d.eu.apartamentId, titlu: "Geam spart", categorie: "altele", descriere: "La etajul 4", poze });
    const x = (await s.incarca()).sesizari[0];
    expect(x).toMatchObject({ id, aMea: true, titlu: "Geam spart", stare: "noua", creataLa: ACUM, preluataLa: null, rezolvataLa: null, apartamentNumar: "17", mesaje: [] });
    expect(x.poze.map((p) => p.cale)).toEqual([expect.stringMatching(/^sesizari\/\d+-a\.jpg$/), expect.stringMatching(/^sesizari\/\d+-b\.jpg$/)]);
  });

  it("fara poze; administratorul o vede cu numarul apartamentului", async () => {
    const { s, d } = await ca(LOCATAR);
    const id = await s.adaugaSesizare({ apartamentId: d.eu.apartamentId, titlu: "Lift", categorie: "lift", descriere: "Nu merge" });
    const { d: da } = await ca(ADMIN, s);
    expect(da.sesizari.find((x) => x.id === id)).toMatchObject({ aMea: false, apartamentNumar: "17", poze: [] });
  });

  it("nu se poate deschide pe apartamentul altuia", async () => {
    const { s } = await ca(ILIE);
    const { d } = await ca(LOCATAR);
    await expect(s.adaugaSesizare({ apartamentId: d.eu.apartamentId, titlu: "x" })).rejects.toThrow("Nu ai acces la acest apartament.");
  });
});

describe("scrieMesaj", () => {
  it("raspunsul administratorului preia sesizarea noua si anunta locatarii", async () => {
    const { s } = await ca(LOCATAR);
    const { d } = await ca(LOCATAR, s);
    const id = await s.adaugaSesizare({ apartamentId: d.eu.apartamentId, titlu: "Bec", categorie: "iluminat", descriere: "" });
    await ca(ADMIN, s);
    await s.scrieMesaj(id, "  Vine electricianul.  ");
    const { d: dl } = await ca(LOCATAR, s);
    const x = dl.sesizari.find((y) => y.id === id);
    expect(x).toMatchObject({ stare: "in_lucru", preluataLa: ACUM });
    expect(x.mesaje).toEqual([{ id: expect.any(String), text: "Vine electricianul.", la: ACUM, dinAdministratie: true, autor: "Mihai Dobre" }]);
    expect(dl.notificari[0]).toMatchObject({ tip: "sesizare", titlu: "Raspuns la sesizarea ta", corp: "Bec: Vine electricianul." });
  });

  it("un mesaj al administratorului pe o sesizare in lucru nu schimba data prelucrarii", async () => {
    const { s, d } = await ca(ADMIN);
    const bec = dupaTitlu(d, "Bec ars pe palier la etajul 4");
    await s.scrieMesaj(bec.id, "Montat.");
    const dupa = dupaTitlu(await s.incarca(), "Bec ars pe palier la etajul 4");
    expect(dupa).toMatchObject({ stare: "in_lucru", preluataLa: "2026-09-09T12:10:00+03:00" });
    expect(dupa.mesaje).toHaveLength(2);
  });

  it("locatarul scrie pe sesizarea lui; mesajul nu este din administratie si nu anunta pe nimeni", async () => {
    const { s, d } = await ca(LOCATAR);
    const bec = dupaTitlu(d, "Bec ars pe palier la etajul 4");
    await s.scrieMesaj(bec.id, "Tot nu merge.");
    const dupa = await s.incarca();
    expect(dupaTitlu(dupa, "Bec ars pe palier la etajul 4").mesaje[1]).toMatchObject({ text: "Tot nu merge.", dinAdministratie: false, autor: "Elena Marinescu" });
    expect(dupaTitlu(dupa, "Bec ars pe palier la etajul 4").stare).toBe("in_lucru");
    expect(dupa.notificari.filter((n) => n.tip === "sesizare")).toEqual([]);
  });

  it("mesajele se ordoneaza dupa data, nu dupa ordinea scrierii", async () => {
    const { s, d } = await ca(ADMIN);
    const bec = dupaTitlu(d, "Bec ars pe palier la etajul 4");
    ceasDemo(new Date("2026-09-09T10:00:00+03:00"));
    await s.scrieMesaj(bec.id, "Am vazut sesizarea.");
    expect(dupaTitlu(await s.incarca(), bec.titlu).mesaje.map((m) => m.text)).toEqual(["Am vazut sesizarea.", "Am cumparat becul, se monteaza joi."]);
  });

  it("refuza sesizarea inexistenta si sesizarea altui apartament", async () => {
    const { s, d } = await ca(LOCATAR);
    await expect(s.scrieMesaj("ses-0", "x")).rejects.toThrow("Sesizarea nu exista.");
    const alta = dupaTitlu(d, "Scurgere la coloana de la subsol");
    await expect(s.scrieMesaj(alta.id, "x")).rejects.toThrow("Nu ai acces la acest apartament.");
  });

  it("[§8] un mesaj pe o sesizare rezolvata este refuzat", async () => {
    const { s, d } = await ca(LOCATAR);
    const rezolvata = dupaTitlu(d, "Interfon defect");
    await expect(s.scrieMesaj(rezolvata.id, "Iar nu merge")).rejects.toThrow();
  });
});

describe("preiaSesizare si rezolvaSesizare", () => {
  it("preluarea trece sesizarea noua in lucru, o singura data", async () => {
    const { s, d } = await ca(ADMIN);
    const noua = dupaTitlu(d, "Scurgere la coloana de la subsol");
    await s.preiaSesizare(noua.id);
    expect(dupaTitlu(await s.incarca(), noua.titlu)).toMatchObject({ stare: "in_lucru", preluataLa: ACUM });
    ceasDemo(new Date("2026-09-20T10:00:00"));
    await s.preiaSesizare(noua.id);
    expect(dupaTitlu(await s.incarca(), noua.titlu).preluataLa).toBe(ACUM);
    await expect(s.preiaSesizare("ses-0")).rejects.toThrow("Sesizarea nu exista.");
  });

  it("rezolvarea pastreaza data preluarii sau o pune acum, si anunta locatarii", async () => {
    const { s, d } = await ca(ADMIN);
    const inLucru = dupaTitlu(d, "Bec ars pe palier la etajul 4");
    const noua = dupaTitlu(d, "Scurgere la coloana de la subsol");
    await s.rezolvaSesizare(inLucru.id);
    await s.rezolvaSesizare(noua.id);
    const dupa = await s.incarca();
    expect(dupaTitlu(dupa, inLucru.titlu)).toMatchObject({ stare: "rezolvata", preluataLa: "2026-09-09T12:10:00+03:00", rezolvataLa: ACUM });
    expect(dupaTitlu(dupa, noua.titlu)).toMatchObject({ stare: "rezolvata", preluataLa: ACUM, rezolvataLa: ACUM });
    await expect(s.rezolvaSesizare("ses-0")).rejects.toThrow("Sesizarea nu exista.");
    const { d: dl } = await ca(LOCATAR, s);
    expect(dl.notificari[0]).toMatchObject({ tip: "sesizare", titlu: "Sesizare rezolvata", corp: inLucru.titlu });
  });

  it("locatarul nu poate prelua sau rezolva", async () => {
    const { s, d } = await ca(LOCATAR);
    const bec = dupaTitlu(d, "Bec ars pe palier la etajul 4");
    await expect(s.preiaSesizare(bec.id)).rejects.toThrow("Doar administratorul poate face asta.");
    await expect(s.rezolvaSesizare(bec.id)).rejects.toThrow("Doar administratorul poate face asta.");
  });

  it("[§8] rezolvarea unei sesizari deja rezolvate este refuzata", async () => {
    const { s, d } = await ca(ADMIN);
    await expect(s.rezolvaSesizare(dupaTitlu(d, "Interfon defect").id)).rejects.toThrow();
  });
});

describe("[K4] sesizarile fostului locatar", () => {
  it("[K4] un locatar nou nu vede conversatia de dinaintea venirii lui", async () => {
    const { s, d } = await ca(ADMIN);
    const ap11 = d.apartamente.find((a) => a.numar === "11").id;
    const cod = await s.invitaLocatar(ap11, "chirias");
    await s.inregistreaza({ email: "nou@x.ro", parola: "ParolaBuna1", nume: "Nou" });
    await s.folosesteInvitatie(cod);
    const veche = dupaTitlu(await s.incarca(), "Scurgere la coloana de la subsol");
    expect(veche.aMea).toBe(false);
    expect(veche.poze).toEqual([]);
  });
});
