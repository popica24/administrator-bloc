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
  adm = (await intraCa(f.adminTelefon)).s;
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
    const loc = (await intraCa(f.conturi.loc.telefon)).s;
    const { cereri } = await cuTrafic(() => loc.incarca());
    const persoane = cererileCu(cereri, "apartamente_persoane").flatMap((c) => c.randuri || []);
    expect(persoane.length).toBeGreaterThan(0);
    expect(new Set(persoane.map((p) => p.apartament_id))).toEqual(new Set([f.ap["1"]]));
  });
});

describe("G13: toate() nu se opreste la o pagina scurta, ca sa nu para sfarsitul", () => {
  /* PAGINA (1000) e egal cu max_rows-ul implicit al PostgREST din
     supabase/config.toml. toate() se oprea cand o pagina venea mai scurta
     decat PAGINA, corect cat timp server-ul intoarce mereu exact ce i se
     cere, dar gresit daca max_rows scade sub PAGINA: server-ul ar limita
     fiecare cerere la mai putin, iar prima pagina "scurta" ar parea sfarsitul,
     desi mai sunt randuri. Aici simulam exact acel server, printr-un
     intermediar care taie fiecare raspuns la un prag mai mic decat PAGINA. */
  it("chiar daca serverul intoarce mai putine randuri decat pragul cerut, toate() continua pana la o pagina chiar goala", async () => {
    const izolat = await creeazaBloc();
    const admIzolat = (await intraCa(izolat.adminTelefon)).s;
    const randuri = [];
    for (let i = 1; i <= 5; i += 1) {
      randuri.push({ asociatie_id: izolat.asociatieId, bloc_id: izolat.blocId, titlu: `Document G13 ${i}`, tip: "altul", cale: `g13/${izolat.id}/${i}.pdf` });
    }
    await ok(db("comunicare").from("documente").insert(randuri));

    const CAP_SERVER = 2;
    const date = await cuFetch(async (url, init, original) => {
      if (!url.includes("/rest/v1/documente?")) return undefined;
      const r = await original(url, init);
      const corp = await r.clone().json();
      if (!Array.isArray(corp) || corp.length <= CAP_SERVER) return r;
      return new Response(JSON.stringify(corp.slice(0, CAP_SERVER)), { status: r.status, headers: r.headers });
    }, () => admIzolat.incarca());

    expect(date.documente.length).toBe(5);
    expect(new Set(date.documente.map((d) => d.id)).size).toBe(5);
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

/* [K17] Furnizorii si locatarii blocului nu treceau prin toate(): peste
   max_rows (1000) se pierdeau tacut, iar randurile veneau in ordinea fizica a
   tabelei. Soldurile fondurilor si legaturile locatarului cu apartamentele lui
   nu aveau nicio ordine, deci cardurile de fond si alegerea apartamentului se
   puteau reaseza de la o incarcare la alta. */
describe("[K17] furnizorii, locatarii, fondurile si legaturile vin intregi si in aceeasi ordine", () => {
  beforeAll(async () => {
    const randuri = [];
    for (let i = 1; i <= 1100; i += 1) randuri.push({ asociatie_id: f.asociatieId, denumire: `Furnizor K17 ${i}` });
    await ok(db("intretinere").from("furnizori").insert(randuri));
  });

  it("peste 1000 de furnizori se intorc toti, nu doar prima pagina", async () => {
    const date = await adm.incarca();
    expect(date.furnizori.filter((x) => x.denumire.startsWith("Furnizor K17 ")).length).toBe(1100);
  });

  /* Ordonate dupa id (un UUID aleator), fondurile ajungeau pe CI in alta
     ordine decat pe un laptop, iar ecranul inregistra iesirea in celalalt
     fond. Ordinea trebuie sa aiba sens si sa fie cea din sursa demo:
     furnizorii in ordinea adaugarii, fondurile reparatii apoi rulment. Id-urile
     alese aici fac ordinea dupa id sa fie exact invers. */
  it("furnizorii vin in ordinea adaugarii, fondurile reparatii apoi rulment, nu dupa id", async () => {
    /* primele 8 caractere stabilesc ordinea dupa id; restul, unic la fiecare rulare */
    const cuPrefix = (p) => `${p}${crypto.randomUUID().slice(8)}`;
    const primul = cuPrefix("ffffffff");
    const alDoilea = cuPrefix("00000000");
    await ok(db("intretinere").from("furnizori").insert({ id: primul, asociatie_id: f.asociatieId, denumire: "K17 adaugat primul" }));
    await ok(db("intretinere").from("furnizori").insert({ id: alDoilea, asociatie_id: f.asociatieId, denumire: "K17 adaugat al doilea" }));
    await ok(db("financiar").from("fonduri").update({ id: cuPrefix("00000000") }).eq("bloc_id", f.blocId).eq("tip", "rulment"));
    await ok(db("financiar").from("fonduri").update({ id: cuPrefix("ffffffff") }).eq("bloc_id", f.blocId).eq("tip", "reparatii"));

    const date = await adm.incarca();
    const ids = date.furnizori.map((x) => x.id);
    expect(ids.indexOf(primul)).toBeLessThan(ids.indexOf(alDoilea));
    expect(date.fonduri.map((x) => x.tip)).toEqual(["reparatii", "rulment"]);
  });

  it("locatarii si soldurile fondurilor se cer ordonate, la administrator", async () => {
    const { cereri } = await cuTrafic(() => adm.incarca());
    for (const cale of ["locatari", "fonduri_solduri"]) {
      const ale = cererileCu(cereri, cale);
      expect(ale.length, cale).toBeGreaterThan(0);
      ale.forEach((c) => expect(c.url, cale).toMatch(/[?&]order=/));
    }
  });

  it("legaturile locatarului cu apartamentele lui se cer ordonate", async () => {
    const loc = (await intraCa(f.conturi.loc.telefon)).s;
    const { cereri } = await cuTrafic(() => loc.incarca());
    const ale = cererileCu(cereri, "locatari");
    expect(ale.length).toBeGreaterThan(0);
    ale.forEach((c) => expect(c.url).toMatch(/[?&]order=/));
  });
});
