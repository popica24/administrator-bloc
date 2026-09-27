/* Contractul dintre cele doua surse de date (audit 2: T4).

   Ecranele sunt testate numai pe sursa demonstrativa, iar sursa Supabase numai
   fara ecrane. Intre ele nu exista nimic care sa spuna ca `date` are aceeasi
   forma: un camp redenumit intr-o singura sursa lasa toata suita verde si
   strica productia.

   Aici se incarca acelasi bloc demonstrativ (D14) din ambele surse, mock-ul il
   rejoaca din src/date-demo.js, baza locala il are din `npm run seed`, si se
   compara forma rezultatului: multimea cheilor si tipurile valorilor, la orice
   adancime, inclusiv pentru fiecare element de lista. Valorile nu se compara:
   ele depind de ziua in care ruleaza testul. */
import { beforeAll, describe, expect, it } from "vitest";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import { PAROLA_DEMO } from "../../src/date-demo.js";
import { intraCa } from "./fixture.js";

const ADMIN = "0745 210 118";
const LOCATAR = "0733 410 217";

/* Divergentele stiute intre surse (auditul 1, §8). Sunt ignorate aici ca sa nu
   ascunda regresiile noi, dar lista trebuie sa se scurteze, nu sa creasca:
   fiecare intrare este un camp pe care un ecran il vede intr-o sursa si nu in
   cealalta. Calea foloseste * pentru "orice element de lista". */
const DIVERGENTE_CUNOSCUTE = [
  "bloc.localitate",            /* mock-ul tine localitatea pe bloc; baza o tine in nomenclator */
  "consumMediu.*.persoane",     /* mock-ul da si numarul de persoane al lunii */
  "contacte.*.apartamentNumar", /* in baza vine null cand contactul nu are apartament */
  "penalizari.*.creatLa",       /* mock-ul copiaza randul intreg */
  "penalizari.*.id",
  "setari.chitantaUltimulNumar",/* numarul curent din chitantier nu se expune prin API */
];

const tipul = (v) => (v === null ? "null" : v === undefined ? "lipsa" : Array.isArray(v) ? "lista" : typeof v);

/* Forma unei valori: pentru liste, reuniunea formelor elementelor. */
function forma(v) {
  if (Array.isArray(v)) return v.length ? { lista: v.map(forma).reduce(uneste) } : { lista: "necunoscut" };
  if (v && typeof v === "object") {
    const chei = {};
    Object.keys(v).sort().forEach((k) => { chei[k] = forma(v[k]); });
    return { obiect: chei };
  }
  return tipul(v);
}

/* Reuniunea a doua forme: tipurile se aduna, iar "null" si "lipsa" dispar cand
   exista si un tip concret (un camp optional ramane acelasi camp). */
function uneste(a, b) {
  if (a === b) return a;
  if (typeof a === "string" && typeof b === "string") {
    const t = [...new Set([a, b])].filter((x) => x !== "null" && x !== "lipsa");
    return t.length ? t.sort().join("|") : "null";
  }
  if (typeof a === "string") return uneste(b, a);
  if (typeof b === "string") return b === "null" || b === "lipsa" || b === "necunoscut" ? a : `${JSON.stringify(a)}|${b}`;
  if (a.lista && b.lista) return { lista: a.lista === "necunoscut" ? b.lista : b.lista === "necunoscut" ? a.lista : uneste(a.lista, b.lista) };
  const chei = {};
  [...new Set([...Object.keys(a.obiect || {}), ...Object.keys(b.obiect || {})])].sort().forEach((k) => {
    chei[k] = uneste((a.obiect || {})[k] ?? "lipsa", (b.obiect || {})[k] ?? "lipsa");
  });
  return { obiect: chei };
}

/* Forma, aplatizata in perechi cale -> tip, fara divergentele stiute. */
function cai(f, prefix = "") {
  if (typeof f === "string") return prefix ? { [prefix]: f } : {};
  if (f.lista !== undefined) return f.lista === "necunoscut" ? { [`${prefix}[]`]: "lista goala" } : cai(f.lista, `${prefix}.*`);
  const iesire = {};
  Object.entries(f.obiect).forEach(([k, v]) => Object.assign(iesire, cai(v, prefix ? `${prefix}.${k}` : k)));
  return iesire;
}

const tipar = (cale) => new RegExp(`^${cale.split(".").map((p) => (p === "*" ? "[^.]+" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("\\.")}$`);
const stiuta = (cale) => DIVERGENTE_CUNOSCUTE.some((d) => tipar(d).test(cale.replace(/\[\]$/, "")));
const fara = (obiect) => Object.fromEntries(Object.entries(obiect).filter(([k]) => !stiuta(k)));

/* Listele goale intr-o sursa nu spun nimic despre forma elementelor, deci se
   compara doar cheile care au forma cunoscuta in ambele surse. */
function comparabile(a, b) {
  const goale = new Set([...Object.keys(a), ...Object.keys(b)]
    .filter((k) => a[k] === "lista goala" || b[k] === "lista goala")
    .map((k) => k.replace(/\[\]$/, "")));
  const curata = (o) => Object.fromEntries(Object.entries(o)
    .filter(([k]) => ![...goale].some((g) => k === `${g}[]` || k.startsWith(`${g}.`))));
  return [fara(curata(a)), fara(curata(b))];
}

const mock = async (email) => {
  const s = creeazaSursaMock();
  await s.intra(email, PAROLA_DEMO);
  return s.incarca();
};

const forme = {};

beforeAll(async () => {
  for (const [cheie, email] of [["admin", ADMIN], ["locatar", LOCATAR]]) {
    const { date } = await intraCa(email);
    forme[cheie] = { sb: cai(forma(date)), demo: cai(forma(await mock(email))) };
  }
});

describe("acelasi bloc demonstrativ, aceeasi forma a datelor", () => {
  it("administratorul: cheile de prim nivel sunt identice", () => {
    const chei = (o) => [...new Set(Object.keys(o).map((k) => k.split(".")[0].replace(/\[\]$/, "")))].sort();
    expect(chei(forme.admin.demo)).toEqual(chei(forme.admin.sb));
  });

  it("administratorul: fiecare cale si tipul ei sunt aceleasi in ambele surse", () => {
    const [demo, sb] = comparabile(forme.admin.demo, forme.admin.sb);
    expect(demo).toEqual(sb);
  });

  it("locatarul: cheile de prim nivel sunt identice", () => {
    const chei = (o) => [...new Set(Object.keys(o).map((k) => k.split(".")[0].replace(/\[\]$/, "")))].sort();
    expect(chei(forme.locatar.demo)).toEqual(chei(forme.locatar.sb));
  });

  it("locatarul: fiecare cale si tipul ei sunt aceleasi in ambele surse", () => {
    const [demo, sb] = comparabile(forme.locatar.demo, forme.locatar.sb);
    expect(demo).toEqual(sb);
  });

  it("lista divergentelor stiute nu are intrari moarte", () => {
    const toate = new Set([
      ...Object.keys(forme.admin.demo), ...Object.keys(forme.admin.sb),
      ...Object.keys(forme.locatar.demo), ...Object.keys(forme.locatar.sb),
    ].map((k) => k.replace(/\[\]$/, "")));
    expect(DIVERGENTE_CUNOSCUTE.filter((d) => ![...toate].some((c) => tipar(d).test(c)))).toEqual([]);
  });
});
