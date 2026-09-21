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
    /* Adresa si cheia anonima ale stack-ului local, date explicit. Pe un
       laptop le da `.env.local`, dar acela nu e in git: pe CI aplicatia pornea
       fara ele, deci in modul demonstrativ, iar 234 de teste picau fiindca ce
       se facea pe ecran nu ajungea niciodata in baza. Cheia e cea implicita a
       oricarui `supabase start` (aceeasi cu CHEIE_ANON din tests/e2e/ajutor.js),
       nu un secret. */
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_ANON_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
    },
  },
});
