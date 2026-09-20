/* Comenzile locatarului (harta-functii §3, §11): plata cu cardul prin Edge
   Function, citirea contoarelor cu poza, sesizari, vot, prezenta, anunturi,
   notificari si fisierele semnate. Fiecare rulare are blocul ei. */
import { beforeAll, describe, expect, it } from "vitest";
import { creeazaBloc, cuFetch, db, intraCa, json, lunaCurenta, ok, pozaJpeg, serviciu, unic, zi1 } from "./fixture.js";

const CARD_BUN = { numar: "4242 4242 4242 4242", expira: "12/30", cvc: "123", nume: "Test" };
const CARD_REFUZAT = { numar: "4000 0000 0000 0002", expira: "12/30", cvc: "123", nume: "Test" };

let f;
let s;

beforeAll(async () => {
  f = await creeazaBloc({
    apartamente: [
      { numar: "1", etaj: 0, persoane: 2, cota: 50, index_rece: 10, index_calda: 5, restanta: 300 },
      { numar: "2", etaj: 1, persoane: 3, cota: 50, index_rece: 20, index_calda: 8 },
    ],
    locatari: [{ cheie: "loc", apartament: "1" }, { cheie: "vecin", apartament: "2" }],
  });
  ({ s } = await intraCa(f.conturi.loc.email));
});

describe("platesteCard()", () => {
  it("cardul acceptat: plata confirmata, alocata pe cea mai veche datorie, cu chitanta", async () => {
    const r = await s.platesteCard({ apartamentId: f.ap["1"], suma: 120, card: CARD_BUN });
    const plata = await ok(db("financiar").from("plati").select("*").eq("id", r.plataId).single());
    expect(r).toEqual({ plataId: plata.id });
    expect(plata).toMatchObject({ apartament_id: f.ap["1"], suma: 120, metoda: "card", stare: "confirmata", platita_de: f.conturi.loc.id, procesator: "simulat" });
    const alocari = await ok(db("financiar").from("alocari_plati").select("suma, datorie_id").eq("plata_id", plata.id));
    const sold = await ok(db("financiar").from("datorii").select("id").eq("apartament_id", f.ap["1"]).eq("tip", "sold_initial").single());
    expect(alocari).toEqual([{ suma: 120, datorie_id: sold.id }]);
    const date2 = await s.incarca();
    const ui = date2.plati.find((p) => p.id === plata.id);
    expect(ui).toMatchObject({ metoda: "card", suma: 120, referinta: plata.referinta_procesator, inregistrataDe: null, alocari: [{ datorieId: sold.id, suma: 120 }] });
    expect(ui.chitanta).toMatchObject({ numar: expect.any(Number), serie: expect.any(String) });
    expect(date2.datorii.find((d) => d.id === sold.id).rest).toBe(180);
  });

  it("cardul refuzat: mesajul bancii, fara plata confirmata", async () => {
    const inainte = await ok(db("financiar").from("plati").select("id").eq("apartament_id", f.ap["1"]).eq("stare", "confirmata"));
    await expect(s.platesteCard({ apartamentId: f.ap["1"], suma: 50, card: CARD_REFUZAT })).rejects.toThrow("Banca a refuzat plata. Nu s-a retras niciun ban.");
    const dupa = await ok(db("financiar").from("plati").select("id").eq("apartament_id", f.ap["1"]).eq("stare", "confirmata"));
    expect(dupa).toHaveLength(inainte.length);
  });

  it("suma zero este refuzata de functie, cu mesajul ei", async () => {
    await expect(s.platesteCard({ apartamentId: f.ap["1"], suma: 0, card: CARD_BUN })).rejects.toThrow("Suma trebuie sa fie mai mare decat zero.");
  });

  it("apartamentul altcuiva este refuzat", async () => {
    await expect(s.platesteCard({ apartamentId: f.ap["2"], suma: 10, card: CARD_BUN })).rejects.toThrow("Platitorul nu este locatar al apartamentului.");
  });

  it("un raspuns fara stare confirmata si fara mesaj foloseste textul implicit", async () => {
    await cuFetch((url) => (url.includes("/functions/v1/plata-card") ? json({ plataId: "x", stare: "necunoscuta" }) : undefined), async () => {
      await expect(s.platesteCard({ apartamentId: f.ap["1"], suma: 10, card: CARD_BUN })).rejects.toThrow("Plata nu a fost confirmata.");
    });
  });

  it.fails("[F8] plata in asteptare (202) nu este aratata ca esec", async () => {
    const asteptare = { plataId: "p1", stare: "in_asteptare", mesaj: "Plata asteapta confirmarea bancii. Chitanta apare cand banca o confirma." };
    await cuFetch((url) => (url.includes("/functions/v1/plata-card") ? json(asteptare, 202) : undefined), async () => {
      await expect(s.platesteCard({ apartamentId: f.ap["1"], suma: 10, card: CARD_BUN })).resolves.toMatchObject({ plataId: "p1" });
    });
  });
});

describe("transmiteCitire()", () => {
  const luna = lunaCurenta();

  it("fara poza: o citire trimisa pe fiecare contor, cu indexul anterior din baza", async () => {
    await s.transmiteCitire({
      apartamentId: f.ap["1"], luna, indexuri: [{ contorId: f.contoare["1:rece"], index: 13.5 }, { contorId: f.contoare["1:calda"], index: 7 }],
    });
    const citiri = await ok(db("contorizare").from("citiri").select("*").eq("apartament_id", f.ap["1"]).eq("luna", zi1(luna)).order("tip"));
    expect(citiri.map((c) => [c.tip, c.index_anterior, c.index_curent, c.consum, c.stare, c.sursa, c.poza_cale])).toEqual([
      ["calda", 5, 7, 2, "trimisa", "locatar", null], ["rece", 10, 13.5, 3.5, "trimisa", "locatar", null],
    ]);
    const d = await s.incarca();
    expect(d.citiri.filter((c) => c.luna === luna).map((c) => c.consum).sort()).toEqual([2, 3.5]);
  });

  it("cu poza: fisierul urca in poze/<bloc>/<apartament>/ si inlocuieste citirea trimisa", async () => {
    await s.transmiteCitire({ apartamentId: f.ap["1"], luna, indexuri: [{ contorId: f.contoare["1:rece"], index: 14 }], poza: pozaJpeg() });
    const c = await ok(db("contorizare").from("citiri").select("*").eq("contor_id", f.contoare["1:rece"]).eq("luna", zi1(luna)).single());
    expect(c.index_curent).toBe(14);
    expect(c.poza_cale).toMatch(new RegExp(`^${f.blocId}/${f.ap["1"]}/citire-${luna}-\\d+\\.jpg$`));
    const url = await s.urlFisier(c.poza_cale);
    const r = await fetch(url);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
  });

  it("un index mai mic decat cel anterior este refuzat cu cifrele lui", async () => {
    await expect(s.transmiteCitire({ apartamentId: f.ap["1"], luna, indexuri: [{ contorId: f.contoare["1:calda"], index: 1 }] }))
      .rejects.toThrow(/^Indexul nou \(1\) nu poate fi mai mic decat cel anterior \(5(\.0+)?\)\.$/);
  });

  it("o poza fara tip este refuzata de bucket si nu se salveaza nicio citire", async () => {
    const poza = new Blob([await pozaJpeg().arrayBuffer()]);
    await expect(s.transmiteCitire({ apartamentId: f.ap["1"], luna, indexuri: [{ contorId: f.contoare["1:calda"], index: 99 }], poza })).rejects.toThrow();
    const c = await ok(db("contorizare").from("citiri").select("index_curent").eq("contor_id", f.contoare["1:calda"]).eq("luna", zi1(luna)).single());
    expect(c.index_curent).toBe(7);
  });

  it.fails("[A8] o poza HEIC refuzata de bucket primeste un mesaj pe romaneste", async () => {
    const poza = new Blob([await pozaJpeg().arrayBuffer()], { type: "image/heic" });
    await expect(s.transmiteCitire({ apartamentId: f.ap["1"], luna, indexuri: [{ contorId: f.contoare["1:calda"], index: 99 }], poza }))
      .rejects.toThrow(/poza/i);
  });
});

describe("sesizari", () => {
  it("adaugaSesizare() fara poze: sesizarea noua, cu autorul si apartamentul", async () => {
    const id = await s.adaugaSesizare({ apartamentId: f.ap["1"], titlu: " Bec ars ", categorie: "iluminat", descriere: "" });
    const r = await ok(db("sesizari").from("sesizari").select("*").eq("id", id).single());
    expect(r).toMatchObject({ bloc_id: f.blocId, apartament_id: f.ap["1"], autor_id: f.conturi.loc.id, titlu: "Bec ars", descriere: "Bec ars", categorie: "iluminat", stare: "noua" });
  });

  it("adaugaSesizare() cu doua poze: ambele urca si sunt legate de sesizare", async () => {
    const id = await s.adaugaSesizare({ apartamentId: f.ap["1"], titlu: "Geam spart", categorie: "altele", descriere: "La etajul 1", poze: [pozaJpeg(), pozaJpeg()] });
    const poze = await ok(db("sesizari").from("sesizari_poze").select("cale").eq("sesizare_id", id));
    expect(poze).toHaveLength(2);
    for (const p of poze) {
      expect(p.cale).toMatch(new RegExp(`^${f.blocId}/${f.ap["1"]}/sesizare-\\d+-[12]\\.jpg$`));
      const { error } = await serviciu.storage.from("poze").download(p.cale);
      expect(error).toBeNull();
    }
    const d = await s.incarca();
    expect(d.sesizari.find((x) => x.id === id)).toMatchObject({ aMea: true, poze: expect.arrayContaining([expect.objectContaining({ cale: poze[0].cale })]) });
  });

  it("scrieMesaj() al locatarului nu vine din administratie", async () => {
    const id = await s.adaugaSesizare({ apartamentId: f.ap["1"], titlu: "Lift", categorie: "altele", descriere: "Nu merge" });
    await s.scrieMesaj(id, " Tot nu merge ");
    const m = await ok(db("sesizari").from("sesizari_mesaje").select("*").eq("sesizare_id", id).single());
    expect(m).toMatchObject({ text: "Tot nu merge", din_administratie: false, autor_id: f.conturi.loc.id });
  });

  it("sesizarea altui apartament este refuzata", async () => {
    await expect(s.adaugaSesizare({ apartamentId: f.ap["2"], titlu: "X", categorie: "altele", descriere: "Y" }))
      .rejects.toThrow("Poti trimite sesizari doar pentru apartamentul tau.");
  });
});

describe("vot, adunare, anunturi si notificari", () => {
  let vot;
  let optiuni;
  let adunare;
  let anunt;
  let notificare;

  beforeAll(async () => {
    const acum = Date.now();
    vot = await ok(db("guvernanta").from("voturi").insert({ asociatie_id: f.asociatieId, titlu: "Interfon nou?", inchide_la: new Date(acum + 86400000 * 5).toISOString() }).select().single());
    optiuni = await ok(db("guvernanta").from("voturi_optiuni").insert([{ vot_id: vot.id, text: "Da", ordine: 1 }, { vot_id: vot.id, text: "Nu", ordine: 2 }]).select());
    adunare = await ok(db("guvernanta").from("adunari_generale").insert({ asociatie_id: f.asociatieId, data_ora: new Date(acum + 86400000 * 9).toISOString(), loc: "Scara", ordine_de_zi: "Buget" }).select().single());
    anunt = await ok(db("comunicare").from("anunturi").insert({ asociatie_id: f.asociatieId, bloc_id: f.blocId, titlu: "Curatenie", corp: "Sambata" }).select().single());
    notificare = await ok(db("comunicare").from("notificari").insert({ profil_id: f.conturi.loc.id, asociatie_id: f.asociatieId, tip: "anunt", titlu: "Test" }).select().single());
  });

  it("voteaza() inregistreaza votul apartamentului; al doilea vot este refuzat", async () => {
    const da = optiuni.find((o) => o.ordine === 1);
    await s.voteaza(vot.id, da.id, f.ap["1"]);
    const e = await ok(db("guvernanta").from("voturi_exprimate").select("*").eq("vot_id", vot.id).single());
    expect(e).toMatchObject({ optiune_id: da.id, apartament_id: f.ap["1"], profil_id: f.conturi.loc.id });
    await expect(s.voteaza(vot.id, da.id, f.ap["1"])).rejects.toThrow("Apartamentul a votat deja.");
    const d = await s.incarca();
    expect(d.voturi.find((v) => v.id === vot.id)).toMatchObject({ votulMeu: da.id, votanti: 1 });
  });

  it("confirmaPrezenta() adauga apartamentul la adunare, o singura data", async () => {
    await s.confirmaPrezenta(adunare.id, f.ap["1"]);
    await s.confirmaPrezenta(adunare.id, f.ap["1"]);
    const p = await ok(db("guvernanta").from("adunari_prezente").select("*").eq("adunare_id", adunare.id));
    expect(p).toEqual([expect.objectContaining({ apartament_id: f.ap["1"], profil_id: f.conturi.loc.id })]);
  });

  it("marcheazaAnuntCitit() retine cine a citit; un anunt inexistent este refuzat", async () => {
    await s.marcheazaAnuntCitit(anunt.id);
    const c = await ok(db("comunicare").from("anunturi_citiri").select("*").eq("anunt_id", anunt.id));
    expect(c).toEqual([expect.objectContaining({ profil_id: f.conturi.loc.id })]);
    await expect(s.marcheazaAnuntCitit("00000000-0000-4000-8000-000000000000")).rejects.toThrow("Anuntul nu exista.");
  });

  it("marcheazaNotificareCitita() pune data citirii", async () => {
    await s.marcheazaNotificareCitita(notificare.id);
    const n = await ok(db("comunicare").from("notificari").select("citita_la").eq("id", notificare.id).single());
    expect(n.citita_la).not.toBeNull();
  });
});

describe("fisiere semnate", () => {
  let docOk;
  let docFaraFisier;
  let docAscuns;

  beforeAll(async () => {
    const cale = `${f.asociatieId}/${f.blocId}/${unic()}.pdf`;
    await ok(serviciu.storage.from("documente").upload(cale, Buffer.from("%PDF-1.4\n%%EOF\n"), { contentType: "application/pdf" }));
    const ins = (extra) => ok(db("comunicare").from("documente").insert({ asociatie_id: f.asociatieId, bloc_id: f.blocId, titlu: "Doc", tip: "altul", ...extra }).select().single());
    docOk = await ins({ cale });
    docFaraFisier = await ins({ cale: `${f.asociatieId}/${f.blocId}/${unic()}-lipsa.pdf` });
    docAscuns = await ins({ cale: `${f.asociatieId}/${f.blocId}/${unic()}-ascuns.pdf`, vizibil_locatarilor: false });
  });

  it("urlFisier(): null fara cale sau pentru un fisier inexistent", async () => {
    expect(await s.urlFisier(null)).toBeNull();
    expect(await s.urlFisier(`${f.blocId}/${f.ap["1"]}/nu-exista.jpg`)).toBeNull();
  });

  it("deschideDocument(): URL semnat care descarca fisierul", async () => {
    const url = await s.deschideDocument(docOk.id);
    expect(url).toContain("/storage/v1/object/sign/documente/");
    const r = await fetch(url);
    expect(r.status).toBe(200);
    expect((await r.text()).startsWith("%PDF")).toBe(true);
  });

  it("deschideDocument(): randul fara fisier in Storage arunca eroarea serverului", async () => {
    await expect(s.deschideDocument(docFaraFisier.id)).rejects.toThrow(/not found/i);
  });

  it("[NOU-3] deschideDocument() pe un document ascuns sau sters spune pe romaneste ca nu exista", async () => {
    await expect(s.deschideDocument(docAscuns.id)).rejects.toThrow(/document/i);
  });

  it("documentul ascuns nu apare in lista locatarului", async () => {
    const d = await s.incarca();
    expect(d.documente.map((x) => x.id)).toEqual(expect.arrayContaining([docOk.id, docFaraFisier.id]));
    expect(d.documente.map((x) => x.id)).not.toContain(docAscuns.id);
  });
});
