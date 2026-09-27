/* Sesizarile vazute de administrator (AdminSesizari) */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { pornesteAdmin, apasa, buton, butoane, toast, inDialog, dezactivat } from "./ui-admin-ajutor.js";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const deschideSesizari = (opt) => pornesteAdmin({ tab: "Sesizări", ...opt });
/* Cardurile de sesizare sunt butoane cu titlul drept eticheta */
const titluri = () => butoane(/./).map((b) => b.getAttribute("aria-label")).filter((t) => t && !["Închide", "Ieși"].includes(t));
const idSesizare = async (sursa, titlu) => (await sursa.incarca()).sesizari.find((s) => s.titlu === titlu).id;

describe("AdminSesizari, lista", () => {
  it("deschise, cea mai veche prima, cu zilele de asteptare", async () => {
    await deschideSesizari();
    expect(screen.getByText("3 deschise")).toBeTruthy();
    expect(titluri()).toEqual(["Usa de la intrare nu se inchide singura", "Bec ars pe palier la etajul 4", "Scurgere la coloana de la subsol"]);
    expect(screen.getByText("Așteaptă de 15 zile")).toBeTruthy();
    expect(screen.getByText("Așteaptă de 10 zile")).toBeTruthy();
    expect(screen.getByText("Așteaptă de 4 zile")).toBeTruthy();
    expect(screen.getByText("Ap. 11 · Instalații, apă, canalizare · 15 sep 2026")).toBeTruthy();
    expect(screen.getByText("Nouă")).toBeTruthy();
    expect(screen.getAllByText("În lucru")).toHaveLength(2);
  });

  it("rezolvate si toate, fara zile de asteptare la cele rezolvate", async () => {
    await deschideSesizari();
    await apasa(screen.getByText("Rezolvate"));
    expect(titluri()).toEqual(["Gunoi depozitat pe casa scarii", "Interfon defect"]);
    expect(screen.queryByText(/Așteaptă de/)).toBeNull();
    await apasa(screen.getByText("Toate"));
    expect(titluri()).toHaveLength(5);
  });

  it("ordinea deschiselor nu depinde de ordinea in care vin de la sursa", async () => {
    await deschideSesizari({ modifica: (d) => { d.sesizari.reverse(); } });
    expect(titluri()).toEqual(["Usa de la intrare nu se inchide singura", "Bec ars pe palier la etajul 4", "Scurgere la coloana de la subsol"]);
  });

  it("filtrul fara rezultate arata mesajul gol", async () => {
    await deschideSesizari({ modifica: (d) => { d.sesizari = d.sesizari.filter((s) => s.stare !== "rezolvata"); } });
    await apasa(screen.getByText("Rezolvate"));
    expect(screen.getByText("Nimic aici")).toBeTruthy();
  });

  it("sesizarea de azi, cea de ieri si cea de acum doua zile", async () => {
    await deschideSesizari({
      modifica: (d) => {
        d.sesizari[0].creataLa = "2026-09-19T08:00:00+03:00";
        d.sesizari[1].creataLa = "2026-09-18T08:00:00+03:00";
      },
    });
    expect(screen.getByText("Trimisă azi")).toBeTruthy();
    expect(screen.getByText("Așteaptă de o zi")).toBeTruthy();
    /* peste trei zile, textul trece pe culoarea care cere atentie */
    const vechea = screen.getByText(/^Așteaptă de \d+ zile$/);
    expect(vechea.style.color).not.toBe(screen.getByText("Așteaptă de o zi").style.color);
  });
});

describe("AdminSesizari, detaliul", () => {
  it("sesizarea noua: poze, fara conversatie; preluarea o trece in lucru", async () => {
    const { sursa } = await deschideSesizari();
    const spion = vi.spyOn(sursa, "preiaSesizare");
    const id = await idSesizare(sursa, "Scurgere la coloana de la subsol");
    await apasa(buton("Scurgere la coloana de la subsol"));
    const f = inDialog("Ap. 11");
    expect(f.getByText("Se aude apa curgand permanent langa boxa 11.")).toBeTruthy();
    expect(f.getByText(/^Trimisă pe 15 septembrie 2026, ora \d\d:05$/)).toBeTruthy();
    expect(f.getAllByText("POZA")).toHaveLength(2);
    expect(f.queryByText("Conversația")).toBeNull();
    await apasa(f.getByRole("button", { name: "Preiau sesizarea" }));
    expect(spion).toHaveBeenCalledWith(id);
    expect(toast().textContent).toBe("Sesizarea este în lucru");
    const g = inDialog("Ap. 11");
    expect(g.queryByRole("button", { name: "Preiau sesizarea" })).toBeNull();
    expect(g.getByText(/\. Preluată pe 19 sep 2026$/)).toBeTruthy();
  });

  it("raspunsul se trimite doar cu text si goleste campul", async () => {
    const { sursa } = await deschideSesizari();
    const spion = vi.spyOn(sursa, "scrieMesaj");
    const id = await idSesizare(sursa, "Bec ars pe palier la etajul 4");
    await apasa(buton("Bec ars pe palier la etajul 4"));
    const f = inDialog("Ap. 17");
    expect(f.getByText("Conversația")).toBeTruthy();
    expect(f.getByText(/^Administrație · 9 sep 2026/)).toBeTruthy();
    expect(f.getByText("Am cumparat becul, se monteaza joi.")).toBeTruthy();
    expect(dezactivat(f.getByRole("button", { name: "Trimite răspunsul" }))).toBe(true);
    const camp = f.getByLabelText("Răspuns pentru proprietar");
    await act(async () => { fireEvent.change(camp, { target: { value: "   " } }); });
    expect(dezactivat(f.getByRole("button", { name: "Trimite răspunsul" }))).toBe(true);
    await act(async () => { fireEvent.change(camp, { target: { value: "Becul a fost montat." } }); });
    await apasa(f.getByRole("button", { name: "Trimite răspunsul" }));
    expect(spion).toHaveBeenCalledWith(id, "Becul a fost montat.");
    expect(toast().textContent).toBe("Mesajul a fost trimis");
    expect(inDialog("Ap. 17").getByLabelText("Răspuns pentru proprietar").value).toBe("");
    expect(inDialog("Ap. 17").getByText("Becul a fost montat.")).toBeTruthy();
  });

  it("un raspuns esuat ramane in camp", async () => {
    const { sursa } = await deschideSesizari();
    vi.spyOn(sursa, "scrieMesaj").mockRejectedValue(new Error("Fără retea"));
    await apasa(buton("Bec ars pe palier la etajul 4"));
    const camp = inDialog("Ap. 17").getByLabelText("Răspuns pentru proprietar");
    await act(async () => { fireEvent.change(camp, { target: { value: "Revin" } }); });
    await apasa(inDialog("Ap. 17").getByRole("button", { name: "Trimite răspunsul" }));
    expect(toast().textContent).toBe("Fără retea");
    expect(inDialog("Ap. 17").getByLabelText("Răspuns pentru proprietar").value).toBe("Revin");
  });

  it("mesajul locatarului apare cu numele lui", async () => {
    await deschideSesizari({
      modifica: (d) => {
        const s = d.sesizari.find((x) => x.titlu === "Bec ars pe palier la etajul 4");
        s.mesaje.push({ id: "mes-l", dinAdministratie: false, autor: "Elena Marinescu", text: "Tot nu merge.", la: "2026-09-18T10:00:00+03:00" });
      },
    });
    await apasa(buton("Bec ars pe palier la etajul 4"));
    expect(inDialog("Ap. 17").getByText(/^Elena Marinescu · 18 sep 2026/)).toBeTruthy();
    expect(inDialog("Ap. 17").getByText("Tot nu merge.")).toBeTruthy();
  });

  it("marcheaza rezolvata inchide detaliul si muta sesizarea la rezolvate", async () => {
    const { sursa } = await deschideSesizari();
    const spion = vi.spyOn(sursa, "rezolvaSesizare");
    const id = await idSesizare(sursa, "Usa de la intrare nu se inchide singura");
    await apasa(buton("Usa de la intrare nu se inchide singura"));
    expect(inDialog("Ap. 6").queryAllByText("POZA")).toHaveLength(0);
    await apasa(inDialog("Ap. 6").getByRole("button", { name: "Marchează rezolvată" }));
    expect(spion).toHaveBeenCalledWith(id);
    expect(toast().textContent).toBe("Sesizarea a fost marcată rezolvată");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("2 deschise")).toBeTruthy();
    await apasa(screen.getByText("Rezolvate"));
    expect(titluri()).toContain("Usa de la intrare nu se inchide singura");
  });

  it("rezolvarea esuata lasa detaliul deschis", async () => {
    const { sursa } = await deschideSesizari();
    vi.spyOn(sursa, "rezolvaSesizare").mockRejectedValue(new Error("Sesizarea nu exista."));
    await apasa(buton("Usa de la intrare nu se inchide singura"));
    await apasa(inDialog("Ap. 6").getByRole("button", { name: "Marchează rezolvată" }));
    expect(toast().textContent).toBe("Sesizarea nu exista.");
    expect(inDialog("Ap. 6")).toBeTruthy();
  });

  it("sesizarea rezolvata se vede fara actiuni si cu data rezolvarii; X inchide", async () => {
    await deschideSesizari();
    await apasa(screen.getByText("Rezolvate"));
    await apasa(buton("Interfon defect"));
    const f = inDialog("Ap. 17");
    expect(f.getByText(/\. Preluată pe 21 aug 2026\. Rezolvată pe 24 aug 2026$/)).toBeTruthy();
    expect(f.queryByLabelText("Răspuns pentru proprietar")).toBeNull();
    expect(f.queryByRole("button", { name: "Marchează rezolvată" })).toBeNull();
    await apasa(f.getByRole("button", { name: "Închide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("textul inceput se sterge cand se deschide alta sesizare", async () => {
    await deschideSesizari();
    await apasa(buton("Bec ars pe palier la etajul 4"));
    await act(async () => { fireEvent.change(inDialog("Ap. 17").getByLabelText("Răspuns pentru proprietar"), { target: { value: "Ciorna" } }); });
    await apasa(inDialog("Ap. 17").getByRole("button", { name: "Închide" }));
    await apasa(buton("Usa de la intrare nu se inchide singura"));
    expect(inDialog("Ap. 6").getByLabelText("Răspuns pentru proprietar").value).toBe("");
  });
});
