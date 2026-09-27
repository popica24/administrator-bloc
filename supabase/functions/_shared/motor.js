/* =============================================================================
   Motorul de repartizare (MotorRepartizare, serviciul de domeniu din
   docs/schema-propunere.md §2.4)
   -----------------------------------------------------------------------------
   JavaScript pur, fara importuri. Acelasi fisier este folosit de:
     - aplicatie (Vite), pentru previzualizarea din formularul de factura;
     - Edge Function-ul publica-lista (Deno), care scrie rezultatul in
       intretinere.repartizari la publicarea listei.
   Este singurul loc care calculeaza cat plateste un apartament. Nimeni nu
   rescrie aceasta logica in alta parte (§1.2): lista locatarului si raportul
   administratorului citesc amandoua ce a produs motorul.
============================================================================= */

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/* Cele cinci metode de repartizare, cu numele din coloana
   intretinere.cheltuieli.metoda */
export const METODE = ["consum", "persoane", "persoane_fara_lift", "apartamente", "cota"];

/* Baza unui apartament pentru o metoda: cat are el si cat are tot blocul */
function bazaApartament(ap, metoda, totaluri) {
  switch (metoda) {
    case "persoane":
      return { valoare: ap.persoane, total: totaluri.persoane, unitate: "persoane" };
    case "persoane_fara_lift":
      return { valoare: ap.scutitLift ? 0 : ap.persoane, total: totaluri.persoaneFaraLift, unitate: "persoane" };
    case "apartamente":
      return { valoare: 1, total: totaluri.apartamente, unitate: "apartamente" };
    case "cota":
      return { valoare: ap.cota, total: totaluri.cota, unitate: "%" };
    default:
      throw new Error(`Metoda de repartizare necunoscuta: ${metoda}`);
  }
}

/* [L7, R2] Imparte o suma deja rotunjita la 2 zecimale intre ponderi (ex:
   persoanele apartamentelor), cu metoda resturilor celor mai mari: fiecare
   parte primeste partea intreaga (in sutimi), apoi sutimile ramase merg,
   cate una, apartamentelor cu cel mai mare rest. Spre deosebire de
   rotunjirea fiecarei parti in parte, suma partilor intoarse este mereu
   exact egala cu suma de impartit, altfel metrii cubi repartizati pe
   apartamente nu s-ar aduna la contorul general, desi fiecare rand, luat
   separat, pare corect rotunjit.
   [R2] La egalitate de rest, nu accidentala: apartamente cu aceeasi pondere
   (acelasi numar de persoane, de exemplu) au mereu rest identic, sutimea
   trebuie sa mearga la acelasi apartament oricare ar fi ordinea in care au
   fost primite ponderile. Ordinea din lista nu e o cheie stabila: motorul
   e chemat cu ordini diferite (intretinere.date_pentru_motor ordoneaza
   apartamentele dupa numar ca text, sursa demo dupa ordinea ei naturala),
   iar rezultatul nu are voie sa depinda de asta.
   [R2] Nici id-ul apartamentului nu e o cheie buna, desi e stabil indiferent
   de ordine: id-ul nu inseamna acelasi lucru in cele doua surse (UUID in
   Supabase, "ap-1", "ap-2", ... in sursa demo), deci acelasi bloc, calculat
   de surse diferite, impartea sutimea la apartamente diferite. Egalitatea
   se desparte dupa `chei`, numarul apartamentului ("numar", text ca "3"
   sau "2A"), comparat numeric ca in restul aplicatiei
   (localeCompare(..., "ro", { numeric: true })), pentru ca inseamna acelasi
   lucru oriunde vine lista. Id-ul ramane doar rezerva pentru un apelant
   care nu trimite `numar` (teste vechi, cod neactualizat), motorul nu
   arunca niciodata pentru atat de putin. */
function distribuieExact(suma, ponderi, chei) {
  const totalPonderi = ponderi.reduce((s, p) => s + p, 0);
  const unitati = Math.round(suma * 100);
  if (!(totalPonderi > 0) || unitati === 0) return ponderi.map(() => 0);
  const bruteUnitati = ponderi.map((p) => (unitati * p) / totalPonderi);
  const bazaUnitati = bruteUnitati.map((u) => Math.floor(u));
  const ramase = unitati - bazaUnitati.reduce((s, u) => s + u, 0);
  const ordine = bruteUnitati
    .map((u, i) => ({ i, rest: u - bazaUnitati[i], cheie: String(chei[i]) }))
    .sort((a, b) => b.rest - a.rest || a.cheie.localeCompare(b.cheie, "ro", { numeric: true }));
  const rezultat = [...bazaUnitati];
  for (let k = 0; k < ramase; k += 1) rezultat[ordine[k].i] += 1;
  return rezultat.map((u) => u / 100);
}

/* Apa se imparte dupa contoarele din apartamente. Diferenta dintre contorul
   general al blocului si suma contoarelor (pierderea pe coloana) se imparte
   pe persoane. Sumele se calculeaza din exact valorile afisate: metri cubi la
   2 zecimale, pretul la 4, ca inmultirea de pe ecran sa dea suma la ban.
   [L7] Cota fiecarui apartament din diferenta se imparte cu distribuieExact,
   nu cu o rotunjire separata pe fiecare apartament: altfel suma metrilor cubi
   repartizati pe apartamente nu mai era egala cu contorul general (cativa
   centimetri cubi "dispareau" sau "aparaeau" din rotunjiri independente). */
function repartizeazaApa(cheltuiala, apartamente, consum, contorGeneral, totaluri) {
  const tip = cheltuiala.tipApa;
  const general = contorGeneral[tip];
  if (!(general > 0)) {
    throw new Error(`Lipseste citirea contorului general pentru apa ${tip}.`);
  }
  const propriu = (a) => round2(Number(consum[a.id][tip]));
  const sumaContoare = round2(apartamente.reduce((s, a) => s + propriu(a), 0));
  const diferenta = round2(general - sumaContoare);
  const pretMc = round4(cheltuiala.suma / general);
  const coteDiferenta = totaluri.persoane > 0
    ? distribuieExact(diferenta, apartamente.map((a) => a.persoane), apartamente.map((a) => a.numar ?? a.id))
    : apartamente.map(() => 0);

  return apartamente.map((ap, i) => {
    const consumPropriu = propriu(ap);
    const cotaDiferenta = coteDiferenta[i];
    const mc = round2(consumPropriu + cotaDiferenta);
    return {
      apartamentId: ap.id,
      suma: round2(mc * pretMc),
      baza: { valoare: mc, total: general, unitate: "mc" },
      detaliu: {
        tip,
        consumPropriu,
        contorGeneral: general,
        sumaContoare,
        diferenta,
        persoane: ap.persoane,
        totalPersoane: totaluri.persoane,
        cotaDiferenta,
        pretMc,
      },
    };
  });
}

/* Baza blocului nu este niciodata zero aici: verificaDate refuza lista inainte */
function repartizeazaSimplu(cheltuiala, apartamente, totaluri) {
  return apartamente.map((ap) => {
    const b = bazaApartament(ap, cheltuiala.metoda, totaluri);
    return {
      apartamentId: ap.id,
      suma: round2((cheltuiala.suma * b.valoare) / b.total),
      baza: b,
      detaliu: null,
    };
  });
}

/* Rotunjirea la ban lasa cativa bani in plus sau in minus fata de factura.
   Restul se adauga apartamentului cu partea cea mai mare, ca totalul
   repartizat sa fie egal la ban cu factura. Restul ramane vizibil pe rand.
   [K3] La egalitate de suma (metoda "apartamente" sau "cota" cu cote egale
   dau mereu parti identice pentru apartamente identice) primul index cu
   maximul din array nu e o cheie stabila: ordinea nu e aceeasi intre surse
   (sursa demo isi are ordinea ei naturala, intretinere.date_pentru_motor
   ordoneaza dupa numar ca text, unde "10" vine inaintea lui "2"), deci acelasi
   bloc primea castigatori diferiti. Egalitatea se desparte dupa `chei`
   (numarul apartamentului, comparat numeric), exact ca la distribuieExact. */
function corecteazaRotunjirea(parti, suma, chei) {
  const total = round2(parti.reduce((s, p) => s + p.suma, 0));
  const rest = round2(suma - total);
  const cuRotunjire = parti.map((p) => ({ ...p, rotunjire: 0 }));
  if (rest === 0 || cuRotunjire.length === 0) return cuRotunjire;
  let iMax = 0;
  cuRotunjire.forEach((p, i) => {
    const maiMare = p.suma > cuRotunjire[iMax].suma;
    const egalitate = p.suma === cuRotunjire[iMax].suma
      && String(chei[i]).localeCompare(String(chei[iMax]), "ro", { numeric: true }) < 0;
    if (maiMare || egalitate) iMax = i;
  });
  cuRotunjire[iMax] = { ...cuRotunjire[iMax], suma: round2(cuRotunjire[iMax].suma + rest), rotunjire: rest };
  return cuRotunjire;
}

/* Bazele intregului bloc, pentru fiecare metoda */
function totaluriBloc(apartamente) {
  return {
    persoane: apartamente.reduce((s, a) => s + a.persoane, 0),
    persoaneFaraLift: apartamente.filter((a) => !a.scutitLift).reduce((s, a) => s + a.persoane, 0),
    apartamente: apartamente.length,
    cota: round4(apartamente.reduce((s, a) => s + a.cota, 0)),
  };
}

/* Ce inseamna o baza zero pentru fiecare metoda simpla: fara ea, toata suma
   ar ajunge la un singur apartament, ca "rotunjire" */
const BAZA_ZERO = {
  persoane: ["persoane", "niciun apartament nu are persoane declarate"],
  persoane_fara_lift: ["persoaneFaraLift", "apartamentele care folosesc liftul nu au persoane declarate"],
  cota: ["cota", "cotele indivize insumeaza zero"],
};

/* Verifica datele de intrare si intoarce lista de probleme, in cuvinte pe
   care administratorul le poate rezolva. Lista goala inseamna ca se poate
   calcula. */
export function verificaDate({ apartamente, cheltuieli, consum, contorGeneral }) {
  const probleme = [];
  if (!apartamente || apartamente.length === 0) probleme.push("Blocul nu are apartamente.");
  const totaluri = totaluriBloc(apartamente || []);
  (cheltuieli || []).forEach((c) => {
    const zero = BAZA_ZERO[c.metoda];
    if (zero && apartamente && apartamente.length > 0 && !(totaluri[zero[0]] > 0)) {
      probleme.push(`${c.cod}: suma nu se poate imparti, ${zero[1]}.`);
    }
    if (!METODE.includes(c.metoda)) probleme.push(`${c.cod}: metoda "${c.metoda}" nu exista.`);
    if (!(c.suma > 0)) probleme.push(`${c.cod}: suma trebuie sa fie mai mare decat zero.`);
    if (c.metoda === "consum") {
      if (c.tipApa !== "rece" && c.tipApa !== "calda") {
        probleme.push(`${c.cod}: alege daca este apa rece sau apa calda.`);
        return;
      }
      if (!contorGeneral || !(contorGeneral[c.tipApa] > 0)) {
        probleme.push(`${c.cod}: lipseste citirea contorului general pentru apa ${c.tipApa}.`);
      }
      const faraCitire = (apartamente || []).filter((a) => !consum || !consum[a.id] || consum[a.id][c.tipApa] == null);
      if (faraCitire.length > 0) {
        probleme.push(`${c.cod}: lipsesc citirile la apa ${c.tipApa} pentru ${faraCitire.length} apartamente.`);
        return;
      }
      /* Contorul general masoara tot ce intra in bloc, deci nu poate arata mai
         putin decat contoarele din apartamente. Daca arata, o citire e gresita.
         [minor] sumaContoare trebuie calculata exact ca in repartizeazaApa:
         fiecare apartament rotunjit la 2 zecimale INAINTE sa fie insumat, nu
         suma bruta rotunjita o singura data la sfarsit. Cu consumuri pe 3
         zecimale (exact ce produce contorizare.estimeaza_citiri), cele doua
         ordini de rotunjire pot da rezultate diferite: L1 ar lasa sa treaca o
         lista pentru care repartizeazaApa calculeaza totusi o diferenta
         negativa pe coloana. */
      if (!apartamente || apartamente.length === 0) return;
      const general = contorGeneral && contorGeneral[c.tipApa];
      const sumaContoare = round2(apartamente.reduce((s, a) => s + round2(Number(consum[a.id][c.tipApa])), 0));
      if (general > 0 && general < sumaContoare) {
        probleme.push(`${c.cod}: contorul general (${general} mc) este mai mic decat suma contoarelor din apartamente (${sumaContoare} mc). Verifica citirile la apa ${c.tipApa}.`);
      } else if (general > sumaContoare && !(totaluri.persoane > 0)) {
        probleme.push(`${c.cod}: diferenta de apa nu se poate imparti, niciun apartament nu are persoane declarate.`);
      }
    }
  });
  return probleme;
}

/* Calculeaza o lista lunara.
   Intrare:
     apartamente:   [{ id, numar, persoane, cota, scutitLift }] (numar desparte
                    egalitatile de rest ca in restul aplicatiei; fara el,
                    motorul cade pe id, doar ca sa nu arunce)
     cheltuieli:    [{ id, cod, suma, metoda, tipApa }]
     consum:        { [apartamentId]: { rece, calda } }, in mc, doar pentru apa
     contorGeneral: { rece, calda }, consumul lunii la contorul general
   Iesire:
     repartizari: [{ cheltuialaId, apartamentId, suma, baza, rotunjire, detaliu }]
     un rand pentru fiecare apartament si fiecare cheltuiala, inclusiv cele
     cu suma zero ("de ce platesc 0 la lift?"). */
export function calculeazaLista(date) {
  const probleme = verificaDate(date);
  if (probleme.length > 0) {
    const e = new Error(probleme.join(" "));
    e.probleme = probleme;
    throw e;
  }
  const { apartamente, cheltuieli, consum, contorGeneral } = date;
  const totaluri = totaluriBloc(apartamente);

  const repartizari = [];
  cheltuieli.forEach((c) => {
    const parti = c.metoda === "consum"
      ? repartizeazaApa(c, apartamente, consum, contorGeneral, totaluri)
      : repartizeazaSimplu(c, apartamente, totaluri);
    const chei = apartamente.map((a) => a.numar ?? a.id);
    corecteazaRotunjirea(parti, c.suma, chei).forEach((p) => repartizari.push({ cheltuialaId: c.id, ...p }));
  });

  const totalCheltuieli = round2(cheltuieli.reduce((s, c) => s + c.suma, 0));
  const totalRepartizat = round2(repartizari.reduce((s, r) => s + r.suma, 0));
  return { repartizari, totaluri, totalCheltuieli, totalRepartizat };
}
