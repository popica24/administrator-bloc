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

   Exemplu: "Vecin-Lac-4821".
============================================================================= */

const CUVINTE = [
  "Bloc", "Casa", "Scara", "Vecin", "Lampa", "Poarta", "Curte", "Cheie",
  "Lac", "Munte", "Mare", "Rau", "Pom", "Floare", "Iarba", "Piatra",
  "Soare", "Luna", "Stea", "Nor", "Vant", "Ploaie", "Zapada", "Frunza",
];

/* Numere alese de generatorul criptografic al mediului (browser, Deno, Node).
   Parametrul exista ca testul sa poata da o secventa stiuta. */
const implicit = (cate) => crypto.getRandomValues(new Uint32Array(cate));

export function genereazaParola(numere = implicit) {
  const n = numere(3);
  const unu = CUVINTE[n[0] % CUVINTE.length];
  const doi = CUVINTE[n[1] % CUVINTE.length];
  const cifre = String(n[2] % 10000).padStart(4, "0");
  return `${unu}-${doi}-${cifre}`;
}
