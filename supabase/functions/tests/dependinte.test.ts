// Lantul de aprovizionare al Edge Function-urilor (audit 2026-09-20, X11).
// `npm:@supabase/supabase-js@2` inseamna "orice 2.x de azi": o versiune noua,
// eventual compromisa, ar intra in productie la urmatoarea pornire a functiei,
// fara ca cineva sa schimbe o linie de cod. Aici cerem versiuni exacte si un
// deno.lock care chiar contine intrarea npm, cu suma ei de control.
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

const RADACINA = new URL("../../../", import.meta.url);
const FUNCTII = new URL("supabase/functions/", RADACINA);

async function surse(dir: URL, gasite: URL[] = []): Promise<URL[]> {
  for await (const intrare of Deno.readDir(dir)) {
    const cale = new URL(intrare.name + (intrare.isDirectory ? "/" : ""), dir);
    if (intrare.isDirectory) {
      if (intrare.name !== "tests") await surse(cale, gasite);
    } else if (/\.(ts|js)$/.test(intrare.name)) {
      gasite.push(cale);
    }
  }
  return gasite;
}

const fisiere = await surse(FUNCTII);
const lock = JSON.parse(await Deno.readTextFile(new URL("deno.lock", RADACINA)));

Deno.test("[X11] dependinte: gasim sursele Edge Function-urilor", () => {
  assert(fisiere.length >= 5, `doar ${fisiere.length} fisiere gasite`);
});

Deno.test("[X11] dependinte: niciun import npm: sau jsr: fara versiune exacta", async () => {
  const flotante: string[] = [];
  for (const f of fisiere) {
    const text = await Deno.readTextFile(f);
    for (const m of text.matchAll(/from "((?:npm|jsr):[^"]+)"/g)) {
      const specificator = m[1];
      // exact inseamna nume@x.y.z, fara ^, ~ sau doar major
      if (!/@\d+\.\d+\.\d+$/.test(specificator)) flotante.push(`${f.pathname}: ${specificator}`);
    }
  }
  assertEquals(flotante, []);
});

Deno.test("[X11] dependinte: deno.lock are intrarea npm pentru supabase-js", () => {
  const specificatori: Record<string, string> = lock.specifiers ?? {};
  const cheie = Object.keys(specificatori).find((k) => k.startsWith("npm:@supabase/supabase-js@"));
  assert(cheie, `specifiers din deno.lock nu contine supabase-js: ${Object.keys(specificatori).join(", ")}`);
  assertMatch(specificatori[cheie], /^\d+\.\d+\.\d+$/);

  const npm: Record<string, { integrity?: string }> = lock.npm ?? {};
  const pachet = `@supabase/supabase-js@${specificatori[cheie]}`;
  assert(pachet in npm, `deno.lock nu are npm["${pachet}"]`);
  assert(npm[pachet].integrity, `npm["${pachet}"] nu are suma de control`);
});

Deno.test("[X11] dependinte: aceeasi versiune in Edge Functions si in aplicatie", async () => {
  const server = await Deno.readTextFile(new URL("_shared/server.ts", FUNCTII));
  const versiune = server.match(/npm:@supabase\/supabase-js@(\d+\.\d+\.\d+)/)?.[1];
  assert(versiune, "server.ts nu are o versiune exacta de supabase-js");
  const pkg = JSON.parse(await Deno.readTextFile(new URL("package.json", RADACINA)));
  // package.json are un interval (^2.116.0); functiile trebuie sa stea pe acelasi minor
  assertEquals(pkg.dependencies["@supabase/supabase-js"].replace(/^[\^~]/, ""), versiune);
});
