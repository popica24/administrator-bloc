/* Helperii (sectiunea 2), etichetele (3), derivarile ramase (4) si
   primitivele (5-6): numarDin, lunaUrmatoare, plural, Field, Picker, Switch,
   Sheet, BareLunare, PozaStocata, deschideUrl, descarcaPdf, confirma. */
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, act, waitFor, within } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, zonaCu, ajutorulCampului, ADMIN, LOCATAR } from "./ajutor.jsx";
import { apasa, tab, scrie, prindePdf, toast } from "./ui-baza-ajutor.jsx";

const AP = "apa-35";
const buton = (text) => screen.getAllByRole("button").find((b) => b.textContent === text);
const dezactivat = (text) => buton(text).getAttribute("aria-disabled") === "true";
const ecran = (c) => c.querySelector(".ab-scroll").textContent;

/* Fisa apartamentului, deschisa de administrator */
async function fisa(numar, modifica) {
  const r = await pornesteApp({ email: ADMIN, modifica });
  await tab("Apartamente");
  await apasa(`Apartament ${numar}`);
  return { ...r, dialog: screen.getByRole("dialog") };
}

describe("numarDin: suma scrisa de om in formularul de incasare", () => {
  async function incaseaza(text) {
    await apasa("Inregistreaza incasare cash");
    await scrie("Suma primita", text);
  }

  it("citeste formatul romanesc si cel cu punct zecimal; refuza ce nu e numar", async () => {
    const { sursa } = await fisa("11");
    const numerar = vi.spyOn(sursa, "inregistreazaIncasare").mockResolvedValue({ plataId: null });
    await apasa("Inregistreaza incasare cash");
    /* campul pleaca de la sold, scris romaneste, si se citeste inapoi exact */
    expect(screen.getByLabelText("Suma primita").value).toBe("3.939,38");
    /* [F8] nu exista nicio cale de a anula o chitanta emisa; ecranul o spune inainte de emitere */
    expect(screen.getByText("Banii se aloca automat pe cea mai veche datorie. Chitanta se emite imediat si nu poate fi anulata din aplicatie; verifica suma inainte de a continua.")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("lei")).toBeTruthy();
    await apasa("Emite chitanta");
    expect(numerar).toHaveBeenLastCalledWith("apa-23", 3939.38, "numerar");

    for (const gol of ["   ", "abc", "0", "-5"]) {
      await incaseaza(gol);
      expect(dezactivat("Emite chitanta")).toBe(true);
      await apasa("Renunta");
    }

    await incaseaza("1.234,5");
    await apasa("Emite chitanta");
    expect(numerar).toHaveBeenLastCalledWith("apa-23", 1234.5, "numerar");

    await incaseaza(" 1234.5 ");
    await apasa("Emite chitanta");
    expect(numerar).toHaveBeenLastCalledWith("apa-23", 1234.5, "numerar");

    await incaseaza("12 50");
    await apasa("Emite chitanta");
    expect(numerar).toHaveBeenLastCalledWith("apa-23", 1250, "numerar");
    expect(numerar).toHaveBeenCalledTimes(4);
  });

  it("un buton dezactivat nu raspunde nici la tastatura", async () => {
    const { sursa } = await fisa("11");
    const numerar = vi.spyOn(sursa, "inregistreazaIncasare");
    await incaseaza("");
    const b = buton("Emite chitanta");
    expect(b.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(b, { key: "Enter" });
    fireEvent.click(b);
    expect(numerar).not.toHaveBeenCalled();
  });

  /* Audit F5: "1.500" (o mie cinci sute, scris romaneste) se citeste 1,50 lei */
  it("[F5] 1.500 inseamna o mie cinci sute de lei", async () => {
    const { sursa } = await fisa("11");
    const numerar = vi.spyOn(sursa, "inregistreazaIncasare").mockResolvedValue({ plataId: null });
    await incaseaza("1.500");
    await apasa("Emite chitanta");
    expect(numerar).toHaveBeenLastCalledWith("apa-23", 1500, "numerar");
  });
});

describe("helperii de luni si plural", () => {
  it("dupa decembrie urmeaza ianuarie anul urmator; fara ciorna se ofera lista noua", async () => {
    const { container } = await pornesteApp({
      email: ADMIN,
      modifica: (d) => {
        d.liste = d.liste.filter((l) => l.stare !== "ciorna");
        d.liste[0].luna = "2026-12";
      },
    });
    await tab("Facturi");
    expect(ecran(container)).toContain("Lista pe ianuarie 2027 nu este inceputa");
    expect(buton("Incepe lista pe ianuarie 2027")).toBeTruthy();
  });

  it("plural: 1 cheltuiala, 2 cheltuieli", async () => {
    const { container } = await pornesteApp({
      email: ADMIN,
      modifica: (d) => {
        const c = d.liste.find((l) => l.stare === "ciorna");
        d.cheltuieli.push({ ...d.cheltuieli.find((x) => x.listaId === c.id), id: "che-doi", cod: "C3" });
      },
    });
    expect(ecran(container)).toContain("Lista pe septembrie 2026 este in lucru2 cheltuieli adaugate.");
  });
});

describe("etichetele: valorile necunoscute raman asa cum sunt", () => {
  it("categoria sesizarii", async () => {
    const { container } = await pornesteApp({
      email: LOCATAR,
      modifica: (d) => { d.sesizari.find((s) => s.aMea && s.stare === "rezolvata").categorie = "ascensor_vechi"; },
    });
    await tab("Sesizari");
    expect(ecran(container)).toContain("Iluminat si electrice · 9 sep 2026");
    expect(ecran(container)).toContain("ascensor_vechi · 21 aug 2026");
  });

  it("tipul documentului", async () => {
    await pornesteApp({ email: LOCATAR, modifica: (d) => { d.documente[1].tip = "memoriu"; } });
    await tab("Bloc");
    await apasa("Acte");
    expect(screen.getByText("Factura · 5 sep 2026")).toBeTruthy();
    expect(screen.getByText("memoriu · 4 sep 2026")).toBeTruthy();
  });

  it("calitatea locatarului", async () => {
    const { dialog } = await fisa("17", (d) => {
      const ap = d.apartamente.find((a) => a.id === AP);
      ap.locatari.push({ ...ap.locatari[0], id: "loc-x", nume: "Andrei Marinescu", calitate: "nepot", telefon: null });
    });
    expect(dialog.textContent).toContain("Elena MarinescuProprietar · din 1 iun 2026 · 0733 410 217");
    expect(dialog.textContent).toContain("Andrei Marinescunepot · din 1 iun 2026Parola nouaInchide");
  });
});

describe("derivari la margine", () => {
  it("o luna fara apa rece validata apare cu liniuta", async () => {
    const { dialog } = await fisa("17", (d) => {
      d.citiri = d.citiri.filter((c) => !(c.apartamentId === AP && c.luna === "2026-08" && c.tip === "rece"));
    });
    expect(dialog.textContent).toContain("august 2026rece - · calda 9,02 mc");
  });

  it("codurile cu acelasi numar se ordoneaza alfabetic in PDF", async () => {
    await pornesteApp({
      email: ADMIN,
      modifica: (d) => {
        const c1 = d.cheltuieli.find((c) => c.listaId === "lis-807" && c.cod === "C1");
        d.cheltuieli.push({ ...c1, id: "che-01", cod: "C01", suma: 10 });
      },
    });
    const pdf = prindePdf();
    await apasa("Exporta lista PDF");
    const { text } = await pdf.ultimul();
    expect(text).toContain("Pers.\nC01\nC1\nC2");
  });

  it("un apartament fara datorie pe lista curenta: de plata este totalul lunii", async () => {
    await pornesteApp({ email: ADMIN, modifica: (d) => { d.datorii = d.datorii.filter((x) => x.id !== "dat-1021"); } });
    const pdf = prindePdf();
    await apasa("Exporta lista PDF");
    const { text } = await pdf.ultimul();
    expect(text).toContain("74,08\n718,09\n\n\n718,09\n18\nNicolae Serban");
  });

  it("un contor nou, fara citiri, porneste de la indexul 0", async () => {
    const { container } = await pornesteApp({
      email: LOCATAR,
      modifica: (d) => { d.contoare.push({ id: "con-nou", apartamentId: AP, tip: "rece", serie: "R-NOU", amplasare: "bucatarie" }); },
    });
    await tab("Contoare");
    expect(ecran(container)).toContain("Apa rece, index anterior 244,5mcContor R-D14-17, baie");
    expect(ecran(container)).toContain("Apa rece, index anterior 0,0mcContor R-NOU, bucatarie");
  });

  it("indexul anterior este cel din ultima luna valabila, oricum ar veni citirile", async () => {
    const citire = (luna, index, stare = "validata") => ({ id: `cit-${luna}-${index}`, contorId: "con-111", apartamentId: AP, tip: "rece", luna, indexAnterior: index - 1, indexCurent: index, consum: 1, sursa: "citit", stare, transmisaLa: `${luna}-20T10:00:00+03:00` });
    const { container } = await pornesteApp({
      email: LOCATAR,
      modifica: (d) => {
        d.citiri = d.citiri.filter((c) => c.contorId !== "con-111");
        d.citiri.push(citire("2026-06", 216.9), citire("2026-08", 244.5, "respinsa"), citire("2026-05", 202.7), citire("2026-07", 229.8));
      },
    });
    await tab("Contoare");
    /* august e respins, deci anteriorul vine din iulie */
    expect(ecran(container)).toContain("Apa rece, index anterior 229,8mcContor R-D14-17, baie");
  });
});

describe("BareLunare", () => {
  it("luna fara valoare are liniuta, luna estimata are chenar punctat", async () => {
    const { container } = await pornesteApp({
      email: LOCATAR,
      modifica: (d) => {
        d.citiri = d.citiri.filter((c) => !(c.apartamentId === AP && c.luna === "2026-07" && c.tip === "calda"));
        d.citiri.find((c) => c.apartamentId === AP && c.luna === "2026-08" && c.tip === "calda").sursa = "estimat";
      },
    });
    await tab("Contoare");
    await apasa("Apa calda");
    /* luna fara valoare are liniuta in loc de cifra, iar cea estimata este
       marcata ca atare si in graficul de sus, si in lista de dedesubt */
    const grafic = zonaCu(["Cum a evoluat consumul", "aug 26"]);
    expect(grafic.textContent).toContain("8,5iun 26-iul 269,0aug 26");
    expect(ecran(container)).toContain("aug 26 (estimat)");
    expect(ecran(container)).toContain("iul 26-");
  });

  it("toate lunile fara valoare: barele raman la inaltimea minima", async () => {
    await pornesteApp({
      email: LOCATAR,
      modifica: (d) => { d.citiri.filter((c) => c.apartamentId === AP && c.tip === "calda").forEach((c) => { c.consum = 0; }); },
    });
    await tab("Contoare");
    await apasa("Apa calda");
    const grafic = zonaCu(["Cum a evoluat consumul", "aug 26"]);
    expect(grafic.textContent).toContain("0,0iun 260,0iul 260,0aug 26");
  });
});

describe("Sheet, Field, Picker si pozele alese", () => {
  it("se inchide din scrim sau din X, dar nu la apasarea in interior", async () => {
    await pornesteApp({ email: LOCATAR });
    await tab("Sesizari");
    await apasa("Sesizare noua");
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => { fireEvent.click(dialog.parentElement); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await apasa("Sesizare noua");
    await apasa("Inchide");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /* [C18] Sheet-ul nu avea management de focus: la inchidere focusul se
     pierdea (ramanea pe body), iar Tab putea iesi din panou catre restul
     ecranului din spate, ascuns dupa scrim. */
  it("[C18] la inchidere, focusul revine la elementul care a deschis sheet-ul", async () => {
    await pornesteApp({ email: LOCATAR });
    await tab("Sesizari");
    const declansator = buton("Sesizare noua");
    declansator.focus();
    await apasa("Sesizare noua");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await apasa("Inchide");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(declansator);
  });

  it("[C18] Tab si Shift+Tab nu ies din sheet, se rotesc la celalalt capat", async () => {
    await pornesteApp({ email: LOCATAR });
    await tab("Sesizari");
    await apasa("Sesizare noua");
    const dialog = screen.getByRole("dialog");
    const focalizabile = [...dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="file"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )];
    expect(focalizabile.length).toBeGreaterThan(1);
    const prim = focalizabile[0];
    const ultim = focalizabile[focalizabile.length - 1];

    ultim.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(prim);

    prim.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(ultim);

    /* Tab si Shift+Tab in afara capetelor nu fac nimic (Tab-ul normal preia) */
    prim.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(prim);
    ultim.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(ultim);
  });

  it("[F5] Shift+Tab imediat dupa deschidere nu scoate focusul din panou", async () => {
    /* La deschidere focusul este pe panoul insusi (tabIndex -1), nu pe primul
       element focalizabil: capcana trebuie sa recunoasca si acest caz, nu
       doar "activeElement === prim". */
    await pornesteApp({ email: LOCATAR });
    await tab("Sesizari");
    await apasa("Sesizare noua");
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);
    const focalizabile = [...dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="file"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )];
    const ultim = focalizabile[focalizabile.length - 1];

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(ultim);
  });

  it("campul pe mai multe randuri, lista de categorii si poza aleasa", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sesizare");
    await pornesteApp({ email: LOCATAR });
    await tab("Sesizari");
    await apasa("Sesizare noua");
    const desc = screen.getByLabelText("Unde este si de cand (optional)");
    expect(desc.tagName).toBe("TEXTAREA");
    await scrie("Unde este si de cand (optional)", "Etajul 2");
    expect(desc.value).toBe("Etajul 2");
    const cat = screen.getByLabelText("Categorie");
    expect([...cat.options].map((o) => o.textContent)).toEqual(["Instalatii, apa, canalizare", "Iluminat si electrice", "Usa, interfon, lift", "Curatenie si gunoi", "Altele"]);
    await act(async () => { fireEvent.change(cat, { target: { value: "acces" } }); });
    expect(cat.value).toBe("acces");

    const input = within(screen.getByRole("dialog")).getAllByLabelText(/poza/i).find((x) => x.tagName === "INPUT");
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["x"], "bec")] } }); });
    const img = await screen.findByAltText("Poza sesizare");
    expect(img.getAttribute("src")).toBe("blob:sesizare");
  });

  /* Audit X4: URL-urile de previzualizare ale pozelor nu se eliberau niciodata */
  it("[X4] dupa trimiterea sesizarii, previzualizarea pozei se elibereaza", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sesizare");
    const revoca = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { sursa } = await pornesteApp({ email: LOCATAR });
    vi.spyOn(sursa, "adaugaSesizare").mockResolvedValue(undefined);
    await tab("Sesizari");
    await apasa("Sesizare noua");
    const input = within(screen.getByRole("dialog")).getAllByLabelText("Adauga o poza").find((x) => x.tagName === "INPUT");
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["x"], "bec")] } }); });
    await screen.findByAltText("Poza sesizare");
    await apasa("Bec ars pe scara");
    await apasa("Trimite sesizarea");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(revoca).toHaveBeenCalledWith("blob:sesizare");
  });

  it("campul fara eticheta foloseste textul de ajutor ca nume", async () => {
    await pornesteApp({ email: LOCATAR });
    await tab("Sesizari");
    const f = screen.getByLabelText("Adauga un mesaj pentru administrator");
    expect(f.tagName).toBe("INPUT");
  });

  it("un camp cu eroare arata mesajul in locul indicatiei", async () => {
    await pornesteApp({ email: ADMIN });
    await tab("Facturi");
    await apasa("Adauga factura");
    await scrie("Cod pe lista", "C9");
    const camp = screen.getByLabelText("Cod pe lista");
    expect(camp.getAttribute("aria-invalid")).toBe("true");
    expect(ajutorulCampului("Cod pe lista")).toBe("Codul exista deja");
  });
});

describe("Switch si textele reminderelor", () => {
  it("fiecare reminder spune cand pleaca; comutatorul trimite starea inversa", async () => {
    const { sursa } = await pornesteApp({
      email: ADMIN,
      modifica: (d) => { d.remindere.find((r) => r.tip === "plata").zile = 1; },
    });
    const seteaza = vi.spyOn(sursa, "seteazaReminder");
    await tab("Comunicare");
    await apasa("Remindere");
    expect(screen.getByText("In ziua publicarii listei")).toBeTruthy();
    expect(screen.getByText("Cu 5 zile inainte de termenul de citire")).toBeTruthy();
    expect(screen.getByText("Cu o zi inainte de scadenta")).toBeTruthy();
    expect(screen.getByText("La 30 de zile de la scadenta")).toBeTruthy();
    expect(screen.getByText("Cu 10 zile inainte de data adunarii")).toBeTruthy();

    const comutator = (nume) => screen.getAllByRole("button", { name: nume }).find((b) => b.hasAttribute("aria-pressed"));
    const plata = comutator("Reamintire de plata");
    const ag = comutator("Convocare adunare generala");
    expect(plata.getAttribute("aria-pressed")).toBe("true");
    expect(ag.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { fireEvent.click(plata); });
    expect(seteaza).toHaveBeenLastCalledWith("plata", false, 1);
    await act(async () => { fireEvent.click(ag); });
    expect(seteaza).toHaveBeenLastCalledWith("adunare_generala", true, 10);
  });
});

describe("PozaStocata", () => {
  it("cere URL-ul semnat; fara URL ramane locul gol; poza se deschide la apasare", async () => {
    const { sursa } = await pornesteApp({
      email: LOCATAR,
      modifica: (d) => {
        d.sesizari.find((s) => s.aMea && s.stare === "in_lucru").poze = [
          { id: "p1", cale: "demo/poza.jpg" },
          { id: "p2", cale: "poze/bun.jpg" },
          { id: "p3", cale: "poze/lipsa.jpg" },
          { id: "p4", cale: null },
        ];
      },
    });
    const url = vi.spyOn(sursa, "urlFisier").mockImplementation(async (c) => (c === "poze/bun.jpg" ? "blob:bun" : null));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await tab("Sesizari");
    const img = await screen.findByAltText("Poza atasata");
    expect(img.getAttribute("src")).toBe("blob:bun");
    expect(url.mock.calls.map((c) => c[0])).toEqual(["poze/bun.jpg", "poze/lipsa.jpg"]);
    expect(screen.getAllByText("POZA")).toHaveLength(3);
    await apasa("Deschide poza");
    expect(open).toHaveBeenCalledWith("blob:bun", "_blank", "noopener");
  });

  it("un raspuns venit dupa inchiderea ecranului este ignorat", async () => {
    let raspunde;
    const { sursa } = await pornesteApp({
      email: LOCATAR,
      modifica: (d) => { d.sesizari.find((s) => s.aMea && s.stare === "in_lucru").poze = [{ id: "p2", cale: "poze/bun.jpg" }]; },
    });
    vi.spyOn(sursa, "urlFisier").mockImplementation(() => new Promise((r) => { raspunde = r; }));
    await tab("Sesizari");
    expect(screen.getByText("POZA")).toBeTruthy();
    await tab("Plata");
    await act(async () => { raspunde("blob:tarziu"); });
    expect(screen.queryByAltText("Poza atasata")).toBeNull();
  });
});

describe("deschideUrl, descarcaPdf, confirma si documentul din RandLista", () => {
  it("Suna deschide aplicatia de telefon, fara fereastra noua", async () => {
    const open = vi.spyOn(window, "open");
    await pornesteApp({ email: LOCATAR });
    await apasa("Suna 0745 210 118");
    /* window.location nu se poate spiona in jsdom; tel: nu schimba pagina */
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText("Pe cine suni")).toBeTruthy();
  });

  it("PDF-ul descarcat elibereaza URL-ul temporar dupa 4 secunde", async () => {
    await pornesteApp({ email: ADMIN });
    const pdf = prindePdf();
    const revoca = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await apasa("Exporta lista PDF");
    expect(pdf.descarcate).toHaveLength(1);
    expect(document.querySelector("a[download]")).toBeNull();
    /* Un export dintr-un test anterior si-a lasat in urma un setTimeout
       adevarat de 4 secunde. Pe o masina incarcata (CI, sub acoperire) acela
       se declanseaza tocmai acum si loveste spionul de aici, desi n-are nicio
       legatura cu exportul asta. Stergem ce s-a strans pana in clipa asta si
       masuram doar ceasul fals, al carui timp il controlam noi. */
    revoca.mockClear();
    act(() => { vi.advanceTimersByTime(3999); });
    expect(revoca).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(revoca).toHaveBeenCalledWith("blob:test-1");
  });

  it("confirma: fara acord nu se inchide accesul, cu acord da", async () => {
    const { sursa } = await fisa("17");
    const inchide = vi.spyOn(sursa, "inchideAcces");
    const intreaba = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await apasa("Inchide accesul");
    expect(intreaba).toHaveBeenCalledWith("Inchizi accesul lui Elena Marinescu la apartamentul 17? Istoricul ramane.");
    expect(inchide).not.toHaveBeenCalled();
    await apasa("Inchide accesul");
    expect(inchide).toHaveBeenCalledTimes(1);
    expect(toast().textContent).toBe("Accesul a fost inchis");
  });

  it("Vezi documentul din randul listei deschide factura", async () => {
    const { sursa } = await pornesteApp({ email: LOCATAR });
    const w = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(w);
    const doc = vi.spyOn(sursa, "deschideDocument").mockResolvedValue("blob:factura");
    await tab("Plata");
    await apasa("Salubritate, 68,57 lei");
    await apasa("Vezi documentul");
    expect(doc).toHaveBeenCalledWith("doc-815");
    await waitFor(() => expect(w.location.href).toBe("blob:factura"));
  });
});
