/* Concurenta reala pe bani si pe evenimente (audit 2: T5).

   Pana acum concurenta era trecuta la "ce e in regula" fara niciun test, iar
   cea mai apropiata verificare se uita la pozitia textului `for update` in
   codul sursa al functiei. Aici doua sesiuni chiar se bat pe aceleasi randuri:
   prin PostgREST (fiecare cerere = alta conexiune, alta tranzactie) si prin
   doua sesiuni psql, cand testul are nevoie sa tina o tranzactie deschisa.

   Sesiunile psql merg prin containerul bazei locale, acelasi pe care il
   porneste `supabase start`. */
import { execFile, spawn } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { creeazaBloc, db, intraCa, lunaDelta, ok, pdf, serviciu, zi1 } from "./fixture.js";

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_AdministratorBloc";
const ARGS = ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-qAt"];

const psql = (sql) => new Promise((rezolva, respinge) => {
  execFile("docker", [...ARGS, "-v", "ON_ERROR_STOP=1", "-c", sql], (e, out, err) => (e ? respinge(new Error(err || e.message)) : rezolva(out.trim())));
});

/* O sesiune psql care ramane deschisa, ca sa poata tine o tranzactie */
function sesiune() {
  const p = spawn("docker", ARGS);
  let text = "";
  p.stdout.on("data", (d) => { text += d; });
  p.stderr.on("data", (d) => { text += d; });
  return {
    scrie: (sql) => p.stdin.write(`${sql}\n`),
    text: () => text,
    inchide: () => new Promise((r) => { p.on("close", r); p.stdin.end(); }),
  };
}

const asteapta = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function pana(conditie, limita = 8000) {
  const gata = Date.now() + limita;
  for (;;) {
    if (await conditie()) return true;
    if (Date.now() > gata) return false;
    await asteapta(100);
  }
}

/* pg_locks nu poate fi filtrat dupa "randul blocat de sesiunea a": alte sesiuni
   (jobul pg_cron de fiecare minut, fixture-urile altor fisiere de test care
   ruleaza in paralel pe aceeasi baza, chiar webhook-ul care anunta un eveniment
   nou) pot tine in acelasi moment un RowShareLock pe alt rand din acelasi
   tabel. Numarand doar dupa `relname` si `mode`, testul lua acel lock strain
   drept dovada ca sesiunea noastra a apucat randul, si pornea cursa prea
   devreme. Legam verificarea de backend-ul exact al sesiunii. */
async function pidSesiune(s) {
  s.scrie("select pg_backend_pid();");
  await pana(() => /^\d+\s*$/m.test(s.text()));
  return Number(s.text().match(/^(\d+)\s*$/m)[1]);
}

async function tineLocul(pid, relatie) {
  return pana(async () => (await psql(
    `select count(*) from pg_locks l join pg_class c on c.oid = l.relation
      where l.pid = ${pid} and c.relname = '${relatie}' and l.mode = 'RowShareLock' and l.granted`)) !== "0");
}

let f;
let adm;

beforeAll(async () => {
  f = await creeazaBloc({ locatari: [{ cheie: "loc", apartament: "1" }] });
  adm = (await intraCa(f.adminEmail)).s;
});

describe("banii: doua incasari in acelasi moment", () => {
  it("chitantele primesc numere consecutive, fara goluri si fara duplicate", async () => {
    const apartamente = ["1", "2", "2A", "10"].map((n) => f.ap[n]);
    const plati = await Promise.all([...apartamente, ...apartamente].map((ap) => adm.inregistreazaNumerar(ap, 10)));
    expect(plati.length).toBe(8);

    const chitante = await ok(db("financiar").from("chitante").select("numar, serie, plata_id").in("plata_id", plati.map((p) => p.plataId)));
    expect(chitante.length).toBe(8);
    const numere = chitante.map((c) => c.numar).sort((a, b) => a - b);
    expect(new Set(numere).size).toBe(8);
    expect(numere).toEqual([...Array(8).keys()].map((i) => numere[0] + i));
    expect(new Set(chitante.map((c) => c.serie)).size).toBe(1);
  });

  it("acelasi cont, sase incasari simultane: alocarile nu trec peste datorie", async () => {
    const ap = f.ap["2"];
    const datorie = await ok(db("financiar").from("datorii").insert({
      apartament_id: ap, bloc_id: f.blocId, tip: "intretinere", luna: zi1(lunaDelta(-1)),
      suma: 300, scadenta: `${lunaDelta(-1)}-25`, descriere: "Intretinere pentru testul de concurenta",
    }).select().single());

    await Promise.all([...Array(6).keys()].map(() => adm.inregistreazaNumerar(ap, 50)));

    const alocari = await ok(db("financiar").from("alocari_plati").select("plata_id, suma").eq("datorie_id", datorie.id));
    const total = alocari.reduce((s, a) => s + Number(a.suma), 0);
    expect(total).toBeLessThanOrEqual(300);
    expect(new Set(alocari.map((a) => a.plata_id)).size).toBe(alocari.length);
    /* Datoria s-a stins exact, fara sa fie platita de doua ori */
    const rest = await ok(db("financiar").from("datorii_rest").select("rest").eq("id", datorie.id).single());
    expect(Number(rest.rest)).toBe(0);
  });
});

describe("fondul de reparatii: doua iesiri simultane nu il duc pe minus (G1)", () => {
  /* financiar.inregistreaza_iesire_fond citea soldul cu un simplu sum(),
     fara niciun lock, spre deosebire de restul codului de bani (conturi, for
     update). Doua iesiri concurente, fiecare pentru tot soldul, vedeau
     amandoua acelasi sold vechi, treceau amandoua verificarea si soldul
     ajungea pe minus. Reprodus manual inainte de reparatie (doua sesiuni
     psql, aceeasi logica, fara lock): soldul de 1000 a ajuns la -1000 dupa
     doua iesiri de cate 1000, fiecare crezand ca e singura. */
  it("a doua iesire asteapta lock-ul fondului si vede soldul proaspat, nu unul vechi", async () => {
    const dinainte = await adm.incarca();
    const fond = dinainte.fonduri.find((x) => x.tip === "reparatii");
    await ok(db("financiar").from("miscari_fond").insert({
      fond_id: fond.id, data: dinainte.azi, suma: 500, descriere: "Contributii pentru testul de concurenta",
    }));
    const doc = await ok(db("comunicare").from("documente").insert({
      asociatie_id: f.asociatieId, bloc_id: f.blocId, titlu: "Factura test concurenta G1", tip: "factura",
      cale: `${f.asociatieId}/${f.blocId}/concurenta-fond-${Date.now()}.pdf`, vizibil_locatarilor: true, incarcat_de: f.adminId,
    }).select().single());

    const a = sesiune();
    let inchisa = false;
    try {
      const pidA = await pidSesiune(a);
      a.scrie("begin;");
      a.scrie(`select financiar.inregistreaza_iesire_fond('${fond.id}', -300, 'Iesire A concurenta', current_date, '${doc.id}');`);
      /* A a executat iesirea si asteapta comanda urmatoare, tinand tranzactia
         (si lock-ul luat inauntru) deschisa. */
      const aTerminat = await pana(async () => (await psql(
        `select state from pg_stat_activity where pid = ${pidA}`)) === "idle in transaction");
      expect(aTerminat).toBe(true);

      /* B cere mai mult decat ramane dupa A (500 - 300 = 200): daca ar vedea
         soldul vechi de 500 (fara sa astepte lock-ul lui A), ar trece gresit.
         Verificarea nu se uita la rezultatul lui B (ar trece si fara lock,
         daca ar rula complet inaintea sau dupa A), ci la faptul ca backend-ul
         lui B chiar asteapta un lock cat timp A tine tranzactia deschisa —
         proba directa ca cererile pentru acelasi fond se serializeaza. */
      /* .catch aici prinde rejectia imediat (poate sosi cat asteptam mai jos),
         ca sa nu ramana "unhandled" intre momentul in care se intampla si
         momentul in care o verificam. */
      const b = adm.inregistreazaIesireFond({
        fondId: fond.id, suma: -250, descriere: "Iesire B concurenta", data: dinainte.azi, fisier: pdf("iesire-b-concurenta.pdf"),
      }).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
      const bAsteapta = await pana(async () => (await psql(
        `select count(*) from pg_stat_activity
          where wait_event_type = 'Lock' and query like '%inregistreaza_iesire_fond%' and pid <> ${pidA}`)) !== "0");
      expect(bAsteapta).toBe(true);

      a.scrie("commit;");
      inchisa = true;
      await a.inchide();

      const rezultatB = await b;
      expect(rezultatB.ok).toBe(false);
      expect(rezultatB.e.message).toMatch(/l-ar duce pe minus/);

      const dupa = await adm.incarca();
      const f2 = dupa.fonduri.find((x) => x.id === fond.id);
      expect(f2.sold).toBe(200);
    } finally {
      if (!inchisa) {
        a.scrie("rollback;");
        await a.inchide();
      }
    }
  });
});

describe("cotele blocului: o redistribuire si o inrolare noua nu duc suma peste 100 (G8)", () => {
  /* organizare.schimba_cotele_blocului numara apartamentele si scrie cotele
     noi fara niciun lock: daca intre numarare si scriere se confirma o
     inrolare noua (organizare.confirma_inrolare, singura cale prin care apar
     apartamente noi pe un bloc), verificarea "lista acopera exact
     apartamentele blocului" lucreaza pe numarul vechi, iar blocul ramane cu
     apartamentul nou, in afara redistribuirii, si suma cotelor trece de 100. */
  let f8;
  let adm8;

  beforeAll(async () => {
    f8 = await creeazaBloc();
    adm8 = (await intraCa(f8.adminEmail)).s;
  });

  it("schimbaCoteleBlocului asteapta inrolarea in curs si vede apartamentul nou aparut", async () => {
    const inainte = await adm8.incarca();
    const cote = inainte.apartamente.map((ap) => ({ apartamentId: ap.id, cota: ap.cota }));

    const randInrolare = await ok(db("organizare").from("inrolare_apartamente").insert({
      bloc_id: f8.blocId, numar: "99", sursa: "operator",
      date: { etaj: 0, proprietar: "Proprietar Nou G8", persoane: 1, cota: 10 },
    }).select().single());

    const a = sesiune();
    let inchisa = false;
    try {
      const pidA = await pidSesiune(a);
      a.scrie("begin;");
      a.scrie(`select organizare.confirma_inrolare('${randInrolare.id}');`);
      const aTerminat = await pana(async () => (await psql(
        `select state from pg_stat_activity where pid = ${pidA}`)) === "idle in transaction");
      expect(aTerminat).toBe(true);

      /* B redistribuie cotele celor 4 apartamente vechi, fara sa stie de
         apartamentul nou aparut sub A. */
      const b = adm8.schimbaCoteleBlocului(cote).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
      const bAsteapta = await pana(async () => (await psql(
        `select count(*) from pg_stat_activity
          where wait_event_type = 'Lock' and query like '%schimba_cotele_blocului%' and pid <> ${pidA}`)) !== "0");
      expect(bAsteapta).toBe(true);

      a.scrie("commit;");
      inchisa = true;
      await a.inchide();

      const rezultatB = await b;
      expect(rezultatB.ok).toBe(false);
      expect(rezultatB.e.message).toBe(
        "Lista trebuie sa contina o singura cota pentru fiecare apartament din bloc, fara lipsuri sau duplicate.");

      const dupa = await adm8.incarca();
      expect(dupa.apartamente.length).toBe(inainte.apartamente.length + 1);
      for (const ap of inainte.apartamente) {
        expect(dupa.apartamente.find((x) => x.id === ap.id).cota).toBe(ap.cota);
      }
    } finally {
      if (!inchisa) {
        a.scrie("rollback;");
        await a.inchide();
      }
    }
  });
});

describe("evenimente: doi consumatori pe acelasi rand", () => {
  let idEveniment;

  beforeAll(async () => {
    /* Un eveniment fara consumator (CitireTransmisa), pus inapoi in coada.
       incercari = 10 il scoate din raza jobului pg_cron, care ia doar randurile
       cu incercari < 10, ca sa nu ni-l proceseze el intre timp.

       INSERT-ul de mai jos porneste si trigger-ul `coada_anunta_functia`, care
       cheama prin pg_net webhook-ul real (Edge Function `proceseaza-eveniment`)
       pe acelasi rand, asincron. Daca am face reset-ul de mai jos imediat, acel
       webhook ramane "in zbor" si poate ajunge sa proceseze randul chiar in
       timpul testelor de mai jos (mai probabil sub incarcare, cand pg_net si
       runtime-ul de Edge Functions sunt ocupate cu evenimentele altor fisiere
       de test rulate in paralel pe aceeasi baza). Nu e de ajuns sa asteptam
       `incercari > 0`: jobul pg_cron de fiecare minut poate proceza si el
       randul (tot cu incercari < 10) inaintea webhook-ului, ceea ce ne-ar
       pacali sa credem ca "singurul consumator automat" si-a facut treaba cand
       de fapt cererea originala e inca in coada lui pg_net. Asteptam raspunsul
       chiar al acelei cereri (net._http_response, cu id-ul nostru in corp),
       singurul semnal ca livrarea declansata de INSERT chiar s-a incheiat. */
    const loc = (await intraCa(f.conturi.loc.email)).s;
    const contor = (await loc.incarca()).contoare.find((c) => c.tip === "rece");
    await loc.transmiteCitire({ apartamentId: f.ap["1"], luna: lunaDelta(0), indexuri: [{ contorId: contor.id, index: 99 }] });
    idEveniment = await psql(`select id from evenimente.coada where tip = 'CitireTransmisa' and (date ->> 'bloc_id') = '${f.blocId}' order by id desc limit 1`);
    expect(idEveniment).toMatch(/^\d+$/);

    const raspunsSosit = await pana(async () => (await psql(
      `select exists(select 1 from net._http_response where content::jsonb ->> 'id' = '${idEveniment}')`)) === "t", 20000);
    expect(raspunsSosit).toBe(true);

    await psql(`update evenimente.coada set procesat_la = null, incercari = 10 where id = ${idEveniment}`);
  });

  it("randul blocat de alta sesiune este sarit, nu asteptat (skip locked)", async () => {
    const a = sesiune();
    try {
      const pidA = await pidSesiune(a);
      a.scrie("begin;");
      a.scrie(`select id from evenimente.coada where id = ${idEveniment} for update;`);
      expect(await tineLocul(pidA, "coada")).toBe(true);

      const inceput = Date.now();
      const rezultat = await psql(`select evenimente.proceseaza(${idEveniment})`);
      const durata = Date.now() - inceput;
      expect(rezultat).toBe("f");
      expect(durata).toBeLessThan(3000);
      expect(await psql(`select procesat_la is null from evenimente.coada where id = ${idEveniment}`)).toBe("t");
    } finally {
      a.scrie("rollback;");
      await a.inchide();
    }
  });

  it("doua apeluri simultane il proceseaza o singura data", async () => {
    const [unu, doi] = await Promise.all([
      ok(serviciu.rpc("proceseaza_eveniment", { p_id: Number(idEveniment) })),
      ok(serviciu.rpc("proceseaza_eveniment", { p_id: Number(idEveniment) })),
    ]);
    expect([unu, doi].filter(Boolean).length).toBe(1);
    const rand = await psql(`select (procesat_la is not null)::text || ' ' || incercari from evenimente.coada where id = ${idEveniment}`);
    expect(rand).toBe("true 11");
  });
});

describe("penalizarile blocheaza contul inainte sa citeasca restul (F7)", () => {
  it("calculul asteapta lock-ul contului, in loc sa lucreze pe un rest vechi", async () => {
    const ap = f.ap["2A"];
    await ok(db("financiar").from("datorii").insert({
      apartament_id: ap, bloc_id: f.blocId, tip: "intretinere", luna: zi1(lunaDelta(-4)),
      suma: 200, scadenta: `${lunaDelta(-4)}-25`, descriere: "Datorie veche pentru testul de concurenta",
    }));

    const a = sesiune();
    const b = sesiune();
    try {
      const pidA = await pidSesiune(a);
      a.scrie("begin;");
      a.scrie(`select 1 from financiar.conturi where apartament_id = '${ap}' for update;`);
      expect(await tineLocul(pidA, "conturi")).toBe(true);

      /* Calculul ruleaza in alta sesiune, intr-o tranzactie anulata la final, ca
         sa nu lase penalizari in baza locala. */
      const pidB = await pidSesiune(b);
      b.scrie("begin;");
      b.scrie("select 'inceput' as pas;");
      b.scrie("select financiar.calculeaza_penalizari(current_date) as penalizari;");

      const blocat = await pana(async () => (await psql(
        `select count(*) from pg_stat_activity
          where pid = ${pidB} and wait_event_type = 'Lock' and query like '%calculeaza_penalizari%'`)) !== "0");
      expect(blocat).toBe(true);
      expect(b.text()).not.toMatch(/penalizari/);

      a.scrie("rollback;");
      expect(await pana(async () => /inceput/.test(b.text()) && /\n/.test(b.text().split("inceput")[1] || ""))).toBe(true);
    } finally {
      a.scrie("rollback;");
      b.scrie("rollback;");
      await Promise.all([a.inchide(), b.inchide()]);
    }
  });
});
