// plata-card-webhook: procesatorul anunta rezultatul unei plati. Singurul loc
// care confirma o plata cu cardul. Semnatura HMAC dovedeste ca mesajul vine de
// la procesator; referinta unica face ca un webhook repetat sa nu dubleze nimic.
// Ruleaza fara JWT (verify_jwt = false in config.toml): procesatorul nu are cont.

import { clientServiciu, eroare, porneste, raspuns } from "../_shared/server.ts";

const SECRET = Deno.env.get("PROCESATOR_SECRET") ?? "procesator-local-doar-pentru-dezvoltare";

async function semnaturaValida(corp: string, semnatura: string | null): Promise<boolean> {
  if (!semnatura) return false;
  const cheie = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const octeti = new Uint8Array((semnatura.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", cheie, octeti, new TextEncoder().encode(corp));
}

porneste(async (req) => {
  if (req.method !== "POST") return eroare("Metoda nu este permisa.", 405);

  const corp = await req.text();
  if (!(await semnaturaValida(corp, req.headers.get("x-semnatura")))) return eroare("Semnatura nu este valida.", 401);

  // N3: un corp semnat corect, dar care nu e JSON, arunca din handler. Fara
  // raspuns, procesatorul reincearca la nesfarsit acelasi mesaj stricat.
  let mesaj: { referinta?: string; stare?: string };
  try {
    mesaj = JSON.parse(corp);
  } catch {
    return eroare("Corpul mesajului nu este JSON.");
  }
  const { referinta, stare } = mesaj;
  const { data, error } = await clientServiciu().schema("financiar").rpc("confirma_plata_card", {
    p_procesator: "simulat",
    p_referinta: referinta,
    p_reusita: stare === "autorizata",
  });
  if (error) return eroare(error.message, 409);
  return raspuns({ plataId: data, primit: true });
});
