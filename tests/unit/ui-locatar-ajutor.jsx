/* Ajutoare pentru testele ecranelor de locatar (sectiunea 8 din AdminBloc.jsx).

   Se folosesc impreuna cu ajutor.jsx:
     vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
     import { pornesteApp } from "./ajutor.jsx";
     import { ELENA, deschideTab, apasa } from "./ui-locatar-ajutor.jsx"; */
import { vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { apasa } from "./ajutor.jsx";

/* Conturile de locatar din date-demo.js, pe numarul lor de telefon */
export const ELENA = "0733 410 217"; // ap. 17: lista pe august neplatita, citirea pe septembrie netrimisa
export const ILIE = "0726 331 003"; // ap. 3: restante din iunie si iulie, o penalizare
export const VOICU = "0741 002 101"; // ap. 1: totul platit, citirea pe septembrie validata

export { apasa, scrie, toast, asteapta } from "./ajutor.jsx";

/* Apasa un buton dupa numele lui accesibil */
export const apasaButon = (nume) => apasa(nume);

/* Tabul de jos, dupa eticheta (fara numarul din badge) */
export async function deschideTab(nume) {
  const tab = screen.getAllByRole("tab").find((t) => t.textContent.replace(/\d+$/, "") === nume);
  await apasa(tab);
}

/* Subtabul dintr-un Segment: butonul cu aria-pressed */
export async function alegeSegment(nume) {
  const b = screen.getAllByRole("button", { name: nume }).find((x) => x.hasAttribute("aria-pressed"));
  await apasa(b);
}

/* Un fisier fara tip: micsoreazaPoza il intoarce neschimbat, fara Image/canvas (jsdom nu le are) */
export const fisierPoza = (nume = "contor.jpg") => new File(["poza"], nume, { type: "" });

/* Alege un fisier in inputul ascuns al unui AlegeFisier */
export async function alegeFisier(eticheta, fisier = fisierPoza()) {
  const input = screen.getByLabelText(eticheta, { selector: "input[type=file]" });
  await act(async () => { fireEvent.change(input, { target: { files: [fisier] } }); });
}

/* URL.createObjectURL din mediul de test nu primeste Blob-urile jsdom; il
   inlocuim cu URL-uri unice (pozele folosesc URL-ul drept cheie React) */
export function urlFalse() {
  let n = 0;
  return vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test-${++n}`);
}

/* Prinde descarcarile de PDF: numele fisierelor pe care descarcaPdf le-ar salva */
export function prindeDescarcari() {
  const nume = [];
  urlFalse();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { nume.push(this.download); });
  return nume;
}

/* window.open nu exista in jsdom; deschideDocument deschide intai o fereastra goala */
export function prindeFerestre() {
  const fereastra = { location: { href: "" }, close: vi.fn() };
  const open = vi.spyOn(window, "open").mockImplementation(() => fereastra);
  return { open, fereastra };
}

/* O promisiune pe care testul o rezolva cand vrea, ca sa vada starea "Se trimite..." */
export function amanat() {
  let rezolva;
  const promisiune = new Promise((r) => { rezolva = r; });
  return { promisiune, rezolva };
}

/* Textul unui element cu spatiile normalizate */
export const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
