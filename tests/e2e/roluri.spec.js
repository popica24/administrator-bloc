/* Roluri care nu se pot produce din interfata: presedinte, cenzor, fost
   locatar. Starea se face cu cheia de serviciu, ca dezvoltatorul din §8. */

import { test, expect } from "@playwright/test";
import {
  buton, intra, intraCa, mergiLaTab, serviciu, blocD14, apartamentulNumarul,
  creeazaCont, stergeCont, legaDeApartament, textEcran, CUVINTE_TEHNICE,
  asociatieD14, datorieDeTest,
} from "./ajutor.js";

/* Identificatorii se cauta in baza: un `db reset && npm run seed` le schimba */
let ASOC;
test.beforeAll(async () => { ASOC = await asociatieD14(); });

/* [C7] Fiecare mandat este un rand nou, cu perioada lui: cheia unica este
   partiala, pe mandatul in curs, deci aici se insereaza doar daca nu exista
   deja unul deschis. */
async function faceMembru(profilId, rol) {
  const db = serviciu().schema("identitate");
  const { data: curent } = await db.from("membri_asociatie").select("id")
    .eq("asociatie_id", ASOC).eq("profil_id", profilId).eq("rol", rol).is("activ_pana", null).maybeSingle();
  if (curent) return;
  const { error } = await db.from("membri_asociatie").insert({ asociatie_id: ASOC, profil_id: profilId, rol });
  if (error) throw new Error(`faceMembru: ${error.message}`);
}

async function platiConfirmate(apartamentId) {
  const { count } = await serviciu().schema("financiar").from("plati")
    .select("id", { count: "exact", head: true }).eq("apartament_id", apartamentId).eq("stare", "confirmata");
  return count;
}

test.describe("presedinte si cenzor care locuiesc in bloc", () => {
  const PRESEDINTE = "0798723213";
  const CENZOR = "0798671880";

  test.afterAll(async () => {
    await stergeCont(PRESEDINTE);
    await stergeCont(CENZOR);
  });

  test("presedintele vede ecranele de locatar, doar cu apartamentul lui", async ({ page }) => {
    const ap = await apartamentulNumarul(12);
    const pid = await creeazaCont(PRESEDINTE, "Ioana Stancu");
    await legaDeApartament(pid, ap.id);
    await faceMembru(pid, "presedinte");
    const plati = await platiConfirmate(ap.id);

    await intra(page, PRESEDINTE);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });
    /* [C2] Presedintele care locuieste in bloc porneste in apartamentul lui:
       cinci taburi de locatar, nu panoul. Verificarea blocului se deschide
       dintr-un buton, in tabul Bloc. */
    await expect(page.getByRole("tab")).toHaveCount(5);
    await expect(page.getByText("Panou administrator")).toHaveCount(0);
    await expect(page.getByText("Apartament 12, Bloc D14, scara A")).toBeVisible();

    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: "Platile mele" }).click();
    /* Desi RLS ii da tot blocul, ecranul arata doar platile apartamentului lui */
    await expect(buton(page, "Descarca chitanta")).toHaveCount(plati);
    const t = await textEcran(page);
    expect(t).not.toContain("Familia Ilie");
    expect(t).not.toContain("Elena Marinescu");
  });

  test("cenzorul vede doar sesizarile apartamentului lui la Ale mele", async ({ page }) => {
    const ap = await apartamentulNumarul(4);
    const pid = await creeazaCont(CENZOR, "Radu Pintea");
    await legaDeApartament(pid, ap.id);
    await faceMembru(pid, "cenzor");
    const { count } = await serviciu().schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("apartament_id", ap.id);
    expect(count).toBe(0);
    const plati = await platiConfirmate(ap.id);

    await intra(page, CENZOR);
    await expect(page.getByRole("tab", { name: /^Sesizari/ })).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Sesizari");
    await expect(page.getByText("Nu ai trimis nicio sesizare")).toBeVisible();
    await page.getByRole("button", { name: "Din tot blocul" }).click();
    const t = await textEcran(page);
    expect(t).not.toMatch(/Ap\. \d/);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);

    /* Cenzorul are drept de citire pe tot blocul, dar ecranul de locatar
       ramane al apartamentului lui (auditul 1, S2) */
    await mergiLaTab(page, "Plata");
    await page.getByRole("button", { name: "Platile mele" }).click();
    await expect(buton(page, "Descarca chitanta")).toHaveCount(plati);
  });

  /* [C2] Verificarea blocului se deschide din tabul Bloc si se inchide de
     unde a inceput: presedintele nu-si pierde apartamentul cat verifica. */
  test("presedintele deschide verificarea blocului si se intoarce la apartamentul lui", async ({ page }) => {
    const ap = await apartamentulNumarul(12);
    const pid = await creeazaCont(PRESEDINTE, "Ioana Stancu");
    await legaDeApartament(pid, ap.id);
    await faceMembru(pid, "presedinte");

    await intra(page, PRESEDINTE);
    await mergiLaTab(page, "Bloc");
    await expect(page.getByText("Esti presedinte al asociatiei")).toBeVisible({ timeout: 20000 });
    await buton(page, "Verifica blocul").click();
    await expect(page.getByText("Panou administrator")).toBeVisible();
    await expect(page.getByText("Presedinte, Bloc D14, scara A")).toBeVisible();
    await buton(page, "Inapoi la apartamentul meu").click();
    await expect(page.getByText("Apartament 12, Bloc D14, scara A")).toBeVisible();
  });

  test("contactele blocului arata presedintele si cenzorul", async ({ page }) => {
    await intraCa(page, "elena");
    const t = await textEcran(page);
    expect(t).toContain("PRESEDINTE");
    expect(t).toContain("CENZOR");
    expect(t).toContain("ADMINISTRATOR");
    expect(t).toContain("URGENTE LIFT");
  });
});

test.describe("presedinte fara apartament", () => {
  const TELEFON = "0798284550";
  test.afterAll(async () => { await stergeCont(TELEFON); });

  /* Un cenzor poate fi un contabil din afara blocului, iar un presedinte poate
     sa-si fi vandut apartamentul: contul lor nu e legat de niciun apartament,
     dar mandatul le da panoul de verificare, doar de citit. */
  test("vede panoul de verificare, fara niciun buton care schimba ceva", async ({ page }) => {
    const pid = await creeazaCont(TELEFON, "Petre Presedinte");
    await faceMembru(pid, "presedinte");

    await intra(page, TELEFON);
    await expect(page.getByText("Panou administrator")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Presedinte, Bloc D14, scara A")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(5);
    /* nu are apartament, deci nici intoarcere la ecranele de locatar */
    await expect(buton(page, "Inapoi la apartamentul meu")).toHaveCount(0);
    await expect(buton(page, "Trimite reminder de plata")).toHaveCount(0);
    await mergiLaTab(page, "Facturi");
    await expect(buton(page, "Publica lista")).toHaveCount(0);
    await expect(buton(page, "Adauga factura")).toHaveCount(0);
    const t = await textEcran(page);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });
});

/* Aplicatia nu modeleaza un om legat de doua apartamente: identitate.eu()
   alege un singur apartament (cea mai veche legatura activa), iar toate
   ecranele de locatar sunt filtrate pe el. Testele fixeaza ce vede azi. */
test.describe("locatar cu doua apartamente", () => {
  const TELEFON = "0798800829";
  let DATORIE;

  test.beforeAll(async () => {
    await stergeCont(TELEFON);
    const b = await blocD14();
    const primul = await apartamentulNumarul(5);
    const alDoilea = await apartamentulNumarul(7);
    const pid = await creeazaCont(TELEFON, "Doua Apartamente");
    const sb = serviciu();
    for (const [ap, din] of [[primul, "2026-06-01"], [alDoilea, "2026-07-01"]]) {
      const { error } = await sb.schema("identitate").from("locatari").insert({
        apartament_id: ap.id, bloc_id: b.id, profil_id: pid, calitate: "proprietar", activ_din: din,
      });
      if (error) throw new Error(error.message);
    }
    DATORIE = await datorieDeTest(alDoilea.id, 77.77, "E2E datoria celui de-al doilea apartament");
  });

  test.afterAll(async () => {
    await stergeCont(TELEFON);
    if (DATORIE) await serviciu().schema("financiar").from("datorii").delete().eq("id", DATORIE);
  });

  test("ecranele arata un singur apartament o data, cel ales", async ({ page }) => {
    const primul = await apartamentulNumarul(5);
    const alDoilea = await apartamentulNumarul(7);

    await intra(page, TELEFON);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(`Apartament ${primul.numar}, Bloc D14, scara A`)).toBeVisible();

    /* Datele celui de-al doilea apartament nu se amesteca in ecranele primului */
    const t = await textEcran(page);
    expect(t).not.toContain(alDoilea.proprietar_nume);
    expect(t).not.toContain("77,77");
    await mergiLaTab(page, "Plata");
    expect(await textEcran(page)).not.toContain("77,77");
    for (const cuvant of CUVINTE_TEHNICE) expect(await textEcran(page)).not.toContain(cuvant);
  });

  /* [P5] Vezi raportul: omul plateste pentru doua apartamente, dar aplicatia
     ii arata unul singur si nu ii spune nimic despre celalalt. */
  test("[P5] stie ca mai are un apartament in aplicatie", async ({ page }) => {
    const alDoilea = await apartamentulNumarul(7);
    await intra(page, TELEFON);
    await expect(page.getByRole("tab", { name: /^Acasa/ })).toBeVisible({ timeout: 20000 });

    /* [P5] Bara de sus spune ca apartamentul se poate schimba, iar panoul le
       arata pe amandoua; dupa alegere, ecranele urmeaza apartamentul ales. */
    await page.getByRole("button", { name: "Schimba apartamentul" }).click();
    await expect(page.getByRole("button", { name: `Apartament ${alDoilea.numar}` })).toBeVisible();
    await page.getByRole("button", { name: `Apartament ${alDoilea.numar}` }).click();
    await expect(page.getByText(new RegExp(`[Aa]partament(ul)? ${alDoilea.numar}\\b`))).toBeVisible();
  });
});

test.describe("fost locatar", () => {
  const TELEFON = "0798951839";
  test.afterAll(async () => { await stergeCont(TELEFON); });

  test("accesul incheiat ieri nu mai vede nimic din bloc", async ({ page }) => {
    const ap = await apartamentulNumarul(8);
    await stergeCont(TELEFON);
    const pid = await creeazaCont(TELEFON, "Fost Locatar");
    const b = await blocD14();
    const { error } = await serviciu().schema("identitate").from("locatari").insert({
      apartament_id: ap.id, bloc_id: b.id, profil_id: pid, calitate: "chirias",
      activ_din: "2026-01-01", activ_pana: "2026-09-19",
    });
    if (error) throw new Error(error.message);

    await intra(page, TELEFON);
    await expect(page.getByText("Leaga contul de apartamentul tau")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("tab")).toHaveCount(0);
    const t = await textEcran(page);
    expect(t).not.toContain("Familia Dumitrescu");
    expect(t).not.toContain("Bloc D14");
  });
});
