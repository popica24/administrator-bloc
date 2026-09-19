// publica-lista: motorul ruleaza o singura data, la publicare, iar rezultatul
// se scrie printr-o singura functie SQL.
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { type Apel, cerere, CHEIE_SERVICIU, citeste, cuFetch, eroarePg, incarcaHandler, json, JWT_SERVICIU, JWT_UTILIZATOR } from "./ajutor.ts";

const handler = await incarcaHandler("../publica-lista/index.ts");

const P = {
  user: "/auth/v1/user",
  date: "/rest/v1/rpc/date_pentru_motor",
  salveaza: "/rest/v1/rpc/salveaza_lista_publicata",
  proceseaza: "/rest/v1/rpc/proceseaza_eveniment",
};
const ADMIN = { id: "profil-admin-1", aud: "authenticated", role: "authenticated" };

// Date cum le intoarce Postgres: numeric ca text, scutitLift uneori lipsa.
function dateMotor(stare = "ciorna") {
  return {
    lista: { id: "lista-1", stare },
    apartamente: [
      { id: "a1", persoane: "1", cota: "25", scutitLift: true },
      { id: "a2", persoane: 3, cota: "75" },
    ],
    cheltuieli: [
      { id: "c1", cod: "CURAT", suma: "100", metoda: "persoane", tipApa: null },
      { id: "c2", cod: "LIFT", suma: 90, metoda: "persoane_fara_lift", tipApa: null },
      { id: "c3", cod: "APA", suma: "40", metoda: "consum", tipApa: "rece" },
    ],
    consum: { a1: { rece: "2" }, a2: { rece: 6 } },
    contorGeneral: { rece: "10" },
  };
}

function backend(o: {
  user?: () => Response;
  date?: () => Response;
  salveaza?: () => Response;
  proceseaza?: (n: number) => Response;
} = {}) {
  let n = 0;
  return (a: Apel) => {
    switch (a.url.pathname) {
      case P.user: return o.user ? o.user() : json(ADMIN);
      case P.date: return o.date ? o.date() : json(dateMotor());
      case P.salveaza: return o.salveaza ? o.salveaza() : json(501);
      case P.proceseaza: return o.proceseaza ? o.proceseaza(++n) : json(true);
    }
  };
}

const publica = (corp: unknown, token: string = JWT_UTILIZATOR) => handler(cerere("publica-lista", { token, corp }));

Deno.test("publica-lista: OPTIONS -> CORS, GET -> 405", async () => {
  assertEquals((await handler(cerere("publica-lista", { metoda: "OPTIONS" }))).status, 200);
  const r = await citeste(await handler(cerere("publica-lista", { metoda: "GET", token: JWT_UTILIZATOR })));
  assertEquals(r.status, 405);
  assertEquals(r.corp, { eroare: "Metoda nu este permisa." });
});

Deno.test("publica-lista: corp care nu e JSON -> 500", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await publica("nu e json"));
    assertEquals(r.status, 500);
    assertEquals(f.apeluri.length, 0);
  });
});

Deno.test("publica-lista: fara lista_id -> 400", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await publica({}));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Lipseste lista_id." });
    assertEquals(f.apeluri.length, 0);
  });
});

Deno.test("publica-lista: un administrator nu poate cere recalculare -> 403", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await publica({ lista_id: "lista-1", recalculare: true }));
    assertEquals(r.status, 403);
    assertEquals(r.corp, { eroare: "Recalcularea unei liste publicate o face doar dezvoltatorul." });
    assertEquals(f.apeluri.length, 0);
  });
});

Deno.test("publica-lista: token respins de Auth -> 401", async () => {
  await cuFetch(backend({ user: () => json({ msg: "bad jwt" }, 401) }), async (f) => {
    const r = await citeste(await publica({ lista_id: "lista-1" }));
    assertEquals(r.status, 401);
    assertEquals(r.corp, { eroare: "Nu esti autentificat." });
    assertEquals(f.catre(P.date).length, 0);
  });
});

Deno.test("publica-lista: Auth fara utilizator -> 401", async () => {
  await cuFetch(backend({ user: () => json(false) }), async (f) => {
    assertEquals((await publica({ lista_id: "lista-1" })).status, 401);
    assertEquals(f.catre(P.date).length, 0);
  });
});

Deno.test("publica-lista: date_pentru_motor refuza (nu administrezi blocul) -> 403", async () => {
  await cuFetch(backend({ date: () => eroarePg("Nu administrezi acest bloc.") }), async (f) => {
    const r = await citeste(await publica({ lista_id: "lista-1" }));
    assertEquals(r.status, 403);
    assertEquals(r.corp, { eroare: "Nu administrezi acest bloc." });
    // citirea se face cu tokenul administratorului, nu cu cheia de serviciu
    const [apel] = f.catre(P.date);
    assertEquals(apel.antete.get("Authorization"), `Bearer ${JWT_UTILIZATOR}`);
    assertEquals(apel.corp, { p_lista_id: "lista-1" });
    assertEquals(f.catre(P.salveaza).length, 0);
  });
});

Deno.test("publica-lista: o lista deja publicata nu se republica -> 400", async () => {
  await cuFetch(backend({ date: () => json(dateMotor("publicata")) }), async (f) => {
    const r = await citeste(await publica({ lista_id: "lista-1" }));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Lista este deja publicata." });
    assertEquals(f.catre(P.salveaza).length, 0);
  });
});

Deno.test("publica-lista: date incomplete -> 422 cu problemele motorului, nimic salvat", async () => {
  await cuFetch(backend({ date: () => json({ ...dateMotor(), apartamente: [] }) }), async (f) => {
    const r = await citeste(await publica({ lista_id: "lista-1" }));
    assertEquals(r.status, 422);
    assert(r.corp.eroare.startsWith("Lista nu se poate calcula: "));
    assert(r.corp.eroare.includes("Blocul nu are apartamente."));
    assertEquals(f.catre(P.salveaza).length, 0);
  });
});

Deno.test("publica-lista: administratorul publica; motorul primeste numere, rezultatul se salveaza o data", async () => {
  await cuFetch(backend(), async (f) => {
    const inainte = Date.now();
    // publicata_la trimis de un administrator se ignora (nu poate antedata)
    const r = await citeste(await publica({ lista_id: "lista-1", publicata_la: "2020-01-01T00:00:00Z" }));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { lista_id: "lista-1", eveniment: 501, procesat: true, total_cheltuieli: 230, total_repartizat: 230 });

    const [s] = f.catre(P.salveaza);
    assertEquals(s.antete.get("Authorization"), `Bearer ${CHEIE_SERVICIU}`);
    assertEquals(s.antete.get("Content-Profile"), "intretinere");
    assertEquals(s.corp.p_lista_id, "lista-1");
    assertEquals(s.corp.p_publicata_de, ADMIN.id);
    assertEquals(s.corp.p_recalculare, false);
    assertAlmostEquals(Date.parse(s.corp.p_publicata_la), inainte, 5000);

    const rep = s.corp.p_rezultat.repartizari as { cheltuialaId: string; apartamentId: string; suma: number }[];
    const suma = (c: string, a: string) => rep.find((x) => x.cheltuialaId === c && x.apartamentId === a)!.suma;
    assertEquals(rep.length, 6);
    assertEquals([suma("c1", "a1"), suma("c1", "a2")], [25, 75]);
    // a1 este scutit de lift
    assertEquals([suma("c2", "a1"), suma("c2", "a2")], [0, 90]);
    // apa: 4 lei/mc; diferenta de 2 mc se imparte pe persoane (0,5 si 1,5)
    assertEquals([suma("c3", "a1"), suma("c3", "a2")], [10, 30]);
    assertEquals(s.corp.p_rezultat.totaluri.persoane, 4);

    const [p] = f.catre(P.proceseaza);
    assertEquals(p.corp, { p_id: 501 });
    assertEquals(p.antete.get("Authorization"), `Bearer ${CHEIE_SERVICIU}`);
  });
});

Deno.test("publica-lista: salvarea refuzata (bloc inactiv, lista schimbata) -> 409, fara procesare", async () => {
  await cuFetch(backend({ salveaza: () => eroarePg("Blocul nu este activ.") }), async (f) => {
    const r = await citeste(await publica({ lista_id: "lista-1" }));
    assertEquals(r.status, 409);
    assertEquals(r.corp, { eroare: "Blocul nu este activ." });
    assertEquals(f.catre(P.proceseaza).length, 0);
  });
});

Deno.test("publica-lista: dezvoltatorul recalculeaza o lista publicata, cu data aleasa", async () => {
  await cuFetch(backend({ date: () => json(dateMotor("publicata")) }), async (f) => {
    const r = await citeste(await publica({ lista_id: "lista-1", recalculare: true, publicata_la: "2026-05-05T10:00:00Z" }, JWT_SERVICIU));
    assertEquals(r.status, 200);
    assertEquals(f.catre(P.user).length, 0);
    assertEquals(f.catre(P.date)[0].antete.get("Authorization"), `Bearer ${CHEIE_SERVICIU}`);
    const [s] = f.catre(P.salveaza);
    assertEquals(s.corp.p_publicata_de, null);
    assertEquals(s.corp.p_recalculare, true);
    assertEquals(s.corp.p_publicata_la, "2026-05-05T10:00:00Z");
  });
});

Deno.test("publica-lista: dezvoltatorul fara publicata_la foloseste data de acum", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await publica({ lista_id: "lista-1" }, CHEIE_SERVICIU);
    assertEquals(r.status, 200);
    assertAlmostEquals(Date.parse(f.catre(P.salveaza)[0].corp.p_publicata_la), Date.now(), 5000);
  });
});

Deno.test("publica-lista: fara contor general si fara consum (doar cheltuieli simple)", async () => {
  const d = dateMotor();
  const date = { ...d, cheltuieli: d.cheltuieli.slice(0, 1), consum: null, contorGeneral: null };
  await cuFetch(backend({ date: () => json(date) }), async () => {
    const r = await citeste(await publica({ lista_id: "lista-1" }));
    assertEquals(r.status, 200);
    assertEquals(r.corp.total_repartizat, 100);
  });
});

// S13 (audit 2026-09-19): apelul direct din publica-lista concureaza cu
// webhook-ul bazei; cine pierde cursa intoarce procesat: false, iar ecranul se
// poate reincarca inainte sa existe datoriile. Dupa reparatie: BUG_S13 = false.
const BUG_S13 = true;

Deno.test("publica-lista: daca webhook-ul a luat evenimentul primul, raspunde procesat: false", async () => {
  await cuFetch(backend({ proceseaza: () => json(false) }), async (f) => {
    const r = await citeste(await publica({ lista_id: "lista-1" }));
    assertEquals(r.status, 200);
    assertEquals(r.corp.procesat, false);
    assertEquals(f.catre(P.proceseaza).length, 1);
  });
});

Deno.test("publica-lista: eroarea la procesarea imediata nu strica publicarea (reia jobul)", async () => {
  await cuFetch(backend({ proceseaza: () => eroarePg("handler cazut", 500) }), async () => {
    const r = await citeste(await publica({ lista_id: "lista-1" }));
    assertEquals(r.status, 200);
    assertEquals(r.corp.procesat, false);
  });
});

Deno.test({
  name: "[S13] publica-lista: asteapta ca evenimentul sa fie procesat inainte sa raspunda",
  ignore: BUG_S13,
  fn: async () => {
    // primul apel pierde cursa cu webhook-ul, al doilea gaseste evenimentul procesat
    await cuFetch(backend({ proceseaza: (n) => json(n > 1) }), async () => {
      const r = await citeste(await publica({ lista_id: "lista-1" }));
      assertEquals(r.corp.procesat, true);
    });
  },
});
