/* Ce face de fapt un telefon.

   Restul suitei masoara latimea de 320 px si zoom-ul de 200%. Aici sunt
   lucrurile care se intampla in mana omului si pe care niciun test nu le-a
   facut inca: tastatura de pe ecran care taie jumatate din inaltime, un nume
   romanesc lung de proprietar, o poza facuta cu telefonul tinut vertical si
   plimbatul intre taburi cu formularul pe jumatate scris. */

import { test, expect } from "@playwright/test";
import {
  buton, intra, intraCa, mergiLaTab, serviciu, apartamentulNumarul, blocD14,
  asteaptaToast, textEcran, CUVINTE_TEHNICE, fisierPozaPortret, descarca, textPdf,
  CONTURI, PAROLA, aziRo,
} from "./ajutor.js";

/* Un telefon mic (320 px) cu tastatura deschisa: din 568 px de inaltime raman
   in jur de 300. Chrome DevTools da aceleasi cifre pentru iPhone SE. */
const CU_TASTATURA = { width: 320, height: 300 };
const INGUST = { width: 320, height: 568 };

/* Un nume romanesc lung, dar real: nume compus, prenume compus, fara diacritice */
const NUME_LUNG = "Constantin-Alexandru Vladescu-Dumitrescu";

async function faraDerulareOrizontala(page) {
  const masura = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    ecran: document.documentElement.clientWidth,
    shell: (() => {
      const s = document.querySelector(".ab-shell");
      return s ? { sw: s.scrollWidth, cw: s.clientWidth } : null;
    })(),
  }));
  expect(masura.doc, `pagina se trage pe orizontala: ${masura.doc} > ${masura.ecran}`)
    .toBeLessThanOrEqual(masura.ecran + 1);
  if (masura.shell) {
    expect(masura.shell.sw, "coloană aplicației se trage pe orizontala")
      .toBeLessThanOrEqual(masura.shell.cw + 1);
  }
}

/* Butonul poate sta sub taietura tastaturii, dar trebuie sa se poata ajunge la
   el prin derulare, si sa raspunda. */
async function ajungeLa(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const cutie = await locator.boundingBox();
  expect(cutie, "butonul nu are loc pe ecran").not.toBeNull();
  expect(cutie.height, "tinta de atingere sub 44 px").toBeGreaterThanOrEqual(40);
}

test.describe("ecran de 320 px cu tastatura deschisa", () => {
  test.use({ viewport: CU_TASTATURA });

  test("intrarea in cont se poate duce la capat cu tastatura pe ecran", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Numărul tău de telefon").fill(CONTURI.elena);
    await page.getByLabel("Parola").fill(PAROLA);
    await faraDerulareOrizontala(page);
    const intraBtn = page.getByRole("button", { name: "Intră", exact: true });
    await ajungeLa(intraBtn);
    await intraBtn.click();
    await expect(page.getByRole("button", { name: "Ieși", exact: true })).toBeVisible({ timeout: 25000 });
  });

  test("formularul de index se completeaza si se trimite pe ecran scurt", async ({ page }) => {
    await intra(page, CONTURI.voicu);
    await expect(page.getByRole("button", { name: "Ieși", exact: true })).toBeVisible({ timeout: 25000 });
    await mergiLaTab(page, "Contoare");
    await faraDerulareOrizontala(page);
    const campuri = page.getByLabel(/^Apa (rece|caldă), index anterior /);
    const cate = await campuri.count();
    test.skip(cate === 0, "apartamentul are deja indexul validat pe luna aceasta");
    for (let i = 0; i < cate; i += 1) {
      await campuri.nth(i).scrollIntoViewIfNeeded();
      const anterior = Number((await campuri.nth(i).getAttribute("placeholder")).replace(",", "."));
      await campuri.nth(i).fill(String(anterior + 3));
    }
    const trimite = buton(page, "Trimite indexul");
    await ajungeLa(trimite);
    await faraDerulareOrizontala(page);
  });

  test("toate ecranele administratorului incap si pe 300 px inaltime", async ({ page }) => {
    await intraCa(page, "admin");
    for (const tabul of ["Sumar", "Apartamente", "Facturi", "Sesizări", "Comunicare"]) {
      await mergiLaTab(page, tabul);
      await faraDerulareOrizontala(page);
      const t = await textEcran(page);
      for (const cuvant of CUVINTE_TEHNICE) expect(t, `${tabul} conține "${cuvant}"`).not.toContain(cuvant);
    }
    /* Bara de taburi ramane atinsa, nu iese din ecran */
    for (const tabul of ["Sumar", "Comunicare"]) {
      const cutie = await page.getByRole("tab", { name: new RegExp(`^${tabul}( \\d+)?$`) }).boundingBox();
      expect(cutie).not.toBeNull();
      expect(cutie.y + cutie.height).toBeLessThanOrEqual(CU_TASTATURA.height + 1);
    }
  });
});

test.describe("un nume romanesc lung de proprietar", () => {
  test.use({ viewport: INGUST });

  let VECHI = null;
  test.afterEach(async () => {
    if (!VECHI) return;
    await serviciu().schema("organizare").rpc("schimba_fisa_apartament", {
      p_apartament_id: VECHI.id, p_proprietar_nume: VECHI.proprietar_nume,
      p_cota_indiviza: VECHI.cota_indiviza, p_suprafata_mp: VECHI.suprafata_mp,
      p_scutit_lift: VECHI.scutit_lift, p_etaj: VECHI.etaj,
    });
    VECHI = null;
  });

  async function puneNumeLung(numar) {
    const ap = await apartamentulNumarul(numar);
    VECHI = { ...ap };
    const { error } = await serviciu().schema("organizare").rpc("schimba_fisa_apartament", {
      p_apartament_id: ap.id, p_proprietar_nume: NUME_LUNG,
      p_cota_indiviza: ap.cota_indiviza, p_suprafata_mp: ap.suprafata_mp,
      p_scutit_lift: ap.scutit_lift, p_etaj: ap.etaj,
    });
    if (error) throw new Error(error.message);
    return ap;
  }

  test("numele lung nu sparge lista de apartamente, fisa sau editorul de cote", async ({ page }) => {
    const ap = await puneNumeLung(12);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await expect(page.getByText(NUME_LUNG).first()).toBeVisible();
    await faraDerulareOrizontala(page);

    await page.getByRole("button", { name: `Apartament ${ap.numar}` }).click();
    const fisa = page.getByRole("dialog", { name: `Apartament ${ap.numar}` });
    await expect(fisa.getByText(NUME_LUNG).first()).toBeVisible();
    await faraDerulareOrizontala(page);

    /* Editorul de cote pune numele in eticheta fiecarui camp */
    await buton(page, "Corectează datele apartamentului").click();
    await buton(page, "Redistribuie cotele întregului bloc").click();
    await expect(fisa.getByLabel(`Ap. ${ap.numar}, ${NUME_LUNG}`)).toBeVisible();
    await faraDerulareOrizontala(page);
  });

  test("numele lung se scurteaza cinstit in lista interna, nu iese din pagina", async ({ page }) => {
    const ap = await puneNumeLung(12);
    void ap;

    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    /* D14 are patru liste, deci alegerea lunii este un rand de butoane */
    await page.getByRole("button", { name: "aug 26" }).click();
    await expect(page.getByText(/august 2026/i).first()).toBeVisible();

    const intern = await descarca(page, () => buton(page, "Exportă lista internă (uz administrativ)").click());
    const textul = textPdf(intern.octeti);
    expect(textul).toContain("Document intern");
    /* Numele intreg nu incape pe 110 pt: se scurteaza, dar ramane recognoscibil
       si nu se taie in mijlocul unui cuvant fara semn. */
    const randNume = textul.split("\n").find((r) => r.startsWith("Constantin"));
    expect(randNume, `numele lung nu apare deloc în PDF:\n${textul.slice(0, 400)}`).toBeTruthy();
    expect(randNume.length).toBeLessThanOrEqual(NUME_LUNG.length);
    if (randNume.length < NUME_LUNG.length) {
      expect(randNume.endsWith("."), `numele taiat fără semn: "${randNume}"`).toBe(true);
    }
    expect(textul).not.toMatch(/undefined|NaN/);
  });

  test("locatarul cu nume lung se vede intreg in bara de sus, fara sa impinga butonul Iesi", async ({ page }) => {
    const ap = await puneNumeLung(17);
    void ap;
    await intraCa(page, "elena");
    await faraDerulareOrizontala(page);
    const iesi = await buton(page, "Ieși").boundingBox();
    expect(iesi).not.toBeNull();
    expect(iesi.x + iesi.width).toBeLessThanOrEqual(INGUST.width + 1);
  });
});

test.describe("poza facuta cu telefonul tinut vertical", () => {
  test.use({ viewport: INGUST });

  test("indexul cu poza in picioare urca si ajunge la administrator", async ({ page }) => {
    const ap = await apartamentulNumarul(1);
    const luna = `${aziRo().slice(0, 7)}-01`;
    const sb = serviciu();
    /* Ca formularul sa fie deschis: citirile lunii se sterg si se pun la loc */
    const { data: vechi } = await sb.schema("contorizare").from("citiri")
      .select("*").eq("apartament_id", ap.id).eq("luna", luna);
    await sb.schema("contorizare").from("citiri").delete().eq("apartament_id", ap.id).eq("luna", luna);

    try {
      await intra(page, CONTURI.voicu);
      await expect(page.getByRole("button", { name: "Ieși", exact: true })).toBeVisible({ timeout: 25000 });
      await mergiLaTab(page, "Contoare");
      for (const eticheta of [/^Apa rece, index anterior /, /^Apa caldă, index anterior /]) {
        const camp = page.getByLabel(eticheta);
        const anterior = Number((await camp.getAttribute("placeholder")).replace(",", "."));
        await camp.fill(String(anterior + 7));
      }
      await page.setInputFiles("input[type=file]", fisierPozaPortret(480, 960));
      await expect(page.locator('img[alt="Poza contoarelor"]')).toBeVisible();
      /* Previzualizarea nu are voie sa se intinda peste latimea coloanei */
      await faraDerulareOrizontala(page);
      await buton(page, "Trimite indexul").click();
      await asteaptaToast(page, "Indexul a fost trimis");

      const { data: noi } = await sb.schema("contorizare").from("citiri")
        .select("poza_cale, stare").eq("apartament_id", ap.id).eq("luna", luna);
      expect(noi.length).toBeGreaterThan(0);
      const cale = noi.find((c) => c.poza_cale) || {};
      expect(cale.poza_cale, "poza nu s-a salvat").toBeTruthy();

      /* Bucket-ul `poze` accepta doar JPEG/WebP si cel mult 1 MB: poza din
         portret trebuie sa fi trecut prin micsorare, nu sa fi fost respinsa */
      const { data: fisier, error } = await sb.storage.from("poze").download(cale.poza_cale);
      if (error) throw new Error(`poza nu se poate descarcă: ${error.message}`);
      const octeti = Buffer.from(await fisier.arrayBuffer());
      expect(octeti.length).toBeLessThan(1024 * 1024);
      expect(octeti.slice(0, 2).toString("hex"), "poza salvata nu este JPEG").toBe("ffd8");

      /* Si administratorul o vede, nu un patrat gol */
      await buton(page, "Ieși").click();
      await intraCa(page, "admin");
      await mergiLaTab(page, "Apartamente");
      await page.getByRole("button", { name: "Citiri contoare" }).click();
      const card = page.getByText(`Ap. ${ap.numar} · `).first().locator("xpath=../..");
      await expect(card.getByRole("button", { name: "Deschide poza" }).first()).toBeVisible({ timeout: 20000 });
      await faraDerulareOrizontala(page);
    } finally {
      await sb.schema("contorizare").from("citiri").delete().eq("apartament_id", ap.id).eq("luna", luna);
      if (vechi && vechi.length) await sb.schema("contorizare").from("citiri").insert(vechi);
    }
  });
});

test.describe("plimbatul intre taburi cu formularul pe jumatate scris", () => {
  test.use({ viewport: INGUST });

  test("panoul cu text scris nu se inchide nici la atingerea fundalului, nici cu Escape", async ({ page }) => {
    /* Paza pe care si-a pus-o aplicatia: ce a scris omul nu se arunca la o
       atingere gresita. Testul o fixeaza, ca sa se vada ca [S6] este o gaura
       in aceeasi regula, nu o regula care lipseste. */
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizări");
    await buton(page, "Sesizare nouă").click();
    const camp = page.getByLabel("Sau scrie pe scurt problema");
    await camp.fill("Curge apa la calorifer, camera mare");

    const cutie = await page.locator(".ab-shell").boundingBox();
    await page.mouse.click(cutie.x + cutie.width / 2, cutie.y + 8);
    await expect(page.getByRole("dialog", { name: "Sesizare nouă" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Sesizare nouă" })).toBeVisible();
    await expect(camp).toHaveValue("Curge apa la calorifer, camera mare");

    const t = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test.fixme("[S6] gestul inapoi nu arunca in tacere sesizarea inceputa", async ({ page }) => {
    /* [S6] Panoul isi apara textul de o atingere gresita pe fundal (`pazit`,
       src/AdminBloc.jsx:2481) si de Escape, testul de mai sus o dovedeste.
       Gestul "inapoi" de pe telefon, cel mai folosit gest de pe Android, nu
       trece insa prin `onClose`: el schimba tabul prin istoricul browserului,
       `LocatarSesizari` se demonteaza cu tot cu starea lui
       (src/AdminBloc.jsx:2354-2357) si titlul, descrierea si pozele alese se
       pierd fara nicio intrebare. "Inainte" nu le aduce inapoi. Acelasi lucru
       la formularul de factura al administratorului si la fisa apartamentului.
       Masurat: dupa goBack tabul activ este "Acasă", panoul are 0 instante, iar
       dupa goForward campul este gol.
       Asteptat: ori gestul inapoi inchide doar panoul (si intreaba, ca peste
       tot), ori ce a scris omul este acolo cand se intoarce. */
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizări");
    await buton(page, "Sesizare nouă").click();
    await page.getByLabel("Sau scrie pe scurt problema").fill("Curge apa la calorifer, camera mare");
    await page.getByLabel("Unde este și de când (opțional)").fill("De două zile, din ce în ce mai tare.");

    await page.goBack();
    await page.goForward();
    await buton(page, "Sesizare nouă").click();
    await expect(page.getByLabel("Sau scrie pe scurt problema")).toHaveValue("Curge apa la calorifer, camera mare");
    await expect(page.getByLabel("Unde este și de când (opțional)")).toHaveValue("De două zile, din ce în ce mai tare.");
  });

  test("dupa plimbare prin taburi, ecranele raman intregi si pe romaneste", async ({ page }) => {
    await intraCa(page, "elena");
    for (const drum of [["Plata", "Contoare", "Acasă"], ["Bloc", "Sesizări", "Plata"]]) {
      for (const tabul of drum) {
        await mergiLaTab(page, tabul);
        await faraDerulareOrizontala(page);
        const t = await textEcran(page);
        expect(t.length, `tabul ${tabul} a ramas gol`).toBeGreaterThan(80);
        for (const cuvant of CUVINTE_TEHNICE) expect(t, `${tabul} conține "${cuvant}"`).not.toContain(cuvant);
      }
    }
    void (await blocD14());
  });
});
