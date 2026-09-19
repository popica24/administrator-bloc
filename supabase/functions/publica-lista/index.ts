// publica-lista (docs/schema-propunere.md §1.2, §5, §7)
// Ruleaza motorul de repartizare (acelasi fisier ca in aplicatie) pe datele
// listei si scrie rezultatul printr-o singura functie Postgres, intr-o singura
// tranzactie. Apoi proceseaza imediat evenimentul ListaPublicata, ca
// datoriile sa existe cand administratorul reincarca ecranul.
//
// Administratorul publica o lista ciorna cu propriul token.
// Dezvoltatorul (service_role) poate si recalcula o lista publicata
// ({ recalculare: true }) si poate data publicarea (seed-ul datelor demo).

import { calculeazaLista } from "../_shared/motor.js";
import { clientServiciu, clientUtilizator, eroare, esteServiciu, numere, porneste, raspuns } from "../_shared/server.ts";

porneste(async (req) => {
  if (req.method !== "POST") return eroare("Metoda nu este permisa.", 405);

  try {
    const { lista_id, recalculare = false, publicata_la } = await req.json();
    if (!lista_id) return eroare("Lipseste lista_id.");

    const serviciu = esteServiciu(req);
    const admin = clientServiciu();
    let profilId: string | null = null;
    let cititor = admin;

    if (!serviciu) {
      if (recalculare) return eroare("Recalcularea unei liste publicate o face doar dezvoltatorul.", 403);
      cititor = clientUtilizator(req);
      const { data, error } = await cititor.auth.getUser();
      if (error || !data.user) return eroare("Nu esti autentificat.", 401);
      profilId = data.user.id;
    }

    // date_pentru_motor verifica singura ca apelantul administreaza blocul.
    const { data: dm, error: e1 } = await cititor.schema("intretinere").rpc("date_pentru_motor", { p_lista_id: lista_id });
    if (e1) return eroare(e1.message, 403);
    if (!recalculare && dm.lista.stare !== "ciorna") return eroare("Lista este deja publicata.");

    let rezultat;
    try {
      rezultat = calculeazaLista({
        apartamente: dm.apartamente.map((a: { id: string; persoane: unknown; cota: unknown; scutitLift: boolean }) => ({
          id: a.id, persoane: Number(a.persoane), cota: Number(a.cota), scutitLift: !!a.scutitLift,
        })),
        cheltuieli: dm.cheltuieli.map((c: { id: string; cod: string; suma: unknown; metoda: string; tipApa: string | null }) => ({
          id: c.id, cod: c.cod, suma: Number(c.suma), metoda: c.metoda, tipApa: c.tipApa,
        })),
        consum: numere(dm.consum),
        contorGeneral: numere({ g: dm.contorGeneral }).g,
      });
    } catch (e) {
      return eroare(`Lista nu se poate calcula: ${(e as Error).message}`, 422);
    }

    const { data: evenimentId, error: e2 } = await admin.schema("intretinere").rpc("salveaza_lista_publicata", {
      p_lista_id: lista_id,
      p_rezultat: rezultat,
      p_publicata_de: profilId,
      p_recalculare: recalculare,
      p_publicata_la: serviciu && publicata_la ? publicata_la : new Date().toISOString(),
    });
    if (e2) return eroare(e2.message, 409);

    // Handlerele ruleaza acum; daca esueaza, evenimentul ramane in coada si il reia jobul.
    const { data: procesat } = await admin.rpc("proceseaza_eveniment", { p_id: evenimentId });

    return raspuns({
      lista_id,
      eveniment: evenimentId,
      procesat: !!procesat,
      total_cheltuieli: rezultat.totalCheltuieli,
      total_repartizat: rezultat.totalRepartizat,
    });
  } catch (e) {
    return eroare((e as Error).message, 500);
  }
});
