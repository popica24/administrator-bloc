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

  it("[F6] un refuz al sursei ramane vizibil in panou, nu doar in mesajul zburator", async () => {
    const { sursa } = await deschideFonduri();
    vi.spyOn(sursa, "inregistreazaIesireFond").mockRejectedValue(new Error("Fondul are 19.228,60 lei; o iesire de 50.000,00 lei l-ar duce pe minus."));
    await apasa("Inregistreaza o iesire", 0);
    await act(async () => {
      scrie("Suma iesita", "50000");
      scrie("Pentru ce", "Ceva mare");
      ataseaza();
    });
    await apasa("Inregistreaza iesirea");
    /* Mesajul trebuie sa ramana in panou (nu doar in toast-ul care dispare
       singur dupa 3,4 secunde), ca la orice alta comanda de bani. */
    expect(inDialog("Iesire din fond").getByText("Fondul are 19.228,60 lei; o iesire de 50.000,00 lei l-ar duce pe minus.")).toBeTruthy();
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

/* AlegeFisier si micsoreazaPoza: butonul deschide selectorul ascuns, iar o
   poza mare se micsoreaza inainte sa plece spre server (o poza de telefon are
   cateva mii de pixeli pe latura si cateva MB; bucketul primeste 1 MB). */
describe("poza atasata unui document", () => {
  const fals = () => {
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toBlob: (cb) => cb(new Blob(["mica"], { type: "image/jpeg" })) };
    const creeaza = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) => (tag === "canvas" ? canvas : creeaza(tag)));
    vi.stubGlobal("Image", class {
      constructor() { this.width = 3000; this.height = 1500; }
      set src(_v) { Promise.resolve().then(() => this.onload()); }
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:poza");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    return canvas;
  };

  it("butonul deschide selectorul, iar poza se micsoreaza la 1600 px", async () => {
    const canvas = fals();
    await deschideFonduri();
    await apasa("Inregistreaza o iesire", 0);
    const selector = screen.getByLabelText("Ataseaza documentul");
    const clic = vi.spyOn(selector, "click");
    await apasa("Ataseaza documentul");
    expect(clic).toHaveBeenCalled();

    const poza = new File(["x".repeat(100)], "IMG_2026.HEIC.jpeg", { type: "image/jpeg" });
    await act(async () => { fireEvent.change(selector, { target: { files: [poza] } }); });
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(800);
    expect(screen.getByText("IMG_2026.HEIC.jpg")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("daca micsorarea nu reuseste, ramane poza originala", async () => {
    const canvas = fals();
    canvas.toBlob = (cb) => cb(null);
    await deschideFonduri();
    await apasa("Inregistreaza o iesire", 0);
    const poza = new File(["x"], "contor.jpg", { type: "image/jpeg" });
    await act(async () => { fireEvent.change(screen.getByLabelText("Ataseaza documentul"), { target: { files: [poza] } }); });
    expect(screen.getByText("contor.jpg")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("selectorul inchis fara alegere nu trimite nimic, iar o poza fara nume devine poza.jpg", async () => {
    fals();
    await deschideFonduri();
    await apasa("Inregistreaza o iesire", 0);
    const selector = screen.getByLabelText("Ataseaza documentul");
    await act(async () => { fireEvent.change(selector, { target: { files: [] } }); });
    expect(screen.queryByText(/\.jpg$/)).toBeNull();

    const faraNume = new File(["x"], "", { type: "image/jpeg" });
    await act(async () => { fireEvent.change(selector, { target: { files: [faraNume] } }); });
    expect(screen.getByText("poza.jpg")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("o poza pe care browserul nu o poate deschide ramane cum a venit", async () => {
    fals();
    vi.stubGlobal("Image", class {
      set src(_v) { Promise.resolve().then(() => this.onerror()); }
    });
    await deschideFonduri();
    await apasa("Inregistreaza o iesire", 0);
    const stricata = new File(["x"], "stricata.jpg", { type: "image/jpeg" });
    await act(async () => { fireEvent.change(screen.getByLabelText("Ataseaza documentul"), { target: { files: [stricata] } }); });
    expect(screen.getByText("stricata.jpg")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("un fisier care nu e poza (PDF) ramane neschimbat", async () => {
    await deschideFonduri();
    await apasa("Inregistreaza o iesire", 0);
    ataseaza();
    await act(async () => {});
    expect(screen.getByText("chitanta.pdf")).toBeTruthy();
  });
});
