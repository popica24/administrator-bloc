/* =============================================================================
   Mesajele serverului, pe romaneste
   -----------------------------------------------------------------------------
   [A9] Supabase Auth raspunde in engleza si vorbeste despre lucruri pe care
   omul nu le are in fata: adresa de email (inventata de noi din numarul lui),
   "user", "credentials". Administratorul care adauga un locatar nu are ce face
   cu "Database error creating new user".

   Ce stim sa traducem, traducem; restul devine o propozitie care spune ce s-a
   intamplat si ce poate incerca, iar mesajul original ramane in jurnalul
   functiei, pentru cine repara.
============================================================================= */

const TRADUCERI = [
  [/already registered|already been registered|already exists/i, "Exista deja un cont cu acest numar de telefon."],
  [/password should be at least|password is too short|weak password/i, "Parola este prea scurta pentru regulile serverului."],
  [/rate limit|too many requests/i, "Prea multe incercari intr-un timp scurt. Asteapta cateva minute si incearca din nou."],
  [/invalid.*(email|phone)|unable to validate/i, "Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx."],
  [/signups? not allowed|signup is disabled/i, "Conturile se fac numai din aplicatie, de catre administrator."],
];

export function traduceAuth(mesaj) {
  const text = String(mesaj ?? "");
  for (const [tipar, romana] of TRADUCERI) {
    if (tipar.test(text)) return romana;
  }
  console.error("cont-locatar: mesaj netradus de la Auth:", text);
  return "Contul nu a putut fi facut acum. Incearca din nou peste cateva minute.";
}
