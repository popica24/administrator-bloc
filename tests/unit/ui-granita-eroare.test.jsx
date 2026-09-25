/* [F2] O exceptie la randare nu mai albeste aplicatia: granita de eroare din
   sectiunea 10 arata un ecran cu "Ceva n-a mers" si doua iesiri. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, LOCATAR } from "./ajutor.jsx";
import { apasa } from "./ui-baza-ajutor.jsx";

/* React scrie exceptia prinsa in consola; testul nu are nevoie de zgomot */
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

/* Un ecran care crapa: sursa intoarce date fara lista de plati */
const strica = (d) => { d.plati = null; };

describe("[F2] granita de eroare", () => {
  it("arata mesajul si pastreaza aplicatia in picioare", async () => {
    const { container } = await pornesteApp({ email: LOCATAR, modifica: strica });
    expect(screen.getByText("Ceva n-a mers")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Încearcă din nou" })).toBeTruthy();
    expect(container.querySelector(".ab-root")).toBeTruthy();
  });

  it("Incearca din nou reia randarea ecranului", async () => {
    let stricat = true;
    await pornesteApp({ email: LOCATAR, modifica: (d) => { if (stricat) d.plati = null; } });
    expect(screen.getByText("Ceva n-a mers")).toBeTruthy();
    stricat = false;
    await apasa("Încearcă din nou");
    expect(screen.queryByText("Ceva n-a mers")).toBeNull();
    expect(screen.getByText("De făcut")).toBeTruthy();
  });

  it("Iesi scoate din cont si duce inapoi la autentificare", async () => {
    const { sursa } = await pornesteApp({ email: LOCATAR, modifica: strica });
    const iesire = vi.spyOn(sursa, "iesi");
    await apasa("Ieși", 1);
    expect(iesire).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Intră în cont")).toBeTruthy();
  });
});
