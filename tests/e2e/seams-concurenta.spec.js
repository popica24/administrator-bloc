/* Cusaturile pe care suita le trata pana acum ca fiind "pe dinauntru":
   internetul lipsa pe tot parcursul unei treburi si revenit la loc, doi
   administratori care lucreaza in acelasi timp pe aceeasi lista, un locatar
   care plateste exact in clipa in care administratorul ii inregistreaza banii
   in numerar, si un eveniment din coada care esueaza si este reluat de cron.

   Fiecare test isi face datele lui si le strange la loc; blocul demo ramane
   cum a fost gasit. */

import { test, expect } from "@playwright/test";
import {
  buton, intra, intraCa, mergiLaTab, serviciu, blocD14, apartamentulNumarul,
  creeazaCont, legaDeApartament, datorieDeTest, soldApartament,
  asteaptaToast, CUVINTE_TEHNICE, listaLunara, profilDupaTelefon, CONTURI,
} from "./ajutor.js";

const lei = (n) => Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d),)/g, ".");

/* --------------------------------------------------------------------------
   Internetul cade pe tot parcursul unei treburi, apoi revine
   -------------------------------------------------------------------------- */

test.describe("offline pe toata durata unei treburi, apoi inapoi online", () => {
  const TITLU = "E2E sesizare fără internet";

  test.afterEach(async () => {
    const sb = serviciu();
    const { data } = await sb.schema("sesizari").from("sesizari").select("id").eq("titlu", TITLU);
    for (const s of data || []) {
      await sb.schema("sesizari").from("mesaje").delete().eq("sesizare_id", s.id);
      await sb.schema("comunicare").from("notificari").delete().eq("referinta->>sesizare_id", s.id);
      await sb.schema("sesizari").from("sesizari").delete().eq("id", s.id);
    }
  });

  test("sesizarea scrisa fara internet se trimite dupa ce internetul revine, o singura data", async ({ page, context }) => {
    const sb = serviciu();
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizări");
    await buton(page, "Sesizare nouă").click();

    /* Internetul cade inainte de prima apasare si ramane cazut */
    await context.setOffline(true);
    await page.getByLabel("Sau scrie pe scurt problema").fill(TITLU);
    await buton(page, "Trimite sesizarea").click();
    const toast = page.locator(".ab-toast");
    await expect(toast).toBeVisible({ timeout: 25000 });
    const mesajOffline = await toast.innerText();
    for (const cuvant of CUVINTE_TEHNICE) expect(mesajOffline, "mesajul de offline").not.toContain(cuvant);
    expect(mesajOffline, "mesajul spune ce s-a intamplat").toMatch(/internet|serverul nu raspunde|conexiune/i);

    const { count: inTimpulCaderii } = await sb.schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("titlu", TITLU);
    expect(inTimpulCaderii, "nimic nu s-a scris cât timp nu era internet").toBe(0);

    /* Ce a scris omul ramane pe ecran: a doua apasare, cu internetul la loc */
    await expect(page.getByLabel("Sau scrie pe scurt problema")).toHaveValue(TITLU);
    await context.setOffline(false);
    await buton(page, "Trimite sesizarea").click();
    await asteaptaToast(page, "Sesizarea a ajuns la administrator");

    const { count: dupa } = await sb.schema("sesizari").from("sesizari")
      .select("id", { count: "exact", head: true }).eq("titlu", TITLU);
    expect(dupa, "exact o sesizare, nu două").toBe(1);
  });

  test("aplicatia reincarcata fara internet spune ce se intampla, nu ramane alba", async ({ page, context }) => {
    await intraCa(page, "elena");
    /* Fisierele aplicatiei sunt deja in browser; ce cade este doar API-ul */
    await page.route("**/rest/v1/**", (r) => r.abort());
    await page.route("**/auth/v1/**", (r) => r.abort());
    await page.reload();
    await page.waitForTimeout(4000);
    const text = await page.locator(".ab-shell").innerText().catch(() => "");
    await page.unroute("**/rest/v1/**");
    await page.unroute("**/auth/v1/**");
    expect(text.trim().length, "ecranul alb nu spune nimic").toBeGreaterThan(20);
    expect(text, "ecranul nu spune ce se întâmplă").toMatch(/internet|serverul|sesiun|incearc|din nou/i);
    for (const cuvant of CUVINTE_TEHNICE) expect(text).not.toContain(cuvant);
    void context;
  });
});

/* --------------------------------------------------------------------------
   Doi administratori pe aceeasi lista
   -------------------------------------------------------------------------- */

test.describe("doi administratori lucreaza deodata pe aceeasi lista", () => {
  const EMAIL_2 = "0798818571";
  let LISTA;

  test.beforeAll(async () => {
    const b = await blocD14();
    LISTA = await listaLunara({ stare: "ciorna" });
    const sb = serviciu();
    const pid = await creeazaCont(EMAIL_2, "Al doilea administrator");
    const { data: are } = await sb.schema("identitate").from("administratori").select("profil_id").eq("profil_id", pid).maybeSingle();
    if (!are) {
      await sb.schema("identitate").rpc("numeste_administrator", {
        p_profil_id: pid, p_asociatie_id: b.asociatie_id, p_numar_atestat: "E2E-ADMIN-2",
        p_activ_din: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      });
    }
  });

  test.afterEach(async () => {
    const sb = serviciu();
    await sb.schema("intretinere").from("cheltuieli").delete().eq("lista_id", LISTA.id).like("categorie", "E2E seam%");
    const { data: f } = await sb.schema("intretinere").from("furnizori").select("id").like("denumire", "E2E seam%");
    for (const x of f || []) {
      const { count } = await sb.schema("intretinere").from("cheltuieli").select("id", { count: "exact", head: true }).eq("furnizor_id", x.id);
      if (!count) await sb.schema("intretinere").from("furnizori").delete().eq("id", x.id);
    }
  });

  async function adaugaFactura(page, { categorie, cod, suma = "100" }) {
    await buton(page, "Adaugă factură").click();
    const panou = page.getByRole("dialog", { name: "Factură nouă" });
    await expect(panou).toBeVisible({ timeout: 20000 });
    await panou.getByLabel("Sau scrie un furnizor nou").fill(`E2E seam ${categorie}`);
    await panou.getByLabel("Ce cheltuială este").fill(categorie);
    await panou.getByLabel("Suma facturii").fill(suma);
    await panou.getByLabel("Cum se împarte").selectOption("apartamente");
    if (cod) await panou.getByLabel("Cod pe lista").fill(cod);
    return panou;
  }

  /* Primul cod liber de la C10 in sus, citit din baza */
  async function codLiber() {
    const { data } = await serviciu().schema("intretinere").from("cheltuieli").select("cod").eq("lista_id", LISTA.id);
    const luate = new Set((data || []).map((c) => c.cod));
    let cod = 10;
    while (luate.has(`C${cod}`)) cod += 1;
    return `C${cod}`;
  }

  /* [K23] Pana la 21 septembrie, furnizorul nou si factura se scriau in doua
     apeluri: aici, pe CI, furnizorul celui refuzat ramanea orfan. Acum sunt un
     singur apel (intretinere.adauga_factura_cu_furnizor_nou), deci o singura
     tranzactie. */
  test("[K23] amandoi scriu acelasi cod pe lista: unul intra, celalalt afla de ce nu", async ({ browser }) => {
    test.setTimeout(150000);
    const sb = serviciu();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    try {
      await intraCa(a, "admin");
      await intra(b, EMAIL_2);
      await expect(buton(b, "Ieși")).toBeVisible({ timeout: 25000 });
      await mergiLaTab(a, "Facturi");
      await mergiLaTab(b, "Facturi");

      const COD = await codLiber();

      await adaugaFactura(a, { categorie: "E2E seam unu", cod: COD });
      await adaugaFactura(b, { categorie: "E2E seam doi", cod: COD });
      await expect(a.locator(".ab-toast")).toHaveCount(0, { timeout: 15000 });
      await expect(b.locator(".ab-toast")).toHaveCount(0, { timeout: 15000 });

      await Promise.all([
        buton(a, "Salvează factura").click(),
        buton(b, "Salvează factura").click(),
      ]);
      await expect(a.locator(".ab-toast")).toBeVisible({ timeout: 25000 });
      await expect(b.locator(".ab-toast")).toBeVisible({ timeout: 25000 });
      const mesaje = [await a.locator(".ab-toast").innerText(), await b.locator(".ab-toast").innerText()];
      for (const m of mesaje) for (const cuvant of CUVINTE_TEHNICE) expect(m, `mesajul "${m}"`).not.toContain(cuvant);

      /* Un singur rand cu codul acela, si niciun furnizor ramas fara factura */
      const { data: randuri } = await sb.schema("intretinere").from("cheltuieli")
        .select("id, categorie").eq("lista_id", LISTA.id).eq("cod", COD);
      expect(randuri, `codul ${COD} pe lista`).toHaveLength(1);
      const { data: furnizori } = await sb.schema("intretinere").from("furnizori").select("id, denumire").like("denumire", "E2E seam%");
      for (const f of furnizori || []) {
        const { count } = await sb.schema("intretinere").from("cheltuieli")
          .select("id", { count: "exact", head: true }).eq("furnizor_id", f.id);
        expect(count, `furnizorul "${f.denumire}" a ramas fără nicio factura`).toBeGreaterThan(0);
      }
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("al doilea administrator sterge factura pe care primul tocmai o salveaza", async ({ browser }) => {
    test.setTimeout(150000);
    const sb = serviciu();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    /* Randul fondului nu are butoane, iar `afterEach` sterge randurile E2E:
       pe lista ramane un singur rand cu "Modifica" si "Sterge". */
    try {
      const COD = await codLiber();

      await intraCa(a, "admin");
      await mergiLaTab(a, "Facturi");
      await adaugaFactura(a, { categorie: "E2E seam de sters", cod: COD });
      await buton(a, "Salvează factura").click();
      await expect(a.getByText("E2E seam de sters", { exact: true })).toBeVisible({ timeout: 25000 });

      /* Primul deschide randul ca sa-l modifice */
      await expect(buton(a, "Modifică")).toHaveCount(1);
      await buton(a, "Modifică").click();
      const panou = a.getByRole("dialog", { name: "Modifică factura" });
      await expect(panou).toBeVisible({ timeout: 20000 });
      await panou.getByLabel("Suma facturii").fill("222");

      /* Intre timp, al doilea administrator il sterge */
      await intra(b, EMAIL_2);
      await expect(buton(b, "Ieși")).toBeVisible({ timeout: 25000 });
      await mergiLaTab(b, "Facturi");
      await expect(b.getByText("E2E seam de sters", { exact: true })).toBeVisible({ timeout: 25000 });
      b.once("dialog", (d) => d.accept());
      await buton(b, "Șterge").first().click();
      await asteaptaToast(b, "ștearsă");

      /* Primul salveaza peste un rand care nu mai exista. Toastul de la
         salvarea dinainte trebuie sa apuce sa dispara, altfel testul citeste
         mesajul vechi in locul celui nou. */
      await expect(a.locator(".ab-toast")).toHaveCount(0, { timeout: 15000 });
      await buton(a, "Salvează factura").click();
      await expect(a.locator(".ab-toast")).toBeVisible({ timeout: 25000 });
      const mesaj = await a.locator(".ab-toast").innerText();
      for (const cuvant of CUVINTE_TEHNICE) expect(mesaj, `mesajul "${mesaj}"`).not.toContain(cuvant);
      expect(mesaj, "mesajul spune ca rândul nu mai există").toMatch(/nu mai exista|a fost stear|reincarca/i);

      const { data: ramase } = await sb.schema("intretinere").from("cheltuieli")
        .select("id, suma").eq("lista_id", LISTA.id).eq("cod", COD);
      expect(ramase, "rândul sters nu invie la salvarea celuilalt").toHaveLength(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

/* --------------------------------------------------------------------------
   Doua incasari cash in aceeasi clipa, pe aceeasi datorie
   -------------------------------------------------------------------------- */

test.describe("doua incasari cash in aceeasi clipa, pe aceeasi datorie", () => {
  const TELEFON = "0798138711";

  test("amandoua se inregistreaza, chitantele raman numerotate, soldul nu trece pe minus", async ({ browser }) => {
    const sb = serviciu();
    const ap = await apartamentulNumarul(19);
    const pid = await creeazaCont(TELEFON, "Platitor În Același Timp");
    await legaDeApartament(pid, ap.id);
    await datorieDeTest(ap.id, 40, "E2E datorie pe două cai");
    const sold = await soldApartament(ap.id);
    expect(sold).toBeGreaterThan(0);

    const ctxT = await browser.newContext();
    const ctxA = await browser.newContext();
    const t = await ctxT.newPage();
    const a = await ctxA.newPage();
    try {
      /* Doi administratori, pe aceeasi fisa, fiecare cu jumatate din bani */
      await intraCa(t, "admin");
      await mergiLaTab(t, "Apartamente");
      await t.getByRole("button", { name: "Apartament 19" }).click();
      await buton(t, "Înregistrează încasare cash").click();
      await t.getByLabel("Suma primită").fill(lei(sold / 2));

      await intraCa(a, "admin");
      await mergiLaTab(a, "Apartamente");
      await a.getByRole("button", { name: "Apartament 19" }).click();
      await buton(a, "Înregistrează încasare cash").click();

      const { data: inainte } = await sb.schema("financiar").from("chitante").select("numar, serie");
      const numereInainte = (inainte || []).map((c) => `${c.serie}-${c.numar}`);

      await Promise.all([
        buton(t, "Emite chitanța").click(),
        buton(a, "Emite chitanța").click(),
      ]);

      await expect(t.locator(".ab-toast")).toBeVisible({ timeout: 40000 });
      await expect(a.locator(".ab-toast")).toBeVisible({ timeout: 40000 });
      const mesajAdmin = await a.locator(".ab-toast").innerText();
      for (const cuvant of CUVINTE_TEHNICE) expect(mesajAdmin, `mesajul "${mesajAdmin}"`).not.toContain(cuvant);

      /* Chitantele: doua noi, fiecare cu numarul ei, niciunul repetat */
      const { data: dupa } = await sb.schema("financiar").from("chitante").select("numar, serie");
      const numereDupa = (dupa || []).map((c) => `${c.serie}-${c.numar}`);
      expect(new Set(numereDupa).size, "numere de chitanța repetate").toBe(numereDupa.length);
      expect(numereDupa.length - numereInainte.length).toBe(2);

      /* Soldul: nimic pe minus, iar ce a prisosit este avans */
      const { data: rest } = await sb.schema("financiar").from("datorii_rest")
        .select("rest").eq("apartament_id", ap.id);
      for (const r of rest || []) expect(Number(r.rest), "rest negativ în registru").toBeGreaterThanOrEqual(0);
      expect(await soldApartament(ap.id), "soldul după două plăți").toBe(0);

      /* Si ce vede omul: nicio suma pe minus pe ecran */
      await t.reload();
      await expect(t.getByRole("tab", { name: "Apartamente" })).toBeVisible({ timeout: 25000 });
      const ecran = await t.locator(".ab-shell > .ab-scroll").innerText();
      expect(ecran, "suma negativa pe ecranul administratorului").not.toMatch(/-\s?\d+,\d{2}\s*LEI/i);
      for (const cuvant of CUVINTE_TEHNICE) expect(ecran).not.toContain(cuvant);
    } finally {
      await ctxT.close();
      await ctxA.close();
    }
  });
});

/* --------------------------------------------------------------------------
   Un eveniment care esueaza si este reluat
   -------------------------------------------------------------------------- */

test.describe("webhook-ul si cron-ul se bat pe acelasi eveniment", () => {
  /* Coada `evenimente` nu este expusa prin API, deci evenimentul se face pe
     drumul lui adevarat: o sesizare rezolvata din ecranul administratorului.
     Peste el se cheama de mai multe ori, deodata, comanda pe care o ruleaza
     cron-ul la fiecare minut, exact cursa dintre webhook-ul pg_net si cron,
     care in productie se intampla la fiecare eveniment intarziat. */
  test("sesizarea rezolvata ajunge la locatar o singura data, oricat de des ruleaza cron-ul", async ({ page }) => {
    test.setTimeout(150000);
    const sb = serviciu();
    const TITLU = `E2E eveniment reluat ${Date.now()}`;
    const elena = await profilDupaTelefon(CONTURI.elena);

    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizări");
    await buton(page, "Sesizare nouă").click();
    await page.getByLabel("Sau scrie pe scurt problema").fill(TITLU);
    await buton(page, "Trimite sesizarea").click();
    await asteaptaToast(page, "Sesizarea a ajuns la administrator");

    const { data: sesizari } = await sb.schema("sesizari").from("sesizari").select("id").eq("titlu", TITLU);
    expect(sesizari).toHaveLength(1);
    const sesizareId = sesizari[0].id;

    await buton(page, "Ieși").click();
    await intraCa(page, "admin");
    await mergiLaTab(page, "Sesizări");
    await page.getByText(TITLU, { exact: true }).first().click();
    await buton(page, "Marchează rezolvată").click();
    await expect(page.locator(".ab-toast")).toBeVisible({ timeout: 25000 });

    /* Cron-ul, de cinci ori deodata, peste acelasi eveniment */
    await Promise.all([0, 1, 2, 3, 4].map(() => sb.rpc("proceseaza_evenimente_restante")));
    await new Promise((r) => setTimeout(r, 1500));
    await Promise.all([0, 1, 2].map(() => sb.rpc("proceseaza_evenimente_restante")));

    const { data: notificari } = await sb.schema("comunicare").from("notificari")
      .select("id, titlu").eq("profil_id", elena.id).eq("referinta->>sesizare_id", sesizareId);
    expect(notificari.length, "aceeași sesizare rezolvată anuntata de mai multe ori").toBe(1);

    /* Si ce vede locatarul: o singura instiintare pentru sesizarea lui, nu un
       teanc. Se numara titlul sesizarii, care este unic, nu textul "Sesizare
       rezolvata": acela apare si pentru sesizarile lasate de alte teste. */
    await buton(page, "Ieși").click();
    await intraCa(page, "elena");
    const acasa = await page.locator(".ab-shell > .ab-scroll").innerText();
    const aparitii = acasa.split(TITLU).length - 1;
    expect(aparitii, "înștiințarea apare de mai multe ori pe Acasa").toBe(1);
    for (const cuvant of CUVINTE_TEHNICE) expect(acasa).not.toContain(cuvant);

    await sb.schema("comunicare").from("notificari").delete().eq("referinta->>sesizare_id", sesizareId);
    await sb.schema("sesizari").from("mesaje").delete().eq("sesizare_id", sesizareId);
    await sb.schema("sesizari").from("sesizari").delete().eq("id", sesizareId);
  });
});
