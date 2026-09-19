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
import { creeazaBloc, db, intraCa, lunaDelta, ok, serviciu, zi1 } from "./fixture.js";

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

describe("evenimente: doi consumatori pe acelasi rand", () => {
  let idEveniment;

  beforeAll(async () => {
    /* Un eveniment fara consumator (CitireTransmisa), pus inapoi in coada.
       incercari = 10 il scoate din raza jobului pg_cron, care ia doar randurile
       cu incercari < 10, ca sa nu ni-l proceseze el intre timp. */
    const loc = (await intraCa(f.conturi.loc.email)).s;
    const contor = (await loc.incarca()).contoare.find((c) => c.tip === "rece");
    await loc.transmiteCitire({ apartamentId: f.ap["1"], luna: lunaDelta(0), indexuri: [{ contorId: contor.id, index: 99 }] });
    idEveniment = await psql(`select id from evenimente.coada where tip = 'CitireTransmisa' and (date ->> 'bloc_id') = '${f.blocId}' order by id desc limit 1`);
    expect(idEveniment).toMatch(/^\d+$/);
    await psql(`update evenimente.coada set procesat_la = null, incercari = 10 where id = ${idEveniment}`);
  });

  it("randul blocat de alta sesiune este sarit, nu asteptat (skip locked)", async () => {
    const a = sesiune();
    a.scrie("begin;");
    a.scrie(`select id from evenimente.coada where id = ${idEveniment} for update;`);
    expect(await pana(async () => (await psql(
      `select count(*) from pg_locks l join pg_class c on c.oid = l.relation
        where c.relname = 'coada' and l.mode = 'RowShareLock' and l.granted`)) !== "0")).toBe(true);

    const inceput = Date.now();
    const rezultat = await psql(`select evenimente.proceseaza(${idEveniment})`);
    const durata = Date.now() - inceput;
    expect(rezultat).toBe("f");
    expect(durata).toBeLessThan(3000);
    expect(await psql(`select procesat_la is null from evenimente.coada where id = ${idEveniment}`)).toBe("t");

    a.scrie("rollback;");
    await a.inchide();
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
    a.scrie("begin;");
    a.scrie(`select 1 from financiar.conturi where apartament_id = '${ap}' for update;`);
    expect(await pana(async () => (await psql(
      `select count(*) from pg_locks l join pg_class c on c.oid = l.relation
        where c.relname = 'conturi' and l.mode = 'RowShareLock' and l.granted`)) !== "0")).toBe(true);

    /* Calculul ruleaza in alta sesiune, intr-o tranzactie anulata la final, ca
       sa nu lase penalizari in baza locala. */
    const b = sesiune();
    b.scrie("begin;");
    b.scrie("select 'inceput' as pas;");
    b.scrie("select financiar.calculeaza_penalizari(current_date) as penalizari;");

    const blocat = await pana(async () => (await psql(
      `select count(*) from pg_stat_activity
        where wait_event_type = 'Lock' and query like '%calculeaza_penalizari%'`)) !== "0");
    expect(blocat).toBe(true);
    expect(b.text()).not.toMatch(/penalizari/);

    a.scrie("rollback;");
    await a.inchide();
    expect(await pana(async () => /inceput/.test(b.text()) && /\n/.test(b.text().split("inceput")[1] || ""))).toBe(true);
    b.scrie("rollback;");
    await b.inchide();
  });
});
