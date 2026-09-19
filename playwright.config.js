import { defineConfig, devices } from "@playwright/test";

/* Testele end-to-end pornesc aplicatia reala (Vite) peste stack-ul Supabase
   local, cu datele demo incarcate (supabase start && supabase db reset &&
   npm run seed). Conturile sunt cele din conturi-test.txt.

   Telefonul este mediul real al aplicatiei: o coloana ingusta, deci proiectul
   implicit foloseste un ecran de telefon. Proiectul "desktop" verifica doar ca
   aceeasi coloana se comporta si pe ecran mare. */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { outputFolder: "coverage/e2e", open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    locale: "ro-RO",
    timezoneId: "Europe/Bucharest",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "telefon", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev -- --no-open",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
