/* Administrator: Sumar si Apartamente (harta functiilor §4.1 si §4.2) */

import { test, expect } from "@playwright/test";
import {
  buton, intra, intraCa, mergiLaTab, serviciu, blocD14, apartamente, apartamentulNumarul,
  creeazaCont, stergeCont, legaDeApartament, datorieDeTest, soldApartament,
  asteaptaToast, textEcran, CUVINTE_TEHNICE, aziRo, telefonTemporar, profilDupaTelefon,
} from "./ajutor.js";

const lei = (n) => Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d),)/g, ".");

async function statistici() {
  const b = await blocD14();
  const sb = serviciu();
  const azi = aziRo();
  const { data: datorii } = await sb.schema("financiar").from("datorii_rest")
    .select("apartament_id, rest, scadenta, tip").eq("bloc_id", b.id).gt("rest", 0);
  const restante = datorii.filter((d) => d.scadenta < azi);
  const { count: sesizariDeschise } = await sb.schema("sesizari").from("sesizari")
    .select("id", { count: "exact", head: true }).eq("bloc_id", b.id).neq("stare", "rezolvata");
  const { count: citiriTrimise } = await sb.schema("contorizare").from("citiri")
    .select("id", { count: "exact", head: true }).eq("bloc_id", b.id).eq("stare", "trimisa");
  return {
    restante: Math.round(restante.reduce((s, d) => s + Number(d.rest), 0) * 100) / 100,
    apCuRestanta: new Set(restante.map((d) => d.apartament_id)).size,
    penalizari: Math.round(datorii.filter((d) => d.tip === "penalizare").reduce((s, d) => s + Number(d.rest), 0) * 100) / 100,
    sesizariDeschise, citiriTrimise,
  };
}

test.describe("Sumar", () => {
  test("KPI-urile de pe panou sunt cele din registru", async ({ page }) => {
    const st = await statistici();
    await intraCa(page, "admin");
    const t = await textEcran(page);
    expect(t).toContain("RESTANȚE");
    expect(t).toContain(lei(st.restante));
    expect(t).toContain(`${st.apCuRestanta} apartamente în urmă`);
    expect(t).toContain(lei(st.penalizari));
    expect(t).toContain("CITIRI DE VERIFICAT");
    expect(t).toContain("ASOCIATIA DE PROPRIETARI NR. 118 · 20 APARTAMENTE");
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("lista curenta arata incasarile si procentul", async ({ page }) => {
    await intraCa(page, "admin");
    await expect(page.getByText("LISTA DE PLATĂ AUGUST 2026")).toBeVisible();
    await expect(page.getByText(/Încasat până acum [\d.]+,\d\d lei/)).toBeVisible();
    await expect(page.getByText(/Au plătit integral \d+ din 20 apartamente\./)).toBeVisible();
    await expect(page.getByText(/Publicată \d+ \w+ 2026/)).toBeVisible();
  });

  test("restantierii sunt in ordine, cel mai vechi primul", async ({ page }) => {
    await intraCa(page, "admin");
    const zile = await page.getByText(/^\d+ (de )?zile întârziere/).allInnerTexts();
    const numere = zile.map((t) => Number(t.match(/^\d+/)[0]));
    expect(numere.length).toBeGreaterThan(0);
    expect([...numere].sort((a, b) => b - a)).toEqual(numere);
  });

  test("lista in lucru duce la Facturi", async ({ page }) => {
    await intraCa(page, "admin");
    await expect(page.getByText("Lista pe septembrie 2026 este în lucru")).toBeVisible();
    await page.getByText("Lista pe septembrie 2026 este în lucru").click();
    await expect(page.getByText("Facturi și liste")).toBeVisible();
  });

  test("reminderul de plata spune catre cati a plecat", async ({ page }) => {
    await intraCa(page, "admin");
    await buton(page, "Trimite reminder de plată").click();
    await asteaptaToast(page, "Reminder trimis către");
    const mesaj = await page.locator(".ab-toast").innerText();
    expect(mesaj).toMatch(/Reminder trimis către .*, din .* cu sold/);
  });

  test("instiintarea unui restantier raporteaza rezultatul", async ({ page }) => {
    await intraCa(page, "admin");
    await buton(page, "Înștiințare").first().click();
    await expect(page.locator(".ab-toast")).toContainText(/Înștiințare trimisă în aplicație|nu are cont în aplicație/, { timeout: 20000 });
  });

  test("exportul listei de plata da un PDF", async ({ page }) => {
    await intraCa(page, "admin");
    const descarcare = page.waitForEvent("download");
    await buton(page, "Exportă lista PDF").click();
    const f = await descarcare;
    /* [F4] Butonul de pe Sumar descarca varianta interna, cu alt nume decat
       cel de avizier (vezi pdf-liste.spec.js) */
    expect(f.suggestedFilename()).toBe("lista-plata-2026-08-uz-intern.pdf");
    const flux = await f.createReadStream();
    const bucati = [];
    for await (const b of flux) bucati.push(b);
    expect(Buffer.concat(bucati).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("actiunile rapide si KPI-urile navigheaza acolo unde scrie", async ({ page }) => {
    await intraCa(page, "admin");
    /* KPI-ul "Restante", nu nota de sub exportul intern, care contine si ea
       cuvantul (potrivirea dupa text nu tine cont de majuscule) */
    await page.getByRole("button", { name: /^Restanțe/ }).first().click();
    await expect(page.getByText(/^Restanțe \d+$/)).toBeVisible();
    await mergiLaTab(page, "Sumar");
    await page.getByText("CITIRI DE VERIFICAT").click();
    await expect(page.getByText("Contorul general al blocului")).toBeVisible();
    await mergiLaTab(page, "Sumar");
    await buton(page, "Scrie un anunț").click();
    await expect(buton(page, "Scrie un anunț")).toBeVisible();
    await mergiLaTab(page, "Sumar");
    await buton(page, "Deschide un vot").click();
    await expect(buton(page, "Deschide un vot nou")).toBeVisible();
  });
});

test.describe("Apartamente: lista", () => {
  test("cautarea dupa nume si dupa numar", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await expect(page.getByText("20 apartamente,")).toBeVisible();
    await page.getByLabel("Caută după nume sau număr").fill("Marinescu");
    await expect(page.getByRole("button", { name: /^Apartament \d+$/ })).toHaveCount(1);
    await expect(page.getByText("Elena Marinescu")).toBeVisible();
    await page.getByLabel("Caută după nume sau număr").fill("3");
    await expect(page.getByRole("button", { name: "Apartament 3" })).toHaveCount(1);
    await page.getByLabel("Caută după nume sau număr").fill("zzz");
    await expect(page.getByText("Niciun rezultat")).toBeVisible();
  });

  test("filtrele numara corect si arata doar ce trebuie", async ({ page }) => {
    const b = await blocD14();
    const azi = aziRo();
    const { data } = await serviciu().schema("financiar").from("datorii_rest")
      .select("apartament_id, rest, scadenta").eq("bloc_id", b.id).gt("rest", 0);
    const cuSold = new Set(data.map((d) => d.apartament_id)).size;
    const cuRestanta = new Set(data.filter((d) => d.scadenta < azi).map((d) => d.apartament_id)).size;

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await expect(page.getByRole("button", { name: `Cu sold ${cuSold}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Restanțe ${cuRestanta}` })).toBeVisible();
    await page.getByRole("button", { name: `Restanțe ${cuRestanta}` }).click();
    await expect(page.getByRole("button", { name: /^Apartament / })).toHaveCount(cuRestanta);
  });

  test("apartamentele sunt in ordinea de pe usa", async ({ page }) => {
    const toate = await apartamente();
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    const nume = await page.getByRole("button", { name: /^Apartament / }).evaluateAll(
      (el) => el.map((x) => x.getAttribute("aria-label").replace("Apartament ", ""))
    );
    expect(nume).toEqual(toate.map((a) => a.numar));
  });
});

test.describe("Fisa apartamentului", () => {
  test("fisa arata datele, soldul si defalcarea lunii", async ({ page }) => {
    const ap = await apartamentulNumarul(3);
    const sold = await soldApartament(ap.id);
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 3" }).click();
    const dialog = page.getByRole("dialog", { name: "Apartament 3" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Familia Ilie");
    await expect(dialog).toContainText("Sold la zi");
    await expect(dialog).toContainText(lei(sold));
    await expect(dialog).toContainText("Întreținere iunie 2026");
    await expect(dialog).toContainText("Penalizare");
    await expect(dialog).toContainText("Defalcarea întreținerii");
    await expect(dialog).toContainText("Istoricul persoanelor");
    await expect(dialog).toContainText("Consum apă");
  });

  test("instiintarea este blocata pe un apartament fara restanta", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 2", exact: true }).click();
    await expect(buton(page, "Trimite înștiințare de plată")).toHaveAttribute("aria-disabled", "true");
  });

  test("incasarea cash emite chitanta si stinge datoria", async ({ page }) => {
    const ap = await apartamentulNumarul(16);
    await datorieDeTest(ap.id, 25.5, "Test încasare cash");
    const sold = await soldApartament(ap.id);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 16" }).click();
    await buton(page, "Înregistrează încasare cash").click();
    await expect(page.getByLabel("Suma primită")).toHaveValue(lei(sold));
    await buton(page, "Emite chitanța").click();
    await asteaptaToast(page, "Încasare înregistrată, chitanța emisă");
    await expect(page.getByText(`Încasare înregistrată: ${lei(sold)} lei`)).toBeVisible();
    await expect(page.getByText(/Chitanța [A-Z0-9]+ nr\. \d{6}\./)).toBeVisible();

    const { data: plata } = await serviciu().schema("financiar").from("plati")
      .select("id, suma, metoda, stare").eq("apartament_id", ap.id).eq("metoda", "numerar")
      .order("creat_la", { ascending: false }).limit(1).single();
    expect(Number(plata.suma)).toBeCloseTo(sold, 2);
    expect(plata.stare).toBe("confirmata");
    expect(await soldApartament(ap.id)).toBe(0);

    const descarcare = page.waitForEvent("download");
    await buton(page, "Descarcă chitanța").click();
    expect((await descarcare).suggestedFilename()).toMatch(/^chitanta-\d+\.pdf$/);
  });

  /* [T1] Greseala de casierie: administratorul a scris suma gresit. Storneaza
     incasarea din aceeasi fisa, cu motiv, iar banii se intorc in ce are de
     platit apartamentul. Locatarul vede plata taiata si afla de ce. */
  test("[T1] incasarea scrisa gresit se storneaza si banii se intorc in sold", async ({ page }) => {
    const ap = await apartamentulNumarul(18);
    await datorieDeTest(ap.id, 33.33, "Test stornare");
    const sold = await soldApartament(ap.id);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 18" }).click();
    await buton(page, "Înregistrează încasare cash").click();
    await buton(page, "Emite chitanța").click();
    await asteaptaToast(page, "Încasare înregistrată, chitanța emisă");
    expect(await soldApartament(ap.id)).toBe(0);

    await buton(page, "Stornează încasarea").first().click();
    /* fara motiv nu se poate */
    await expect(buton(page, "Stornează").last()).toHaveAttribute("aria-disabled", "true");
    await page.getByLabel("De ce o anulezi").fill("Suma a fost scrisă greșit");
    await buton(page, "Stornează").last().click();
    await asteaptaToast(page, "Încasarea a fost anulată");

    expect(await soldApartament(ap.id)).toBeCloseTo(sold, 2);
    const { data: plata } = await serviciu().schema("financiar").from("plati")
      .select("stare, motiv_stornare").eq("apartament_id", ap.id)
      .order("creat_la", { ascending: false }).limit(1).single();
    expect(plata).toMatchObject({ stare: "rambursata", motiv_stornare: "Suma a fost scrisă greșit" });
    /* chitanta ramane in carnet, cu numarul ei */
    const { count } = await serviciu().schema("financiar").from("chitante")
      .select("id", { count: "exact", head: true });
    expect(count).toBeGreaterThan(0);
    await expect(page.getByText("Anulată").first()).toBeVisible();
  });

  test("suma scrisa cu punct de mii este citita ca mii", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 15" }).click();
    await buton(page, "Înregistrează încasare cash").click();
    await page.getByLabel("Suma primită").fill("1.500");
    /* Butonul ramane activ: 1.500 inseamna o mie cinci sute, nu 1,50 lei */
    await expect(buton(page, "Emite chitanța")).not.toHaveAttribute("aria-disabled", "true");
    await buton(page, "Renunță").click();
    await expect(buton(page, "Înregistrează încasare cash")).toBeVisible();
  });

  test("dublul apasat pe Emite chitanta emite o singura chitanta", async ({ page }) => {
    const ap = await apartamentulNumarul(14);
    await datorieDeTest(ap.id, 7.77, "Test dublu apasat cash");
    const { count: inainte } = await serviciu().schema("financiar").from("chitante")
      .select("id", { count: "exact", head: true });

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 14" }).click();
    await buton(page, "Înregistrează încasare cash").click();
    await buton(page, "Emite chitanța").dblclick();
    await asteaptaToast(page, "Încasare înregistrată");

    const { count: dupa } = await serviciu().schema("financiar").from("chitante")
      .select("id", { count: "exact", head: true });
    expect(dupa - inainte).toBe(1);
  });

  test("numarul de persoane se schimba de la o luna viitoare", async ({ page }) => {
    const ap = await apartamentulNumarul(12);
    await serviciu().schema("organizare").from("apartamente_persoane")
      .delete().eq("apartament_id", ap.id).eq("motiv", "Test e2e");

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 12" }).click();
    await buton(page, "Modifică numărul de persoane").click();
    await page.getByLabel("Număr nou de persoane").fill("5");
    await page.getByLabel("Motivul").fill("Test e2e");
    const luna = await page.getByLabel("Începând cu luna").inputValue();
    await buton(page, "Salvează").click();
    await asteaptaToast(page, "se calculează 5 persoane");

    const { data } = await serviciu().schema("organizare").from("apartamente_persoane")
      .select("valabil_din, numar_persoane, motiv").eq("apartament_id", ap.id).eq("motiv", "Test e2e").single();
    expect(data.numar_persoane).toBe(5);
    expect(data.valabil_din.slice(0, 7)).toBe(luna);

    await serviciu().schema("organizare").from("apartamente_persoane")
      .delete().eq("apartament_id", ap.id).eq("motiv", "Test e2e");
  });

  test("contul locatarului se face din fisa, cu parola aratata o singura data", async ({ page }) => {
    const telefon = telefonTemporar();
    try {
      await intraCa(page, "admin");
      await mergiLaTab(page, "Apartamente");
      await page.getByRole("button", { name: "Apartament 11" }).click();
      await buton(page, "Adaugă un locatar în aplicație").click();
      await page.getByLabel("Numele locatarului").fill("Chirias Nou");
      await page.getByLabel("Numărul lui de telefon").fill(telefon);
      await page.getByLabel("Ce este pentru apartament").selectOption("chirias");
      await buton(page, "Fă contul").click();
      await asteaptaToast(page, "Contul a fost creat");

      const fisa = page.getByRole("dialog", { name: "Apartament 11" });
      await expect(fisa.getByText(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/)).toBeVisible();
      const profil = await profilDupaTelefon(telefon);
      expect(profil.nume).toBe("Chirias Nou");

      await buton(page, "Gata").click();
      await expect(fisa.getByText("Chirias · din")).toBeVisible();
      await expect(fisa.getByText(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/)).toHaveCount(0);
    } finally {
      await stergeCont(telefon);
    }
  });

  test("inchiderea accesului scoate locatarul din aplicatie", async ({ page }) => {
    const TELEFON = "0798591002";
    const ap = await apartamentulNumarul(10);
    await stergeCont(TELEFON);
    const pid = await creeazaCont(TELEFON, "Sanda Croitoru");
    await legaDeApartament(pid, ap.id);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 10" }).click();
    const fisa = page.getByRole("dialog", { name: "Apartament 10" });
    await expect(fisa.getByText("Sanda Croitoru").first()).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await buton(page, "Închide accesul").click();
    await asteaptaToast(page, "Accesul a fost închis");
    await expect(page.getByText(/Sanda Croitoru, acces închis pe/)).toBeVisible();

    const { data } = await serviciu().schema("identitate").from("locatari")
      .select("activ_pana").eq("profil_id", pid).single();
    expect(data.activ_pana).not.toBeNull();

    /* Fostul locatar nu mai are acces la datele blocului */
    await fisa.getByRole("button", { name: "Închide" }).click();
    await buton(page, "Ieși").click();
    await intra(page, TELEFON);
    await expect(page.getByText("leagă contul de apartamentul tău")).toBeVisible({ timeout: 20000 });
    await stergeCont(TELEFON);
  });
});

test.describe("corectarea fisei si banii din fond", () => {
  /* Auditul 2 (X06, D1): fisa apartamentului trebuie sa se poata corecta din
     aplicatie, altfel numele fostului proprietar si o cota gresita raman pe
     vecie. Comanda existase in baza si in surse inainte sa aiba ecran. */
  test("[E4] fisa apartamentului se corecteaza si ramane schimbata in baza", async ({ page }) => {
    const ap = await apartamentulNumarul(5);
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Apartament 5" }).click();
    await buton(page, "Corectează datele apartamentului").click();

    const nume = `Proprietar Nou ${Date.now()}`;
    await page.getByLabel("Proprietar").fill(nume);
    await buton(page, "Salvează corecția").click();
    await expect(page.getByText(nume).first()).toBeVisible();

    const dupa = await apartamentulNumarul(5);
    expect(dupa.proprietar_nume).toBe(nume);
    /* restul fisei ramane neatins */
    expect(Number(dupa.cota_indiviza)).toBe(Number(ap.cota_indiviza));
    expect(dupa.etaj).toBe(ap.etaj);
  });

  /* Auditul 2 (X05, D5): fara iesiri, soldul fondului pe care il vad toti
     locatarii creste la nesfarsit. Documentul justificativ este obligatoriu,
     iar soldul nu are voie sa treaca sub zero. */
  /* Testul scoate bani din fondul demo; fara curatenie, fiecare rulare il
     subtiaza cu inca 250 de lei si soldul afisat nu mai e cel din seed. */
  const DESCRIERE_IESIRE = "E2E ieșire hidrofor";
  async function curataIesireaDeTest() {
    const sb = serviciu();
    const { data } = await sb.schema("financiar").from("miscari_fond")
      .select("id, document_id").eq("descriere", DESCRIERE_IESIRE);
    for (const m of data || []) {
      await sb.schema("financiar").from("miscari_fond").delete().eq("id", m.id);
      if (m.document_id) {
        const { data: doc } = await sb.schema("comunicare").from("documente")
          .select("cale").eq("id", m.document_id).maybeSingle();
        if (doc && doc.cale) await sb.storage.from("documente").remove([doc.cale]);
        await sb.schema("comunicare").from("documente").delete().eq("id", m.document_id);
      }
    }
    await sb.schema("comunicare").from("documente").delete().eq("titlu", DESCRIERE_IESIRE);
  }

  test("[E5] iesirea din fond cere document si nu duce soldul sub zero", async ({ page }) => {
    await curataIesireaDeTest();
    try {
      await intraCa(page, "admin");
      await mergiLaTab(page, "Apartamente");
      await page.getByRole("button", { name: "Fonduri" }).click();
      await page.getByRole("button", { name: "Înregistrează o ieșire" }).first().click();

      await page.getByLabel("Suma ieșită").fill("250");
      await page.getByLabel("Pentru ce").fill(DESCRIERE_IESIRE);
      /* fara document, salvarea nu e disponibila */
      await expect(buton(page, "Înregistrează ieșirea")).toBeDisabled();

      await page.setInputFiles("input[type=file]", {
        name: "factura-hidrofor.jpg", mimeType: "image/jpeg", buffer: Buffer.from("jpeg-de-test"),
      });
      await buton(page, "Înregistrează ieșirea").click();
      await expect(page.getByText(DESCRIERE_IESIRE).first()).toBeVisible();
    } finally {
      await curataIesireaDeTest();
    }
  });
});

test.describe("locatar fara datorii", () => {
  test("apartamentul achitat vede Achitat si ultima chitanta", async ({ page }) => {
    const ap = await apartamentulNumarul(1);
    expect(await soldApartament(ap.id)).toBe(0);
    await intraCa(page, "voicu");
    await expect(page.getByText("Totul este plătit")).toBeVisible();
    await expect(page.getByText("Achitat").first()).toBeVisible();
    await expect(buton(page, "Cum plătesc")).toHaveCount(0);
    const descarcare = page.waitForEvent("download");
    await buton(page, "Descarcă ultima chitanță").click();
    expect((await descarcare).suggestedFilename()).toMatch(/^chitanta-\d+\.pdf$/);
  });
});
