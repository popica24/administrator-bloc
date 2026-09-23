// Integrare cu stiva locala (supabase start + functiile servite). Doar cereri
// care nu schimba nimic in baza.
//
// T6 (audit 2026-09-20): inainte, testele se sareau singure cand stiva nu
// raspundea, deci suita era verde si cand nimic nu fusese verificat. Acum:
//   - fara SUPABASE_URL_LOCAL in mediu -> testele se sar, cu un nume care spune
//     cum se pornesc (dezvoltatorul care nu are Docker pornit nu e blocat);
//   - cu SUPABASE_URL_LOCAL setat -> testele ruleaza si cad zgomotos daca stiva
//     nu raspunde, daca `supabase status` nu merge sau daca lipsesc cheile.
// CI o seteaza dupa `supabase start`, deci acolo nu se sare niciodata.
//
// Variabila nu se poate numi SUPABASE_URL: ajutor.ts o suprascrie cu adresa
// backend-ului fals, pentru toate celelalte fisiere de test din acelasi proces.
import { assertEquals } from "jsr:@std/assert@1";
import { jwtFals } from "./ajutor.ts";

const STIVA = Deno.env.get("SUPABASE_URL_LOCAL") ?? null;
const FUNCTII = `${(STIVA ?? "http://127.0.0.1:54321").replace(/\/+$/, "")}/functions/v1`;

type Chei = { anon: string; serviciu: string };
let cerute: Promise<Chei> | null = null;

// Cheile stivei locale, cerute o singura data. Orice esec iese ca eroare de test.
function chei(): Promise<Chei> {
  cerute ??= (async (): Promise<Chei> => {
    let r: Response;
    try {
      r = await fetch(`${FUNCTII}/proceseaza-eveniment`, { method: "OPTIONS", signal: AbortSignal.timeout(5000) });
    } catch (e) {
      throw new Error(`Stiva locala nu raspunde la ${FUNCTII} (SUPABASE_URL_LOCAL). Porneste-o cu "supabase start". Cauza: ${(e as Error).message}`);
    }
    await r.body?.cancel();
    if (r.status !== 200) throw new Error(`Stiva locala a raspuns ${r.status} la OPTIONS ${FUNCTII}/proceseaza-eveniment; asteptam 200.`);

    const out = await new Deno.Command("supabase", { args: ["status", "-o", "env"], stdout: "piped", stderr: "piped" }).output();
    if (!out.success) throw new Error(`"supabase status" a esuat: ${new TextDecoder().decode(out.stderr).trim()}`);
    const env = new TextDecoder().decode(out.stdout);
    const ia = (k: string) => env.match(new RegExp(`^${k}="?([^"\\n]+)"?$`, "m"))?.[1];
    const anon = ia("ANON_KEY"), serviciu = ia("SERVICE_ROLE_KEY");
    if (!anon || !serviciu) throw new Error('"supabase status" nu a dat ANON_KEY si SERVICE_ROLE_KEY.');
    return { anon, serviciu };
  })();
  return cerute;
}

const eticheta = (name: string) =>
  STIVA === null ? `integrare (sarit: seteaza SUPABASE_URL_LOCAL si porneste stiva): ${name}` : `integrare: ${name}`;

const test = (name: string, fn: (k: Chei) => Promise<void>) =>
  Deno.test({ name: eticheta(name), ignore: STIVA === null, fn: async () => await fn(await chei()) });

async function cere(cale: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const r = await fetch(`${FUNCTII}/${cale}`, { ...init, headers });
  const text = await r.text();
  let corp: unknown = text;
  try { corp = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, corp, antete: r.headers };
}

test("toate functiile sunt servite si raspund la OPTIONS", async () => {
  for (const f of ["creeaza-asociatie", "exporta-bloc", "proceseaza-eveniment", "publica-lista"]) {
    const r = await cere(f, { method: "OPTIONS" });
    assertEquals(r.status, 200, f);
  }
});

test("[X09] raspunsul real trece prin porneste(), deci prin decizia de CORS", async ({ anon }) => {
  // Atentie: edge runtime-ul din `supabase start` rescrie el
  // Access-Control-Allow-Origin in "*" pe raspunsurile locale, oricare ar fi
  // originea, deci aici nu se poate verifica antetul in sine (o face
  // cors.test.ts, pe handler). Ce se poate verifica este ca raspunsul vine din
  // noul invelis: el adauga "Vary: Origin".
  const r = await cere("proceseaza-eveniment", { method: "POST", token: anon, body: "{}" });
  assertEquals(r.status, 403);
  assertEquals((r.antete.get("Vary") ?? "").includes("Origin"), true, r.antete.get("Vary") ?? "");
});

test("proceseaza-eveniment refuza cheia anon", async ({ anon }) => {
  assertEquals((await cere("proceseaza-eveniment", { method: "POST", token: anon, body: "{}" })).status, 403);
});

test("creeaza-asociatie refuza cheia anon", async ({ anon }) => {
  assertEquals((await cere("creeaza-asociatie", { method: "POST", token: anon, body: "{}" })).status, 403);
});

test("publica-lista cere un utilizator autentificat", async ({ anon }) => {
  const l = await cere("publica-lista", { method: "POST", token: anon, body: JSON.stringify({ lista_id: crypto.randomUUID() }) });
  assertEquals(l.status, 401);
});

test("exporta-bloc cu cheia de serviciu: bloc inexistent -> 404", async ({ serviciu }) => {
  const r = await cere(`exporta-bloc?bloc_id=${crypto.randomUUID()}`, { token: serviciu });
  assertEquals(r.status, 404);
  assertEquals(r.corp, { eroare: "Blocul nu exista." });
});

test("gateway-ul (verify_jwt) opreste un JWT nesemnat cu role=service_role", async () => {
  // Singurul lucru care tine azi bug-ul S6 sub control. Ramane adevarat si dupa
  // repararea lui, deci testul nu e legat de S6.
  const r = await cere(`exporta-bloc?bloc_id=${crypto.randomUUID()}`, { token: jwtFals({ role: "service_role" }) });
  assertEquals(r.status, 401);
});
