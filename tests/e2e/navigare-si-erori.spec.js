/* Ce s-a reparat in jurul navigarii si al greselilor:
   - butonul Inapoi al browserului urca un nivel, nu iese din aplicatie;
   - sesiunea expirata si prima incarcare esuata duc la un ecran cu iesire,
     niciodata la "Se incarca..." pentru totdeauna;
   - erorile de bani si de publicare raman pe ecran, nu doar 3,4 secunde;
   - panoul pornit nu se inchide la atingerea fundalului si tine Tab-ul inauntru;
   - tintele de atingere si culoarea textului secundar. */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, tab, serviciu,
  textEcran, CUVINTE_TEHNICE,
} from "./ajutor.js";

const TABURI_LOCATAR = ["Acasa", "Plata", "Contoare", "Sesizari", "Bloc"];

test.describe("istoricul browserului", () => {
  test("Inapoi urca prin toate taburile vizitate, in ordine inversa", async ({ page }) => {
    await intraCa(page, "elena");
    for (const t of ["Plata", "Contoare", "Sesizari", "Bloc"]) await mergiLaTab(page, t);

    for (const t of ["Sesizari", "Contoare", "Plata"]) {
      await page.goBack();
      await expect(tab(page, t)).toHaveAttribute("aria-selected", "true");
    }
    await page.goBack();
    await expect(tab(page, "Acasa")).toHaveAttribute("aria-selected", "true");
    /* Aplicatia este inca deschisa: nu am iesit din ea */
    await expect(page.getByText("Buna, Elena")).toBeVisible();
  });

  test("Inainte reface drumul, tab cu tab", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await mergiLaTab(page, "Contoare");
    await page.goBack();
    await page.goBack();
    await expect(tab(page, "Acasa")).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(tab(page, "Plata")).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(tab(page, "Contoare")).toHaveAttribute("aria-selected", "true");
  });

  test("un salt din Acasa lasa si el urma: Inapoi se intoarce la Acasa", async ({ page }) => {
    await intraCa(page, "elena");
    await buton(page, "De unde vine suma").click();
    await expect(tab(page, "Plata")).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(tab(page, "Acasa")).toHaveAttribute("aria-selected", "true");
  });

  test("istoricul administratorului merge la fel, cu subtabul cerut", async ({ page }) => {
    await intraCa(page, "admin");
    await page.getByRole("button", { name: /^Citiri de verificat/ }).first().click();
    await expect(tab(page, "Apartamente")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Citiri contoare", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.goBack();
    await expect(tab(page, "Sumar")).toHaveAttribute("aria-selected", "true");
  });

  test("dupa iesirea din cont, Inapoi nu scoate date la iveala", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await buton(page, "Iesi").click();
    await expect(page.getByText("Intra in cont")).toBeVisible();
    await page.goBack();
    await expect(page.getByText("Intra in cont")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    const text = await textEcran(page);
    expect(text).not.toContain("Elena Marinescu");
  });
});

test.describe("sesiunea si prima incarcare", () => {
  async function stricaSesiunea(page) {
    await page.evaluate(() => {
      for (const cheie of Object.keys(window.localStorage)) {
        if (!cheie.startsWith("sb-")) continue;
        const v = JSON.parse(window.localStorage.getItem(cheie));
        v.access_token = "invalid.invalid.invalid";
        v.refresh_token = "invalid";
        v.expires_at = Math.floor(Date.now() / 1000) - 10;
        window.localStorage.setItem(cheie, JSON.stringify(v));
      }
    });
  }

  test("sesiunea expirata duce la un ecran cu iesire, nu la Se incarca fara capat", async ({ page }) => {
    await intraCa(page, "elena");
    await stricaSesiunea(page);
    await page.reload();
    await expect(
      page.getByText("Intra in cont").or(page.getByText("Nu am putut deschide contul"))
    ).toBeVisible({ timeout: 25000 });
    await expect(page.getByText("Se incarca...")).toHaveCount(0);
    const text = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(text, `ecranul contine "${cuvant}"`).not.toContain(cuvant);
  });

  test("prima incarcare cazuta arata ecranul de reincercare, apoi se reface", async ({ page }) => {
    await intraCa(page, "elena");
    /* Serverul de date nu mai raspunde: exact ce se intampla in lift */
    await page.route("**/rest/v1/**", (r) => r.abort());
    await page.reload();

    await expect(page.getByText("Nu am putut deschide contul")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Se incarca...")).toHaveCount(0);
    await expect(buton(page, "Incearca din nou")).toBeVisible();
    await expect(buton(page, "Iesi din cont")).toBeVisible();
    await expect(page.getByText(/sesiunea s-a inchis singura/)).toBeVisible();
    const text = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(text, `ecranul contine "${cuvant}"`).not.toContain(cuvant);

    await page.unroute("**/rest/v1/**");
    await buton(page, "Incearca din nou").click();
    await expect(page.getByText("Buna, Elena")).toBeVisible({ timeout: 25000 });
  });

  test("ecranul de reincercare are si o cale de iesire care duce la autentificare", async ({ page }) => {
    await intraCa(page, "elena");
    await page.route("**/rest/v1/**", (r) => r.abort());
    await page.reload();
    await expect(page.getByText("Nu am putut deschide contul")).toBeVisible({ timeout: 30000 });
    await page.unroute("**/rest/v1/**");
    await buton(page, "Iesi din cont").click();
    await expect(page.getByText("Intra in cont")).toBeVisible({ timeout: 20000 });
  });
});

test.describe("erori care raman pe ecran", () => {
  /* Testul [F6] incarca un document inainte ca serverul sa refuze iesirea din
     fond; sterge-l, altfel ramane la Acte, in fata locatarilor. */
  test.afterEach(async () => {
    const sb = serviciu();
    const { data } = await sb.schema("comunicare").from("documente")
      .select("id, cale").like("titlu", "E2E fond%");
    for (const d of data || []) {
      if (d.cale) await sb.storage.from("documente").remove([d.cale]);
      await sb.schema("comunicare").from("documente").delete().eq("id", d.id);
    }
  });

  test("ciorna spune limpede ce se intampla la publicare, fara sa publice nimic", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await expect(buton(page, "Publica lista")).toBeVisible();
    const text = await textEcran(page);
    expect(text).toContain("SEPTEMBRIE 2026 \u00b7 IN LUCRU");
    expect(text).toContain("Lista in lucru, locatarii nu o vad inca");
    expect(text).toContain("Motorul calculeaza pe loc, fara sa salveze nimic");
    for (const cuvant of CUVINTE_TEHNICE) expect(text, `ecranul contine "${cuvant}"`).not.toContain(cuvant);
  });

  test("[F6] refuzul unei iesiri din fond lasa si el motivul pe ecran", async ({ page }) => {
    /* [F6] Toate celelalte comenzi de bani au primit, la reparatia F17, un
       mesaj care ramane pe ecran: incasarea cash, corectia fisei, cotele,
       incasarea cash si publicarea folosesc componenta <Eroare>. Iesirea din
       fond nu: AdminFonduri (AdminBloc.jsx:2767-2830) are doar toastul de 3,4
       secunde, iar la refuz panoul ramane deschis, cu suma scrisa si fara
       niciun motiv vizibil. Omul apasa din nou si primeste acelasi refuz. */
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Fonduri", exact: true }).click();
    await buton(page, "Inregistreaza o iesire").first().click();
    await page.getByLabel("Suma iesita").fill("999999");
    await page.getByLabel("Pentru ce").fill("E2E fond mesaj care ramane");
    await page.setInputFiles("input[type=file]", {
      name: "doc.jpg", mimeType: "image/jpeg", buffer: Buffer.from("jpeg"),
    });
    await buton(page, "Inregistreaza iesirea").click();
    const panou = page.getByRole("dialog", { name: "Iesire din fond" });
    /* mesajul sursei: "Fondul are X lei; o iesire de Y lei l-ar duce pe minus." */
    const motiv = panou.getByText(/l-ar duce pe minus/i).first();
    await expect(motiv).toBeVisible({ timeout: 20000 });
    /* dupa ce toastul de 3,4 secunde dispare, motivul e inca pe ecran */
    await page.waitForTimeout(5000);
    await expect(page.locator(".ab-toast")).toHaveCount(0);
    await expect(motiv).toBeVisible();
  });
});

test.describe("panoul: paza si focusul", () => {
  test("Tab-ul nu iese din panou si focusul se intoarce de unde a plecat", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    const deschizator = buton(page, "Sesizare noua");
    await deschizator.click();
    const panou = page.getByRole("dialog", { name: "Sesizare noua" });
    await expect(panou).toBeVisible();

    /* Oricat s-ar apasa Tab, focusul ramane intre peretii panoului */
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const inauntru = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return !!(d && document.activeElement && d.contains(document.activeElement));
      });
      expect(inauntru, `Tab-ul ${i + 1} a scapat din panou`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(panou).toHaveCount(0);
    /* Butoanele desenate cu Btn isi iau numele din text, nu din aria-label */
    await expect.poll(async () => page.evaluate(() => (document.activeElement || {}).innerText || ""), { timeout: 5000 })
      .toContain("Sesizare noua");
  });

  test("[F5] Shift+Tab imediat dupa deschidere nu scoate focusul din panou", async ({ page }) => {
    /* [F5] Capcana de Tab (AdminBloc.jsx:1016-1028) compara focusul curent cu primul
       si cu ultimul element focalizabil din panou. La deschidere focusul este
       pe panoul insusi (tabIndex -1), care nu intra in lista, deci niciuna din
       cele doua conditii nu se potriveste si Shift+Tab pleaca in ecranul de
       dedesubt, ascuns sub scrim. Cine navigheaza de la tastatura ajunge sa
       "apese" butoane pe care nu le vede. */
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await expect(page.getByRole("dialog", { name: "Sesizare noua" })).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    const inauntru = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !!(d && document.activeElement && d.contains(document.activeElement));
    });
    expect(inauntru).toBe(true);
  });

  test("panourile cu formular inceput nu se arunca la atingerea fundalului", async ({ page }) => {
    const cutie = async () => (await page.locator(".ab-shell").boundingBox());
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await buton(page, "Scrie un anunt").click();
    await page.getByLabel("Titlu").fill("E2E paza panou");
    const c = await cutie();
    await page.mouse.click(c.x + c.width / 2, c.y + 20);
    await expect(page.getByRole("dialog", { name: "Anunt nou" })).toBeVisible();
    await expect(page.getByLabel("Titlu")).toHaveValue("E2E paza panou");
  });
});

test.describe("tinte de atingere si culori", () => {
  test("fiecare buton si fiecare tab au cel putin 44 px", async ({ page }) => {
    await intraCa(page, "elena");
    for (const t of TABURI_LOCATAR) {
      await mergiLaTab(page, t);
      const mici = await page.evaluate(() => {
        const rezultat = [];
        for (const el of document.querySelectorAll('[role="button"], [role="tab"]')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.height < 44 || r.width < 44) {
            rezultat.push(`${el.getAttribute("aria-label") || el.innerText.slice(0, 30)}: ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return rezultat;
      });
      expect(mici, `tinte sub 44 px in tabul ${t}`).toEqual([]);
    }
  });

  test("textul secundar trece pragul de contrast, pe orice fundal are in spate", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    const slabe = await page.evaluate(() => {
      const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/\d+/g).map(Number);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      const fundal = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && !bg.startsWith("rgba(0, 0, 0, 0")) return bg;
          n = n.parentElement;
        }
        return "rgb(255, 255, 255)";
      };
      const rele = [];
      for (const el of document.querySelectorAll("span, div")) {
        if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const st = getComputedStyle(el);
        const c1 = lum(st.color);
        const c2 = lum(fundal(el));
        const raport = (Math.max(c1, c2) + 0.05) / (Math.min(c1, c2) + 0.05);
        const marime = parseFloat(st.fontSize);
        const prag = marime >= 18.66 || (marime >= 14 && Number(st.fontWeight) >= 700) ? 3 : 4.5;
        if (raport < prag) rele.push(`"${el.textContent.trim().slice(0, 40)}" ${st.color} pe ${fundal(el)} = ${raport.toFixed(2)}:1`);
      }
      return rele.slice(0, 10);
    });
    expect(slabe, "text sub pragul de contrast AA").toEqual([]);
  });
});
