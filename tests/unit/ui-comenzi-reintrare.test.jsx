/* [F1] Dublul apasat: nicio comanda nu porneste de doua ori.
   Protectia sta in cmd() (sectiunea 11), deci niciun ecran nu o poate ocoli. */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, ADMIN, LOCATAR } from "./ajutor.jsx";
import { apasa, scrie, tab, toast, asteapta, contextApp } from "./ui-baza-ajutor.jsx";

/* O promisiune pe care testul o rezolva cand vrea, ca sa tina comanda in aer */
function amanat() {
  let rezolva;
  const promisiune = new Promise((r) => { rezolva = r; });
  return { promisiune, rezolva: (v) => rezolva(v) };
}

/* Apasa de doua ori la rand, inainte ca prima comanda sa apuce sa raspunda */
async function apasaDeDouaOri(nume) {
  const b = screen.getAllByRole("button").find((x) => x.textContent === nume || x.getAttribute("aria-label") === nume);
  if (!b) throw new Error(`Butonul "${nume}" nu exista`);
  await act(async () => {
    fireEvent.click(b);
    fireEvent.click(b);
  });
}

/* Porneste aplicatia, opreste o metoda a sursei in aer si intoarce spionul */
async function cuComandaBlocata(email, metoda, valoare) {
  const { sursa, ...rest } = await pornesteApp({ email });
  const aman = amanat();
  const spion = vi.spyOn(sursa, metoda).mockImplementation(() => aman.promisiune);
  return { sursa, spion, termina: async () => { await act(async () => { aman.rezolva(valoare); }); }, ...rest };
}

describe("[F1] o comanda in curs nu se porneste a doua oara", () => {
  it("publicarea listei de plata", async () => {
    const { spion, termina } = await cuComandaBlocata(ADMIN, "publicaLista");
    await tab("Facturi");
    await apasa("Publica lista");
    await apasaDeDouaOri("Da, publica lista");
    expect(spion).toHaveBeenCalledTimes(1);
    await termina();
  });

  it("publicarea unui anunt", async () => {
    const { spion, termina } = await cuComandaBlocata(ADMIN, "publicaAnunt");
    await tab("Comunicare");
    await apasa("Scrie un anunt");
    await scrie("Titlu", "Curatenie generala");
    await scrie("Continut", "Sambata la ora 10");
    await apasaDeDouaOri("Publica anuntul");
    expect(spion).toHaveBeenCalledTimes(1);
    await termina();
  });

  it("generarea codului de invitatie", async () => {
    const { spion, termina } = await cuComandaBlocata(ADMIN, "invitaLocatar", "ABCD2345");
    await tab("Apartamente");
    await apasa("Apartament 17");
    await apasa("Invita un locatar in aplicatie");
    await apasaDeDouaOri("Genereaza codul");
    expect(spion).toHaveBeenCalledTimes(1);
    await termina();
  });

  it("deschiderea unui vot", async () => {
    const { spion, termina } = await cuComandaBlocata(ADMIN, "deschideVot");
    await tab("Comunicare");
    await apasa("Vot si AG");
    await apasa("Deschide un vot nou");
    await scrie("Ce se voteaza", "Schimbam usa");
    await scrie("Varianta 1", "Da");
    await scrie("Varianta 2", "Nu");
    await scrie("Votul se inchide pe", "2026-10-30");
    await apasaDeDouaOri("Deschide votul");
    expect(spion).toHaveBeenCalledTimes(1);
    await termina();
  });

  it("convocarea adunarii generale", async () => {
    const { spion, termina } = await cuComandaBlocata(ADMIN, "convoacaAdunare", { destinatari: 3 });
    await tab("Comunicare");
    await apasa("Vot si AG");
    await apasa("Convoaca adunarea");
    await scrie("Data", "2026-10-30");
    await scrie("Locul", "La parter");
    await scrie("Ordinea de zi", "Bugetul pe 2027");
    await apasaDeDouaOri("Trimite convocarea");
    expect(spion).toHaveBeenCalledTimes(1);
    await termina();
  });

  it("incarcarea unui document", async () => {
    const { spion, termina } = await cuComandaBlocata(ADMIN, "incarcaDocument");
    await tab("Comunicare");
    await apasa("Acte");
    await apasa("Incarca un document");
    await scrie("Titlu", "Proces verbal");
    const fisier = screen.getAllByLabelText("Alege fisierul").find((x) => x.tagName === "INPUT");
    await act(async () => { fireEvent.change(fisier, { target: { files: [new File(["x"], "pv.pdf", { type: "" })] } }); });
    await apasaDeDouaOri("Incarca documentul");
    expect(spion).toHaveBeenCalledTimes(1);
    await termina();
  });

  it("trimiterea indexului de la contoare", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:contor");
    const { spion, termina } = await cuComandaBlocata(LOCATAR, "transmiteCitire");
    await tab("Contoare");
    await scrie("Apa rece, index anterior 244,5", "250");
    await scrie("Apa calda, index anterior 133,7", "140");
    const poza = screen.getAllByLabelText("Fotografiaza contoarele").find((x) => x.tagName === "INPUT");
    await act(async () => { fireEvent.change(poza, { target: { files: [new File(["x"], "c.jpg", { type: "" })] } }); });
    await apasaDeDouaOri("Trimite indexul");
    expect(spion).toHaveBeenCalledTimes(1);
    await termina();
  });

  it("adaugarea unei sesizari", async () => {
    const { spion, termina } = await cuComandaBlocata(LOCATAR, "adaugaSesizare");
    await tab("Sesizari");
    await apasa("Sesizare noua");
    await apasa("Bec ars pe scara");
    await apasaDeDouaOri("Trimite sesizarea");
    expect(spion).toHaveBeenCalledTimes(1);
    await termina();
  });

  /* [C10] paza de reintrare cheia doar dupa numele comenzii: "Instiintare"
     pe apartamentul 3 tinea blocata si "Instiintare" pe apartamentul 5,
     apasat imediat dupa, in aceeasi secunda. */
  it("[C10] Instiintare pe un apartament nu blocheaza Instiintare pe alt apartament", async () => {
    const { sursa } = await pornesteApp({ email: ADMIN });
    const apeluri = [];
    const rezolva = [];
    vi.spyOn(sursa, "trimiteInstiintare").mockImplementation((ap) => {
      apeluri.push(ap);
      return new Promise((r) => rezolva.push(r));
    });
    const butoane = screen.getAllByRole("button").filter((b) => b.textContent === "Instiintare");
    expect(butoane.length).toBeGreaterThan(1);
    await act(async () => {
      fireEvent.click(butoane[0]);
      fireEvent.click(butoane[1]);
    });
    expect(apeluri).toHaveLength(2);
    expect(apeluri[0]).not.toBe(apeluri[1]);
    await act(async () => { rezolva.forEach((r) => r({})); });
  });

  /* [E6] cand paza chiar blocheaza a doua apasare (aceeasi comanda, aceleasi
     argumente), omul trebuie sa afle de ce nu s-a intamplat nimic. */
  it("[E6] o comanda blocata anunta omul, nu tace", async () => {
    const { spion, termina } = await cuComandaBlocata(ADMIN, "publicaAnunt");
    await tab("Comunicare");
    await apasa("Scrie un anunt");
    await scrie("Titlu", "Curatenie generala");
    await scrie("Continut", "Sambata la ora 10");
    await apasaDeDouaOri("Publica anuntul");
    expect(spion).toHaveBeenCalledTimes(1);
    expect(toast()).toBeTruthy();
    expect(toast().textContent).not.toBe("");
    await termina();
  });

  it("dupa ce comanda se termina, aceeasi comanda se poate relua", async () => {
    const { sursa } = await pornesteApp({ email: ADMIN });
    const spion = vi.spyOn(sursa, "publicaAnunt");
    await tab("Comunicare");
    await apasa("Scrie un anunt");
    await scrie("Titlu", "Primul anunt");
    await scrie("Continut", "Text");
    await apasa("Publica anuntul");
    await apasa("Scrie un anunt");
    await scrie("Titlu", "Al doilea anunt");
    await scrie("Continut", "Text");
    await apasa("Publica anuntul");
    expect(spion).toHaveBeenCalledTimes(2);
  });

  /* [G10, K1] marcheazaAnunturiCitite este o comanda de fundal (LocatarBloc,
     useEffect, marcheaza tot lotul de anunturi necitite intr-un singur
     apel). O reintrare cu aceleasi argumente, cat timp prima e inca in
     curs, e fireasca (nu o apasare dubla a omului) si nu are voie sa arate
     avertismentul de reintrare. */
  it("[G10] o comanda de fundal repetata cu aceleasi argumente nu declanseaza avertismentul de reintrare", async () => {
    const { sursa, container } = await pornesteApp({ email: LOCATAR });
    const ctx = () => contextApp(container);
    const necitit = (await sursa.incarca()).anunturi.find((a) => !a.citit);
    const hang = amanat();
    const spion = vi.spyOn(sursa, "marcheazaAnuntCitit").mockReturnValue(hang.promisiune);

    await act(async () => {
      ctx().marcheazaAnunturiCitite([necitit.id]);
      ctx().marcheazaAnunturiCitite([necitit.id]);
    });
    expect(spion).toHaveBeenCalledTimes(1);
    await asteapta();

    expect(toast()).toBeNull();
  });

  /* [G14] Cheia de reintrare e construita cu JSON.stringify(args), care scrie
     un File ca {}: doua iesiri de fond diferite, cu aceeasi suma, descriere
     si data dar cu fisiere diferite (doua poze de chitanta), primesc aceeasi
     cheie si se blocheaza reciproc, desi sunt doua documente diferite. */
  it("[G14] doua comenzi cu acelasi text dar fisiere diferite nu se blocheaza reciproc", async () => {
    const { sursa, container } = await pornesteApp({ email: ADMIN });
    const ctx = () => contextApp(container);
    const aman = amanat();
    const spion = vi.spyOn(sursa, "inregistreazaIesireFond").mockImplementation(() => aman.promisiune);
    const comune = { fondId: "fond-1", suma: -100, descriere: "Reparatie", data: "2026-09-19" };
    const fisier1 = new File(["a"], "a.jpg", { type: "image/jpeg" });
    const fisier2 = new File(["b"], "b.jpg", { type: "image/jpeg" });

    await act(async () => {
      ctx().inregistreazaIesireFond({ ...comune, fisier: fisier1 });
      ctx().inregistreazaIesireFond({ ...comune, fisier: fisier2 });
    });

    expect(spion).toHaveBeenCalledTimes(2);
    await act(async () => { aman.rezolva({}); });
  });
});
