// creeaza-asociatie (docs/schema-propunere.md §11.2): dezvoltatorul adauga o
// asociatie noua si primul ei administrator, dupa verificarea actelor.
// Este Edge Function, nu doar SQL, pentru ca un cont nou se creeaza prin API-ul
// de administrare Supabase Auth. Doar cu cheia de serviciu.
//
// Poate rula de mai multe ori fara efecte duble: asociatia cu acelasi CUI se
// refoloseste, iar un cont cu acelasi email nu se mai creeaza.
//
// Corp: { asociatie: {...}, setari: {...}, bloc: {...},
//         administrator: { email, nume, telefon, atestat, parola? } }
// Fara parola, administratorul primeste invitatie pe email.

import { clientServiciu, eroare, esteServiciu, porneste, raspuns } from "../_shared/server.ts";

porneste(async (req) => {
  if (!esteServiciu(req)) return eroare("Doar dezvoltatorul creeaza asociatii.", 403);

  try {
    const corp = await req.json();
    const admin = clientServiciu();

    const { data: creata, error: e1 } = await admin.schema("organizare").rpc("creeaza_asociatie", { p: corp });
    if (e1) return eroare(e1.message);

    const a = corp.administrator;
    if (!a?.email) return raspuns({ ...creata, administrator: null });

    let profilId: string | null = null;
    const { data: existent } = await admin.schema("identitate").from("profiluri").select("id").eq("email", a.email).maybeSingle();
    if (existent) {
      profilId = existent.id;
    } else if (a.parola) {
      const { data, error } = await admin.auth.admin.createUser({
        email: a.email, password: a.parola, email_confirm: true, user_metadata: { nume: a.nume, telefon: a.telefon },
      });
      if (error) return eroare(error.message);
      profilId = data.user.id;
    } else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(a.email, { data: { nume: a.nume, telefon: a.telefon } });
      if (error) return eroare(error.message);
      profilId = data.user.id;
    }

    const { error: e2 } = await admin.schema("identitate").rpc("numeste_administrator", {
      p_profil_id: profilId, p_asociatie_id: creata.asociatie_id, p_numar_atestat: a.atestat ?? null, p_activ_din: a.activDin ?? new Date().toISOString().slice(0, 10),
    });
    if (e2) return eroare(e2.message);

    return raspuns({ ...creata, administrator: profilId });
  } catch (e) {
    return eroare((e as Error).message, 500);
  }
});
