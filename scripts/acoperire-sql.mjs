/* Acoperirea testelor SQL.
   Postgres nu masoara acoperirea pe linii pentru plpgsql, asa ca masuram
   trasabilitatea: fiecare functie, fiecare mesaj de eroare (raise exception)
   si fiecare politica RLS din migratii trebuie sa apara in cel putin un test
   pgTAP din supabase/tests/. Un test o citeaza prin numele complet al functiei
   (schema.nume), prin textul erorii (pana la primul %) sau prin numele
   politicii intre ghilimele.
   Iesire 1 daca acoperirea este sub 100%. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const radacina = new URL("..", import.meta.url).pathname;
const citesteDir = (dir, ext) => readdirSync(join(radacina, dir), { recursive: true })
  .filter((f) => f.endsWith(ext))
  .map((f) => readFileSync(join(radacina, dir, f), "utf8"));

const migratii = citesteDir("supabase/migrations", ".sql").join("\n");
let teste = "";
try {
  teste = citesteDir("supabase/tests", ".sql").join("\n");
} catch {
  teste = "";
}
const testeMici = teste.toLowerCase();

const unice = (arr) => [...new Set(arr)];

const functii = unice([...migratii.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_0-9]+)\s*\(/gi)]
  .map((m) => m[1].toLowerCase()));

const erori = unice([...migratii.matchAll(/raise\s+exception\s+'((?:[^']|'')*)'/gi)]
  .map((m) => m[1].replace(/''/g, "'").split("%")[0].trim())
  .filter((t) => t.length >= 8));

const politici = unice([...migratii.matchAll(/create\s+policy\s+"([^"]+)"/gi)].map((m) => m[1]));

const verifica = (nume, lista, gasit) => {
  const lipsa = lista.filter((x) => !gasit(x));
  const pct = lista.length ? ((lista.length - lipsa.length) / lista.length) * 100 : 100;
  console.log(`${nume.padEnd(10)} ${String(lista.length - lipsa.length).padStart(4)} / ${String(lista.length).padEnd(4)} ${pct.toFixed(1)}%`);
  return lipsa;
};

console.log("Acoperirea testelor SQL (supabase/tests)\n");
const lipsaF = verifica("functii", functii, (f) => testeMici.includes(f));
const lipsaE = verifica("erori", erori, (e) => teste.includes(e));
const lipsaP = verifica("politici", politici, (p) => teste.includes(`"${p}"`) || teste.includes(`'${p}'`));

const toate = [...lipsaF.map((x) => `functie  ${x}`), ...lipsaE.map((x) => `eroare   ${x}`), ...lipsaP.map((x) => `politica ${x}`)];
if (toate.length) {
  console.log("\nNeacoperite:");
  toate.forEach((x) => console.log(`  ${x}`));
  process.exit(1);
}
console.log("\nToate functiile, erorile si politicile au teste.");
