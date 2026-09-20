// exporta-bloc: "Export toate datele unui bloc" (PDF, rolul dezvoltatorului).
// Fiecare tabela ajunge la bloc direct, prin bloc_id, sau prin radacina
// agregatului ei (§1.6). Intoarce un singur JSON, cu o cheie pe tabela.
// Doar cu cheia de serviciu. GET /exporta-bloc?bloc_id=<uuid>

import { clientServiciu, eroare, esteServiciu, porneste, raspuns } from "../_shared/server.ts";

type Rand = Record<string, unknown>;

porneste(async (req) => {
  if (!esteServiciu(req)) return eroare("Doar dezvoltatorul exporta date.", 403);

  const blocId = new URL(req.url).searchParams.get("bloc_id");
  if (!blocId) return eroare("Lipseste bloc_id.");
  const db = clientServiciu();

  const citeste = async (schema: string, tabela: string, coloana: string, valori: unknown[] | unknown): Promise<Rand[]> => {
    const lista = Array.isArray(valori) ? valori : [valori];
    if (lista.length === 0) return [];
    const { data, error } = await db.schema(schema).from(tabela).select("*").in(coloana, lista);
    if (error) throw new Error(`${schema}.${tabela}: ${error.message}`);
    return data ?? [];
  };
  const iduri = (randuri: Rand[], coloana = "id") => randuri.map((r) => r[coloana]);

  try {
    const blocuri = await citeste("organizare", "blocuri", "id", blocId);
    if (blocuri.length === 0) return eroare("Blocul nu exista.", 404);
    const asociatieId = blocuri[0].asociatie_id;

    const apartamente = await citeste("organizare", "apartamente", "bloc_id", blocId);
    const liste = await citeste("intretinere", "liste_lunare", "bloc_id", blocId);
    const plati = await citeste("financiar", "plati", "bloc_id", blocId);
    const datorii = await citeste("financiar", "datorii", "bloc_id", blocId);
    const fonduri = await citeste("financiar", "fonduri", "bloc_id", blocId);
    const sesizari = await citeste("sesizari", "sesizari", "bloc_id", blocId);
    const voturi = await citeste("guvernanta", "voturi", "asociatie_id", asociatieId);
    const adunari = await citeste("guvernanta", "adunari_generale", "asociatie_id", asociatieId);

    const exportul = {
      exportat_la: new Date().toISOString(),
      bloc_id: blocId,
      organizare: {
        asociatii: await citeste("organizare", "asociatii", "id", asociatieId),
        blocuri,
        apartamente,
        apartamente_persoane: await citeste("organizare", "apartamente_persoane", "apartament_id", iduri(apartamente)),
        inrolare_apartamente: await citeste("organizare", "inrolare_apartamente", "bloc_id", blocId),
        contacte: await citeste("organizare", "contacte", "asociatie_id", asociatieId),
      },
      identitate: {
        membri_asociatie: await citeste("identitate", "membri_asociatie", "asociatie_id", asociatieId),
        locatari: await citeste("identitate", "locatari", "bloc_id", blocId),
        invitatii: await citeste("identitate", "invitatii", "apartament_id", iduri(apartamente)),
      },
      intretinere: {
        furnizori: await citeste("intretinere", "furnizori", "asociatie_id", asociatieId),
        cheltuieli_recurente: await citeste("intretinere", "cheltuieli_recurente", "bloc_id", blocId),
        liste_lunare: liste,
        cheltuieli: await citeste("intretinere", "cheltuieli", "lista_id", iduri(liste)),
        repartizari: await citeste("intretinere", "repartizari", "bloc_id", blocId),
      },
      contorizare: {
        setari_contorizare: await citeste("contorizare", "setari_contorizare", "bloc_id", blocId),
        contoare: await citeste("contorizare", "contoare", "bloc_id", blocId),
        citiri: await citeste("contorizare", "citiri", "bloc_id", blocId),
      },
      financiar: {
        setari_financiare: await citeste("financiar", "setari_financiare", "asociatie_id", asociatieId),
        conturi: await citeste("financiar", "conturi", "bloc_id", blocId),
        datorii,
        plati,
        alocari_plati: await citeste("financiar", "alocari_plati", "plata_id", iduri(plati)),
        chitante: await citeste("financiar", "chitante", "plata_id", iduri(plati)),
        penalizari: await citeste("financiar", "penalizari", "datorie_id", iduri(datorii)),
        fonduri,
        miscari_fond: await citeste("financiar", "miscari_fond", "fond_id", iduri(fonduri)),
      },
      sesizari: {
        sesizari,
        sesizari_mesaje: await citeste("sesizari", "sesizari_mesaje", "sesizare_id", iduri(sesizari)),
        sesizari_poze: await citeste("sesizari", "sesizari_poze", "sesizare_id", iduri(sesizari)),
      },
      guvernanta: {
        voturi,
        voturi_optiuni: await citeste("guvernanta", "voturi_optiuni", "vot_id", iduri(voturi)),
        voturi_exprimate: await citeste("guvernanta", "voturi_exprimate", "vot_id", iduri(voturi)),
        adunari_generale: adunari,
        adunari_prezente: await citeste("guvernanta", "adunari_prezente", "adunare_id", iduri(adunari)),
      },
      comunicare: {
        documente: await citeste("comunicare", "documente", "asociatie_id", asociatieId),
        anunturi: await citeste("comunicare", "anunturi", "asociatie_id", asociatieId),
        remindere_setari: await citeste("comunicare", "remindere_setari", "asociatie_id", asociatieId),
      },
    };
    return raspuns(exportul);
  } catch (e) {
    return eroare((e as Error).message, 500);
  }
});
