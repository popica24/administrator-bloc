/* Shell-ul aplicatiei (sectiunile 10-11): incarcarea, TabBar cu insigne,
   BaraSus, navigarea go() si iesirea din cont. */
import { describe, it, expect, vi } from "vitest";
import { screen, act, render, fireEvent } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import AdminBloc from "../../src/AdminBloc.jsx";
import { pornesteApp, sursaDemo, ceasDemo, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";
import { apasa, tab, scrie, toast } from "./ui-baza-ajutor.jsx";

const taburi = () => screen.getAllByRole("tab").map((t) => [t.textContent, t.getAttribute("aria-selected")]);

describe("incarcarea", () => {
  it("arata Se incarca pana raspunde sesiunea, apoi ecranul de intrare", async () => {
    ceasDemo();
    let raspunde;
    const s = sursaDemo();
    s.sesiuneCurenta = () => new Promise((r) => { raspunde = r; });
    globalThis.sursaTest = s;
    render(<AdminBloc />);
    expect(screen.getByText("Se incarca...")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    await act(async () => { raspunde(null); });
    expect(screen.getByText("Intra in cont")).toBeTruthy();
  });

  it("o sesiune care raspunde dupa inchiderea aplicatiei nu mai schimba nimic", async () => {
    ceasDemo();
    let raspunde;
    const s = sursaDemo();
    s.sesiuneCurenta = () => new Promise((r) => { raspunde = r; });
    const incarca = vi.spyOn(s, "incarca");
    globalThis.sursaTest = s;
    const { unmount } = render(<AdminBloc />);
    unmount();
    await act(async () => { raspunde({ profilId: "x" }); });
    expect(incarca).not.toHaveBeenCalled();
  });

  it("cu sesiune: Se incarca pana vin datele", async () => {
    ceasDemo();
    let gata;
    const s = sursaDemo();
    await s.intra(LOCATAR, PAROLA);
    const incarca = s.incarca.bind(s);
    s.incarca = () => new Promise((r) => { gata = () => r(incarca()); });
    globalThis.sursaTest = s;
    render(<AdminBloc />);
    await act(async () => {});
    expect(screen.getByText("Se incarca...")).toBeTruthy();
    await act(async () => { gata(); });
    await screen.findByText("Iesi");
    expect(screen.queryByText("Se incarca...")).toBeNull();
  });

  it("daca prima incarcare cade, spune de ce", async () => {
    const s = sursaDemo();
    await s.intra(LOCATAR, PAROLA);
    s.incarca = () => Promise.reject(new Error("Blocul este arhivat."));
    await pornesteApp({ sursa: s });
    await act(async () => {});
    expect(toast().textContent).toBe("Blocul este arhivat.");
  });

  /* [C2] sesiunea expira intre timp (sesiuni cu durata acum limitata): a doua
     incarcare intoarce null, nu o eroare. Fara reparatie, "sesiune" ramane
     setat si omul ramane blocat pe "Se incarca..." la nesfarsit. */
  it("[C2] daca sesiunea a expirat intre timp, o comanda care reincarca duce la ecranul de intrare", async () => {
    const { sursa } = await pornesteApp({ email: LOCATAR });
    vi.spyOn(sursa, "incarca").mockResolvedValue(null);
    await apasa("Am citit");
    expect(screen.getByText("Intra in cont")).toBeTruthy();
    expect(screen.queryByText("Se incarca...")).toBeNull();
  });

  /* Audit S3: dupa o prima incarcare esuata nu exista buton de iesire sau de reincercare */
  it("[S3] daca prima incarcare cade, omul poate iesi sau reincerca", async () => {
    const s = sursaDemo();
    await s.intra(LOCATAR, PAROLA);
    s.incarca = () => Promise.reject(new Error("Blocul este arhivat."));
    await pornesteApp({ sursa: s });
    await act(async () => {});
    expect(screen.getAllByRole("button").some((b) => /Iesi|Incearca din nou/.test(b.textContent))).toBe(true);
  });

  /* [P3] O sesiune moarta chiar la prima incarcare (dupa un repornit al
     aplicatiei cu o sesiune veche pe disc) nu are rost sa arate "Incearca
     din nou": reincercarea va esua la fel. Omul merge direct la intrare, cu
     toastul care explica de ce. */
  it("[P3] daca prima incarcare cade cu sesiunea expirata, merge direct la intrare, fara cardul de reincercare", async () => {
    const s = sursaDemo();
    await s.intra(LOCATAR, PAROLA);
    s.incarca = () => Promise.reject(new Error("Sesiunea a expirat. Intra din nou in cont."));
    await pornesteApp({ sursa: s });
    await act(async () => {});
    expect(screen.getByText("Intra in cont")).toBeTruthy();
    expect(screen.queryByText("Nu am putut deschide contul")).toBeNull();
    expect(toast().textContent).toBe("Sesiunea a expirat. Intra din nou in cont.");
  });
});

describe("TabBar si BaraSus", () => {
  it("administratorul: cinci taburi, insigne pentru citiri trimise si sesizari noi", async () => {
    await pornesteApp({ email: ADMIN });
    expect(taburi()).toEqual([
      ["Sumar", "true"], ["Apartamente8", "false"], ["Facturi", "false"], ["Sesizari1", "false"], ["Comunicare", "false"],
    ]);
    expect(screen.getByText("Mihai Dobre")).toBeTruthy();
    expect(screen.getByText("Administrator, Bloc D14, scara A")).toBeTruthy();
    expect(screen.getByText("D14")).toBeTruthy();
  });

  it("locatarul: insigne pentru sesizarile lui deschise, anunturi si notificari necitite", async () => {
    await pornesteApp({ email: LOCATAR });
    expect(taburi()).toEqual([
      ["Acasa1", "true"], ["Plata", "false"], ["Contoare", "false"], ["Sesizari1", "false"], ["Bloc1", "false"],
    ]);
    expect(screen.getByText("Apartament 17, Bloc D14, scara A")).toBeTruthy();
    expect(screen.getByText("D14")).toBeTruthy();
  });

  it("fara nimic nou nu apare nicio insigna; initialele vin din numele blocului", async () => {
    await pornesteApp({
      email: LOCATAR,
      modifica: (d) => {
        d.sesizari.forEach((s) => { s.stare = "rezolvata"; });
        d.anunturi.forEach((a) => { a.citit = true; });
        d.notificari.forEach((n) => { n.cititaLa = "2026-09-18T10:00:00+03:00"; });
        d.bloc.denumire = "bloc   m3 turnul";
      },
    });
    expect(taburi().map((t) => t[0])).toEqual(["Acasa", "Plata", "Contoare", "Sesizari", "Bloc"]);
    expect(screen.getByText("M3")).toBeTruthy();
  });

  it("apasarea pe tab schimba ecranul; tastatura merge la fel", async () => {
    await pornesteApp({ email: ADMIN });
    await tab("Facturi");
    expect(screen.getByText("Facturi si liste")).toBeTruthy();
    expect(taburi()[2]).toEqual(["Facturi", "true"]);
    const sumar = screen.getAllByRole("tab")[0];
    await act(async () => { fireEvent.keyDown(sumar, { key: "Enter" }); });
    expect(screen.getByText("Panou administrator")).toBeTruthy();
  });

  /* popstate ajunge la fereastra ca o sarcina asincrona (nu ca o microsarcina),
     deci se asteapta un ceas real, nu doar promisiuni rezolvate */
  const inapoiInBrowser = async () => {
    window.history.back();
    await act(async () => { await new Promise((r) => { setTimeout(r, 0); }); });
  };

  it("[E3] Inapoi in browser revine la tabul anterior, in loc sa iasa din aplicatie", async () => {
    await pornesteApp({ email: ADMIN });
    await tab("Facturi");
    await tab("Sesizari");
    expect(taburi()[3]).toEqual(["Sesizari1", "true"]);
    await inapoiInBrowser();
    expect(taburi()[2]).toEqual(["Facturi", "true"]);
    await inapoiInBrowser();
    expect(taburi()[0]).toEqual(["Sumar", "true"]);
  });

  /* [G14] O intrare straina in istoric (fara state pus de aplicatie, de
     exemplu inainte de primul replaceState sau venita din alta pagina) nu
     are voie sa darame ecranul: handler-ul de popstate citea e.state.tab
     fara nicio garda. */
  it("[G14] un eveniment popstate fara state nu arunca eroare si nu schimba tabul", async () => {
    await pornesteApp({ email: ADMIN });
    await tab("Facturi");
    /* O eroare intr-un ascultator de evenimente nu iese din dispatchEvent():
       jsdom (ca si un browser) o raporteaza pe window ca eroare neprinsa. */
    let prinsa = null;
    const prinde = (e) => { prinsa = e.error; e.preventDefault(); };
    window.addEventListener("error", prinde);
    try {
      await act(async () => { window.dispatchEvent(new PopStateEvent("popstate", { state: null })); });
    } finally {
      window.removeEventListener("error", prinde);
    }
    expect(prinsa).toBeNull();
    expect(taburi()[2]).toEqual(["Facturi", "true"]);
  });

  it("go() cu parametri: indicatorul Restante duce la apartamentele cu restanta", async () => {
    await pornesteApp({ email: ADMIN });
    await apasa("Restante");
    expect(taburi()[1]).toEqual(["Apartamente8", "true"]);
    const filtru = screen.getAllByRole("button").find((b) => b.textContent === "Restante 5");
    expect(filtru.getAttribute("aria-pressed")).toBe("true");
  });

  it("Iesi duce la ecranul de intrare, iar alt cont incepe de la primul tab", async () => {
    const { sursa } = await pornesteApp({ email: ADMIN });
    const iesi = vi.spyOn(sursa, "iesi");
    await tab("Comunicare");
    await apasa("Iesi");
    expect(iesi).toHaveBeenCalled();
    expect(screen.getByText("Intra in cont")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("Mihai Dobre")).toBeNull();
    await scrie("Email", LOCATAR);
    await scrie("Parola", PAROLA);
    await apasa("Intra");
    await screen.findByText("Iesi");
    expect(taburi()[0]).toEqual(["Acasa1", "true"]);
  });
});

describe("inregistrarea administratorului in doi pasi", () => {
  /* Audit S4: daca pasul 2 (cererea cu atestatul) esueaza, contul ramane
     "fara apartament", iar ecranul acela nu mai ofera formularul pentru atestat */
  it("[S4] dupa un pas 2 esuat, administratorul poate retrimite atestatul", async () => {
    const s = sursaDemo();
    s.cereVerificareAdministrator = () => Promise.reject(new Error("Upload esuat"));
    await pornesteApp({ sursa: s });
    await screen.findByText("Intra in cont");
    await apasa("Sunt administrator si vreau cont");
    await scrie("Numele tau", "Dana Pop");
    await scrie("Email", "dana@admin.ro");
    await scrie("Alege o parola", "ParolaBuna1");
    await scrie("Numarul atestatului", "AT-1");
    await apasa("Trimite cererea");
    await screen.findByText("Iesi din cont");
    expect(screen.getByLabelText("Numarul atestatului")).toBeTruthy();
  });
});
