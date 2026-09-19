// supabase/config.toml: setarile de autentificare pe care nu le poate observa
// niciun test functional (le aplica Supabase Auth, nu codul nostru). Testul
// citeste fisierul si cere valorile, ca o slabire sa nu treaca neobservata.
// Audit 2026-09-20: X03 (parola, confirmarea emailului, captcha) si X04
// (sesiuni care expira, schimbarea parolei cu parola veche).
import { assert, assertEquals } from "jsr:@std/assert@1";

const CONFIG = await Deno.readTextFile(new URL("../../config.toml", import.meta.url));

// Citeste o cheie dintr-o sectiune TOML ([auth], [auth.email], ...).
// Intoarce null daca sectiunea sau cheia lipsesc ori sunt comentate.
function setare(sectiune: string, cheie: string): string | null {
  const linii = CONFIG.split(/\r?\n/);
  let in_sectiune = false;
  for (const rand of linii) {
    const curat = rand.trim();
    if (curat.startsWith("[")) {
      in_sectiune = curat === `[${sectiune}]`;
      continue;
    }
    if (!in_sectiune || curat.startsWith("#")) continue;
    const egal = curat.indexOf("=");
    if (egal < 0) continue;
    if (curat.slice(0, egal).trim() !== cheie) continue;
    return curat.slice(egal + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return null;
}

Deno.test("config: ajutorul de citire gaseste doar cheile active din sectiunea ceruta", () => {
  assertEquals(setare("auth", "site_url"), "http://localhost:5173");
  assertEquals(setare("auth", "cheie-inexistenta"), null);
  assertEquals(setare("sectiune-inexistenta", "site_url"), null);
  // enable_signup exista in [auth], [auth.email] si [auth.sms], cu valori diferite
  assertEquals(setare("auth.sms", "enable_signup"), "false");
});

// ---------------------------------------------------------------- X03

Deno.test("[X03] config: emailul trebuie confirmat inainte de autentificare", () => {
  assertEquals(setare("auth.email", "enable_confirmations"), "true");
});

Deno.test("[X03] config: parola are cel putin 10 caractere", () => {
  const minim = Number(setare("auth", "minimum_password_length"));
  assert(minim >= 10, `minimum_password_length = ${minim}`);
});

Deno.test("[X03] config: parola cere litere mari, mici si cifre", () => {
  const cerinte = setare("auth", "password_requirements");
  assert(
    cerinte === "lower_upper_letters_digits" || cerinte === "lower_upper_letters_digits_symbols",
    `password_requirements = ${JSON.stringify(cerinte)}`,
  );
});

Deno.test("[X03] config: captcha e documentata in fisier, ca decizie luata", () => {
  // Captcha (hcaptcha / turnstile) cere o cheie de la furnizor, deci nu se poate
  // activa aici. Cerem doar ca sectiunea si decizia sa fie scrise in fisier.
  assert(CONFIG.includes("[auth.captcha]"), "lipseste sectiunea [auth.captcha]");
  assert(CONFIG.includes("X03"), "lipseste nota despre captcha (X03) in config.toml");
});

// ---------------------------------------------------------------- X04

Deno.test("[X04] config: schimbarea parolei cere parola veche", () => {
  assertEquals(setare("auth.email", "secure_password_change"), "true");
});

Deno.test("[X04] config: sesiunea expira si dupa inactivitate, si absolut", () => {
  assertEquals(setare("auth.sessions", "timebox"), "24h");
  assertEquals(setare("auth.sessions", "inactivity_timeout"), "8h");
});

Deno.test("[X04] config: tokenul de acces nu tine mai mult de o ora", () => {
  const expirare = Number(setare("auth", "jwt_expiry"));
  assert(expirare > 0 && expirare <= 3600, `jwt_expiry = ${expirare}`);
});

// ---------------------------------------------------------------- X09

Deno.test("[X09] config: site_url e adresa pe care o accepta si CORS-ul functiilor", () => {
  // _shared/server.ts cade pe aceeasi adresa cand SITE_URL lipseste din mediu.
  assertEquals(setare("auth", "site_url"), "http://localhost:5173");
});
