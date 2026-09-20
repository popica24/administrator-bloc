/* Locatar: Sesizari si Bloc (harta functiilor §3.4 si §3.5) */

import { test, expect } from "@playwright/test";
import {
  buton, intra, intraCa, mergiLaTab, tab, serviciu, blocD14, apartamentulNumarul,
  creeazaCont, stergeCont, legaDeApartament, asteaptaToast, textEcran, CUVINTE_TEHNICE, fisierPoza,
  asociatieD14, votDupaTitlu,
} from "./ajutor.js";

/* Identificatorii se cauta in baza: un `db reset && npm run seed` le schimba */
let ASOC;
test.beforeAll(async () => { ASOC = await asociatieD14(); });

async function stergeSesizarile(apartamentId, titluPrefix = "E2E") {
  const sb = serviciu();
  const { data } = await sb.schema("sesizari").from("sesizari")
    .select("id, titlu").eq("apartament_id", apartamentId).like("titlu", `${titluPrefix}%`);
  for (const s of data || []) {
    await sb.schema("sesizari").from("sesizari_mesaje").delete().eq("sesizare_id", s.id);
    await sb.schema("sesizari").from("sesizari_poze").delete().eq("sesizare_id", s.id);
    await sb.schema("sesizari").from("sesizari").delete().eq("id", s.id);
  }
}

test.describe("Sesizari", () => {
  test.afterEach(async () => {
    const ap = await apartamentulNumarul(17);
    await stergeSesizarile(ap.id);
  });

  test("sesizarea rapida completeaza titlul si categoria dintr-un apasat", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await expect(page.getByRole("dialog", { name: "Sesizare noua" })).toBeVisible();
    await page.getByRole("button", { name: "Liftul nu merge" }).click();
    await expect(page.getByLabel("Sau scrie pe scurt problema")).toHaveValue("Liftul nu merge");
    await expect(page.getByLabel("Categorie")).toHaveValue("acces");
  });

  test("sesizarea noua cu text liber si poza ajunge la administrator", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const titlu = `E2E ${Date.now()} usa de la boxe`;
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await page.getByLabel("Sau scrie pe scurt problema").fill(titlu);
    await page.getByLabel("Categorie").selectOption("acces");
    await page.getByLabel("Unde este si de cand (optional)").fill("La subsol, de doua zile");
    await page.setInputFiles('input[type="file"]', fisierPoza("sesizare.jpg"));
    await expect(page.locator('img[alt="Poza sesizare"]')).toBeVisible();
    await buton(page, "Trimite sesizarea").click();
    await asteaptaToast(page, "Sesizarea a ajuns la administrator");

    await expect(page.getByText(titlu).first()).toBeVisible();
    await expect(page.getByText("Noua").first()).toBeVisible();
    const { data } = await serviciu().schema("sesizari").from("sesizari")
      .select("id, titlu, categorie, descriere, stare").eq("apartament_id", ap.id).eq("titlu", titlu).single();
    expect(data.categorie).toBe("acces");
    expect(data.descriere).toBe("La subsol, de doua zile");
    expect(data.stare).toBe("noua");
    const { data: poze } = await serviciu().schema("sesizari").from("sesizari_poze").select("cale").eq("sesizare_id", data.id);
    expect(poze).toHaveLength(1);
    expect(poze[0].cale).toContain(`/${ap.id}/`);
  });

  test("o poza pusa din greseala se scoate inainte de trimitere", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await page.setInputFiles('input[type="file"]', fisierPoza());
    await expect(page.locator('img[alt="Poza sesizare"]')).toHaveCount(1);
    await buton(page, "Sterge poza").click();
    await expect(page.locator('img[alt="Poza sesizare"]')).toHaveCount(0);
  });

  test("fara titlu, trimiterea ramane blocata", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await expect(buton(page, "Trimite sesizarea")).toHaveAttribute("aria-disabled", "true");
    await page.getByLabel("Sau scrie pe scurt problema").fill("ceva");
    await expect(buton(page, "Trimite sesizarea")).not.toHaveAttribute("aria-disabled", "true");
  });

  test("locatarul poate scrie un mesaj pe sesizarea lui", async ({ page }) => {
    const titlu = `E2E ${Date.now()} mesaj`;

    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    await page.getByLabel("Sau scrie pe scurt problema").fill(titlu);
    await buton(page, "Trimite sesizarea").click();
    await asteaptaToast(page, "Sesizarea a ajuns la administrator");

    /* Sesizarile sunt sortate cu cea mai noua prima */
    await expect(page.getByText(titlu).first()).toBeVisible();
    await page.getByRole("textbox", { name: "Adauga un mesaj pentru administrator" }).first()
      .fill("Tot nu merge, a trecut o saptamana.");
    await buton(page, "Trimite").first().click();
    await asteaptaToast(page, "Mesajul a fost trimis");
    await expect(page.getByText("Tot nu merge, a trecut o saptamana.")).toBeVisible();
    await expect(page.getByText("MESAJUL TAU · 20 sep 2026").first()).toBeVisible();
  });

  test("sesizarile blocului sunt anonime", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await page.getByRole("button", { name: "Din tot blocul" }).click();
    await expect(page.getByText("Nu se vede cine a trimis sesizarea.")).toBeVisible();
    const t = await textEcran(page);
    expect(t).not.toMatch(/Ap\. \d/);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("badge-ul de pe tab numara sesizarile proprii nerezolvate", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const { count } = await serviciu().schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("apartament_id", ap.id).neq("stare", "rezolvata");
    await intraCa(page, "elena");
    if (count > 0) await expect(tab(page, "Sesizari")).toContainText(String(count));
  });
});

test.describe("Bloc: avizier", () => {
  const EMAIL = "e2e-avizier@adminbloc.test";

  test.afterEach(async () => { await stergeCont(EMAIL); });

  test("anunturile se marcheaza citite la deschiderea avizierului", async ({ page }) => {
    const ap = await apartamentulNumarul(13);
    const pid = await creeazaCont(EMAIL, "Paul Enache");
    await legaDeApartament(pid, ap.id);
    const { count: anunturi } = await serviciu().schema("comunicare").from("anunturi")
      .select("id", { count: "exact", head: true }).eq("asociatie_id", ASOC);

    await intra(page, EMAIL);
    await expect(tab(page, "Bloc")).toBeVisible({ timeout: 20000 });
    await expect(tab(page, "Bloc")).toContainText(String(anunturi));

    await mergiLaTab(page, "Bloc");
    await expect(page.getByText("Oprire apa rece marti, 22 septembrie")).toBeVisible();
    await expect(page.getByText("Urgent").first()).toBeVisible();

    await expect.poll(async () => {
      const { count } = await serviciu().schema("comunicare").from("anunturi_citiri")
        .select("anunt_id", { count: "exact", head: true }).eq("profil_id", pid);
      return count;
    }, { timeout: 25000 }).toBe(anunturi);
    await expect(tab(page, "Bloc")).toHaveAccessibleName("Bloc");
  });
});

test.describe("Bloc: vot si adunare", () => {
  /* Votul demo, cautat dupa titlu: id-ul se schimba la fiecare reseed */
  let VOT;
  test.beforeAll(async () => { VOT = (await votDupaTitlu("Inlocuirea usii de la intrare")).id; });

  test.afterEach(async () => {
    const ap = await apartamentulNumarul(17);
    await serviciu().schema("guvernanta").from("voturi_exprimate").delete().eq("apartament_id", ap.id);
    await serviciu().schema("guvernanta").from("adunari_prezente").delete().eq("apartament_id", ap.id);
  });

  test("votul cere o confirmare si nu se mai poate schimba", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    await serviciu().schema("guvernanta").from("voturi_exprimate").delete().eq("apartament_id", ap.id);

    await intraCa(page, "elena");
    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Vot si adunare" }).click();
    await expect(page.getByText("Inlocuirea usii de la intrare")).toBeVisible();
    const { data: optiuni } = await serviciu().schema("guvernanta").from("voturi_optiuni")
      .select("id, text").eq("vot_id", VOT).order("ordine");

    await page.getByRole("button", { name: optiuni[0].text }).first().click();
    await expect(page.getByRole("dialog", { name: "Confirma votul" })).toBeVisible();
    await expect(page.getByText("Votul nu se mai poate schimba dupa ce il trimiti.")).toBeVisible();
    await buton(page, "Da, trimite votul").click();
    await asteaptaToast(page, "Votul a fost inregistrat");

    await expect(page.getByText("Apartamentul tau a votat. Rezultatele se actualizeaza pe masura ce voteaza si ceilalti.")).toBeVisible();
    await expect(page.getByText(`${optiuni[0].text} · votul tau`)).toBeVisible();

    const { data } = await serviciu().schema("guvernanta").from("voturi_exprimate")
      .select("optiune_id").eq("vot_id", VOT).eq("apartament_id", ap.id).single();
    expect(data.optiune_id).toBe(optiuni[0].id);
  });

  test("prezenta la adunare se confirma o data", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    await serviciu().schema("guvernanta").from("adunari_prezente").delete().eq("apartament_id", ap.id);

    await intraCa(page, "elena");
    await expect(page.getByText("Confirma prezenta la adunarea generala")).toBeVisible();
    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Vot si adunare" }).click();
    await expect(page.getByText("Adunarea generala din 3 octombrie 2026")).toBeVisible();
    await expect(page.getByText("La parter, langa boxe")).toBeVisible();
    await buton(page, "Confirm ca particip").click();
    await asteaptaToast(page, "Prezenta a fost confirmata");
    await expect(page.getByText("Ai confirmat ca participi")).toBeVisible();

    const { count } = await serviciu().schema("guvernanta").from("adunari_prezente")
      .select("apartament_id", { count: "exact", head: true }).eq("apartament_id", ap.id);
    expect(count).toBe(1);
  });

  test("un al doilea vot pe acelasi apartament este refuzat de backend", async ({ page }) => {
    const ap = await apartamentulNumarul(17);
    const { data: optiuni } = await serviciu().schema("guvernanta").from("voturi_optiuni")
      .select("id").eq("vot_id", VOT).order("ordine");
    await serviciu().schema("guvernanta").from("voturi_exprimate").delete().eq("apartament_id", ap.id);
    await serviciu().schema("guvernanta").from("voturi_exprimate")
      .insert({ vot_id: VOT, apartament_id: ap.id, optiune_id: optiuni[1].id, profil_id: null })
      .then(() => {}, () => {});

    await intraCa(page, "elena");
    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Vot si adunare" }).click();
    await expect(page.getByText("Alege o varianta")).toHaveCount(0);
  });
});

test.describe("Bloc: acte si fonduri", () => {
  test("actele asociatiei se deschid prin URL semnat", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Acte" }).click();
    await expect(page.getByText("Regulamentul asociatiei de proprietari")).toBeVisible();
    await expect(page.getByText("Proces verbal adunare generala, 12 martie 2026")).toBeVisible();

    /* Semnarea se cere la apasare; fisierul se deschide intr-o fila noua, iar
       in headless un PDF nu se randeaza, deci verificam cererea semnata. */
    const raspuns = page.waitForResponse((r) => r.url().includes("/storage/v1/object/sign/documente/"), { timeout: 20000 });
    await page.getByRole("button", { name: "Deschide Regulamentul asociatiei de proprietari" }).click();
    const r = await raspuns;
    expect(r.status()).toBe(200);
    expect((await r.json()).signedURL).toContain("token=");
    await expect(page.locator(".ab-toast")).toHaveCount(0);
  });

  test("fondurile arata soldul, miscarile si situatia fara nume", async ({ page }) => {
    const b = await blocD14();
    const { data: fonduri } = await serviciu().schema("financiar").from("fonduri_solduri")
      .select("tip, sold").eq("bloc_id", b.id);
    const reparatii = fonduri.find((f) => f.tip === "reparatii");

    await intraCa(page, "elena");
    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Fonduri" }).click();
    const t = await textEcran(page);
    expect(t).toContain("FOND DE REPARATII");
    expect(t).toContain("FOND DE RULMENT");
    expect(t).toContain("Unde s-au dus banii");
    expect(t).toContain("Situatia incasarilor");
    expect(t).toContain("Apartamente fara restanta");
    expect(t).toContain(Number(reparatii.sold).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d),)/g, "."));
    expect(t).not.toMatch(/Elena Marinescu|Familia Ilie/);
  });
});
