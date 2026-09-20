/* Paginarea si filtrarea citirilor din incarca() (audit 2: P3, P4).
   P3: toate() pagina cu OFFSET, fara `order`, cu pragul 1000 codificat: ordinea
       intre pagini nu era garantata, deci un rand putea sa apara de doua ori sau
       deloc.
   P4: unsprezece citiri plecau fara niciun filtru pe bloc, deci aduceau randurile
       intregii asociatii ca sa le arunce apoi in memorie.
   Testele se uita si la cererile trimise catre PostgREST, nu doar la rezultat:
   la nivelul lui `date` cele doua defecte nu se vad, doar in trafic. */
import { beforeAll, describe, expect, it } from "vitest";
import { creeazaBloc, cuFetch, db, intraCa, lunaCurenta, ok, unic, zi1 } from "./fixture.js";

const luna = lunaCurenta();
let f;
let adm;
let listaId;
let sesizareaDinBlocDoi;

/* Reia cererile catre PostgREST: url-ul si randurile primite */
async function cuTrafic(fn) {
  const cereri = [];
  const rezultat = await cuFetch(async (url, init, original) => {
    if (!url.includes("/rest/v1/")) return undefined;
    const r = await original(url, init);
    const copie = r.clone();
    let randuri = null;
    try {
      randuri = await copie.json();
    } catch { /* raspuns fara corp JSON */ }
    cereri.push({ url, randuri });
    return r;
  }, fn);
  return { rezultat, cereri };
}

const cererileCu = (cereri, cale) => cereri.filter((c) => c.url.includes(`/rest/v1/${cale}?`));

beforeAll(async () => {
  f = await creeazaBloc({ blocDoi: true, locatari: [{ cheie: "loc", apartament: "1" }] });
  adm = (await intraCa(f.adminEmail)).s;
  listaId = await adm.deschideLista(luna);

  /* Peste 1000 de randuri pe o singura lista, ca sa treaca de o pagina */
  const randuri = [];
  for (let i = 1; i <= 1100; i += 1) {
    randuri.push({ lista_id: listaId, tip: "fond_reparatii", cod: `F${i}`, categorie: `Fond ${i}`, suma: 1, metoda: "cota" });
  }
  await ok(db("intretinere").from("cheltuieli").insert(randuri));

  /* Al doilea bloc al aceleiasi asociatii: administratorul are drept pe el prin
     RLS, dar ecranele lui sunt pe primul bloc, deci nimic de aici nu trebuie
     adus. */
  const apDoi = await ok(db("organizare").from("apartamente").insert({
    bloc_id: f.blocDoiId, numar: "1", etaj: 0, proprietar_nume: "Vecin Din Blocul Doi", cota_indiviza: 100,
  }).select().single());
  sesizareaDinBlocDoi = await ok(db("sesizari").from("sesizari").insert({
    bloc_id: f.blocDoiId, apartament_id: apDoi.id, autor_id: f.adminId, categorie: "altele",
    titlu: "Sesizare din blocul doi", descriere: "Nu trebuie sa ajunga in primul bloc", stare: "noua",
  }).select().single());
  await ok(db("sesizari").from("sesizari_mesaje").insert({
    sesizare_id: sesizareaDinBlocDoi.id, autor_id: f.adminId, din_administratie: true, text: "Mesaj din blocul doi",
  }));
  await ok(db("sesizari").from("sesizari_poze").insert({ sesizare_id: sesizareaDinBlocDoi.id, cale: "bloc-doi/poza.jpg" }));

  const fondDoi = await ok(db("financiar").from("fonduri").select("id").eq("bloc_id", f.blocDoiId).eq("tip", "reparatii").single());
  await ok(db("financiar").from("miscari_fond").insert({
    fond_id: fondDoi.id, data: zi1(luna), suma: 999, descriere: "Miscare din blocul doi",
  }));
  await ok(db("organizare").from("apartamente_persoane").insert({
    apartament_id: apDoi.id, valabil_din: zi1(luna), numar_persoane: 7,
  }));
});

describe("P3: toate() pagineaza pe cheie, nu pe OFFSET", () => {
  it("nicio cerere nu mai foloseste offset, iar paginile sunt ordonate", async () => {
    const { cereri } = await cuTrafic(() => adm.incarca());
    const cuOffset = cereri.filter((c) => /[?&]offset=/.test(c.url));
    expect(cuOffset.map((c) => c.url)).toEqual([]);
    const cheltuieli = cererileCu(cereri, "cheltuieli");
    expect(cheltuieli.length).toBeGreaterThan(1);
    cheltuieli.forEach((c) => expect(c.url).toMatch(/order=id\./));
    /* A doua pagina porneste de la ultimul id al primei */
    expect(cheltuieli[1].url).toMatch(/id=gt\./);
  });

  it("o tabela cu peste 1000 de randuri se intoarce intreaga, fiecare rand o singura data", async () => {
    const date = await adm.incarca();
    const aleListei = date.cheltuieli.filter((c) => c.listaId === listaId && c.cod.startsWith("F"));
    expect(aleListei.length).toBe(1100);
    expect(new Set(aleListei.map((c) => c.id)).size).toBe(1100);
    expect(new Set(aleListei.map((c) => c.cod)).size).toBe(1100);
  });
});

describe("P4: citirile pleaca filtrate pe blocul de pe ecran", () => {
  it("mesajele, pozele, persoanele si miscarile de fond ale celuilalt bloc nu se aduc", async () => {
    const { cereri } = await cuTrafic(() => adm.incarca());

    const mesaje = cererileCu(cereri, "sesizari_mesaje").flatMap((c) => c.randuri || []);
    expect(mesaje.some((m) => m.sesizare_id === sesizareaDinBlocDoi.id)).toBe(false);

    const poze = cererileCu(cereri, "sesizari_poze").flatMap((c) => c.randuri || []);
    expect(poze.some((p) => p.sesizare_id === sesizareaDinBlocDoi.id)).toBe(false);

    const miscari = cererileCu(cereri, "miscari_fond").flatMap((c) => c.randuri || []);
    expect(miscari.some((m) => Number(m.suma) === 999)).toBe(false);

    const persoane = cererileCu(cereri, "apartamente_persoane").flatMap((c) => c.randuri || []);
    expect(persoane.some((p) => p.numar_persoane === 7)).toBe(false);
  });

  it("locatarul primeste numai randurile apartamentului lui", async () => {
    const loc = (await intraCa(f.conturi.loc.email)).s;
    const { cereri } = await cuTrafic(() => loc.incarca());
    const persoane = cererileCu(cereri, "apartamente_persoane").flatMap((c) => c.randuri || []);
    expect(persoane.length).toBeGreaterThan(0);
    expect(new Set(persoane.map((p) => p.apartament_id))).toEqual(new Set([f.ap["1"]]));
  });
});

describe("C11: sesizari, anunturi, documente, profiluri si liste_lunare pagineaza pe cheie", () => {
  it("un tabel cu peste 1000 de randuri (documente) se intoarce intreg, fara sa se piarda sau sa se dubleze vreun rand", async () => {
    const u = unic();
    const randuri = [];
    for (let i = 1; i <= 1100; i += 1) {
      randuri.push({ asociatie_id: f.asociatieId, bloc_id: f.blocId, titlu: `Document C11 ${i}`, tip: "altul", cale: `c11/${u}/${i}.pdf` });
    }
    await ok(db("comunicare").from("documente").insert(randuri));
    const date = await adm.incarca();
    const aleMele = date.documente.filter((d) => d.titlu.startsWith("Document C11 "));
    expect(aleMele.length).toBe(1100);
    expect(new Set(aleMele.map((d) => d.id)).size).toBe(1100);
  });

  it("cererile catre sesizari, anunturi, documente, profiluri si liste_lunare pagineaza pe cheie, nu se opresc la 1000", async () => {
    const { cereri } = await cuTrafic(() => adm.incarca());
    for (const tabel of ["sesizari", "anunturi", "documente", "profiluri", "liste_lunare"]) {
      const ale = cererileCu(cereri, tabel);
      expect(ale.length).toBeGreaterThan(0);
      ale.forEach((c) => expect(c.url).toMatch(/order=id\./));
    }
    expect(cereri.some((c) => /[?&]offset=/.test(c.url))).toBe(false);
  });
});
