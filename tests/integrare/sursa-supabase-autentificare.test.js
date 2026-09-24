/* Autentificarea si accesul (harta-functii §2): intrarea cu numarul de
   telefon, iesirea si contul pe care administratorul il face unui locatar.
   Conturile se creeaza la fiecare rulare, pe numere unice. */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  ANON_LOCAL, PAROLA_TEST, URL_LOCAL, creeazaBloc, creeazaCont, db, intraCa, lunaCurenta, ok, pdf, pozaJpeg, serviciu, sursaNoua, telefonDeTest,
} from "./fixture.js";

const D14_ADMIN = "0745 210 118";
const D14_NEVERIFICAT = "0755 900 800";

let f;
let admin;

beforeAll(async () => {
  f = await creeazaBloc();
  admin = (await intraCa(f.adminTelefon)).s;
});

describe("sesiunea", () => {
  it("fara intrare nu exista sesiune, iar incarca() intoarce null", async () => {
    const s = sursaNoua();
    expect(s.tip).toBe("supabase");
    expect(await s.sesiuneCurenta()).toBeNull();
    expect(await s.incarca()).toBeNull();
  });

  it("intra() cu numarul si parola corecte deschide sesiunea contului", async () => {
    const s = sursaNoua();
    const profil = await ok(db("identitate").from("profiluri").select("id").eq("telefon", "0745210118").single());
    /* numarul scris cu spatii, cu prefixul tarii sau lipit: acelasi om */
    for (const scris of [D14_ADMIN, "0745210118", "+40745210118"]) {
      const r = await s.intra(scris, PAROLA_TEST);
      expect(r).toEqual({ profilId: profil.id });
    }
    expect(await s.sesiuneCurenta()).toEqual({ profilId: profil.id });
  });

  it("intra() cu parola gresita sau cu un numar necunoscut spune acelasi lucru", async () => {
    const mesaj = "Numarul de telefon sau parola nu sunt corecte.";
    await expect(sursaNoua().intra(D14_ADMIN, "parola-gresita")).rejects.toThrow(mesaj);
    await expect(sursaNoua().intra(telefonDeTest(), PAROLA_TEST)).rejects.toThrow(mesaj);
  });

  /* [A1] Contul il face administratorul, niciodata omul. Cat timp inscrierea
     prin API era deschisa, oricine putea sa-si faca singur cont pe adresa
     interna a unui numar care nu este al lui ("0722..."@telefon.adminbloc.invalid)
     si sa astepte: cand administratorul adauga acel numar in bloc,
     cont-locatar gaseste profilul gata facut si ii leaga apartamentul. */
  it("[A1] nimeni nu-si face singur cont: inscrierea prin API este inchisa", async () => {
    const numar = telefonDeTest();
    const anonim = createClient(URL_LOCAL, ANON_LOCAL, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anonim.auth.signUp({
      email: `${numar}@telefon.adminbloc.invalid`,
      password: PAROLA_TEST,
      options: { data: { nume: "Cineva din afara", telefon: numar } },
    });
    expect(error, "inscrierea prin API trebuie refuzata").toBeTruthy();
    expect(data.user).toBeNull();
    const { count } = await db("identitate").from("profiluri")
      .select("id", { count: "exact", head: true }).eq("telefon", numar);
    expect(count, "numarul a ramas liber pentru administrator").toBe(0);
  });

  it("intra() cu ceva ce nu e numar de telefon nu ajunge la server", async () => {
    await expect(sursaNoua().intra("elena@adminbloc.test", PAROLA_TEST))
      .rejects.toThrow("Numarul de telefon sau parola nu sunt corecte.");
  });

  it("iesi() inchide sesiunea si uita contextul, deci comenzile cer autentificare", async () => {
    const { s } = await intraCa(f.adminTelefon);
    await s.iesi();
    expect(await s.sesiuneCurenta()).toBeNull();
    expect(await s.incarca()).toBeNull();
    expect(() => s.deschideLista(lunaCurenta())).toThrow("Nu esti autentificat.");
  });

  it("o comanda de administrator inainte de prima incarcare cere autentificare", async () => {
    const { s } = await intraCa(f.adminTelefon, { incarca: false });
    await expect(s.transmiteCitire({ apartamentId: f.ap["1"], luna: lunaCurenta(), indexuri: [] })).rejects.toThrow("Nu esti autentificat.");
    expect(() => s.publicaAnunt({ titlu: "x", corp: "y" })).toThrow("Nu esti autentificat.");
  });
});

describe("rolul decis de identitate.eu()", () => {
  it("contul fara apartament primeste doar rolul, fara datele vreunui bloc", async () => {
    const { date } = await intraCa(D14_NEVERIFICAT);
    const profil = await ok(db("identitate").from("profiluri").select("*").eq("telefon", "0755900800").single());
    expect(Object.keys(date).sort()).toEqual(["azi", "eu"]);
    expect(date.eu).toEqual({
      profilId: profil.id, nume: profil.nume, telefon: profil.telefon, rol: "in_asteptare", apartamentId: null,
    });
    expect(date.azi).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("adaugaLocatar(): contul il face administratorul", () => {
  it("contul nou intra imediat cu numarul si parola primite", async () => {
    const telefon = telefonDeTest();
    const r = await admin.adaugaLocatar(f.ap["2"], { nume: "  Chirias Nou ", telefon, calitate: "chirias" });
    expect(r).toMatchObject({ telefon, parola: expect.stringMatching(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/) });

    const legatura = await ok(db("identitate").from("locatari").select("*").eq("id", r.locatar_id).single());
    expect(legatura).toMatchObject({ apartament_id: f.ap["2"], bloc_id: f.blocId, calitate: "chirias", activ_pana: null });
    const profil = await ok(db("identitate").from("profiluri").select("*").eq("id", r.profil_id).single());
    expect(profil).toMatchObject({ nume: "Chirias Nou", telefon });

    const s = sursaNoua();
    await s.intra(telefon, r.parola);
    const date = await s.incarca();
    expect(date.eu).toMatchObject({ rol: "locatar", apartamentId: f.ap["2"], telefon });
  });

  it("fara calitate ceruta, omul este proprietar", async () => {
    const r = await admin.adaugaLocatar(f.ap["2A"], { nume: "Proprietar Nou", telefon: telefonDeTest() });
    const legatura = await ok(db("identitate").from("locatari").select("calitate").eq("id", r.locatar_id).single());
    expect(legatura.calitate).toBe("proprietar");
  });

  it("[P1/P5] acelasi numar, al doilea apartament: contul se leaga, fara parola noua", async () => {
    const telefon = telefonDeTest();
    const intai = await admin.adaugaLocatar(f.ap["1"], { nume: "Doua Apartamente", telefon });
    const apoi = await admin.adaugaLocatar(f.ap["10"], { nume: "Doua Apartamente", telefon });
    expect(apoi.parola).toBeNull();
    expect(apoi.profil_id).toBe(intai.profil_id);

    const s = sursaNoua();
    await s.intra(telefon, intai.parola);
    const date = await s.incarca();
    expect(date.apartamente.map((a) => a.id).sort()).toEqual([f.ap["1"], f.ap["10"]].sort());
  });

  it("acelasi apartament de doua ori, numarul gresit si numele lipsa sunt refuzate", async () => {
    const telefon = telefonDeTest();
    await admin.adaugaLocatar(f.ap["2"], { nume: "Unul", telefon });
    await expect(admin.adaugaLocatar(f.ap["2"], { nume: "Unul", telefon }))
      .rejects.toThrow("Contul este deja legat de acest apartament.");
    await expect(admin.adaugaLocatar(f.ap["2"], { nume: "Altul", telefon: "0722" }))
      .rejects.toThrow("Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx.");
    await expect(admin.adaugaLocatar(f.ap["2"], { nume: "  ", telefon: telefonDeTest() }))
      .rejects.toThrow("Scrie numele locatarului.");
  });

  /* [A4] Parola noua se da cuiva care si-a uitat-o, sau cand banuiesti ca a
     ajuns pe mana cui nu trebuie. Pana la auditul 4, sesiunile deschise
     ramaneau deschise, iar un acces inchis putea primi oricand alta parola. */
  it("[A4] parola noua inchide sesiunile deschise si refuza un acces inchis", async () => {
    const telefon = telefonDeTest();
    const cont = await admin.adaugaLocatar(f.ap["2"], { nume: "Uituc Nou", telefon });
    const alLui = createClient(URL_LOCAL, ANON_LOCAL, { auth: { persistSession: false, autoRefreshToken: false } });
    const intrare = await alLui.auth.signInWithPassword({ email: `${telefon}@telefon.adminbloc.invalid`, password: cont.parola });
    expect(intrare.error).toBeNull();

    await admin.parolaNoua(f.ap["2"], cont.locatar_id);
    /* tokenul din mana ii mai tine o ora, dar sesiunea nu se mai poate
       reimprospata: la prima reintrare in aplicatie, omul este afara */
    const reimprospatare = await alLui.auth.refreshSession();
    expect(reimprospatare.error, "sesiunea veche nu are voie sa se reimprospateze").toBeTruthy();

    await admin.inchideAcces(cont.locatar_id);
    await expect(admin.parolaNoua(f.ap["2"], cont.locatar_id))
      .rejects.toThrow("Locatarul nu mai are acces la acest apartament.");
  });

  it("apartamentul altui bloc este refuzat, oricine ar cere", async () => {
    const altul = await creeazaBloc();
    await expect(admin.adaugaLocatar(altul.ap["1"], { nume: "X", telefon: telefonDeTest() }))
      .rejects.toThrow("Doar administratorul blocului poate face conturi.");
  });

  it("parolaNoua() inlocuieste parola, doar pentru un locatar al apartamentului", async () => {
    const telefon = telefonDeTest();
    const cont = await admin.adaugaLocatar(f.ap["2A"], { nume: "Uituc", telefon });
    const noua = await admin.parolaNoua(f.ap["2A"], cont.locatar_id);
    expect(noua.parola).not.toBe(cont.parola);

    await expect(sursaNoua().intra(telefon, cont.parola)).rejects.toThrow("Numarul de telefon sau parola nu sunt corecte.");
    const s = sursaNoua();
    await s.intra(telefon, noua.parola);
    expect((await s.incarca()).eu.nume).toBe("Uituc");

    await expect(admin.parolaNoua(f.ap["1"], cont.locatar_id)).rejects.toThrow("Locatarul nu este al acestui apartament.");
  });

  it("[S11] accesul inchis azi unui cont legat azi se inchide imediat", async () => {
    const telefon = telefonDeTest();
    const cont = await admin.adaugaLocatar(f.ap["10"], { nume: "Vanzator", telefon });
    const s = sursaNoua();
    await s.intra(telefon, cont.parola);
    await admin.inchideAcces(cont.locatar_id);
    const date = await s.incarca();
    expect(date.eu.rol).toBe("fara_apartament");
  });
});

describe("cazuri de margine ale maparii", () => {
  /* [K21] Un administrator respins de noi trebuie sa afle de ce: identitate.eu()
     trimite motivul, iar sursa il duce mai departe catre ecran. */
  it("[K21] contul respins primeste motivul respingerii", async () => {
    const cont = await creeazaCont({ nume: "Respins de noi" });
    await ok(serviciu.schema("identitate").from("administratori").insert({ profil_id: cont.id, numar_atestat: "AT-X" }), "administrator");
    await ok(serviciu.schema("identitate").rpc("verifica_administrator", {
      p_profil_id: cont.id, p_aprobat: false, p_motiv: "Atestatul din poza nu se poate citi.",
    }), "respingere");
    const { date } = await intraCa(cont.telefon);
    expect(date.eu).toMatchObject({ rol: "respins", motivRespingere: "Atestatul din poza nu se poate citi." });
  });

  it("un fisier PDF fara extensie in nume urca tot ca .pdf", async () => {
    const titlu = `Scanare fara extensie ${telefonDeTest()}`;
    await admin.incarcaDocument({ titlu, tip: "altul", fisier: pdf("scanare-fara-extensie") });
    const rand = await ok(db("comunicare").from("documente").select("cale").eq("titlu", titlu).single());
    expect(rand.cale.endsWith(".pdf")).toBe(true);

    /* o poza fara extensie in nume urca drept .jpg */
    const titluPoza = `Poza fara extensie ${telefonDeTest()}`;
    await admin.incarcaDocument({ titlu: titluPoza, tip: "altul", fisier: pozaJpeg("scanare") });
    const randPoza = await ok(db("comunicare").from("documente").select("cale").eq("titlu", titluPoza).single());
    expect(randPoza.cale.endsWith(".jpg")).toBe(true);
  });
});

describe("conducerea asociatiei", () => {
  it("administratorul numeste un locatar presedinte, iar el vede blocul fara sa scrie", async () => {
    const telefon = telefonDeTest();
    const cont = await admin.adaugaLocatar(f.ap["1"], { nume: "Presedinte Ales", telefon });
    const mandat = await admin.numesteInConducere(cont.profil_id, "presedinte");
    expect(mandat).toEqual(expect.any(String));

    /* alt locatar, alt apartament, scrie o sesizare: pe aceea presedintele nu
       are voie sa o vada cu nume si cu text */
    const telefonVecin = telefonDeTest();
    const vecin = await admin.adaugaLocatar(f.ap["10"], { nume: "Vecinul De Sus", telefon: telefonVecin });
    const sursaVecin = sursaNoua();
    await sursaVecin.intra(telefonVecin, vecin.parola);
    await sursaVecin.incarca();
    const sesizareId = await sursaVecin.adaugaSesizare({
      apartamentId: f.ap["10"], titlu: "Usa de la intrare", categorie: "acces", descriere: "Nu se inchide singura",
    });

    const s = sursaNoua();
    await s.intra(telefon, cont.parola);
    const date = await s.incarca();
    expect(date.eu.rol).toBe("presedinte");
    /* vede blocul intreg, ca administratorul */
    expect(date.apartamente.length).toBeGreaterThan(1);
    /* [C1] dar sesizarile raman intre locatar si administrator (H11): le vede
       anonim, ca orice locatar, nu goale si nu cu text si poze cu tot */
    const anonima = date.sesizari.find((x) => x.id === sesizareId);
    expect(anonima, "ecranul Sesizari nu are voie sa fie gol pentru presedinte").toBeTruthy();
    expect(anonima).toMatchObject({ titlu: "Usa de la intrare", apartamentNumar: null, descriere: null, mesaje: [], poze: [] });
    expect(date.conducere.some((m) => m.profilId === cont.profil_id && m.rol === "presedinte")).toBe(true);
    /* dar nu scrie: comenzile cer blocul administrat */
    await expect(s.deschideLista(lunaCurenta())).rejects.toThrow();
    await expect(s.numesteInConducere(cont.profil_id, "cenzor"))
      .rejects.toThrow("Doar administratorul asociatiei numeste presedintele si cenzorul.");
  });

  it("un cenzor din afara blocului primeste cont si mandat dintr-o singura comanda", async () => {
    const telefon = telefonDeTest();
    const r = await admin.adaugaInConducere("Contabil Extern", telefon, "cenzor");
    expect(r).toMatchObject({ telefon, parola: expect.stringMatching(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/) });

    const s = sursaNoua();
    await s.intra(telefon, r.parola);
    const date = await s.incarca();
    expect(date.eu.rol).toBe("cenzor");
    expect(date.eu.apartamentId).toBeNull();
    expect(date.apartamente.length).toBeGreaterThan(1);
  });

  it("mandatul se incheie, iar omul ramane in istoric fara sa mai vada blocul", async () => {
    const telefon = telefonDeTest();
    const r = await admin.adaugaInConducere("Cenzor Schimbat", telefon, "cenzor");
    const date = await admin.incarca();
    const mandat = date.conducere.find((m) => m.profilId === r.profil_id);
    expect(mandat).toMatchObject({ rol: "cenzor", activPana: null });

    await admin.incheieMandat(mandat.id);
    const dupa = await admin.incarca();
    expect(dupa.conducere.find((m) => m.id === mandat.id).activPana).not.toBeNull();
    /* [C6] Drepturile se sting in ziua incheierii, nu a doua zi: altfel cine a
       fost numit din greseala mai vede tot blocul pana la miezul noptii. */
    const s = sursaNoua();
    await s.intra(telefon, r.parola);
    const alLui = await s.incarca();
    expect(alLui.eu.rol).toBe("fara_apartament");
    expect(alLui.apartamente, "nu mai are niciun apartament de vazut").toBeUndefined();
    await expect(admin.incheieMandat(mandat.id))
      .rejects.toThrow("Mandatul nu exista, s-a incheiat deja sau nu este in asociatia ta.");
  });

  it("mandatul de presedinte nu se da pe alta asociatie", async () => {
    const altul = await creeazaBloc();
    const { s: altAdmin } = await intraCa(altul.adminTelefon);
    const telefon = telefonDeTest();
    const cont = await admin.adaugaLocatar(f.ap["2"], { nume: "Om Al Nostru", telefon });
    /* administratorul celuilalt bloc il numeste: mandatul iese pe asociatia lui,
       nu pe a noastra */
    const mandat = await altAdmin.numesteInConducere(cont.profil_id, "cenzor");
    const date = await admin.incarca();
    expect(date.conducere.some((m) => m.id === mandat)).toBe(false);
  });
});
