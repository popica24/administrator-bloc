/* J11: apartamente, contoare si invitatii se citeau in incarca() cu ok()
   (o singura cerere), nu cu paginarea pe cheie (toate()) pe care restul
   tabelelor mari o folosesc deja. PostgREST intoarce cel mult max_rows
   randuri (1000, supabase/config.toml) pe o singura cerere: un bloc cu mai
   mult de 1000 apartamente sau contoare, sau un apartament cu peste 1000
   coduri de invitatie nefolosite, pierde tacut restul — ecranul
   Apartamente arata mai putine apartamente/coduri decat exista, fara
   nicio eroare.

   Randurile in plus se insereaza direct (service role, ca seed-ul), fara
   sa treaca prin fluxul de inrolare — irelevant aici, testul verifica doar
   cate randuri intoarce incarca(). */
import { beforeAll, describe, expect, it } from "vitest";
import { creeazaBloc, db, intraCa } from "./fixture.js";

const PESTE_MAX_ROWS = 1001;
/* Cod de invitatie valid: A-H, J-N, P-Z, 2-9 (identitate.invitatii). */
const ALFABET_COD = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/* cod are unicitate globala (identitate.invitatii_cod_key), nu doar in bloc:
   un decalaj aleatoriu per rulare tine codurile unice intre rulari repetate
   ale testului, fara supabase db reset intre ele (ca restul testelor de
   integrare). */
const DECALAJ_COD = Math.floor(Math.random() * 1_000_000);
function codInvitatie(i) {
  let n = i + DECALAJ_COD;
  let cod = "";
  for (let k = 0; k < 8; k += 1) {
    cod = ALFABET_COD[n % ALFABET_COD.length] + cod;
    n = Math.floor(n / ALFABET_COD.length);
  }
  return cod;
}

async function inserariInBucati(query, randuri, marime = 200) {
  const rezultat = [];
  for (let i = 0; i < randuri.length; i += marime) {
    const bucata = randuri.slice(i, i + marime);
    const { data, error } = await query(bucata);
    if (error) throw new Error(error.message);
    if (data) rezultat.push(...data);
  }
  return rezultat;
}

describe("[J11] apartamente si contoare: peste max_rows pe bloc", () => {
  let f;
  let s;

  beforeAll(async () => {
    /* activeaza_bloc cere macar un apartament, cu cote insumand 100 si cu
       persoane declarate; blocul, o data activat, nu mai controleaza cota
       la fiecare apartament nou (doar la activare) — restul de 1001
       apartamente, inserate direct dupa, pot avea orice cota valida. */
    f = await creeazaBloc({
      apartamente: [{ numar: "0", etaj: 0, persoane: 1, cota: 100, index_rece: 0 }],
      locatari: [],
    });

    const apartamente = Array.from({ length: PESTE_MAX_ROWS }, (_, i) => ({
      bloc_id: f.blocId, numar: `A${i}`, etaj: 0, proprietar_nume: `Proprietar ${i}`, cota_indiviza: 0.1,
    }));
    const inserate = await inserariInBucati(
      (bucata) => db("organizare").from("apartamente").insert(bucata).select("id"),
      apartamente,
    );
    expect(inserate).toHaveLength(PESTE_MAX_ROWS);

    const contoare = inserate.map((a, i) => ({ bloc_id: f.blocId, apartament_id: a.id, tip: "rece", serie: `S-${i}` }));
    await inserariInBucati((bucata) => db("contorizare").from("contoare").insert(bucata).select("id"), contoare);

    ({ s } = await intraCa(f.adminEmail));
  }, 60000);

  it("apartamente: toate randurile, nu doar primele max_rows", async () => {
    const date = await s.incarca();
    /* Apartamentul "0" al fixture-ului, plus cele 1001 inserate direct. */
    expect(date.apartamente).toHaveLength(PESTE_MAX_ROWS + 1);
  });

  it("contoare: toate randurile, nu doar primele max_rows", async () => {
    const date = await s.incarca();
    /* Peste max_rows (1000): cele doua contoare generale si cel al
       apartamentului "0", plus cele 1001 inserate direct. */
    expect(date.contoare.length).toBeGreaterThan(1000);
  });
});

describe("[J11] invitatii: peste max_rows pe un singur apartament", () => {
  let f;
  let s;

  beforeAll(async () => {
    /* Bloc mic (ca apel .in("apartament_id", ...) din incarca() sa ramana
       scurt): un singur apartament, cu 1001 coduri de invitatie nefolosite,
       nedeschise prin flux normal (un singur cod per invitatie oricum, dar
       aici verificam doar numaratoarea, nu folosirea codurilor). */
    f = await creeazaBloc({
      apartamente: [{ numar: "0", etaj: 0, persoane: 1, cota: 100, index_rece: 0 }],
      locatari: [],
    });
    const acum = Date.now();
    const invitatii = Array.from({ length: PESTE_MAX_ROWS }, (_, i) => ({
      apartament_id: f.ap["0"], cod: codInvitatie(i), calitate: "proprietar",
      expira_la: new Date(acum + 30 * 86400000).toISOString(),
    }));
    const inserate = await inserariInBucati((bucata) => db("identitate").from("invitatii").insert(bucata).select("id"), invitatii);
    expect(inserate).toHaveLength(PESTE_MAX_ROWS);

    ({ s } = await intraCa(f.adminEmail));
  }, 60000);

  it("toate codurile nefolosite ale apartamentului, nu doar primele max_rows", async () => {
    const date = await s.incarca();
    const ap0 = date.apartamente.find((a) => a.numar === "0");
    expect(ap0.invitatii).toHaveLength(PESTE_MAX_ROWS);
  });
});
