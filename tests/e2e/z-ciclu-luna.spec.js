/* O luna intreaga, de la inceput la sfarsit, asa cum o face un administrator
   adevarat: facturile lunii pe fiecare metoda de repartizare, citirile
   contoarelor (validare, estimare, contorul general), previzualizarea,
   publicarea, apoi ce vede fiecare locatar, plata cu cardul si cu numerar,
   penalizarile si o corectie dupa publicare.

   Testul PUBLICA lista pe septembrie a blocului demo, deci strica datele
   demonstrative. De aceea:
     - ruleaza o singura data, pe proiectul "telefon";
     - la final readuce baza la starea initiala (`supabase db reset && npm run
       seed`), ca restul suitei si aplicatia sa ramana folosibile.
   Fisierul se numeste cu "z-" ca sa ruleze ultimul in proiectul lui. */

import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import {
  buton, intraCa, mergiLaTab, serviciu, blocD14, apartamente, apartamentulNumarul,
  asteaptaToast, textEcran, CUVINTE_TEHNICE, listaLunara, soldApartament, profilDupaEmail,
  CONTURI, uitaCache, URL_SUPABASE, CHEIE_SERVICIU,
} from "./ajutor.js";

const LUNA = "2026-09-01";
const lei = (n) => Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d),)/g, ".");
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* Facturile lunii, una pe fiecare metoda de repartizare */
const FACTURI = [
  { categorie: "E2E apa rece", metoda: "consum", tipApa: "rece", suma: "3.200" },
  { categorie: "E2E salubritate", metoda: "persoane", suma: "900" },
  { categorie: "E2E lift", metoda: "persoane_fara_lift", suma: "700" },
  { categorie: "E2E deratizare", metoda: "apartamente", suma: "400" },
  { categorie: "E2E administrare", metoda: "cota", suma: "1.000" },
];

let BLOC;
let LISTA;
let APARTAMENTE;

test.describe("ciclul unei luni, cap-coada", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ browserName }, testInfo) => {
    void browserName;
    /* Ciclul strica si reface datele demo: se parcurge o singura data */
    test.skip(testInfo.project.name !== "telefon", "ruleaza doar pe proiectul telefon");
    BLOC = await blocD14();
    LISTA = await listaLunara({ stare: "ciorna" });
    APARTAMENTE = await apartamente();
    expect(LISTA.luna).toBe(LUNA);
    /* Termenul de citire trece inaintea zilei de azi, ca estimarea sa fie
       permisa: altfel "Estimeaza citirile lipsa" este refuzata pe buna
       dreptate (A6) si ciclul nu se poate parcurge azi. */
    await serviciu().schema("contorizare").from("setari_contorizare")
      .update({ zi_limita_citire: 15 }).eq("bloc_id", BLOC.id);
  });

  test.afterAll(async ({ browserName }, testInfo) => {
    void browserName;
    if (testInfo.project.name !== "telefon") return;
    /* Datele demo, exact ca la inceput */
    execSync("supabase db reset && npm run seed", {
      cwd: process.cwd(), stdio: "pipe", timeout: 600000,
    });
    uitaCache();
  });

  test("1. facturile lunii, cate una pe fiecare metoda de repartizare", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await expect(page.getByText("SEPTEMBRIE 2026 · IN LUCRU")).toBeVisible();

    for (const [i, f] of FACTURI.entries()) {
      await buton(page, "Adauga factura").click();
      const panou = page.getByRole("dialog", { name: "Factura noua" });
      await panou.getByLabel("Sau scrie un furnizor nou").fill(`E2E Furnizorul ${i + 1}`);
      await panou.getByLabel("Ce cheltuiala este").fill(f.categorie);
      await panou.getByLabel("Suma facturii").fill(f.suma);
      await panou.getByLabel("Cum se imparte").selectOption(f.metoda);
      if (f.tipApa) await panou.getByRole("button", { name: "Apa rece" }).click();
      await panou.getByLabel("Serie si numar factura").fill(`E2E-${f.metoda}`);
      await buton(page, "Salveaza factura").click();
      /* Panoul se inchide si randul apare in lista: abia atunci urmatoarea
         factura poate fi inceputa (un toast inca vizibil de la factura
         dinainte nu este dovada ca aceasta s-a salvat). */
      await expect(panou).toBeHidden({ timeout: 20000 });
      await expect(page.getByText(f.categorie, { exact: true })).toBeVisible({ timeout: 20000 });
    }

    const { data } = await serviciu().schema("intretinere").from("cheltuieli")
      .select("cod, categorie, metoda, tip_apa, suma").eq("lista_id", LISTA.id);
    expect(data).toHaveLength(FACTURI.length + 1); /* + randul fondului */
    for (const f of FACTURI) {
      const c = data.find((x) => x.categorie === f.categorie);
      expect(c, `factura ${f.categorie}`).toBeTruthy();
      expect(c.metoda).toBe(f.metoda);
      expect(Number(c.suma)).toBe(Number(f.suma.replace(".", "")));
    }
    /* Fondul de reparatii, pe cota, era deja acolo */
    expect(data.some((x) => x.metoda === "cota" && x.categorie === "Fond de reparatii")).toBe(true);
  });

  test("2. validarea citirilor este totul sau nimic, pe fiecare apartament", async ({ page }) => {
    const sb = serviciu();
    const { data: trimise } = await sb.schema("contorizare").from("citiri")
      .select("apartament_id").eq("bloc_id", BLOC.id).eq("luna", LUNA).eq("stare", "trimisa");
    const deValidat = [...new Set(trimise.map((c) => c.apartament_id))];
    expect(deValidat.length).toBeGreaterThan(0);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();

    for (const apId of deValidat) {
      const ap = APARTAMENTE.find((a) => a.id === apId);
      const card = page.getByText(`Ap. ${ap.numar} · ${ap.proprietar_nume}`).locator("xpath=../..");
      await card.getByRole("button", { name: "Valideaza" }).click();
      /* Toate contoarele apartamentului se schimba deodata, intr-o singura
         comanda: niciunul nu ramane "trimisa" */
      await expect.poll(async () => {
        const { data } = await sb.schema("contorizare").from("citiri")
          .select("stare").eq("apartament_id", apId).eq("luna", LUNA);
        return data.map((c) => c.stare).sort().join(",");
      }, { timeout: 20000 }).not.toContain("trimisa");
    }

    const { count } = await sb.schema("contorizare").from("citiri")
      .select("id", { count: "exact", head: true }).eq("bloc_id", BLOC.id).eq("luna", LUNA).eq("stare", "trimisa");
    expect(count).toBe(0);
  });

  test("3. citirile lipsa se estimeaza dupa termen", async ({ page }) => {
    const sb = serviciu();
    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();
    await expect(page.getByText("TERMEN DE CITIRE 15 SEPTEMBRIE 2026")).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await buton(page, "Estimeaza citirile lipsa").click();
    await asteaptaToast(page, "Au fost estimate");

    /* Fiecare contor activ are acum o citire validata pe luna */
    const { data: contoare } = await sb.schema("contorizare").from("contoare")
      .select("id, apartament_id").eq("bloc_id", BLOC.id).is("scos_la", null).not("apartament_id", "is", null);
    const { data: citiri } = await sb.schema("contorizare").from("citiri")
      .select("contor_id, stare, sursa").eq("bloc_id", BLOC.id).eq("luna", LUNA);
    for (const c of contoare) {
      const ale = citiri.filter((x) => x.contor_id === c.id && x.stare === "validata");
      expect(ale.length, `contorul ${c.id} are o citire validata`).toBeGreaterThan(0);
    }
    expect(citiri.some((c) => c.sursa === "estimat")).toBe(true);
  });

  test("4. contorul general al blocului se citeste din ecran", async ({ page }) => {
    const sb = serviciu();
    /* Contorul general nu poate arata mai putin decat suma apartamentelor */
    const { data: citiri } = await sb.schema("contorizare").from("citiri")
      .select("tip, consum, apartament_id, stare").eq("bloc_id", BLOC.id).eq("luna", LUNA).eq("stare", "validata");
    const sumaPe = (tip) => round2(citiri
      .filter((c) => c.tip === tip && c.apartament_id)
      .reduce((s, c) => s + Number(c.consum), 0));

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: "Citiri contoare" }).click();

    /* Ordinea celor doua contoare generale pe ecran vine din date, nu din test */
    const randuri = page.getByText(/^Apa (rece|calda), index anterior /);
    await expect(randuri).toHaveCount(2);
    const texte = await randuri.allInnerTexts();

    for (const tip of ["rece", "calda"]) {
      const eticheta = tip === "rece" ? "Apa rece" : "Apa calda";
      const i = texte.findIndex((x) => x.startsWith(eticheta));
      expect(i, `randul contorului general de apa ${tip}`).toBeGreaterThanOrEqual(0);
      const anterior = Number(texte[i].match(/([\d.]+,\d+)/)[1].replace(/\./g, "").replace(",", "."));
      const consumBloc = round2(sumaPe(tip) + 18);
      await page.getByPlaceholder(/Index nou|Corecteaza indexul/).nth(i).fill(String(round2(anterior + consumBloc)));
      await buton(page, "Salveaza").nth(i).click();
      await expect.poll(async () => {
        const { data } = await sb.schema("contorizare").from("citiri")
          .select("consum").eq("bloc_id", BLOC.id).eq("luna", LUNA).is("apartament_id", null).eq("tip", tip);
        return data.length ? round2(Number(data[0].consum)) : null;
      }, { timeout: 20000 }).toBe(consumBloc);
    }

    const { data: gen } = await sb.schema("contorizare").from("citiri")
      .select("tip, consum, stare").eq("bloc_id", BLOC.id).eq("luna", LUNA).is("apartament_id", null);
    expect(gen).toHaveLength(2);
    for (const g of gen) {
      expect(g.stare).toBe("validata");
      expect(Number(g.consum)).toBeGreaterThan(sumaPe(g.tip));
    }
  });

  test("5. previzualizarea imparte exact totalul facturilor", async ({ page }) => {
    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Calculeaza lista pe apartamente").click();
    await expect(page.getByText("Total repartizat")).toBeVisible({ timeout: 20000 });

    const t = await textEcran(page);
    expect(t).not.toContain("Lista nu se poate calcula inca");
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);

    const { data: cheltuieli } = await serviciu().schema("intretinere").from("cheltuieli")
      .select("suma").eq("lista_id", LISTA.id);
    const total = round2(cheltuieli.reduce((s, c) => s + Number(c.suma), 0));
    const suma = lei(total).replace(/\./g, "\\.");
    expect(t).toMatch(new RegExp(`Total repartizat\\s*${suma} lei`));
    expect(t).toMatch(new RegExp(`Total facturi\\s*${suma} lei`));
  });

  test("6. publicarea scrie repartizarile, datoriile si fondul", async ({ page }) => {
    const sb = serviciu();
    const { data: fondInainte } = await sb.schema("financiar").from("fonduri_solduri")
      .select("id, tip, sold").eq("bloc_id", BLOC.id).eq("tip", "reparatii").single();

    await intraCa(page, "admin");
    await mergiLaTab(page, "Facturi");
    await buton(page, "Publica lista").click();
    const panou = page.getByRole("dialog", { name: "Publica lista" });
    await expect(panou).toContainText("Termenul de plata va fi 25 octombrie 2026");
    await buton(page, "Da, publica lista").click();
    await asteaptaToast(page, "Lista a fost publicata");

    const { data: lista } = await sb.schema("intretinere").from("liste_lunare")
      .select("stare, scadenta, versiune, apartamente_repartizate").eq("id", LISTA.id).single();
    expect(lista.stare).toBe("publicata");
    expect(lista.scadenta).toBe("2026-10-25");
    expect(lista.apartamente_repartizate).toBe(APARTAMENTE.length);

    /* Un rand pe fiecare cheltuiala si fiecare apartament, inclusiv cele cu 0 */
    const { data: cheltuieli } = await sb.schema("intretinere").from("cheltuieli")
      .select("id, suma").eq("lista_id", LISTA.id);
    const { count } = await sb.schema("intretinere").from("repartizari")
      .select("id", { count: "exact", head: true }).eq("lista_id", LISTA.id);
    expect(count).toBe(cheltuieli.length * APARTAMENTE.length);

    const { data: rep } = await sb.schema("intretinere").from("repartizari")
      .select("suma, cheltuiala_id").eq("lista_id", LISTA.id);
    const totalFacturi = round2(cheltuieli.reduce((s, c) => s + Number(c.suma), 0));
    const totalRepartizat = round2(rep.reduce((s, r) => s + Number(r.suma), 0));
    expect(totalRepartizat).toBe(totalFacturi);

    /* Fiecare cheltuiala se imparte exact, la ban */
    for (const c of cheltuieli) {
      const ale = round2(rep.filter((r) => r.cheltuiala_id === c.id).reduce((s, r) => s + Number(r.suma), 0));
      expect(ale).toBe(round2(Number(c.suma)));
    }

    /* O datorie de intretinere pe fiecare apartament */
    await expect.poll(async () => {
      const { count: n } = await sb.schema("financiar").from("datorii")
        .select("id", { count: "exact", head: true }).eq("lista_id", LISTA.id).eq("tip", "intretinere");
      return n;
    }, { timeout: 30000 }).toBe(APARTAMENTE.length);

    /* Fondul de reparatii a primit contributiile lunii */
    const { data: fondDupa } = await sb.schema("financiar").from("fonduri_solduri")
      .select("sold").eq("id", fondInainte.id).single();
    expect(Number(fondDupa.sold)).toBeCloseTo(Number(fondInainte.sold) + 1600, 2);

    /* Toata lumea cu cont a fost anuntata */
    const elena = await profilDupaEmail(CONTURI.elena);
    await expect.poll(async () => {
      const { data: n } = await sb.schema("comunicare").from("notificari")
        .select("titlu, corp").eq("profil_id", elena.id).eq("tip", "lista_publicata")
        .order("trimisa_la", { ascending: false }).limit(1);
      return ((n || [])[0] || {}).titlu || "";
    }, { timeout: 30000 }).toContain("septembrie");
  });

  test("7. locatarul vede exact cifrele din baza, cu calculul lor", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(17);
    const sold = await soldApartament(ap.id);
    const { data: rep } = await sb.schema("intretinere").from("repartizari")
      .select("suma, cheltuiala_id").eq("lista_id", LISTA.id).eq("apartament_id", ap.id);
    const { data: cheltuieli } = await sb.schema("intretinere").from("cheltuieli")
      .select("id, categorie").eq("lista_id", LISTA.id);
    const alLui = round2(rep.reduce((s, r) => s + Number(r.suma), 0));
    expect(alLui).toBeGreaterThan(0);

    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await expect(page.getByText("TOTAL DE PLATA ACUM")).toBeVisible();

    /* Totalul listei curente este exact soldul apartamentului, iar fiecare
       rand de pe ecran are suma din repartizarea salvata */
    const t = await textEcran(page);
    expect(t).toContain(lei(sold));
    for (const c of cheltuieli) {
      const r = rep.find((x) => x.cheltuiala_id === c.id);
      expect(t, `randul ${c.categorie}`).toContain(c.categorie);
      expect(t, `suma randului ${c.categorie}`).toContain(lei(Number(r.suma)));
    }

    /* Randul de apa se desface si arata derivarea completa */
    const rand = page.getByRole("button", { name: /^E2E apa rece,/ }).first();
    await rand.click();
    await expect(rand).toHaveAttribute("aria-expanded", "true");
    const desfacut = await textEcran(page);
    expect(desfacut).toContain("Contor general al blocului");
    expect(desfacut).toContain("Suma contoarelor din apartamente");
    expect(desfacut).toContain("Diferenta pe coloana");
    expect(desfacut).toContain("Pret pe metru cub");
    expect(desfacut).toContain("Consumul apartamentului");
    for (const cuvant of CUVINTE_TEHNICE) expect(desfacut).not.toContain(cuvant);

    /* Verificarea repartitiei: nimic nealocat, nimic platit de doua ori */
    const verificare = page.locator(".ab-shell").getByText("Verificarea repartitiei").locator("xpath=ancestor::div[1]");
    await expect(verificare).toContainText("Diferenta");
    await expect(verificare).toContainText("0,00");
  });

  test("8. plata cu cardul stinge soldul si lasa chitanta", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(17);
    const sold = await soldApartament(ap.id);
    expect(sold).toBeGreaterThan(0);
    const { count: inainte } = await sb.schema("financiar").from("chitante")
      .select("id", { count: "exact", head: true });

    await intraCa(page, "elena");
    await mergiLaTab(page, "Plata");
    await buton(page, `Plateste ${lei(sold)} lei cu cardul`).click();
    await page.getByLabel("Numarul cardului").fill("4242424242424242");
    await page.getByLabel("Expira").fill("12/30");
    await page.getByLabel("Cod CVC").fill("123");
    await page.getByLabel("Numele de pe card").fill("ELENA MARINESCU");
    await buton(page, `Plateste ${lei(sold)} lei`).click();
    await expect(page.getByText("Plata a reusit")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Chitanta [A-Z0-9]+ nr\. \d{6} a fost emisa/)).toBeVisible();
    await buton(page, "Gata").click();

    await expect.poll(async () => soldApartament(ap.id), { timeout: 30000 }).toBe(0);
    const { count: dupa } = await sb.schema("financiar").from("chitante")
      .select("id", { count: "exact", head: true });
    expect(dupa).toBe(inainte + 1);
    const { data: plata } = await sb.schema("financiar").from("plati")
      .select("metoda, suma, stare").eq("apartament_id", ap.id).eq("stare", "confirmata")
      .order("creat_la", { ascending: false }).limit(1).single();
    expect(plata.metoda).toBe("card");
    expect(Number(plata.suma)).toBeCloseTo(sold, 2);
  });

  test("9. incasarea cash se aloca pe cea mai veche datorie", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(3);
    const { data: datorii } = await sb.schema("financiar").from("datorii_rest")
      .select("id, scadenta, rest, creat_la").eq("apartament_id", ap.id).gt("rest", 0);
    expect(datorii.length).toBeGreaterThan(1);
    const ceaMaiVeche = datorii.slice().sort((a, b) =>
      String(a.scadenta).localeCompare(String(b.scadenta)) || String(a.creat_la).localeCompare(String(b.creat_la)))[0];
    const suma = Math.min(50, round2(Number(ceaMaiVeche.rest)));

    await intraCa(page, "admin");
    await mergiLaTab(page, "Apartamente");
    await page.getByRole("button", { name: `Apartament ${ap.numar}`, exact: true }).click();
    await buton(page, "Inregistreaza incasare cash").click();
    await page.getByLabel("Suma primita").fill(lei(suma));
    await buton(page, "Emite chitanta").click();
    await asteaptaToast(page, "Incasare inregistrata, chitanta emisa");

    const { data: plata } = await sb.schema("financiar").from("plati")
      .select("id, suma").eq("apartament_id", ap.id).eq("metoda", "numerar")
      .order("creat_la", { ascending: false }).limit(1).single();
    const { data: alocari } = await sb.schema("financiar").from("alocari_plati")
      .select("datorie_id, suma").eq("plata_id", plata.id);
    expect(alocari).toHaveLength(1);
    expect(alocari[0].datorie_id).toBe(ceaMaiVeche.id);
    expect(Number(alocari[0].suma)).toBeCloseTo(suma, 2);
  });

  test("10. penalizarile lunare se calculeaza pe datoriile scadente", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(3);
    /* Penalizarile se leaga de apartament prin datoria taxata */
    const alePenalizari = async () => {
      const { data, error } = await sb.schema("financiar").from("penalizari")
        .select("id, datorie_sursa_id, suma, procent_zi, zile_taxate, d:datorii!penalizari_datorie_sursa_id_fkey!inner(apartament_id, suma, tip)")
        .eq("d.apartament_id", ap.id);
      if (error) throw new Error(error.message);
      return data;
    };
    const inainte = (await alePenalizari()).length;

    /* Jobul lunar, rulat pentru o zi de dupa scadenta listei pe septembrie
       (25 octombrie) si dupa cele 30 de zile de gratie */
    const r = await fetch(`${URL_SUPABASE}/rest/v1/rpc/calculeaza_penalizari`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "Content-Profile": "financiar",
        apikey: CHEIE_SERVICIU, Authorization: `Bearer ${CHEIE_SERVICIU}`,
      },
      body: JSON.stringify({ p_la: "2026-12-01" }),
    });
    expect(r.status, await r.text()).toBe(200);

    const dupa = await alePenalizari();
    expect(dupa.length).toBeGreaterThan(inainte);

    /* Penalizarea nu depaseste datoria pe care o taxeaza si nu se aplica altei
       penalizari (Legea 196/2018) */
    for (const p of dupa) {
      expect(Number(p.suma)).toBeLessThanOrEqual(Number(p.d.suma) + 0.001);
      expect(p.d.tip).not.toBe("penalizare");
      expect(Number(p.zile_taxate)).toBeGreaterThan(0);
    }

    await intraCa(page, "ilie");
    await mergiLaTab(page, "Plata");
    const t = await textEcran(page);
    /* Locatarul vede penalizarea cu formula ei, in cifrele lui */
    expect(t).toMatch(/Penalizare pentru intretinere/);
    expect(t).toMatch(/[\d.]+,\d\d × 0,02% × \d+ zile/);
    expect(t).toContain("primele 30 de zile nu se penalizeaza");
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);
  });

  test("11. o corectie dupa publicare ajunge la locatar si totalul ramane soldul", async ({ page }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(17);
    expect(await soldApartament(ap.id)).toBe(0);

    /* Factura de salubritate vine corectata de furnizor: 900 → 1.100 */
    const { data: c } = await sb.schema("intretinere").from("cheltuieli")
      .select("id").eq("lista_id", LISTA.id).eq("categorie", "E2E salubritate").single();
    await sb.schema("intretinere").from("cheltuieli").update({ suma: 1100 }).eq("id", c.id);

    const r = await fetch(`${URL_SUPABASE}/functions/v1/publica-lista`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHEIE_SERVICIU}` },
      body: JSON.stringify({ lista_id: LISTA.id, recalculare: true }),
    });
    expect(r.status, await r.text()).toBe(200);

    const { data: lista } = await sb.schema("intretinere").from("liste_lunare")
      .select("versiune").eq("id", LISTA.id).single();
    expect(lista.versiune).toBe(2);

    await expect.poll(async () => {
      const { count } = await sb.schema("financiar").from("datorii")
        .select("id", { count: "exact", head: true })
        .eq("lista_id", LISTA.id).eq("tip", "corectie").eq("apartament_id", ap.id);
      return count;
    }, { timeout: 30000 }).toBe(1);

    const sold = await soldApartament(ap.id);
    expect(sold).toBeGreaterThan(0);

    /* Locatarul este anuntat ca lista s-a corectat */
    const elena = await profilDupaEmail(CONTURI.elena);
    await expect.poll(async () => {
      const { data } = await sb.schema("comunicare").from("notificari")
        .select("titlu, corp").eq("profil_id", elena.id)
        .order("trimisa_la", { ascending: false }).limit(1);
      return `${((data || [])[0] || {}).titlu || ""} ${((data || [])[0] || {}).corp || ""}`;
    }, { timeout: 30000 }).toMatch(/corect/i);

    await intraCa(page, "elena");
    await expect(page.getByText(lei(sold)).first()).toBeVisible();
    await mergiLaTab(page, "Plata");
    /* [L4] Totalul de plata al listei curente ramane egal cu soldul */
    const t = await textEcran(page);
    expect(t).toContain(lei(sold));
    for (const cuvant of CUVINTE_TEHNICE) expect(t).not.toContain(cuvant);

    /* Si dupa recalculare, nimic nu ramane nealocat */
    const verificare = page.locator(".ab-shell").getByText("Verificarea repartitiei").locator("xpath=ancestor::div[1]");
    await expect(verificare).toContainText("Diferenta");
    await expect(verificare).toContainText("0,00");
  });
});
