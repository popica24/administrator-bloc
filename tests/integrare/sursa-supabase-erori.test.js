/* Erorile care nu vin din regulile backend-ului: reteaua cazuta, raspunsuri
   fara mesaj, Edge Functions care nu raspund cu JSON. Serverul real nu le
   produce la cerere, asa ca fetch-ul este inlocuit pentru un singur apel. */
import { beforeAll, describe, expect, it } from "vitest";
import { cuFetch, intraCa, json } from "./fixture.js";

const SESIZARE = "00000000-0000-4000-8000-000000000000";
let s;

beforeAll(async () => {
  ({ s } = await intraCa("0733 410 217"));
});

const rpc = (nume, raspuns) => (url) => (url.includes(`/rpc/${nume}`) ? raspuns() : undefined);
const functia = (nume, raspuns) => (url) => (url.includes(`/functions/v1/${nume}`) ? raspuns() : undefined);
const tabel = (nume, raspuns) => (url) => (url.includes(`/${nume}?`) ? raspuns() : undefined);

describe("mesajele serverului, pe romaneste", () => {
  it("reteaua cazuta: serverul nu raspunde", async () => {
    await cuFetch(rpc("scrie_mesaj", () => { throw new TypeError("Failed to fetch"); }), async () => {
      await expect(s.scrieMesaj(SESIZARE, "x")).rejects.toThrow("Serverul nu raspunde. Verifica conexiunea la internet.");
    });
  });

  it("o eroare cu `msg` in loc de `message` isi pastreaza textul", async () => {
    await cuFetch(rpc("scrie_mesaj", () => json({ msg: "Serviciul este in mentenanta." }, 503)), async () => {
      await expect(s.scrieMesaj(SESIZARE, "x")).rejects.toThrow("Serviciul este in mentenanta.");
    });
  });

  it("o eroare fara niciun text primeste mesajul generic", async () => {
    await cuFetch(rpc("scrie_mesaj", () => json({}, 500)), async () => {
      await expect(s.scrieMesaj(SESIZARE, "x")).rejects.toThrow("A aparut o eroare.");
    });
  });

  it("mesajul backend-ului trece neschimbat cand nu e unul tehnic cunoscut", async () => {
    await expect(s.scrieMesaj(SESIZARE, "x")).rejects.toThrow("Sesizarea nu exista.");
  });

  /* [P3] Sesiunea moarta (JWT expirat, la 24h sau dupa 8h de inactivitate):
     cererea ajunge fara token valid, iar Postgres refuza cu un mesaj tehnic
     in engleza, pe schema, nu pe randul cerut (spre deosebire de RLS). */
  it("[P3] schema refuzata (sesiune expirata): mesajul spune sa intre din nou in cont", async () => {
    await cuFetch(rpc("scrie_mesaj", () => json({ message: "permission denied for schema comunicare", code: "42501" }, 403)), async () => {
      await expect(s.scrieMesaj(SESIZARE, "x")).rejects.toThrow("Sesiunea a expirat. Intra din nou in cont.");
    });
  });

  it("[P3] JWT expirat: acelasi mesaj", async () => {
    await cuFetch(rpc("scrie_mesaj", () => json({ message: "JWT expired", code: "PGRST301" }, 401)), async () => {
      await expect(s.scrieMesaj(SESIZARE, "x")).rejects.toThrow("Sesiunea a expirat. Intra din nou in cont.");
    });
  });

  it("[NOU-3] deschideDocument(): o eroare care nu e 'randul lipseste' (PGRST116) trece neschimbata", async () => {
    await cuFetch(tabel("documente", () => json({}, 500)), async () => {
      await expect(s.deschideDocument(SESIZARE)).rejects.toThrow("A aparut o eroare.");
    });
  });
});

describe("erorile Edge Functions", () => {
  /* publica-lista este Edge Function-ul pe care il cheama aplicatia; aici
     conteaza doar ce vede omul cand raspunsul nu e cel asteptat. */
  const publica = () => s.publicaLista(SESIZARE);

  it("corpul JSON fara `eroare`: mesajul clientului", async () => {
    await cuFetch(functia("publica-lista", () => json({ altceva: true }, 500)), async () => {
      await expect(publica()).rejects.toThrow("Edge Function returned a non-2xx status code");
    });
  });

  it("corpul care nu e JSON: mesajul clientului", async () => {
    await cuFetch(functia("publica-lista", () => new Response("Bad Gateway", { status: 502, headers: { "Content-Type": "text/plain" } })), async () => {
      await expect(publica()).rejects.toThrow("Edge Function returned a non-2xx status code");
    });
  });

  it("functia de neatins: mesajul clientului", async () => {
    await cuFetch(functia("publica-lista", () => { throw new TypeError("Failed to fetch"); }), async () => {
      await expect(publica()).rejects.toThrow("Failed to send a request to the Edge Function");
    });
  });
});
