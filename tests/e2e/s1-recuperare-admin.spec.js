/* Caile de iesire ale administratorului.

   Restul suitei verifica faptul ca aplicatia REFUZA ce trebuie refuzat. Aici
   intrebarea e urmatoarea: dupa refuz, ce face omul? Fiecare test porneste de
   la un refuz real, pe ecran, si merge mai departe pana la o rezolvare
   adevarata, in aceeasi sesiune. Unde nu exista nicio cale, testul o cere si e
   marcat `fixme` cu un identificator [S…], ca defect al aplicatiei.

   Fiecare test isi pune datele la loc: fisa, cotele, miscarile de fond si
   conturile temporare. */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, serviciu, blocD14, apartamente, apartamentulNumarul,
  asteaptaToast, textEcran, CUVINTE_TEHNICE, fisierPoza, listaLunara,
  creeazaCont, stergeCont, intra, curataIncercariInvitatii,
} from "./ajutor.js";

const MARCAJ = "E2E iesire";
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const numRo = (n, d = 2) => Number(n).toFixed(d).replace(".", ",");

async function repuneFisa(ap) {
  const { error } = await serviciu().schema("organizare").rpc("schimba_fisa_apartament", {
    p_apartament_id: ap.id,
    p_proprietar_nume: ap.proprietar_nume,
    p_cota_indiviza: ap.cota_indiviza,
    p_suprafata_mp: ap.suprafata_mp,
    p_scutit_lift: ap.scutit_lift,
    p_etaj: ap.etaj,
  });
  if (error) throw new Error(`repuneFisa: ${error.message}`);
}

async function repuneCotele(toate) {
  const b = await blocD14();
  const { error } = await serviciu().schema("organizare").rpc("schimba_cotele_blocului", {
    p_bloc_id: b.id,
    p_cote: toate.map((a) => ({ apartament_id: a.id, cota: a.cota_indiviza })),
  });
  if (error) throw new Error(`repuneCotele: ${error.message}`);
}

async function curataIesirile() {
  const sb = serviciu();
  const { data } = await sb.schema("financiar").from("miscari_fond")
    .select("id, document_id").like("descriere", `${MARCAJ}%`);
  for (const m of data || []) {
    await sb.schema("financiar").from("miscari_fond").delete().eq("id", m.id);
    if (m.document_id) {
      const { data: doc } = await sb.schema("comunicare").from("documente")
        .select("cale").eq("id", m.document_id).maybeSingle();
      if (doc && doc.cale) await sb.storage.from("documente").remove([doc.cale]);
      await sb.schema("comunicare").from("documente").delete().eq("id", m.document_id);
    }
  }
  await sb.schema("comunicare").from("documente").delete().like("titlu", `${MARCAJ}%`);
}

async function deschideFisa(page, numar) {
  await intraCa(page, "admin");
  await mergiLaTab(page, "Apartamente");
  await page.getByRole("button", { name: `Apartament ${numar}` }).click();
  return page.getByRole("dialog", { name: `Apartament ${numar}` });
}

test.describe("refuzul cotei are o iesire: editorul intregului bloc", () => {
  test("cota refuzata pe fisa se salveaza pana la capat din editorul de cote", async ({ page }) => {
    const toate = await apartamente();
    const ap = await apartamentulNumarul(18);
    const vecin = await apartamentulNumarul(19);
    const nouaCota = round2(Number(ap.cota_indiviza) + 0.6);
    const cotaVecin = round2(Number(vecin.cota_indiviza) - 0.6);
    expect(cotaVecin).toBeGreaterThan(0);

    try {
      const fisa = await deschideFisa(page, 18);
      await buton(page, "Corecteaza datele apartamentului").click();
      await page.getByLabel("Cota indiviza").fill(numRo(nouaCota));
      await buton(page, "Salveaza corectia").click();

      /* 1. Refuzul, pe ecran, cu suma la care ar ajunge blocul */
      const refuz = fisa.getByText(/Cotele blocului ar ajunge la/);
      await expect(refuz).toBeVisible();

      /* 2. Ecranul ofera, chiar acolo, singura cale corecta mai departe */
      await expect(buton(page, "Redistribuie cotele intregului bloc")).toBeVisible();
      await buton(page, "Redistribuie cotele intregului bloc").click();

      /* 3. In editor se muta procentele intre doua apartamente si totalul
            se intoarce la 100 sub ochii administratorului */
      await fisa.getByLabel(`Ap. ${ap.numar}, ${ap.proprietar_nume}`).fill(numRo(nouaCota));
      await expect(fisa.getByText(/% din 100%/)).not.toContainText("100,00% din 100%");
      await expect(buton(page, "Salveaza cotele blocului")).toBeDisabled();
      await fisa.getByLabel(`Ap. ${vecin.numar}, ${vecin.proprietar_nume}`).fill(numRo(cotaVecin));
      await expect(fisa.getByText("100,00% din 100%")).toBeVisible();

      await buton(page, "Salveaza cotele blocului").click();
      await asteaptaToast(page, "Cotele blocului au fost actualizate");

      /* 4. Rezolvare adevarata: in baza, cota ceruta initial este acolo */
      expect(Number((await apartamentulNumarul(18)).cota_indiviza)).toBeCloseTo(nouaCota, 4);
      expect(Number((await apartamentulNumarul(19)).cota_indiviza)).toBeCloseTo(cotaVecin, 4);
      const dupa = await apartamente();
      expect(round2(dupa.reduce((s, a) => s + Number(a.cota_indiviza), 0))).toBe(100);

      const t = await textEcran(page);
      for (const cuvant of CUVINTE_TEHNICE) expect(t, `mesajul contine "${cuvant}"`).not.toContain(cuvant);
    } finally {
      await repuneCotele(toate);
      await repuneFisa(ap);
    }
  });
});

test.describe("refuzul fondului are o iesire: o suma care incape", () => {
  test.afterEach(curataIesirile);

  test("iesirea prea mare e refuzata, iar suma corecta trece in aceeasi sesiune", async ({ page }) => {
    const b = await blocD14();
    const { data: fond } = await serviciu().schema("financiar").from("fonduri_solduri")
      .select("id, sold").eq("bloc_id", b.id).eq("tip", "reparatii").single();
    const soldul = round2(Number(fond.sold));

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Fonduri", exact: true }).click();
    await buton(page, "Inregistreaza o iesire").first().click();

    /* 1. Refuz: mai mult decat are fondul */
    await page.getByLabel("Suma iesita").fill(numRo(soldul + 1000));
    await page.getByLabel("Pentru ce").fill(`${MARCAJ} prea mare`);
    await page.setInputFiles("input[type=file]", fisierPoza("deviz.jpg"));
    await buton(page, "Inregistreaza iesirea").click();
    const panou = page.getByRole("dialog", { name: "Iesire din fond" });
    await expect(panou.getByText(/l-ar duce pe minus/)).toBeVisible();

    /* 2. Calea de iesire: ecranul arata soldul, deci administratorul stie
          cat poate scoate. Panoul nu a pierdut nimic din ce s-a scris. */
    await expect(panou.getByLabel("Pentru ce")).toHaveValue(`${MARCAJ} prea mare`);

    /* 3. Rezolvare: suma care incape se inregistreaza imediat, fara alt drum */
    await page.getByLabel("Suma iesita").fill("120");
    await page.getByLabel("Pentru ce").fill(`${MARCAJ} reparatie usa`);
    await buton(page, "Inregistreaza iesirea").click();
    await asteaptaToast(page, "Iesirea din fond a fost inregistrata");

    const { data: dupa } = await serviciu().schema("financiar").from("fonduri_solduri")
      .select("sold").eq("id", fond.id).single();
    expect(round2(Number(dupa.sold))).toBe(round2(soldul - 120));

    const t = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });
});

test.describe("codul de invitatie deja folosit are o iesire: unul nou", () => {
  const EMAIL_1 = `e2e-recup-a-${Date.now()}@adminbloc.test`;
  const EMAIL_2 = `e2e-recup-b-${Date.now()}@adminbloc.test`;

  test.afterAll(async () => {
    await stergeCont(EMAIL_1);
    await stergeCont(EMAIL_2);
    await curataIncercariInvitatii();
  });

  test("al doilea om primeste un cod nou din fisa, fara sa treaca pe la nimeni", async ({ page }) => {
    await curataIncercariInvitatii();
    const ap = await apartamentulNumarul(13);
    await creeazaCont(EMAIL_1, "Ion Primul");
    await creeazaCont(EMAIL_2, "Maria A Doua");

    /* 1. Administratorul da un cod din fisa apartamentului */
    const fisa = await deschideFisa(page, 13);
    await buton(page, "Invita un locatar in aplicatie").click();
    await buton(page, "Genereaza codul").click();
    const cod1 = (await fisa.getByText(/^[A-Z2-9]{8}$/).innerText()).trim();
    expect(cod1).toMatch(/^[A-Z2-9]{8}$/);
    await buton(page, "Gata").click();
    await buton(page, "Inchide").click();

    /* 2. Primul om il foloseste */
    await buton(page, "Iesi").click();
    await intra(page, EMAIL_1);
    await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
    await page.getByLabel("Codul primit").fill(cod1);
    await buton(page, "Foloseste codul").click();
    await asteaptaToast(page, `Contul a fost legat de apartamentul ${ap.numar}`);

    /* 3. Al doilea primeste acelasi cod pe hartie: refuz, pe romaneste */
    await buton(page, "Iesi").click();
    await intra(page, EMAIL_2);
    await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
    await page.getByLabel("Codul primit").fill(cod1);
    await buton(page, "Foloseste codul").click();
    await asteaptaToast(page, "Codul nu este valabil. Cere administratorului un cod nou.");
    const t = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);

    /* 4. Calea de iesire, exact cea pe care o spune mesajul: alt cod */
    await buton(page, "Iesi din cont").click();
    const fisa2 = await deschideFisa(page, 13);
    await buton(page, "Invita un locatar in aplicatie").click();
    await buton(page, "Genereaza codul").click();
    const cod2 = (await fisa2.getByText(/^[A-Z2-9]{8}$/).innerText()).trim();
    expect(cod2).not.toBe(cod1);
    await buton(page, "Gata").click();
    await buton(page, "Inchide").click();

    await buton(page, "Iesi").click();
    await intra(page, EMAIL_2);
    await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
    await page.getByLabel("Codul primit").fill(cod2);
    await buton(page, "Foloseste codul").click();
    await asteaptaToast(page, `Contul a fost legat de apartamentul ${ap.numar}`);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });
  });

  test("codul expirat spune acelasi lucru, iar fisa il arata cu data expirarii", async ({ page }) => {
    await curataIncercariInvitatii();
    const email = `e2e-recup-exp-${Date.now()}@adminbloc.test`;
    const ap = await apartamentulNumarul(11);
    const cod = `E2X${String(Date.now()).slice(-5)}`.replace(/[01IO]/g, "3").toUpperCase();
    try {
      await creeazaCont(email, "Petre Intarziat");
      await serviciu().schema("identitate").from("invitatii").insert({
        apartament_id: ap.id, cod, calitate: "proprietar",
        expira_la: new Date(Date.now() - 86400000).toISOString(),
      });

      await intra(page, email);
      await expect(page.getByLabel("Codul primit")).toBeVisible({ timeout: 20000 });
      await page.getByLabel("Codul primit").fill(cod);
      await buton(page, "Foloseste codul").click();
      await asteaptaToast(page, "Codul nu este valabil. Cere administratorului un cod nou.");
      await buton(page, "Iesi din cont").click();

      /* Calea de iesire este aceeasi: un cod nou din fisa. Codul expirat nu
         mai are ce cauta in lista codurilor nefolosite ale apartamentului. */
      const fisa = await deschideFisa(page, 11);
      await expect(fisa.getByText(new RegExp(`Cod nefolosit ${cod}`))).toHaveCount(0);
      await buton(page, "Invita un locatar in aplicatie").click();
      await buton(page, "Genereaza codul").click();
      await expect(fisa.getByText(/^[A-Z2-9]{8}$/)).toBeVisible();
    } finally {
      await serviciu().schema("identitate").from("invitatii").delete().eq("cod", cod);
      await stergeCont(email);
      await curataIncercariInvitatii();
    }
  });
});

test.describe("luna publicata: ce refuza si ce ramane de facut", () => {
  test("contorul general al unei luni publicate refuza corectura, pe romaneste", async ({ page }) => {
    /* Factura vine corectata de la furnizor dupa publicare, sau indexul de la
       subsol a fost scris gresit: administratorul incearca sa-l corecteze pe
       luna deja publicata. */
    const august = await listaLunara({ luna: "2026-08-01" });
    expect(august.stare).toBe("publicata");

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    await page.getByLabel("Luna").selectOption({ label: "august 2026" });

    const randuri = page.getByText(/^Apa (rece|calda), index anterior /);
    await expect(randuri).toHaveCount(2);
    const texte = await randuri.allInnerTexts();
    const i = texte.findIndex((x) => x.startsWith("Apa rece"));
    expect(i).toBeGreaterThanOrEqual(0);
    const anterior = Number(texte[i].match(/([\d.]+,\d+)/)[1].replace(/\./g, "").replace(",", "."));

    const camp = page.getByPlaceholder(/Index nou|Corecteaza indexul/).nth(i);
    await camp.fill(String(anterior + 5));
    await buton(page, "Salveaza").nth(i).click();
    await asteaptaToast(page, "Lista lunii august 2026 este deja publicata");

    const t = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test.fixme("[S1] dupa refuz, ecranul lunii publicate spune si ce are administratorul de facut", async ({ page }) => {
    /* [S1] Pe o luna deja publicata aplicatia ofera mai departe campul
       "Corecteaza indexul" si butonul "Salveaza", apoi refuza scrierea. Nimic
       de pe ecran nu spune ce urmeaza: recalcularea listei (harta functiilor
       §8.4) exista doar pentru dezvoltator, cu cheia de serviciu. Un
       administrator adevarat ramane cu o cifra gresita afisata locatarilor si
       fara nicio comanda in aplicatie.
       Asteptat: campul nu mai apare pe o luna publicata, iar ecranul spune ce
       se poate face (o corectie pe luna urmatoare, o recalculare ceruta). */
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    await page.getByLabel("Luna").selectOption({ label: "august 2026" });
    const t = await textEcran(page);
    expect(t).toMatch(/lista pe august 2026 este publicata|recalcul|corectie pe luna urmatoare/i);
    await expect(page.getByPlaceholder(/Index nou|Corecteaza indexul/)).toHaveCount(0);
  });

  test.fixme("[S2] o factura gresita dintr-o lista publicata are o cale de corectat din aplicatie", async ({ page }) => {
    /* [S2] O lista publicata nu mai are "Modifica" si nici "Sterge" pe
       cheltuieli — corect, sumele sunt inghetate. Dar corectia (recalcularea,
       care naste datorii de tip `corectie`) nu are niciun buton: ruleaza doar
       cu cheia de serviciu. Cand furnizorul trimite factura corectata dupa
       publicare — cazul cel mai obisnuit dintr-o administratie — nu exista
       nicio cale in aplicatie.
       Asteptat: pe lista publicata, o comanda de corectie a unei cheltuieli
       care recalculeaza si anunta locatarii. */
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    /* D14 are patru liste: alegerea lunii este un rand de butoane */
    await page.getByRole("button", { name: "aug 26" }).click();
    await expect(page.getByText(/august 2026 · publicata/i).first()).toBeVisible();
    await expect(
      buton(page, "Corecteaza factura").or(buton(page, "Recalculeaza lista")),
    ).toBeVisible();
  });
});

test.describe("lista care nu se poate calcula spune exact ce lipseste", () => {
  let cheltuialaId = null;
  test.afterEach(async () => {
    if (cheltuialaId) {
      await serviciu().schema("intretinere").from("cheltuieli").delete().eq("id", cheltuialaId);
      cheltuialaId = null;
    }
  });

  test("previzualizarea numeste apartamentele fara citire, nu doar 'nu se poate'", async ({ page }) => {
    const ciorna = await listaLunara({ stare: "ciorna" });
    const b = await blocD14();
    const { data: furnizor } = await serviciu().schema("intretinere").from("furnizori")
      .select("id").eq("asociatie_id", b.asociatie_id).limit(1).single();
    const { data: c } = await serviciu().schema("intretinere").from("cheltuieli").insert({
      lista_id: ciorna.id, tip: "factura", cod: "C41", categorie: "E2E recuperare apa",
      furnizor_id: furnizor.id, suma: 1000, metoda: "consum", tip_apa: "rece",
      serie_numar: "E2E-REC-1",
    }).select("id").single();
    cheltuialaId = c.id;

    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Calculeaza lista pe apartamente").click();
    await expect(page.getByText("Lista nu se poate calcula inca:")).toBeVisible({ timeout: 20000 });

    /* Refuzul trebuie sa fie o lista de treburi, nu un perete: fiecare
       problema spune pe ce apartament sau pe ce contor sta. */
    const t = await textEcran(page);
    expect(t).toMatch(/contorul general|citire/i);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);

    /* Si drumul mai departe este vizibil din acelasi ecran: starea citirilor */
    expect(t).toMatch(/Citiri validate: \d+ din \d+ apartamente/);
    expect(t).toMatch(/Contorul general: (citit|necitit)/);
  });
});
