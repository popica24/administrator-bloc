import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/* Fusul orar al testelor, ca in playwright.config.js. Aplicatia e pentru blocuri
   din Romania: ecranele arata ore si date romanesti, iar testele le verifica asa
   cum le vede omul. Fara linia asta fusul e al masinii care ruleaza, deci sapte
   teste treceau pe un laptop din Romania si picau pe CI, care sta pe UTC — o
   diferenta de trei ore vara, si o zi intreaga la datele de langa miezul noptii.
   Se pune inainte de orice import care atinge Date. */
process.env.TZ = "Europe/Bucharest";

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
