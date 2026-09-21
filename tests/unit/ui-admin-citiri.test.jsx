/* Citirile contoarelor, vazute de administrator (AdminCitiri) */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { pornesteAdmin, apasa, buton, butoane, butonul, toast, inDialog, dezactivat, mergiLa } from "./ui-admin-ajutor.js";
import { zonaCu, inZona } from "./ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

async function deschideCitiri(opt) {
  const r = await pornesteAdmin({ tab: "Apartamente", ...opt });
  await apasa(screen.getByText("Citiri contoare"));
  return r;
}

/* Blocul unui apartament din lista de citiri */
const randAp = (numar) => within(zonaCu([new RegExp(`^Ap\\. ${numar} · `), "Rece"], 4));

const citiri = async (sursa, luna, numar) => {
  const d = await sursa.incarca();
  const ap = d.apartamente.find((a) => a.numar === numar);
  return d.citiri.filter((c) => c.apartamentId === ap.id && c.luna === luna);
};

describe("AdminCitiri, luna curenta", () => {
  it("se deschide din parametrii navigarii si arata termenul si KPI-urile", async () => {
    await pornesteAdmin();
    await apasa("Citiri de verificat");
    expect(screen.getByText("Termen de citire 25 septembrie 2026")).toBeTruthy();
    expect(inZona("Transmise", "apartamente").getByText("10 din 20")).toBeTruthy();
    expect(inZona("De verificat", "cu poza atasata").getByText("4")).toBeTruthy();
    expect([...screen.getByLabelText("Luna").options].map((o) => o.value)).toEqual(["2026-09", "2026-08", "2026-07", "2026-06"]);
  });

  it("randurile arata indexurile, starea, motivul respingerii si pozele", async () => {
    const { sursa } = await deschideCitiri();
    const [rece] = (await citiri(sursa, "2026-09", "9")).filter((c) => c.tip === "rece");
    const ap9 = randAp("9");
    expect(ap9.getByText(`Rece: ${rece.indexAnterior.toFixed(1).replace(".", ",")} → ${rece.indexCurent.toFixed(1).replace(".", ",")}, ${rece.consum.toFixed(2).replace(".", ",")} mc`)).toBeTruthy();
    expect(ap9.getAllByText("Trimis, in verificare")).toHaveLength(2);
    expect(ap9.getAllByText("POZA")).toHaveLength(1);
    const ap6 = randAp("6");
    expect(ap6.getAllByText("Poza este neclara, nu se vad cifrele negre.").length).toBeGreaterThan(0);
    expect(ap6.getAllByText("Respins")).toHaveLength(2);
    expect(ap6.queryByRole("button", { name: "Valideaza" })).toBeNull();
    const ap3 = randAp("3");
    expect(ap3.getByText("Rece")).toBeTruthy();
    expect(ap3.getAllByText("Netransmis")).toHaveLength(2);
    expect(randAp("1").getAllByText("Validat")).toHaveLength(2);
  });

  it("o respingere fara motiv salvat nu afiseaza text rosu", async () => {
    await deschideCitiri({
      modifica: (d) => { d.citiri.forEach((c) => { if (c.stare === "respinsa") c.motivRespingere = null; }); },
    });
    expect(screen.queryByText("Poza este neclara, nu se vad cifrele negre.")).toBeNull();
    expect(randAp("6").getAllByText("Respins")).toHaveLength(2);
  });

  it("valideaza ambele contoare ale apartamentului, intr-o singura comanda [A5]", async () => {
    const { sursa } = await deschideCitiri();
    const spion = vi.spyOn(sursa, "valideazaCitiriApartament");
    const ap9 = (await sursa.incarca()).apartamente.find((a) => a.numar === "9").id;
    await apasa(randAp("9").getByRole("button", { name: "Valideaza" }));
    expect(spion).toHaveBeenCalledTimes(1);
    expect(spion).toHaveBeenCalledWith(ap9, "2026-09", true, null);
    expect(toast().textContent).toBe("Citirea a fost validata");
    expect(randAp("9").getAllByText("Validat")).toHaveLength(2);
    expect(inZona("De verificat", "cu poza atasata").getByText("3")).toBeTruthy();
  });

  it("o eroare la validare arata mesajul si nu schimba nimic", async () => {
    const { sursa } = await deschideCitiri();
    const spion = vi.spyOn(sursa, "valideazaCitiriApartament").mockRejectedValue(new Error("Citirile au fost deja verificate."));
    await apasa(randAp("9").getByRole("button", { name: "Valideaza" }));
    expect(spion).toHaveBeenCalledTimes(1);
    expect(toast().textContent).toBe("Citirile au fost deja verificate.");
  });

  /* [A5] "Valideaza"/"Respinge" faceau cate un apel pe contor, cu reincarcare
     completa dupa fiecare; daca al doilea contor esua, primul ramanea
     validat si al doilea "trimisa" (exact bug-ul A1). O singura comanda
     pentru tot apartamentul face imposibila starea intermediara: fie
     reuseste pentru amandoua, fie nu schimba nimic. */
  it("[A5] validarea unui apartament este totul sau nimic", async () => {
    const { sursa } = await deschideCitiri();
    vi.spyOn(sursa, "valideazaCitiriApartament").mockRejectedValue(new Error("Retea cazuta"));
    await apasa(randAp("9").getByRole("button", { name: "Valideaza" }));
    const dupa = await citiri(sursa, "2026-09", "9");
    expect(dupa.map((c) => c.stare)).toEqual(["trimisa", "trimisa"]);
    expect(toast().textContent).toBe("Retea cazuta");
  });

  it("respinge cu un motiv gata scris, apoi cu motivul editat", async () => {
    const { sursa } = await deschideCitiri();
    const spion = vi.spyOn(sursa, "valideazaCitiriApartament");
    const ap9 = (await sursa.incarca()).apartamente.find((a) => a.numar === "9").id;
    await apasa(randAp("9").getByRole("button", { name: "Respinge" }));
    const f = inDialog("Respinge citirea, ap. 9");
    expect(dezactivat(f.getByRole("button", { name: "Respinge citirea" }))).toBe(true);
    const chip = (t) => butonul(t, f);
    await apasa(chip("Indexul nu corespunde cu poza."));
    const camp = f.getByLabelText("Motivul");
    expect(camp.value).toBe("Indexul nu corespunde cu poza.");
    expect(chip("Indexul nu corespunde cu poza.").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Poza este neclara, nu se vad cifrele.").getAttribute("aria-pressed")).toBe("false");
    await act(async () => { fireEvent.change(camp, { target: { value: "  Se vede alt contor.  " } }); });
    await apasa(f.getByRole("button", { name: "Respinge citirea" }));
    expect(spion).toHaveBeenCalledTimes(1);
    expect(spion).toHaveBeenCalledWith(ap9, "2026-09", false, "Se vede alt contor.");
    expect(toast().textContent).toBe("Citirea a fost respinsa, locatarul a fost anuntat");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(randAp("9").getAllByText("Se vede alt contor.").length).toBeGreaterThan(0);
  });

  it("motivul doar din spatii nu permite respingerea; inchiderea foii renunta", async () => {
    const { sursa } = await deschideCitiri();
    const spion = vi.spyOn(sursa, "valideazaCitiriApartament");
    await apasa(randAp("12").getByRole("button", { name: "Respinge" }));
    const f = inDialog("Respinge citirea, ap. 12");
    await act(async () => { fireEvent.change(f.getByLabelText("Motivul"), { target: { value: "   " } }); });
    expect(dezactivat(f.getByRole("button", { name: "Respinge citirea" }))).toBe(true);
    await apasa(f.getByRole("button", { name: "Inchide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(spion).not.toHaveBeenCalled();
  });

  it("o respingere esuata lasa foaia deschisa", async () => {
    const { sursa } = await deschideCitiri();
    vi.spyOn(sursa, "valideazaCitiriApartament").mockRejectedValue(new Error("Scrie motivul"));
    await apasa(randAp("12").getByRole("button", { name: "Respinge" }));
    const f = inDialog("Respinge citirea, ap. 12");
    await apasa(f.getByText("Poza nu arata contorul apartamentului."));
    await apasa(f.getByRole("button", { name: "Respinge citirea" }));
    expect(toast().textContent).toBe("Scrie motivul");
    expect(inDialog("Respinge citirea, ap. 12")).toBeTruthy();
  });

  it("aceeasi poza pe ambele contoare apare o singura data; poze diferite apar amandoua", async () => {
    await deschideCitiri({
      modifica: (d) => {
        const ap = d.apartamente.find((a) => a.numar === "12");
        const [a, b] = d.citiri.filter((c) => c.apartamentId === ap.id && c.luna === "2026-09");
        a.pozaCale = "demo/a.jpg";
        b.pozaCale = "demo/b.jpg";
      },
    });
    expect(randAp("12").getAllByText("POZA")).toHaveLength(2);
  });
});

describe("AdminCitiri, contorul general", () => {
  it("indexul nou: validare, consum calculat si salvare", async () => {
    const { sursa } = await deschideCitiri();
    const spion = vi.spyOn(sursa, "citesteContorGeneral");
    expect(screen.getByText("Apa rece, index anterior 19441,0")).toBeTruthy();
    expect(screen.getByText("Apa calda, index anterior 7981,0")).toBeTruthy();
    expect(screen.getAllByText("necitit")).toHaveLength(2);
    const [rece, calda] = screen.getAllByLabelText("Index nou");
    const [salveazaRece, salveazaCalda] = butoane("Salveaza");
    expect(dezactivat(salveazaRece)).toBe(true);

    await act(async () => { fireEvent.change(rece, { target: { value: "abc" } }); });
    expect(screen.getByText("Indexul nu poate fi mai mic decat cel anterior.")).toBeTruthy();
    expect(dezactivat(salveazaRece)).toBe(true);
    await act(async () => { fireEvent.change(rece, { target: { value: "19000" } }); });
    expect(screen.getByText("Indexul nu poate fi mai mic decat cel anterior.")).toBeTruthy();
    expect(dezactivat(salveazaRece)).toBe(true);
    await act(async () => { fireEvent.change(rece, { target: { value: "19800,5" } }); });
    expect(screen.getByText("Consum 359,50 mc")).toBeTruthy();
    await act(async () => { fireEvent.change(calda, { target: { value: "8100" } }); });
    expect(screen.getByText("Consum 119,00 mc")).toBeTruthy();

    await apasa(salveazaRece);
    expect(spion).toHaveBeenCalledWith("2026-09", "rece", 19800.5);
    expect(toast().textContent).toBe("Indexul contorului general a fost salvat");
    expect(screen.getByText("19800,5, consum 359,50 mc")).toBeTruthy();
    expect(screen.getByLabelText("Corecteaza indexul").value).toBe("");
    /* Campul de apa calda isi pastreaza valoarea */
    expect(screen.getByLabelText("Index nou").value).toBe("8100");
    await apasa(salveazaCalda);
    expect(spion).toHaveBeenLastCalledWith("2026-09", "calda", 8100);
  });

  /* Pe CI, testul e2e al ciclului lunii astepta degeaba sa salveze apa calda:
     indexul scris cat timp se salva apa rece disparea la finalul salvarii,
     fiindca aceasta punea inapoi starea formularului din clipa apasarii. Pe
     un telefon cu internet slab, administratorul pierdea ce scrisese. */
  it("indexul scris la alt contor in timpul unei salvari ramane scris", async () => {
    const { sursa } = await deschideCitiri();
    const real = sursa.citesteContorGeneral.bind(sursa);
    let elibereaza;
    vi.spyOn(sursa, "citesteContorGeneral").mockImplementation((...a) => new Promise((r) => { elibereaza = () => r(real(...a)); }));
    const [rece, calda] = screen.getAllByLabelText("Index nou");
    await act(async () => { fireEvent.change(rece, { target: { value: "19800" } }); });
    await apasa(butoane("Salveaza")[0]);
    /* Salvarea apei reci inca merge; administratorul trece la apa calda */
    await act(async () => { fireEvent.change(calda, { target: { value: "8100" } }); });
    await act(async () => { elibereaza(); });
    expect(toast().textContent).toBe("Indexul contorului general a fost salvat");
    expect(screen.getByLabelText("Index nou").value).toBe("8100");
    expect(dezactivat(butoane("Salveaza")[1])).toBe(false);
  });

  it("salvarea esuata pastreaza indexul scris", async () => {
    const { sursa } = await deschideCitiri();
    vi.spyOn(sursa, "citesteContorGeneral").mockRejectedValue(new Error("Refuzat"));
    const [rece] = screen.getAllByLabelText("Index nou");
    await act(async () => { fireEvent.change(rece, { target: { value: "19500" } }); });
    await apasa(butoane("Salveaza")[0]);
    expect(toast().textContent).toBe("Refuzat");
    expect(screen.getAllByLabelText("Index nou")[0].value).toBe("19500");
  });
});

describe("AdminCitiri, alta luna si estimari", () => {
  it("august: toate transmise, nimic de verificat, contorul general citit", async () => {
    await deschideCitiri();
    await act(async () => { fireEvent.change(screen.getByLabelText("Luna"), { target: { value: "2026-08" } }); });
    expect(screen.getByText("Termen de citire 25 august 2026")).toBeTruthy();
    expect(inZona("Transmise", "apartamente").getByText("20 din 20")).toBeTruthy();
    expect(inZona("De verificat", "cu poza atasata").getByText("0")).toBeTruthy();
    expect(screen.queryByText(/nu au transmis indexul/)).toBeNull();
    expect(screen.getByText("19441,0, consum 428,00 mc")).toBeTruthy();
    expect(screen.getAllByLabelText("Corecteaza indexul")).toHaveLength(2);
  });

  it("estimarea cere confirmare si anunta cate citiri au fost estimate", async () => {
    /* [A6] dupa termenul de citire (25 septembrie) */
    const { sursa } = await deschideCitiri({ zi: new Date("2026-09-26T09:00:00") });
    const spion = vi.spyOn(sursa, "estimeazaCitiri");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(screen.getByText("10 apartamente nu au transmis indexul")).toBeTruthy();
    await apasa("Estimeaza citirile lipsa");
    expect(confirm).toHaveBeenCalledWith("Completezi cu estimare toate citirile netransmise pe aceasta luna?");
    expect(spion).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await apasa("Estimeaza citirile lipsa");
    expect(spion).toHaveBeenCalledWith("2026-09");
    expect(toast().textContent).toBe("Au fost estimate 20 citiri");
    expect(randAp("3").getAllByText("Estimat")).toHaveLength(2);
  });

  it("estimarea esuata arata eroarea", async () => {
    const { sursa } = await deschideCitiri();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(sursa, "estimeazaCitiri").mockRejectedValue(new Error("Inca nu a trecut termenul"));
    await apasa("Estimeaza citirile lipsa");
    expect(toast().textContent).toBe("Inca nu a trecut termenul");
  });

  it("[A6] estimarea nu se poate face inainte de termenul de citire", async () => {
    const { sursa } = await deschideCitiri();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await apasa("Estimeaza citirile lipsa");
    const d = await sursa.incarca();
    expect(d.citiri.filter((c) => c.luna === "2026-09" && c.sursa === "estimat")).toHaveLength(0);
  });

  it("[NOU-1] apartamentul cu litera apare langa numarul lui in lista de citiri", async () => {
    await deschideCitiri({ modifica: (d) => { d.apartamente.find((a) => a.numar === "20").numar = "3A"; } });
    const ordine = screen.getAllByText(/^Ap\. \w+ · /).map((e) => e.textContent.split(" ")[1]);
    expect(ordine.slice(0, 5)).toEqual(["1", "2", "3", "3A", "4"]);
  });

  it("revenirea pe tab pastreaza luna curenta implicita", async () => {
    await deschideCitiri();
    await mergiLa("Sumar");
    await mergiLa("Apartamente");
    await apasa(screen.getByText("Citiri contoare"));
    expect(screen.getByLabelText("Luna").value).toBe("2026-09");
    expect(buton("Estimeaza citirile lipsa")).toBeTruthy();
  });
});
