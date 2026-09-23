/* Aplicatia condusa asa cum o conduce cineva care nu poate folosi mausul si
   cineva care si-a marit browserul la 200%: aceleasi treburi principale
   (plata, indexul, sesizarea, votul), duse pana la capat numai din tastatura,
   apoi aceleasi ecrane la jumatate de latime, cat ramane la zoom 200%.

   La final, un test aduna mesajele de refuz pe care le poate intalni un om si
   verifica nu doar ca sunt pe romaneste, ci ca spun ce are de facut mai
   departe. */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, serviciu, apartamentulNumarul, asteaptaToast, CUVINTE_TEHNICE,
  CONTURI, PAROLA,
} from "./ajutor.js";

/* Tab pana cand focusul ajunge pe elementul cerut, apoi Enter. Intoarce cate
   apasari de Tab au fost nevoie, sau -1 daca elementul nu e de atins. */
async function tabPanaLa(page, locator, maxim = 120) {
  const tinta = await locator.first().elementHandle();
  if (!tinta) return -1;
  for (let i = 0; i <= maxim; i += 1) {
    const egal = await page.evaluate((el) => el === document.activeElement, tinta);
    if (egal) return i;
    await page.keyboard.press("Tab");
    await page.waitForTimeout(30);
  }
  return -1;
}

async function apasaCuTastatura(page, locator, maxim = 120) {
  const pasi = await tabPanaLa(page, locator, maxim);
  expect(pasi, `elementul nu se poate atinge cu Tab`).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Enter");
  return pasi;
}

async function scrieCuTastatura(page, locator, text) {
  const pasi = await tabPanaLa(page, locator);
  expect(pasi, "campul nu se poate atinge cu Tab").toBeGreaterThanOrEqual(0);
  await page.keyboard.type(text);
}

test.describe("treburile principale, numai din tastatura", () => {

  test("intrarea in cont se face fara maus", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Email")).toBeVisible();
    await scrieCuTastatura(page, page.getByLabel("Email"), CONTURI.elena);
    await scrieCuTastatura(page, page.getByLabel("Parola"), PAROLA);
    await apasaCuTastatura(page, buton(page, "Intra"));
    await expect(buton(page, "Iesi")).toBeVisible({ timeout: 25000 });
  });

  test("sesizarea se scrie si se trimite fara maus", async ({ page }) => {
    const TITLU = "E2E sesizare din tastatura";
    await intraCa(page, "elena");
    await apasaCuTastatura(page, page.getByRole("tab", { name: /^Sesizari( \d+)?$/ }));
    await expect(buton(page, "Sesizare noua")).toBeVisible();
    await apasaCuTastatura(page, buton(page, "Sesizare noua"));
    await scrieCuTastatura(page, page.getByLabel("Sau scrie pe scurt problema"), TITLU);
    await apasaCuTastatura(page, buton(page, "Trimite sesizarea"));
    await asteaptaToast(page, "Sesizarea a ajuns la administrator");

    const sb = serviciu();
    const { data } = await sb.schema("sesizari").from("sesizari").select("id").eq("titlu", TITLU);
    expect(data).toHaveLength(1);
    await sb.schema("sesizari").from("mesaje").delete().eq("sesizare_id", data[0].id);
    await sb.schema("sesizari").from("sesizari").delete().eq("id", data[0].id);
  });

  test("votul se da fara maus, cu tot cu confirmare", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(17);
    await intraCa(page, "elena");
    await apasaCuTastatura(page, page.getByRole("tab", { name: /^Bloc( \d+)?$/ }));
    await apasaCuTastatura(page, page.getByRole("button", { name: "Vot si adunare" }));
    await page.waitForTimeout(600);

    const varianta = page.getByRole("button", { name: /^Oferta A/ }).first();
    if (!(await varianta.count())) test.skip(true, "nu exista vot deschis pe datele curente");
    await apasaCuTastatura(page, varianta);
    const confirma = page.getByRole("button", { name: "Da, trimite votul", exact: true });
    await expect(confirma).toBeVisible({ timeout: 20000 });
    await apasaCuTastatura(page, confirma);
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 25000 });
    const mesaj = await page.locator(".ab-toast").innerText();
    for (const cuvant of CUVINTE_TEHNICE) expect(mesaj).not.toContain(cuvant);

    /* Votul ramane in baza doar pentru acest test */
    const { data: voturi } = await sb.schema("guvernanta").from("voturi_exprimate")
      .select("id").eq("apartament_id", ap.id);
    for (const v of voturi || []) await sb.schema("guvernanta").from("voturi_exprimate").delete().eq("id", v.id);
  });

  test("indexul contorului se completeaza din tastatura, poza ramane singurul pas cu fisier", async ({ page }) => {
    await intraCa(page, "elena");
    await apasaCuTastatura(page, page.getByRole("tab", { name: /^Contoare( \d+)?$/ }));
    const camp = page.getByLabel(/^Apa rece, index anterior /);
    await expect(camp).toBeVisible();
    const valoare = Number((await camp.getAttribute("aria-label")).match(/([\d,.]+)\s*$/)[1].replace(",", ".")) + 3;
    await scrieCuTastatura(page, camp, String(valoare).replace(".", ","));
    /* Butonul de poza trebuie sa fie de atins cu Tab, chiar daca fisierul
       insusi nu se poate alege din tastatura intr-un test */
    const pasi = await tabPanaLa(page, page.getByRole("button", { name: /Fotografiaza|poza/i }).first());
    expect(pasi, "butonul de poza nu se poate atinge cu Tab").toBeGreaterThanOrEqual(0);
  });
});

test.describe("browserul marit la 200%", () => {
  /* Zoomul de browser nu schimba numarul de pixeli fizici, ci injumatateste
     latimea in pixeli CSS: la 200% ecranul de telefon are ~206 px de scris. */
  test.use({ viewport: { width: 206, height: 460 } });

  const ecraneLocatar = ["Acasa", "Plata", "Contoare", "Sesizari", "Bloc"];

  test("niciun ecran al locatarului nu se poate trage pe orizontala", async ({ page }) => {
    await intraCa(page, "elena");
    for (const t of ecraneLocatar) {
      await mergiLaTab(page, t);
      await page.waitForTimeout(500);
      const doc = await page.evaluate(() => {
        const e = document.scrollingElement;
        return e.scrollWidth - e.clientWidth;
      });
      expect(doc, `tabul ${t} se poate trage pe orizontala`).toBeLessThanOrEqual(1);
      const text = await page.locator(".ab-shell > .ab-scroll").innerText();
      for (const cuvant of CUVINTE_TEHNICE) expect(text, `tabul ${t}`).not.toContain(cuvant);
    }
  });

  /* [R3] Bara celor 5 taburi este lata de 5 x 44 px = 220 px, iar la 200% pe
     un telefon raman 204 px de ecran. Ultimul tab ("Bloc", la administrator
     "Comunicare") iese cu 17 px in afara, fara nicio bara de derulare
     orizontala care sa-l aduca inapoi. La administrator, unde etichetele sunt
     mai lungi, mijlocul tabului "Sumar" este acoperit de tabul
     "Apartamente": cine apasa pe primul tab ajunge pe al doilea. */
  test("[R3] bara de taburi incape pe ecran la 200% si fiecare tab raspunde la mijlocul lui", async ({ page }) => {
    for (const cine of ["elena", "admin"]) {
      await intraCa(page, cine);
      const masura = await page.evaluate(() => {
        const bara = document.querySelector(".ab-tabbar");
        const taburi = Array.from(document.querySelectorAll('[role="tab"]'));
        return {
          depasire: bara.scrollWidth - bara.clientWidth,
          latimeEcran: document.querySelector(".ab-shell").clientWidth,
          gresite: taburi.filter((t) => {
            const r = t.getBoundingClientRect();
            const la = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !la || la.closest('[role="tab"]') !== t;
          }).map((t) => t.innerText.replace(/\n/g, " ")),
          iesite: taburi.filter((t) => t.getBoundingClientRect().right > document.querySelector(".ab-shell").clientWidth + 1)
            .map((t) => t.innerText.replace(/\n/g, " ")),
        };
      });
      expect(masura.depasire, `bara de taburi a lui ${cine} este mai lata decat ecranul`).toBeLessThanOrEqual(1);
      expect(masura.iesite, `taburi iesite din ecran la ${cine}`).toEqual([]);
      expect(masura.gresite, `taburi care raspund pentru altul la ${cine}`).toEqual([]);
      await buton(page, "Iesi").click();
    }
  });

  test("suma de plata si butonul principal raman citibile la 200%", async ({ page }) => {
    await intraCa(page, "elena");
    const text = await page.locator(".ab-shell > .ab-scroll").innerText();
    expect(text).toMatch(/DE PLATA ACUM|ACHITAT/);
    const principal = page.getByRole("button", { name: /Cum platesc|Descarca ultima chitanta/ }).first();
    await expect(principal).toBeVisible();
    const cutie = await principal.boundingBox();
    expect(cutie.width, "butonul principal iese din ecran").toBeLessThanOrEqual(206);
    expect(cutie.height, "butonul principal este prea mic pentru un deget").toBeGreaterThanOrEqual(40);
  });

  test("administratorul isi vede ecranele intregi la 200%", async ({ page }) => {
    await intraCa(page, "admin");
    /* "Sumar" este deja deschis; nu se apasa, pentru ca la 200% tabul lui este
       acoperit de "Apartamente" (vezi [R3]) */
    for (const t of ["Apartamente", "Facturi", "Sesizari", "Comunicare"]) {
      await mergiLaTab(page, t);
      await page.waitForTimeout(500);
      const lat = await page.evaluate(() => {
        const e = document.scrollingElement;
        return e.scrollWidth - e.clientWidth;
      });
      expect(lat, `tabul ${t} se poate trage pe orizontala`).toBeLessThanOrEqual(1);
      const text = await page.locator(".ab-shell > .ab-scroll").innerText();
      for (const cuvant of CUVINTE_TEHNICE) expect(text, `tabul ${t}`).not.toContain(cuvant);
    }
  });
});

test.describe("fiecare refuz spune ce are omul de facut", () => {
  /* Un mesaj de refuz care doar constata ("Nu se poate") il lasa pe om blocat.
     Cel putin un indemn trebuie sa fie acolo. */
  const INDEMNURI = /incearc|cere|verific|intra din nou|alege|scrie|apasa|asteapta|reincarca|contacteaza|completeaza|foloseste|corecteaza|trimite|schimba|adauga|sterge/i;

  async function mesajulDeRefuz(page, pasi) {
    await pasi(page);
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 25000 });
    return (await page.locator(".ab-toast").innerText()).trim();
  }

  test("refuzurile cele mai probabile spun si pasul urmator", async ({ page }) => {
    const mesaje = {};

    /* 1. Cod de invitatie gresit, pe ecranul de intrare */
    await page.goto("/");
    await buton(page, "Am un cod de la administrator").click();
    await page.getByLabel(/[Cc]od/).first().fill("ZZZZ9999");
    const trimite = page.getByRole("button", { name: /Continu|Verific|Intra/ }).first();
    if (await trimite.count()) {
      await trimite.click();
      await page.waitForTimeout(1200);
      const t = await page.locator(".ab-shell").innerText();
      mesaje.codGresit = (t.match(/Codul[^\n]*/) || [""])[0];
    }

    /* 2. Comanda fara server */
    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await buton(page, "Scrie un anunt").click();
    const panou = page.getByRole("dialog", { name: "Anunt nou" });
    await panou.getByLabel("Titlu").fill("E2E refuz");
    await panou.getByLabel("Continut").fill("Text.");
    await page.route("**/rest/v1/rpc/publica_anunt", (r) => r.abort());
    mesaje.faraServer = await mesajulDeRefuz(page, async (p) => buton(p, "Publica anuntul").click());
    await page.unroute("**/rest/v1/rpc/publica_anunt");
    expect(Object.keys(mesaje).length, "niciun refuz nu a fost adunat").toBeGreaterThan(0);

    for (const [unde, mesaj] of Object.entries(mesaje)) {
      expect(mesaj, `refuzul "${unde}" nu spune nimic`).toBeTruthy();
      for (const cuvant of CUVINTE_TEHNICE) expect(mesaj, `refuzul "${unde}"`).not.toContain(cuvant);
      expect(mesaj, `refuzul "${unde}" nu spune ce are omul de facut: "${mesaj}"`).toMatch(INDEMNURI);
    }
  });
});

/* [R4] Mesajul de la intrarea in cont constata, dar nu spune nimic mai
   departe: "Emailul sau parola nu sunt corecte." Omul de peste 50 de ani care
   nu stie daca a gresit adresa sau parola ramane fara urmatorul pas (verifica
   adresa, scrie parola din nou, cere o parola noua). */
test.describe("refuzul de la intrarea in cont", () => {
  test("[R4] parola gresita spune si ce are omul de facut", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(CONTURI.elena);
    await page.getByLabel("Parola").fill("Parola-Gresita-1");
    await buton(page, "Intra").click();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 25000 });
    const mesaj = await page.locator(".ab-toast").innerText();
    expect(mesaj).toMatch(/incearc|verific|cere|scrie/i);
  });
});
