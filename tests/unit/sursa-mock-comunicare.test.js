/* Sursa demo: votul, adunarea generala, anunturile, notificarile si reminderele. */
import { describe, it, expect, beforeEach } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { ceasDemo, ZI_DEMO, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";

const ILIE = "familia.ilie@adminbloc.test";
const VOICU = "gheorghe.voicu@adminbloc.test";
const ACUM = ZI_DEMO.toISOString();
const apNr = (d, n) => d.apartamente.find((a) => a.numar === n);

async function ca(email, s = creeazaSursaMock()) {
  await s.intra(email, PAROLA);
  return { s, d: await s.incarca() };
}

beforeEach(() => ceasDemo());

describe("voteaza", () => {
  it("apartamentul voteaza o singura data", async () => {
    const { s, d } = await ca(LOCATAR);
    const v = d.voturi[0];
    await s.voteaza(v.id, v.optiuni[1].id, d.eu.apartamentId);
    const dupa = (await s.incarca()).voturi[0];
    expect(dupa).toMatchObject({ votulMeu: v.optiuni[1].id, votanti: 15 });
    expect(dupa.optiuni[1]).toMatchObject({ voturi: 6, cote: 29.94 });
    await expect(s.voteaza(v.id, v.optiuni[0].id, d.eu.apartamentId)).rejects.toThrow("Apartamentul a votat deja.");
  });

  it("refuza: vot inexistent, optiunea altui vot, apartamentul altuia, vot inchis", async () => {
    const { s: sa } = await ca(ADMIN);
    const altVot = await sa.deschideVot({ titlu: "Alt", descriere: "", optiuni: ["Da", "Nu"], inchideLa: "2026-10-30", numarare: "apartament" });
    const { s, d } = await ca(LOCATAR, sa);
    const v = d.voturi.find((x) => x.titlu === "Inlocuirea usii de la intrare");
    const optiuneStraina = d.voturi.find((x) => x.id === altVot).optiuni[0].id;
    await expect(s.voteaza("vot-0", v.optiuni[0].id, d.eu.apartamentId)).rejects.toThrow("Votul nu exista.");
    await expect(s.voteaza(v.id, optiuneStraina, d.eu.apartamentId)).rejects.toThrow("Optiunea nu apartine acestui vot.");
    const { d: dIlie } = await ca(ILIE);
    await expect(s.voteaza(v.id, v.optiuni[0].id, dIlie.eu.apartamentId)).rejects.toThrow("Nu ai acces la acest apartament.");
    ceasDemo(new Date("2026-10-04T09:00:00"));
    await expect(s.voteaza(v.id, v.optiuni[0].id, d.eu.apartamentId)).rejects.toThrow("Votul s-a inchis.");
  });

  it.fails("[K3] chiriasul nu voteaza in locul proprietarului", async () => {
    const { s, d } = await ca(ADMIN);
    const cod = await s.invitaLocatar(apNr(d, "11").id, "chirias");
    await s.inregistreaza({ email: "chirias@x.ro", parola: "ParolaBuna1", nume: "Chirias" });
    await s.folosesteInvitatie(cod);
    const dl = await s.incarca();
    const v = dl.voturi[0];
    await expect(s.voteaza(v.id, v.optiuni[0].id, dl.eu.apartamentId)).rejects.toThrow();
  });
});

describe("deschideVot", () => {
  it("creeaza votul cu variantele completate, inchis seara la 20:00", async () => {
    const { s } = await ca(ADMIN);
    const id = await s.deschideVot({ titlu: "  Vopsit  ", descriere: " Culoarea ", optiuni: [" Alb ", "", "  ", "Gri"], inchideLa: "2026-10-10", numarare: "cota" });
    const v = (await s.incarca()).voturi.find((x) => x.id === id);
    expect(v).toMatchObject({ titlu: "Vopsit", descriere: "Culoarea", deschisLa: ACUM, inchideLa: "2026-10-10T20:00:00+03:00", numarare: "cota", votanti: 0 });
    expect(v.optiuni.map((o) => [o.text, o.voturi, o.cote])).toEqual([["Alb", 0, 0], ["Gri", 0, 0]]);
    expect(v.nevotate).toHaveLength(20);
  });

  it("voturile se ordoneaza de la cel mai recent deschis", async () => {
    ceasDemo(new Date("2026-09-01T09:00:00+03:00"));
    const { s } = await ca(ADMIN);
    await s.deschideVot({ titlu: "Mai vechi", descriere: "", optiuni: ["a", "b"], inchideLa: "2026-09-30", numarare: "apartament" });
    expect((await s.incarca()).voturi.map((v) => v.titlu)).toEqual(["Inlocuirea usii de la intrare", "Mai vechi"]);
  });

  it("refuza mai putin de doua variante si o data de inchidere lipsa sau trecuta", async () => {
    const { s } = await ca(ADMIN);
    const vot = { titlu: "x", descriere: "", numarare: "apartament" };
    await expect(s.deschideVot({ ...vot, optiuni: ["Da", " "], inchideLa: "2026-10-10" })).rejects.toThrow("Un vot are nevoie de cel putin doua variante.");
    await expect(s.deschideVot({ ...vot, optiuni: ["Da", "Nu"], inchideLa: "" })).rejects.toThrow("Data de inchidere trebuie sa fie in viitor.");
    await expect(s.deschideVot({ ...vot, optiuni: ["Da", "Nu"], inchideLa: "2026-09-01" })).rejects.toThrow("Data de inchidere trebuie sa fie in viitor.");
  });

  it("locatarul nu poate deschide un vot", async () => {
    const { s } = await ca(LOCATAR);
    await expect(s.deschideVot({ titlu: "x", descriere: "", optiuni: ["a", "b"], inchideLa: "2026-10-10" })).rejects.toThrow("Doar administratorul poate face asta.");
  });

  it.fails("[§8] un vot care se inchide azi seara este acceptat", async () => {
    const { s } = await ca(ADMIN);
    await s.deschideVot({ titlu: "x", descriere: "", optiuni: ["a", "b"], inchideLa: "2026-09-19", numarare: "apartament" });
  });

  it.fails("[§8] ora de inchidere iarna este 20:00 ora Romaniei (+02:00)", async () => {
    const { s } = await ca(ADMIN);
    const id = await s.deschideVot({ titlu: "x", descriere: "", optiuni: ["a", "b"], inchideLa: "2026-12-10", numarare: "apartament" });
    expect((await s.incarca()).voturi.find((v) => v.id === id).inchideLa).toBe("2026-12-10T20:00:00+02:00");
  });
});

describe("reamintesteVot", () => {
  it("anunta locatarii apartamentelor care nu au votat", async () => {
    const { s, d } = await ca(ADMIN);
    expect(await s.reamintesteVot(d.voturi[0].id)).toEqual({ apartamente: 6, destinatari: 3 });
    const { d: dl } = await ca(VOICU, s);
    expect(dl.notificari[0]).toMatchObject({ tip: "vot", titlu: "Nu ai votat inca", corp: "Inlocuirea usii de la intrare" });
  });

  it("[K11] reamintirea pentru un vot inchis este refuzata", async () => {
    const { s, d } = await ca(ADMIN);
    ceasDemo(new Date("2026-10-05T09:00:00"));
    await expect(s.reamintesteVot(d.voturi[0].id)).rejects.toThrow();
  });

  it("[NOU-1] reamintirea pentru un vot inexistent da un mesaj clar", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.reamintesteVot("vot-0")).rejects.toThrow("Votul nu exista.");
  });
});

describe("adunarea generala", () => {
  it("confirmarea prezentei se numara o singura data", async () => {
    const { s, d } = await ca(LOCATAR);
    const a = d.adunari[0];
    await s.confirmaPrezenta(a.id, d.eu.apartamentId);
    await s.confirmaPrezenta(a.id, d.eu.apartamentId);
    expect((await s.incarca()).adunari[0]).toMatchObject({ prezente: 4, prezentaMea: true });
    const { d: dIlie } = await ca(ILIE);
    await expect(s.confirmaPrezenta(a.id, dIlie.eu.apartamentId)).rejects.toThrow("Nu ai acces la acest apartament.");
  });

  it.fails("[§8] prezenta la o adunare trecuta sau inexistenta este refuzata", async () => {
    const { s, d } = await ca(LOCATAR);
    await expect(s.confirmaPrezenta("adu-0", d.eu.apartamentId)).rejects.toThrow();
    ceasDemo(new Date("2026-10-10T09:00:00"));
    await expect(s.confirmaPrezenta(d.adunari[0].id, d.eu.apartamentId)).rejects.toThrow();
  });

  it("convocarea anunta toti locatarii blocului", async () => {
    const { s } = await ca(ADMIN);
    const id = await s.convoacaAdunare({ dataOra: "2026-11-05T18:00", loc: "  Sala  ", ordineDeZi: " Buget 2027 " });
    const a = (await s.incarca()).adunari.find((x) => x.id === id);
    expect(a).toMatchObject({ dataOra: "2026-11-05T18:00", loc: "Sala", ordineDeZi: "Buget 2027", convocataLa: ACUM, prezente: 0 });
    const { d } = await ca(LOCATAR, s);
    expect(d.notificari[0]).toMatchObject({ tip: "adunare_generala", titlu: "Convocare la adunarea generala", corp: "2026-11-05, Sala. Buget 2027" });
    const { d: dIlie } = await ca(ILIE, s);
    expect(dIlie.notificari[0].tip).toBe("adunare_generala");
  });

  it("adunarile se ordoneaza de la cea mai indepartata", async () => {
    const { s } = await ca(ADMIN);
    await s.convoacaAdunare({ dataOra: "2026-09-25T18:00", loc: "Sala", ordineDeZi: "Urgenta" });
    expect((await s.incarca()).adunari.map((a) => a.dataOra)).toEqual(["2026-10-03T18:30:00+03:00", "2026-09-25T18:00"]);
  });

  it("refuza data lipsa, de azi sau din trecut", async () => {
    const { s } = await ca(ADMIN);
    const x = { loc: "Sala", ordineDeZi: "x" };
    await expect(s.convoacaAdunare({ ...x, dataOra: "" })).rejects.toThrow("Data adunarii trebuie sa fie in viitor.");
    await expect(s.convoacaAdunare({ ...x, dataOra: "2026-09-10T18:00" })).rejects.toThrow("Data adunarii trebuie sa fie in viitor.");
  });

  it.fails("[§8] o adunare azi, mai tarziu, este acceptata", async () => {
    const { s } = await ca(ADMIN);
    await s.convoacaAdunare({ dataOra: "2026-09-19T19:00", loc: "Sala", ordineDeZi: "x" });
  });
});

describe("anunturile", () => {
  it("anuntul urgent ajunge ca notificare la toti locatarii; cel obisnuit nu", async () => {
    const { s } = await ca(ADMIN);
    await s.publicaAnunt({ titlu: " Apa oprita ", corp: " Maine ", urgent: true });
    ceasDemo(new Date(ZI_DEMO.getTime() + 60000));
    await s.publicaAnunt({ titlu: "Curatenie", corp: "Sambata", urgent: false });
    const da = await s.incarca();
    expect(da.anunturi.slice(0, 2).map((a) => [a.titlu, a.urgent, a.cititori, a.totalLocatari])).toEqual([
      ["Curatenie", false, 0, 3], ["Apa oprita", true, 0, 3],
    ]);
    expect(da.anunturi[1].publicatLa).toBe(ACUM);
    const { d } = await ca(ILIE, s);
    expect(d.notificari.filter((n) => n.tip === "anunt")).toEqual([
      { id: expect.any(String), tip: "anunt", titlu: "Urgent: Apa oprita", corp: "Maine", trimisaLa: ACUM, cititaLa: null },
    ]);
  });

  it("marcheazaAnuntCitit se numara o singura data", async () => {
    const { s, d } = await ca(LOCATAR);
    const a = d.anunturi[0];
    expect(a.citit).toBe(false);
    await s.marcheazaAnuntCitit(a.id);
    await s.marcheazaAnuntCitit(a.id);
    expect((await s.incarca()).anunturi[0].citit).toBe(true);
    const { d: da } = await ca(ADMIN, s);
    expect(da.anunturi[0].cititori).toBe(3);
  });

  it("locatarul nu poate publica anunturi", async () => {
    const { s } = await ca(LOCATAR);
    await expect(s.publicaAnunt({ titlu: "x", corp: "y" })).rejects.toThrow("Doar administratorul poate face asta.");
  });
});

describe("marcheazaNotificareCitita", () => {
  it("marcheaza doar notificarea proprie necitita", async () => {
    const { s, d } = await ca(LOCATAR);
    const [noua, veche] = d.notificari;
    expect(noua.cititaLa).toBeNull();
    await s.marcheazaNotificareCitita(noua.id);
    await s.marcheazaNotificareCitita(veche.id);
    const dupa = (await s.incarca()).notificari;
    expect(dupa[0].cititaLa).toBe(ACUM);
    expect(dupa[1].cititaLa).toBe(veche.cititaLa);

    const { s: si, d: di } = await ca(ILIE);
    await si.intra(ILIE, PAROLA);
    const aIlie = di.notificari.find((n) => !n.cititaLa);
    await s.marcheazaNotificareCitita(aIlie.id);
    expect((await si.incarca()).notificari.find((n) => n.id === aIlie.id).cititaLa).toBeNull();
  });
});

describe("remindere", () => {
  it("seteazaReminder schimba starea si, optional, zilele", async () => {
    const { s } = await ca(ADMIN);
    await s.seteazaReminder("plata", false, "7");
    await s.seteazaReminder("restanta", false);
    await s.seteazaReminder("adunare_generala", true, null);
    expect((await s.incarca()).remindere).toEqual([
      { tip: "lista_publicata", activ: true, zile: 0 },
      { tip: "citire_contoare", activ: true, zile: 5 },
      { tip: "plata", activ: false, zile: 7 },
      { tip: "restanta", activ: false, zile: 30 },
      { tip: "adunare_generala", activ: true, zile: 10 },
    ]);
  });

  it("[NOU-2] un tip de reminder necunoscut da un mesaj clar", async () => {
    const { s } = await ca(ADMIN);
    await expect(s.seteazaReminder("sms", true)).rejects.toThrow(/reminder/i);
  });

  it("trimiteReminder: citirea contoarelor merge la cine nu a transmis in luna curenta", async () => {
    const { s } = await ca(ADMIN);
    /* 6 validate + 4 trimise au transmis; ap. 6 are doar citiri respinse */
    expect(await s.trimiteReminder("citire_contoare")).toEqual({ apartamente: 10, destinatari: 2 });
    const { d } = await ca(ILIE, s);
    expect(d.notificari[0]).toMatchObject({ tip: "citire_contoare", titlu: "Transmite indexul la apa", corp: "Te rugam sa transmiti indexul contoarelor pana pe 25." });
  });

  it("trimiteReminder: restanta doar la datoriile trecute de scadenta", async () => {
    const { s } = await ca(ADMIN);
    expect(await s.trimiteReminder("restanta")).toEqual({ apartamente: 5, destinatari: 1 });
    const { d } = await ca(ILIE, s);
    expect(d.notificari[0]).toMatchObject({ tip: "restanta", titlu: "Instiintare de plata" });
  });

  it("trimiteReminder: plata la orice datorie neachitata; un tip necunoscut are text generic", async () => {
    const { s } = await ca(ADMIN);
    expect(await s.trimiteReminder("plata")).toEqual({ apartamente: 6, destinatari: 2 });
    ceasDemo(new Date(ZI_DEMO.getTime() - 60000));
    expect(await s.trimiteReminder("altceva")).toEqual({ apartamente: 6, destinatari: 2 });
    const { d } = await ca(LOCATAR, s);
    expect(d.notificari.slice(0, 2).map((n) => [n.tip, n.titlu, n.corp])).toEqual([
      ["plata", "Reamintire de plata", "Se apropie termenul de plata al intretinerii."],
      ["altceva", "Mesaj de la administratie", ""],
    ]);
  });

  it.fails("[K5] reminderul de plata nu merge la cine are doar datorii deja scadente", async () => {
    ceasDemo(new Date("2026-09-26T09:00:00"));
    const { s } = await ca(ADMIN);
    expect(await s.trimiteReminder("plata")).toEqual({ apartamente: 0, destinatari: 0 });
  });

  it("locatarul nu poate trimite remindere", async () => {
    const { s } = await ca(LOCATAR);
    await expect(s.trimiteReminder("plata")).rejects.toThrow("Doar administratorul poate face asta.");
    await expect(s.seteazaReminder("plata", false)).rejects.toThrow("Doar administratorul poate face asta.");
    await expect(s.reamintesteVot("vot-1")).rejects.toThrow("Doar administratorul poate face asta.");
    await expect(s.convoacaAdunare({ dataOra: "2027-01-01" })).rejects.toThrow("Doar administratorul poate face asta.");
  });
});
