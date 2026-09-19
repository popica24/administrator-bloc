// plata-card: stratul anticoruptie spre procesator. Include si lantul complet
// plata-card -> procesator-simulat -> plata-card-webhook, rulat in proces.
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  type Apel, cerere, CHEIE_SERVICIU, citeste, cuFetch, eroarePg, incarcaHandler, json, JWT_UTILIZATOR, randuri, SECRET_TEST, URL_TEST,
} from "./ajutor.ts";

Deno.env.set("PROCESATOR_SECRET", SECRET_TEST);
const plataCard = await incarcaHandler("../plata-card/index.ts");
const procesator = await incarcaHandler("../procesator-simulat/index.ts");
const webhook = await incarcaHandler("../plata-card-webhook/index.ts");

const UTILIZATOR = { id: "profil-locatar-1", email: "ion@test.ro", aud: "authenticated", role: "authenticated" };
const CARD_BUN = { numar: "4242 4242 4242 4242", expira: "12/30", cvc: "123", nume: "Ion Pop" };
const CARD_REFUZAT = { ...CARD_BUN, numar: "4000 0000 0000 0002" };
const P = {
  user: "/auth/v1/user",
  creeaza: "/rest/v1/rpc/creeaza_plata_card",
  procesator: "/functions/v1/procesator-simulat",
  plati: "/rest/v1/plati",
  chitante: "/rest/v1/chitante",
};

const plateste = (corp: unknown, token: string | null = JWT_UTILIZATOR) => plataCard(cerere("plata-card", { token: token ?? undefined, corp }));

// Backend fals configurabil pentru un singur test.
function backend(o: {
  user?: () => Response;
  creeaza?: () => Response;
  procesator?: (a: Apel) => Response | Promise<Response>;
  stare?: string | null;
  chitanta?: unknown;
}) {
  return (a: Apel) => {
    switch (a.url.pathname) {
      case P.user: return o.user ? o.user() : json(UTILIZATOR);
      case P.creeaza: return o.creeaza ? o.creeaza() : json("plata-1");
      case P.procesator: return o.procesator ? o.procesator(a) : json({ referinta: a.corp.referinta, stare: "autorizata", webhook: 200 });
      case P.plati: return randuri(a, o.stare === null ? [] : [{ id: "plata-1", stare: o.stare ?? "confirmata" }]);
      case P.chitante: return randuri(a, [o.chitanta ?? { serie: "D14", numar: 12 }]);
    }
  };
}

Deno.test("plata-card: OPTIONS raspunde cu CORS, GET este refuzat cu 405", async () => {
  assertEquals((await plataCard(cerere("plata-card", { metoda: "OPTIONS" }))).status, 200);
  const r = await citeste(await plataCard(cerere("plata-card", { metoda: "GET", token: JWT_UTILIZATOR })));
  assertEquals(r.status, 405);
  assertEquals(r.corp, { eroare: "Metoda nu este permisa." });
});

Deno.test("plata-card: un corp care nu e JSON da 500, fara plata creata", async () => {
  await cuFetch(backend({}), async (f) => {
    const r = await citeste(await plateste("{nu e json"));
    assertEquals(r.status, 500);
    assert(typeof r.corp.eroare === "string");
    assertEquals(f.catre(P.creeaza).length, 0);
  });
});

Deno.test("plata-card: fara token -> 401", async () => {
  await cuFetch(backend({ user: () => json({ msg: "no jwt", code: "no_authorization" }, 401) }), async (f) => {
    const r = await citeste(await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN }, null));
    assertEquals(r.status, 401);
    assertEquals(r.corp, { eroare: "Nu esti autentificat." });
    assertEquals(f.catre(P.creeaza).length, 0);
  });
});

Deno.test("plata-card: token respins de Auth -> 401", async () => {
  await cuFetch(backend({ user: () => json({ msg: "invalid JWT", code: "bad_jwt" }, 403) }), async (f) => {
    const r = await citeste(await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN }));
    assertEquals(r.status, 401);
    assertEquals(f.catre(P.user)[0].antete.get("Authorization"), `Bearer ${JWT_UTILIZATOR}`);
    assertEquals(f.catre(P.creeaza).length, 0);
  });
});

Deno.test("plata-card: Auth fara eroare dar fara utilizator -> 401", async () => {
  await cuFetch(backend({ user: () => json(false) }), async (f) => {
    const r = await citeste(await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN }));
    assertEquals(r.status, 401);
    assertEquals(f.catre(P.creeaza).length, 0);
  });
});

for (const suma of [0, -5, "abc", undefined, null]) {
  Deno.test(`plata-card: suma ${JSON.stringify(suma)} este refuzata cu 400`, async () => {
    await cuFetch(backend({}), async (f) => {
      const r = await citeste(await plateste({ apartament_id: "a1", suma, card: CARD_BUN }));
      assertEquals(r.status, 400);
      assertEquals(r.corp, { eroare: "Suma trebuie sa fie mai mare decat zero." });
      assertEquals(f.catre(P.creeaza).length, 0);
    });
  });
}

for (const [caz, card] of [
  ["fara card", undefined],
  ["card fara numar", { expira: "12/30" }],
  ["numar de 12 cifre", { numar: "4242 4242 4242" }],
  ["numar din litere", { numar: "abcdabcdabcdabcd" }],
] as const) {
  Deno.test(`plata-card: ${caz} -> 400 "Numarul cardului nu este complet."`, async () => {
    await cuFetch(backend({}), async (f) => {
      const r = await citeste(await plateste({ apartament_id: "a1", suma: 10, card }));
      assertEquals(r.status, 400);
      assertEquals(r.corp, { eroare: "Numarul cardului nu este complet." });
      assertEquals(f.catre(P.creeaza).length, 0);
    });
  });
}

Deno.test("plata-card: refuzul lui creeaza_plata_card (apartament strain) -> 403, procesatorul nu e apelat", async () => {
  await cuFetch(backend({ creeaza: () => eroarePg("Nu poti plati pentru acest apartament.") }), async (f) => {
    const r = await citeste(await plateste({ apartament_id: "strain", suma: 10, card: CARD_BUN }));
    assertEquals(r.status, 403);
    assertEquals(r.corp, { eroare: "Nu poti plati pentru acest apartament." });
    assertEquals(f.catre(P.procesator).length, 0);
  });
});

Deno.test("plata-card: plata confirmata -> 200 cu chitanta; cardul merge doar la procesator", async () => {
  await cuFetch(backend({ stare: "confirmata", chitanta: { serie: "D14", numar: 7 } }), async (f) => {
    const r = await citeste(await plateste({ apartament_id: "ap-3", suma: "150.50", card: CARD_BUN }));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { plataId: "plata-1", stare: "confirmata", chitanta: { serie: "D14", numar: 7 } });

    const [creeaza] = f.catre(P.creeaza);
    assertEquals(creeaza.antete.get("Authorization"), `Bearer ${CHEIE_SERVICIU}`);
    assertEquals(creeaza.antete.get("Content-Profile"), "financiar");
    assertMatch(creeaza.corp.p_referinta, /^SIM-[0-9A-F]{8}-[0-9A-F]{4}$/);
    assertEquals({ ...creeaza.corp, p_referinta: "-" }, {
      p_apartament_id: "ap-3", p_suma: 150.5, p_platita_de: UTILIZATOR.id, p_procesator: "simulat", p_referinta: "-",
    });

    const [proc] = f.catre(P.procesator);
    assertEquals(proc.url.href, `${URL_TEST}/functions/v1/procesator-simulat`);
    assertEquals(proc.metoda, "POST");
    assertEquals(proc.antete.get("Authorization"), `Bearer ${CHEIE_SERVICIU}`);
    assertEquals(proc.corp, {
      referinta: creeaza.corp.p_referinta,
      suma: 150.5,
      card: { numar: "4242424242424242", expira: "12/30", cvc: "123", nume: "Ion Pop" },
      webhook: `${URL_TEST}/functions/v1/plata-card-webhook`,
    });

    // nimic din card nu ajunge in baza de date
    for (const a of f.apeluri.filter((x) => x.url.pathname.startsWith("/rest/"))) {
      for (const s of ["4242", "123", "12/30", "Ion Pop"]) assertEquals(a.text.includes(s) || a.url.search.includes(s), false);
    }
    assertEquals(f.catre(P.plati)[0].url.searchParams.get("id"), "eq.plata-1");
    assertEquals(f.catre(P.chitante)[0].url.searchParams.get("plata_id"), "eq.plata-1");
  });
});

Deno.test("plata-card: procesatorul refuza -> 402", async () => {
  await cuFetch(backend({ stare: "in_asteptare", procesator: () => json({ stare: "refuzata" }) }), async (f) => {
    const r = await citeste(await plateste({ apartament_id: "a1", suma: 10, card: CARD_REFUZAT }));
    assertEquals(r.status, 402);
    assertEquals(r.corp, { eroare: "Banca a refuzat plata. Nu s-a retras niciun ban." });
    assertEquals(f.catre(P.chitante).length, 0);
  });
});

Deno.test("plata-card: plata esuata in baza, procesator cu raspuns ne-JSON -> 402", async () => {
  await cuFetch(backend({ stare: "esuata", procesator: () => new Response("<html>502</html>", { status: 502 }) }), async () => {
    const r = await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN });
    assertEquals(r.status, 402);
  });
});

Deno.test("plata-card: procesator autorizat dar plata inca neconfirmata -> 202 in_asteptare", async () => {
  await cuFetch(backend({ stare: "in_asteptare" }), async () => {
    const r = await citeste(await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN }));
    assertEquals(r.status, 202);
    assertEquals(r.corp, {
      plataId: "plata-1",
      stare: "in_asteptare",
      mesaj: "Plata asteapta confirmarea bancii. Chitanta apare cand banca o confirma.",
    });
  });
});

Deno.test("plata-card: plata negasita la recitire -> 202 (nu confirmata, nu refuzata)", async () => {
  await cuFetch(backend({ stare: null }), async (f) => {
    const r = await citeste(await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN }));
    assertEquals(r.status, 202);
    assertEquals(r.corp.stare, "in_asteptare");
    assertEquals(f.catre(P.chitante).length, 0);
  });
});

// F8 (audit 2026-09-19): platile in asteptare nu se incarca si nu expira, deci
// omul poate plati de doua ori acelasi lucru. Reparatia cere si o expirare a
// platilor in asteptare, nu doar o verificare aici.
const BUG_F8 = true;

Deno.test({
  name: "[F8] plata-card: cat o plata e in asteptare, a doua nu mai este trimisa la procesator",
  ignore: BUG_F8,
  fn: async () => {
    await cuFetch(backend({ stare: "in_asteptare" }), async (f) => {
      await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN });
      const r = await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN });
      assert(r.status === 409 || r.status === 202);
      assertEquals(f.catre(P.procesator).length, 1);
    });
  },
});

Deno.test("plata-card: procesatorul de negasit (eroare de retea) -> 500", async () => {
  await cuFetch(backend({ procesator: () => { throw new TypeError("connection refused"); } }), async () => {
    const r = await citeste(await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN }));
    assertEquals(r.status, 500);
    assertEquals(r.corp, { eroare: "connection refused" });
  });
});

// N2 (audit 2026-09-19): raspunsul HTTP al procesatorului nu era verificat. Daca
// procesatorul cade (500) sau refuza apelul (403), locatarul afla ca plata
// "asteapta banca", desi cardul nu a ajuns nicaieri si plata ramane in asteptare
// pentru totdeauna.
for (const status of [500, 403]) {
  Deno.test(`[N2] plata-card: procesatorul raspunde ${status} -> 502, nu "in asteptare"`, async () => {
    await cuFetch(backend({ stare: "in_asteptare", procesator: () => json({ eroare: "cazut" }, status) }), async () => {
      const r = await citeste(await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN }));
      assertEquals(r.status, 502);
      assertEquals(r.corp, { eroare: "Procesatorul de plati nu a raspuns. Plata nu a plecat la banca; incearca din nou." });
    });
  });
}

Deno.test("[N2] plata-card: procesatorul cade, dar webhook-ul a confirmat deja plata -> 200 cu chitanta", async () => {
  await cuFetch(backend({ stare: "confirmata", procesator: () => json({ eroare: "cazut" }, 500) }), async () => {
    const r = await citeste(await plateste({ apartament_id: "a1", suma: 10, card: CARD_BUN }));
    assertEquals(r.status, 200);
    assertEquals(r.corp.stare, "confirmata");
  });
});

// ---------------------------------------------------------------- lantul complet

// O baza de date minima pentru plati, cu procesatorul si webhook-ul reale.
function lant() {
  const plati = new Map<string, { id: string; referinta: string; stare: string }>();
  let n = 0;
  return (a: Apel): Response | Promise<Response> | undefined => {
    const inainte = (h: (r: Request) => Response | Promise<Response>) =>
      h(new Request(a.url, { method: a.metoda, headers: a.antete, body: a.text }));
    switch (a.url.pathname) {
      case P.user: return json(UTILIZATOR);
      case P.creeaza: {
        const id = `plata-${++n}`;
        plati.set(id, { id, referinta: a.corp.p_referinta, stare: "in_asteptare" });
        return json(id);
      }
      case P.procesator: return inainte(procesator);
      case "/functions/v1/plata-card-webhook": return inainte(webhook);
      case "/rest/v1/rpc/confirma_plata_card": {
        const p = [...plati.values()].find((x) => x.referinta === a.corp.p_referinta);
        if (!p) return eroarePg("Plata nu exista.");
        if (p.stare === "in_asteptare") p.stare = a.corp.p_reusita ? "confirmata" : "esuata";
        return json(p.id);
      }
      case P.plati: return randuri(a, [plati.get(a.url.searchParams.get("id")!.slice(3))!]);
      case P.chitante: return randuri(a, [{ serie: "D14", numar: n }]);
    }
  };
}

Deno.test("lant: cardul 4242... trece prin procesator si webhook -> 200 confirmata", async () => {
  await cuFetch(lant(), async (f) => {
    const r = await citeste(await plateste({ apartament_id: "a1", suma: 99, card: CARD_BUN }));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { plataId: "plata-1", stare: "confirmata", chitanta: { serie: "D14", numar: 1 } });
    const [conf] = f.catre("/rest/v1/rpc/confirma_plata_card");
    assertEquals(conf.corp.p_reusita, true);
    assertEquals(conf.antete.get("Authorization"), `Bearer ${CHEIE_SERVICIU}`);
  });
});

Deno.test("lant: cardul 4000...0002 este refuzat -> 402, plata ramane esuata", async () => {
  await cuFetch(lant(), async (f) => {
    const r = await plateste({ apartament_id: "a1", suma: 99, card: CARD_REFUZAT });
    assertEquals(r.status, 402);
    assertEquals(f.catre("/rest/v1/rpc/confirma_plata_card")[0].corp.p_reusita, false);
    assertEquals(f.catre(P.chitante).length, 0);
  });
});
