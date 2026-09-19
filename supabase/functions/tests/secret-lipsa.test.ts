// PROCESATOR_SECRET lipseste din mediu (audit S5). Fisier separat: secretul se
// citeste la importul functiilor, iar fiecare fisier de test are izolatul lui.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { cerere, CHEIE_SERVICIU, citeste, cuFetch, hmacHex, incarcaHandler, json, SECRET_IMPLICIT } from "./ajutor.ts";

Deno.env.delete("PROCESATOR_SECRET");
const webhook = await incarcaHandler("../plata-card-webhook/index.ts");
const procesator = await incarcaHandler("../procesator-simulat/index.ts");

const RPC = "/rest/v1/rpc/confirma_plata_card";

async function semnatImplicit(corp: unknown) {
  const text = JSON.stringify(corp);
  return cerere("plata-card-webhook", { corp: text, antete: { "x-semnatura": await hmacHex(SECRET_IMPLICIT, text) } });
}

// S5 (audit 2026-09-19): secretul HMAC are o valoare implicita scrisa in repo,
// deci fara PROCESATOR_SECRET oricine poate semna un mesaj de confirmare.
// Functiile ar trebui sa refuze sa porneasca. Dupa reparatie: BUG_S5 = false.
const BUG_S5 = true;

Deno.test({
  name: "[S5] webhook: fara PROCESATOR_SECRET refuza orice confirmare",
  ignore: BUG_S5,
  fn: async () => {
    await cuFetch((a) => a.url.pathname === RPC ? json("plata-1") : undefined, async (f) => {
      const r = await webhook(await semnatImplicit({ referinta: "SIM-FALS", stare: "autorizata" }));
      assert(r.status >= 400, `status ${r.status}`);
      assertEquals(f.catre(RPC).length, 0);
    });
  },
});

// Acopera semnarea cu secretul implicit: cat timp S5 nu e reparat, asta chiar
// se intampla si trebuie sa treaca prin cod macar o data.
Deno.test("procesator-simulat: fara PROCESATOR_SECRET foloseste secretul implicit din repo", async () => {
  await cuFetch((a) => a.url.hostname === "webhook.test" ? json({}) : undefined, async (f) => {
    const r = await procesator(cerere("procesator-simulat", {
      token: CHEIE_SERVICIU,
      corp: { referinta: "SIM-1", suma: 5, card: { numar: "4242424242424242", expira: "12/30" }, webhook: "http://webhook.test/w" },
    }));
    assertEquals(r.status, 200);
    const [apel] = f.apeluri;
    assertEquals(apel.antete.get("x-semnatura"), await hmacHex(SECRET_IMPLICIT, apel.text));
  });
});

Deno.test({
  name: "[S5] procesator-simulat: fara PROCESATOR_SECRET nu trimite nimic semnat",
  ignore: BUG_S5,
  fn: async () => {
    await cuFetch(() => json({}), async (f) => {
      const r = await procesator(cerere("procesator-simulat", {
        token: CHEIE_SERVICIU,
        corp: { referinta: "SIM-1", suma: 5, card: { numar: "4242424242424242", expira: "12/30" }, webhook: "http://webhook.test/w" },
      }));
      assert(r.status >= 500);
      assertEquals(f.apeluri.length, 0);
    });
  },
});
