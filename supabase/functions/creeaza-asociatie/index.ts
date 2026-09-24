// creeaza-asociatie (docs/schema-propunere.md §11.2): dezvoltatorul adauga o
// asociatie noua si primul ei administrator, dupa verificarea actelor.
// Este Edge Function, nu doar SQL, pentru ca un cont nou se creeaza prin API-ul
// de administrare Supabase Auth. Doar cu cheia de serviciu.
//
// Poate rula de mai multe ori fara efecte duble: asociatia cu acelasi CUI se
// refoloseste, iar un cont pe acelasi numar de telefon nu se mai creeaza.
//
// Corp: { asociatie: {...}, setari: {...}, bloc: {...},
//         administrator: { nume, telefon, atestat, parola? } }
// Fara parola, sistemul alege una si o intoarce in raspuns, o singura data.

import { adresaContului, normalizeazaTelefon } from "../_shared/telefon.js";
import { genereazaParola } from "../_shared/parola.js";
import { clientServiciu, eroare, esteServiciu, porneste, raspuns } from "../_shared/server.ts";

porneste(async (req) => {
  if (!esteServiciu(req)) return eroare("Doar dezvoltatorul creeaza asociatii.", 403);

  try {
    const corp = await req.json();
    const admin = clientServiciu();

    const { data: creata, error: e1 } = await admin.schema("organizare").rpc("creeaza_asociatie", { p: corp });
    if (e1) return eroare(e1.message);

    const a = corp.administrator;
    const numar = normalizeazaTelefon(a?.telefon);
    if (!numar) return raspuns({ ...creata, administrator: null });

    let profilId: string | null = null;
    let parola: string | null = null;
    const { data: existent } = await admin.schema("identitate").from("profiluri").select("id").eq("telefon", numar).maybeSingle();
    if (existent) {
      profilId = existent.id;
    } else {
      parola = a.parola ?? genereazaParola();
      const { data, error } = await admin.auth.admin.createUser({
        email: adresaContului(numar)!, phone: `+4${numar}`, password: parola,
        email_confirm: true, phone_confirm: true, user_metadata: { nume: a.nume, telefon: numar },
      });
      if (error) return eroare(error.message);
      profilId = data.user.id;
    }

    const { error: e2 } = await admin.schema("identitate").rpc("numeste_administrator", {
      p_profil_id: profilId, p_asociatie_id: creata.asociatie_id, p_numar_atestat: a.atestat ?? null, p_activ_din: a.activDin ?? new Date().toISOString().slice(0, 10),
    });
    if (e2) return eroare(e2.message);

    return raspuns({ ...creata, administrator: profilId, parola });
  } catch (e) {
    return eroare((e as Error).message, 500);
  }
});
