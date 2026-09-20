/* Regulile schimbate in ultima runda, verificate prin ecranele reale:
   - doar proprietarul voteaza (K3);
   - sesizarile se vad dupa perioada de locuire, nu dupa apartament (K4);
   - vederea anonima a blocului nu mai da descrierea (K10) si arata si ce s-a
     rezolvat de curand (K14);
   - reminderul de plata nu mai spune restantierilor ca "se apropie termenul" (K5);
   - convocarea adunarii ajunge cu ora la locatar (K6);
   - avizierul marcheaza toate anunturile necitite intr-o singura comanda (K1). */

import { test, expect } from "@playwright/test";
import {
  buton, intraCa, intra, mergiLaTab, serviciu, blocD14, apartamentulNumarul, votDupaTitlu,
  creeazaCont, stergeCont, profilDupaEmail,
  asteaptaToast, textEcran, CUVINTE_TEHNICE, PAROLA, CONTURI,
} from "./ajutor.js";

const VOT = "Inlocuirea usii de la intrare";

/* Conturile temporare ale acestui fisier, sterse la final oricum s-ar termina */
const TEMPORARE = [
  "e2e-chirias@adminbloc.test",
  "e2e-proprietar-nou@adminbloc.test",
  "e2e-mutat-azi@adminbloc.test",
];

test.beforeAll(async () => {
  for (const e of TEMPORARE) await stergeCont(e);
});
test.afterAll(async () => {
  for (const e of TEMPORARE) await stergeCont(e);
});

/* Leaga un cont de un apartament cu o calitate si o data anume */
async function leaga(email, nume, numarAp, calitate, activDin) {
  const ap = await apartamentulNumarul(numarAp);
  const b = await blocD14();
  const profilId = await creeazaCont(email, nume);
  const { error } = await serviciu().schema("identitate").from("locatari").insert({
    apartament_id: ap.id, bloc_id: b.id, profil_id: profilId, calitate,
    activ_din: activDin || new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  });
  if (error) throw new Error(`leaga ${email}: ${error.message}`);
  return ap;
}

async function voturiAle(apartamentId) {
  const { data } = await serviciu().schema("guvernanta").from("voturi_exprimate")
    .select("id").eq("apartament_id", apartamentId);
  return data || [];
}

test.describe("Doar proprietarul voteaza [K3]", () => {
  test("chiriasul vede votul, dar i se spune ca nu poate vota, fara sa fie lasat sa incerce", async ({ page }) => {
    const ap = await leaga("e2e-chirias@adminbloc.test", "Chirias de Test", 19, "chirias");
    expect(await voturiAle(ap.id)).toHaveLength(0);

    await intra(page, "e2e-chirias@adminbloc.test");
    await expect(buton(page, "Iesi")).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Vot si adunare" }).click();
    await expect(page.getByText(VOT)).toBeVisible();

    /* [P1] Inainte, chiriasul vedea variantele si era refuzat abia la final.
       Acum i se spune de la inceput, iar votul ramane vizibil. */
    await expect(page.getByText("Alege o varianta")).toHaveCount(0);
    await expect(page.getByText(/Doar proprietarul apartamentului poate vota/)).toBeVisible();
    expect(await voturiAle(ap.id)).toHaveLength(0);
    for (const cuvant of CUVINTE_TEHNICE) expect(await textEcran(page)).not.toContain(cuvant);
  });

  test("[P1] Acasa nu ii cere chiriasului o sarcina pe care nu o poate duce", async ({ page }) => {
    await intra(page, "e2e-chirias@adminbloc.test");
    await expect(buton(page, "Iesi")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Ce ai de facut in perioada urmatoare")).toBeVisible();
    await expect(page.getByText(`Voteaza: ${VOT}`)).toHaveCount(0);
  });
});

test.describe("Sesizarile se vad dupa perioada de locuire [K4]", () => {
  test("locatarul mutat azi nu vede conversatia celui dinaintea lui", async ({ page }) => {
    /* Ap. 17 are sesizari din august si din septembrie, scrise de Elena */
    const azi = new Date().toISOString().slice(0, 10);
    await leaga("e2e-mutat-azi@adminbloc.test", "Mutat Azi", 17, "chirias", azi);

    await intra(page, "e2e-mutat-azi@adminbloc.test");
    await expect(buton(page, "Iesi")).toBeVisible({ timeout: 20000 });
    await mergiLaTab(page, "Sesizari");
    await expect(page.getByText("Nu ai trimis nicio sesizare")).toBeVisible();

    const t = await textEcran(page);
    expect(t).not.toContain("Bec ars pe palier la etajul 4");
    expect(t).not.toContain("Interfon defect");

    /* Nici la "Din tot blocul": vederea anonima sare peste apartamentul meu */
    await page.getByRole("button", { name: "Din tot blocul" }).click();
    const tBloc = await textEcran(page);
    expect(tBloc).not.toContain("Bec ars pe palier la etajul 4");
  });

  test("proprietarul de dinainte isi vede mai departe sesizarile", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await expect(page.getByText("Bec ars pe palier la etajul 4")).toBeVisible();
  });
});

test.describe("Vederea anonima a blocului [K10, K14]", () => {
  test("arata titlul si starea, dar nu descrierea altui apartament", async ({ page }) => {
    const { data: alta } = await serviciu().schema("sesizari").from("sesizari")
      .select("titlu, descriere").eq("titlu", "Scurgere la coloana de la subsol").single();
    expect(alta.descriere).not.toBe(alta.titlu);

    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await page.getByRole("button", { name: "Din tot blocul" }).click();
    await expect(page.getByText(alta.titlu)).toBeVisible();
    const t = await textEcran(page);
    expect(t).not.toContain(alta.descriere);
    /* Nici numarul apartamentului, nici numele autorului */
    expect(t).not.toContain("Ap. 11");
    expect(t).toContain("Nu se vede cine a trimis sesizarea.");
  });

  /* [P2] Vezi raportul: textul din formular a ramas de dinainte de K10. */
  test("[P2] formularul nu mai promite ca ceilalti vad descrierea", async ({ page }) => {
    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await buton(page, "Sesizare noua").click();
    const panou = page.getByRole("dialog", { name: "Sesizare noua" });
    await expect(panou).toBeVisible();
    await expect(panou.getByText(/vad titlul si descrierea/)).toHaveCount(0);
  });

  test("o sesizare rezolvata de curand se vede, una veche de peste 30 de zile nu", async ({ page }) => {
    const sb = serviciu();
    const { data: s } = await sb.schema("sesizari").from("sesizari")
      .select("id, titlu, rezolvata_la").eq("titlu", "Gunoi depozitat pe casa scarii").single();

    await intraCa(page, "elena");
    await mergiLaTab(page, "Sesizari");
    await page.getByRole("button", { name: "Din tot blocul" }).click();
    await expect(page.getByText(s.titlu)).toBeVisible();

    /* Aceeasi sesizare, rezolvata acum 40 de zile, iese din vedere */
    const vechi = new Date(Date.now() - 40 * 86400000).toISOString();
    await sb.schema("sesizari").from("sesizari").update({ rezolvata_la: vechi }).eq("id", s.id);
    try {
      await page.reload();
      await mergiLaTab(page, "Sesizari");
      await page.getByRole("button", { name: "Din tot blocul" }).click();
      await expect(page.getByText("Scurgere la coloana de la subsol")).toBeVisible();
      await expect(page.getByText(s.titlu)).toHaveCount(0);
    } finally {
      await sb.schema("sesizari").from("sesizari").update({ rezolvata_la: s.rezolvata_la }).eq("id", s.id);
    }
  });
});

test.describe("Reminderul de plata [K5]", () => {
  test("restantierul primeste instiintare, nu 'se apropie termenul'", async ({ page }) => {
    const sb = serviciu();
    const ilie = await profilDupaEmail(CONTURI.ilie);
    const elena = await profilDupaEmail(CONTURI.elena);
    const inainte = new Date().toISOString();

    await intraCa(page, "admin");
    await buton(page, "Trimite reminder de plata").click();
    await asteaptaToast(page, "locatari");

    const ultima = async (profilId) => {
      const { data } = await sb.schema("comunicare").from("notificari")
        .select("titlu, corp, tip, trimisa_la").eq("profil_id", profilId)
        .gte("trimisa_la", inainte).order("trimisa_la", { ascending: false }).limit(1);
      return (data || [])[0];
    };

    await expect.poll(async () => (await ultima(ilie.id) || {}).titlu, { timeout: 20000 })
      .toBe("Instiintare de plata");
    const laIlie = await ultima(ilie.id);
    expect(laIlie.corp).not.toContain("Se apropie termenul");
    expect(laIlie.tip).toBe("restanta");

    const laElena = await ultima(elena.id);
    expect(laElena.titlu).toBe("Reamintire de plata");
    expect(laElena.corp).toContain("Se apropie termenul");

    /* Restantierul vede mesajul rosu pe Acasa */
    await buton(page, "Iesi").click();
    await intraCa(page, "ilie");
    await expect(page.getByText("Instiintare de plata").first()).toBeVisible();

    await sb.schema("comunicare").from("notificari").delete().gte("trimisa_la", inainte)
      .in("profil_id", [ilie.id, elena.id]);
  });
});

test.describe("Convocarea adunarii ajunge cu ora [K6]", () => {
  const LOC = "E2E Sala de la parter";

  /* Adunarea si notificarile ei pleaca din baza oricum s-ar termina testul:
     altfel o adunare ramasa in plus strica alte teste (transversal). */
  test.afterEach(async () => {
    const sb = serviciu();
    const b = await blocD14();
    const { data: ag } = await sb.schema("guvernanta").from("adunari_generale")
      .select("id").eq("asociatie_id", b.asociatie_id).eq("loc", LOC);
    for (const a of ag || []) {
      await sb.schema("guvernanta").from("adunari_prezente").delete().eq("adunare_id", a.id);
      await sb.schema("guvernanta").from("adunari_generale").delete().eq("id", a.id);
    }
    await sb.schema("comunicare").from("notificari").delete().eq("tip", "adunare_generala").like("corp", `%${LOC}%`);
  });

  test("notificarea si cardul locatarului spun ora", async ({ page }) => {
    const sb = serviciu();
    const elena = await profilDupaEmail(CONTURI.elena);
    const zi = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);

    await intraCa(page, "admin");
    await mergiLaTab(page, "Comunicare");
    await page.getByRole("button", { name: "Vot si AG" }).click();
    await buton(page, "Convoaca adunarea").click();
    const panou = page.getByRole("dialog", { name: "Convoaca adunarea generala" });
    await panou.getByLabel("Data").fill(zi);
    await panou.getByLabel("Ora").fill("19:30");
    await panou.getByLabel("Locul").fill(LOC);
    await panou.getByLabel("Ordinea de zi").fill("E2E punct unic pe ordinea de zi");
    await buton(page, "Trimite convocarea").click();
    await asteaptaToast(page, "Convocarea a fost trimisa");

    /* Notificarile pleaca prin coada de evenimente, deci nu sunt gata imediat */
    await expect.poll(async () => {
      const { data } = await sb.schema("comunicare").from("notificari")
        .select("titlu, corp").eq("profil_id", elena.id).eq("tip", "adunare_generala")
        .like("corp", `%${LOC}%`);
      return (data || []).map((n) => `${n.titlu}|${n.corp}`).join(" ");
    }, { timeout: 30000 }).toContain("ora 19:30");

    const { data: notificari } = await sb.schema("comunicare").from("notificari")
      .select("titlu").eq("profil_id", elena.id).eq("tip", "adunare_generala").like("corp", `%${LOC}%`);
    expect(notificari[0].titlu).toBe("Convocare la adunarea generala");

    await buton(page, "Iesi").click();
    await intraCa(page, "elena");
    await mergiLaTab(page, "Bloc");
    await page.getByRole("button", { name: "Vot si adunare" }).click();
    await expect(page.getByText(new RegExp(`Ora 19:30, ${LOC}`))).toBeVisible();
  });
});

test.describe("Avizierul marcheaza tot lotul deodata [K1]", () => {
  test("trei anunturi necitite fac o singura reincarcare", async ({ page }) => {
    const sb = serviciu();
    const elena = await profilDupaEmail(CONTURI.elena);
    /* Toate anunturile asociatiei redevin necitite pentru Elena */
    const b = await blocD14();
    const { data: anunturi } = await sb.schema("comunicare").from("anunturi")
      .select("id").eq("asociatie_id", b.asociatie_id);
    expect(anunturi.length).toBeGreaterThanOrEqual(2);
    const { data: citiriVechi } = await sb.schema("comunicare").from("anunturi_citiri")
      .select("anunt_id").eq("profil_id", elena.id);
    await sb.schema("comunicare").from("anunturi_citiri").delete().eq("profil_id", elena.id);

    try {
      await intraCa(page, "elena");
      let incarcari = 0;
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().endsWith("/rest/v1/rpc/eu")) incarcari += 1;
      });
      await mergiLaTab(page, "Bloc");
      await expect(page.getByText("Avizier")).toBeVisible();
      await expect.poll(async () => {
        const { count } = await sb.schema("comunicare").from("anunturi_citiri")
          .select("anunt_id", { count: "exact", head: true }).eq("profil_id", elena.id);
        return count;
      }, { timeout: 20000 }).toBe(anunturi.length);
      /* Timp de asteptare, ca o eventuala reincarcare in plus sa se vada */
      await expect(page.getByText("Avizier")).toBeVisible();
      await page.waitForTimeout(1500);
      expect(incarcari).toBe(1);
    } finally {
      for (const c of citiriVechi || []) {
        await sb.schema("comunicare").from("anunturi_citiri")
          .upsert({ profil_id: elena.id, anunt_id: c.anunt_id }, { onConflict: "anunt_id,profil_id" });
      }
    }
  });
});
