/* [F13-F18] Accesibilitate: contrast, butonul dezactivat, tinte de atingere de
   44 px, panoul modal, erorile anuntate si randurile care incap la 320 px. */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));
import { pornesteApp, ZI_DEMO, ADMIN, LOCATAR } from "./ajutor.jsx";
import { apasa, scrie, tab } from "./ui-baza-ajutor.jsx";

/* Contrastul WCAG intre doua culori scrise "rgb(r, g, b)" */
const canal = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminanta = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
};
export const contrast = (a, b) => {
  const [x, y] = [luminanta(a), luminanta(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/* Fundalul pe care se vede efectiv un text */
const fundal = (el) => {
  for (let n = el; n; n = n.parentElement) {
    if (n.style && n.style.backgroundColor.startsWith("rgb")) return n.style.backgroundColor;
  }
  return "rgb(255, 255, 255)";
};
const contrastul = (el) => contrast(el.style.color, fundal(el));
const px = (el, prop) => Number.parseFloat(el.style[prop]);

describe("[F13] textele secundare trec pragul AA de 4,5:1", () => {
  it("culoarea gri pe hartie si pe fundalul mai inchis", async () => {
    await pornesteApp({ email: LOCATAR });
    const peHartie = contrastul(screen.getByText("Ce ai de facut in perioada urmatoare"));
    await tab("Plata");
    const pePaperDeep = contrastul(screen.getByRole("button", { name: "Platile mele" }).querySelector("span"));

    /* valorile masurate raman scrise aici, ca o schimbare de paleta sa se vada */
    expect(peHartie).toBeGreaterThanOrEqual(4.5);
    expect(pePaperDeep).toBeGreaterThanOrEqual(4.5);
    expect(peHartie.toFixed(2)).toBe("5.19");
    expect(pePaperDeep.toFixed(2)).toBe("4.76");
  });

  it("aceeasi culoare gri peste tot, nu una mai deschisa pe alocuri", async () => {
    await pornesteApp({ email: LOCATAR });
    const griuri = [...document.querySelectorAll("span")]
      .filter((s) => s.style.color && s.textContent)
      .filter((s) => contrastul(s) < 4.5);
    expect(griuri.map((s) => s.textContent)).toEqual([]);
  });
});

describe("[F14] butonul dezactivat ramane lizibil", () => {
  it("fara transparenta, cu o paleta proprie", async () => {
    await pornesteApp({ email: LOCATAR });
    await tab("Contoare");
    const buton = screen.getByRole("button", { name: "Trimite indexul" });
    expect(buton.getAttribute("aria-disabled")).toBe("true");
    expect(buton.style.opacity === "" || Number(buton.style.opacity) === 1).toBe(true);
    expect(contrastul(buton.querySelector("span"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("[F15] tintele de atingere au cel putin 44 px", () => {
  it("taburi, segmente, butoane mici si inchiderea panoului", async () => {
    await pornesteApp({ email: LOCATAR });
    screen.getAllByRole("tab").forEach((t) => {
      expect(px(t, "minHeight")).toBeGreaterThanOrEqual(44);
    });

    await tab("Sesizari");
    const segment = screen.getByRole("button", { name: "Ale mele" });
    expect(px(segment, "minHeight")).toBeGreaterThanOrEqual(44);
    const mic = screen.getByRole("button", { name: "Sesizare noua" });
    expect(px(mic, "minHeight")).toBeGreaterThanOrEqual(44);

    await apasa("Sesizare noua");
    const inchide = screen.getByRole("button", { name: "Inchide" });
    expect(px(inchide, "minHeight")).toBeGreaterThanOrEqual(44);
    expect(px(inchide, "minWidth")).toBeGreaterThanOrEqual(44);
  });
});

describe("[R3] bara de taburi se ingusteaza in loc sa iasa din ecran la zoom mare", () => {
  it("cele cinci taburi nu impun un minWidth de 44 px fiecare (220 px nu incape intr-o coloana de 206 px), doar inaltimea tintei ramane 44 px", async () => {
    await pornesteApp({ email: ADMIN });
    const taburi = screen.getAllByRole("tab");
    expect(taburi).toHaveLength(5);
    taburi.forEach((t) => {
      expect(px(t, "minHeight")).toBeGreaterThanOrEqual(44);
      const minWidth = t.style.minWidth === "" ? 0 : px(t, "minWidth");
      expect(minWidth).toBeLessThan(44);
    });
  });
});

describe("[F16] panoul de jos se poarta ca un dialog modal", () => {
  async function sesizareNoua() {
    await pornesteApp({ email: LOCATAR });
    await tab("Sesizari");
    await apasa("Sesizare noua");
    return screen.getByRole("dialog");
  }

  it("este marcat modal si primeste focusul la deschidere", async () => {
    const dialog = await sesizareNoua();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("tasta Escape il inchide", async () => {
    const dialog = await sesizareNoua();
    await act(async () => { fireEvent.keyDown(dialog, { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fundalul nu arunca la gunoi un formular inceput", async () => {
    const dialog = await sesizareNoua();
    await act(async () => { fireEvent.click(dialog.parentElement); });
    expect(screen.queryByRole("dialog")).toBeNull();

    await apasa("Sesizare noua");
    await scrie("Sau scrie pe scurt problema", "Curge apa la etajul 3");
    await act(async () => { fireEvent.click(screen.getByRole("dialog").parentElement); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Sau scrie pe scurt problema").value).toBe("Curge apa la etajul 3");
  });
});

/* Mesajul zburator traieste 3,4 secunde; ce ramane dupa el conteaza */
function ceasCuTemporizatoare() {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(ZI_DEMO);
}
async function dupaMesajulZburator() {
  await act(async () => { vi.advanceTimersByTime(4000); });
  expect(screen.queryByRole("status")).toBeNull();
}

describe("[F17] erorile se anunta si nu dispar singure", () => {
  it("campul gresit este marcat si legat de explicatie", async () => {
    await pornesteApp({ email: LOCATAR });
    await tab("Contoare");
    await scrie("Apa rece, index anterior 244,5", "100");
    const camp = screen.getByLabelText("Apa rece, index anterior 244,5");
    expect(camp.getAttribute("aria-invalid")).toBe("true");
    const explicatie = document.getElementById(camp.getAttribute("aria-describedby"));
    expect(explicatie.textContent).toBe("Indexul nou nu poate fi mai mic decat cel anterior. Verifica cifrele.");

    await scrie("Apa rece, index anterior 244,5", "250");
    expect(screen.getByLabelText("Apa rece, index anterior 244,5").getAttribute("aria-invalid")).toBeNull();
  });

  it("incasarea refuzata ramane scrisa in fisa apartamentului", async () => {
    const { sursa } = await pornesteApp({ email: ADMIN });
    ceasCuTemporizatoare();
    vi.spyOn(sursa, "inregistreazaNumerar").mockRejectedValue(new Error("Chitantierul nu are setari."));
    await tab("Apartamente");
    await apasa("Apartament 17");
    await apasa("Inregistreaza incasare cash");
    await apasa("Emite chitanta");
    await dupaMesajulZburator();
    expect(screen.getByText("Chitantierul nu are setari.")).toBeTruthy();
  });

  it("publicarea refuzata ramane scrisa in panoul de confirmare", async () => {
    const { sursa } = await pornesteApp({ email: ADMIN });
    ceasCuTemporizatoare();
    vi.spyOn(sursa, "publicaLista").mockRejectedValue(new Error("Lista nu are nicio cheltuiala."));
    await tab("Facturi");
    await apasa("Publica lista");
    await apasa("Da, publica lista");
    await dupaMesajulZburator();
    expect(within(screen.getByRole("dialog")).getByText("Lista nu are nicio cheltuiala.")).toBeTruthy();
  });
});

describe("[F18] randurile de sume incap si pe un ecran de 320 px", () => {
  it("randul De plata acum si randul de sumar se aseaza pe doua linii la nevoie", async () => {
    await pornesteApp({ email: LOCATAR });
    const locatar = screen.getByText("De plata acum").parentElement.parentElement;
    expect(locatar.style.flexWrap).toBe("wrap");

    await pornesteApp({ email: ADMIN });
    const admin = screen.getByText(/^Lista de plata /).parentElement.parentElement;
    expect(admin.style.flexWrap).toBe("wrap");
  });
});
