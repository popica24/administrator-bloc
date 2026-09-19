// SITE_URL lipseste din mediu (asa ruleaza stiva locala, care nu are secrete).
// Fisier separat, ca in secret-lipsa.test.ts: adresa se citeste o singura data,
// la importul lui _shared/server.ts, deci fiecare stare are nevoie de izolatul ei.
import { assertStrictEquals } from "jsr:@std/assert@1";

Deno.env.delete("SITE_URL");
Deno.env.set("SUPABASE_URL", "http://supabase.test");
Deno.env.set("SUPABASE_ANON_KEY", "cheie-anon-test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "cheie-serviciu-test");

const { origineAcceptata } = await import("../_shared/server.ts");

Deno.test("[X09] server: fara SITE_URL, CORS cade pe adresa din config.toml", () => {
  // auth.site_url din supabase/config.toml
  assertStrictEquals(origineAcceptata("http://localhost:5173"), true);
  assertStrictEquals(origineAcceptata("https://adminbloc.ro"), false);
});
