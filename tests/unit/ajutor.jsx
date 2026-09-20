/* Ajutoare comune pentru testele unitare ale interfetei.

   Folosire intr-un fisier de test al interfetei:

     vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
     import { pornesteApp, ZI_DEMO } from "./ajutor.jsx";

     const { sursa } = await pornesteApp({ email: "elena.marinescu@adminbloc.test" });

   Datele demo sunt fixate in 2026, deci ceasul testelor se opreste pe ZI_DEMO.
   `modifica` primeste obiectul `date` intors de incarca() si il poate schimba,
   ca testul sa ajunga in starile rare (liste goale, restante, voturi inchise). */
import { vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { creeazaSursaMock } from "../../src/sursa-mock.js";
import AdminBloc from "../../src/AdminBloc.jsx";

export const ZI_DEMO = new Date("2026-09-19T09:00:00");
export const PAROLA = "Bloc-D14-2026";
export const ADMIN = "administrator@adminbloc.test";
export const LOCATAR = "elena.marinescu@adminbloc.test";

/* Opreste doar Date, ca promisiunile si setTimeout sa mearga normal */
export function ceasDemo(zi = ZI_DEMO) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(zi);
}

/* O sursa demo noua, optional cu datele trecute prin `modifica` la fiecare incarcare */
export function sursaDemo(modifica) {
  const sursa = creeazaSursaMock();
  if (modifica) {
    const incarca = sursa.incarca.bind(sursa);
    sursa.incarca = async () => {
      const date = await incarca();
      return modifica(date) || date;
    };
  }
  return sursa;
}

/* Porneste aplicatia; cu `email`, intra direct in cont si asteapta primul ecran */
export async function pornesteApp({ email, parola = PAROLA, modifica, sursa, zi } = {}) {
  ceasDemo(zi);
  const s = sursa || sursaDemo(modifica);
  if (email) await s.intra(email, parola);
  globalThis.sursaTest = s;
  const rezultat = render(<AdminBloc />);
  if (email) await screen.findAllByText("Iesi");
  return { sursa: s, ...rezultat };
}

/* =============================================================================
   Un singur set de ajutoare de interactiune pentru toate testele de interfata.
   Acceptam toate formele folosite in suita:
     apasa("Trimite")            dupa text sau nume accesibil
     apasa("Sterge", 2)          al treilea buton cu acelasi nume
     apasa(/^Plateste /)         dupa tipar
     apasa(element)              elementul gasit de test
     apasa("Trimite", within(x)) doar in zona x
============================================================================= */

/* Lasa promisiunile pornite de o apasare sa se termine (apel + reincarcare) */
export async function asteapta() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

const numeleButonului = (b) => b.getAttribute("aria-label") || b.textContent;
const potrivit = (b, tinta) => (tinta instanceof RegExp
  ? tinta.test(numeleButonului(b)) || tinta.test(b.textContent)
  : b.textContent === tinta || b.getAttribute("aria-label") === tinta);

export function butonul(tinta, optiuni) {
  if (tinta && tinta.nodeType === 1) return tinta;
  const index = typeof optiuni === "number" ? optiuni : 0;
  const zona = optiuni && optiuni.getAllByRole ? optiuni : screen;
  const gasite = zona.getAllByRole("button").filter((b) => potrivit(b, tinta));
  if (!gasite[index]) throw new Error(`Butonul "${tinta}" nu exista`);
  return gasite[index];
}

export async function apasa(tinta, optiuni) {
  const el = butonul(tinta, optiuni);
  await act(async () => { fireEvent.click(el); });
  await asteapta();
  return el;
}

/* Scrie intr-un camp gasit dupa eticheta lui (aria-label) */
export function scrie(eticheta, valoare, zona = screen) {
  const el = zona.getByLabelText(eticheta, { selector: "input,textarea,select" });
  fireEvent.change(el, { target: { value: valoare } });
  return el;
}

/* Mesajul zburator, ca element (null cand nu este niciunul pe ecran) */
export const toast = () => screen.queryByRole("status");

/* Textul ecranului din mijloc, fara bara de sus si fara taburi */
export const textEcran = () => document.querySelector(".ab-scroll").textContent;

/* Zona (randul, cardul) care cuprinde toate textele date. Urca din primul
   text pana le gaseste pe toate, cel mult `trepte` niveluri: asa testul spune
   "lucrurile acestea stau impreuna", fara sa depinda de cate <Box>-uri sunt
   intre ele. Peste limita arunca, deci nu trece niciodata prin radacina. */
export function zonaCu(texte, trepte = 6) {
  const lista = [].concat(texte);
  const potrivire = (el, t) => (t instanceof RegExp ? t.test(el.textContent) : el.textContent.includes(t));
  let el = screen.getAllByText(lista[0])[0];
  for (let i = 0; i <= trepte && el; i += 1) {
    if (lista.every((t) => potrivire(el, t))) return el;
    el = el.parentElement;
  }
  throw new Error(`Nicio zona apropiata nu contine ${lista.join(" + ")}`);
}

/* Zona de mai sus, gata de interogat cu within() */
export const inZona = (...texte) => within(zonaCu(texte));

/* Textul de ajutor sau de eroare legat de un camp (aria-describedby) */
export function ajutorulCampului(eticheta, zona = screen) {
  const camp = zona.getByLabelText(eticheta, { selector: "input,textarea" });
  const id = camp.getAttribute("aria-describedby");
  return id ? document.getElementById(id).textContent : null;
}
