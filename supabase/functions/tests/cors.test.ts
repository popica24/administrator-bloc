// CORS (audit 2026-09-20, X09). Antetul `Access-Control-Allow-Origin: *` lasa
// orice pagina de pe internet sa cheme functiile cu tokenul din browserul
// locatarului. Aici verificam, pe toate functiile deodata, ca raspunsul pleaca
// deschis doar catre adresa aplicatiei si catre localhost-ul de dezvoltare.
import { assertEquals } from "jsr:@std/assert@1";
import { type Handler, incarcaHandler, URL_SITE, URL_TEST } from "./ajutor.ts";

const FUNCTII = [
  "creeaza-asociatie",
  "exporta-bloc",
  "proceseaza-eveniment",
  "publica-lista",
] as const;

const handlere: Record<string, Handler> = {};
for (const f of FUNCTII) handlere[f] = await incarcaHandler(`../${f}/index.ts`);

const preflight = (f: string, origine?: string) =>
  handlere[f](new Request(`${URL_TEST}/functions/v1/${f}`, {
    method: "OPTIONS",
    headers: origine === undefined ? {} : { Origin: origine },
  }));

for (const f of FUNCTII) {
  Deno.test(`[X09] ${f}: o origine straina nu primeste Access-Control-Allow-Origin`, async () => {
    const r = await preflight(f, "https://atacator.test");
    assertEquals(r.status, 200);
    assertEquals(r.headers.get("Access-Control-Allow-Origin"), null);
    await r.body?.cancel();
  });

  Deno.test(`[X09] ${f}: adresa aplicatiei primeste exact acea origine`, async () => {
    const r = await preflight(f, URL_SITE);
    assertEquals(r.headers.get("Access-Control-Allow-Origin"), URL_SITE);
    assertEquals(r.headers.get("Vary"), "Origin");
    await r.body?.cancel();
  });
}

Deno.test("[X09] CORS: localhost-ul de dezvoltare este acceptat pe orice port", async () => {
  for (const o of ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost"]) {
    const r = await preflight("publica-lista", o);
    assertEquals(r.headers.get("Access-Control-Allow-Origin"), o, o);
    await r.body?.cancel();
  }
});

Deno.test("[X09] CORS: originile care doar seamana cu localhost sunt refuzate", async () => {
  for (const o of ["http://localhost.atacator.test", "https://localhost:5173", "http://127.0.0.1.atacator.test", "null"]) {
    const r = await preflight("publica-lista", o);
    assertEquals(r.headers.get("Access-Control-Allow-Origin"), null, o);
    await r.body?.cancel();
  }
});

Deno.test("[X09] CORS: o cerere fara Origin (server catre server) merge mai departe", async () => {
  // Cron-ul nu trimite Origin. CORS nu il priveste: nu primeste antetul, dar
  // nici nu este oprit.
  const r = await preflight("proceseaza-eveniment");
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(await r.text(), "ok");
});

Deno.test("[X09] CORS: antetele cerute de aplicatie raman permise", async () => {
  const r = await preflight("publica-lista", URL_SITE);
  const antete = (r.headers.get("Access-Control-Allow-Headers") ?? "").split(", ");
  for (const a of ["authorization", "apikey", "content-type"]) {
    assertEquals(antete.includes(a), true, a);
  }
  assertEquals(r.headers.get("Access-Control-Allow-Methods"), "POST, GET, OPTIONS");
  await r.body?.cancel();
});

Deno.test("[X09] CORS: si raspunsul unei cereri reale, nu doar preflight-ul, e legat de origine", async () => {
  const strain = await handlere["proceseaza-eveniment"](
    new Request(`${URL_TEST}/functions/v1/proceseaza-eveniment`, { method: "POST", headers: { Origin: "https://atacator.test" } }),
  );
  assertEquals(strain.status, 403);
  assertEquals(strain.headers.get("Access-Control-Allow-Origin"), null);
  await strain.body?.cancel();

  const acasa = await handlere["proceseaza-eveniment"](
    new Request(`${URL_TEST}/functions/v1/proceseaza-eveniment`, { method: "POST", headers: { Origin: URL_SITE } }),
  );
  assertEquals(acasa.status, 403);
  assertEquals(acasa.headers.get("Access-Control-Allow-Origin"), URL_SITE);
  assertEquals(acasa.headers.get("Content-Type"), "application/json");
  assertEquals(await acasa.json(), { eroare: "Doar serverul proceseaza evenimente." });
});
