/* Pagina publica /cum-functioneaza/, pe serverul real: se deschide fara cont,
   lista se calculeaza in pagina, iar legatura duce in aplicatie. */

import { test, expect } from "@playwright/test";

test.describe("pagina publica, cum functioneaza", () => {
  test("se deschide fara cont, iar o suma atinsa isi arata socoteala", async ({ page }) => {
    await page.goto("/cum-functioneaza/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lista de întreținere, cu socoteala la vedere");
    await expect(page.getByRole("table", { name: /Lista de întreținere pe august 2026/ })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Intră în cont")).toHaveCount(0);

    const apaRece = page.getByRole("button", { name: "Ap. 17, Apa rece si canalizare: 203,45 lei" });
    await expect(apaRece).toHaveAttribute("aria-pressed", "true");
    const salubritate = page.getByRole("button", { name: "Ap. 17, Salubritate: 68,57 lei" });
    await salubritate.click();
    await expect(salubritate).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "Socoteala sumei alese" })).toContainText("3 din 49 persoane");
  });

  test("pe un telefon de 320 px, pagina nu se deruleaza lateral; lista da, in foaia ei", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 700 } });
    const page = await ctx.newPage();
    await page.goto("/cum-functioneaza/");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 30000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await ctx.close();
  });

  test("Deschide aplicatia duce la ecranul de intrare", async ({ page }) => {
    await page.goto("/cum-functioneaza/");
    await page.getByRole("link", { name: "Deschide aplicația" }).click();
    await expect(page.getByText("Intră în cont").first()).toBeVisible({ timeout: 20000 });
  });
});
