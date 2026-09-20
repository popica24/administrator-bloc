/* Ajutoare pentru testele de baza ale interfetei (sectiunile 1-7 si 10-11
   din src/AdminBloc.jsx): contextul aplicatiei, PDF-urile descarcate si
   navigarea intre taburi. */
import { vi } from "vitest";
import { fireEvent, screen, act, waitFor } from "@testing-library/react";
import { creeazaSursaMock } from "../../src/sursa-mock.js";

export { apasa, scrie, toast, asteapta, butonul } from "./ajutor.jsx";

/* Valoarea din AppCtx.Provider, citita din arborele React (contextul nu este
   exportat). Asa se pot apela direct comenzile cmd() ale aplicatiei. */
export function contextApp(container) {
  const nod = container.querySelector(".ab-root");
  const cheie = Object.keys(nod).find((k) => k.startsWith("__reactFiber$"));
  let f = nod[cheie];
  while (f) {
    const v = f.memoizedProps && f.memoizedProps.value;
    if (v && typeof v === "object" && "reincarca" in v && "toastMsg" in v) return v;
    f = f.return;
  }
  throw new Error("AppCtx nu a fost gasit");
}

/* Prinde PDF-urile descarcate: numele fisierului si textul din pagini */
export function prindePdf() {
  const descarcate = [];
  const bloburi = [];
  const orig = URL.createObjectURL;
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    bloburi.push(b);
    return orig ? `blob:test-${bloburi.length}` : "blob:test";
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    descarcate.push({ nume: this.download, blob: bloburi[bloburi.length - 1] });
  });
  return {
    descarcate,
    async ultimul() {
      await waitFor(() => { if (!descarcate.length) throw new Error("niciun PDF"); });
      const d = descarcate[descarcate.length - 1];
      return { nume: d.nume, text: textPdf(await citesteBlob(d.blob)) };
    },
  };
}

export async function citesteBlob(blob) {
  const buf = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buf);
}

/* Textul unui PDF produs de src/pdf.js: fiecare (...) Tj pe un rand */
export function textPdf(bytes) {
  const s = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const randuri = [];
  const re = /\(((?:\\.|[^\\)])*)\) Tj/g;
  let m;
  while ((m = re.exec(s))) randuri.push(m[1].replace(/\\([\\()])/g, "$1"));
  return randuri.join("\n");
}

/* Apasa pe un tab din bara de jos */
export async function tab(nume) {
  const t = screen.getAllByRole("tab").find((x) => x.textContent.startsWith(nume));
  await act(async () => { fireEvent.click(t); });
}

/* Sursa demo in care orice metoda poate fi inlocuita (erori, raspunsuri rare) */
export function sursaCu(inlocuiri = {}) {
  const s = creeazaSursaMock();
  Object.assign(s, inlocuiri);
  return s;
}


