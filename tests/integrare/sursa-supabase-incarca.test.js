/* incarca(): forma obiectului `date` pe care il citesc ecranele, comparata cu
   baza de date (citita cu cheia de serviciu, peste RLS). Blocul demo D14 este
   doar citit; ramurile care cer date speciale folosesc un bloc de test nou. */
import { beforeAll, describe, expect, it } from "vitest";
import { azi, creeazaBloc, cuFetch, db, intraCa, json, lunaCurenta, lunaDelta, ok, serviciu, unic, zi1 } from "./fixture.js";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const suma = (xs) => round2(xs.reduce((s, x) => s + Number(x), 0));
const luna = (d) => (d ? String(d).slice(0, 7) : null);
const numeric = (a, b) => Number(a) - Number(b) || a.localeCompare(b);

/* Persoanele valabile azi, din istoricul din baza */
function persoaneAzi(istoric, apId) {
  const r = istoric.filter((p) => p.apartament_id === apId && luna(p.valabil_din) <= lunaCurenta())
    .sort((a, b) => (a.valabil_din < b.valabil_din ? 1 : -1));
  return r.length ? r[0].numar_persoane : 0;
}

/* Intercepteaza un raspuns PostgREST (GET) si il modifica: date pe care baza
   reala nu le poate produce, dar pe care maparea trebuie sa le suporte. */
const modifica = (fragment, transforma) => async (url, init, original) => {
  if (!url.includes(fragment) || (init.method && init.method !== "GET")) return undefined;
  const r = await original(url, init);
  return json(transforma(await r.json()), r.status);
};

/* [J11] Ca modifica(), dar doar pentru prima pagina a paginarii pe cheie
   (toate()): a doua cerere contine id=gt.<ultimul id primit>, calculat din
   randul ramas pe ultima pozitie DUPA transformare. O transformare care doar
   filtreaza pastreaza ordinea (deci id-ul cel mai mare ramane ultimul), dar
   una care reordoneaza (ca inOrdine mai jos, pentru NOU-2) poate lasa pe
   ultima pozitie un rand cu id mai mic decat altele deja intoarse, a doua
   pagina ar cere din nou randuri cu id mai mare, deja intoarse (reordonate)
   la prima pagina, si le-ar duplica. Paginile de continuare raman goale:
   setul real e mic, deci tot ce conteaza a fost deja intors la prima
   pagina. */
const modificaPrimaPagina = (fragment, transforma) => async (url, init, original) => {
  if (!url.includes(fragment) || (init.method && init.method !== "GET")) return undefined;
  if (url.includes("id=gt.")) return json([], 200);
  const r = await original(url, init);
  return json(transforma(await r.json()), r.status);
};

describe("D14, administratorul (doar citire)", () => {
  let date;
  let blocId;

  beforeAll(async () => {
    ({ date } = await intraCa("0745 210 118"));
    blocId = date.bloc.id;
  });

  it("eu, asociatia, setarile si blocul vin din tabelele lor", async () => {
    const eu = await ok(db("identitate").from("profiluri").select("*").eq("telefon", "0745210118").single());
    const bloc = await ok(db("organizare").from("blocuri").select("*").eq("id", blocId).single());
    const asoc = await ok(db("organizare").from("asociatii").select("*").eq("id", bloc.asociatie_id).single());
    const fin = await ok(db("financiar").from("setari_financiare").select("*").eq("asociatie_id", asoc.id).single());
    const cont = await ok(db("contorizare").from("setari_contorizare").select("*").eq("bloc_id", blocId).single());
    expect(date.eu).toEqual({ profilId: eu.id, nume: eu.nume, telefon: eu.telefon, rol: "administrator", apartamentId: null });
    expect(date.asociatie).toEqual({
      id: asoc.id, denumire: asoc.denumire, cui: asoc.cui, iban: asoc.iban, banca: asoc.banca, adresa: asoc.adresa, telefon: asoc.telefon, email: asoc.email,
    });
    expect(date.setari).toEqual({
      procentPenalizareZi: Number(fin.procent_penalizare_zi), zileGratie: fin.zile_gratie, ziScadenta: fin.zi_scadenta,
      chitantaSerie: fin.chitanta_serie, ziLimitaCitire: cont.zi_limita_citire,
    });
    expect(date.bloc).toEqual({ id: bloc.id, denumire: bloc.denumire, adresa: bloc.adresa, etaje: bloc.etaje, stare: "activ" });
  });

  it("apartamentele: toate, in ordine numerica, cu cota, suprafata si persoanele de azi", async () => {
    const ap = await ok(db("organizare").from("apartamente").select("*").eq("bloc_id", blocId));
    const istoric = await ok(db("organizare").from("apartamente_persoane").select("*").in("apartament_id", ap.map((a) => a.id)));
    expect(date.apartamente.map((a) => a.numar)).toEqual(ap.map((a) => a.numar).sort(numeric));
    for (const a of ap) {
      const ui = date.apartamente.find((x) => x.id === a.id);
      expect(ui).toMatchObject({
        numar: a.numar, etaj: a.etaj, proprietar: a.proprietar_nume, cota: Number(a.cota_indiviza), mp: Number(a.suprafata_mp),
        scutitLift: a.scutit_lift, persoane: persoaneAzi(istoric, a.id),
      });
      expect(ui.istoricPersoane).toHaveLength(istoric.filter((p) => p.apartament_id === a.id).length);
    }
    const locatari = await ok(db("identitate").from("locatari").select("*").eq("bloc_id", blocId));
    expect(date.apartamente.flatMap((a) => a.locatari).map((l) => l.id).sort()).toEqual(locatari.map((l) => l.id).sort());
  });

  it("listele, descrescator dupa luna, si invariantul: repartizarile insumeaza facturile", async () => {
    const liste = await ok(db("intretinere").from("liste_lunare").select("*").eq("bloc_id", blocId).order("luna", { ascending: false }));
    expect(date.liste.map((l) => l.id)).toEqual(liste.map((l) => l.id));
    for (const l of liste) {
      const ui = date.liste.find((x) => x.id === l.id);
      expect(ui).toMatchObject({ luna: luna(l.luna), stare: l.stare, versiune: l.versiune, totalRepartizat: Number(l.total_repartizat || 0) });
      if (l.stare !== "publicata") continue;
      const ch = date.cheltuieli.filter((c) => c.listaId === l.id);
      const rep = date.repartizari.filter((r) => r.listaId === l.id);
      expect(suma(rep.map((r) => r.suma))).toBe(suma(ch.map((c) => c.suma)));
      expect(suma(rep.map((r) => r.suma))).toBe(Number(l.total_repartizat));
      expect(new Set(rep.map((r) => r.apartamentId)).size).toBe(l.apartamente_repartizate);
    }
    const nRep = await serviciu.schema("intretinere").from("repartizari").select("id", { count: "exact", head: true }).eq("bloc_id", blocId);
    expect(date.repartizari).toHaveLength(nRep.count);
  });

  it("cheltuielile: furnizorul pe nume, iar randul de fond poarta numele asociatiei", async () => {
    const fond = date.cheltuieli.find((c) => c.tip === "fond_reparatii");
    expect(fond.furnizorId).toBeNull();
    expect(fond.furnizor).toBe(date.asociatie.denumire);
    const factura = date.cheltuieli.find((c) => c.tip === "factura");
    expect(factura.furnizor).toBe(date.furnizori.find((f) => f.id === factura.furnizorId).denumire);
    expect(typeof factura.suma).toBe("number");
  });

  it("banii: datoriile cu restul lor, platile confirmate cu chitanta si alocarile", async () => {
    const datorii = await ok(db("financiar").from("datorii_rest").select("*").eq("bloc_id", blocId));
    expect(date.datorii).toHaveLength(datorii.length);
    expect(suma(date.datorii.map((d) => d.rest))).toBe(suma(datorii.map((d) => d.rest)));
    expect(date.datorii.find((d) => d.tip === "sold_initial").luna).toBeNull();
    const plati = await ok(db("financiar").from("plati").select("*").eq("bloc_id", blocId).eq("stare", "confirmata"));
    const chitante = await ok(db("financiar").from("chitante").select("*").in("plata_id", plati.map((p) => p.id)));
    expect(date.plati).toHaveLength(plati.length);
    for (const p of date.plati) {
      const ch = chitante.find((c) => c.plata_id === p.id);
      /* [B6] randurile inghetate la emitere merg cu chitanta */
      expect(p.chitanta).toEqual({
        serie: ch.serie, numar: ch.numar, emisaLa: ch.emisa_la,
        randuri: expect.any(Array),
        /* [S4] apartamentul si proprietarul de la emitere */
        emisPentru: expect.objectContaining({ apartament: expect.any(String), proprietar: expect.any(String), bloc: expect.any(String) }),
      });
      expect(p.chitanta.randuri.reduce((t, r) => t + r.suma, 0)).toBeCloseTo(p.suma, 2);
      expect(suma(p.alocari.map((a) => a.suma))).toBeLessThanOrEqual(p.suma);
    }
    expect(date.plati.filter((p) => p.metoda === "numerar").every((p) => p.inregistrataDe === "Mihai Dobre")).toBe(true);
    expect(date.plati.filter((p) => p.metoda === "transfer").every((p) => p.inregistrataDe === "Mihai Dobre")).toBe(true);
    const idDatorii = new Set(datorii.map((d) => d.id));
    expect(date.penalizari.length).toBeGreaterThan(0);
    expect(date.penalizari.every((p) => idDatorii.has(p.datorieId) && typeof p.suma === "number")).toBe(true);
  });

  it("situatia blocului si fondurile se potrivesc cu registrul", async () => {
    const datorii = await ok(db("financiar").from("datorii_rest").select("*").eq("bloc_id", blocId).lt("scadenta", azi()));
    const pe = {};
    datorii.forEach((d) => { pe[d.apartament_id] = (pe[d.apartament_id] || 0) + Number(d.rest); });
    const restante = Object.values(pe).filter((r) => r > 0);
    expect(date.situatieBloc).toEqual({ apartamente: 20, faraRestanta: 20 - restante.length, restanteTotal: suma(restante) });
    const fonduri = await ok(db("financiar").from("fonduri_solduri").select("*").eq("bloc_id", blocId));
    for (const f of fonduri) {
      const ui = date.fonduri.find((x) => x.id === f.id);
      expect(ui.sold).toBe(Number(f.sold));
      expect(suma(ui.miscari.map((m) => m.suma))).toBe(Number(f.sold));
    }
  });

  it("administratorul vede furnizorii, reminderele si cine a citit anunturile", async () => {
    expect(date.furnizori.length).toBeGreaterThan(0);
    expect(date.furnizori[0]).toEqual(expect.objectContaining({ id: expect.any(String), denumire: expect.any(String), metoda: expect.any(String) }));
    expect(date.remindere.map((r) => r.tip).sort()).toEqual(["adunare_generala", "citire_contoare", "lista_publicata", "plata", "restanta"]);
    /* numarul de locatari cu cont se citeste din baza: fixture-urile testelor
       end-to-end adauga si ele locatari in blocul demonstrativ */
    const locatari = await ok(db("identitate").from("locatari").select("profil_id").eq("bloc_id", blocId).is("activ_pana", null));
    const cuCont = new Set(locatari.map((l) => l.profil_id)).size;
    expect(date.anunturi.every((a) => typeof a.cititori === "number" && a.totalLocatari === cuCont)).toBe(true);
    expect(date.voturi[0].nevotate).toEqual(expect.any(Array));
    expect(typeof date.voturi[0].optiuni[0].cote).toBe("number");
    expect(date.adunari[0].totalApartamente).toBe(20);
    expect(Object.keys(date.consumMediu)).toContain(lunaDelta(-1));
  });
});

describe("D14, locatarul (doar citire)", () => {
  let date;

  beforeAll(async () => {
    ({ date } = await intraCa("0733 410 217"));
  });

  it("vede doar apartamentul, datoriile si platile lui", async () => {
    expect(date.eu.rol).toBe("locatar");
    expect(date.apartamente.map((a) => a.id)).toEqual([date.eu.apartamentId]);
    expect(date.apartamente[0]).toMatchObject({ numar: "17", locatari: [] });
    expect(date.datorii.every((d) => d.apartamentId === date.eu.apartamentId)).toBe(true);
    expect(date.plati.every((p) => p.apartamentId === date.eu.apartamentId)).toBe(true);
    expect(date.plati.filter((p) => p.metoda === "transfer").length).toBeGreaterThanOrEqual(2);
    const datorii = await ok(db("financiar").from("datorii_rest").select("*").eq("apartament_id", date.eu.apartamentId));
    expect(suma(date.datorii.map((d) => d.rest))).toBe(suma(datorii.map((d) => d.rest)));
  });

  /* [P1/P5] Daca legaturile proprii nu gasesc niciun rand (o divergenta rara
     intre "azi" calculat in JS si "current_date" din Postgres, la limita
     zilei), calitate ramane necunoscuta in loc sa arunce: nu poate incerca sa
     citeasca .calitate dintr-un rezultat gasit cand cautarea n-a gasit nimic. */
  it("[P1/P5] fara nicio legatura gasita, calitate este null, nu o eroare", async () => {
    const { s } = await intraCa("0733 410 217", { incarca: false });
    const d = await cuFetch(modifica("/rest/v1/locatari?", () => []), () => s.incarca());
    expect(d.eu.calitate).toBeNull();
    expect(d.eu.apartamenteMele).toEqual([d.eu.apartamentId]);
  });

  it("nu primeste datele conducerii: furnizori, remindere, cititori, apartamente nevotate", () => {
    expect(date.furnizori).toEqual([]);
    expect(date.remindere).toEqual([]);
    expect(date.anunturi.every((a) => a.cititori === null && a.totalLocatari === null)).toBe(true);
    expect(date.voturi.every((v) => v.nevotate === null)).toBe(true);
    expect(date.liste.every((l) => l.stare === "publicata")).toBe(true);
  });

  it("sesizarile altora apar fara apartament, fara mesaje si fara poze", () => {
    const altele = date.sesizari.filter((s) => !s.aMea);
    expect(altele.length).toBeGreaterThan(0);
    expect(altele.every((s) => s.apartamentId === null && s.mesaje.length === 0 && s.poze.length === 0)).toBe(true);
    const ordonate = [...date.sesizari].sort((a, b) => (a.creataLa < b.creataLa ? 1 : -1));
    expect(date.sesizari.map((s) => s.id)).toEqual(ordonate.map((s) => s.id));
  });
});

describe("bloc de test: ramurile maparii", () => {
  let f;
  let admin;
  let loc1;
  let pres;
  const an = new Date().getUTCFullYear();
  const ids = {};

  beforeAll(async () => {
    f = await creeazaBloc({
      apartamente: [
        { numar: "10", etaj: 3, persoane: 4, cota: 25, suprafata: 70, index_rece: 40, index_calda: 12 },
        { numar: "2A", etaj: 1, persoane: 1, cota: 15, suprafata: 30, index_rece: 30, index_calda: 9 },
        { numar: "1", etaj: 0, persoane: 2, cota: 20, suprafata: 40, scutit_lift: true, index_rece: 10, index_calda: 5, restanta: 300 },
        { numar: "2", etaj: 1, persoane: 3, cota: 30, suprafata: 55, index_rece: 20, index_calda: 8 },
        { numar: "3", etaj: 1, persoane: 2, cota: 10, index_rece: 1, index_calda: 1, luna_start: lunaDelta(1) },
      ],
      locatari: [
        { cheie: "loc1", apartament: "1", activDin: `${an - 1}-01-01` },
        { cheie: "fost", apartament: "1", activDin: `${an - 2}-01-01`, activPana: `${an - 1}-01-01` },
        { cheie: "viitor", apartament: "2A", calitate: "chirias", activPana: `${an + 70}-01-01` },
        { cheie: "pres", apartament: "10" },
      ],
      blocDoi: true,
    });
    const c = f.conturi;
    await ok(db("identitate").from("membri_asociatie").insert({ asociatie_id: f.asociatieId, profil_id: c.pres.id, rol: "presedinte", activ_din: `${an - 1}-01-01` }));
    await ok(db("organizare").from("apartamente_persoane").insert({ apartament_id: f.ap["1"], valabil_din: zi1(lunaDelta(2)), numar_persoane: 5, motiv: "Vin copiii" }));
    await ok(db("organizare").from("contacte").insert([
      { asociatie_id: f.asociatieId, bloc_id: f.blocId, rol: "presedinte", nume: "Presedinte Test", telefon: "0733", apartament_id: f.ap["10"], ordine: 1 },
      { asociatie_id: f.asociatieId, rol: "lift", nume: "Firma Lift", telefon: "0800", program: "non stop", ordine: 2 },
    ]));

    /* Liste: ciorna in blocul nostru, cu o factura si fondul; una in blocul doi */
    const fz = await ok(db("intretinere").from("furnizori").insert({ asociatie_id: f.asociatieId, denumire: "Apa Test", metoda_implicita: "persoane", cod_implicit: "C1" }).select().single());
    ids.lista = await ok(db("intretinere").rpc("deschide_lista", { p_bloc_id: f.blocId, p_luna: zi1(lunaCurenta()) }));
    await ok(db("intretinere").from("cheltuieli").insert([
      { lista_id: ids.lista, tip: "factura", cod: "C1", categorie: "Apa", furnizor_id: fz.id, suma: 100, metoda: "persoane" },
      { lista_id: ids.lista, tip: "fond_reparatii", cod: "C9", categorie: "Fond de reparatii", suma: 50, metoda: "cota" },
    ]));
    ids.listaDoi = await ok(db("intretinere").rpc("deschide_lista", { p_bloc_id: f.blocDoiId, p_luna: zi1(lunaCurenta()) }));
    await ok(db("intretinere").from("cheltuieli").insert({ lista_id: ids.listaDoi, tip: "fond_reparatii", cod: "C9", categorie: "Fond", suma: 10, metoda: "cota" }));

    /* Bani: o plata cash (cu chitanta si alocare) si un transfer fara chitanta */
    ids.cash = await ok(db("financiar").rpc("inregistreaza_plata", { p_apartament_id: f.ap["1"], p_suma: 100, p_metoda: "numerar", p_inregistrata_de: f.adminId }));
    const tr = await ok(db("financiar").from("plati").insert({
      apartament_id: f.ap["1"], bloc_id: f.blocId, suma: 20, metoda: "transfer", stare: "confirmata", confirmata_la: new Date().toISOString(),
    }).select().single());
    ids.transfer = tr.id;
    const fonduri = await ok(db("financiar").from("fonduri").select("id, tip").eq("bloc_id", f.blocId));
    ids.fondRep = fonduri.find((x) => x.tip === "reparatii").id;
    await ok(db("financiar").from("miscari_fond").insert({ fond_id: ids.fondRep, data: azi(), suma: 250, descriere: "Sold preluat" }));

    /* Citire validata in luna curenta, pentru media de consum */
    await ok(db("contorizare").from("citiri").insert({
      contor_id: f.contoare["1:rece"], tip: "rece", bloc_id: f.blocId, apartament_id: f.ap["1"], luna: zi1(lunaCurenta()),
      index_anterior: 10, index_curent: 14, sursa: "locatar", stare: "validata",
    }));

    /* Sesizari: a lui loc1, a fostului locatar (K4), a vecinului si una cu 1001 mesaje */
    const acum = Date.now();
    const sesizare = async (numar, autor, titlu, creat, extra = {}) => (await ok(db("sesizari").from("sesizari").insert({
      bloc_id: f.blocId, apartament_id: f.ap[numar], autor_id: autor, categorie: "altele", titlu, descriere: `${titlu}, detalii`,
      creat_la: new Date(creat).toISOString(), ...extra,
    }).select().single())).id;
    ids.sLoc1 = await sesizare("1", c.loc1.id, "Bec ars", acum - 2 * 86400000);
    ids.sFost = await sesizare("1", c.fost.id, "Robinet fost locatar", Date.UTC(an - 2, 5, 1));
    ids.sVecin = await sesizare("2A", c.viitor.id, "Usa scartaie", acum - 86400000);
    ids.sMulte = await sesizare("10", c.pres.id, "Conversatie lunga", acum - 3 * 86400000, { stare: "in_lucru", preluata_la: new Date(acum - 3 * 86400000 + 1000).toISOString() });
    await ok(db("sesizari").from("sesizari_mesaje").insert([
      { sesizare_id: ids.sLoc1, autor_id: f.adminId, din_administratie: true, text: "Venim maine", creat_la: new Date(acum - 86400000).toISOString() },
      { sesizare_id: ids.sFost, autor_id: c.fost.id, din_administratie: false, text: "Mesajul fostului", creat_la: new Date(Date.UTC(an - 2, 5, 2)).toISOString() },
    ]));
    await ok(db("sesizari").from("sesizari_poze").insert({ sesizare_id: ids.sLoc1, cale: `${f.blocId}/${f.ap["1"]}/sesizare-test.jpg` }));
    const baza = acum - 3 * 86400000;
    await ok(db("sesizari").from("sesizari_mesaje").insert(Array.from({ length: 1001 }, (_, i) => ({
      sesizare_id: ids.sMulte, autor_id: f.adminId, din_administratie: true, text: `mesaj ${String(i + 1).padStart(4, "0")}`,
      creat_la: new Date(baza + (i + 1) * 1000).toISOString(),
    }))));

    /* Comunicare: anunturi si documente pe asociatie, pe bloc si pe blocul doi */
    const anunt = async (bloc, titlu, autor) => (await ok(db("comunicare").from("anunturi").insert({
      asociatie_id: f.asociatieId, bloc_id: bloc, autor_id: autor, titlu, corp: `${titlu}.`,
    }).select().single())).id;
    ids.aAsoc = await anunt(null, "Pentru toata asociatia", f.adminId);
    ids.aBloc = await anunt(f.blocId, "Pentru bloc", null);
    ids.aDoi = await anunt(f.blocDoiId, "Pentru blocul doi", f.adminId);
    await ok(db("comunicare").from("anunturi_citiri").insert([
      { anunt_id: ids.aBloc, profil_id: c.loc1.id }, { anunt_id: ids.aBloc, profil_id: c.fost.id }, { anunt_id: ids.aAsoc, profil_id: c.viitor.id },
    ]));
    const document = async (bloc, titlu, vizibil = true) => (await ok(db("comunicare").from("documente").insert({
      asociatie_id: f.asociatieId, bloc_id: bloc, titlu, tip: "altul", cale: `${f.asociatieId}/${unic()}.pdf`, vizibil_locatarilor: vizibil,
    }).select().single())).id;
    ids.dAsoc = await document(null, "Statut");
    ids.dBloc = await document(f.blocId, "Contract lift");
    ids.dDoi = await document(f.blocDoiId, "Contract blocul doi");
    ids.dAscuns = await document(f.blocId, "Nota interna", false);

    /* Vot deschis, cu un vot al lui loc1; adunare viitoare; o notificare */
    const vot = await ok(db("guvernanta").from("voturi").insert({
      asociatie_id: f.asociatieId, titlu: "Vopsim scara?", inchide_la: new Date(acum + 7 * 86400000).toISOString(), creat_de: f.adminId,
    }).select().single());
    ids.vot = vot.id;
    const optiuni = await ok(db("guvernanta").from("voturi_optiuni").insert([{ vot_id: vot.id, text: "Da", ordine: 1 }, { vot_id: vot.id, text: "Nu", ordine: 2 }]).select());
    ids.optDa = optiuni.find((o) => o.ordine === 1).id;
    await ok(db("guvernanta").from("voturi_exprimate").insert({ vot_id: vot.id, optiune_id: ids.optDa, apartament_id: f.ap["1"], profil_id: c.loc1.id }));
    const adunare = await ok(db("guvernanta").from("adunari_generale").insert({
      asociatie_id: f.asociatieId, data_ora: new Date(acum + 14 * 86400000).toISOString(), loc: "Parter", ordine_de_zi: "Bugetul", convocata_de: f.adminId,
    }).select().single());
    ids.adunare = adunare.id;
    await ok(db("guvernanta").from("adunari_prezente").insert({ adunare_id: adunare.id, apartament_id: f.ap["1"], profil_id: c.loc1.id }));
    ids.notificare = (await ok(db("comunicare").from("notificari").insert({
      profil_id: c.loc1.id, asociatie_id: f.asociatieId, tip: "anunt", titlu: "Salut", corp: "Bun venit",
    }).select().single())).id;

    admin = (await intraCa(f.adminTelefon)).date;
    loc1 = (await intraCa(c.loc1.telefon)).date;
    pres = (await intraCa(c.pres.telefon)).date;
  });

  it("apartamentele: ordinea numerica (10 dupa 3) si persoanele valabile azi", () => {
    expect(admin.apartamente.map((a) => a.numar).filter((n) => n !== "2A")).toEqual(["1", "2", "3", "10"]);
    const a1 = admin.apartamente.find((a) => a.numar === "1");
    const a3 = admin.apartamente.find((a) => a.numar === "3");
    expect(a1.persoane).toBe(2);
    expect(a1.istoricPersoane).toEqual([
      { valabilDin: lunaDelta(2), numar: 5, motiv: "Vin copiii" },
      { valabilDin: f.lunaStart, numar: 2, motiv: "Preluat de pe lista de hartie" },
    ]);
    expect(a3).toMatchObject({ persoane: 0, mp: null, proprietar: "Proprietar 3", istoricPersoane: [{ valabilDin: lunaDelta(1), numar: 2, motiv: "Preluat de pe lista de hartie" }] });
  });

  /* Comparatorul nu este o ordine totala (10 < 2A < 3 < 10), deci rezultatul
     depinde de ordinea in care baza intoarce randurile. Ordinea de intrare
     este fixata aici, ca testul sa nu depinda de planul de executie. */
  it("[NOU-2] un numar cu litera (2A) se aseaza intre 2 si 3, nu dupa 10", async () => {
    const ordine = ["10", "2A", "1", "2", "3"];
    const inOrdine = (randuri) => [...randuri].sort((a, b) => ordine.indexOf(a.numar) - ordine.indexOf(b.numar));
    const { s } = await intraCa(f.adminTelefon, { incarca: false });
    const date = await cuFetch(modificaPrimaPagina("/apartamente?select", inOrdine), () => s.incarca());
    expect(date.apartamente.map((a) => a.numar)).toEqual(["1", "2", "2A", "3", "10"]);
  });

  it("locatarii apartamentului, cu fostul locatar si cu numerele lor", () => {
    const a1 = admin.apartamente.find((a) => a.numar === "1");
    expect(a1.locatari.map((l) => l.nume).sort()).toEqual([`Locatar fost ${f.id}`, `Locatar loc1 ${f.id}`]);
    expect(a1.locatari.find((l) => l.id === f.locatari.fost)).toMatchObject({ activPana: `${new Date().getUTCFullYear() - 1}-01-01`, calitate: "proprietar" });
    expect(a1.locatari.every((l) => /^0\d{9}$/.test(l.telefon))).toBe(true);
  });

  it("contactele, cu numarul apartamentului doar unde exista", () => {
    expect(admin.contacte).toEqual([
      expect.objectContaining({ rol: "presedinte", nume: "Presedinte Test", apartamentNumar: "10", program: null }),
      expect.objectContaining({ rol: "lift", nume: "Firma Lift", apartamentNumar: null, program: "non stop" }),
    ]);
  });

  it("listele si cheltuielile altui bloc al asociatiei nu apar; ciorna are total 0", () => {
    expect(admin.liste).toEqual([{ id: ids.lista, luna: lunaCurenta(), stare: "ciorna", versiune: 1, scadenta: null, publicataLa: null, totalRepartizat: 0, apartamente: 0 }]);
    expect(admin.cheltuieli.map((c) => [c.cod, c.furnizor, c.furnizorId === null])).toEqual(expect.arrayContaining([
      ["C1", "Apa Test", false], ["C9", f.denumireAsociatie, true],
    ]));
    expect(admin.cheltuieli.every((c) => c.listaId === ids.lista)).toBe(true);
    expect(admin.repartizari).toEqual([]);
    expect(loc1.liste).toEqual([]);
  });

  it("banii: restanta de pe hartie fara luna, chitanta doar unde s-a emis, alocarea platii", () => {
    const sold = admin.datorii.find((d) => d.tip === "sold_initial");
    expect(sold).toMatchObject({ apartamentId: f.ap["1"], luna: null, listaId: null, suma: 300, rest: 200 });
    const cash = admin.plati.find((p) => p.id === ids.cash);
    expect(cash).toMatchObject({ metoda: "numerar", suma: 100, inregistrataDe: `Administrator ${f.id}`, alocari: [{ datorieId: sold.id, suma: 100 }] });
    expect(cash.chitanta.numar).toBe(1);
    const transfer = admin.plati.find((p) => p.id === ids.transfer);
    expect(transfer).toMatchObject({ metoda: "transfer", chitanta: null, inregistrataDe: null, alocari: [] });
    expect(admin.situatieBloc).toEqual({ apartamente: 5, faraRestanta: 4, restanteTotal: 200 });
    expect(admin.fonduri.find((x) => x.id === ids.fondRep)).toMatchObject({ sold: 250, sumaPerApartament: null, miscari: [expect.objectContaining({ suma: 250, descriere: "Sold preluat" })] });
    expect(admin.fonduri.find((x) => x.tip === "rulment").sumaPerApartament).toBe(100);
  });

  it("citirile si media de consum a lunii", () => {
    const c = admin.citiri.find((x) => x.apartamentId === f.ap["1"] && x.luna === lunaCurenta());
    expect(c).toMatchObject({ tip: "rece", indexAnterior: 10, indexCurent: 14, consum: 4, sursa: "locatar", stare: "validata", pozaCale: null });
    expect(admin.consumMediu[lunaCurenta()]).toEqual({ rece: 2, calda: null, apartamente: 1 });
    expect(admin.contoare.filter((x) => x.apartamentId === null).map((x) => x.tip).sort()).toEqual(["calda", "rece"]);
  });

  it("sesizarile administratorului: cu numarul apartamentului, mesajele pe autori si pozele", () => {
    const s = admin.sesizari.find((x) => x.id === ids.sLoc1);
    expect(s).toMatchObject({ aMea: false, apartamentNumar: "1", titlu: "Bec ars", descriere: "Bec ars, detalii", stare: "noua" });
    expect(s.mesaje).toEqual([expect.objectContaining({ text: "Venim maine", dinAdministratie: true, autor: `Administrator ${f.id}` })]);
    expect(s.poze).toEqual([expect.objectContaining({ cale: `${f.blocId}/${f.ap["1"]}/sesizare-test.jpg` })]);
    expect(admin.sesizari.map((x) => x.id)).toEqual([ids.sVecin, ids.sLoc1, ids.sMulte, ids.sFost]);
  });

  it("citirea pe pagini: toate cele 1001 mesaje ale unei sesizari, fiecare o data, in ordine", () => {
    const m = admin.sesizari.find((x) => x.id === ids.sMulte).mesaje;
    expect(m).toHaveLength(1001);
    expect(new Set(m.map((x) => x.id)).size).toBe(1001);
    expect(m[0].text).toBe("mesaj 0001");
    expect(m[1000].text).toBe("mesaj 1001");
  });

  it("anunturile: cele ale blocului si ale asociatiei, cu cititorii dintre locatarii activi", () => {
    expect(admin.anunturi.map((a) => a.id).sort()).toEqual([ids.aAsoc, ids.aBloc].sort());
    const bloc = admin.anunturi.find((a) => a.id === ids.aBloc);
    expect(bloc).toMatchObject({ autor: null, citit: false, cititori: 1, totalLocatari: 3, urgent: false });
    expect(admin.anunturi.find((a) => a.id === ids.aAsoc)).toMatchObject({ autor: `Administrator ${f.id}`, cititori: 1 });
    expect(loc1.anunturi.find((a) => a.id === ids.aBloc)).toMatchObject({ citit: true, cititori: null, totalLocatari: null });
    expect(loc1.anunturi.find((a) => a.id === ids.aAsoc).citit).toBe(false);
  });

  it("documentele: fara cele ale altui bloc; cel ascuns doar pentru conducere", () => {
    expect(admin.documente.map((d) => d.id).sort()).toEqual([ids.dAsoc, ids.dBloc, ids.dAscuns].sort());
    expect(admin.documente.find((d) => d.id === ids.dAscuns)).toMatchObject({ vizibil: false, tip: "altul" });
    expect(loc1.documente.map((d) => d.id).sort()).toEqual([ids.dAsoc, ids.dBloc].sort());
  });

  it("votul: numerele sunt numere; nevotatele doar pentru conducere; votul meu", () => {
    const v = admin.voturi.find((x) => x.id === ids.vot);
    expect(v).toMatchObject({ votanti: 1, totalApartamente: 5, nevotate: ["2", "2A", "3", "10"], votulMeu: null });
    expect(v.optiuni).toEqual([
      expect.objectContaining({ text: "Da", voturi: 1, cote: 20 }), expect.objectContaining({ text: "Nu", voturi: 0, cote: 0 }),
    ]);
    const vl = loc1.voturi.find((x) => x.id === ids.vot);
    expect(vl).toMatchObject({ nevotate: null, votulMeu: ids.optDa });
    expect(loc1.adunari.find((a) => a.id === ids.adunare)).toMatchObject({ prezente: 1, totalApartamente: 5, prezentaMea: true });
  });

  it("[P1] eu.calitate reflecta legatura proprie a locatarului cu apartamentul, dar nu apare la administrator", async () => {
    expect(loc1.eu.calitate).toBe("proprietar");
    expect(admin.eu.calitate).toBeUndefined();
    const chirias = (await intraCa(f.conturi.viitor.telefon)).date;
    expect(chirias.eu).toMatchObject({ rol: "locatar", apartamentId: f.ap["2A"], calitate: "chirias" });
  });

  it("locatarul: apartamentul lui, sesizarile altora anonime, notificarile lui", () => {
    expect(loc1.eu).toMatchObject({ rol: "locatar", apartamentId: f.ap["1"] });
    expect(loc1.apartamente.map((a) => a.numar)).toEqual(["1"]);
    expect(loc1.apartamente[0].locatari).toEqual([]);
    const vecin = loc1.sesizari.find((s) => s.id === ids.sVecin);
    expect(vecin).toEqual({
      id: ids.sVecin, aMea: false, titlu: "Usa scartaie", categorie: "altele", stare: "noua", creataLa: expect.any(String), preluataLa: null,
      rezolvataLa: null, descriere: null, apartamentId: null, apartamentNumar: null, mesaje: [], poze: [],
    });
    expect(loc1.sesizari.find((s) => s.id === ids.sLoc1)).toMatchObject({ aMea: true, apartamentNumar: "1" });
    expect(loc1.notificari.find((n) => n.id === ids.notificare)).toEqual({ id: ids.notificare, tip: "anunt", titlu: "Salut", corp: "Bun venit", trimisaLa: expect.any(String), cititaLa: null });
    expect(loc1.plati.find((p) => p.id === ids.cash).inregistrataDe).toBe(`Administrator ${f.id}`);
  });

  /* Presedintele are acum rolul lui: vede blocul intreg, ca sa-l poata
     verifica, iar apartamentul lui il gaseste in lista, ca pe oricare altul. */
  it("[S2] presedintele care locuieste in bloc vede blocul, cu rolul lui", () => {
    expect(pres.eu.rol).toBe("presedinte");
    expect(pres.apartamente.length).toBeGreaterThan(1);
    expect(pres.conducere.some((m) => m.profilId === pres.eu.profilId && m.rol === "presedinte")).toBe(true);
  });

  it("[S2] presedintele care locuieste in bloc nu vede sesizarile de doua ori", () => {
    const idsS = pres.sesizari.map((s) => s.id);
    expect(new Set(idsS).size).toBe(idsS.length);
  });

  it("[K4] locatarul nou nu vede sesizarile si mesajele fostului locatar", () => {
    expect(loc1.sesizari.map((s) => s.id)).not.toContain(ids.sFost);
  });

  it("[S10] fiecare citire pe pagini cere o ordine stabila (altfel randurile se pot pierde sau dubla)", async () => {
    const cereri = [];
    const { s } = await intraCa(f.adminTelefon, { incarca: false });
    await cuFetch((url) => { if (url.includes("limit=1000")) cereri.push(decodeURIComponent(url)); }, () => s.incarca());
    expect(cereri.length).toBeGreaterThan(10);
    expect(cereri.filter((u) => !/[?&]order=/.test(u))).toEqual([]);
  });

  it("raspuns sintetic: un apartament lipsa din lista nu strica sesizarea", async () => {
    const { s } = await intraCa(f.adminTelefon, { incarca: false });
    const date = await cuFetch(modifica("/rest/v1/apartamente?", (rows) => rows.filter((a) => a.numar !== "10")), () => s.incarca());
    expect(date.apartamente.map((a) => a.numar).sort()).toEqual(["1", "2", "2A", "3"]);
    expect(date.sesizari.find((x) => x.id === ids.sMulte).apartamentNumar).toBeUndefined();
  });

  it("raspuns sintetic: un locatar fara profil vizibil apare ca \"Locatar\"", async () => {
    const { s } = await intraCa(f.adminTelefon, { incarca: false });
    const date = await cuFetch(modifica("/rest/v1/profiluri?", (rows) => rows.filter((p) => p.id !== f.conturi.loc1.id && p.id !== f.conturi.pres.id)), () => s.incarca());
    const l = date.apartamente.find((a) => a.numar === "1").locatari.find((x) => x.id === f.locatari.loc1);
    expect(l).toMatchObject({ nume: "Locatar", telefon: undefined });
    /* acelasi lucru pentru mandatul al carui profil nu se vede */
    expect(date.conducere.find((m) => m.profilId === f.conturi.pres.id)).toMatchObject({ nume: "Persoana", telefon: null });
  });
});

describe("asociatie fara setari salvate", () => {
  it("foloseste valorile implicite: 0,02% pe zi, 30 de zile de gratie, scadenta pe 25", async () => {
    const f = await creeazaBloc({ apartamente: [{ numar: "1", etaj: 0, persoane: 1, cota: 100, index_rece: 1, index_calda: 1 }] });
    await ok(db("financiar").from("setari_financiare").delete().eq("asociatie_id", f.asociatieId));
    await ok(db("contorizare").from("setari_contorizare").delete().eq("bloc_id", f.blocId));
    const { date } = await intraCa(f.adminTelefon);
    expect(date.setari).toEqual({ procentPenalizareZi: 0.02, zileGratie: 30, ziScadenta: 25, chitantaSerie: "", ziLimitaCitire: 25 });
  });
});

/* [P5] identitate.eu() alege un singur apartament, determinist, dar acelasi
   om poate fi legat de mai multe apartamente ale aceluiasi bloc (proprietar
   la unul, chirias la altul). Fara nimic in plus, celalalt apartament era
   invizibil de tot: nici in eu(), nici in datele filtrate de alMeu(). */
describe("[P5] un locatar legat de doua apartamente in acelasi bloc", () => {
  let f;
  let s;
  let ap1;
  let ap2;
  const an = new Date().getUTCFullYear();

  beforeAll(async () => {
    f = await creeazaBloc({
      apartamente: [
        { numar: "1", etaj: 0, persoane: 2, cota: 50, index_rece: 10, index_calda: 5 },
        { numar: "2", etaj: 1, persoane: 1, cota: 50, index_rece: 20, index_calda: 8 },
      ],
      locatari: [{ cheie: "dubla", apartament: "1", activDin: `${an - 1}-01-01` }],
    });
    ap1 = f.ap["1"];
    ap2 = f.ap["2"];
    /* A doua legatura, in acelasi bloc, pe acelasi profil, activa mai
       recent: identitate.eu() alege apartamentul cu activ_din mai vechi,
       deci ap1 ramane implicit. */
    await ok(db("identitate").from("locatari").insert({
      apartament_id: ap2, bloc_id: f.blocId, profil_id: f.conturi.dubla.id, calitate: "chirias", activ_din: `${an - 1}-02-01`, activ_pana: null,
    }));
    ({ s } = await intraCa(f.conturi.dubla.telefon));
  });

  it("eu.apartamenteMele contine ambele apartamente, iar eu.apartamentId ramane cel implicit (ap1)", async () => {
    const date = await s.incarca();
    expect(date.eu.rol).toBe("locatar");
    expect(date.eu.apartamentId).toBe(ap1);
    expect([...date.eu.apartamenteMele].sort()).toEqual([ap1, ap2].sort());
  });

  it("datele celuilalt apartament (citirile de pornire) sunt deja incarcate, nu doar cele ale apartamentului implicit", async () => {
    const date = await s.incarca();
    const apCuCitiri = new Set(date.citiri.map((c) => c.apartamentId));
    expect(apCuCitiri.has(ap1)).toBe(true);
    expect(apCuCitiri.has(ap2)).toBe(true);
  });

  it("incarca(apartamentAles) muta apartamentul activ pe al doilea, fara sa piarda datele primului", async () => {
    const date = await s.incarca(ap2);
    expect(date.eu.apartamentId).toBe(ap2);
    const apCuCitiri = new Set(date.citiri.map((c) => c.apartamentId));
    expect(apCuCitiri.has(ap1)).toBe(true);
    expect(apCuCitiri.has(ap2)).toBe(true);
  });

  it("un apartament strain este ignorat: ramane cel implicit", async () => {
    const date = await s.incarca(f.blocId);
    expect(date.eu.apartamentId).toBe(ap1);
  });
});
