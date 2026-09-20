// procesator-simulat: tine locul procesatorului de plati (Netopia, Stripe,
// EuPlatesc, §8.6) pana la alegerea lui. Se comporta ca unul real: autorizeaza
// sau refuza cardul si anunta separat webhook-ul, semnat cu HMAC.
// Cardurile de test: orice numar valid este acceptat; cele care se termina in
// 0002 sunt refuzate, ca la procesatorii reali in modul de test.
// Apelabil doar de server (plata-card il cheama cu cheia de serviciu).

import { eroare, esteServiciu, porneste, raspuns } from "../_shared/server.ts";

const SECRET = Deno.env.get("PROCESATOR_SECRET") ?? "procesator-local-doar-pentru-dezvoltare";

async function semneaza(text: string): Promise<string> {
  const cheie = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const semn = await crypto.subtle.sign("HMAC", cheie, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(semn)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

porneste(async (req) => {
  if (!esteServiciu(req)) return eroare("Procesatorul accepta doar cereri de la server.", 403);

  const { referinta, suma, card, webhook } = await req.json();
  const numar = String(card?.numar ?? "");
  const expira = String(card?.expira ?? "");
  const refuzata = numar.length < 13 || numar.endsWith("0002") || !/^\d{2}\/\d{2}$/.test(expira);
  const stare = refuzata ? "refuzata" : "autorizata";

  const corp = JSON.stringify({ referinta, stare, suma });
  const semnatura = await semneaza(corp);
  const r = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json", "x-semnatura": semnatura }, body: corp });

  return raspuns({ referinta, stare, webhook: r.status });
});
