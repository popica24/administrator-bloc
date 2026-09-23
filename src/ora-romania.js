/* =============================================================================
   Ora Romaniei a unei zile si ore date
   -----------------------------------------------------------------------------
   Baza de date ruleaza pe ora Bucurestiului (migratia fus_orar_romania), iar
   aplicatia se foloseste si de pe telefoane aflate in alt fus. Un text ca
   `new Date(\`${zi}T20:00:00\`)` se citeste in fusul DISPOZITIVULUI: pe un
   telefon din alta tara, "20:00" ar insemna alt moment decat cel ales (J9 la
   inchiderea votului, K12 la convocarea adunarii).

   Decalajul se afla cu Intl, pentru acea zi si acea ora, deci tine cont de
   ora de vara. Romania e mereu inaintea UTC, deci decalajul nu e negativ.

   Pana la K22, acelasi calcul exista in trei copii: sursa-mock.js,
   sursa-supabase.js si AdminBloc.jsx. Modulul e JavaScript simplu, fara DOM,
   ca motor.js, deci merge si in React Native.
============================================================================= */

/* Decalajul Romaniei fata de UTC intr-o zi si la o ora date: "+03:00" vara, "+02:00" iarna */
export function offsetRomania(dataText, oraText = "20:00") {
  const aprox = new Date(`${dataText}T${oraText}:00Z`);
  const ore = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Bucharest", timeZoneName: "shortOffset", hour12: false })
    .formatToParts(aprox).find((p) => p.type === "timeZoneName").value.replace("GMT+", "");
  return `+${ore.padStart(2, "0")}:00`;
}

/* Momentul exact (ISO, UTC) al unei ore din Romania, de exemplu ora adunarii */
export const instantRomania = (dataText, oraText) =>
  new Date(`${dataText}T${oraText}:00${offsetRomania(dataText, oraText)}`).toISOString();

/* Seara (20:00) unei zile, ora Romaniei, ca text cu decalaj: forma pe care o
   pastreaza sursele pentru inchiderea unui vot */
export const oraSeriiRomania = (dataText) => `${dataText}T20:00:00${offsetRomania(dataText)}`;

/* [J8, K24] Data si ora Romaniei ale unei clipe date, indiferent in ce fus a
   ajuns scris sirul (un sir UTC "...Z" din baza) si in ce fus e telefonul.
   Tot ce afiseaza aplicatia (chitante, adunari, mesaje) e pe ora Romaniei,
   ca un proprietar plecat din tara sa vada aceeasi ora ca vecinii lui. */
export function dataOraRomania(iso) {
  const parti = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parti.map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, ora: `${p.hour}:${p.minute}` };
}

/* [K24] Ziua de azi in Romania ("AAAA-LL-ZZ"): scadentele, termenele si
   penalizarile se socotesc pe zilele Romaniei, ca in baza de date. */
export const aziRomania = () => dataOraRomania(new Date().toISOString()).data;
