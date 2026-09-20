/* Erorile care nu vin din regulile backend-ului: reteaua cazuta, raspunsuri
   fara mesaj, Edge Functions care nu raspund cu JSON. Serverul real nu le
   produce la cerere, asa ca fetch-ul este inlocuit pentru un singur apel. */
import { beforeAll, describe, expect, it } from "vitest";
import { cuFetch, intraCa, json } from "./fixture.js";

const SESIZARE = "00000000-0000-4000-8000-000000000000";
let s;

beforeAll(async () => {
  ({ s } = await intraCa("elena.marinescu@adminbloc.test"));
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

  it("[NOU-3] deschideDocument(): o eroare care nu e 'randul lipseste' (PGRST116) trece neschimbata", async () => {
    await cuFetch(tabel("documente", () => json({}, 500)), async () => {
      await expect(s.deschideDocument(SESIZARE)).rejects.toThrow("A aparut o eroare.");
    });
  });
});

describe("erorile Edge Functions", () => {
  const plata = () => s.platesteCard({ apartamentId: SESIZARE, suma: 1, card: { numar: "4242424242424242", expira: "12/30" } });

  it("corpul JSON fara `eroare`: mesajul clientului", async () => {
    await cuFetch(functia("plata-card", () => json({ altceva: true }, 500)), async () => {
      await expect(plata()).rejects.toThrow("Edge Function returned a non-2xx status code");
    });
  });

  it("corpul care nu e JSON: mesajul clientului", async () => {
    await cuFetch(functia("plata-card", () => new Response("Bad Gateway", { status: 502, headers: { "Content-Type": "text/plain" } })), async () => {
      await expect(plata()).rejects.toThrow("Edge Function returned a non-2xx status code");
    });
  });

  it("functia de neatins: mesajul clientului", async () => {
    await cuFetch(functia("plata-card", () => { throw new TypeError("Failed to fetch"); }), async () => {
      await expect(plata()).rejects.toThrow("Failed to send a request to the Edge Function");
    });
  });
});
