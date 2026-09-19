/* Ajutoare pentru testele ecranelor de administrator (sectiunea 9 din AdminBloc.jsx).

   Fiecare fisier de test trebuie sa aiba si mock-ul sursei:
     vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

   Comenzile din mock sunt promisiuni rezolvate imediat, deci un `act` asincron
   ajunge ca sa treaca apelul, reincarcarea si toast-ul. */
import { screen, within } from "@testing-library/react";
import { pornesteApp, ADMIN, apasa } from "./ajutor.jsx";

export { ADMIN, apasa };
export { scrie, toast, asteapta, butonul } from "./ajutor.jsx";

/* Porneste aplicatia ca administrator, optional direct pe un tab */
export async function pornesteAdmin({ tab, ...opt } = {}) {
  const r = await pornesteApp({ email: ADMIN, ...opt });
  if (tab) await mergiLa(tab);
  return r;
}

export const buton = (nume, cont = screen) => cont.getByRole("button", { name: nume });
export const butoane = (nume, cont = screen) => cont.queryAllByRole("button", { name: nume });

/* Tabul dupa eticheta; numele accesibil poate avea si badge-ul cu numar */
export async function mergiLa(tab) {
  await apasa(screen.getByRole("tab", { name: new RegExp(`^${tab}(\\s*\\d+)?$`) }));
}

export const dialog = (titlu) => screen.getByRole("dialog", { name: titlu });
export const inDialog = (titlu) => within(dialog(titlu));
/* Butonul este dezactivat (Press pune aria-disabled) */
export const dezactivat = (el) => el.getAttribute("aria-disabled") === "true";

/* Cardul (Box/div) cel mai apropiat care contine un text si un buton cu numele dat */
export function randCu(text, numeButon) {
  let el = screen.getAllByText(text)[0];
  while (el && !(within(el).queryAllByRole("button", { name: numeButon }).length)) el = el.parentElement;
  return el;
}
