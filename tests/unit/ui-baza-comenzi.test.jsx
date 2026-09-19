/* Comenzile aplicatiei (sectiunea 11): fiecare cmd() cheama sursa, reincarca
   datele si arata un mesaj; la eroare arata mesajul erorii. Plus
   deschideDocument (deschideDupa, deschideUrl) si disparitia mesajului. */
import { describe, it, expect, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, ADMIN } from "./ajutor.jsx";
import { contextApp, toast } from "./ui-baza-ajutor.jsx";

/* [comanda, argumente, metoda din sursa, ce intoarce sursa, mesajul asteptat (null = niciun mesaj)] */
const COMENZI = [
  ["folosesteInvitatie", ["ABCD2345"], "folosesteInvitatie", { apartamentNumar: "5" }, "Contul a fost legat de apartamentul 5"],
  ["cereVerificareAdministrator", [{ numarAtestat: "AT-1", fisier: null }], "cereVerificareAdministrator", undefined, "Cererea a fost trimisa spre verificare"],
  ["platesteCard", [{ apartamentId: "apa-3", suma: 10, card: {} }], "platesteCard", { plataId: "p" }, "Plata a fost confirmata de banca"],
  ["transmiteCitire", [{ apartamentId: "apa-3", luna: "2026-09" }], "transmiteCitire", undefined, "Indexul a fost trimis administratorului"],
  ["adaugaSesizare", [{ titlu: "Bec" }], "adaugaSesizare", undefined, "Sesizarea a ajuns la administrator"],
  ["scrieMesaj", ["ses-1", "Multumesc"], "scrieMesaj", undefined, "Mesajul a fost trimis"],
  ["voteaza", ["vot-1", "opt-1", "apa-3"], "voteaza", undefined, "Votul a fost inregistrat"],
  ["confirmaPrezenta", ["adu-1", "apa-3"], "confirmaPrezenta", undefined, "Prezenta a fost confirmata"],
  ["marcheazaAnuntCitit", ["anu-1"], "marcheazaAnuntCitit", undefined, null],
  ["marcheazaNotificareCitita", ["not-1"], "marcheazaNotificareCitita", undefined, null],
  ["deschideLista", ["2026-12"], "deschideLista", "lis-nou", "Lista pe decembrie 2026 a fost inceputa"],
  ["salveazaCheltuiala", [{ id: "che-1", suma: 5 }], "salveazaCheltuiala", undefined, "Factura a fost modificata"],
  ["salveazaCheltuiala", [{ suma: 5 }], "salveazaCheltuiala", undefined, "Factura a fost adaugata in lista in lucru"],
  ["stergeCheltuiala", ["che-1"], "stergeCheltuiala", undefined, "Cheltuiala a fost stearsa"],
  ["publicaLista", ["lis-1"], "publicaLista", undefined, "Lista a fost publicata. Locatarii o vad acum."],
  ["marcheazaFacturaPlatita", ["che-1", true], "marcheazaFacturaPlatita", undefined, "Factura marcata ca platita furnizorului"],
  ["marcheazaFacturaPlatita", ["che-1", false], "marcheazaFacturaPlatita", undefined, "Plata catre furnizor a fost anulata"],
  ["inregistreazaNumerar", ["apa-3", 100], "inregistreazaNumerar", { plataId: "p" }, "Incasare inregistrata, chitanta emisa"],
  ["trimiteInstiintare", ["apa-3"], "trimiteInstiintare", { destinatari: 1 }, null],
  ["schimbaPersoane", ["apa-3", 3, "2026-10", "nastere"], "schimbaPersoane", undefined, "Din octombrie 2026 se calculeaza 3 persoane"],
  ["invitaLocatar", ["apa-3", "chirias"], "invitaLocatar", "ABCD2345", "Codul de invitatie a fost generat"],
  ["inchideAcces", ["loc-1"], "inchideAcces", undefined, "Accesul a fost inchis"],
  ["valideazaCitire", ["cit-1", true, null], "valideazaCitire", undefined, "Citirea a fost validata"],
  ["valideazaCitire", ["cit-1", false, "Poza neclara"], "valideazaCitire", undefined, "Citirea a fost respinsa, locatarul a fost anuntat"],
  ["citesteContorGeneral", ["2026-09", "rece", 500], "citesteContorGeneral", undefined, "Indexul contorului general a fost salvat"],
  ["estimeazaCitiri", ["2026-09"], "estimeazaCitiri", { estimate: 2 }, null],
  ["preiaSesizare", ["ses-1"], "preiaSesizare", undefined, "Sesizarea este in lucru"],
  ["rezolvaSesizare", ["ses-1"], "rezolvaSesizare", undefined, "Sesizarea a fost marcata rezolvata"],
  ["publicaAnunt", [{ titlu: "A", corp: "B", urgent: true }], "publicaAnunt", undefined, "Anunt publicat si notificare trimisa"],
  ["publicaAnunt", [{ titlu: "A", corp: "B", urgent: false }], "publicaAnunt", undefined, "Anunt publicat la avizier"],
  ["seteazaReminder", ["plata", true, 3], "seteazaReminder", undefined, null],
  ["trimiteReminder", ["plata"], "trimiteReminder", { destinatari: 3, apartamente: 2 }, null],
  ["deschideVot", [{ titlu: "Usa" }], "deschideVot", undefined, "Votul a fost deschis"],
  ["reamintesteVot", ["vot-1"], "reamintesteVot", { destinatari: 1 }, null],
  ["convoacaAdunare", [{ loc: "Parter" }], "convoacaAdunare", { destinatari: 4 }, null],
  ["incarcaDocument", [{ titlu: "PV" }], "incarcaDocument", undefined, "Documentul a fost incarcat"],
];

async function pornesteAdmin() {
  const r = await pornesteApp({ email: ADMIN });
  const ctx = () => contextApp(r.container);
  const incarca = vi.spyOn(r.sursa, "incarca");
  return { ...r, ctx, incarca };
}

describe("cmd(): succes", () => {
  it.each(COMENZI.map((c) => [c[0], c[4] || "fara mesaj", c]))("%s -> %s", async (_n, _m, [nume, args, metoda, intoarce, mesaj]) => {
    const { sursa, ctx, incarca } = await pornesteAdmin();
    const fn = vi.spyOn(sursa, metoda).mockResolvedValue(intoarce);
    await act(async () => { ctx().toastMsg("inainte"); });
    let r;
    await act(async () => { r = await ctx()[nume](...args); });
    expect(fn).toHaveBeenCalledWith(...args);
    expect(r).toEqual({ ok: true, rezultat: intoarce });
    expect(incarca).toHaveBeenCalledTimes(1);
    expect(toast().textContent).toBe(mesaj || "inainte");
  });

  it("dateMotor nu reincarca datele si nu arata mesaj", async () => {
    const { sursa, ctx, incarca } = await pornesteAdmin();
    vi.spyOn(sursa, "dateMotor").mockResolvedValue({ apartamente: [] });
    let r;
    await act(async () => { r = await ctx().dateMotor("lis-1"); });
    expect(r).toEqual({ ok: true, rezultat: { apartamente: [] } });
    expect(incarca).not.toHaveBeenCalled();
    expect(toast()).toBeNull();
  });

  it("modDemo si urlFisier vin din sursa", async () => {
    const { sursa, ctx } = await pornesteAdmin();
    expect(ctx().modDemo).toBe(true);
    const url = vi.spyOn(sursa, "urlFisier").mockResolvedValue("blob:x");
    expect(await ctx().urlFisier("poze/a.jpg")).toBe("blob:x");
    expect(url).toHaveBeenCalledWith("poze/a.jpg");
  });
});

describe("cmd(): eroare", () => {
  it.each(COMENZI.map((c) => [c[0], c]))("%s arata mesajul erorii", async (_n, [nume, args, metoda]) => {
    const { sursa, ctx, incarca } = await pornesteAdmin();
    const e = new Error(`Refuzat: ${nume}`);
    vi.spyOn(sursa, metoda).mockRejectedValue(e);
    let r;
    await act(async () => { r = await ctx()[nume](...args); });
    expect(r).toEqual({ ok: false, eroare: e, mesaj: `Refuzat: ${nume}` });
    expect(incarca).not.toHaveBeenCalled();
    expect(toast().textContent).toBe(`Refuzat: ${nume}`);
  });

  it("o eroare fara mesaj primeste un mesaj general", async () => {
    const { sursa, ctx } = await pornesteAdmin();
    vi.spyOn(sursa, "publicaLista").mockRejectedValue({});
    let r;
    await act(async () => { r = await ctx().publicaLista("lis-1"); });
    expect(r.ok).toBe(false);
    expect(toast().textContent).toBe("A aparut o eroare. Incearca din nou.");
  });

  it("reincarcarea care esueaza dupa o comanda reusita arata eroarea, dar comanda ramane reusita", async () => {
    const { sursa, ctx } = await pornesteAdmin();
    vi.spyOn(sursa, "stergeCheltuiala").mockResolvedValue(undefined);
    vi.spyOn(sursa, "incarca").mockRejectedValueOnce(new Error("Retea cazuta"));
    let r;
    await act(async () => { r = await ctx().stergeCheltuiala("che-1"); });
    expect(r.ok).toBe(true);
    /* mesajul comenzii vine dupa reincarcare si il inlocuieste */
    expect(toast().textContent).toBe("Cheltuiala a fost stearsa");

    vi.spyOn(sursa, "incarca").mockRejectedValueOnce({});
    let d;
    await act(async () => { d = await ctx().reincarca(); });
    expect(d).toBeNull();
    expect(toast().textContent).toBe("Datele nu au putut fi incarcate.");

    vi.spyOn(sursa, "incarca").mockRejectedValueOnce(new Error("Sesiune expirata"));
    await act(async () => { d = await ctx().reincarca(); });
    expect(toast().textContent).toBe("Sesiune expirata");
  });
});

describe("mesajul (Toast)", () => {
  it("dispare singur dupa 3,4 secunde, iar un mesaj nou reporneste numaratoarea", async () => {
    const { ctx } = await pornesteAdmin();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await act(async () => { ctx().toastMsg("Primul"); });
    expect(toast().textContent).toBe("Primul");
    await act(async () => { vi.advanceTimersByTime(3000); });
    await act(async () => { ctx().toastMsg("Al doilea"); });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(toast().textContent).toBe("Al doilea");
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(toast()).toBeNull();
  });
});

describe("deschideDocument: fereastra se deschide la apasare, URL-ul vine dupa", () => {
  it("pune URL-ul semnat in fereastra deschisa", async () => {
    const { sursa, ctx } = await pornesteAdmin();
    const w = { location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(w);
    vi.spyOn(sursa, "deschideDocument").mockResolvedValue("https://semnat/doc.pdf");
    await act(async () => { ctx().deschideDocument("doc-1"); });
    expect(open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(w.location.href).toBe("https://semnat/doc.pdf"));
    expect(w.close).not.toHaveBeenCalled();
  });

  it("fereastra blocata de browser: deschide URL-ul direct", async () => {
    const { sursa, ctx } = await pornesteAdmin();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(sursa, "deschideDocument").mockResolvedValue("https://semnat/doc.pdf");
    await act(async () => { ctx().deschideDocument("doc-1"); });
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://semnat/doc.pdf", "_blank", "noopener"));
  });

  it("document fara fisier: inchide fereastra si spune de ce", async () => {
    const { sursa, ctx } = await pornesteAdmin();
    const w = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(w);
    vi.spyOn(sursa, "deschideDocument").mockResolvedValue(null);
    await act(async () => { ctx().deschideDocument("doc-1"); });
    await waitFor(() => expect(toast().textContent).toBe("Documentul nu are fisier atasat."));
    expect(w.close).toHaveBeenCalled();
  });

  it("eroare cu si fara mesaj, fara fereastra", async () => {
    const { sursa, ctx } = await pornesteAdmin();
    vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(sursa, "deschideDocument").mockRejectedValueOnce(new Error("Documentul nu exista.")).mockRejectedValueOnce({});
    await act(async () => { ctx().deschideDocument("doc-x"); });
    await waitFor(() => expect(toast().textContent).toBe("Documentul nu exista."));
    await act(async () => { ctx().deschideDocument("doc-y"); });
    await waitFor(() => expect(toast().textContent).toBe("Documentul nu a putut fi deschis."));
  });
});
