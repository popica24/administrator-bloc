/* J11: apartamentele si contoarele se citeau in incarca() cu ok() (o singura
   cerere), nu cu paginarea pe cheie (toate()) pe care restul tabelelor mari o
   folosesc deja. PostgREST intoarce cel mult max_rows randuri (1000,
   supabase/config.toml) pe o singura cerere: un bloc cu mai mult de 1000
   apartamente sau contoare pierde tacut restul, ecranul Apartamente arata
   mai putine decat exista, fara nicio eroare.

   Randurile in plus se insereaza direct (service role, ca seed-ul), fara
   sa treaca prin fluxul de inrolare, irelevant aici, testul verifica doar
   cate randuri intoarce incarca(). */
import { beforeAll, describe, expect, it } from "vitest";
import { creeazaBloc, db, intraCa } from "./fixture.js";

const PESTE_MAX_ROWS = 1001;
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
       la fiecare apartament nou (doar la activare), restul de 1001
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

    ({ s } = await intraCa(f.adminTelefon));
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
