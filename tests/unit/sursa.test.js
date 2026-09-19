/* Alegerea sursei de date: demo fara variabile Supabase, Supabase cu ele,
   si o singura sursa pe pagina. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const creeazaSursaSupabase = vi.fn((url, cheie) => ({ tip: "supabase", url, cheie }));
vi.mock("../../src/sursa-supabase.js", () => ({ creeazaSursaSupabase: (...a) => creeazaSursaSupabase(...a) }));

async function modulNou() {
  vi.resetModules();
  return import("../../src/sursa.js");
}

describe("creeazaSursa", () => {
  beforeEach(() => creeazaSursaSupabase.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it("fara VITE_SUPABASE_URL si cheie porneste modul demonstrativ", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { creeazaSursa } = await modulNou();
    const s = creeazaSursa();
    expect(s.tip).toBe("demo");
    expect(typeof s.incarca).toBe("function");
    expect(creeazaSursaSupabase).not.toHaveBeenCalled();
  });

  it("cu URL dar fara cheie ramane tot demo", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { creeazaSursa } = await modulNou();
    expect(creeazaSursa().tip).toBe("demo");
    expect(creeazaSursaSupabase).not.toHaveBeenCalled();
  });

  it("cu URL si cheie foloseste Supabase, cu exact valorile din mediu", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "cheie-anon");
    const { creeazaSursa } = await modulNou();
    expect(creeazaSursa().tip).toBe("supabase");
    expect(creeazaSursaSupabase).toHaveBeenCalledWith("http://127.0.0.1:54321", "cheie-anon");
  });

  it("intoarce mereu aceeasi sursa (clientul nu se dubleaza)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "cheie-anon");
    const { creeazaSursa } = await modulNou();
    const a = creeazaSursa();
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const b = creeazaSursa();
    expect(b).toBe(a);
    expect(creeazaSursaSupabase).toHaveBeenCalledTimes(1);
  });
});
