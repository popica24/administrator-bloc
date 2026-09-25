/* Comenzile administratorului (harta-functii §4, §11), pe un bloc nou la
   fiecare rulare: lista lunii de la deschidere la publicare (facturi, citiri,
   motor, Edge Function publica-lista), bani, oameni, sesizari, comunicare si
   guvernanta. Testele din fisier ruleaza in ordine si continua acelasi flux. */
import { beforeAll, describe, expect, it } from "vitest";
import { PORNIRE_GENERAL, creeazaBloc, cuFetch, db, intraCa, json, lunaCurenta, lunaDelta, ok, oraSeriiRomania, pdf, serviciu, unic, zi1 } from "./fixture.js";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const suma = (xs) => round2(xs.reduce((s, x) => s + Number(x), 0));
const luna = lunaCurenta();

let f;
let adm;
let loc;
let loc2;
let listaId;
const st = {};

beforeAll(async () => {
  f = await creeazaBloc({
    locatari: [{ cheie: "loc", apartament: "1" }, { cheie: "loc2", apartament: "2" }],
  });
  await ok(db("intretinere").from("cheltuieli_recurente").insert({
    bloc_id: f.blocId, tip: "fond_reparatii", cod: "C9", categorie: "Fond de reparatii", suma: 100, metoda: "cota", hotarare: "Hotarare AG test",
  }));
  st.salubris = await ok(db("intretinere").from("furnizori").insert({
    asociatie_id: f.asociatieId, denumire: "Salubris Test", metoda_implicita: "persoane", cod_implicit: "C2",
  }).select().single());
  adm = (await intraCa(f.adminTelefon)).s;
  loc = (await intraCa(f.conturi.loc.telefon)).s;
  loc2 = (await intraCa(f.conturi.loc2.telefon)).s;
});

describe("lista lunii: facturi", () => {
  it("deschideLista() creeaza ciorna cu randul recurent al fondului; a doua oara intoarce aceeasi lista", async () => {
    listaId = await adm.deschideLista(luna);
    const l = await ok(db("intretinere").from("liste_lunare").select("*").eq("id", listaId).single());
    expect(l).toMatchObject({ bloc_id: f.blocId, luna: zi1(luna), stare: "ciorna", versiune: 1 });
    const ch = await ok(db("intretinere").from("cheltuieli").select("*").eq("lista_id", listaId));
    expect(ch).toEqual([expect.objectContaining({ tip: "fond_reparatii", cod: "C9", suma: 100, metoda: "cota", furnizor_id: null, serie_numar: "Hotarare AG test" })]);
    expect(await adm.deschideLista(luna)).toBe(listaId);
  });

  it("salveazaCheltuiala() cu furnizor existent: factura, fara tip de apa cand nu e pe consum", async () => {
    st.c2 = await adm.salveazaCheltuiala({
      listaId, furnizorId: st.salubris.id, categorie: "Salubritate", cod: "C2", suma: 200, metoda: "persoane", tipApa: "rece",
      serie: "S-1", emisa: `${luna}-02`, scadentaFurnizor: `${luna}-20`,
    });
    const r = await ok(db("intretinere").from("cheltuieli").select("*").eq("id", st.c2).single());
    expect(r).toMatchObject({
      lista_id: listaId, tip: "factura", cod: "C2", categorie: "Salubritate", furnizor_id: st.salubris.id, serie_numar: "S-1", suma: 200,
      metoda: "persoane", tip_apa: null, data_emitere: `${luna}-02`, scadenta_furnizor: `${luna}-20`, document_id: null,
    });
  });

  it("salveazaCheltuiala() cu furnizor nou si factura scanata: furnizorul, documentul si randul pe consum", async () => {
    st.c1 = await adm.salveazaCheltuiala({
      listaId, furnizorNou: "  Apa Nova Test  ", categorie: "Apa rece", cod: "C1", suma: 300, metoda: "consum", tipApa: "rece",
      serie: "AN-77", fisier: pdf("factura.pdf"),
    });
    const r = await ok(db("intretinere").from("cheltuieli").select("*").eq("id", st.c1).single());
    const fz = await ok(db("intretinere").from("furnizori").select("*").eq("id", r.furnizor_id).single());
    expect(fz).toMatchObject({ asociatie_id: f.asociatieId, denumire: "Apa Nova Test", categorie_implicita: "Apa rece", metoda_implicita: "consum", tip_apa_implicit: "rece", cod_implicit: "C1" });
    expect(r).toMatchObject({ tip_apa: "rece", serie_numar: "AN-77", data_emitere: null, scadenta_furnizor: null });
    const doc = await ok(db("comunicare").from("documente").select("*").eq("id", r.document_id).single());
    expect(doc).toMatchObject({ titlu: "Factura AN-77", tip: "factura", asociatie_id: f.asociatieId, bloc_id: f.blocId, vizibil_locatarilor: true, incarcat_de: f.adminId });
    expect(doc.cale).toMatch(new RegExp(`^${f.asociatieId}/${f.blocId}/\\d+-[a-z0-9]+\\.pdf$`));
    const { error } = await serviciu.storage.from("documente").download(doc.cale);
    expect(error).toBeNull();
  });

  it("salveazaCheltuiala() cu id modifica randul; un scan nou fara serie se numeste \"Factura\"", async () => {
    const id = await adm.salveazaCheltuiala({
      id: st.c2, listaId, furnizorId: st.salubris.id, categorie: "Salubritate", cod: "C2", suma: 210.5, metoda: "persoane", fisier: pdf("scan"),
    });
    expect(id).toBe(st.c2);
    const r = await ok(db("intretinere").from("cheltuieli").select("*").eq("id", st.c2).single());
    expect(r).toMatchObject({ suma: 210.5, serie_numar: null, data_emitere: null });
    const doc = await ok(db("comunicare").from("documente").select("titlu, cale").eq("id", r.document_id).single());
    expect(doc.titlu).toBe("Factura");
    expect(doc.cale).toMatch(/\.pdf$/);
  });

  it("fara furnizor ales si fara nume nou: mesajul formularului", async () => {
    await expect(adm.salveazaCheltuiala({ listaId, furnizorNou: "   ", categorie: "X", cod: "C7", suma: 1, metoda: "cota" })).rejects.toThrow("Alege furnizorul facturii.");
    await expect(adm.salveazaCheltuiala({ listaId, categorie: "X", cod: "C7", suma: 1, metoda: "cota" })).rejects.toThrow("Alege furnizorul facturii.");
  });

  it("un cod deja folosit pe lista are mesajul lui", async () => {
    await expect(adm.salveazaCheltuiala({ listaId, furnizorId: st.salubris.id, categorie: "X", cod: "C2", suma: 5, metoda: "cota" }))
      .rejects.toThrow("Codul C2 exista deja pe lista.");
  });

  it("un furnizor nou cu numele unuia existent este refuzat ca inregistrare identica", async () => {
    await expect(adm.salveazaCheltuiala({ listaId, furnizorNou: "Salubris Test", categorie: "X", cod: "C7", suma: 5, metoda: "cota" }))
      .rejects.toThrow("Exista deja o inregistrare identica.");
  });

  it("alte erori ale bazei trec mai departe (factura pe consum fara tipul apei)", async () => {
    await expect(adm.salveazaCheltuiala({ listaId, furnizorId: st.salubris.id, categorie: "X", cod: "C7", suma: 5, metoda: "consum" }))
      .rejects.toThrow(/cheltuieli_tip_apa_consum_check/);
  });

  it("[L3] randul fondului de reparatii nu devine factura prin formularul de factura", async () => {
    const [fond] = await ok(db("intretinere").from("cheltuieli").select("*").eq("lista_id", listaId).eq("tip", "fond_reparatii"));
    await expect(adm.salveazaCheltuiala({ id: fond.id, listaId, furnizorId: st.salubris.id, categorie: "Fond de reparatii", cod: "C9", suma: 170, metoda: "cota" }))
      .rejects.toThrow("Randul fondului de reparatii nu se modifica din formularul de factura.");
    const [dupa] = await ok(db("intretinere").from("cheltuieli").select("tip, suma, furnizor_id").eq("id", fond.id));
    expect(dupa).toEqual({ tip: "fond_reparatii", suma: 100, furnizor_id: null });
  });

  it("[R2] un rand care nu mai poate fi modificat din alt motiv are mesajul lui", async () => {
    const id = await adm.salveazaCheltuiala({ listaId, furnizorId: st.salubris.id, categorie: "Dispare", cod: "C5", suma: 7, metoda: "apartamente" });
    await ok(db("intretinere").from("cheltuieli").delete().eq("id", id));
    await expect(adm.salveazaCheltuiala({ id, listaId, furnizorId: st.salubris.id, categorie: "Dispare", cod: "C5", suma: 8, metoda: "apartamente" }))
      .rejects.toThrow("Randul nu mai poate fi modificat. Reincarca lista si incearca din nou.");
  });

  /* [P4] Randul se verifica inainte de a urca scanul (acelasi tipar ca la
     iesirea din fond, C6): altfel scanul ajunge deja in comunicare.documente,
     vizibil locatarilor la Acte, pentru o cheltuiala care pana la urma nu
     s-a salvat. */
  it("[P4] randul fondului cu scan atasat: scanul nu ramane orfan la Acte", async () => {
    const [fond] = await ok(db("intretinere").from("cheltuieli").select("*").eq("lista_id", listaId).eq("tip", "fond_reparatii"));
    const inainte = await ok(db("comunicare").from("documente").select("id").eq("asociatie_id", f.asociatieId));
    await expect(adm.salveazaCheltuiala({
      id: fond.id, listaId, furnizorId: st.salubris.id, categorie: "Fond de reparatii", cod: "C9", suma: 170, metoda: "cota", fisier: pdf("scan-fond.pdf"),
    })).rejects.toThrow("Randul fondului de reparatii nu se modifica din formularul de factura.");
    const dupa = await ok(db("comunicare").from("documente").select("id").eq("asociatie_id", f.asociatieId));
    expect(dupa).toHaveLength(inainte.length);
  });

  it("[P4] rand disparut cu scan atasat: scanul nu ramane orfan la Acte", async () => {
    const id = await adm.salveazaCheltuiala({ listaId, furnizorId: st.salubris.id, categorie: "Va disparea", cod: "C11", suma: 7, metoda: "apartamente" });
    await ok(db("intretinere").from("cheltuieli").delete().eq("id", id));
    const inainte = await ok(db("comunicare").from("documente").select("id").eq("asociatie_id", f.asociatieId));
    await expect(adm.salveazaCheltuiala({
      id, listaId, furnizorId: st.salubris.id, categorie: "Va disparea", cod: "C11", suma: 8, metoda: "apartamente", fisier: pdf("scan-disparut.pdf"),
    })).rejects.toThrow("Randul nu mai poate fi modificat. Reincarca lista si incearca din nou.");
    const dupa = await ok(db("comunicare").from("documente").select("id").eq("asociatie_id", f.asociatieId));
    expect(dupa).toHaveLength(inainte.length);
  });

  it("[L11] dupa un cod duplicat, reincercarea cu acelasi furnizor nou si alt cod reuseste", async () => {
    const nume = `Gaz Test ${unic()}`;
    await expect(adm.salveazaCheltuiala({ listaId, furnizorNou: nume, categorie: "Gaz", cod: "C2", suma: 5, metoda: "cota" })).rejects.toThrow("Codul C2 exista deja pe lista.");
    const orfan = await ok(db("intretinere").from("furnizori").select("id").eq("asociatie_id", f.asociatieId).eq("denumire", nume));
    expect(orfan).toEqual([]);
    const id = await adm.salveazaCheltuiala({ listaId, furnizorNou: nume, categorie: "Gaz", cod: "C6", suma: 5, metoda: "cota" });
    await adm.stergeCheltuiala(id);
  });

  /* [L11/P4] Verificarile ieftine adaugate la aceste doua reparatii prind
     aproape orice caz real, dar nu si o cursa genuina intre doua salvari
     simultane: verificarea trece, apoi scrierea insasi esueaza. Mesajele de
     rezerva raman, dar nu mai erau exercitate de niciun test de cand
     verificarile ieftine prind cazurile obisnuite dintii. */
  it("[P4] o cursa rara (randul dispare chiar intre verificare si scriere) are acelasi mesaj", async () => {
    const id = await adm.salveazaCheltuiala({ listaId, furnizorId: st.salubris.id, categorie: "Cursa", cod: "C12", suma: 4, metoda: "apartamente" });
    await cuFetch((url, init) => (url.includes("/cheltuieli?") && init.method === "PATCH"
      ? json({ message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" }, 406)
      : undefined), async () => {
      await expect(adm.salveazaCheltuiala({ id, listaId, furnizorId: st.salubris.id, categorie: "Cursa", cod: "C12", suma: 5, metoda: "apartamente" }))
        .rejects.toThrow("Randul nu mai poate fi modificat. Reincarca lista si incearca din nou.");
    });
    await adm.stergeCheltuiala(id);
  });

  it("[L11] un cod dublat exact la scriere (cursa intre doua salvari) are acelasi mesaj", async () => {
    await cuFetch((url, init) => (url.includes("/cheltuieli?") && init.method === "POST"
      ? json({ message: 'duplicate key value violates unique constraint "cheltuieli_lista_cod_key"', code: "23505" }, 409)
      : undefined), async () => {
      await expect(adm.salveazaCheltuiala({ listaId, furnizorId: st.salubris.id, categorie: "Cursa cod", cod: "C13", suma: 1, metoda: "apartamente" }))
        .rejects.toThrow("Codul C13 exista deja pe lista.");
    });
  });

  /* [K23] Furnizorul nou si factura se scriau in doua apeluri: la o cursa pe
     acelasi cod, furnizorul celui refuzat ramanea orfan. Acum sunt un singur
     apel (o tranzactie), iar cursa pierduta are acelasi mesaj ca L11. */
  it("[K23] factura cu furnizor nou merge intr-un singur apel; cursa pe cod dublat are acelasi mesaj", async () => {
    let apelat = false;
    await cuFetch((url, init) => {
      if (init.method === "POST" && url.includes("/furnizori")) throw new Error("furnizorul nu se mai insereaza separat");
      if (url.includes("/rpc/adauga_factura_cu_furnizor_nou")) {
        apelat = true;
        return json({ message: 'duplicate key value violates unique constraint "cheltuieli_lista_cod_key"', code: "23505" }, 409);
      }
      return undefined;
    }, async () => {
      await expect(adm.salveazaCheltuiala({ listaId, furnizorNou: "Furnizor K23", categorie: "Cursa K23", cod: "C14", suma: 1, metoda: "apartamente" }))
        .rejects.toThrow("Codul C14 exista deja pe lista.");
    });
    expect(apelat).toBe(true);
  });

  it("[K23] la editare, un furnizor nou se creeaza si randul trece pe el", async () => {
    const id = await adm.salveazaCheltuiala({ listaId, furnizorId: st.salubris.id, categorie: "Editare K23", cod: "C15", suma: 2, metoda: "apartamente" });
    await adm.salveazaCheltuiala({ id, listaId, furnizorNou: "  Furnizor nou la editare  ", categorie: "Editare K23", cod: "C15", suma: 2, metoda: "apartamente" });
    const r = await ok(db("intretinere").from("cheltuieli").select("furnizor_id").eq("id", id).single());
    const fz = await ok(db("intretinere").from("furnizori").select("denumire").eq("id", r.furnizor_id).single());
    expect(fz.denumire).toBe("Furnizor nou la editare");
    await adm.stergeCheltuiala(id);
  });

  /* [K7] Anularea unei penalizari ajunge pe ecran legata de penalizarea ei,
     iar restul penalizarii scade cu ea (financiar.datorii_rest). */
  it("[K7] o anulare de penalizare ajunge pe ecran legata de penalizarea ei, iar restul scade", async () => {
    const pen = await ok(db("financiar").from("datorii").insert({
      apartament_id: f.ap["1"], bloc_id: f.blocId, tip: "penalizare", luna: zi1(luna), suma: 30, scadenta: zi1(luna), descriere: "Penalizare test K7",
    }).select().single());
    const anulare = await ok(db("financiar").from("datorii").insert({
      apartament_id: f.ap["1"], bloc_id: f.blocId, tip: "anulare_penalizare", luna: zi1(luna), suma: -10, scadenta: zi1(luna),
      descriere: "Penalizare anulata dupa recalcularea listei", anuleaza_datorie_id: pen.id,
    }).select().single());
    const date = await adm.incarca();
    expect(date.datorii.find((x) => x.id === pen.id)).toMatchObject({ rest: 20, anuleazaDatorieId: null });
    expect(date.datorii.find((x) => x.id === anulare.id)).toMatchObject({ rest: 0, anuleazaDatorieId: pen.id });
    await ok(db("financiar").from("datorii").delete().eq("id", anulare.id));
    await ok(db("financiar").from("datorii").delete().eq("id", pen.id));
  });

  it("stergeCheltuiala() scoate randul din ciorna", async () => {
    const id = await adm.salveazaCheltuiala({ listaId, furnizorId: st.salubris.id, categorie: "Temporar", cod: "C8", suma: 9, metoda: "apartamente" });
    await adm.stergeCheltuiala(id);
    const r = await ok(db("intretinere").from("cheltuieli").select("id").eq("id", id));
    expect(r).toEqual([]);
  });

  it("[NOU-4] stergeCheltuiala() pe un rand deja sters are mesajul lui", async () => {
    const id = await adm.salveazaCheltuiala({ listaId, furnizorId: st.salubris.id, categorie: "Disparuta", cod: "C6", suma: 3, metoda: "apartamente" });
    await ok(db("intretinere").from("cheltuieli").delete().eq("id", id));
    await expect(adm.stergeCheltuiala(id)).rejects.toThrow("Randul nu mai exista. Reincarca lista si incearca din nou.");
  });
});

describe("contoare", () => {
  let citiri;

  it("valideazaCitire(): accepta sau respinge cu motiv; fara motiv refuza", async () => {
    await loc.incarca();
    await loc.transmiteCitire({ apartamentId: f.ap["1"], luna, indexuri: [{ contorId: f.contoare["1:rece"], index: 13 }, { contorId: f.contoare["1:calda"], index: 7 }] });
    await loc2.incarca();
    await loc2.transmiteCitire({ apartamentId: f.ap["2"], luna, indexuri: [{ contorId: f.contoare["2:rece"], index: 25 }] });
    const d = await adm.incarca();
    citiri = d.citiri.filter((c) => c.luna === luna && c.stare === "trimisa");
    const id = (numar, tip) => citiri.find((c) => c.apartamentId === f.ap[numar] && c.tip === tip).id;
    await adm.valideazaCitire(id("1", "rece"), true, null);
    await adm.valideazaCitire(id("1", "calda"), false, "Poza neclara");
    await expect(adm.valideazaCitire(id("2", "rece"), false, " ")).rejects.toThrow("Scrie motivul, ca locatarul sa stie ce sa corecteze.");
    await adm.valideazaCitire(id("2", "rece"), true);
    const r = await ok(db("contorizare").from("citiri").select("id, stare, motiv_respingere, verificata_de").in("id", citiri.map((c) => c.id)));
    expect(Object.fromEntries(r.map((x) => [x.id, [x.stare, x.motiv_respingere, x.verificata_de]]))).toEqual({
      [id("1", "rece")]: ["validata", null, f.adminId], [id("1", "calda")]: ["respinsa", "Poza neclara", f.adminId], [id("2", "rece")]: ["validata", null, f.adminId],
    });
    await expect(adm.valideazaCitire(id("1", "rece"), true)).rejects.toThrow("Citirea a fost deja verificata.");
  });

  it("estimeazaCitiri(): o citire estimata pe fiecare contor fara citire valabila", async () => {
    /* [A6] estimarea e refuzata inainte de ziua limita a lunii curente
       (implicit 25); testul ruleaza in orice zi a lunii, deci termenul
       blocului se muta la 1, ca "azi" sa fie mereu dupa el. */
    await ok(db("contorizare").from("setari_contorizare").update({ zi_limita_citire: 1 }).eq("bloc_id", f.blocId));
    const r = await adm.estimeazaCitiri(luna);
    expect(r).toEqual({ estimate: 6 });
    const est = await ok(db("contorizare").from("citiri").select("apartament_id, tip, consum, stare").eq("bloc_id", f.blocId).eq("luna", zi1(luna)).eq("sursa", "estimat"));
    expect(est).toHaveLength(6);
    expect(est.every((c) => c.stare === "validata" && c.consum === 0)).toBe(true);
  });

  it("citesteContorGeneral(): indexul general al lunii; unul mai mic decat cel anterior este refuzat", async () => {
    await adm.citesteContorGeneral(luna, "rece", PORNIRE_GENERAL.rece + 20);
    await adm.citesteContorGeneral(luna, "calda", PORNIRE_GENERAL.calda + 4);
    const g = await ok(db("contorizare").from("citiri").select("tip, consum, stare, sursa").is("apartament_id", null).eq("bloc_id", f.blocId).eq("luna", zi1(luna)).order("tip"));
    expect(g).toEqual([{ tip: "calda", consum: 4, stare: "validata", sursa: "administrator" }, { tip: "rece", consum: 20, stare: "validata", sursa: "administrator" }]);
    await expect(adm.citesteContorGeneral(luna, "rece", 1)).rejects.toThrow(/Indexul nou nu poate fi mai mic decat cel anterior/);
  });
});

describe("motorul si publicarea", () => {
  it("dateMotor(): datele listei, convertite la numere", async () => {
    const dm = await adm.dateMotor(listaId);
    expect(dm.apartamente).toEqual([
      { id: f.ap["1"], numar: "1", persoane: 2, cota: 20, scutitLift: true }, { id: f.ap["10"], numar: "10", persoane: 4, cota: 35, scutitLift: false },
      { id: f.ap["2"], numar: "2", persoane: 3, cota: 30, scutitLift: false }, { id: f.ap["2A"], numar: "2A", persoane: 1, cota: 15, scutitLift: false },
    ]);
    expect(dm.cheltuieli.map((c) => [c.cod, c.suma, c.metoda, c.tipApa])).toEqual([["C1", 300, "consum", "rece"], ["C2", 210.5, "persoane", null], ["C9", 100, "cota", null]]);
    expect(dm.consum).toEqual({
      [f.ap["1"]]: { rece: 3, calda: 0 }, [f.ap["2"]]: { rece: 5, calda: 0 }, [f.ap["2A"]]: { rece: 0, calda: 0 }, [f.ap["10"]]: { rece: 0, calda: 0 },
    });
    expect(dm.contorGeneral).toEqual({ rece: 20, calda: 4 });
  });

  it("dateMotor() pentru o lista straina este refuzat", async () => {
    await expect(adm.dateMotor("00000000-0000-4000-8000-000000000000")).rejects.toThrow("Lista nu exista.");
  });

  it("raspuns sintetic: fara consum si fara contor general, dateMotor() intoarce obiecte goale", async () => {
    const dm = await cuFetch(async (url, init, original) => {
      if (!url.includes("/rpc/date_pentru_motor")) return undefined;
      const r = await original(url, init);
      return json({ ...(await r.json()), consum: null, contorGeneral: null });
    }, () => adm.dateMotor(listaId));
    expect(dm.consum).toEqual({});
    expect(dm.contorGeneral).toEqual({});
  });

  it("publicaLista(): motorul imparte fiecare factura la ban, iar datoriile apar pe apartamente", async () => {
    const r = await adm.publicaLista(listaId);
    expect(r).toMatchObject({ lista_id: listaId, total_cheltuieli: 610.5, total_repartizat: 610.5 });
    const l = await ok(db("intretinere").from("liste_lunare").select("*").eq("id", listaId).single());
    expect(l).toMatchObject({ stare: "publicata", total_repartizat: 610.5, apartamente_repartizate: 4, publicata_de: f.adminId });
    await ok(serviciu.rpc("proceseaza_evenimente_restante"));
    const datorii = await ok(db("financiar").from("datorii").select("apartament_id, suma").eq("lista_id", listaId).eq("tip", "intretinere"));
    expect(datorii).toHaveLength(4);
    expect(suma(datorii.map((d) => d.suma))).toBe(610.5);
    const d = await adm.incarca();
    const rep = d.repartizari.filter((x) => x.listaId === listaId);
    expect(rep).toHaveLength(12);
    for (const c of d.cheltuieli.filter((x) => x.listaId === listaId)) {
      expect(suma(rep.filter((x) => x.cheltuialaId === c.id).map((x) => x.suma))).toBe(c.suma);
    }
    const apa = rep.find((x) => x.cheltuialaId === st.c1 && x.apartamentId === f.ap["1"]);
    expect(apa.baza.unitate).toBe("mc");
    expect(apa.detaliu).toMatchObject({ tip: "rece", consumPropriu: 3, contorGeneral: 20, sumaContoare: 8 });
    const ld = await loc.incarca();
    expect(ld.liste.map((x) => x.id)).toEqual([listaId]);
    expect(ld.repartizari.every((x) => x.apartamentId === f.ap["1"])).toBe(true);
  });

  it("publicaLista() a doua oara: mesajul functiei", async () => {
    await expect(adm.publicaLista(listaId)).rejects.toThrow("Lista este deja publicata.");
  });

  it("marcheazaFacturaPlatita(): data platii furnizorului, pusa si scoasa", async () => {
    await adm.marcheazaFacturaPlatita(st.c2, true);
    expect((await ok(db("intretinere").from("cheltuieli").select("achitata_furnizor_la").eq("id", st.c2).single())).achitata_furnizor_la).not.toBeNull();
    await adm.marcheazaFacturaPlatita(st.c2, false);
    expect((await ok(db("intretinere").from("cheltuieli").select("achitata_furnizor_la").eq("id", st.c2).single())).achitata_furnizor_la).toBeNull();
  });

  it("[NOU-4] stergeCheltuiala() pe o lista publicata este refuzata, nu raportata ca reusita", async () => {
    await expect(adm.stergeCheltuiala(st.c2)).rejects.toThrow("Lista este deja publicata; cheltuiala nu se mai poate sterge.");
    const r = await ok(db("intretinere").from("cheltuieli").select("id").eq("id", st.c2));
    expect(r).toHaveLength(1);
  });
});

describe("bani si oameni", () => {
  it("inregistreazaIncasare(): plata cash, alocata si cu chitanta; suma zero refuzata", async () => {
    const { plataId } = await adm.inregistreazaIncasare(f.ap["1"], 50, "numerar");
    const p = await ok(db("financiar").from("plati").select("*").eq("id", plataId).single());
    expect(p).toMatchObject({ metoda: "numerar", stare: "confirmata", suma: 50, inregistrata_de: f.adminId, apartament_id: f.ap["1"] });
    const ch = await ok(db("financiar").from("chitante").select("*").eq("plata_id", plataId).single());
    expect(ch.numar).toBeGreaterThan(0);
    await expect(adm.inregistreazaIncasare(f.ap["1"], 0, "numerar")).rejects.toThrow("Suma trebuie sa fie mai mare decat zero.");
    await expect(adm.inregistreazaIncasare(f.ap["1"], 10, "card")).rejects.toThrow("Banii primiti sunt fie in numerar, fie prin transfer bancar.");
    const transfer = await adm.inregistreazaIncasare(f.ap["1"], 10, "transfer");
    const d2 = await adm.incarca();
    expect(d2.plati.find((p) => p.id === transfer.plataId)).toMatchObject({ metoda: "transfer", suma: 10 });
  });

  /* [B2] Administratorul apasa "Emite chitanta", cererea trece, dar raspunsul
     se pierde pe drum (retea mobila) si el apasa din nou. Pana la auditul 4,
     in registru intrau doua plati si doua chitante pe aceiasi bani. */
  it("[B2] aceeasi cerere de incasare, trimisa de doua ori, face o singura plata", async () => {
    const cheie = crypto.randomUUID();
    const intai = await adm.inregistreazaIncasare(f.ap["2"], 75, "numerar", cheie);
    const apoi = await adm.inregistreazaIncasare(f.ap["2"], 75, "numerar", cheie);
    expect(apoi.plataId).toBe(intai.plataId);
    const plati = await ok(db("financiar").from("plati").select("id").eq("apartament_id", f.ap["2"]).eq("cheie_client", cheie));
    expect(plati).toHaveLength(1);
    const chitante = await ok(db("financiar").from("chitante").select("id").eq("plata_id", intai.plataId));
    expect(chitante).toHaveLength(1);
    /* alta cerere, alti bani */
    const alta = await adm.inregistreazaIncasare(f.ap["2"], 75, "numerar", crypto.randomUUID());
    expect(alta.plataId).not.toBe(intai.plataId);
  });

  /* [T1] Incasarea scrisa gresit se anuleaza: iese din socoteala, dar ramane in
     istoric, cu motivul ei, iar chitanta isi pastreaza numarul. */
  it("[T1] storneazaIncasare(): incasarea iese din socoteala si ramane in istoric", async () => {
    const inainte = (await adm.incarca()).situatieBloc.restanteTotal;
    const { plataId } = await adm.inregistreazaIncasare(f.ap["1"], 40, "numerar");
    const cuPlata = await adm.incarca();
    expect(cuPlata.plati.find((p) => p.id === plataId)).toMatchObject({ stare: "confirmata", motivStornare: null });

    await adm.storneazaIncasare(plataId, "  Suma a fost scrisa gresit  ");
    const dupa = await adm.incarca();
    const p = dupa.plati.find((x) => x.id === plataId);
    expect(p).toMatchObject({ stare: "rambursata", motivStornare: "Suma a fost scrisa gresit" });
    expect(p.chitanta.numar).toBeGreaterThan(0);
    expect(dupa.situatieBloc.restanteTotal).toBeCloseTo(inainte, 2);

    await expect(adm.storneazaIncasare(plataId, "Inca o data"))
      .rejects.toThrow("Incasarea a fost deja stornata.");
    await expect(adm.storneazaIncasare(plataId, "   "))
      .rejects.toThrow("Scrie de ce stornezi incasarea.");
  });

  it("[T1] storneazaIncasare(): locatarul nu storneaza incasari", async () => {
    const { plataId } = await adm.inregistreazaIncasare(f.ap["1"], 25, "numerar");
    const { s: alLocatarului } = await intraCa(f.conturi.loc.telefon);
    await expect(alLocatarului.storneazaIncasare(plataId, "Vreau banii inapoi"))
      .rejects.toThrow("Doar administratorul blocului storneaza incasari.");
  });

  it("trimiteInstiintare(): notificarea de restanta ajunge la locatarul apartamentului", async () => {
    expect(await adm.trimiteInstiintare(f.ap["1"])).toEqual({ destinatari: 1 });
    const n = await ok(db("comunicare").from("notificari").select("*").eq("profil_id", f.conturi.loc.id).eq("tip", "restanta"));
    expect(n).toEqual([expect.objectContaining({ titlu: "Instiintare de plata" })]);
  });

  it("schimbaPersoane(): o modificare pe luna; a doua pe aceeasi luna este refuzata", async () => {
    await adm.schimbaPersoane(f.ap["2"], 5, lunaDelta(1), "Nou nascut");
    await adm.schimbaPersoane(f.ap["2A"], 2, lunaDelta(1));
    const r = await ok(db("organizare").from("apartamente_persoane").select("*").in("apartament_id", [f.ap["2"], f.ap["2A"]]).eq("valabil_din", zi1(lunaDelta(1))).order("numar_persoane"));
    expect(r.map((x) => [x.numar_persoane, x.motiv, x.modificat_de])).toEqual([[2, null, f.adminId], [5, "Nou nascut", f.adminId]]);
    await expect(adm.schimbaPersoane(f.ap["2"], 4, lunaDelta(1), "Alta")).rejects.toThrow("Exista deja o modificare pentru luna aceasta. Istoricul nu se rescrie.");
  });

  it("schimbaPersoane() pe un apartament strain: fara drept", async () => {
    const strain = await ok(db("organizare").from("apartamente").select("id").neq("bloc_id", f.blocId).limit(1).single());
    await expect(adm.schimbaPersoane(strain.id, 1, lunaDelta(1), null)).rejects.toThrow("Nu ai drept sa faci aceasta operatie.");
  });

  it("adaugaLocatar(): contul nou apare pe fisa apartamentului", async () => {
    const telefon = `07${String(Date.now() % 100000000).padStart(8, "0")}`;
    const r = await adm.adaugaLocatar(f.ap["2A"], { nume: "Membru Familie", telefon, calitate: "membru_familie" });
    expect(r.parola).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/);
    const legatura = await ok(db("identitate").from("locatari").select("*").eq("id", r.locatar_id).single());
    expect(legatura).toMatchObject({ apartament_id: f.ap["2A"], calitate: "membru_familie", activ_pana: null });
    const d = await adm.incarca();
    const pe2A = d.apartamente.find((a) => a.id === f.ap["2A"]).locatari;
    expect(pe2A.map((l) => [l.nume, l.telefon])).toContainEqual(["Membru Familie", telefon]);
    /* Contul ramane in istoric, dar nu mai numara ca locatar activ: testele
       de mai jos numara destinatarii reminderelor pe acelasi bloc. */
    await adm.inchideAcces(r.locatar_id);
  });

  it("inchideAcces(): legatura primeste data de sfarsit; a doua oara este refuzata", async () => {
    await adm.inchideAcces(f.locatari.loc2);
    const l = await ok(db("identitate").from("locatari").select("activ_pana").eq("id", f.locatari.loc2).single());
    expect(l.activ_pana).not.toBeNull();
    await expect(adm.inchideAcces(f.locatari.loc2)).rejects.toThrow("Legatura nu exista sau nu este in blocul tau.");
  });
});

describe("sesizari", () => {
  it("preiaSesizare(), raspunsul si rezolvaSesizare()", async () => {
    await loc.incarca();
    const id = await loc.adaugaSesizare({ apartamentId: f.ap["1"], titlu: "Interfon", categorie: "acces", descriere: "Nu suna" });
    await adm.preiaSesizare(id);
    expect((await ok(db("sesizari").from("sesizari").select("stare, preluata_de").eq("id", id).single()))).toEqual({ stare: "in_lucru", preluata_de: f.adminId });
    await adm.scrieMesaj(id, "Vine tehnicianul joi");
    const m = await ok(db("sesizari").from("sesizari_mesaje").select("*").eq("sesizare_id", id).single());
    expect(m).toMatchObject({ din_administratie: true, autor_id: f.adminId, text: "Vine tehnicianul joi" });
    await adm.rezolvaSesizare(id);
    const s = await ok(db("sesizari").from("sesizari").select("stare, rezolvata_la").eq("id", id).single());
    expect(s.stare).toBe("rezolvata");
    expect(s.rezolvata_la).not.toBeNull();
    await expect(adm.rezolvaSesizare(id)).rejects.toThrow("Sesizarea nu exista, este deja rezolvata sau nu este din blocul tau.");
    await expect(loc.scrieMesaj(id, "Tot nu merge")).rejects.toThrow("Sesizarea este rezolvata. Scrie o sesizare noua daca problema a revenit.");
  });
});

describe("comunicare si guvernanta", () => {
  it("publicaAnunt(): urgent notifica locatarii; cel obisnuit nu", async () => {
    const urgent = await adm.publicaAnunt({ titlu: " Apa oprita ", corp: "Maine 9-12", urgent: true });
    const normal = await adm.publicaAnunt({ titlu: "Curatenie", corp: "Sambata" });
    const a = await ok(db("comunicare").from("anunturi").select("id, titlu, urgent, bloc_id, autor_id").in("id", [urgent, normal]));
    expect(a.find((x) => x.id === urgent)).toMatchObject({ titlu: "Apa oprita", urgent: true, bloc_id: f.blocId, autor_id: f.adminId });
    expect(a.find((x) => x.id === normal).urgent).toBe(false);
    const n = await ok(db("comunicare").from("notificari").select("titlu, referinta").eq("profil_id", f.conturi.loc.id).eq("tip", "anunt"));
    expect(n).toEqual([{ titlu: "Urgent: Apa oprita", referinta: { anunt_id: urgent } }]);
  });

  it("seteazaReminder(): activ si zile; fara zile le pastreaza pe cele vechi", async () => {
    await adm.seteazaReminder("plata", false, 5);
    const citeste = () => ok(db("comunicare").from("remindere_setari").select("activ, zile").eq("asociatie_id", f.asociatieId).eq("tip", "plata").single());
    expect(await citeste()).toEqual({ activ: false, zile: 5 });
    await adm.seteazaReminder("plata", true, null);
    expect(await citeste()).toEqual({ activ: true, zile: 5 });
    const d = await adm.incarca();
    expect(d.remindere.find((r) => r.tip === "plata")).toEqual({ tip: "plata", activ: true, zile: 5 });
  });

  it("trimiteReminder(): cati au primit; un tip necunoscut este refuzat", async () => {
    const r = await adm.trimiteReminder("citire_contoare");
    expect(r).toEqual({ apartamente: 0, destinatari: 0 });
    const p = await adm.trimiteReminder("plata");
    expect(p.apartamente).toBeGreaterThanOrEqual(3);
    expect(p.destinatari).toBe(1);
    await expect(adm.trimiteReminder("altceva")).rejects.toThrow("Reminderul altceva nu se trimite manual.");
  });

  it("deschideVot(): variantele goale se ignora, inchiderea la ora 20 a zilei alese, ora Romaniei", async () => {
    const zi = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    st.vot = await adm.deschideVot({ titlu: "Schimbam firma de curatenie?", descriere: "", optiuni: ["Da", " Nu ", "  "], inchideLa: zi, numarare: "cota" });
    const v = await ok(db("guvernanta").from("voturi").select("*").eq("id", st.vot).single());
    expect(v).toMatchObject({ asociatie_id: f.asociatieId, numarare: "cota", descriere: null, creat_de: f.adminId });
    /* [J9] Ora 20:00 e a Romaniei, nu a masinii care ruleaza testul (aici
       Bucuresti oricum), verificarea foloseste acelasi calcul independent
       de fus ca sursa-mock.js, nu new Date(`${zi}T20:00:00`), care ar
       depinde de fusul local. */
    expect(Date.parse(v.inchide_la)).toBe(new Date(oraSeriiRomania(zi)).getTime());
    const o = await ok(db("guvernanta").from("voturi_optiuni").select("text, ordine").eq("vot_id", st.vot).order("ordine"));
    expect(o).toEqual([{ text: "Da", ordine: 1 }, { text: "Nu", ordine: 2 }]);
    await expect(adm.deschideVot({ titlu: "X", descriere: "", optiuni: ["Doar una"], inchideLa: zi, numarare: "apartament" }))
      .rejects.toThrow("Un vot are nevoie de cel putin doua variante.");
  });

  it("[J9] deschideVot(): ora de inchidere e a Romaniei, indiferent de fusul dispozitivului", async () => {
    /* Un dispozitiv intr-un fus mult inaintea Romaniei (Tokyo, +9) ar calcula
       "20:00 local" ca un instant UTC mai devreme decat 20:00 Bucuresti, pe
       zile apropiate, chiar unul deja trecut, refuzat de deschide_vot cu
       "Data de inchidere trebuie sa fie in viitor." */
    const ziOriginal = process.env.TZ;
    const zi = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    let idVot;
    try {
      process.env.TZ = "Asia/Tokyo";
      idVot = await adm.deschideVot({ titlu: "Vot cu telefonul pe alt fus", descriere: "", optiuni: ["Da", "Nu"], inchideLa: zi, numarare: "apartament" });
    } finally {
      process.env.TZ = ziOriginal;
    }
    const v = await ok(db("guvernanta").from("voturi").select("inchide_la").eq("id", idVot).single());
    expect(Date.parse(v.inchide_la)).toBe(new Date(oraSeriiRomania(zi)).getTime());
  });

  it("reamintesteVot(): apartamentele care n-au votat si locatarii lor", async () => {
    expect(await adm.reamintesteVot(st.vot)).toEqual({ apartamente: 4, destinatari: 1 });
  });

  it("convoacaAdunare(): adunarea viitoare; una in trecut este refuzata", async () => {
    const dataOra = new Date(Date.now() + 10 * 86400000).toISOString();
    const id = await adm.convoacaAdunare({ dataOra, loc: " Parter ", ordineDeZi: " Bugetul " });
    const a = await ok(db("guvernanta").from("adunari_generale").select("*").eq("id", id).single());
    expect(a).toMatchObject({ asociatie_id: f.asociatieId, loc: "Parter", ordine_de_zi: "Bugetul", convocata_de: f.adminId });
    expect(Date.parse(a.data_ora)).toBe(Date.parse(dataOra));
    await expect(adm.convoacaAdunare({ dataOra: "2020-01-01T10:00:00Z", loc: "X", ordineDeZi: "Y" })).rejects.toThrow("Data adunarii trebuie sa fie in viitor.");
  });

  it("incarcaDocument(): fisierul in Storage si randul documentului; vizibil implicit", async () => {
    await adm.incarcaDocument({ titlu: " Regulament intern ", tip: "regulament", fisier: pdf("regulament.pdf"), vizibil: false });
    await adm.incarcaDocument({ titlu: "Contract lift", tip: "contract", fisier: pdf("contract.pdf") });
    const docs = await ok(db("comunicare").from("documente").select("*").eq("asociatie_id", f.asociatieId).in("tip", ["regulament", "contract"]));
    expect(docs.map((d) => [d.titlu, d.vizibil_locatarilor]).sort()).toEqual([["Contract lift", true], ["Regulament intern", false]]);
    for (const d of docs) {
      expect(d.cale.startsWith(`${f.asociatieId}/${f.blocId}/`)).toBe(true);
      const { error } = await serviciu.storage.from("documente").download(d.cale);
      expect(error).toBeNull();
    }
  });

  it("incarcaDocument() fara fisier cere fisierul; locatarul nu are drept", async () => {
    await expect(adm.incarcaDocument({ titlu: "X", tip: "altul", fisier: null })).rejects.toThrow("Alege fisierul.");
    await loc.incarca();
    await expect(loc.incarcaDocument({ titlu: "X", tip: "altul", fisier: pdf() })).rejects.toThrow("Nu ai drept sa faci aceasta operatie.");
  });

  /* [A8] Mesajul romanesc pentru o poza refuzata de bucket e specific
     bucket-ului "poze": un fisier refuzat din alt bucket (aici "documente",
     care nu accepta text/plain) trece mai departe mesajul tehnic al
     serverului, neschimbat. */
  it("un fisier refuzat de bucket-ul documente nu primeste mesajul de poza", async () => {
    const fisier = new File([Buffer.from("nu e un document acceptat")], "notite.txt", { type: "text/plain" });
    await expect(adm.incarcaDocument({ titlu: "Notite", tip: "altul", fisier }))
      .rejects.toThrow(/mime type/i);
  });
});
