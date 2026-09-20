// plata-card-webhook cu PROCESATOR_SECRET setat (cum trebuie sa ruleze in productie).
import { assertEquals } from "jsr:@std/assert@1";
import { cerere, citeste, cuFetch, eroarePg, hmacHex, incarcaHandler, json, SECRET_IMPLICIT, SECRET_TEST } from "./ajutor.ts";

Deno.env.set("PROCESATOR_SECRET", SECRET_TEST);
const handler = await incarcaHandler("../plata-card-webhook/index.ts");

const RPC = "/rest/v1/rpc/confirma_plata_card";

async function semnat(corp: unknown, secret = SECRET_TEST) {
  const text = JSON.stringify(corp);
  return cerere("plata-card-webhook", { corp: text, antete: { "x-semnatura": await hmacHex(secret, text) } });
}

Deno.test("webhook: OPTIONS raspunde cu CORS", async () => {
  const r = await citeste(await handler(cerere("plata-card-webhook", { metoda: "OPTIONS" })));
  assertEquals(r.status, 200);
  assertEquals(r.antete.get("Access-Control-Allow-Headers")?.includes("x-semnatura"), true);
});

Deno.test("webhook: GET este refuzat cu 405", async () => {
  const r = await citeste(await handler(cerere("plata-card-webhook", { metoda: "GET" })));
  assertEquals(r.status, 405);
  assertEquals(r.corp, { eroare: "Metoda nu este permisa." });
});

for (const [caz, antete] of [
  ["fara semnatura", {}],
  ["semnatura gresita", { "x-semnatura": "00".repeat(32) }],
  ["semnatura de un caracter", { "x-semnatura": "a" }],
  ["semnatura care nu e hex", { "x-semnatura": "zz".repeat(32) }],
] as const) {
  Deno.test(`webhook: ${caz} -> 401 si nicio confirmare`, async () => {
    await cuFetch(() => json(1), async (f) => {
      const r = await citeste(await handler(cerere("plata-card-webhook", { corp: { referinta: "SIM-1", stare: "autorizata" }, antete })));
      assertEquals(r.status, 401);
      assertEquals(r.corp, { eroare: "Semnatura nu este valida." });
      assertEquals(f.apeluri.length, 0);
    });
  });
}

Deno.test("webhook: semnatura cu secretul implicit nu trece cand secretul e setat", async () => {
  await cuFetch(() => json(1), async (f) => {
    const r = await handler(await semnat({ referinta: "SIM-1", stare: "autorizata" }, SECRET_IMPLICIT));
    assertEquals(r.status, 401);
    assertEquals(f.apeluri.length, 0);
  });
});

Deno.test("webhook: corpul schimbat dupa semnare -> 401", async () => {
  await cuFetch(() => json(1), async (f) => {
    const original = JSON.stringify({ referinta: "SIM-1", stare: "refuzata", suma: 10 });
    const semnatura = await hmacHex(SECRET_TEST, original);
    const falsificat = original.replace("refuzata", "autorizata");
    const r = await handler(cerere("plata-card-webhook", { corp: falsificat, antete: { "x-semnatura": semnatura } }));
    assertEquals(r.status, 401);
    assertEquals(f.apeluri.length, 0);
  });
});

Deno.test("webhook: plata autorizata se confirma prin confirma_plata_card", async () => {
  await cuFetch((a) => a.url.pathname === RPC ? json("plata-77") : undefined, async (f) => {
    const r = await citeste(await handler(await semnat({ referinta: "SIM-ABC", stare: "autorizata", suma: 250 })));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { plataId: "plata-77", primit: true });
    const [apel] = f.catre(RPC);
    assertEquals(apel.antete.get("Content-Profile"), "financiar");
    assertEquals(apel.corp, { p_procesator: "simulat", p_referinta: "SIM-ABC", p_reusita: true });
  });
});

Deno.test("webhook: plata refuzata se inregistreaza ca nereusita", async () => {
  await cuFetch((a) => a.url.pathname === RPC ? json("plata-78") : undefined, async (f) => {
    const r = await citeste(await handler(await semnat({ referinta: "SIM-REF", stare: "refuzata", suma: 250 })));
    assertEquals(r.status, 200);
    assertEquals(f.catre(RPC)[0].corp.p_reusita, false);
  });
});

Deno.test("webhook: o stare necunoscuta nu confirma plata", async () => {
  await cuFetch((a) => a.url.pathname === RPC ? json("plata-79") : undefined, async (f) => {
    await handler(await semnat({ referinta: "SIM-X", stare: "AUTORIZATA" }));
    assertEquals(f.catre(RPC)[0].corp.p_reusita, false);
  });
});

Deno.test("webhook: acelasi mesaj primit de doua ori raspunde la fel (idempotenta e in SQL)", async () => {
  await cuFetch((a) => a.url.pathname === RPC ? json("plata-80") : undefined, async (f) => {
    const corp = { referinta: "SIM-DUBLU", stare: "autorizata", suma: 10 };
    const r1 = await citeste(await handler(await semnat(corp)));
    const r2 = await citeste(await handler(await semnat(corp)));
    assertEquals(r1, r2);
    assertEquals(f.catre(RPC).length, 2);
    assertEquals(f.catre(RPC)[0].corp, f.catre(RPC)[1].corp);
  });
});

Deno.test("webhook: eroarea din confirma_plata_card devine 409", async () => {
  await cuFetch(() => eroarePg("Plata SIM-NU nu exista."), async () => {
    const r = await citeste(await handler(await semnat({ referinta: "SIM-NU", stare: "autorizata" })));
    assertEquals(r.status, 409);
    assertEquals(r.corp, { eroare: "Plata SIM-NU nu exista." });
  });
});

// SUMA-WEBHOOK: fara ID de audit, gasit de suita Deno. Procesatorul spune ce
// suma a autorizat, dar functia nu o trimite mai departe, deci nimeni nu compara
// suma autorizata cu suma platii create. Cere o schimbare de semnatura in SQL
// (p_suma in confirma_plata_card), deci nu se repara din Edge Function.
const BUG_SUMA_WEBHOOK = true;

Deno.test({
  name: "[SUMA-WEBHOOK] webhook: suma confirmata de procesator se trimite spre comparare cu suma platii",
  ignore: BUG_SUMA_WEBHOOK,
  fn: async () => {
    await cuFetch((a) => a.url.pathname === RPC ? json("plata-82") : undefined, async (f) => {
      await handler(await semnat({ referinta: "SIM-S", stare: "autorizata", suma: 1 }));
      assertEquals(f.catre(RPC)[0].corp.p_suma, 1);
    });
  },
});

// N3 (audit 2026-09-19): un corp semnat corect, dar care nu e JSON, arunca din
// handler in loc sa raspunda 400. Procesatorul ar reincerca la nesfarsit.
Deno.test("[N3] webhook: corp semnat care nu e JSON -> 400, fara confirmare", async () => {
  await cuFetch(() => json(1), async (f) => {
    const text = "nu e json";
    const r = await citeste(await handler(cerere("plata-card-webhook", { corp: text, antete: { "x-semnatura": await hmacHex(SECRET_TEST, text) } })));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Corpul mesajului nu este JSON." });
    assertEquals(f.apeluri.length, 0);
  });
});
