/* Alege sursa de date a aplicatiei.
   Cu VITE_SUPABASE_URL si VITE_SUPABASE_ANON_KEY (in .env.local), aplicatia
   lucreaza cu baza de date Supabase. Fara ele ruleaza in modul demonstrativ,
   pe date in memorie, ca sa poata fi aratata si fara server (de exemplu pe
   GitHub Pages). Ambele surse au aceeasi interfata. */
import { creeazaSursaMock } from "./sursa-mock.js";
import { creeazaSursaSupabase } from "./sursa-supabase.js";

let sursa = null;

/* O singura sursa pe pagina: clientul Supabase tine sesiunea si nu trebuie dublat. */
export function creeazaSursa() {
  if (sursa) return sursa;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const cheie = import.meta.env.VITE_SUPABASE_ANON_KEY;
  sursa = url && cheie ? creeazaSursaSupabase(url, cheie) : creeazaSursaMock();
  return sursa;
}
