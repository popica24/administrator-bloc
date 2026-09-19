// _shared/server.ts: CORS, raspunsuri, recunoasterea serverului, conversia la numere.
import { assertEquals, assertStrictEquals } from "jsr:@std/assert@1";
import { CHEIE_ANON, CHEIE_SERVICIU, cuFetch, json, jwtFals, JWT_SERVICIU, JWT_UTILIZATOR, URL_SITE, URL_TEST } from "./ajutor.ts";
import { clientServiciu, clientUtilizator, cors, eroare, esteServiciu, numere, origineAcceptata, raspuns, URL_SUPABASE } from "../_shared/server.ts";

const cu = (autorizare?: string) =>
  new Request("http://x/", { headers: autorizare === undefined ? {} : { Authorization: autorizare } });

Deno.test("server: URL_SUPABASE vine din mediu", () => {
  assertEquals(URL_SUPABASE, URL_TEST);
});

Deno.test("server: raspuns are implicit 200 si JSON", async () => {
  const r = raspuns({ a: 1 });
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("Content-Type"), "application/json");
  // antetele CORS le pune porneste(), in functie de originea cererii: cors.test.ts
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(await r.json(), { a: 1 });
});

Deno.test("server: origineAcceptata citeste SITE_URL din mediu", () => {
  assertStrictEquals(origineAcceptata(URL_SITE), true);
  assertStrictEquals(origineAcceptata("http://localhost:5173"), true);
  assertStrictEquals(origineAcceptata("https://alta.test"), false);
  assertStrictEquals(origineAcceptata(null), false);
});

Deno.test("server: cors fara cerere nu deschide nimic", () => {
  const antete = cors();
  assertEquals(antete["Access-Control-Allow-Origin"], undefined);
  assertEquals(antete["Access-Control-Allow-Headers"].split(", ").includes("x-semnatura"), true);
});

Deno.test("server: eroare are implicit 400, altfel statusul dat", async () => {
  const r = eroare("gresit");
  assertEquals(r.status, 400);
  assertEquals(await r.json(), { eroare: "gresit" });
  assertEquals(eroare("x", 418).status, 418);
});

Deno.test("server: esteServiciu fara antet sau cu Bearer gol este fals", () => {
  assertStrictEquals(esteServiciu(cu()), false);
  assertStrictEquals(esteServiciu(cu("Bearer ")), false);
  assertStrictEquals(esteServiciu(cu("")), false);
});

Deno.test("server: esteServiciu recunoaste cheia exacta, cu orice forma de Bearer", () => {
  assertStrictEquals(esteServiciu(cu(`Bearer ${CHEIE_SERVICIU}`)), true);
  assertStrictEquals(esteServiciu(cu(`bearer   ${CHEIE_SERVICIU}`)), true);
  assertStrictEquals(esteServiciu(cu(CHEIE_SERVICIU)), true);
});

Deno.test("server: esteServiciu refuza cheia anon, JWT-ul de utilizator si gunoiul", () => {
  assertStrictEquals(esteServiciu(cu(`Bearer ${CHEIE_ANON}`)), false);
  assertStrictEquals(esteServiciu(cu(`Bearer ${JWT_UTILIZATOR}`)), false);
  assertStrictEquals(esteServiciu(cu("Bearer a.%%%.b")), false); // atob arunca
  assertStrictEquals(esteServiciu(cu("Bearer a.bm90IGpzb24.b")), false); // "not json"
  assertStrictEquals(esteServiciu(cu(`Bearer ${jwtFals({ sub: "fara-rol" })}`)), false); // role lipseste
});

// S6 (audit 2026-09-19, `_shared/server.ts`): esteServiciu decodeaza JWT-ul
// fara sa-i verifice semnatura. Azi tine doar pentru ca gateway-ul verifica
// semnatura inaintea functiei; cu verify_jwt = false nu ar mai tine nimic.
// Dupa reparatie: BUG_S6 = false si testul incepe sa ruleze.
const BUG_S6 = true;

Deno.test({
  name: "[S6] server: un JWT cu role=service_role dar semnatura falsa nu este serviciu",
  ignore: BUG_S6,
  fn: () => {
    assertStrictEquals(esteServiciu(cu(`Bearer ${JWT_SERVICIU}`)), false);
  },
});

Deno.test("server: numere converteste text si numar, pe doua niveluri", () => {
  assertEquals(numere({ a1: { rece: "1.5", calda: 2 }, a2: null as unknown as Record<string, unknown> }), {
    a1: { rece: 1.5, calda: 2 },
    a2: {},
  });
  assertEquals(numere(null), {});
});

Deno.test("server: clientServiciu trimite cheia de serviciu, clientUtilizator tokenul cererii", async () => {
  await cuFetch(() => json([]), async (f) => {
    await clientServiciu().from("t").select("*");
    await clientUtilizator(cu(`Bearer ${JWT_UTILIZATOR}`)).from("t").select("*");
    await clientUtilizator(cu()).from("t").select("*");
    assertEquals(f.apeluri[0].antete.get("Authorization"), `Bearer ${CHEIE_SERVICIU}`);
    assertEquals(f.apeluri[0].antete.get("apikey"), CHEIE_SERVICIU);
    assertEquals(f.apeluri[1].antete.get("Authorization"), `Bearer ${JWT_UTILIZATOR}`);
    assertEquals(f.apeluri[1].antete.get("apikey"), CHEIE_ANON);
    // fara antet: clientul cade pe cheia anon, deci RLS vede un anonim
    assertEquals(f.apeluri[2].antete.get("apikey"), CHEIE_ANON);
    assertEquals(f.apeluri[2].antete.get("Authorization") === `Bearer ${CHEIE_SERVICIU}`, false);
  });
});
