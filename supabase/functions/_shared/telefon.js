/* =============================================================================
   Numarul de telefon, identitatea unui cont
   -----------------------------------------------------------------------------
   Oamenii carora le este facuta aplicatia au 50 de ani si mai mult; multi nu
   au adresa de email, dar toti au un numar de telefon. Contul se face pe
   numar: administratorul il trece in aplicatie, iar omul intra cu numarul lui
   si cu parola primita.

   Numarul se scrie in fel si chip: cu spatii, cu puncte, cu prefixul tarii.
   normalizeazaTelefon() le aduce pe toate la aceeasi forma ("0722123456"), ca
   acelasi om sa fie recunoscut de fiecare data.

   Supabase Auth nu primeste numarul direct: intrarea cu telefon cere un
   furnizor de SMS, iar noi nu trimitem niciun SMS. Asa ca fiecare cont are o
   adresa interna, facuta din numarul lui (adresaContului). Omul nu o vede si
   nu o scrie niciodata: ecranul cere numarul, iar aplicatia face adresa.

   Modul e JavaScript simplu, fara DOM, ca motor.js: il folosesc si aplicatia,
   si Edge Functions (Deno), si scriptul care incarca datele demo.
============================================================================= */

/* Numerele romanesti au zece cifre si incep cu 0: 07 mobil, 02 si 03 fix. */
const FORMA = /^0[237]\d{8}$/;

export function normalizeazaTelefon(scris) {
  let rest = String(scris ?? "").replace(/[\s.()-]/g, "");
  if (rest.startsWith("+40")) rest = rest.slice(3);
  else if (rest.startsWith("0040")) rest = rest.slice(4);
  else if (rest.startsWith("40") && rest.length === 11) rest = rest.slice(2);
  else if (rest.startsWith("0")) rest = rest.slice(1);
  else return null;
  /* [A6] Multi isi scriu numarul cu prefixul tarii si cu zeroul de acasa unul
     dupa altul: "+40 0722 123 456". Este acelasi om. */
  if (rest.startsWith("0")) rest = rest.slice(1);
  const numar = `0${rest}`;
  return FORMA.test(numar) ? numar : null;
}

/* [A10] Domeniul este ".invalid", rezervat prin RFC 2606 tocmai pentru asa
   ceva: nimeni nu il poate inregistra si nu primeste posta. Adresele acestea
   nu ies niciodata din baza de autentificare, dar un domeniu real, chiar si
   neinregistrat inca, ar fi putut fi cumparat de altcineva. */
export const DOMENIU_CONTURI = "telefon.adminbloc.invalid";

export function adresaContului(scris) {
  const numar = normalizeazaTelefon(scris);
  return numar && `${numar}@${DOMENIU_CONTURI}`;
}

/* Numarul asa cum il stie omul de pe hartie: 0722 123 456 */
export function telefonAfisat(scris) {
  const numar = normalizeazaTelefon(scris);
  if (!numar) return String(scris ?? "");
  return `${numar.slice(0, 4)} ${numar.slice(4, 7)} ${numar.slice(7)}`;
}
