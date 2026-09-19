import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/* Doua proiecte de teste:
   - unit: motorul, PDF-ul, sursa demonstrativa si interfata, in jsdom, fara server;
   - integrare: sursa-supabase.js contra stack-ului local (supabase start + npm run seed).
   Pragul de acoperire este 100% pe tot codul aplicatiei. */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{js,jsx}"],
          setupFiles: ["tests/setup-unit.js"],
          /* Ecranele randeaza toata aplicatia; sub coverage si in paralel dureaza */
          testTimeout: 20000,
        },
      },
      {
        extends: true,
        test: {
          name: "integrare",
          environment: "node",
          include: ["tests/integrare/**/*.test.js"],
          setupFiles: ["tests/setup-integrare.js"],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{js,jsx}", "supabase/functions/_shared/motor.js"],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage/js",
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
