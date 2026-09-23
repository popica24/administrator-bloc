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

/* Migratiile sunt istoria, nu starea. Ce exista in baza la final este ce a
   lasat ULTIMA migratie care atinge functia: o stergere fara recreare o scoate
   din baza, deci nici ea, nici mesajele ei de eroare nu mai au ce test sa le
   citeze. Multe migratii sterg si recreeaza functia in acelasi fisier, ca
   sa-i schimbe semnatura; acolo functia ramane, cu corpul cel nou.
   Asa ca aici reconstruim starea finala: corpul de acum al fiecarei functii,
   plus tot restul SQL-ului (tabele, politici, triggere). */
const DEFINITIE = /create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_0-9]+)[\s\S]*?\$\$;/gi;
const STERGERE = /drop\s+function\s+(?:if\s+exists\s+)?([a-z_]+\.[a-z_0-9]+)\s*\(/gi;

const corpuri = new Map();
for (const m of migratii.matchAll(new RegExp(`${DEFINITIE.source}|${STERGERE.source}`, "gi"))) {
  const [text, definita, stearsa] = m;
  if (definita) corpuri.set(definita.toLowerCase(), text);
  else corpuri.delete(stearsa.toLowerCase());
}

const restul = migratii.replace(DEFINITIE, "");
const final = [restul, ...corpuri.values()].join("\n");

const functii = [...corpuri.keys()];

const erori = unice([...final.matchAll(/raise\s+exception\s+'((?:[^']|'')*)'/gi)]
  .map((m) => m[1].replace(/''/g, "'").split("%")[0].trim())
  .filter((t) => t.length >= 8));

/* O politica dispare odata cu tabela ei: `drop table` le sterge pe toate. */
const tabeleSterse = new Set([...migratii.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([a-z_]+\.[a-z_0-9]+)/gi)]
  .map((m) => m[1].toLowerCase()));
const politici = unice([...final.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+([a-z_]+\.[a-z_0-9]+)/gi)]
  .filter((m) => !tabeleSterse.has(m[2].toLowerCase()))
  .map((m) => m[1]));

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
