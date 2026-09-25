/* [A5-backend] Pana la aceasta reparatie, sursa.valideazaCitiriApartament()
   exista doar in src/sursa-mock.js: butoanele "Valideaza" / "Respinge" din
   AdminCitiri (AdminBloc.jsx:3396, :3416) apelau o metoda pe care
   sursa-supabase.js nu o avea, deci pe stack-ul real ambele butoane arunca.
   Acest fisier dovedeste apelul exact al UI-ului, un singur parametru de
   apartament si luna, fara id de citire, functioneaza capat la capat
   impotriva Postgres-ului real si ca un apel refuzat nu lasa nimic pe
   jumatate validat (motorul de repartizare are nevoie de "totul sau nimic",
   exact bug-ul A1 pe care comanda veche, pe cate un contor, il putea lasa in
   urma). */
import { beforeAll, describe, expect, it } from "vitest";
import { creeazaBloc, db, intraCa, lunaCurenta, ok, zi1 } from "./fixture.js";

let f;
let adm;
let loc;
let loc2;
const luna = lunaCurenta();

beforeAll(async () => {
  f = await creeazaBloc({
    locatari: [{ cheie: "loc", apartament: "1" }, { cheie: "loc2", apartament: "2" }],
  });
  adm = (await intraCa(f.adminTelefon)).s;
  loc = (await intraCa(f.conturi.loc.telefon)).s;
  loc2 = (await intraCa(f.conturi.loc2.telefon)).s;
  await loc.transmiteCitire({ apartamentId: f.ap["1"], luna, indexuri: [{ contorId: f.contoare["1:rece"], index: 15 }, { contorId: f.contoare["1:calda"], index: 9 }] });
  await loc2.transmiteCitire({ apartamentId: f.ap["2"], luna, indexuri: [{ contorId: f.contoare["2:rece"], index: 25 }, { contorId: f.contoare["2:calda"], index: 12 }] });
});

const citiriApartament = (apartamentId) => ok(db("contorizare").from("citiri").select("tip, stare, motiv_respingere, verificata_de")
  .eq("apartament_id", apartamentId).eq("luna", zi1(luna)).order("tip"));

describe("valideazaCitiriApartament(): exact apelul UI-ului (AdminBloc.jsx:3396, :3416)", () => {
  it("accepta ambele citiri (rece si calda) ale unui apartament dintr-un singur apel", async () => {
    const r = await adm.valideazaCitiriApartament(f.ap["1"], luna, true, null);
    expect(r).toEqual({ validate: 2 });
    const citiri = await citiriApartament(f.ap["1"]);
    expect(citiri).toEqual([
      { tip: "calda", stare: "validata", motiv_respingere: null, verificata_de: f.adminId },
      { tip: "rece", stare: "validata", motiv_respingere: null, verificata_de: f.adminId },
    ]);
  });

  it("un al doilea apel pe acelasi apartament si aceeasi luna nu mai are ce valida", async () => {
    await expect(adm.valideazaCitiriApartament(f.ap["1"], luna, true, null))
      .rejects.toThrow("Nu mai sunt citiri de verificat pentru acest apartament si aceasta luna.");
  });

  it("respingerea fara motiv esueaza si nu lasa nimic pe jumatate validat", async () => {
    await expect(adm.valideazaCitiriApartament(f.ap["2"], luna, false, "  "))
      .rejects.toThrow("Scrie motivul, ca locatarul sa stie ce sa corecteze.");
    /* Ambele citiri ale ap2 raman "trimisa": apelul esuat n-a atins nici
       macar una dintre ele, desi apartamentul are doua contoare. */
    const citiri = await citiriApartament(f.ap["2"]);
    expect(citiri).toEqual([
      { tip: "calda", stare: "trimisa", motiv_respingere: null, verificata_de: null },
      { tip: "rece", stare: "trimisa", motiv_respingere: null, verificata_de: null },
    ]);
  });

  it("respinge ambele citiri (rece si calda) ale unui apartament dintr-un singur apel, cu motiv", async () => {
    const r = await adm.valideazaCitiriApartament(f.ap["2"], luna, false, "  Poza neclara ");
    expect(r).toEqual({ validate: 2 });
    const citiri = await citiriApartament(f.ap["2"]);
    expect(citiri).toEqual([
      { tip: "calda", stare: "respinsa", motiv_respingere: "Poza neclara", verificata_de: f.adminId },
      { tip: "rece", stare: "respinsa", motiv_respingere: "Poza neclara", verificata_de: f.adminId },
    ]);
  });

  it("un apartament inexistent sau al altui bloc este refuzat cu acelasi mesaj ca administratorul strain", async () => {
    await expect(adm.valideazaCitiriApartament("00000000-0000-0000-0000-000000000000", luna, true, null))
      .rejects.toThrow("Apartamentul nu exista sau nu este din blocul tau.");
    await expect(loc.valideazaCitiriApartament(f.ap["1"], luna, true, null))
      .rejects.toThrow("Apartamentul nu exista sau nu este din blocul tau.");
  });
});
