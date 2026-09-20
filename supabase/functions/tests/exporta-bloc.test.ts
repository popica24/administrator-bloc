// exporta-bloc: toate tabelele unui bloc intr-un singur JSON. Doar cu cheia de serviciu.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { type Apel, CHEIE_SERVICIU, citeste, cuFetch, eroarePg, incarcaHandler, json, JWT_SERVICIU, JWT_UTILIZATOR, URL_TEST } from "./ajutor.ts";

const handler = await incarcaHandler("../exporta-bloc/index.ts");

const B = "bloc-1";
const A = "asoc-1";
type Rand = Record<string, unknown>;
type Baza = Record<string, Rand[]>;

// Randurile "noastre" au id fara X; cele cu X sunt ale altui bloc si nu au voie in export.
function bazaDemo(): Baza {
  const r = (id: string, extra: Rand) => ({ id, ...extra });
  return {
    "organizare.blocuri": [r("bloc-1", { asociatie_id: A }), r("bloc-X", { asociatie_id: "asoc-X" })],
    "organizare.asociatii": [r("asoc-1", {}), r("asoc-X", {})],
    "organizare.apartamente": [r("ap1", { bloc_id: B }), r("ap2", { bloc_id: B }), r("apX", { bloc_id: "bloc-X" })],
    "organizare.apartamente_persoane": [r("pp1", { apartament_id: "ap1" }), r("pp2", { apartament_id: "ap2" }), r("ppX", { apartament_id: "apX" })],
    "organizare.inrolare_apartamente": [r("in1", { bloc_id: B }), r("inX", { bloc_id: "bloc-X" })],
    "organizare.contacte": [r("co1", { asociatie_id: A }), r("coX", { asociatie_id: "asoc-X" })],
    "identitate.membri_asociatie": [r("m1", { asociatie_id: A }), r("mX", { asociatie_id: "asoc-X" })],
    "identitate.locatari": [r("lo1", { bloc_id: B }), r("loX", { bloc_id: "bloc-X" })],
    "identitate.invitatii": [r("iv1", { apartament_id: "ap2", cod: "ABC123", folosita: false }), r("ivX", { apartament_id: "apX", cod: "ZZZ" })],
    "intretinere.furnizori": [r("fu1", { asociatie_id: A }), r("fuX", { asociatie_id: "asoc-X" })],
    "intretinere.cheltuieli_recurente": [r("cr1", { bloc_id: B }), r("crX", { bloc_id: "bloc-X" })],
    "intretinere.liste_lunare": [r("li1", { bloc_id: B }), r("liX", { bloc_id: "bloc-X" })],
    "intretinere.cheltuieli": [r("ch1", { lista_id: "li1" }), r("chX", { lista_id: "liX" })],
    "intretinere.repartizari": [r("re1", { bloc_id: B }), r("reX", { bloc_id: "bloc-X" })],
    "contorizare.setari_contorizare": [r("sc1", { bloc_id: B }), r("scX", { bloc_id: "bloc-X" })],
    "contorizare.contoare": [r("ct1", { bloc_id: B }), r("ctX", { bloc_id: "bloc-X" })],
    "contorizare.citiri": [r("ci1", { bloc_id: B }), r("ciX", { bloc_id: "bloc-X" })],
    "financiar.setari_financiare": [r("sf1", { asociatie_id: A }), r("sfX", { asociatie_id: "asoc-X" })],
    "financiar.conturi": [r("cn1", { bloc_id: B }), r("cnX", { bloc_id: "bloc-X" })],
    "financiar.datorii": [r("da1", { bloc_id: B }), r("daX", { bloc_id: "bloc-X" })],
    "financiar.plati": [r("pl1", { bloc_id: B }), r("plX", { bloc_id: "bloc-X" })],
    "financiar.alocari_plati": [r("al1", { plata_id: "pl1" }), r("alX", { plata_id: "plX" })],
    "financiar.chitante": [r("cht1", { plata_id: "pl1" }), r("chtX", { plata_id: "plX" })],
    "financiar.penalizari": [r("pe1", { datorie_id: "da1" }), r("peX", { datorie_id: "daX" })],
    "financiar.fonduri": [r("fo1", { bloc_id: B }), r("foX", { bloc_id: "bloc-X" })],
    "financiar.miscari_fond": [r("mf1", { fond_id: "fo1" }), r("mfX", { fond_id: "foX" })],
    "sesizari.sesizari": [r("se1", { bloc_id: B }), r("seX", { bloc_id: "bloc-X" })],
    "sesizari.sesizari_mesaje": [r("sm1", { sesizare_id: "se1" }), r("smX", { sesizare_id: "seX" })],
    "sesizari.sesizari_poze": [r("sp1", { sesizare_id: "se1" }), r("spX", { sesizare_id: "seX" })],
    "guvernanta.voturi": [r("vo1", { asociatie_id: A }), r("voX", { asociatie_id: "asoc-X" })],
    "guvernanta.voturi_optiuni": [r("vp1", { vot_id: "vo1" }), r("vpX", { vot_id: "voX" })],
    "guvernanta.voturi_exprimate": [r("ve1", { vot_id: "vo1" }), r("veX", { vot_id: "voX" })],
    "guvernanta.adunari_generale": [r("ag1", { asociatie_id: A }), r("agX", { asociatie_id: "asoc-X" })],
    "guvernanta.adunari_prezente": [r("ap-1", { adunare_id: "ag1" }), r("ap-X", { adunare_id: "agX" })],
    "comunicare.documente": [r("do1", { asociatie_id: A }), r("doX", { asociatie_id: "asoc-X" })],
    "comunicare.anunturi": [r("an1", { asociatie_id: A }), r("anX", { asociatie_id: "asoc-X" })],
    "comunicare.remindere_setari": [r("rs1", { asociatie_id: A }), r("rsX", { asociatie_id: "asoc-X" })],
  };
}

const MAX_ROWS = 1000; // max_rows din config.toml

// PostgREST fals: select=* cu un singur filtru in.(...), max_rows si paginare (offset/limit sau Range).
function postgrest(baza: Baza, o: { eroare?: string; gol?: string } = {}) {
  return (a: Apel): Response | undefined => {
    const m = a.url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m) return undefined;
    const cheie = `${a.antete.get("Accept-Profile")}.${m[1]}`;
    if (cheie === o.eroare) return eroarePg("permission denied", 403);
    if (cheie === o.gol) return new Response("", { status: 200 });
    const tabela = baza[cheie];
    if (!tabela) return json({ message: `relation ${cheie} does not exist` }, 404);
    let rez = tabela;
    for (const [col, val] of a.url.searchParams) {
      if (["select", "offset", "limit", "order"].includes(col)) continue;
      assert(val.startsWith("in.("), `filtru neasteptat ${col}=${val}`);
      const valori = val.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, ""));
      rez = rez.filter((r) => valori.includes(String(r[col])));
    }
    let start = Number(a.url.searchParams.get("offset") ?? 0);
    let cate = Number(a.url.searchParams.get("limit") ?? MAX_ROWS);
    const range = a.antete.get("Range")?.match(/^(\d+)-(\d+)$/);
    if (range) {
      start = Number(range[1]);
      cate = Number(range[2]) - start + 1;
    }
    return json(rez.slice(start, start + Math.min(cate, MAX_ROWS)));
  };
}

const exporta = (bloc: string | null = B, token = CHEIE_SERVICIU) =>
  handler(new Request(`${URL_TEST}/functions/v1/exporta-bloc${bloc === null ? "" : `?bloc_id=${bloc}`}`, {
    headers: { Authorization: `Bearer ${token}` },
  }));

Deno.test("exporta-bloc: OPTIONS raspunde cu CORS", async () => {
  const r = await handler(new Request(`${URL_TEST}/functions/v1/exporta-bloc`, { method: "OPTIONS" }));
  assertEquals(r.status, 200);
  assertEquals(await r.text(), "ok");
});

Deno.test("exporta-bloc: un administrator nu poate exporta -> 403", async () => {
  await cuFetch(postgrest(bazaDemo()), async (f) => {
    const r = await citeste(await exporta(B, JWT_UTILIZATOR));
    assertEquals(r.status, 403);
    assertEquals(r.corp, { eroare: "Doar dezvoltatorul exporta date." });
    assertEquals(f.apeluri.length, 0);
  });
});

// S6 (audit 2026-09-19, `_shared/server.ts`): esteServiciu are incredere in
// rolul din JWT fara sa-i verifice semnatura. Azi doar gateway-ul opreste un
// JWT inventat. Dupa reparatie: BUG_S6 = false.
const BUG_S6 = true;

Deno.test({
  name: "[S6] exporta-bloc: un JWT nesemnat cu role=service_role este refuzat",
  ignore: BUG_S6,
  fn: async () => {
    await cuFetch(postgrest(bazaDemo()), async (f) => {
      assertEquals((await exporta(B, JWT_SERVICIU)).status, 403);
      assertEquals(f.apeluri.length, 0);
    });
  },
});

Deno.test("exporta-bloc: fara bloc_id -> 400", async () => {
  await cuFetch(postgrest(bazaDemo()), async (f) => {
    const r = await citeste(await exporta(null));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Lipseste bloc_id." });
    assertEquals(f.apeluri.length, 0);
  });
});

Deno.test("exporta-bloc: bloc inexistent -> 404 dupa o singura citire", async () => {
  await cuFetch(postgrest(bazaDemo()), async (f) => {
    const r = await citeste(await exporta("bloc-necunoscut"));
    assertEquals(r.status, 404);
    assertEquals(r.corp, { eroare: "Blocul nu exista." });
    assertEquals(f.apeluri.length, 1);
  });
});

Deno.test("exporta-bloc: exporta fiecare tabela a blocului si nimic din alt bloc", async () => {
  const baza = bazaDemo();
  await cuFetch(postgrest(baza), async (f) => {
    const inainte = Date.now();
    const r = await citeste(await exporta());
    assertEquals(r.status, 200);
    assertEquals(r.corp.bloc_id, B);
    assert(Math.abs(Date.parse(r.corp.exportat_la) - inainte) < 5000);

    const exportate: string[] = [];
    for (const context of ["organizare", "identitate", "intretinere", "contorizare", "financiar", "sesizari", "guvernanta", "comunicare"]) {
      for (const [tabela, rand] of Object.entries(r.corp[context] as Record<string, Rand[]>)) {
        const cheie = `${context}.${tabela}`;
        exportate.push(cheie);
        const asteptat = baza[cheie].filter((x) => !String(x.id).endsWith("X"));
        assertEquals(rand, asteptat, cheie);
      }
    }
    // fiecare tabela din baza apare exact o data in export
    assertEquals(exportate.sort(), Object.keys(baza).sort());

    for (const a of f.apeluri) {
      assertEquals(a.metoda, "GET");
      assertEquals(a.url.searchParams.get("select"), "*");
      assertEquals(a.antete.get("Authorization"), `Bearer ${CHEIE_SERVICIU}`);
    }
    // radacinile agregatelor filtreaza dupa id-urile gasite
    const [pers] = f.apeluri.filter((a) => a.url.pathname.endsWith("/apartamente_persoane"));
    assertEquals(pers.url.searchParams.get("apartament_id"), "in.(ap1,ap2)");
  });
});

Deno.test("exporta-bloc: fara sesizari nu mai cere mesajele si pozele lor", async () => {
  const baza = bazaDemo();
  baza["sesizari.sesizari"] = [];
  await cuFetch(postgrest(baza), async (f) => {
    const r = await citeste(await exporta());
    assertEquals(r.status, 200);
    assertEquals(r.corp.sesizari, { sesizari: [], sesizari_mesaje: [], sesizari_poze: [] });
    assertEquals(f.apeluri.filter((a) => a.url.pathname.includes("sesizari_")).length, 0);
  });
});

Deno.test("exporta-bloc: un raspuns fara corp devine lista goala", async () => {
  await cuFetch(postgrest(bazaDemo(), { gol: "comunicare.anunturi" }), async () => {
    const r = await citeste(await exporta());
    assertEquals(r.status, 200);
    assertEquals(r.corp.comunicare.anunturi, []);
  });
});

Deno.test("exporta-bloc: o tabela care nu se poate citi -> 500 cu numele ei", async () => {
  await cuFetch(postgrest(bazaDemo(), { eroare: "guvernanta.voturi" }), async () => {
    const r = await citeste(await exporta());
    assertEquals(r.status, 500);
    assertEquals(r.corp, { eroare: "guvernanta.voturi: permission denied" });
  });
});

// ---------------------------------------------------------------- S9

function bazaMare(): Baza {
  const baza = bazaDemo();
  baza["intretinere.repartizari"] = Array.from({ length: 1500 }, (_, i) => ({ id: `re${i}`, bloc_id: B }));
  baza["financiar.plati"] = Array.from({ length: 600 }, () => ({ id: crypto.randomUUID(), bloc_id: B }));
  return baza;
}

// S9 (audit 2026-09-19): exportul nu pagineaza, deci max_rows = 1000 taie
// datele fara avertisment, URL-urile `.in()` cresc peste orice limita, iar
// codurile invitatiilor active ies din baza. Dupa reparatie: BUG_S9 = false.
const BUG_S9 = true;

Deno.test({
  name: "[S9] exporta-bloc: exporta toate randurile (paginat) si pastreaza URL-urile scurte",
  ignore: BUG_S9,
  fn: async () => {
    await cuFetch(postgrest(bazaMare()), async (f) => {
      const r = await citeste(await exporta());
      assertEquals(r.corp.intretinere.repartizari.length, 1500);
      assertEquals(r.corp.financiar.plati.length, 600);
      for (const a of f.apeluri) assert(a.url.href.length < 8000, `url de ${a.url.href.length} caractere`);
    });
  },
});

Deno.test({
  name: "[S9] exporta-bloc: codurile invitatiilor active nu ies din baza",
  ignore: BUG_S9,
  fn: async () => {
    await cuFetch(postgrest(bazaDemo()), async () => {
      const r = await citeste(await exporta());
      for (const i of r.corp.identitate.invitatii) assertEquals(i.cod, undefined);
    });
  },
});
