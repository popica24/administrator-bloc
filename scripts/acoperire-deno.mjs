#!/usr/bin/env node
// Pragul de acoperire pentru Edge Function-uri (Deno). Nu ruleaza testele:
// citeste raportul lcov scris de `deno coverage ... --lcov` si iese cu 1 daca
// un fisier inclus are sub 100% linii sau ramuri (sau functii), ori daca un
// fisier .ts din supabase/functions lipseste din raport (netestat deloc).
//
//   deno coverage coverage/deno --exclude='tests/|motor\.js' --lcov | node scripts/acoperire-deno.mjs
//   node scripts/acoperire-deno.mjs coverage/deno/lcov.info
//
// Optiuni: --ignora=<regex> scoate fisiere din verificare (ex. motor\.js, pe
// care il acopera vitest). Se poate repeta.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RADACINA = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTII = join(RADACINA, "supabase", "functions");

const argumente = process.argv.slice(2);
const ignorate = argumente.filter((a) => a.startsWith("--ignora=")).map((a) => new RegExp(a.slice("--ignora=".length)));
const fisier = argumente.find((a) => !a.startsWith("--"));
const lcov = fisier ? readFileSync(fisier, "utf8") : readFileSync(0, "utf8");

if (!lcov.includes("SF:")) {
  console.error("acoperire-deno: nu am primit un raport lcov (lipseste --lcov?).");
  process.exit(1);
}

const cale = (f) => relative(FUNCTII, f.startsWith("file://") ? fileURLToPath(f) : f);
const exclus = (rel) => rel.startsWith("tests/") || rel.startsWith("..") || ignorate.some((r) => r.test(rel));

// ---------------------------------------------------------------- lcov
const fisiere = new Map();
let curent = null;
for (const rand of lcov.split(/\r?\n/)) {
  if (rand.startsWith("SF:")) {
    curent = { LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0, linii: [], ramuri: [] };
    fisiere.set(cale(rand.slice(3)), curent);
  } else if (curent && rand === "end_of_record") {
    curent = null;
  } else if (curent) {
    const [cheie, valoare] = [rand.slice(0, rand.indexOf(":")), rand.slice(rand.indexOf(":") + 1)];
    if (cheie in curent && !Array.isArray(curent[cheie])) curent[cheie] = Number(valoare);
    else if (cheie === "DA") {
      const [linie, lovituri] = valoare.split(",");
      if (Number(lovituri) === 0) curent.linii.push(Number(linie));
    } else if (cheie === "BRDA") {
      const [linie, , , lovituri] = valoare.split(",");
      if (lovituri === "-" || Number(lovituri) === 0) curent.ramuri.push(Number(linie));
    }
  }
}

// ---------------------------------------------------------------- fisierele de pe disc
function surse(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return surse(p);
    return /\.(ts|js|mjs)$/.test(n) ? [relative(FUNCTII, p)] : [];
  });
}
const peDisc = surse(FUNCTII).filter((f) => !exclus(f) && f.endsWith(".ts"));

// ---------------------------------------------------------------- verificare
const procent = (h, f) => (f === 0 ? 100 : (100 * h) / f);
const unice = (a) => [...new Set(a)].sort((x, y) => x - y).join(", ");
const probleme = [];
const tabel = [];

for (const [f, d] of [...fisiere].sort()) {
  if (exclus(f)) continue;
  const l = procent(d.LH, d.LF), b = procent(d.BRH, d.BRF), fn = procent(d.FNH, d.FNF);
  tabel.push({ fisier: f, linii: l.toFixed(1), ramuri: b.toFixed(1), functii: fn.toFixed(1) });
  if (l < 100) probleme.push(`${f}: linii ${l.toFixed(1)}% (neacoperite: ${unice(d.linii)})`);
  if (b < 100) probleme.push(`${f}: ramuri ${b.toFixed(1)}% (pe liniile: ${unice(d.ramuri)})`);
  if (fn < 100) probleme.push(`${f}: functii ${fn.toFixed(1)}%`);
}
for (const f of peDisc) {
  if (!fisiere.has(f)) probleme.push(`${f}: lipseste din raport (niciun test nu il importa)`);
}

console.table(tabel);
if (probleme.length > 0) {
  console.error(`\nacoperire-deno: sub 100% la ${probleme.length} verificari:\n  - ${probleme.join("\n  - ")}`);
  process.exit(1);
}
console.log(`acoperire-deno: ${tabel.length} fisiere, toate la 100% linii, ramuri si functii.`);
