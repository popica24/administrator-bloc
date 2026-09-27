/* Ecranele de dinainte de aplicatie (sectiunea 10): intrarea in cont cu
   numarul de telefon si ecranul contului fara apartament. */
import { describe, it, expect, vi } from "vitest";
import { screen, act } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, sursaDemo, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";
import { apasa, scrie, sursaCu, toast } from "./ui-baza-ajutor.jsx";

const buton = (text) => screen.getAllByRole("button").find((b) => b.textContent === text);
const dezactivat = (text) => buton(text).getAttribute("aria-disabled") === "true";

describe("EcranAutentificare, intrarea in cont", () => {
  it("arata promisiunea aplicatiei si caseta modului demonstrativ", async () => {
    await pornesteApp();
    await screen.findByText("Intră în cont");
    expect(screen.getByText("AdminBloc")).toBeTruthy();
    expect(screen.getByText("Vezi cât ai de plată, de ce atât și cum s-a ajuns la suma aceea.")).toBeTruthy();
    expect(screen.getByText("Mod demonstrativ, fără server")).toBeTruthy();
    expect(screen.getByText(/Parola pentru ambele: Bloc-D14-2026/)).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("fara modul demonstrativ nu arata conturile de test", async () => {
    await pornesteApp({ sursa: sursaCu({ tip: "supabase" }) });
    await screen.findByText("Intră în cont");
    expect(screen.queryByText("Mod demonstrativ, fără server")).toBeNull();
  });

  it("butonul Intra asteapta un numar de telefon intreg si o parola", async () => {
    await pornesteApp();
    await screen.findByText("Intră în cont");
    expect(dezactivat("Intră")).toBe(true);
    await scrie("Numărul tău de telefon", "0733");
    await scrie("Parola", "x");
    expect(dezactivat("Intră")).toBe(true);
    /* scris cu spatii sau cu prefixul tarii, este acelasi numar */
    await scrie("Numărul tău de telefon", " 0733 410 217 ");
    expect(dezactivat("Intră")).toBe(false);
    await scrie("Numărul tău de telefon", "+40733410217");
    expect(dezactivat("Intră")).toBe(false);
    await scrie("Parola", "");
    expect(dezactivat("Intră")).toBe(true);
  });

  /* [R4] Mesajul spunea doar ce e gresit, nu si ce sa faca omul in continuare. */
  it("[R4] parola gresita: mesaj clar, cu pasul urmator, si ramane pe ecran", async () => {
    await pornesteApp();
    await screen.findByText("Intră în cont");
    await scrie("Numărul tău de telefon", LOCATAR);
    await scrie("Parola", "gresita");
    await apasa("Intră");
    expect(toast().textContent).toBe("Numarul de telefon sau parola nu sunt corecte. Verifica-le si incearca din nou.");
    expect(screen.getByText("Intră în cont")).toBeTruthy();
    expect(buton("Intră")).toBeTruthy();
  });

  it("cat timp verifica, butonul spune Se verifica si nu se poate apasa", async () => {
    let gata;
    const s = sursaDemo();
    const intra = s.intra.bind(s);
    s.intra = (e, p) => new Promise((r) => { gata = () => r(intra(e, p)); });
    await pornesteApp({ sursa: s });
    await screen.findByText("Intră în cont");
    await scrie("Numărul tău de telefon", ` ${LOCATAR} `);
    await scrie("Parola", PAROLA);
    await apasa("Intră");
    expect(dezactivat("Se verifică...")).toBe(true);
    await act(async () => { gata(); });
    await screen.findByText("Ieși");
    expect(screen.getByText("Elena Marinescu")).toBeTruthy();
    expect(screen.getByText("Apartament 17, Bloc D14, scara A")).toBeTruthy();
  });

});

describe("EcranFaraAcces", () => {
  it("contul fara apartament asteapta administratorul si poate iesi", async () => {
    const s = sursaDemo();
    await s.intra("0755 900 800", PAROLA);
    await pornesteApp({ sursa: s });
    await screen.findByText("Contul nu este legat de un apartament");
    expect(screen.getByText("Bună, Cosmin")).toBeTruthy();
    expect(screen.getByText("0755 900 800")).toBeTruthy();
    expect(screen.getByText(/Administratorul blocului leagă contul/)).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    await apasa("Ieși din cont");
    await screen.findByText("Intră în cont");
  });

  /* [K19] Cand exista un motiv scris (o cerere de administrator respinsa de
     noi), omul il vede; fara el, ecranul nu arata un rand gol. */
  it("[K19] motivul respingerii, cand exista, se vede pe ecran", async () => {
    const s = sursaDemo((d) => { d.eu.motivRespingere = "Atestatul din poza nu se poate citi."; });
    await s.intra("0755 900 800", PAROLA);
    await pornesteApp({ sursa: s });
    await screen.findByText("Contul nu este legat de un apartament");
    expect(screen.getByText("Atestatul din poza nu se poate citi.")).toBeTruthy();
  });
});
