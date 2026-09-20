/* Contul nou dupa intarirea setarilor de autentificare din backend:
   parola de cel putin 10 caractere, confirmarea adresei de email inainte de
   pasul 2 [S4] si iesirea curata cand prima incarcare cade [S3]. */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, sursaDemo, PAROLA, LOCATAR } from "./ajutor.jsx";
import { apasa, scrie, toast } from "./ui-baza-ajutor.jsx";

const buton = (nume) => screen.getAllByRole("button").find((b) => b.textContent === nume);
const dezactivat = (nume) => buton(nume).getAttribute("aria-disabled") === "true";

async function formularAdministrator() {
  const r = await pornesteApp({});
  await screen.findByText("Intra in cont");
  await apasa("Sunt administrator si vreau cont");
  return r;
}

describe("parola ceruta de backend", () => {
  it("cere zece caractere, cu litere mari, litere mici si cifre", async () => {
    await formularAdministrator();
    expect(screen.getByLabelText("Alege o parola").getAttribute("placeholder"))
      .toBe("Cel putin 10 caractere, cu litere mari, litere mici si cifre");

    await scrie("Numele tau", "Dana Pop");
    await scrie("Email", "dana@admin.ro");
    await scrie("Numarul atestatului", "AT-1");

    for (const slaba of ["Scurta1", "parolaslaba1", "PAROLASLABA1", "ParolaSlaba"]) {
      await scrie("Alege o parola", slaba);
      expect(dezactivat("Trimite cererea")).toBe(true);
    }
    expect(screen.getByText("Parola are nevoie de cel putin 10 caractere, o litera mare, o litera mica si o cifra.")).toBeTruthy();

    await scrie("Alege o parola", "ParolaBuna1");
    expect(dezactivat("Trimite cererea")).toBe(false);
  });

  it("acelasi text si pe formularul locatarului", async () => {
    await pornesteApp({});
    await screen.findByText("Intra in cont");
    await apasa("Am un cod de la administrator");
    expect(screen.getByLabelText("Alege o parola").getAttribute("placeholder"))
      .toBe("Cel putin 10 caractere, cu litere mari, litere mici si cifre");
    await scrie("Codul primit", "ABCD2345");
    await scrie("Numele tau", "Dana Pop");
    await scrie("Email", "dana@locatar.ro");
    await scrie("Alege o parola", "scurta1A");
    expect(dezactivat("Creeaza contul")).toBe(true);
  });
});

describe("[S4] confirmarea adresei de email inainte de pasul 2", () => {
  /* [E1] Cand backend-ul cere confirmarea emailului, inregistrarea nu mai
     deschide o sesiune: inregistreaza() rezolva la null (nu arunca), fara sa
     schimbe nimic in sursa. Testele foloseau inainte un dublu mock cu un
     contract inventat (inregistreaza() rezolvat la `undefined`, plus
     sesiuneCurenta() suprascris separat) pe care nicio sursa reala nu il are.
     sursa-mock.js reproduce exact raspunsul surselor reale (null, fara
     sesiune) pentru orice adresa cu eticheta "+cere-confirmare", asa ca
     testele folosesc acum sursa nealterata, ca la o inregistrare adevarata. */
  it("[E1] administratorul vede ce are de facut, nu o eroare tehnica, si numarul atestatului ramane vizibil", async () => {
    const s = sursaDemo();
    const cerere = vi.spyOn(s, "cereVerificareAdministrator");
    await pornesteApp({ sursa: s });
    await screen.findByText("Intra in cont");
    await apasa("Sunt administrator si vreau cont");
    await scrie("Numele tau", "Dana Pop");
    await scrie("Email", "dana+cere-confirmare@admin.ro");
    await scrie("Alege o parola", "ParolaBuna1");
    await scrie("Numarul atestatului", "AT-1");
    await apasa("Trimite cererea");

    expect(screen.getByText("Confirma adresa de email")).toBeTruthy();
    expect(screen.getByText(/dana\+cere-confirmare@admin\.ro/)).toBeTruthy();
    expect(screen.getByText(/AT-1/)).toBeTruthy();
    expect(cerere).not.toHaveBeenCalled();
    expect(toast()).toBeNull();
  });

  it("[E1] locatarul vede acelasi ecran, iar codul ramane vizibil si de folosit dupa confirmare", async () => {
    const s = sursaDemo();
    const foloseste = vi.spyOn(s, "folosesteInvitatie");
    await pornesteApp({ sursa: s });
    await screen.findByText("Intra in cont");
    await apasa("Am un cod de la administrator");
    await scrie("Codul primit", "ABCD2345");
    await scrie("Numele tau", "Dana Pop");
    await scrie("Email", "dana+cere-confirmare@locatar.ro");
    await scrie("Alege o parola", "ParolaBuna1");
    await apasa("Creeaza contul");

    expect(screen.getByText("Confirma adresa de email")).toBeTruthy();
    expect(screen.getByText(/ABCD2345/)).toBeTruthy();
    expect(foloseste).not.toHaveBeenCalled();

    await apasa("Am confirmat, intru in cont");
    expect(screen.getByText("Intra in cont")).toBeTruthy();
  });

  it("dupa confirmare, cererea de administrator se poate trimite din ecranul de asteptare", async () => {
    const s = sursaDemo((d) => {
      d.eu.rol = "fara_apartament";
      d.eu.nume = "Dana Pop";
      d.eu.email = "dana@admin.ro";
    });
    await s.intra(LOCATAR, PAROLA);
    const cerere = vi.spyOn(s, "cereVerificareAdministrator").mockResolvedValue(undefined);
    await pornesteApp({ sursa: s });
    await screen.findByText("Iesi din cont");

    expect(screen.getByLabelText("Codul primit")).toBeTruthy();
    await scrie("Numarul atestatului", "AT-77");
    await apasa("Trimite cererea de administrator");
    expect(cerere).toHaveBeenCalledWith({ numarAtestat: "AT-77", fisier: null });

    /* cu poza atestatului atasata */
    const poza = new File(["x"], "atestat.jpg", { type: "" });
    const input = screen.getAllByLabelText("Fotografiaza atestatul").find((x) => x.tagName === "INPUT");
    await act(async () => { fireEvent.change(input, { target: { files: [poza] } }); });
    expect(screen.getByText("Poza atasata")).toBeTruthy();
    await apasa("Trimite cererea de administrator");
    expect(cerere).toHaveBeenLastCalledWith({ numarAtestat: "AT-77", fisier: poza });
  });
});

describe("[S3] cand prima incarcare cade, omul nu ramane blocat", () => {
  it("poate reincerca sau iesi din cont", async () => {
    const s = sursaDemo();
    await s.intra(LOCATAR, PAROLA);
    let cade = true;
    const incarca = s.incarca.bind(s);
    s.incarca = () => (cade ? Promise.reject(new Error("Sesiunea a expirat.")) : incarca());
    await pornesteApp({ sursa: s });
    await act(async () => {});

    expect(screen.queryByText("Se incarca...")).toBeNull();
    expect(screen.getAllByText("Sesiunea a expirat.").length).toBeGreaterThan(0);
    cade = false;
    await apasa("Incearca din nou");
    expect(screen.getByText("De facut")).toBeTruthy();
  });

  it("iesirea din cont duce la ecranul de intrare", async () => {
    const s = sursaDemo();
    await s.intra(LOCATAR, PAROLA);
    s.incarca = () => Promise.reject(new Error("Sesiunea a expirat."));
    await pornesteApp({ sursa: s });
    await act(async () => {});
    await apasa("Iesi din cont");
    expect(await screen.findByText("Intra in cont")).toBeTruthy();
  });
});
