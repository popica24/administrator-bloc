/* Ecranul Sesizari al locatarului (LocatarSesizari): ale mele si din tot
   blocul, conversatia cu administratia si formularul de sesizare noua. */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { pornesteApp, zonaCu, butonul } from "./ajutor.jsx";
import {
  ELENA, ILIE, apasa, apasaButon, alegeSegment, deschideTab, scrie, alegeFisier, fisierPoza, urlFalse, amanat, text,
} from "./ui-locatar-ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const MESAJ = "Adaugă un mesaj pentru administrator";
/* Cardul unei sesizari, dupa titlu (primul text cu acel continut; descrierea poate fi identica) */
const card = (titlu) => {
  /* cardul sesizarii: urca de la titlu pana la blocul care are si starea, si
     descrierea de sub ea (doua randuri distincte, nu doar antetul) */
  let el = zonaCu([titlu, /Nouă|În lucru|Rezolvată|suspendata/], 4);
  while (el.parentElement && el.childElementCount < 2) el = el.parentElement;
  return el.parentElement;
};
const foaie = () => screen.getByRole("dialog", { name: "Sesizare nouă" });

async function laSesizari(optiuni) {
  urlFalse();
  const r = await pornesteApp(optiuni);
  await deschideTab("Sesizări");
  return r;
}

describe("Sesizări: listele", () => {
  it("Ale mele: starea, categoria, pozele si conversatia", async () => {
    await laSesizari({ email: ELENA });
    expect(screen.getByText("Bloc D14, scara A")).toBeTruthy();
    const deschisa = card("Bec ars pe palier la etajul 4");
    expect(within(deschisa).getByText("În lucru")).toBeTruthy();
    expect(text(deschisa)).toContain("Iluminat și electrice · 9 sep 2026");
    expect(text(deschisa)).not.toContain("a ta");
    expect(text(deschisa)).toContain("Becul de langa ap. 17 nu mai porneste de doua zile.");
    expect(within(deschisa).getByText("POZA")).toBeTruthy();
    expect(text(deschisa)).toContain("Răspuns administrator · 9 sep 2026Am cumparat becul, se monteaza joi.");
    expect(within(deschisa).getByLabelText(MESAJ)).toBeTruthy();

    const rezolvata = card("Interfon defect");
    expect(within(rezolvata).getByText("Rezolvată")).toBeTruthy();
    expect(within(rezolvata).queryByLabelText(MESAJ)).toBeNull();
    /* sesizarile altora nu apar la Ale mele */
    expect(screen.queryByText("Scurgere la coloana de la subsol")).toBeNull();
  });

  it("Din tot blocul: sesizarile deschise ale altora, cele proprii marcate, fara cele rezolvate demult ale altora", async () => {
    await laSesizari({
      email: ELENA,
      modifica: (d) => {
        /* rezolvata acum peste 30 de zile fata de ZI_DEMO (19 sep 2026) */
        d.sesizari.find((s) => s.titlu === "Gunoi depozitat pe casa scarii").rezolvataLa = "2026-06-01T10:00:00+03:00";
      },
    });
    await alegeSegment("Din tot blocul");
    expect(screen.getByText("Vezi ce s-a semnalat deja, ca să nu scrii de două ori despre același lucru. Nu se vede cine a trimis sesizarea.")).toBeTruthy();
    const noua = card("Scurgere la coloana de la subsol");
    expect(within(noua).getByText("Nouă")).toBeTruthy();
    expect(text(noua)).toContain("Instalații, apă, canalizare · 15 sep 2026");
    expect(within(noua).queryByLabelText(MESAJ)).toBeNull();
    expect(text(card("Bec ars pe palier la etajul 4"))).toContain(" · a ta");
    expect(screen.getByText("Interfon defect")).toBeTruthy();
    expect(screen.queryByText("Gunoi depozitat pe casa scarii")).toBeNull();
  });

  it("[K14] Din tot blocul arata si sesizarile rezolvate in ultimele 30 de zile", async () => {
    await laSesizari({ email: ELENA });
    await alegeSegment("Din tot blocul");
    expect(screen.getByText("Gunoi depozitat pe casa scarii")).toBeTruthy();
  });

  it("fara sesizari proprii: ecran gol cu buton care deschide formularul", async () => {
    await laSesizari({ email: ILIE });
    expect(screen.getByText("Nu ai trimis nicio sesizare")).toBeTruthy();
    await apasaButon("Scrie o sesizare");
    expect(foaie()).toBeTruthy();
  });

  it("niciuna deschisa in bloc, si nimic rezolvat recent", async () => {
    await laSesizari({
      email: ILIE,
      modifica: (d) => {
        d.sesizari = d.sesizari.filter((s) => s.stare === "rezolvata");
        d.sesizari.forEach((s) => { s.rezolvataLa = "2026-06-01T10:00:00+03:00"; });
      },
    });
    await alegeSegment("Din tot blocul");
    expect(screen.getByText("Nicio sesizare deschisă în bloc")).toBeTruthy();
  });

  it("un mesaj al locatarului apare ca Mesajul tau", async () => {
    await laSesizari({
      email: ELENA,
      modifica: (d) => {
        d.sesizari.find((s) => s.titlu === "Bec ars pe palier la etajul 4").mesaje.push({ id: "m-loc", text: "Tot nu merge", la: "2026-09-12T10:00:00+03:00", dinAdministratie: false });
      },
    });
    expect(text(card("Bec ars pe palier la etajul 4"))).toContain("Mesajul tău · 12 sep 2026Tot nu merge");
  });
});

describe("Sesizari: mesaj catre administrator", () => {
  it("Trimite este inactiv pe camp gol; mesajul trimis goleste campul", async () => {
    const { sursa } = await laSesizari({ email: ELENA });
    const spion = vi.spyOn(sursa, "scrieMesaj");
    const c = card("Bec ars pe palier la etajul 4");
    const trimite = within(c).getByRole("button", { name: "Trimite" });
    expect(trimite.getAttribute("aria-disabled")).toBe("true");
    scrie(MESAJ, "   ");
    expect(trimite.getAttribute("aria-disabled")).toBe("true");
    scrie(MESAJ, "Multumesc, astept");
    await apasa(within(c).getByRole("button", { name: "Trimite" }));
    const d = await sursa.incarca();
    const ses = d.sesizari.find((s) => s.titlu === "Bec ars pe palier la etajul 4");
    expect(spion).toHaveBeenCalledWith(ses.id, "Multumesc, astept");
    expect(screen.getByRole("status").textContent).toBe("Mesajul a fost trimis");
    expect(screen.getByLabelText(MESAJ).value).toBe("");
    expect(text(card("Bec ars pe palier la etajul 4"))).toContain("Mesajul tău · 19 sep 2026Multumesc, astept");
  });

  /* Acelasi defect ca la contorul general: la finalul trimiterii se punea
     inapoi starea tuturor campurilor din clipa apasarii, deci ce scria omul
     intre timp la alta sesizare disparea. */
  it("mesajul scris la alta sesizare in timpul unei trimiteri ramane scris", async () => {
    const { sursa } = await laSesizari({
      email: ELENA,
      modifica: (d) => {
        const s = d.sesizari.find((x) => x.titlu === "Bec ars pe palier la etajul 4");
        d.sesizari.push({ ...s, id: "ses-a-doua", titlu: "Ușa de la intrare nu se închide", mesaje: [] });
      },
    });
    const real = sursa.scrieMesaj.bind(sursa);
    let elibereaza;
    vi.spyOn(sursa, "scrieMesaj").mockImplementation((...a) => new Promise((r) => { elibereaza = () => r(real(...a)); }));
    const unu = card("Bec ars pe palier la etajul 4");
    const doi = card("Ușa de la intrare nu se închide");
    await act(async () => { fireEvent.change(within(unu).getByLabelText(MESAJ), { target: { value: "Multumesc" } }); });
    await apasa(within(unu).getByRole("button", { name: "Trimite" }));
    /* Trimiterea inca merge; omul scrie la cealalta sesizare */
    await act(async () => { fireEvent.change(within(doi).getByLabelText(MESAJ), { target: { value: "Și ușa scartaie" } }); });
    await act(async () => { elibereaza(); });
    expect(screen.getByRole("status").textContent).toBe("Mesajul a fost trimis");
    expect(within(card("Ușa de la intrare nu se închide")).getByLabelText(MESAJ).value).toBe("Și ușa scartaie");
  });

  it("un mesaj refuzat ramane in camp", async () => {
    const { sursa } = await laSesizari({ email: ELENA });
    vi.spyOn(sursa, "scrieMesaj").mockRejectedValue(new Error("Fără retea"));
    scrie(MESAJ, "Revin");
    await apasaButon("Trimite");
    expect(screen.getByRole("status").textContent).toBe("Fără retea");
    expect(screen.getByLabelText(MESAJ).value).toBe("Revin");
  });
});

describe("Sesizari: sesizare noua", () => {
  it("alegerea rapida completeaza titlul si categoria; se trimite cu trei poze", async () => {
    const { sursa } = await laSesizari({ email: ELENA });
    const spion = vi.spyOn(sursa, "adaugaSesizare");
    await alegeSegment("Din tot blocul");
    await apasaButon("Sesizare nouă");
    const f = foaie();
    expect(within(f).getByRole("button", { name: "Trimite sesizarea" }).getAttribute("aria-disabled")).toBe("true");
    await apasa(within(f).getByRole("button", { name: "Liftul nu merge" }));
    expect(screen.getByLabelText("Sau scrie pe scurt problema").value).toBe("Liftul nu merge");
    expect(screen.getByLabelText("Categorie").value).toBe("acces");
    /* varianta aleasa este scrisa ingrosat */
    expect(butonul("Liftul nu merge", f).getAttribute("aria-pressed")).toBe("true");
    expect(butonul("Geam spart", f).getAttribute("aria-pressed")).toBe("false");

    await alegeFisier("Adaugă o poză", fisierPoza("p1.jpg"));
    await alegeFisier("Încă o poză", fisierPoza("p2.jpg"));
    await alegeFisier("Încă o poză", fisierPoza("p3.jpg"));
    expect(within(f).getAllByAltText("Poza sesizare")).toHaveLength(3);
    expect(within(f).queryByRole("button", { name: "Încă o poză" })).toBeNull();

    await apasa(within(f).getByRole("button", { name: "Trimite sesizarea" }));
    const d = await sursa.incarca();
    expect(spion).toHaveBeenCalledTimes(1);
    const arg = spion.mock.calls[0][0];
    expect(arg).toMatchObject({ apartamentId: d.eu.apartamentId, titlu: "Liftul nu merge", categorie: "acces", descriere: "Liftul nu merge" });
    expect(arg.poze.map((p) => p.name)).toEqual(["p1.jpg", "p2.jpg", "p3.jpg"]);
    expect(screen.getByRole("status").textContent).toBe("Sesizarea a ajuns la administrator");
    expect(screen.queryByRole("dialog")).toBeNull();
    /* revine la Ale mele, unde apare sesizarea noua */
    expect(screen.queryByText(/Vezi ce s-a semnalat deja/)).toBeNull();
    const noua = card("Liftul nu merge");
    expect(within(noua).getByText("Nouă")).toBeTruthy();
    expect(within(noua).getAllByAltText("Poza atașată")).toHaveLength(3);

    await apasaButon("Sesizare nouă");
    expect(screen.getByLabelText("Sau scrie pe scurt problema").value).toBe("");
  });

  /* [P2] Vederea anonima (sesizari_bloc) nu mai aduce descrierea (K10):
     doar titlul se vede la "Din tot blocul", niciodata numele autorului.
     Formularul trebuie sa spuna exact asta, nu ca descrierea se vede si ea. */
  it("[P2] formularul spune adevarul: doar titlul se vede, fara nume si fara descriere", async () => {
    await laSesizari({ email: ELENA });
    await apasaButon("Sesizare nouă");
    expect(within(foaie()).getByText(/Alți locatari văd titlul la Din tot blocul, dar nu văd descrierea și nici numele tău\./)).toBeTruthy();
    expect(within(foaie()).queryByText(/vad titlul si descrierea/)).toBeNull();
  });

  it("text liber, categoria aleasa si descrierea", async () => {
    const { sursa } = await laSesizari({ email: ELENA });
    const spion = vi.spyOn(sursa, "adaugaSesizare");
    await apasaButon("Sesizare nouă");
    scrie("Sau scrie pe scurt problema", "  Nu merge becul la etajul 2  ");
    await act(async () => { fireEvent.change(screen.getByLabelText("Categorie"), { target: { value: "iluminat" } }); });
    scrie("Unde este și de când (opțional)", "  Lângă lift, de ieri  ");
    await apasaButon("Trimite sesizarea");
    expect(spion.mock.calls[0][0]).toMatchObject({ titlu: "Nu merge becul la etajul 2", categorie: "iluminat", descriere: "Lângă lift, de ieri", poze: [] });
  });

  it("o sesizare refuzata lasa formularul deschis; X il inchide", async () => {
    const { sursa } = await laSesizari({ email: ELENA });
    const a = amanat();
    vi.spyOn(sursa, "adaugaSesizare").mockImplementation(() => a.promisiune.then(() => { throw new Error("Fără retea"); }));
    await apasaButon("Sesizare nouă");
    scrie("Sau scrie pe scurt problema", "Geam spart la subsol");
    await apasaButon("Trimite sesizarea");
    expect(screen.getByRole("button", { name: "Se trimite..." }).getAttribute("aria-disabled")).toBe("true");
    await act(async () => { a.rezolva(); });
    expect(screen.getByRole("status").textContent).toBe("Fără retea");
    expect(screen.getByLabelText("Sau scrie pe scurt problema").value).toBe("Geam spart la subsol");
    await apasa(within(foaie()).getByRole("button", { name: "Închide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
