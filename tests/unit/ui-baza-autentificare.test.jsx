/* Ecranele de dinainte de aplicatie (sectiunea 10): EcranAutentificare in
   cele trei moduri, EcranFaraAcces si micsoreazaPoza pentru poza atestatului. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, sursaDemo, PAROLA, ADMIN, LOCATAR } from "./ajutor.jsx";
import { apasa, scrie, sursaCu, toast } from "./ui-baza-ajutor.jsx";

const buton = (text) => screen.getAllByRole("button").find((b) => b.textContent === text);
const dezactivat = (text) => buton(text).getAttribute("aria-disabled") === "true";

/* Un cod de invitatie valabil, generat de administrator pe apartamentul 5 */
async function sursaCuCod() {
  const s = sursaDemo();
  await s.intra(ADMIN, PAROLA);
  const d = await s.incarca();
  const ap = d.apartamente.find((a) => a.numar === "5");
  const cod = await s.invitaLocatar(ap.id, "chirias");
  await s.iesi();
  return { s, cod };
}

describe("EcranAutentificare, intrarea in cont", () => {
  it("arata promisiunea aplicatiei si caseta modului demonstrativ", async () => {
    await pornesteApp();
    await screen.findByText("Intra in cont");
    expect(screen.getByText("AdminBloc")).toBeTruthy();
    expect(screen.getByText("Vezi cat ai de plata, de ce atat si cum s-a ajuns la suma aceea.")).toBeTruthy();
    expect(screen.getByText("Mod demonstrativ, fara server")).toBeTruthy();
    expect(screen.getByText(/Parola pentru ambele: Bloc-D14-2026/)).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("fara modul demonstrativ nu arata conturile de test", async () => {
    await pornesteApp({ sursa: sursaCu({ tip: "supabase" }) });
    await screen.findByText("Intra in cont");
    expect(screen.queryByText("Mod demonstrativ, fara server")).toBeNull();
  });

  it("butonul Intra asteapta un email valid si o parola", async () => {
    await pornesteApp();
    await screen.findByText("Intra in cont");
    expect(dezactivat("Intra")).toBe(true);
    await scrie("Email", "elena");
    await scrie("Parola", "x");
    expect(dezactivat("Intra")).toBe(true);
    await scrie("Email", "  elena@bloc.ro ");
    expect(dezactivat("Intra")).toBe(false);
    await scrie("Parola", "");
    expect(dezactivat("Intra")).toBe(true);
  });

  /* [R4] Mesajul spunea doar ce e gresit, nu si ce sa faca omul in continuare. */
  it("[R4] parola gresita: mesaj clar, cu pasul urmator, si ramane pe ecran", async () => {
    await pornesteApp();
    await screen.findByText("Intra in cont");
    await scrie("Email", LOCATAR);
    await scrie("Parola", "gresita");
    await apasa("Intra");
    expect(toast().textContent).toBe("Emailul sau parola nu sunt corecte. Verifica-le si incearca din nou.");
    expect(screen.getByText("Intra in cont")).toBeTruthy();
    expect(buton("Intra")).toBeTruthy();
  });

  it("cat timp verifica, butonul spune Se verifica si nu se poate apasa", async () => {
    let gata;
    const s = sursaDemo();
    const intra = s.intra.bind(s);
    s.intra = (e, p) => new Promise((r) => { gata = () => r(intra(e, p)); });
    await pornesteApp({ sursa: s });
    await screen.findByText("Intra in cont");
    await scrie("Email", ` ${LOCATAR} `);
    await scrie("Parola", PAROLA);
    await apasa("Intra");
    expect(dezactivat("Se verifica...")).toBe(true);
    await act(async () => { gata(); });
    await screen.findByText("Iesi");
    expect(screen.getByText("Elena Marinescu")).toBeTruthy();
    expect(screen.getByText("Apartament 17, Bloc D14, scara A")).toBeTruthy();
  });

  it("se trece intre cele trei moduri", async () => {
    await pornesteApp();
    await screen.findByText("Intra in cont");
    expect(buton("Am deja cont, vreau sa intru")).toBeUndefined();
    await apasa("Am un cod de la administrator");
    expect(screen.getByText("Am un cod de la administrator", { selector: "span[style*='font-size: 17px']" })).toBeTruthy();
    expect(buton("Am un cod de la administrator")).toBeUndefined();
    await apasa("Sunt administrator si vreau cont");
    expect(screen.getByText("Cont de administrator")).toBeTruthy();
    expect(buton("Sunt administrator si vreau cont")).toBeUndefined();
    await apasa("Am deja cont, vreau sa intru");
    expect(screen.getByText("Intra in cont")).toBeTruthy();
  });
});

describe("EcranAutentificare, cont nou de locatar cu cod", () => {
  async function completeaza(cod, email = "vecin.nou@bloc.ro") {
    await apasa("Am un cod de la administrator");
    await scrie("Codul primit", cod);
    await scrie("Numele tau", " Ion Vecinu ");
    await scrie("Telefon", " 0722 000 111 ");
    await scrie("Email", email);
    await scrie("Alege o parola", "ParolaBuna1");
  }

  it("valideaza codul, numele, emailul si parola", async () => {
    await pornesteApp();
    await screen.findByText("Intra in cont");
    await apasa("Am un cod de la administrator");
    await scrie("Codul primit", "abc12");
    expect(screen.getByLabelText("Codul primit").value).toBe("ABC12");
    await scrie("Numele tau", "Ion");
    await scrie("Email", "ion@bloc.ro");
    await scrie("Alege o parola", "ParolaBuna1");
    expect(dezactivat("Creeaza contul")).toBe(true);
    await scrie("Codul primit", "abc123");
    expect(dezactivat("Creeaza contul")).toBe(false);
    await scrie("Alege o parola", "12345");
    expect(dezactivat("Creeaza contul")).toBe(true);
    await scrie("Alege o parola", "123456");
    await scrie("Numele tau", "  ");
    expect(dezactivat("Creeaza contul")).toBe(true);
    await scrie("Numele tau", "Ion");
    await scrie("Email", "ion@bloc");
    expect(dezactivat("Creeaza contul")).toBe(true);
  });

  it("cu un cod bun contul se leaga de apartament si intra direct in aplicatie", async () => {
    const { s, cod } = await sursaCuCod();
    const inregistreaza = vi.spyOn(s, "inregistreaza");
    await pornesteApp({ sursa: s });
    await screen.findByText("Intra in cont");
    await completeaza(cod.toLowerCase());
    await apasa("Creeaza contul");
    await screen.findByText("Iesi");
    expect(inregistreaza).toHaveBeenCalledWith({ email: "vecin.nou@bloc.ro", parola: "ParolaBuna1", nume: "Ion Vecinu", telefon: "0722 000 111" });
    expect(toast().textContent).toBe("Contul a fost legat de apartamentul 5");
    expect(screen.getByText("Apartament 5, Bloc D14, scara A")).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent.replace(/\d+$/, ""))).toEqual(["Acasa", "Plata", "Contoare", "Sesizari", "Bloc"]);
  });

  it("emailul folosit deja: nu se creeaza contul si codul nu se consuma", async () => {
    const { s, cod } = await sursaCuCod();
    const foloseste = vi.spyOn(s, "folosesteInvitatie");
    await pornesteApp({ sursa: s });
    await screen.findByText("Intra in cont");
    await completeaza(cod, LOCATAR);
    await apasa("Creeaza contul");
    expect(toast().textContent).toBe("Exista deja un cont cu acest email.");
    expect(foloseste).not.toHaveBeenCalled();
    expect(buton("Creeaza contul")).toBeTruthy();
  });

  it("cu un cod gresit contul exista, dar ramane fara apartament", async () => {
    await pornesteApp();
    await screen.findByText("Intra in cont");
    await completeaza("ZZZZZZZZ");
    await apasa("Creeaza contul");
    await screen.findByText("Leaga contul de apartamentul tau");
    expect(toast().textContent).toBe("Codul nu este valabil. Cere administratorului un cod nou.");
    expect(screen.getByText("Buna, Ion")).toBeTruthy();
    expect(screen.getByText("vecin.nou@bloc.ro")).toBeTruthy();
  });
});

describe("EcranAutentificare, cerere de administrator", () => {
  const imagineOriginala = window.Image;
  afterEach(() => {
    vi.unstubAllGlobals();
    window.Image = imagineOriginala;
  });

  /* Imagine si canvas simulate: jsdom nu decodeaza poze */
  function simuleazaPoze({ latime = 3200, inaltime = 2400, eroare = false, faraBlob = false } = {}) {
    const desen = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ drawImage: desen }));
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb, tip, calitate) {
      cb(faraBlob ? null : new Blob(["jpg"], { type: tip }), calitate);
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:poza");
    const revoca = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    class ImagineFalsa {
      set src(v) {
        this.width = latime;
        this.height = inaltime;
        this._src = v;
        setTimeout(() => (eroare ? this.onerror() : this.onload()), 0);
      }
    }
    vi.stubGlobal("Image", ImagineFalsa);
    window.Image = ImagineFalsa;
    return { desen, toBlob, revoca };
  }

  async function formular(s) {
    await pornesteApp({ sursa: s });
    await screen.findByText("Intra in cont");
    await apasa("Sunt administrator si vreau cont");
    await scrie("Numele tau", "Dana Pop");
    await scrie("Telefon", "");
    await scrie("Email", "dana@admin.ro");
    await scrie("Alege o parola", "ParolaBuna1");
  }

  async function ataseaza(fisier) {
    const input = screen.getAllByLabelText(/Fotografiaza atestatul|Alta poza/).find((x) => x.tagName === "INPUT");
    await act(async () => { fireEvent.change(input, { target: { files: fisier ? [fisier] : [] } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    return input;
  }

  it("atestatul este obligatoriu; poza se micsoreaza la 1600 px si devine JPEG", async () => {
    const { desen, toBlob, revoca } = simuleazaPoze();
    const s = sursaDemo();
    const cerere = vi.spyOn(s, "cereVerificareAdministrator");
    await formular(s);
    expect(dezactivat("Trimite cererea")).toBe(true);
    await scrie("Numarul atestatului", " AT-AG-2026-1 ");
    expect(dezactivat("Trimite cererea")).toBe(false);

    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    await apasa("Fotografiaza atestatul");
    expect(click).toHaveBeenCalled();

    await ataseaza(new File(["x"], "atestat.png", { type: "image/png" }));
    expect(screen.getByText("Poza atasata")).toBeTruthy();
    expect(buton("Alta poza")).toBeTruthy();
    expect(desen).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.82);
    expect(revoca).toHaveBeenCalledWith("blob:poza");

    await apasa("Trimite cererea");
    await screen.findByText("Contul de administrator asteapta verificarea");
    const { numarAtestat, fisier } = cerere.mock.calls[0][0];
    expect(numarAtestat).toBe("AT-AG-2026-1");
    expect(fisier.name).toBe("atestat.jpg");
    expect(fisier.type).toBe("image/jpeg");
    expect(toast().textContent).toBe("Cererea a fost trimisa spre verificare");
    expect(screen.getByText("In verificare")).toBeTruthy();
  });

  it("o poza mica nu se mareste, iar una fara nume primeste numele poza.jpg", async () => {
    const { desen } = simuleazaPoze({ latime: 800, inaltime: 600 });
    const s = sursaDemo();
    const cerere = vi.spyOn(s, "cereVerificareAdministrator");
    await formular(s);
    await scrie("Numarul atestatului", "AT-1");
    const f = new File(["x"], "", { type: "image/jpeg" });
    await ataseaza(f);
    expect(desen).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600);
    await apasa("Trimite cererea");
    await screen.findByText("Contul de administrator asteapta verificarea");
    expect(cerere.mock.calls[0][0].fisier.name).toBe("poza.jpg");
  });

  it("un PDF, o poza care nu se decodeaza sau fara canvas raman neschimbate", async () => {
    const s = sursaDemo();
    const cerere = vi.spyOn(s, "cereVerificareAdministrator").mockResolvedValue(undefined);
    simuleazaPoze({ eroare: true });
    await formular(s);
    await scrie("Numarul atestatului", "AT-1");

    const pdf = new File(["%PDF"], "atestat.pdf", { type: "application/pdf" });
    await ataseaza(pdf);
    expect(screen.getByText("Poza atasata")).toBeTruthy();

    const heic = new File(["x"], "atestat.heic", { type: "image/heic" });
    await ataseaza(heic);

    /* niciun fisier ales: nu se schimba nimic */
    await ataseaza(null);

    await apasa("Trimite cererea");
    await waitFor(() => expect(cerere).toHaveBeenCalled());
    expect(cerere.mock.calls[0][0].fisier).toBe(heic);
  });

  it("canvas fara blob si fisier fara tip: se trimite originalul", async () => {
    const s = sursaDemo();
    const cerere = vi.spyOn(s, "cereVerificareAdministrator").mockResolvedValue(undefined);
    simuleazaPoze({ faraBlob: true });
    await formular(s);
    await scrie("Numarul atestatului", "AT-1");
    const faraTip = new File(["x"], "atestat");
    await ataseaza(faraTip);
    const png = new File(["x"], "atestat.png", { type: "image/png" });
    await ataseaza(png);
    await apasa("Trimite cererea");
    await waitFor(() => expect(cerere).toHaveBeenCalled());
    expect(cerere.mock.calls[0][0].fisier).toBe(png);
  });

  it("cererea fara poza; daca inregistrarea cade, cererea nu mai pleaca", async () => {
    const s = sursaDemo();
    const cerere = vi.spyOn(s, "cereVerificareAdministrator");
    await pornesteApp({ sursa: s });
    await screen.findByText("Intra in cont");
    await apasa("Sunt administrator si vreau cont");
    await scrie("Numele tau", "Dana Pop");
    await scrie("Email", ADMIN);
    await scrie("Alege o parola", "ParolaBuna1");
    await scrie("Numarul atestatului", "AT-1");
    await apasa("Trimite cererea");
    expect(toast().textContent).toBe("Exista deja un cont cu acest email.");
    expect(cerere).not.toHaveBeenCalled();
    expect(buton("Trimite cererea")).toBeTruthy();

    await scrie("Email", "dana@admin.ro");
    await apasa("Trimite cererea");
    await screen.findByText("Contul de administrator asteapta verificarea");
    expect(cerere.mock.calls[0][0]).toEqual({ numarAtestat: "AT-1", fisier: null });
  });
});

describe("EcranFaraAcces", () => {
  it("administrator neverificat: asteapta si poate iesi", async () => {
    const s = sursaDemo();
    await s.intra("admin.nou@adminbloc.test", PAROLA);
    await pornesteApp({ sursa: s });
    await screen.findByText("Contul de administrator asteapta verificarea");
    expect(screen.getByText("Buna, Cosmin")).toBeTruthy();
    expect(screen.getByText("admin.nou@adminbloc.test")).toBeTruthy();
    expect(screen.queryByText("Leaga contul de apartamentul tau")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    await apasa("Iesi din cont");
    await screen.findByText("Intra in cont");
  });

  /* [J4] Backend-ul lasa acum pe un administrator respins sa retrimita
     cererea (numar de atestat corectat), dar ecranul ii arata doar "scrie-ne
     la suport", fara niciun formular: omul nu are nicio cale inainte. */
  it("[J4] cerere respinsa: poate retrimite cererea corectata, nu doar sa scrie la suport", async () => {
    const s = sursaDemo((d) => { d.eu.rol = "respins"; d.eu.email = null; });
    await s.intra("admin.nou@adminbloc.test", PAROLA);
    const cerere = vi.spyOn(s, "cereVerificareAdministrator").mockResolvedValue(undefined);
    await pornesteApp({ sursa: s });
    await screen.findByText("Cererea de administrator a fost respinsa");
    expect(screen.getByText("Respins")).toBeTruthy();
    /* [K19] "scrie-ne la suport" contrazicea formularul de retrimitere de
       mai jos: mesajul spune acum acelasi lucru ca formularul. */
    expect(screen.getByText("Poti retrimite cererea mai jos, cu atestatul corectat.")).toBeTruthy();
    expect(screen.queryByText(/scrie-ne la/)).toBeNull();
    expect(screen.queryByText("Contul de administrator asteapta verificarea")).toBeNull();

    expect(screen.getByText("Esti administrator de bloc?")).toBeTruthy();
    /* nu si formularul de invitatie: acela e pentru un locatar fara apartament */
    expect(screen.queryByText("Leaga contul de apartamentul tau")).toBeNull();
    await scrie("Numarul atestatului", "AT-77 corectat");
    await apasa("Trimite cererea de administrator");
    expect(cerere).toHaveBeenCalledWith({ numarAtestat: "AT-77 corectat", fisier: null });
  });

  /* [K19] motiv_respingere este exact ce omul are nevoie sa vada, ca sa
     stie ce sa corecteze inainte sa retrimita cererea; ecranul nu-l arata
     deloc, desi exista in registru. */
  it("[K19] cerere respinsa cu motiv: motivul se vede pe ecran", async () => {
    const s = sursaDemo((d) => { d.eu.rol = "respins"; d.eu.email = null; d.eu.motivRespingere = "Atestatul din poza nu se poate citi."; });
    await s.intra("admin.nou@adminbloc.test", PAROLA);
    await pornesteApp({ sursa: s });
    await screen.findByText("Cererea de administrator a fost respinsa");
    expect(screen.getByText("Atestatul din poza nu se poate citi.")).toBeTruthy();
    expect(screen.getByText("Poti retrimite cererea mai jos, cu atestatul corectat.")).toBeTruthy();
  });

  it("[K19] cerere respinsa fara motiv salvat: nu arata un rand gol", async () => {
    const s = sursaDemo((d) => { d.eu.rol = "respins"; d.eu.email = null; d.eu.motivRespingere = null; });
    await s.intra("admin.nou@adminbloc.test", PAROLA);
    await pornesteApp({ sursa: s });
    await screen.findByText("Cererea de administrator a fost respinsa");
    expect(screen.getByText("Poti retrimite cererea mai jos, cu atestatul corectat.")).toBeTruthy();
  });

  it("cont fara apartament: codul se scrie cu majuscule si leaga contul", async () => {
    const { s, cod } = await sursaCuCod();
    await s.inregistreaza({ email: "fara@ap.ro", parola: "ParolaBuna1", nume: "Vlad", telefon: "" });
    await pornesteApp({ sursa: s });
    await screen.findByText("Leaga contul de apartamentul tau");
    expect(screen.getByText("Buna, Vlad")).toBeTruthy();
    await scrie("Codul primit", "abc");
    expect(screen.getByLabelText("Codul primit").value).toBe("ABC");
    expect(dezactivat("Foloseste codul")).toBe(true);
    await scrie("Codul primit", "zzzzzzzz");
    await apasa("Foloseste codul");
    expect(toast().textContent).toBe("Codul nu este valabil. Cere administratorului un cod nou.");
    expect(screen.getByText("Leaga contul de apartamentul tau")).toBeTruthy();
    await scrie("Codul primit", ` ${cod.toLowerCase()} `);
    await apasa("Foloseste codul");
    await screen.findByText("Iesi");
    expect(toast().textContent).toBe("Contul a fost legat de apartamentul 5");
    expect(screen.getByText("Apartament 5, Bloc D14, scara A")).toBeTruthy();
  });
});
