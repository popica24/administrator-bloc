// Ce folosesc toate Edge Function-urile: clientii Supabase, CORS, raspunsurile
// JSON si recunoasterea apelurilor facute de server (service_role).

// Versiune exacta, nu "@2" (X11): altfel o versiune noua de supabase-js, poate
// compromisa, ar intra in functii la urmatoarea pornire, fara nicio schimbare
// de cod. Se ridica manual, odata cu cea din package.json, si deno.lock ii
// pastreaza suma de control.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

// CORS (audit X09). Cu "*", orice pagina de pe internet putea chema functiile
// cu tokenul din browserul locatarului si citi raspunsul. Deschidem doar catre
// adresa aplicatiei (SITE_URL, aceeasi cu auth.site_url din config.toml) si
// catre localhost, pentru dezvoltare. Apelurile server catre server (webhook-ul
// procesatorului, cron-ul, seed-ul) nu trimit Origin: nu primesc antetul, dar
// nici nu sunt oprite, pentru ca CORS este o regula de browser.
const SITE = Deno.env.get("SITE_URL") ?? "http://localhost:5173";
const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function origineAcceptata(origine: string | null): boolean {
  if (!origine) return false;
  return origine === SITE || LOCALHOST.test(origine);
}

// Antetele CORS pentru cererea data. Fara Origin sau cu o origine straina,
// raspunsul pleaca fara Access-Control-Allow-Origin.
export function cors(req?: Request | null): Record<string, string> {
  const antete: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-semnatura",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    // raspunsul difera de la o origine la alta, deci nu se pune in cache comun
    Vary: "Origin",
  };
  const origine = req?.headers.get("Origin") ?? null;
  if (origineAcceptata(origine)) antete["Access-Control-Allow-Origin"] = origine as string;
  return antete;
}

// Porneste o Edge Function: raspunde singura la preflight-ul OPTIONS si pune
// antetele CORS potrivite originii pe orice raspuns care iese din handler.
// Un singur loc care decide CORS-ul, pentru toate functiile.
export function porneste(handler: (req: Request) => Response | Promise<Response>): void {
  Deno.serve(async (req) => {
    const antete = cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: antete });
    const r = await handler(req);
    const finale = new Headers(r.headers);
    for (const [cheie, valoare] of Object.entries(antete)) finale.set(cheie, valoare);
    return new Response(r.body, { status: r.status, headers: finale });
  });
}

export function raspuns(corp: unknown, status = 200): Response {
  return new Response(JSON.stringify(corp), { status, headers: { "Content-Type": "application/json" } });
}

export const eroare = (mesaj: string, status = 400) => raspuns({ eroare: mesaj }, status);

export const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!;
const CHEIE_SERVICIU = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHEIE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

// Client cu drepturi depline. Il folosesc doar comenzile de server, dupa ce
// au verificat cine cere.
export function clientServiciu(): SupabaseClient {
  return createClient(URL_SUPABASE, CHEIE_SERVICIU, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Client care actioneaza ca utilizatorul din cerere: RLS si verificarile din
// functiile SQL se aplica exact ca in aplicatie.
export function clientUtilizator(req: Request): SupabaseClient {
  return createClient(URL_SUPABASE, CHEIE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}

function rolDinJwt(jwt: string): string | null {
  try {
    const parte = jwt.split(".")[1];
    const json = atob(parte.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

// Cererea vine de la server (seed, dezvoltator, webhook-ul bazei de date).
// Gateway-ul a verificat deja semnatura JWT-ului (verify_jwt), deci rolul din
// el este de incredere.
export function esteServiciu(req: Request): boolean {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  return jwt === CHEIE_SERVICIU || rolDinJwt(jwt) === "service_role";
}

// Postgres intoarce numeric in JSON ca numar sau ca text; motorul vrea numere.
export function numere(obiect: Record<string, Record<string, unknown>> | null): Record<string, Record<string, number>> {
  const rez: Record<string, Record<string, number>> = {};
  Object.entries(obiect ?? {}).forEach(([k, v]) => {
    rez[k] = {};
    Object.entries(v ?? {}).forEach(([t, x]) => { rez[k][t] = Number(x); });
  });
  return rez;
}
