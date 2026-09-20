/* Fondurile blocului, vazute de administrator (AdminFonduri, C3/E5): soldul si
   miscarile fiecarui fond, plus inregistrarea unei iesiri cu document obligatoriu. */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { pornesteAdmin, apasa, buton, scrie, toast, dezactivat, inDialog } from "./ui-admin-ajutor.js";
import { textEcran } from "./ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

async function deschideFonduri(opt) {
  const r = await pornesteAdmin({ tab: "Apartamente", ...opt });
  await apasa(screen.getByText("Fonduri"));
  return r;
}

const fisier = () => new File(["x"], "chitanta.pdf", { type: "application/pdf" });
const ataseaza = (f = fisier()) => { fireEvent.change(screen.getByLabelText("Ataseaza documentul"), { target: { files: [f] } }); return f; };

describe("AdminFonduri, soldul si miscarile", () => {
  it("arata soldul si fiecare miscare, cu documentul cand exista", async () => {
    await deschideFonduri();
    const t = textEcran();
    expect(t).toContain("Fond de reparatii19.228,60LEI");
    expect(t).toContain("Reparatie pompa hidrofor");
    expect(t).toContain("18 iul 2026");
    expect(t).toContain("Fond de rulment9.600,00LEI");
    expect(t).toContain("Sold preluat din registrul fondurilor");
    /* Doua fonduri, deci doua butoane de iesire, unul pentru fiecare */
    expect(screen.getAllByRole("button", { name: "Inregistreaza o iesire" })).toHaveLength(2);
  });

  it("deschide documentul unei miscari", async () => {
    const { sursa } = await deschideFonduri();
    const spion = vi.spyOn(sursa, "deschideDocument").mockResolvedValue(null);
    vi.spyOn(window, "open").mockReturnValue({ location: { href: "" }, close: vi.fn() });
    await apasa("Vezi documentul");
    expect(spion).toHaveBeenCalled();
  });

  it("panoul Fondul de reparatii de pe Sumar duce direct la acest tab", async () => {
    await pornesteAdmin();
    await apasa("Fond de reparatii");
    expect(textEcran()).toContain("Fond de reparatii19.228,60LEI");
    expect(screen.getAllByRole("button", { name: "Inregistreaza o iesire" })).toHaveLength(2);
  });
});

describe("AdminFonduri, inregistrarea unei iesiri (C3/E5)", () => {
  it("suma pozitiva scrisa de administrator ajunge negativa la sursa", async () => {
    const { sursa } = await deschideFonduri();
    const spion = vi.spyOn(sursa, "inregistreazaIesireFond");
    const date = await sursa.incarca();
    const fond = date.fonduri.find((f) => f.tip === "reparatii");
    /* Fondul de reparatii e primul fond afisat */
    await apasa("Inregistreaza o iesire", 0);
    expect(dezactivat(buton("Inregistreaza iesirea"))).toBe(true);
    await act(async () => {
      scrie("Suma iesita", "500");
      scrie("Pentru ce", "Revizie centrala termica");
      scrie("Data", "2026-09-10");
    });
    expect(dezactivat(buton("Inregistreaza iesirea"))).toBe(true);
    const f = fisier();
    await act(async () => { ataseaza(f); });
    expect(dezactivat(buton("Inregistreaza iesirea"))).toBe(false);
    await apasa("Inregistreaza iesirea");
    expect(spion).toHaveBeenCalledWith({ fondId: fond.id, suma: -500, descriere: "Revizie centrala termica", data: "2026-09-10", fisier: f });
    expect(toast().textContent).toBe("Iesirea din fond a fost inregistrata");
    expect(screen.queryByLabelText("Suma iesita")).toBeNull();
  });

  it("data de azi este precompletata si documentul este obligatoriu", async () => {
    await deschideFonduri();
    await apasa("Inregistreaza o iesire", 0);
    expect(screen.getByLabelText("Data").value).toBe("2026-09-19");
    await act(async () => { scrie("Suma iesita", "100"); scrie("Pentru ce", "Ceva"); });
    expect(dezactivat(buton("Inregistreaza iesirea"))).toBe(true);
  });

  it("inchiderea panoului nu trimite nimic", async () => {
    const { sursa } = await deschideFonduri();
    const spion = vi.spyOn(sursa, "inregistreazaIesireFond");
    await apasa("Inregistreaza o iesire", 0);
    await act(async () => { scrie("Suma iesita", "100"); });
    await apasa(inDialog("Iesire din fond").getByRole("button", { name: "Inchide" }));
    expect(screen.queryByLabelText("Suma iesita")).toBeNull();
    expect(spion).not.toHaveBeenCalled();
  });

  it("un refuz al sursei (fondul ar trece pe minus) lasa formularul deschis, cu mesajul ei", async () => {
    const { sursa } = await deschideFonduri();
    vi.spyOn(sursa, "inregistreazaIesireFond").mockRejectedValue(new Error("Fondul are 19.228,60 lei; o iesire de 50.000,00 lei l-ar duce pe minus."));
    await apasa("Inregistreaza o iesire", 0);
    await act(async () => {
      scrie("Suma iesita", "50000");
      scrie("Pentru ce", "Ceva mare");
      ataseaza();
    });
    await apasa("Inregistreaza iesirea");
    expect(toast().textContent).toBe("Fondul are 19.228,60 lei; o iesire de 50.000,00 lei l-ar duce pe minus.");
    expect(screen.getByLabelText("Suma iesita").value).toBe("50000");
  });

  it("fiecare fond are propriul buton de iesire", async () => {
    const { sursa } = await deschideFonduri();
    const spion = vi.spyOn(sursa, "inregistreazaIesireFond");
    const date = await sursa.incarca();
    const rulment = date.fonduri.find((f) => f.tip === "rulment");
    /* Fondul de rulment e al doilea fond afisat */
    await apasa("Inregistreaza o iesire", 1);
    await act(async () => {
      scrie("Suma iesita", "100");
      scrie("Pentru ce", "Corectie");
      ataseaza();
    });
    await apasa("Inregistreaza iesirea");
    expect(spion).toHaveBeenCalledWith(expect.objectContaining({ fondId: rulment.id }));
  });
});
