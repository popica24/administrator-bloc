/* =============================================================================
   Parola pe care administratorul o da locatarului
   -----------------------------------------------------------------------------
   Contul il face administratorul, deci parola o alege sistemul si i-o spune
   lui, o singura data; el o da omului pe hartie sau prin telefon.

   Parola trebuie sa treaca regulile Supabase Auth (cel putin 10 caractere, cu
   litera mare, litera mica si cifra) si, mai ales, sa poata fi citita la
   telefon unui om de saptezeci de ani fara sa fie inteleasa gresit: cuvinte
   romanesti scurte, fara diacritice, si patru cifre. Nicio litera nu se
   confunda cu o cifra, fiindca literele si cifrele stau in grupuri separate.

   [A3] Trei cuvinte din saizeci si patru, plus patru cifre: 18 + 13 biti, fata
   de cele 22 de biti ale variantei cu doua cuvinte din douazeci si patru. O
   parola care se da o data si pe care omul nu si-o poate schimba singur
   trebuie sa reziste incercarilor repetate, nu doar unei ghiciri.

   Exemplu: "Vecin-Lac-Poarta-4821".
============================================================================= */

const CUVINTE = [
  "Bloc", "Casa", "Scara", "Vecin", "Lampa", "Poarta", "Curte", "Cheie",
  "Lac", "Munte", "Mare", "Rau", "Pom", "Floare", "Iarba", "Piatra",
  "Soare", "Luna", "Stea", "Nor", "Vant", "Ploaie", "Zapada", "Frunza",
  "Masa", "Scaun", "Pat", "Perna", "Covor", "Perete", "Podea", "Fereastra",
  "Palarie", "Palton", "Ceas", "Ochelari", "Umbrela", "Bastan", "Carte", "Ziar",
  "Paine", "Lapte", "Miere", "Nuca", "Mar", "Para", "Prune", "Cirese",
  "Cana", "Farfurie", "Lingura", "Furculita", "Ceainic", "Oala", "Cratita", "Tava",
  "Pisica", "Catel", "Vrabie", "Barza", "Albina", "Fluture", "Greier", "Rindunica",
];

/* Numere alese de generatorul criptografic al mediului (browser, Deno, Node).
   Parametrul exista ca testul sa poata da o secventa stiuta. */
const implicit = (cate) => crypto.getRandomValues(new Uint32Array(cate));

export function genereazaParola(numere = implicit) {
  const n = numere(4);
  const unu = CUVINTE[n[0] % CUVINTE.length];
  const doi = CUVINTE[n[1] % CUVINTE.length];
  const trei = CUVINTE[n[2] % CUVINTE.length];
  const cifre = String(n[3] % 10000).padStart(4, "0");
  return `${unu}-${doi}-${trei}-${cifre}`;
}
