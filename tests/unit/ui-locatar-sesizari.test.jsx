/* Ecranul Sesizari al locatarului (LocatarSesizari): ale mele si din tot
   blocul, conversatia cu administratia si formularul de sesizare noua. */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { pornesteApp, zonaCu, butonul } from "./ajutor.jsx";
import {
  ELENA, ILIE, apasa, apasaButon, alegeSegment, deschideTab, scrie, alegeFisier, fisierPoza, urlFalse, amanat, text,
} from "./ui-locatar-ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const MESAJ = "Adauga un mesaj pentru administrator";
/* Cardul unei sesizari, dupa titlu (primul text cu acel continut; descrierea poate fi identica) */
const card = (titlu) => {
  /* cardul sesizarii: urca de la titlu pana la blocul care are si starea, si
     descrierea de sub ea (doua randuri distincte, nu doar antetul) */
  let el = zonaCu([titlu, /Noua|In lucru|Rezolvata|suspendata/], 4);
  while (el.parentElement && el.childElementCount < 2) el = el.parentElement;
  return el.parentElement;
};
const foaie = () => screen.getByRole("dialog", { name: "Sesizare noua" });

async function laSesizari(optiuni) {
  urlFalse();
  const r = await pornesteApp(optiuni);
  await deschideTab("Sesizari");
  return r;
}

describe("Sesizari: listele", () => {
  it("Ale mele: starea, categoria, pozele si conversatia", async () => {
    await laSesizari({ email: ELENA });
    expect(screen.getByText("Bloc D14, scara A")).toBeTruthy();
    const deschisa = card("Bec ars pe palier la etajul 4");
    expect(within(deschisa).getByText("In lucru")).toBeTruthy();
    expect(text(deschisa)).toContain("Iluminat si electrice · 9 sep 2026");
    expect(text(deschisa)).not.toContain("a ta");
    expect(text(deschisa)).toContain("Becul de langa ap. 17 nu mai porneste de doua zile.");
    expect(within(deschisa).getByText("POZA")).toBeTruthy();
    expect(text(deschisa)).toContain("Raspuns administrator · 9 sep 2026Am cumparat becul, se monteaza joi.");
    expect(within(deschisa).getByLabelText(MESAJ)).toBeTruthy();

    const rezolvata = card("Interfon defect");
    expect(within(rezolvata).getByText("Rezolvata")).toBeTruthy();
    expect(within(rezolvata).queryByLabelText(MESAJ)).toBeNull();
    /* sesizarile altora nu apar la Ale mele */
    expect(screen.queryByText("Scurgere la coloana de la subsol")).toBeNull();
  });

  it("Din tot blocul: sesizarile deschise ale altora, cele proprii marcate, fara cele rezolvate ale altora", async () => {
    await laSesizari({ email: ELENA });
    await alegeSegment("Din tot blocul");
    expect(screen.getByText("Vezi ce s-a semnalat deja, ca sa nu scrii de doua ori despre acelasi lucru. Nu se vede cine a trimis sesizarea.")).toBeTruthy();
    const noua = card("Scurgere la coloana de la subsol");
    expect(within(noua).getByText("Noua")).toBeTruthy();
    expect(text(noua)).toContain("Instalatii, apa, canalizare · 15 sep 2026");
    expect(within(noua).queryByLabelText(MESAJ)).toBeNull();
    expect(text(card("Bec ars pe palier la etajul 4"))).toContain(" · a ta");
    expect(screen.getByText("Interfon defect")).toBeTruthy();
    expect(screen.queryByText("Gunoi depozitat pe casa scarii")).toBeNull();
  });

  it.fails("[K14] Din tot blocul arata si sesizarile rezolvate in ultimele 30 de zile", async () => {
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

  it("niciuna deschisa in bloc", async () => {
    await laSesizari({ email: ILIE, modifica: (d) => { d.sesizari = d.sesizari.filter((s) => s.stare === "rezolvata"); } });
    await alegeSegment("Din tot blocul");
    expect(screen.getByText("Nicio sesizare deschisa in bloc")).toBeTruthy();
  });

  it("un mesaj al locatarului apare ca Mesajul tau", async () => {
    await laSesizari({
      email: ELENA,
      modifica: (d) => {
        d.sesizari.find((s) => s.titlu === "Bec ars pe palier la etajul 4").mesaje.push({ id: "m-loc", text: "Tot nu merge", la: "2026-09-12T10:00:00+03:00", dinAdministratie: false });
      },
    });
    expect(text(card("Bec ars pe palier la etajul 4"))).toContain("Mesajul tau · 12 sep 2026Tot nu merge");
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
    expect(text(card("Bec ars pe palier la etajul 4"))).toContain("Mesajul tau · 19 sep 2026Multumesc, astept");
  });

  it("un mesaj refuzat ramane in camp", async () => {
    const { sursa } = await laSesizari({ email: ELENA });
    vi.spyOn(sursa, "scrieMesaj").mockRejectedValue(new Error("Fara retea"));
    scrie(MESAJ, "Revin");
    await apasaButon("Trimite");
    expect(screen.getByRole("status").textContent).toBe("Fara retea");
    expect(screen.getByLabelText(MESAJ).value).toBe("Revin");
  });
});

describe("Sesizari: sesizare noua", () => {
  it("alegerea rapida completeaza titlul si categoria; se trimite cu trei poze", async () => {
    const { sursa } = await laSesizari({ email: ELENA });
    const spion = vi.spyOn(sursa, "adaugaSesizare");
    await alegeSegment("Din tot blocul");
    await apasaButon("Sesizare noua");
    const f = foaie();
    expect(within(f).getByRole("button", { name: "Trimite sesizarea" }).getAttribute("aria-disabled")).toBe("true");
    await apasa(within(f).getByRole("button", { name: "Liftul nu merge" }));
    expect(screen.getByLabelText("Sau scrie pe scurt problema").value).toBe("Liftul nu merge");
    expect(screen.getByLabelText("Categorie").value).toBe("acces");
    /* varianta aleasa este scrisa ingrosat */
    expect(butonul("Liftul nu merge", f).getAttribute("aria-pressed")).toBe("true");
    expect(butonul("Geam spart", f).getAttribute("aria-pressed")).toBe("false");

    await alegeFisier("Adauga o poza", fisierPoza("p1.jpg"));
    await alegeFisier("Inca o poza", fisierPoza("p2.jpg"));
    await alegeFisier("Inca o poza", fisierPoza("p3.jpg"));
    expect(within(f).getAllByAltText("Poza sesizare")).toHaveLength(3);
    expect(within(f).queryByRole("button", { name: "Inca o poza" })).toBeNull();

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
    expect(within(noua).getByText("Noua")).toBeTruthy();
    expect(within(noua).getAllByAltText("Poza atasata")).toHaveLength(3);

    await apasaButon("Sesizare noua");
    expect(screen.getByLabelText("Sau scrie pe scurt problema").value).toBe("");
  });

  it("text liber, categoria aleasa si descrierea", async () => {
    const { sursa } = await laSesizari({ email: ELENA });
    const spion = vi.spyOn(sursa, "adaugaSesizare");
    await apasaButon("Sesizare noua");
    scrie("Sau scrie pe scurt problema", "  Nu merge becul la etajul 2  ");
    await act(async () => { fireEvent.change(screen.getByLabelText("Categorie"), { target: { value: "iluminat" } }); });
    scrie("Unde este si de cand (optional)", "  Langa lift, de ieri  ");
    await apasaButon("Trimite sesizarea");
    expect(spion.mock.calls[0][0]).toMatchObject({ titlu: "Nu merge becul la etajul 2", categorie: "iluminat", descriere: "Langa lift, de ieri", poze: [] });
  });

  it("o sesizare refuzata lasa formularul deschis; X il inchide", async () => {
    const { sursa } = await laSesizari({ email: ELENA });
    const a = amanat();
    vi.spyOn(sursa, "adaugaSesizare").mockImplementation(() => a.promisiune.then(() => { throw new Error("Fara retea"); }));
    await apasaButon("Sesizare noua");
    scrie("Sau scrie pe scurt problema", "Geam spart la subsol");
    await apasaButon("Trimite sesizarea");
    expect(screen.getByRole("button", { name: "Se trimite..." }).getAttribute("aria-disabled")).toBe("true");
    await act(async () => { a.rezolva(); });
    expect(screen.getByRole("status").textContent).toBe("Fara retea");
    expect(screen.getByLabelText("Sau scrie pe scurt problema").value).toBe("Geam spart la subsol");
    await apasa(within(foaie()).getByRole("button", { name: "Inchide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
