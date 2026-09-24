// cont-locatar: administratorul face contul unui locatar (cont Auth + legatura
// cu apartamentul) sau ii da alta parola. Dreptul pe apartament se verifica
// intai, cu tokenul administratorului.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { type Apel, cerere, citeste, cuFetch, eroarePg, incarcaHandler, json, JWT_UTILIZATOR, randuri } from "./ajutor.ts";

const handler = await incarcaHandler("../cont-locatar/index.ts");

const PROFIL = "11111111-1111-4111-8111-111111111111";
const P = {
  drept: "/rest/v1/rpc/apartament_de_administrat",
  utilizatori: "/auth/v1/admin/users",
  utilizator: `/auth/v1/admin/users/${PROFIL}`,
  locatari: "/rest/v1/locatari",
  profiluri: "/rest/v1/profiluri",
  leaga: "/rest/v1/rpc/leaga_locatar",
  conducere: "/rest/v1/rpc/numeste_in_conducere",
  sesiuni: "/rest/v1/rpc/inchide_sesiunile",
  asociatie: "/rest/v1/rpc/asociatia_de_administrat",
  eu: "/auth/v1/user",
};
const AP = "apartament-1";
const NOU = { apartament_id: AP, nume: " Elena Marinescu ", telefon: "0722 123 456", calitate: "chirias" };

function backend(o: {
  drept?: () => Response;
  creare?: () => Response;
  leaga?: () => Response;
  locatari?: unknown[];
  profiluri?: unknown[];
  parolaNoua?: () => Response;
  stergere?: () => Response;
  conducere?: () => Response;
  asociatie?: () => Response;
  sesiuni?: () => Response;
} = {}) {
  return (a: Apel) => {
    if (a.url.pathname === P.eu) return json({ id: "admin-1" });
    switch (a.url.pathname) {
      case P.drept: return o.drept ? o.drept() : json({ apartament_id: AP, bloc_id: "bloc-1", numar: "17" });
      case P.utilizatori: return o.creare ? o.creare() : json({ id: PROFIL });
      case P.utilizator: return a.metoda === "DELETE" ? (o.stergere ? o.stergere() : json({})) : (o.parolaNoua ? o.parolaNoua() : json({ id: PROFIL }));
      case P.locatari: return randuri(a, o.locatari ?? [{ profil_id: PROFIL, activ_pana: null }]);
      case P.profiluri: return randuri(a, o.profiluri ?? []);
      case P.leaga: return o.leaga ? o.leaga() : json("locatar-nou");
      case P.conducere: return o.conducere ? o.conducere() : json("mandat-nou");
      case P.asociatie: return o.asociatie ? o.asociatie() : json("asoc-1");
      case P.sesiuni: return o.sesiuni ? o.sesiuni() : json(null);
    }
  };
}

const trimite = (corp: unknown, token = JWT_UTILIZATOR) => handler(cerere("cont-locatar", { token, corp }));

Deno.test("cont-locatar: OPTIONS raspunde cu 200", async () => {
  const r = await handler(cerere("cont-locatar", { metoda: "OPTIONS" }));
  assertEquals(r.status, 200);
  assertEquals(await r.text(), "ok");
});

Deno.test("cont-locatar: GET nu este permis -> 405", async () => {
  const r = await citeste(await handler(cerere("cont-locatar", { metoda: "GET", token: JWT_UTILIZATOR })));
  assertEquals(r.status, 405);
  assertEquals(r.corp, { eroare: "Metoda nu este permisa." });
});

Deno.test("cont-locatar: fara apartament -> 400", async () => {
  const r = await citeste(await trimite({ nume: "X", telefon: "0722123456" }));
  assertEquals(r.status, 400);
  assertEquals(r.corp, { eroare: "Lipseste apartamentul." });
});

Deno.test("cont-locatar: corp care nu e JSON -> 500", async () => {
  const r = await citeste(await handler(cerere("cont-locatar", { token: JWT_UTILIZATOR, corp: "nu e json" })));
  assertEquals(r.status, 500);
  assert(typeof r.corp.eroare === "string");
});

Deno.test("cont-locatar: fara sesiune -> 401", async () => {
  await cuFetch((a: Apel) => (a.url.pathname === P.eu ? json({ msg: "invalid JWT" }, 401) : undefined), async () => {
    const r = await citeste(await trimite(NOU));
    assertEquals(r.status, 401);
    assertEquals(r.corp, { eroare: "Nu esti autentificat." });
  });
});

Deno.test("cont-locatar: apartamentul altui bloc -> 403, fara sa creeze nimic", async () => {
  await cuFetch(backend({ drept: () => eroarePg("Doar administratorul blocului poate face conturi.", 403) }), async (f) => {
    const r = await citeste(await trimite(NOU));
    assertEquals(r.status, 403);
    assertEquals(r.corp, { eroare: "Doar administratorul blocului poate face conturi." });
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.utilizatori).length, 0);
  });
});

Deno.test("cont-locatar: numarul gresit este refuzat pe romaneste", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await trimite({ ...NOU, telefon: "07221" }));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx." });
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.utilizatori).length, 0);
  });
});

Deno.test("cont-locatar: fara nume -> 400", async () => {
  await cuFetch(backend(), async () => {
    const r = await citeste(await trimite({ ...NOU, nume: "   " }));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Scrie numele locatarului." });
    const fara = await citeste(await trimite({ apartament_id: AP, telefon: "0722123456" }));
    assertEquals(fara.status, 400);
    assertEquals(fara.corp, { eroare: "Scrie numele locatarului." });
  });
});

Deno.test("cont-locatar: contul nou primeste numarul, parola si legatura cu apartamentul", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await trimite(NOU));
    assertEquals(r.status, 200);
    assertEquals(r.corp.locatar_id, "locatar-nou");
    assertEquals(r.corp.profil_id, PROFIL);
    assertEquals(r.corp.telefon, "0722123456");
    assert(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/.test(r.corp.parola), r.corp.parola);

    const creare = f.apeluri.find((a) => a.url.pathname === P.utilizatori)!;
    assertEquals(creare.corp.email, "0722123456@telefon.adminbloc.invalid");
    assertEquals(creare.corp.phone, "+40722123456");
    assertEquals(creare.corp.password, r.corp.parola);
    assertEquals(creare.corp.email_confirm, true);
    assertEquals(creare.corp.user_metadata, { nume: "Elena Marinescu", telefon: "0722123456" });

    const leaga = f.apeluri.find((a) => a.url.pathname === P.leaga)!;
    assertEquals(leaga.corp, { p_profil_id: PROFIL, p_apartament_id: AP, p_calitate: "chirias" });
  });
});

Deno.test("cont-locatar: fara calitate ceruta, omul este proprietar", async () => {
  await cuFetch(backend(), async (f) => {
    await trimite({ apartament_id: AP, nume: "Ion", telefon: "0722123456" });
    assertEquals(f.apeluri.find((a) => a.url.pathname === P.leaga)!.corp.p_calitate, "proprietar");
  });
});

Deno.test("cont-locatar: acelasi numar a doua oara -> mesaj pe romaneste", async () => {
  await cuFetch(backend({ creare: () => json({ msg: "A user with this email address has already been registered" }, 422) }), async () => {
    const r = await citeste(await trimite(NOU));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Exista deja un cont cu acest numar de telefon." });
  });
});

// [A9] Mesajele Auth sunt in engleza si vorbesc despre adresa, pe care omul nu
// o are: administratorul primeste ceva ce poate citi si ce poate face.
Deno.test("cont-locatar: o eroare Auth necunoscuta se spune pe romaneste", async () => {
  await cuFetch(backend({ creare: () => json({ msg: "Database error creating new user" }, 500) }), async () => {
    const r = await citeste(await trimite(NOU));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Contul nu a putut fi facut acum. Incearca din nou peste cateva minute." });
  });
});

Deno.test("cont-locatar: numarul luat deja se spune pe romaneste", async () => {
  await cuFetch(backend({ creare: () => json({ msg: "A user with this email address has already been registered" }, 422) }), async () => {
    const r = await citeste(await trimite(NOU));
    assertEquals(r.corp, { eroare: "Exista deja un cont cu acest numar de telefon." });
  });
});

Deno.test("cont-locatar: daca legarea cade, contul nou se sterge, ca numarul sa ramana liber", async () => {
  await cuFetch(backend({ leaga: () => eroarePg("Contul este deja legat de acest apartament.") }), async (f) => {
    const r = await citeste(await trimite(NOU));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Contul este deja legat de acest apartament." });
    const stergere = f.apeluri.find((a) => a.url.pathname === P.utilizator && a.metoda === "DELETE");
    assert(stergere, "contul nou a ramas in urma");
  });
});

Deno.test("cont-locatar: parola noua se da doar pentru un locatar al apartamentului", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await trimite({ apartament_id: AP, locatar_id: "locatar-1", actiune: "parola" }));
    assertEquals(r.status, 200);
    assert(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/.test(r.corp.parola), r.corp.parola);
    const schimbare = f.apeluri.find((a) => a.url.pathname === P.utilizator && a.metoda === "PUT")!;
    assertEquals(schimbare.corp.password, r.corp.parola);
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.utilizatori).length, 0);
    // [A4] cine era inauntru cu parola veche iese
    const iesire = f.apeluri.find((a) => a.url.pathname === P.sesiuni)!;
    assertEquals(iesire.corp, { p_profil_id: PROFIL });
  });
});

// [A4] Cine s-a mutat nu mai primeste parola noua pe apartamentul acela.
Deno.test("cont-locatar: parola noua pentru un acces inchis -> 400", async () => {
  await cuFetch(backend({ locatari: [{ profil_id: PROFIL, activ_pana: "2020-01-01" }] }), async (f) => {
    const r = await citeste(await trimite({ apartament_id: AP, locatar_id: "locatar-1", actiune: "parola" }));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Locatarul nu mai are acces la acest apartament." });
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.utilizator).length, 0);
  });
});

Deno.test("cont-locatar: inchiderea sesiunilor cazuta se spune ca atare", async () => {
  await cuFetch(backend({ sesiuni: () => eroarePg("nu merg sesiunile", 500) }), async () => {
    const r = await citeste(await trimite({ apartament_id: AP, locatar_id: "locatar-1", actiune: "parola" }));
    assertEquals(r.corp, { eroare: "nu merg sesiunile" });
  });
});

Deno.test("cont-locatar: parola noua fara locatar -> 400", async () => {
  await cuFetch(backend(), async () => {
    const r = await citeste(await trimite({ apartament_id: AP, actiune: "parola" }));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Lipseste locatarul." });
  });
});

Deno.test("cont-locatar: parola noua pentru un locatar al altui apartament -> 404", async () => {
  await cuFetch(backend({ locatari: [] }), async () => {
    const r = await citeste(await trimite({ apartament_id: AP, locatar_id: "locatar-strain", actiune: "parola" }));
    assertEquals(r.status, 404);
    assertEquals(r.corp, { eroare: "Locatarul nu este al acestui apartament." });
  });
});

Deno.test("cont-locatar: cautarea locatarului cazuta se spune ca atare", async () => {
  await cuFetch((a: Apel) => {
    if (a.url.pathname === P.eu) return json({ id: "admin-1" });
    if (a.url.pathname === P.drept) return json({ apartament_id: AP });
    if (a.url.pathname === P.locatari) return eroarePg("nu merge cautarea", 500);
    return undefined;
  }, async () => {
    const r = await citeste(await trimite({ apartament_id: AP, locatar_id: "locatar-1", actiune: "parola" }));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "nu merge cautarea" });
  });
});

Deno.test("cont-locatar: daca Auth refuza parola noua, mesajul lui ajunge la administrator", async () => {
  await cuFetch(backend({ parolaNoua: () => json({ msg: "Password is too short" }, 422) }), async () => {
    const r = await citeste(await trimite({ apartament_id: AP, locatar_id: "locatar-1", actiune: "parola" }));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Parola este prea scurta pentru regulile serverului." });
  });
});

Deno.test("cont-locatar: acelasi om, al doilea apartament: contul lui se leaga, fara parola noua", async () => {
  await cuFetch(backend({ profiluri: [{ id: PROFIL }] }), async (f) => {
    const r = await citeste(await trimite(NOU));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { locatar_id: "locatar-nou", profil_id: PROFIL, telefon: "0722123456", parola: null });
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.utilizatori).length, 0);
    assertEquals(f.apeluri.find((a) => a.url.pathname === P.leaga)!.corp.p_profil_id, PROFIL);
  });
});

Deno.test("cont-locatar: daca legarea contului vechi cade, mesajul ajunge la administrator", async () => {
  await cuFetch(backend({ profiluri: [{ id: PROFIL }], leaga: () => eroarePg("Contul este deja legat de acest apartament.") }), async () => {
    const r = await citeste(await trimite(NOU));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Contul este deja legat de acest apartament." });
  });
});

Deno.test("cont-locatar: cautarea contului cazuta se spune ca atare", async () => {
  await cuFetch((a: Apel) => {
    if (a.url.pathname === P.eu) return json({ id: "admin-1" });
    if (a.url.pathname === P.drept) return json({ apartament_id: AP });
    if (a.url.pathname === P.profiluri) return eroarePg("nu merge cautarea", 500);
    return undefined;
  }, async () => {
    const r = await citeste(await trimite(NOU));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "nu merge cautarea" });
  });
});

// ---------------------------------------------------------------- conducere

const CONDUCERE = { nume: " Sorin Tudose ", telefon: "0730 415 900", rol: "cenzor", actiune: "conducere" };

Deno.test("cont-locatar: un cenzor din afara blocului primeste cont si mandat", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await trimite(CONDUCERE));
    assertEquals(r.status, 200);
    assertEquals(r.corp.profil_id, PROFIL);
    assertEquals(r.corp.telefon, "0730415900");
    assert(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/.test(r.corp.parola), r.corp.parola);

    const creare = f.apeluri.find((a) => a.url.pathname === P.utilizatori)!;
    assertEquals(creare.corp.email, "0730415900@telefon.adminbloc.invalid");
    assertEquals(creare.corp.user_metadata, { nume: "Sorin Tudose", telefon: "0730415900" });
    const mandat = f.apeluri.find((a) => a.url.pathname === P.conducere)!;
    assertEquals(mandat.corp, { p_profil_id: PROFIL, p_rol: "cenzor", p_asociatie_id: "asoc-1" });
    // apartamentul nu se verifica: mandatul e pe asociatie
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.drept).length, 0);
  });
});

Deno.test("cont-locatar: un om care are deja cont primeste doar mandatul, fara parola noua", async () => {
  await cuFetch(backend({ profiluri: [{ id: PROFIL }] }), async (f) => {
    const r = await citeste(await trimite(CONDUCERE));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { profil_id: PROFIL, telefon: "0730415900", parola: null });
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.utilizatori).length, 0);
  });
});

Deno.test("cont-locatar: conducere fara numar sau fara nume -> 400", async () => {
  await cuFetch(backend(), async () => {
    const faraNumar = await citeste(await trimite({ ...CONDUCERE, telefon: "0722" }));
    assertEquals(faraNumar.corp, { eroare: "Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx." });
    const faraNume = await citeste(await trimite({ ...CONDUCERE, nume: "  " }));
    assertEquals(faraNume.corp, { eroare: "Scrie numele persoanei." });
    const fara = await citeste(await trimite({ telefon: CONDUCERE.telefon, rol: "cenzor", actiune: "conducere" }));
    assertEquals(fara.corp, { eroare: "Scrie numele persoanei." });
  });
});

Deno.test("cont-locatar: daca mandatul e refuzat, contul nou se sterge", async () => {
  await cuFetch(backend({ conducere: () => eroarePg("Doar administratorul asociatiei numeste presedintele si cenzorul.", 403) }), async (f) => {
    const r = await citeste(await trimite(CONDUCERE));
    assertEquals(r.status, 403);
    assertEquals(r.corp, { eroare: "Doar administratorul asociatiei numeste presedintele si cenzorul." });
    assert(f.apeluri.find((a) => a.url.pathname === P.utilizator && a.metoda === "DELETE"), "contul nou a ramas in urma");
  });
});

Deno.test("cont-locatar: mandatul refuzat pentru cineva care avea deja cont nu-i sterge contul", async () => {
  await cuFetch(backend({ profiluri: [{ id: PROFIL }], conducere: () => eroarePg("Persoana are deja acest mandat, in curs.") }), async (f) => {
    const r = await citeste(await trimite(CONDUCERE));
    assertEquals(r.status, 403);
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.utilizator && a.metoda === "DELETE").length, 0);
  });
});

// [C4] Dreptul se verifica inainte de a atinge Auth: cat timp mandatul era
// singura verificare, orice om cu cont putea sa faca si sa stearga conturi pe
// numere alese de el, iar o stergere cazuta lasa un cont strain pe numarul
// unui om real.
Deno.test("cont-locatar: [C4] cine nu administreaza asociatia nu ajunge la Auth", async () => {
  await cuFetch(backend({ asociatie: () => eroarePg("Nu esti administratorul acestei asociatii.", 403) }), async (f) => {
    const r = await citeste(await trimite(CONDUCERE));
    assertEquals(r.status, 403);
    assertEquals(r.corp, { eroare: "Doar administratorul asociatiei numeste presedintele si cenzorul." });
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.utilizatori).length, 0, "contul nu are voie sa existe");
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.profiluri).length, 0);
  });
});

Deno.test("cont-locatar: [C4] un rol inventat este refuzat inainte de orice cont", async () => {
  await cuFetch(backend(), async (f) => {
    const r = await citeste(await trimite({ ...CONDUCERE, rol: "administrator" }));
    assertEquals(r.status, 400);
    assertEquals(r.corp, { eroare: "Mandatul este de presedinte sau de cenzor." });
    assertEquals(f.apeluri.filter((a) => a.url.pathname === P.utilizatori).length, 0);
  });
});

Deno.test("cont-locatar: [C5] asociatia ceruta de ecran este cea verificata", async () => {
  await cuFetch(backend(), async (f) => {
    await trimite({ ...CONDUCERE, asociatie_id: "asoc-ceruta" });
    const drept = f.apeluri.find((a) => a.url.pathname === P.asociatie)!;
    assertEquals(drept.corp, { p_asociatie_id: "asoc-ceruta" });
  });
});

Deno.test("cont-locatar: conducere, cautarea contului cazuta se spune ca atare", async () => {
  await cuFetch((a: Apel) => {
    if (a.url.pathname === P.eu) return json({ id: "admin-1" });
    if (a.url.pathname === P.asociatie) return json("asoc-1");
    if (a.url.pathname === P.profiluri) return eroarePg("nu merge cautarea", 500);
    return undefined;
  }, async () => {
    const r = await citeste(await trimite(CONDUCERE));
    assertEquals(r.corp, { eroare: "nu merge cautarea" });
  });
});

Deno.test("cont-locatar: conducere, Auth refuza crearea contului", async () => {
  await cuFetch(backend({ creare: () => json({ msg: "Too many requests" }, 429) }), async () => {
    const r = await citeste(await trimite(CONDUCERE));
    assertEquals(r.corp, { eroare: "Prea multe incercari intr-un timp scurt. Asteapta cateva minute si incearca din nou." });
  });
});
