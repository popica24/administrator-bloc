// procesator-simulat: autorizeaza sau refuza cardul si anunta webhook-ul, semnat HMAC.
import { assertEquals } from "jsr:@std/assert@1";
import { cerere, CHEIE_SERVICIU, citeste, cuFetch, hmacHex, incarcaHandler, json, JWT_UTILIZATOR, SECRET_IMPLICIT, SECRET_TEST } from "./ajutor.ts";

Deno.env.set("PROCESATOR_SECRET", SECRET_TEST);
const handler = await incarcaHandler("../procesator-simulat/index.ts");

const WEBHOOK = "http://webhook.test/functions/v1/plata-card-webhook";
const bun = { numar: "4242424242424242", expira: "12/30", cvc: "123", nume: "Ion Pop" };

function trimite(corp: unknown) {
  return handler(cerere("procesator-simulat", { token: CHEIE_SERVICIU, corp }));
}

Deno.test("procesator: OPTIONS raspunde cu CORS", async () => {
  const r = await handler(cerere("procesator-simulat", { metoda: "OPTIONS" }));
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("Access-Control-Allow-Methods"), "POST, GET, OPTIONS");
});

Deno.test("procesator: refuza apelurile care nu vin de la server (403), fara webhook", async () => {
  await cuFetch(() => json({}), async (f) => {
    for (const token of [undefined, JWT_UTILIZATOR, "cheie-anon-test"]) {
      const r = await citeste(await handler(cerere("procesator-simulat", { token, corp: { referinta: "SIM-1", suma: 5, card: bun, webhook: WEBHOOK } })));
      assertEquals(r.status, 403);
      assertEquals(r.corp, { eroare: "Procesatorul accepta doar cereri de la server." });
    }
    assertEquals(f.apeluri.length, 0);
  });
});

Deno.test("procesator: cardul bun este autorizat si webhook-ul primeste mesajul semnat", async () => {
  await cuFetch((a) => a.url.href === WEBHOOK ? json({ primit: true }) : undefined, async (f) => {
    const r = await citeste(await trimite({ referinta: "SIM-OK", suma: 312.5, card: bun, webhook: WEBHOOK }));
    assertEquals(r.status, 200);
    assertEquals(r.corp, { referinta: "SIM-OK", stare: "autorizata", webhook: 200 });

    assertEquals(f.apeluri.length, 1);
    const [apel] = f.apeluri;
    assertEquals(apel.metoda, "POST");
    assertEquals(apel.antete.get("Content-Type"), "application/json");
    assertEquals(apel.text, JSON.stringify({ referinta: "SIM-OK", stare: "autorizata", suma: 312.5 }));
    assertEquals(apel.antete.get("x-semnatura"), await hmacHex(SECRET_TEST, apel.text));
    // secretul din mediu, nu cel implicit
    assertEquals(apel.antete.get("x-semnatura") === await hmacHex(SECRET_IMPLICIT, apel.text), false);
    // datele cardului nu pleaca mai departe
    for (const secret of [bun.numar, bun.cvc, bun.nume, bun.expira]) assertEquals(apel.text.includes(secret), false);
  });
});

for (const [caz, card] of [
  ["numar terminat in 0002", { ...bun, numar: "4000000000000002" }],
  ["numar prea scurt", { ...bun, numar: "424242424242" }],
  ["expirare in alt format", { ...bun, expira: "12/2030" }],
  ["expirare lipsa", { numar: bun.numar }],
  ["numar lipsa", { expira: "12/30" }],
  ["fara card", undefined],
] as const) {
  Deno.test(`procesator: refuza cardul (${caz}) si anunta webhook-ul`, async () => {
    await cuFetch(() => json({}), async (f) => {
      const r = await citeste(await trimite({ referinta: "SIM-NU", suma: 10, card, webhook: WEBHOOK }));
      assertEquals(r.status, 200);
      assertEquals(r.corp.stare, "refuzata");
      assertEquals(JSON.parse(f.apeluri[0].text), { referinta: "SIM-NU", stare: "refuzata", suma: 10 });
      assertEquals(f.apeluri[0].antete.get("x-semnatura"), await hmacHex(SECRET_TEST, f.apeluri[0].text));
    });
  });
}

Deno.test("procesator: raporteaza statusul primit de la webhook", async () => {
  await cuFetch(() => json({ eroare: "Semnatura nu este valida." }, 401), async () => {
    const r = await citeste(await trimite({ referinta: "SIM-W", suma: 1, card: bun, webhook: WEBHOOK }));
    assertEquals(r.corp.webhook, 401);
  });
});
