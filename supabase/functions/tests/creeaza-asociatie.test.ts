// creeaza-asociatie: asociatia prin SQL, apoi contul administratorului prin
// API-ul de administrare Auth, apoi numirea lui. Doar cu cheia de serviciu.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { type Apel, cerere, CHEIE_SERVICIU, citeste, cuFetch, eroarePg, incarcaHandler, json, JWT_SERVICIU, JWT_UTILIZATOR, randuri } from "./ajutor.ts";

const handler = await incarcaHandler("../creeaza-asociatie/index.ts");

const P = {
  creeaza: "/rest/v1/rpc/creeaza_asociatie",
  profiluri: "/rest/v1/profiluri",
  utilizatori: "/auth/v1/admin/users",
  numeste: "/rest/v1/rpc/numeste_administrator",
};
const CREATA = { asociatie_id: "asoc-1", bloc_id: "bloc-1" };
const CORP = {
  asociatie: { denumire: "Asociatia D14", cui: "RO123" },
  setari: { zi_scadenta: 25 },
  bloc: { cod: "D14" },
  administrator: { nume: "Maria Ionescu", telefon: "0745 210 118", atestat: "AT-9", parola: "Parola-1", activDin: "2026-09-01" },
};

function backend(o: {
  creeaza?: () => Response;
  existent?: unknown[];
  utilizatori?: () => Response;
  numeste?: () => Response;
} = {}) {
  return (a: Apel) => {
    switch (a.url.pathname) {
      case P.creeaza: return o.creeaza ? o.creeaza() : json(CREATA);
      case P.profiluri: return randuri(a, o.existent ?? []);
      case P.utilizatori: return o.utilizatori ? o.utilizatori() : json({ id: "profil-nou", email: a.corp.email });
      case P.numeste: return o.numeste ? o.numeste() : json(null);
    }
  };
}

const trimite = (corp: unknown, token = CHEIE_SERVICIU) => handler(cerere("creeaza-asociatie", { token, corp }));

Deno.test("creeaza-asociatie: OPTIONS raspunde cu 200", async () => {
  const r = await handler(cerere("creeaza-asociatie", { metoda: "OPTIONS" }));
  assertEquals(r.status, 200);
  assertEquals(await r.text(), "ok");
  // ce origini primesc antetul Allow-Origin: cors.test.ts
});

Deno.test("creeaza-asociatie: un administrator obisnuit nu poate crea asociatii -> 403", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await trimite(CORP, JWT_UTILIZATOR));
    assertEquals(r.status, 403);
    assertEquals(r.corp, { eroare: "Doar dezvoltatorul creeaza asociatii." });
    assertEquals(f.apeluri.length, 0);
  });
});

Deno.test("creeaza-asociatie: corp care nu e JSON -> 500", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await trimite("{"));
    assertEquals(r.status, 500);
    assert(typeof r.corp.eroare === "string");
    assertEquals(f.apeluri.length, 0);
  });
});

Deno.test("creeaza-asociatie: eroarea din creeaza_asociatie -> 400, fara cont creat", async () => {
  await cuFetch(backend({ creeaza: () => eroarePg("CUI invalid.") }), async (f) => {
    const r = await citeste(await trimite(CORP));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "CUI invalid." });
    assertEquals(f.catre(P.utilizatori).length + f.catre(P.numeste).length, 0);
  });
});

for (const [caz, administrator] of [["fara administrator", undefined], ["administrator fara telefon", { nume: "X" }]] as const) {
  Deno.test(`creeaza-asociatie: ${caz} -> doar asociatia, administrator null`, async () => {
    await cuFetch(backend(), async (f) => {
      const r = await citeste(await trimite({ ...CORP, administrator }));
      assertEquals(r.status, 200);
      assertEquals(r.corp, { ...CREATA, administrator: null });
      assertEquals(f.apeluri.length, 1);
    });
  });
}

Deno.test("creeaza-asociatie: cu parola creeaza contul confirmat si il numeste administrator", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await trimite(CORP));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { ...CREATA, administrator: "profil-nou", parola: "Parola-1" });

    const [c] = f.catre(P.creeaza);
    assertEquals(c.antete.get("Content-Profile"), "organizare");
    assertEquals(c.corp, { p: CORP });

    const [prof] = f.catre(P.profiluri);
    assertEquals(prof.antete.get("Accept-Profile"), "identitate");
    assertEquals(prof.url.searchParams.get("telefon"), "eq.0745210118");

    const [u] = f.catre(P.utilizatori);
    assertEquals(u.antete.get("Authorization"), `Bearer ${CHEIE_SERVICIU}`);
    assertEquals(u.corp.email, "0745210118@telefon.adminbloc.invalid");
    assertEquals(u.corp.phone, "+40745210118");
    assertEquals(u.corp.password, "Parola-1");
    assertEquals(u.corp.email_confirm, true);
    assertEquals(u.corp.user_metadata, { nume: "Maria Ionescu", telefon: "0745210118" });

    const [n] = f.catre(P.numeste);
    assertEquals(n.antete.get("Content-Profile"), "identitate");
    assertEquals(n.corp, { p_profil_id: "profil-nou", p_asociatie_id: "asoc-1", p_numar_atestat: "AT-9", p_activ_din: "2026-09-01" });
  });
});

Deno.test("creeaza-asociatie: fara parola ceruta, sistemul alege una si o intoarce; atestat si data lipsa -> null si azi", async () => {
  const { parola: _p, atestat: _a, activDin: _d, ...fara } = CORP.administrator;
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await trimite({ ...CORP, administrator: fara }));
    assertEquals(r.status, 200);
    assertEquals(r.corp.administrator, "profil-nou");
    assert(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/.test(r.corp.parola), r.corp.parola);
    assertEquals(f.catre(P.utilizatori)[0].corp.password, r.corp.parola);
    const [n] = f.catre(P.numeste);
    assertEquals(n.corp.p_numar_atestat, null);
    assertEquals(n.corp.p_activ_din, new Date().toISOString().slice(0, 10));
  });
});

Deno.test("creeaza-asociatie: rulata din nou refoloseste profilul existent, fara cont nou", async () => {
  await cuFetch(backend({ existent: [{ id: "profil-vechi" }] }), async (f) => {
    const r = await citeste(await trimite(CORP));
    assertEquals(r.status, 200);
    assertEquals(r.corp.administrator, "profil-vechi");
    assertEquals(f.catre(P.utilizatori).length, 0);
    assertEquals(f.catre(P.numeste)[0].corp.p_profil_id, "profil-vechi");
  });
});

Deno.test("creeaza-asociatie: Auth refuza crearea contului -> 400 cu mesajul Auth", async () => {
  await cuFetch(backend({ utilizatori: () => json({ code: "weak_password", msg: "Password is too weak" }, 422) }), async (f) => {
    const r = await citeste(await trimite(CORP));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Password is too weak" });
    assertEquals(f.catre(P.numeste).length, 0);
  });
});

Deno.test("creeaza-asociatie: rulata din nou refoloseste profilul gasit dupa numar, fara parola noua", async () => {
  await cuFetch(backend({ existent: [{ id: "profil-vechi" }] }), async (f) => {
    const r = await citeste(await trimite(CORP));
    assertEquals(r.corp.parola, null);
    assertEquals(f.catre(P.utilizatori).length, 0);
  });
});

Deno.test("creeaza-asociatie: numirea refuzata -> 400", async () => {
  await cuFetch(backend({ numeste: () => eroarePg("Atestat expirat.") }), async () => {
    const r = await citeste(await trimite(CORP));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Atestat expirat." });
  });
});

// S6 (audit 2026-09-19, `_shared/server.ts`): esteServiciu are incredere in
// rolul din JWT fara sa-i verifice semnatura. Dupa reparatie: BUG_S6 = false.
const BUG_S6 = true;

Deno.test({
  name: "[S6] creeaza-asociatie: un JWT nesemnat cu role=service_role este refuzat",
  ignore: BUG_S6,
  fn: async () => {
    await cuFetch(backend(), async (f) => {
      const r = await trimite({ ...CORP, administrator: undefined }, JWT_SERVICIU);
      assertEquals(r.status, 403);
      assertEquals(f.apeluri.length, 0);
    });
  },
});
