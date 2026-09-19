// proceseaza-eveniment: dispecerul evenimentelor de domeniu (§2.5).
// Apelat de trigger-ul de pe evenimente.coada (pg_net, dupa commit) cu { id }.
// Fara id, proceseaza tot ce a ramas in coada. Handlerele sunt functiile SQL
// ale contextelor consumatoare, rulate de evenimente.proceseaza.

import { clientServiciu, eroare, esteServiciu, porneste, raspuns } from "../_shared/server.ts";

porneste(async (req) => {
  if (!esteServiciu(req)) return eroare("Doar serverul proceseaza evenimente.", 403);

  const corp = await req.json().catch(() => ({}));
  const admin = clientServiciu();
  if (corp.id) {
    const { data, error } = await admin.rpc("proceseaza_eveniment", { p_id: corp.id });
    if (error) return eroare(error.message, 500);
    return raspuns({ id: corp.id, procesat: data });
  }
  const { data, error } = await admin.rpc("proceseaza_evenimente_restante");
  if (error) return eroare(error.message, 500);
  return raspuns({ procesate: data });
});
