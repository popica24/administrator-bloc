import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Caile relative fac build-ul rulabil si dintr-un subdirector (ex. GitHub Pages).
  base: "./",
  server: {
    open: true,
  },
});
