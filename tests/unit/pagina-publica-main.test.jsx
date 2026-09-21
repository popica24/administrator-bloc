/* Punctul de intrare al paginii publice: monteaza pagina in #pagina. */
import { it, expect, vi } from "vitest";
import { screen, act } from "@testing-library/react";

vi.mock("../../src/pagina-publica.jsx", () => ({
  default: function PaginaFalsa() {
    return <p>pagina pornita</p>;
  },
}));

it("randeaza pagina publica in elementul #pagina", async () => {
  const loc = document.createElement("div");
  loc.id = "pagina";
  document.body.appendChild(loc);
  await act(async () => { await import("../../src/pagina-publica-main.jsx"); });
  const p = await screen.findByText("pagina pornita");
  expect(loc.contains(p)).toBe(true);
});
