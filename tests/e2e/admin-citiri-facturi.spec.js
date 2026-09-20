/* Administrator: Citiri contoare si Facturi/liste (harta functiilor §4.2 si §4.3) */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, serviciu, blocD14, apartamentulNumarul,
  asteaptaToast, textEcran, CUVINTE_TEHNICE, fisierPdf,
  listaLunara,
} from "./ajutor.js";

const LUNA = "2026-09-01";
/* Listele se cauta in baza: un `db reset && npm run seed` le schimba id-ul */
let LISTA_CIORNA;
let LISTA_AUGUST;
test.beforeAll(async () => {
  LISTA_CIORNA = (await listaLunara({ stare: "ciorna" })).id;
  LISTA_AUGUST = (await listaLunara({ luna: "2026-08-01" })).id;
});

async function citiri(apartamentId, luna = LUNA) {
  const { data } = await serviciu().schema("contorizare").from("citiri")
    .select("*").eq("apartament_id", apartamentId).eq("luna", luna);
  return data || [];
}

async function readuLaTrimisa(apartamentId, luna = LUNA) {
  await serviciu().schema("contorizare").from("citiri")
    .update({ stare: "trimisa", verificata_de: null, verificata_la: null, motiv_respingere: null })
    .eq("apartament_id", apartamentId).eq("luna", luna);
}

test.describe("Citiri contoare", () => {
  test("KPI-urile si starile citirilor sunt cele din baza", async ({ page }) => {
    const b = await blocD14();
    const { data } = await serviciu().schema("contorizare").from("citiri")
      .select("apartament_id, stare").eq("bloc_id", b.id).eq("luna", LUNA).not("apartament_id", "is", null);
    const deVerificat = new Set(data.filter((c) => c.stare === "trimisa").map((c) => c.apartament_id)).size;

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    await expect(page.getByText("TERMEN DE CITIRE 25 SEPTEMBRIE 2026")).toBeVisible();
    await expect(page.getByText("DE VERIFICAT")).toBeVisible();
    const t = await textEcran(page);
    expect(t).toContain(String(deVerificat));
    expect(t).toContain("Contorul general al blocului");
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("badge-ul de pe tabul Apartamente numara citirile trimise", async ({ page }) => {
    const b = await blocD14();
    const { count } = await serviciu().schema("contorizare").from("citiri")
      .select("id", { count: "exact", head: true }).eq("bloc_id", b.id).eq("stare", "trimisa");
    await intraCa(page, "admin");
    await expect(page.getByRole("tab", { name: `Apartamente ${count}` })).toBeVisible();
  });

  test("indexul contorului general se salveaza si se vede pe ecran", async ({ page }) => {
    const b = await blocD14();
    const { data: contor } = await serviciu().schema("contorizare").from("contoare")
      .select("id, tip").eq("bloc_id", b.id).is("apartament_id", null).eq("tip", "rece").single();
    await serviciu().schema("contorizare").from("citiri").delete().eq("contor_id", contor.id).eq("luna", LUNA);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    const rand = page.getByText(/^Apa rece, index anterior /);
    await expect(rand).toBeVisible();
    const anterior = Number((await rand.innerText()).match(/([\d.]+,\d+)/)[1].replace(".", "").replace(",", "."));

    await page.getByPlaceholder("Index nou").first().fill(String(anterior + 250));
    await expect(page.getByText("Consum 250,00 mc")).toBeVisible();
    await buton(page, "Salveaza").first().click();
    await asteaptaToast(page, "Indexul contorului general a fost salvat");

    const { data } = await serviciu().schema("contorizare").from("citiri")
      .select("index_curent, stare, sursa").eq("contor_id", contor.id).eq("luna", LUNA).single();
    expect(Number(data.index_curent)).toBeCloseTo(anterior + 250, 2);
    expect(data.stare).toBe("validata");

    await serviciu().schema("contorizare").from("citiri").delete().eq("contor_id", contor.id).eq("luna", LUNA);
  });

  test("un index mai mic decat cel anterior este refuzat in formular", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    await page.getByPlaceholder(/Index nou|Corecteaza indexul/).first().fill("1");
    await expect(page.getByText("Indexul nu poate fi mai mic decat cel anterior.").first()).toBeVisible();
    await expect(buton(page, "Salveaza").first()).toHaveAttribute("aria-disabled", "true");
  });

  test("validarea trece ambele contoare ale apartamentului", async ({ page }) => {
    const ap = await apartamentulNumarul(9);
    await readuLaTrimisa(ap.id);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    const card = page.getByText("Ap. 9 · Mircea Olaru").locator("xpath=../..");
    await card.getByRole("button", { name: "Valideaza" }).click();
    await asteaptaToast(page, "Citirea a fost validata");

    await expect.poll(async () => (await citiri(ap.id)).every((c) => c.stare === "validata"), { timeout: 20000 }).toBe(true);
    await readuLaTrimisa(ap.id);
  });

  test("respingerea cere un motiv si il trimite locatarului", async ({ page }) => {
    const ap = await apartamentulNumarul(12);
    await readuLaTrimisa(ap.id);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    const card = page.getByText("Ap. 12 · Ioana Stancu").locator("xpath=../..");
    await card.getByRole("button", { name: "Respinge" }).click();
    const dialog = page.getByRole("dialog", { name: "Respinge citirea, ap. 12" });
    await expect(dialog).toBeVisible();
    await expect(buton(page, "Respinge citirea")).toHaveAttribute("aria-disabled", "true");
    await dialog.getByRole("button", { name: "Poza este neclara, nu se vad cifrele." }).click();
    await buton(page, "Respinge citirea").click();
    await asteaptaToast(page, "Citirea a fost respinsa, locatarul a fost anuntat");

    await expect.poll(async () => {
      const c = await citiri(ap.id);
      return c.every((x) => x.stare === "respinsa" && x.motiv_respingere === "Poza este neclara, nu se vad cifrele.");
    }, { timeout: 20000 }).toBe(true);
    await readuLaTrimisa(ap.id);
  });

  test("poza trimisa de locatar se vede la administrator", async ({ page }) => {
    const b = await blocD14();
    const { data: cuPoza } = await serviciu().schema("contorizare").from("citiri")
      .select("poza_cale").eq("bloc_id", b.id).eq("luna", LUNA).not("poza_cale", "is", null).limit(1);
    expect(cuPoza).toHaveLength(1);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    /* Pozele se deschid prin URL semnat pe bucket-ul privat "poze" */
    const poza = page.locator('img[alt="Poza atasata"]').first();
    await expect(poza).toBeVisible({ timeout: 20000 });
    const src = await poza.getAttribute("src");
    expect(src).toContain("/storage/v1/object/sign/poze/");
    const raspuns = await page.request.get(src);
    expect(raspuns.status()).toBe(200);
  });

  /* Cunoscut din auditul 1 (A6, nereparat): estimarea merge si inainte de
     termen, deci testul ramane oprit ca sa nu strice datele demo. */
  test("[A6] estimarea inainte de termen este refuzata cu un mesaj pe romaneste", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    await expect(page.getByText(/\d+ apartamente nu au transmis indexul/)).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await buton(page, "Estimeaza citirile lipsa").click();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 20000 });
    const mesaj = await page.locator(".ab-toast").innerText();
    expect(mesaj).toMatch(/termen|25/i);
    for (const cuvant of CUVINTE_TEHNICE) expect(mesaj).not.toContain(cuvant);
  });
});

test.describe("Facturi: lista in lucru", () => {
  test.afterEach(async () => {
    const sb = serviciu();
    await sb.schema("intretinere").from("cheltuieli")
      .delete().eq("lista_id", LISTA_CIORNA).like("categorie", "E2E%");
    /* Furnizorii nou creati de test nu raman in nomenclatorul asociatiei */
    const { data } = await sb.schema("intretinere").from("furnizori").select("id").like("denumire", "E2E%");
    for (const f of data || []) {
      const { count } = await sb.schema("intretinere").from("cheltuieli")
        .select("id", { count: "exact", head: true }).eq("furnizor_id", f.id);
      if (!count) await sb.schema("intretinere").from("furnizori").delete().eq("id", f.id);
    }
  });

  test("ciorna spune ca locatarii nu o vad si arata starea citirilor", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await expect(page.getByText("SEPTEMBRIE 2026 · IN LUCRU")).toBeVisible();
    await expect(page.getByText("Lista in lucru, locatarii nu o vad inca")).toBeVisible();
    await expect(page.getByText("Fond de reparatii")).toBeVisible();
    await expect(page.getByText("Fond", { exact: true })).toBeVisible();
    /* Randul fondului nu se modifica si nu se sterge din formularul de factura */
    await expect(buton(page, "Modifica")).toHaveCount(0);
    await expect(buton(page, "Sterge")).toHaveCount(0);
  });

  test("o factura noua se previzualizeaza si se salveaza in ciorna", async ({ page }) => {
    const categorie = `E2E salubritate ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Adauga factura").click();
    const dialog = page.getByRole("dialog", { name: "Factura noua" });
    await dialog.getByLabel("Sau scrie un furnizor nou").fill(`E2E Salubritate ${Date.now()}`);
    await dialog.getByLabel("Ce cheltuiala este").fill(categorie);
    await dialog.getByLabel("Suma facturii").fill("2.000");
    await dialog.getByLabel("Cum se imparte").selectOption("apartamente");
    await dialog.getByLabel("Serie si numar factura").fill("E2E-1");

    /* Previzualizarea ruleaza motorul in browser: 2000 / 20 = 100 lei */
    await expect(dialog.getByText("Cum cade suma pe apartamente")).toBeVisible();
    await expect(dialog.getByText("Ap. 1, 1 apartament")).toBeVisible();
    await expect(dialog.getByText("Total impartit")).toBeVisible();
    await expect(dialog.getByText("2.000,00 lei").first()).toBeVisible();
    await expect(dialog.getByText("Nimic nu se salveaza si locatarii nu vad nimic pana la publicarea listei.")).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles(fisierPdf());
    await buton(page, "Salveaza factura").click();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 20000 });
    expect(await page.locator(".ab-toast").innerText()).toBe("Factura a fost adaugata in lista in lucru");

    const { data } = await serviciu().schema("intretinere").from("cheltuieli")
      .select("cod, suma, metoda, serie_numar, document_id").eq("lista_id", LISTA_CIORNA).eq("categorie", categorie).single();
    expect(Number(data.suma)).toBe(2000);
    expect(data.metoda).toBe("apartamente");
    expect(data.cod).toBe("C10");
    expect(data.document_id).not.toBeNull();
    await expect(page.getByText(categorie)).toBeVisible();
  });

  test("codul dublat este refuzat inainte de salvare", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Adauga factura").click();
    const dialog = page.getByRole("dialog", { name: "Factura noua" });
    await dialog.getByLabel("Sau scrie un furnizor nou").fill(`E2E Dublura ${Date.now()}`);
    await dialog.getByLabel("Ce cheltuiala este").fill("E2E dublura");
    await dialog.getByLabel("Suma facturii").fill("100");
    await dialog.getByLabel("Cod pe lista").fill("C9");
    await expect(dialog.getByText("Codul exista deja")).toBeVisible();
    await expect(buton(page, "Salveaza factura")).toHaveAttribute("aria-disabled", "true");
  });

  test("o factura din ciorna se modifica si se sterge", async ({ page }) => {
    const categorie = `E2E de sters ${Date.now()}`;
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Adauga factura").click();
    let dialog = page.getByRole("dialog", { name: "Factura noua" });
    await dialog.getByLabel("Sau scrie un furnizor nou").fill(`E2E Furnizor ${Date.now()}`);
    await dialog.getByLabel("Ce cheltuiala este").fill(categorie);
    await dialog.getByLabel("Suma facturii").fill("300");
    await buton(page, "Salveaza factura").click();
    await asteaptaToast(page, "Factura a fost adaugata");

    await buton(page, "Modifica").click();
    dialog = page.getByRole("dialog", { name: "Modifica factura" });
    await expect(dialog.getByLabel("Ce cheltuiala este")).toHaveValue(categorie);
    await dialog.getByLabel("Suma facturii").fill("350");
    await buton(page, "Salveaza factura").click();
    await asteaptaToast(page, "Factura a fost modificata");
    const { data } = await serviciu().schema("intretinere").from("cheltuieli")
      .select("suma").eq("lista_id", LISTA_CIORNA).eq("categorie", categorie).single();
    expect(Number(data.suma)).toBe(350);

    page.once("dialog", (d) => d.accept());
    await buton(page, "Sterge").click();
    await asteaptaToast(page, "Cheltuiala a fost stearsa");
    await expect(page.getByText(categorie)).toHaveCount(0);
    const { count } = await serviciu().schema("intretinere").from("cheltuieli")
      .select("id", { count: "exact", head: true }).eq("lista_id", LISTA_CIORNA).eq("categorie", categorie);
    expect(count).toBe(0);
  });

  test("previzualizarea listei calculeaza totalul pe apartamente", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Calculeaza lista pe apartamente").click();
    await expect(page.getByText("Total repartizat")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Total facturi")).toBeVisible();
    const t = await textEcran(page);
    expect(t).toMatch(/Ap\. 1, Gheorghe Voicu/);
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("confirmarea publicarii spune termenul si se poate anula", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Publica lista").click();
    const dialog = page.getByRole("dialog", { name: "Publica lista" });
    await expect(dialog).toContainText("Publici lista pe septembrie 2026");
    await expect(dialog).toContainText("Termenul de plata va fi 25 octombrie 2026");
    await expect(dialog).toContainText("Dupa publicare, facturile listei nu se mai pot modifica.");
    await buton(page, "Inapoi").click();
    await expect(dialog).toHaveCount(0);

    /* Lista ramane ciorna: testul nu publica nimic */
    const { data } = await serviciu().schema("intretinere").from("liste_lunare")
      .select("stare").eq("id", LISTA_CIORNA).single();
    expect(data.stare).toBe("ciorna");
  });
});

test.describe("Facturi: lista publicata", () => {
  test("lista publicata nu lasa nimic nealocat", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await page.getByRole("button", { name: "aug 26" }).click();
    await expect(page.getByText("AUGUST 2026 · PUBLICATA")).toBeVisible();
    await expect(page.getByText("Total facturi si fonduri")).toBeVisible();
    await expect(page.getByText("Nealocat")).toBeVisible();
    const t = await textEcran(page);
    expect(t).toMatch(/Nealocat\s*0,00 lei/);
    await expect(buton(page, "Adauga factura")).toHaveCount(0);
    await expect(buton(page, "Sterge")).toHaveCount(0);
    await expect(buton(page, "Modifica")).toHaveCount(0);
  });

  test("plata catre furnizor se marcheaza si se anuleaza", async ({ page }) => {
    await serviciu().schema("intretinere").from("cheltuieli")
      .update({ achitata_furnizor_la: null }).eq("lista_id", LISTA_AUGUST).eq("cod", "C8");
    const { data: inainte } = await serviciu().schema("intretinere").from("cheltuieli")
      .select("id, categorie, achitata_furnizor_la").eq("lista_id", LISTA_AUGUST).eq("cod", "C8").single();
    expect(inainte.achitata_furnizor_la).toBeNull();

    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await page.getByRole("button", { name: "aug 26" }).click();
    const rand = page.getByText("Deratizare si dezinsectie").locator("xpath=../../../..");
    await rand.getByRole("button", { name: "Marcheaza platita" }).click();
    await asteaptaToast(page, "Factura marcata ca platita furnizorului");
    await expect(rand.getByText(/^Platita furnizorului /)).toBeVisible();

    const { data: dupa } = await serviciu().schema("intretinere").from("cheltuieli")
      .select("achitata_furnizor_la").eq("id", inainte.id).single();
    expect(dupa.achitata_furnizor_la).not.toBeNull();

    page.once("dialog", (d) => d.accept());
    await rand.getByRole("button", { name: "Anuleaza plata furnizor" }).click();
    await asteaptaToast(page, "Plata catre furnizor a fost anulata");
    const { data: final } = await serviciu().schema("intretinere").from("cheltuieli")
      .select("achitata_furnizor_la").eq("id", inainte.id).single();
    expect(final.achitata_furnizor_la).toBeNull();
  });

  test("exportul pentru avizier da un PDF cu toate apartamentele", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await page.getByRole("button", { name: "aug 26" }).click();
    const descarcare = page.waitForEvent("download");
    await buton(page, "Exporta PDF pentru avizier").click();
    const f = await descarcare;
    expect(f.suggestedFilename()).toBe("lista-plata-2026-08.pdf");
    const flux = await f.createReadStream();
    const bucati = [];
    for await (const b of flux) bucati.push(b);
    const pdf = Buffer.concat(bucati).toString("latin1");
    expect(pdf.slice(0, 5)).toBe("%PDF-");
    expect(pdf).toContain("Lista de plata pe august 2026");
  });

  test("factura scanata a unei cheltuieli publicate se deschide", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await page.getByRole("button", { name: "aug 26" }).click();
    const raspuns = page.waitForResponse((r) => r.url().includes("/storage/v1/object/sign/documente/"), { timeout: 20000 });
    await buton(page, "Vezi factura").first().click();
    expect((await raspuns).status()).toBe(200);
  });
});
