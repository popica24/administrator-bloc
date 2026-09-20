// plata-card: stratul anticoruptie fata de procesatorul de carduri
// (docs/schema-propunere.md §2.5, §3.E). Vocabularul procesatorului
// ("autorizata", "refuzata", semnaturi) ramane aici si nu ajunge in financiar.
//
// 1. creeaza plata in_asteptare (financiar.creeaza_plata_card);
// 2. trimite cardul la procesator, cu adresa webhook-ului;
// 3. procesatorul raspunde si, separat, anunta webhook-ul plata-card-webhook,
//    singurul care confirma plata, aloca banii si emite chitanta.
// Datele cardului trec prin functie spre procesator; nu se salveaza nicaieri.

import { clientServiciu, clientUtilizator, eroare, porneste, raspuns, URL_SUPABASE } from "../_shared/server.ts";
import { round2 } from "../_shared/motor.js";

const PROCESATOR = "simulat";

porneste(async (req) => {
  if (req.method !== "POST") return eroare("Metoda nu este permisa.", 405);

  try {
    const { apartament_id, suma, card } = await req.json();
    const utilizator = clientUtilizator(req);
    const { data: u, error: eu } = await utilizator.auth.getUser();
    if (eu || !u.user) return eroare("Nu esti autentificat.", 401);
    // [K14] verificarea trebuie facuta pe suma rotunjita la 2 zecimale, exact
    // ca la insert (financiar.creeaza_plata_card / financiar.inregistreaza_plata):
    // altfel o suma ca 0,004 trece garda si loveste direct constrangerea bruta
    // plati_suma_check in loc de acest mesaj.
    if (!(round2(Number(suma)) > 0)) return eroare("Suma trebuie sa fie mai mare decat zero.");
    if (!card || String(card.numar ?? "").replace(/\D/g, "").length < 13) return eroare("Numarul cardului nu este complet.");

    const admin = clientServiciu();
    const referinta = `SIM-${crypto.randomUUID().slice(0, 13).toUpperCase()}`;
    const { data: plataId, error: e1 } = await admin.schema("financiar").rpc("creeaza_plata_card", {
      p_apartament_id: apartament_id,
      p_suma: Number(suma),
      p_platita_de: u.user.id,
      p_procesator: PROCESATOR,
      p_referinta: referinta,
    });
    if (e1) return eroare(e1.message, 403);

    const r = await fetch(`${URL_SUPABASE}/functions/v1/procesator-simulat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({
        referinta,
        suma: Number(suma),
        card: { numar: String(card.numar).replace(/\D/g, ""), expira: card.expira, cvc: card.cvc, nume: card.nume },
        webhook: `${URL_SUPABASE}/functions/v1/plata-card-webhook`,
      }),
    });
    const procesator = await r.json().catch(() => ({}));

    const { data: plata } = await admin.schema("financiar").from("plati").select("id, stare").eq("id", plataId).single();
    if (plata?.stare === "confirmata") {
      const { data: ch } = await admin.schema("financiar").from("chitante").select("serie, numar").eq("plata_id", plataId).single();
      return raspuns({ plataId, stare: "confirmata", chitanta: ch });
    }
    if (procesator.stare === "refuzata" || plata?.stare === "esuata") {
      return eroare("Banca a refuzat plata. Nu s-a retras niciun ban.", 402);
    }
    // N2: procesatorul a raspuns cu o eroare HTTP si plata nu are inca un
    // rezultat. Cardul nu a ajuns la banca, deci nu spunem "asteapta banca":
    // asa plata ramanea in asteptare pentru totdeauna, iar omul platea din nou.
    if (!r.ok) {
      return eroare("Procesatorul de plati nu a raspuns. Plata nu a plecat la banca; incearca din nou.", 502);
    }
    return raspuns({ plataId, stare: "in_asteptare", mesaj: "Plata asteapta confirmarea bancii. Chitanta apare cand banca o confirma." }, 202);
  } catch (e) {
    return eroare((e as Error).message, 500);
  }
});
