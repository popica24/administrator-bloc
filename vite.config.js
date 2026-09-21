import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  /* Doua pagini: aplicatia si pagina publica "Cum functioneaza AdminBloc",
     care se deschide fara cont, la /cum-functioneaza/ */
  build: {
    rollupOptions: {
      input: {
        aplicatie: fileURLToPath(new URL("./index.html", import.meta.url)),
        cumFunctioneaza: fileURLToPath(new URL("./cum-functioneaza/index.html", import.meta.url)),
      },
    },
  },
  // Caile relative fac build-ul rulabil si dintr-un subdirector (ex. GitHub Pages).
  base: "./",
  server: {
    open: true,
  },
});
