import { assertEquals } from "jsr:@std/assert@1";
import { cerere, citeste, cuFetch, eroarePg, incarcaHandler, JWT_SERVICIU, JWT_UTILIZATOR, json, CHEIE_SERVICIU } from "./ajutor.ts";

const handler = await incarcaHandler("../proceseaza-eveniment/index.ts");

Deno.test("proceseaza-eveniment: OPTIONS raspunde cu 200", async () => {
  const r = await citeste(await handler(cerere("proceseaza-eveniment", { metoda: "OPTIONS" })));
  assertEquals(r.status, 200);
  assertEquals(r.corp, "ok");
  // ce origini primesc antetul Allow-Origin: cors.test.ts
});

Deno.test("proceseaza-eveniment: refuza un utilizator obisnuit cu 403, fara sa atinga baza", async () => {
  await cuFetch(() => undefined, async (f) => {
    const r = await citeste(await handler(cerere("proceseaza-eveniment", { token: JWT_UTILIZATOR, corp: { id: 5 } })));
    assertEquals(r.status, 403);
    assertEquals(r.corp, { eroare: "Doar serverul proceseaza evenimente." });
    assertEquals(f.apeluri.length, 0);
  });
});

Deno.test("proceseaza-eveniment: cu id proceseaza doar evenimentul acela", async () => {
  await cuFetch((a) => a.url.pathname === "/rest/v1/rpc/proceseaza_eveniment" ? json(true) : undefined, async (f) => {
    const r = await citeste(await handler(cerere("proceseaza-eveniment", { token: CHEIE_SERVICIU, corp: { id: 42 } })));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { id: 42, procesat: true });
    const [apel] = f.catre("/rest/v1/rpc/proceseaza_eveniment");
    assertEquals(apel.corp, { p_id: 42 });
    assertEquals(apel.antete.get("Authorization"), `Bearer ${CHEIE_SERVICIU}`);
    assertEquals(f.apeluri.length, 1);
  });
});

Deno.test("proceseaza-eveniment: eroarea functiei SQL pentru un id devine 500", async () => {
  await cuFetch(() => eroarePg("eveniment necunoscut"), async () => {
    const r = await citeste(await handler(cerere("proceseaza-eveniment", { token: JWT_SERVICIU, corp: { id: 7 } })));
    assertEquals(r.status, 500);
    assertEquals(r.corp, { eroare: "eveniment necunoscut" });
  });
});

Deno.test("proceseaza-eveniment: fara id proceseaza restantele", async () => {
  await cuFetch((a) => a.url.pathname === "/rest/v1/rpc/proceseaza_evenimente_restante" ? json(3) : undefined, async (f) => {
    const r = await citeste(await handler(cerere("proceseaza-eveniment", { token: JWT_SERVICIU, corp: {} })));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { procesate: 3 });
    assertEquals(f.apeluri.length, 1);
  });
});

Deno.test("proceseaza-eveniment: corp care nu e JSON inseamna tot restantele", async () => {
  await cuFetch((a) => a.url.pathname === "/rest/v1/rpc/proceseaza_evenimente_restante" ? json(0) : undefined, async (f) => {
    const r = await citeste(await handler(cerere("proceseaza-eveniment", { token: JWT_SERVICIU, corp: "nu e json" })));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { procesate: 0 });
    assertEquals(f.catre("/rest/v1/rpc/proceseaza_eveniment").length, 0);
  });
});

Deno.test("proceseaza-eveniment: eroarea la restante devine 500", async () => {
  await cuFetch(() => eroarePg("coada blocata", 500), async () => {
    const r = await citeste(await handler(cerere("proceseaza-eveniment", { token: JWT_SERVICIU })));
    assertEquals(r.status, 500);
    assertEquals(r.corp, { eroare: "coada blocata" });
  });
});
