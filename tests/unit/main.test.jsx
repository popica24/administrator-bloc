/* Punctul de intrare: monteaza aplicatia in #root, in StrictMode. */
import { it, expect, vi } from "vitest";
import { screen, act } from "@testing-library/react";

vi.mock("../../src/AdminBloc.jsx", () => ({
  default: function AdminBlocFals() {
    return <p>aplicatia pornita</p>;
  },
}));

it("randeaza AdminBloc in elementul #root", async () => {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  await act(async () => { await import("../../src/main.jsx"); });
  const p = await screen.findByText("aplicatia pornita");
  expect(root.contains(p)).toBe(true);
});
