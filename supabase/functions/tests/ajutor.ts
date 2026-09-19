// Ajutoare pentru testele Edge Function-urilor.
// - mediul (SUPABASE_URL, cheile) se seteaza la importul acestui fisier, deci
//   inainte ca _shared/server.ts sa citeasca variabilele;
// - Deno.serve este inlocuit cat timp se importa functia, ca handlerul sa
//   poata fi apelat direct cu un Request;
// - fetch este inlocuit cu un backend fals (PostgREST, Auth, Functions) care
//   inregistreaza fiecare apel, ca testele sa verifice si ce iese din functie.

export const URL_TEST = "http://supabase.test";
// Adresa aplicatiei, singura origine straina de localhost pe care CORS o accepta.
export const URL_SITE = "http://aplicatie.test";
export const CHEIE_ANON = "cheie-anon-test";
export const CHEIE_SERVICIU = "cheie-serviciu-test";
export const SECRET_TEST = "secret-procesator-test";
export const SECRET_IMPLICIT = "procesator-local-doar-pentru-dezvoltare";

Deno.env.set("SUPABASE_URL", URL_TEST);
Deno.env.set("SUPABASE_ANON_KEY", CHEIE_ANON);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", CHEIE_SERVICIU);
Deno.env.set("SITE_URL", URL_SITE);

export type Handler = (req: Request) => Response | Promise<Response>;

// Importa un index.ts si intoarce handlerul dat lui Deno.serve.
export async function incarcaHandler(cale: string): Promise<Handler> {
  let prins: Handler | null = null;
  const original = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (h: Handler) => {
    prins = h;
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {}, addr: {} };
  };
  try {
    await import(cale);
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).serve = original;
  }
  if (!prins) throw new Error(`${cale} nu a apelat Deno.serve`);
  return prins;
}

// ---------------------------------------------------------------- JWT-uri

function b64url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Un JWT nesemnat (semnatura inventata): exact ce ar trimite un atacator.
export function jwtFals(payload: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.semnatura-falsa`;
}

export const JWT_SERVICIU = jwtFals({ role: "service_role", iss: "supabase-demo", nota: "???>>>" });
export const JWT_UTILIZATOR = jwtFals({ role: "authenticated", sub: "utilizator-1" });

// ---------------------------------------------------------------- cereri

export function cerere(
  cale: string,
  { metoda = "POST", token, corp, antete = {} }: { metoda?: string; token?: string; corp?: unknown; antete?: Record<string, string> } = {},
): Request {
  const h = new Headers(antete);
  if (token !== undefined) h.set("Authorization", `Bearer ${token}`);
  let body: string | undefined;
  if (corp !== undefined) {
    body = typeof corp === "string" ? corp : JSON.stringify(corp);
    h.set("Content-Type", "application/json");
  }
  return new Request(`${URL_TEST}/functions/v1/${cale}`, { method: metoda, headers: h, body });
}

// deno-lint-ignore no-explicit-any
export async function citeste(r: Response): Promise<{ status: number; corp: any; antete: Headers }> {
  const text = await r.text();
  let corp: unknown = text;
  try {
    corp = JSON.parse(text);
  } catch { /* text simplu, ex. "ok" la OPTIONS */ }
  // deno-lint-ignore no-explicit-any
  return { status: r.status, corp: corp as any, antete: r.headers };
}

// ---------------------------------------------------------------- fetch fals

export type Apel = {
  url: URL;
  metoda: string;
  antete: Headers;
  text: string;
  // deno-lint-ignore no-explicit-any
  corp: any;
};

export type Ruta = (a: Apel) => Response | Promise<Response> | undefined | Promise<Response | undefined>;

export function json(corp: unknown, status = 200, antete: Record<string, string> = {}): Response {
  return new Response(corp === undefined ? "" : JSON.stringify(corp), {
    status,
    headers: { "Content-Type": "application/json", ...antete },
  });
}

// Raspunsul PostgREST pentru o eroare de functie SQL.
export const eroarePg = (mesaj: string, status = 400) => json({ message: mesaj, code: "P0001", details: null, hint: null }, status);

// Instaleaza fetch-ul fals. Orice apel fara ruta cade cu 599, ca testul sa-l vada.
export function fetchFals(ruta: Ruta) {
  const original = globalThis.fetch;
  const apeluri: Apel[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const text = req.body ? await req.text() : "";
    let corp: unknown = null;
    try {
      corp = text ? JSON.parse(text) : null;
    } catch {
      corp = text;
    }
    const apel: Apel = { url: new URL(req.url), metoda: req.method, antete: req.headers, text, corp };
    apeluri.push(apel);
    const r = await ruta(apel);
    return r ?? json({ message: `fara ruta pentru ${req.method} ${req.url}` }, 599);
  };
  return {
    apeluri,
    restaureaza: () => {
      globalThis.fetch = original;
    },
    // apelurile catre o cale (ex. "/rest/v1/rpc/creeaza_asociatie")
    catre: (cale: string) => apeluri.filter((a) => a.url.pathname === cale),
  };
}

// Ruleaza fn cu fetch-ul fals si il restaureaza oricum s-ar termina.
export async function cuFetch<T>(ruta: Ruta, fn: (f: ReturnType<typeof fetchFals>) => Promise<T>): Promise<T> {
  const f = fetchFals(ruta);
  try {
    return await fn(f);
  } finally {
    f.restaureaza();
  }
}

// PostgREST: .single() cere un obiect prin Accept; altfel raspunde cu lista.
export function randuri(a: Apel, lista: unknown[]): Response {
  if ((a.antete.get("Accept") ?? "").includes("vnd.pgrst.object")) {
    if (lista.length !== 1) return json({ message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" }, 406);
    return json(lista[0]);
  }
  return json(lista);
}

export async function hmacHex(secret: string, text: string): Promise<string> {
  const cheie = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const semn = await crypto.subtle.sign("HMAC", cheie, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(semn)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
