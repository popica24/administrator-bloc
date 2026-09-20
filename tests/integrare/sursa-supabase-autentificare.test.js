/* Autentificarea si accesul (harta-functii §2): intrare, iesire, cont nou,
   cod de invitatie, cererea de administrator. Conturile sunt create la fiecare
   rulare, cu emailuri unice. */
import { beforeAll, describe, expect, it } from "vitest";
import {
  PAROLA_TEST, contNou, creeazaBloc, cuFetch, db, intraCa, json, lunaCurenta, ok, pdf, pozaJpeg, serviciu, sursaNoua, unic,
} from "./fixture.js";

const D14_ADMIN = "administrator@adminbloc.test";
const D14_NEVERIFICAT = "admin.nou@adminbloc.test";

let f;
let admin;

beforeAll(async () => {
  f = await creeazaBloc();
  admin = (await intraCa(f.adminEmail)).s;
});

describe("sesiunea", () => {
  it("fara intrare nu exista sesiune, iar incarca() intoarce null", async () => {
    const s = sursaNoua();
    expect(s.tip).toBe("supabase");
    expect(await s.sesiuneCurenta()).toBeNull();
    expect(await s.incarca()).toBeNull();
  });

  it("intra() cu parola corecta deschide sesiunea contului", async () => {
    const s = sursaNoua();
    const profil = await ok(db("identitate").from("profiluri").select("id").eq("email", D14_ADMIN).single());
    const r = await s.intra(D14_ADMIN, PAROLA_TEST);
    expect(r).toEqual({ profilId: profil.id, email: D14_ADMIN });
    expect(await s.sesiuneCurenta()).toEqual({ profilId: profil.id, email: D14_ADMIN });
  });

  it("intra() cu parola gresita spune pe romaneste ce s-a intamplat", async () => {
    await expect(sursaNoua().intra(D14_ADMIN, "parola-gresita")).rejects.toThrow("Emailul sau parola nu sunt corecte.");
  });

  it("intra() inainte de confirmarea emailului spune pe romaneste ce s-a intamplat (C12)", async () => {
    const email = `neconfirmat-${unic()}@adminbloc.test`;
    await ok(serviciu.auth.admin.createUser({ email, password: PAROLA_TEST, email_confirm: false }), "cont neconfirmat");
    await expect(sursaNoua().intra(email, PAROLA_TEST)).rejects.toThrow("Confirma adresa de email inainte sa intri in cont.");
  });

  it("iesi() inchide sesiunea si uita contextul, deci comenzile cer autentificare", async () => {
    const { s } = await intraCa(f.adminEmail);
    await s.iesi();
    expect(await s.sesiuneCurenta()).toBeNull();
    expect(await s.incarca()).toBeNull();
    expect(() => s.deschideLista(lunaCurenta())).toThrow("Nu esti autentificat.");
  });

  it("o comanda de administrator inainte de prima incarcare cere autentificare", async () => {
    const { s } = await intraCa(f.adminEmail, { incarca: false });
    await expect(s.transmiteCitire({ apartamentId: f.ap["1"], luna: lunaCurenta(), indexuri: [] })).rejects.toThrow("Nu esti autentificat.");
    expect(() => s.publicaAnunt({ titlu: "x", corp: "y" })).toThrow("Nu esti autentificat.");
  });
});

describe("rolul decis de identitate.eu()", () => {
  it("administratorul neverificat primeste doar rolul, fara datele vreunui bloc", async () => {
    const { date } = await intraCa(D14_NEVERIFICAT);
    const profil = await ok(db("identitate").from("profiluri").select("*").eq("email", D14_NEVERIFICAT).single());
    expect(Object.keys(date).sort()).toEqual(["azi", "eu"]);
    expect(date.eu).toEqual({
      profilId: profil.id, nume: profil.nume, telefon: profil.telefon, email: D14_NEVERIFICAT, rol: "in_asteptare", apartamentId: null,
    });
    expect(date.azi).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("inregistreaza()", () => {
  it("creeaza contul cu profilul din metadate si cere confirmarea emailului", async () => {
    const email = `nou-${unic()}@adminbloc.test`;
    const s = sursaNoua();
    /* Auth cere confirmarea adresei, deci inregistrarea nu mai deschide sesiune.
       Comanda intoarce null (nu arunca): ecranul de "Confirma adresa de email"
       se decide dupa rezultat, nu dupa o exceptie (C1) */
    await expect(s.inregistreaza({ email, parola: PAROLA_TEST, nume: "Ana Popa", telefon: "0722 000 111" }))
      .resolves.toBeNull();
    const profil = await ok(db("identitate").from("profiluri").select("*").eq("email", email).single());
    expect(profil).toMatchObject({ nume: "Ana Popa", telefon: "0722 000 111", email });
    expect(await s.sesiuneCurenta()).toBeNull();

    /* Dupa confirmare, contul intra si nu are inca apartament */
    await ok(serviciu.auth.admin.updateUserById(profil.id, { email_confirm: true }));
    await s.intra(email, PAROLA_TEST);
    const date = await s.incarca();
    expect(date.eu.rol).toBe("fara_apartament");
    expect(date.bloc).toBeUndefined();
  });

  it("un email deja folosit este refuzat pe romaneste", async () => {
    await expect(sursaNoua().inregistreaza({ email: f.adminEmail, parola: PAROLA_TEST, nume: "X" }))
      .rejects.toThrow("Exista deja un cont cu acest email.");
  });

  it("un dublu-clic pe inregistrare (cerere repetata prea repede) spune pe romaneste ce s-a intamplat (C12)", async () => {
    const email = `dublu-${unic()}@adminbloc.test`;
    await sursaNoua().inregistreaza({ email, parola: PAROLA_TEST, nume: "X" });
    await expect(sursaNoua().inregistreaza({ email, parola: PAROLA_TEST, nume: "X" }))
      .rejects.toThrow("Ai trimis cererea de doua ori prea repede. Mai asteapta putin si incearca din nou.");
  });

  it("o parola prea scurta este refuzata pe romaneste, cu lungimea ceruta de server", async () => {
    await expect(sursaNoua().inregistreaza({ email: `scurt-${unic()}@adminbloc.test`, parola: "Abc123", nume: "X" }))
      .rejects.toThrow("Parola trebuie sa aiba cel putin 10 caractere.");
  });

  it("o parola fara litere mari sau fara cifre este refuzata pe romaneste", async () => {
    await expect(sursaNoua().inregistreaza({ email: `simplu-${unic()}@adminbloc.test`, parola: "abcdefghijk", nume: "X" }))
      .rejects.toThrow("Parola trebuie sa aiba si litere mici, si litere mari, si cifre.");
  });

  it("cand serverul deschide direct sesiunea, contul este gata de folosit", async () => {
    /* Confirmarea emailului este pornita pe stack-ul local, deci raspunsul cu
       sesiune (cum vine cand confirmarea e oprita) se simuleaza aici. */
    const email = `sesiune-${unic()}@adminbloc.test`;
    const utilizator = { id: "00000000-0000-4000-8000-000000000002", aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    const sesiune = { access_token: "fals", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "fals", user: utilizator };
    const s = sursaNoua();
    await cuFetch((url) => (url.includes("/auth/v1/signup") ? json(sesiune) : undefined), async () => {
      expect(await s.inregistreaza({ email, parola: PAROLA_TEST, nume: "Cu Sesiune" }))
        .toEqual({ profilId: utilizator.id, email });
    });
  });

  it("cand serverul cere confirmarea emailului, comanda intoarce null (nu arunca)", async () => {
    const email = `confirmare-${unic()}@adminbloc.test`;
    const utilizator = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    await cuFetch((url) => (url.includes("/auth/v1/signup") ? json(utilizator) : undefined), async () => {
      await expect(sursaNoua().inregistreaza({ email, parola: PAROLA_TEST, nume: "X" })).resolves.toBeNull();
    });
  });
});

describe("folosesteInvitatie()", () => {
  it("leaga contul nou de apartamentul din cod, cu calitatea din invitatie", async () => {
    await admin.incarca();
    const cod = await admin.invitaLocatar(f.ap["2"], "chirias");
    const { s, profilId } = await contNou({ email: `inv-${unic()}@adminbloc.test`, nume: "Chirias Nou" });
    const cont = { profilId };
    const r = await s.folosesteInvitatie(` ${cod.toLowerCase()} `);
    expect(r).toEqual({ apartamentNumar: "2" });
    const legatura = await ok(db("identitate").from("locatari").select("*").eq("profil_id", cont.profilId).single());
    expect(legatura).toMatchObject({ apartament_id: f.ap["2"], bloc_id: f.blocId, calitate: "chirias", activ_pana: null });
    const date = await s.incarca();
    expect(date.eu).toMatchObject({ rol: "locatar", apartamentId: f.ap["2"] });
    const inv = await ok(db("identitate").from("invitatii").select("folosita_de, folosita_la").eq("cod", cod).single());
    expect(inv.folosita_de).toBe(cont.profilId);
    expect(inv.folosita_la).not.toBeNull();
  });

  it("un cod inexistent sau deja folosit este refuzat cu mesajul din backend", async () => {
    const { s } = await contNou({ email: `inv-${unic()}@adminbloc.test`, nume: "X" });
    await expect(s.folosesteInvitatie("ZZZZZZZZ")).rejects.toThrow("Codul nu este valabil. Cere administratorului un cod nou.");
  });

  it("dupa cinci coduri gresite, contul este oprit un sfert de ora (X07)", async () => {
    await admin.incarca();
    const cod = await admin.invitaLocatar(f.ap["2A"], "chirias");
    const { s } = await contNou({ email: `x07-${unic()}@adminbloc.test`, nume: "Robot" });
    for (let i = 0; i < 5; i += 1) {
      await expect(s.folosesteInvitatie(`ZZZZZZZ${"ABCDE"[i]}`)).rejects.toThrow("Codul nu este valabil. Cere administratorului un cod nou.");
    }
    await expect(s.folosesteInvitatie("ZZZZZZZF"))
      .rejects.toThrow("Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.");
    await expect(s.folosesteInvitatie(cod))
      .rejects.toThrow("Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.");

    /* Limita este pe cont: altcineva foloseste acelasi cod imediat */
    const { s: s2 } = await contNou({ email: `x07b-${unic()}@adminbloc.test`, nume: "Om" });
    expect(await s2.folosesteInvitatie(cod)).toEqual({ apartamentNumar: "2A" });
  });

  it("[S11] accesul inchis azi unui cont legat azi se inchide imediat", async () => {
    await admin.incarca();
    const cod = await admin.invitaLocatar(f.ap["10"], "proprietar");
    const { s, profilId } = await contNou({ email: `s11-${unic()}@adminbloc.test`, nume: "Vanzator" });
    const cont = { profilId };
    await s.folosesteInvitatie(cod);
    const legatura = await ok(db("identitate").from("locatari").select("id").eq("profil_id", cont.profilId).single());
    await admin.inchideAcces(legatura.id);
    const date = await s.incarca();
    expect(date.eu.rol).toBe("fara_apartament");
  });
});

describe("cereVerificareAdministrator()", () => {
  it("fara atestat: cererea ramane in asteptare, fara fisier", async () => {
    const { s, profilId } = await contNou({ email: `adm-${unic()}@adminbloc.test`, nume: "Admin Nou" });
    const cont = { profilId };
    await s.cereVerificareAdministrator({ numarAtestat: " AT-123 ", fisier: null });
    const rand = await ok(db("identitate").from("administratori").select("*").eq("profil_id", cont.profilId).single());
    expect(rand).toMatchObject({ numar_atestat: "AT-123", atestat_cale: null, stare: "in_asteptare" });
    const date = await s.incarca();
    expect(date).toEqual({ azi: date.azi, eu: expect.objectContaining({ rol: "in_asteptare", apartamentId: null }) });
  });

  it("cu atestat PDF: fisierul urca in atestate/<profil>/ si calea ajunge in cerere", async () => {
    const { s, profilId } = await contNou({ email: `adm-${unic()}@adminbloc.test`, nume: "Admin Pdf" });
    const cont = { profilId };
    await s.cereVerificareAdministrator({ numarAtestat: "AT-9", fisier: pdf("Atestat.PDF") });
    const rand = await ok(db("identitate").from("administratori").select("atestat_cale").eq("profil_id", cont.profilId).single());
    expect(rand.atestat_cale).toMatch(new RegExp(`^${cont.profilId}/atestat-\\d+\\.pdf$`));
    const { data, error } = await serviciu.storage.from("atestate").download(rand.atestat_cale);
    expect(error).toBeNull();
    expect((await data.text()).startsWith("%PDF")).toBe(true);
  });

  it("extensia fisierului: din tipul PDF cand fisierul nu are nume, altfel jpg", async () => {
    const { s, profilId } = await contNou({ email: `adm-${unic()}@adminbloc.test`, nume: "Admin Blob" });
    const cont = { profilId };
    await s.cereVerificareAdministrator({ numarAtestat: "AT-1", fisier: new Blob(["%PDF-1.4"], { type: "application/pdf" }) });
    let rand = await ok(db("identitate").from("administratori").select("atestat_cale").eq("profil_id", cont.profilId).single());
    expect(rand.atestat_cale).toMatch(/\.pdf$/);
    const poza = pozaJpeg();
    await s.cereVerificareAdministrator({ numarAtestat: "AT-1", fisier: new Blob([await poza.arrayBuffer()], { type: "image/jpeg" }) });
    rand = await ok(db("identitate").from("administratori").select("atestat_cale").eq("profil_id", cont.profilId).single());
    expect(rand.atestat_cale).toMatch(/\.jpg$/);
    await s.cereVerificareAdministrator({ numarAtestat: "AT-1", fisier: pozaJpeg("fara-extensie") });
    rand = await ok(db("identitate").from("administratori").select("atestat_cale").eq("profil_id", cont.profilId).single());
    expect(rand.atestat_cale).toMatch(/\.jpg$/);
  });

  it("numarul atestatului lipsa este refuzat de backend", async () => {
    const { s } = await contNou({ email: `adm-${unic()}@adminbloc.test`, nume: "Admin Gol" });
    await expect(s.cereVerificareAdministrator({ numarAtestat: "  " })).rejects.toThrow("Scrie numarul atestatului.");
  });

  it.fails("[NOU-1] fara sesiune, cererea cu atestat spune ca nu esti autentificat (nu TypeError)", async () => {
    await expect(sursaNoua().cereVerificareAdministrator({ numarAtestat: "AT-1", fisier: pdf() })).rejects.toThrow("Nu esti autentificat.");
  });
});
