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
  const curat = String(scris ?? "").replace(/[\s.()-]/g, "");
  const fara = curat.startsWith("+40") ? curat.slice(3)
    : curat.startsWith("0040") ? curat.slice(4)
      : curat.startsWith("40") && curat.length === 11 ? curat.slice(2)
        : null;
  const numar = fara === null ? curat : `0${fara}`;
  return FORMA.test(numar) ? numar : null;
}

/* Domeniul nu exista si nu primeste posta: adresele acestea nu ies niciodata
   din baza de autentificare. */
export const DOMENIU_CONTURI = "telefon.adminbloc.ro";

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
