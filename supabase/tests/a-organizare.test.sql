-- Teste pgTAP: organizare (agentul a-). Vezi antetul pentru ajutoare si este_serviciu().
begin;
create extension if not exists pgtap with schema extensions;
select plan(94);

-- =============================================================================
-- Ajutoare comune fisierelor a-*.test.sql (acelasi text in fiecare fisier).
--
-- Totul ruleaza intr-o tranzactie anulata la sfarsit (rollback): fisierul nu
-- depinde de datele seed si nu lasa nimic in urma.
--
-- Actori: utilizatori inserati direct in auth.users (trigger-ul
-- identitate.la_cont_nou le creeaza profilul), tinuti in pg_temp.t_id dupa
-- nume. Ca sa lucrezi ca un utilizator:
--     select pg_temp.ca('locA1'); set local role authenticated;
--     ... ;
--     reset role;
-- pg_temp.ca_anonim() si pg_temp.ca_serviciu() pun claim-urile rolurilor anon
-- si service_role.
--
-- Problema private.este_serviciu(): functia intoarce true cand session_user
-- este postgres, iar supabase test db (pg_prove) se conecteaza ca postgres.
-- `set local role` schimba doar current_user, iar `set session authorization`
-- este refuzat (postgres nu este superuser in Supabase). Asa ca, in fiecare
-- fisier, inlocuim functia DOAR in tranzactia testului (rollback o reface) cu
-- aceeasi expresie, in care session_user se poate simula prin
--     set local teste.sesiune = 'authenticator';
-- adica rolul cu care PostgREST se conecteaza in productie. Inainte de
-- inlocuire verificam ca textul original este exact cel asteptat; daca
-- cineva schimba functia, fisierul cade si inlocuirea trebuie revazuta.
-- Refuzurile "doar serviciul" au fost verificate si invers: fara simulare
-- (session_user = postgres) acelasi apel trece.
-- =============================================================================

create temp table t_id (nume text primary key, id uuid not null);
grant select on t_id to authenticated, anon, service_role;

create function pg_temp.id(p_nume text) returns uuid
language sql stable as $$ select id from pg_temp.t_id where nume = p_nume $$;

create function pg_temp.utilizator(p_nume text, p_meta jsonb default null) returns uuid
language plpgsql as $$
declare
  v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          lower(p_nume) || '.' || substr(v::text, 1, 8) || '@teste.local',
          coalesce(p_meta, jsonb_build_object('nume', 'Test ' || p_nume)), now(), now());
  insert into pg_temp.t_id values (p_nume, v);
  return v;
end;
$$;

create function pg_temp.ca(p_nume text) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_nume), 'role', 'authenticated')::text, true);
$$;

create function pg_temp.ca_anonim() returns void
language sql as $$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;

create function pg_temp.ca_serviciu() returns void
language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

-- Cate randuri atinge o comanda (update/delete/insert), cu drepturile si RLS
-- ale rolului curent: pg_temp.randuri($$update ... $$).
create function pg_temp.randuri(p_sql text) returns integer
language plpgsql as $$
declare v integer;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end;
$$;

create function pg_temp.fara_claims() returns void
language sql as $$ select set_config('request.jwt.claims', '', true); $$;

-- Lumea de test:
--   asocA cu blocA (apA1 cota 60, etaj 0, 3 persoane; apA2 cota 40, etaj 1,
--   2 persoane) si blocA2 (apA21 cota 100); asocB cu blocB (apB1 cota 100).
--   adminA, adminB: administratori aprobati; adminNou: cerere in asteptare, cu
--   mandat pe asocA; adminFost: aprobat, mandat pe asocA terminat ieri;
--   presA: presedinte al asocA; locA1 (proprietar apA1), locA2 (chirias apA2),
--   fostA1 (apA1, acces inchis ieri), viitorA1 (apA1, acces de peste 10 zile),
--   locB1 (apB1), strain (cont fara nicio legatura).
create function pg_temp.lume() returns void
language plpgsql as $$
declare
  r jsonb;
  v_cui text := 'TA' || substr(md5(random()::text), 1, 10);
  v_ap uuid;
begin
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia de test A', 'cui', v_cui),
    'bloc', jsonb_build_object('denumire', 'Bloc test A', 'adresa', 'Str. Testului 1', 'etaje', 4)));
  insert into pg_temp.t_id values ('asocA', (r ->> 'asociatie_id')::uuid), ('blocA', (r ->> 'bloc_id')::uuid);
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia de test A', 'cui', v_cui),
    'bloc', jsonb_build_object('denumire', 'Bloc test A2', 'adresa', 'Str. Testului 2', 'etaje', 2)));
  insert into pg_temp.t_id values ('blocA2', (r ->> 'bloc_id')::uuid);
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia de test B', 'cui', 'TB' || substr(md5(random()::text), 1, 10)),
    'bloc', jsonb_build_object('denumire', 'Bloc test B', 'adresa', 'Str. Testului 3', 'etaje', 4)));
  insert into pg_temp.t_id values ('asocB', (r ->> 'asociatie_id')::uuid), ('blocB', (r ->> 'bloc_id')::uuid);

  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza)
  values (pg_temp.id('blocA'), '1', 0, true, 'Proprietar A1', 60) returning id into v_ap;
  insert into pg_temp.t_id values ('apA1', v_ap);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.id('blocA'), '2', 1, 'Proprietar A2', 40) returning id into v_ap;
  insert into pg_temp.t_id values ('apA2', v_ap);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.id('blocA2'), '1', 1, 'Proprietar A21', 100) returning id into v_ap;
  insert into pg_temp.t_id values ('apA21', v_ap);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.id('blocB'), '1', 1, 'Proprietar B1', 100) returning id into v_ap;
  insert into pg_temp.t_id values ('apB1', v_ap);

  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (pg_temp.id('apA1'), '2026-01-01', 3), (pg_temp.id('apA2'), '2026-01-01', 2),
         (pg_temp.id('apA21'), '2026-01-01', 1), (pg_temp.id('apB1'), '2026-01-01', 4);

  perform pg_temp.utilizator('adminA');
  perform pg_temp.utilizator('adminB');
  perform pg_temp.utilizator('adminNou');
  perform pg_temp.utilizator('adminFost');
  perform pg_temp.utilizator('presA');
  perform pg_temp.utilizator('locA1');
  perform pg_temp.utilizator('locA2');
  perform pg_temp.utilizator('fostA1');
  perform pg_temp.utilizator('viitorA1');
  perform pg_temp.utilizator('locB1');
  perform pg_temp.utilizator('strain');

  perform identitate.numeste_administrator(pg_temp.id('adminA'), pg_temp.id('asocA'), 'AT-A', current_date - 100);
  perform identitate.numeste_administrator(pg_temp.id('adminB'), pg_temp.id('asocB'), 'AT-B', current_date - 100);
  perform identitate.numeste_administrator(pg_temp.id('adminFost'), pg_temp.id('asocA'), 'AT-F', current_date - 100);
  update identitate.membri_asociatie set activ_pana = current_date - 1 where profil_id = pg_temp.id('adminFost');
  insert into identitate.administratori (profil_id, numar_atestat, stare) values (pg_temp.id('adminNou'), 'AT-N', 'in_asteptare');
  insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
  values (pg_temp.id('asocA'), pg_temp.id('adminNou'), 'administrator', current_date - 10),
         (pg_temp.id('asocA'), pg_temp.id('presA'), 'presedinte', current_date - 10);

  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din, activ_pana)
  values (pg_temp.id('apA1'), pg_temp.id('blocA'), pg_temp.id('locA1'), 'proprietar', current_date - 30, null),
         (pg_temp.id('apA2'), pg_temp.id('blocA'), pg_temp.id('locA2'), 'chirias', current_date - 30, null),
         (pg_temp.id('apA1'), pg_temp.id('blocA'), pg_temp.id('fostA1'), 'proprietar', current_date - 60, current_date - 1),
         (pg_temp.id('apA1'), pg_temp.id('blocA'), pg_temp.id('viitorA1'), 'membru_familie', current_date + 10, null),
         (pg_temp.id('apB1'), pg_temp.id('blocB'), pg_temp.id('locB1'), 'proprietar', current_date - 30, null);
end;
$$;

do $$ begin perform pg_temp.lume(); end $$;

do $$
begin
  if (select btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) from pg_proc
      where oid = 'private.este_serviciu()'::regprocedure)
     <> 'select coalesce(auth.role(), '''') = ''service_role'' or session_user in (''postgres'', ''supabase_admin'');' then
    raise exception 'private.este_serviciu() s-a schimbat: revezi inlocuirea din testele a-*.';
  end if;
end;
$$;

create or replace function private.este_serviciu()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or coalesce(nullif(current_setting('teste.sesiune', true), ''), session_user) in ('postgres', 'supabase_admin');
$$;

-- De aici incolo sesiunea se comporta ca o conexiune PostgREST.
set local teste.sesiune = 'authenticator';

-- =============================================================================
-- Organizare (migratiile 20260919120009_organizare, 20260919120011_identitate
-- pentru politici, 20260919120023_evenimente_si_joburi pentru comenzi)
-- =============================================================================

create temp table t_json (nume text primary key, j jsonb not null);
grant all on t_json to authenticated;
create function pg_temp.j(p text) returns jsonb language sql stable as $$ select j from pg_temp.t_json where nume = p $$;

do $$
declare v uuid;
begin
  insert into nomenclator.administratii_locale (denumire, tip, judet, siruta)
  values ('Comuna de test', 'comuna', 'Judetul de test',
          (select s::text from generate_series(999999, 100000, -1) s
            where not exists (select 1 from nomenclator.administratii_locale where siruta = s::text) limit 1))
  returning id into v;
  insert into pg_temp.t_id values ('uat', v);
  insert into organizare.blocuri (asociatie_id, denumire, adresa, etaje)
  values (pg_temp.id('asocA'), 'Bloc nou', 'Str. Noua 1', 3) returning id into v;
  insert into pg_temp.t_id values ('blocN', v);
  insert into organizare.blocuri (asociatie_id, denumire, adresa, etaje)
  values (pg_temp.id('asocA'), 'Bloc gol', 'Str. Noua 2', 3) returning id into v;
  insert into pg_temp.t_id values ('blocGol', v);
  insert into organizare.blocuri (asociatie_id, denumire, adresa, etaje)
  values (pg_temp.id('asocA'), 'Bloc pentru S1', 'Str. Noua 3', 3) returning id into v;
  insert into pg_temp.t_id values ('blocS1', v);
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (pg_temp.id('apA1'), '2026-06-01', 2);
end;
$$;

-- -----------------------------------------------------------------------------
-- organizare.persoane_pe_luna
-- -----------------------------------------------------------------------------

select results_eq(
  $$select apartament_id, persoane from organizare.persoane_pe_luna(pg_temp.id('blocA'), '2026-03-01') order by persoane desc$$,
  $$values (pg_temp.id('apA1'), 3::smallint), (pg_temp.id('apA2'), 2::smallint)$$,
  'organizare.persoane_pe_luna: numarul valabil in luna ceruta');
select results_eq(
  $$select persoane from organizare.persoane_pe_luna(pg_temp.id('blocA'), '2026-07-01') where apartament_id = pg_temp.id('apA1')$$,
  $$values (2::smallint)$$,
  'organizare.persoane_pe_luna: schimbarea din iunie se vede din iunie');
select results_eq(
  $$select persoane from organizare.persoane_pe_luna(pg_temp.id('blocA'), '2025-12-01') order by apartament_id$$,
  $$values (0::smallint), (0::smallint)$$,
  'organizare.persoane_pe_luna: inainte de primul rand, 0 persoane');

-- -----------------------------------------------------------------------------
-- organizare.creeaza_asociatie
-- -----------------------------------------------------------------------------

select pg_temp.ca('adminA');
select throws_ok(
  $$select organizare.creeaza_asociatie('{"asociatie": {"denumire": "Hack"}}')$$,
  'Doar dezvoltatorul creeaza asociatii.',
  'organizare.creeaza_asociatie: refuzat in afara serviciului');
set local role authenticated;
select throws_ok(
  $$select organizare.creeaza_asociatie('{"asociatie": {"denumire": "Hack"}}')$$,
  '42501', null,
  'organizare.creeaza_asociatie: authenticated nu are drept de executie');
reset role;

select pg_temp.ca_serviciu();
insert into t_json values ('cerereC', jsonb_build_object(
  'asociatie', jsonb_build_object('denumire', 'Asociatia C', 'cui', 'TC' || substr(md5(random()::text), 1, 10), 'iban', 'RO49AAAA1B31007593840000'),
  'setari', jsonb_build_object('procentPenalizareZi', 0.05, 'zileGratie', 10, 'ziScadenta', 20, 'chitantaSerie', 'CC', 'chitantaUltimulNumar', 7),
  'bloc', jsonb_build_object('denumire', 'Bloc C', 'adresa', 'Str. C 1', 'etaje', 3,
    'uat_siruta', (select siruta from nomenclator.administratii_locale where id = pg_temp.id('uat')),
    'ziLimitaCitire', 20, 'rulmentPerApartament', 50)));
insert into t_json select 'c1', organizare.creeaza_asociatie(pg_temp.j('cerereC'));
insert into t_json select 'c2', organizare.creeaza_asociatie(pg_temp.j('cerereC'));
insert into t_json select 'd', organizare.creeaza_asociatie(jsonb_build_object(
  'asociatie', jsonb_build_object('denumire', 'Asociatia D', 'cui', 'TD' || substr(md5(random()::text), 1, 10))));

select results_eq(
  $$select denumire, iban from organizare.asociatii where id = (pg_temp.j('c1') ->> 'asociatie_id')::uuid$$,
  $$values ('Asociatia C'::text, 'RO49AAAA1B31007593840000'::text)$$,
  'organizare.creeaza_asociatie: asociatia cu datele trimise');
select results_eq(
  $$select procent_penalizare_zi, zile_gratie, zi_scadenta, chitanta_serie, chitanta_ultimul_numar
    from financiar.setari_financiare where asociatie_id = (pg_temp.j('c1') ->> 'asociatie_id')::uuid$$,
  $$values (0.05::numeric, 10::smallint, 20::smallint, 'CC'::text, 7)$$,
  'organizare.creeaza_asociatie: regulile de bani trimise');
select results_eq(
  $$select tip, activ, zile from comunicare.remindere_setari where asociatie_id = (pg_temp.j('c1') ->> 'asociatie_id')::uuid order by tip$$,
  $$values ('adunare_generala'::text, false, 10::smallint), ('citire_contoare', true, 5::smallint),
           ('lista_publicata', true, 0::smallint), ('plata', true, 3::smallint), ('restanta', true, 30::smallint)$$,
  'organizare.creeaza_asociatie: cele cinci remindere');
select results_eq(
  $$select b.denumire, b.uat_id, b.stare, b.etaje, s.zi_limita_citire
    from organizare.blocuri b join contorizare.setari_contorizare s on s.bloc_id = b.id
    where b.id = (pg_temp.j('c1') ->> 'bloc_id')::uuid$$,
  $$values ('Bloc C'::text, pg_temp.id('uat'), 'in_configurare'::text, 3::smallint, 20::smallint)$$,
  'organizare.creeaza_asociatie: blocul in configurare, cu UAT-ul din SIRUTA si ziua de citire');
select results_eq(
  $$select tip, suma_per_apartament from financiar.fonduri where bloc_id = (pg_temp.j('c1') ->> 'bloc_id')::uuid order by tip$$,
  $$values ('reparatii'::text, null::numeric), ('rulment'::text, 50::numeric)$$,
  'organizare.creeaza_asociatie: cele doua fonduri');
select is(pg_temp.j('c2'), pg_temp.j('c1'), 'organizare.creeaza_asociatie: a doua cerere cu acelasi CUI intoarce aceleasi id-uri');
select results_eq(
  $$select (select count(*)::int from organizare.blocuri where asociatie_id = (pg_temp.j('c1') ->> 'asociatie_id')::uuid),
           (select count(*)::int from comunicare.remindere_setari where asociatie_id = (pg_temp.j('c1') ->> 'asociatie_id')::uuid),
           (select count(*)::int from financiar.fonduri where bloc_id = (pg_temp.j('c1') ->> 'bloc_id')::uuid)$$,
  $$values (1, 5, 2)$$,
  'organizare.creeaza_asociatie: idempotenta, fara randuri duble');
select results_eq(
  $$select pg_temp.j('d') ->> 'bloc_id', s.procent_penalizare_zi, s.zile_gratie, s.zi_scadenta, s.chitanta_serie, s.chitanta_ultimul_numar
    from financiar.setari_financiare s where s.asociatie_id = (pg_temp.j('d') ->> 'asociatie_id')::uuid$$,
  $$values (null::text, 0.02::numeric, 30::smallint, 25::smallint, 'AP'::text, 0)$$,
  'organizare.creeaza_asociatie: fara bloc, cu regulile implicite');

-- -----------------------------------------------------------------------------
-- Inrolarea: politicile inrolare_apartamente si organizare.confirma_inrolare
-- -----------------------------------------------------------------------------

select pg_temp.ca('adminA');
set local role authenticated;
select lives_ok($$
  insert into organizare.inrolare_apartamente (bloc_id, numar, date, sursa) values
    (pg_temp.id('blocN'), '1', '{"etaj": 0, "proprietar": "Pop Ion", "persoane": 2, "cota": 55.5, "suprafata": 60,
      "restanta": 120.5, "restanta_scadenta": "2026-08-25", "index_rece": 10.5, "serie_rece": "R1", "luna_start": "2026-08-01"}', 'administrator'),
    (pg_temp.id('blocN'), '2', '{"etaj": 2, "proprietar": "Ion Pop", "persoane": 1, "cota": 44.5}', 'administrator'),
    (pg_temp.id('blocN'), '3', '{"etaj": 1, "proprietar": "Gresit", "cota": 1}', 'administrator')$$,
  'politica "Administratorul propune apartamente": administratorul blocului propune randuri');
select throws_ok($$
  insert into organizare.inrolare_apartamente (bloc_id, numar, date, sursa, stare) values (pg_temp.id('blocN'), '9', '{}', 'administrator', 'confirmat')$$,
  '42501', null,
  'politica "Administratorul propune apartamente": un rand nu se poate adauga deja confirmat');
reset role;
insert into pg_temp.t_id select 'inr' || numar, id from organizare.inrolare_apartamente where bloc_id = pg_temp.id('blocN');

select pg_temp.ca('adminB');
set local role authenticated;
select throws_ok($$
  insert into organizare.inrolare_apartamente (bloc_id, numar, date, sursa) values (pg_temp.id('blocN'), '8', '{}', 'administrator')$$,
  '42501', null,
  'politica "Administratorul propune apartamente": nu in blocul altuia');
select is(pg_temp.randuri($$update organizare.inrolare_apartamente set numar = '22' where id = pg_temp.id('inr2')$$), 0,
  'politica "Administratorul corecteaza o propunere": nu in blocul altuia');
select is(pg_temp.randuri($$delete from organizare.inrolare_apartamente where id = pg_temp.id('inr3')$$), 0,
  'politica "Administratorul sterge o propunere": nu in blocul altuia');
select throws_ok($$select organizare.confirma_inrolare(pg_temp.id('inr2'))$$,
  'Doar administratorul blocului confirma randurile.',
  'organizare.confirma_inrolare: administratorul altui bloc este refuzat');
select is_empty($$select 1 from organizare.inrolare_apartamente where bloc_id = pg_temp.id('blocN')$$,
  'politica "Inrolarea se vede de conducerea blocului": nu de administratorul altui bloc');
reset role;

select pg_temp.ca('locA1');
set local role authenticated;
select is_empty($$select 1 from organizare.inrolare_apartamente where bloc_id = pg_temp.id('blocN')$$,
  'politica "Inrolarea se vede de conducerea blocului": nu de locatari');
reset role;
select pg_temp.ca('presA');
set local role authenticated;
select is((select count(*)::int from organizare.inrolare_apartamente where bloc_id = pg_temp.id('blocN')), 3,
  'politica "Inrolarea se vede de conducerea blocului": presedintele vede randurile');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select is(pg_temp.randuri($$update organizare.inrolare_apartamente set date = date || '{"suprafata": 45}' where id = pg_temp.id('inr2')$$), 1,
  'politica "Administratorul corecteaza o propunere": administratorul corecteaza un rand propus');
select throws_ok($$update organizare.inrolare_apartamente set stare = 'confirmat' where id = pg_temp.id('inr2')$$,
  '42501', null,
  'politica "Administratorul corecteaza o propunere": confirmarea nu se face prin update direct');
insert into t_json select 'ap1', to_jsonb(organizare.confirma_inrolare(pg_temp.id('inr1')));
select throws_ok($$select organizare.confirma_inrolare(pg_temp.id('inr1'))$$,
  'Randul nu exista sau a fost deja confirmat.',
  'organizare.confirma_inrolare: un rand confirmat nu se confirma a doua oara');
select throws_ok($$select organizare.confirma_inrolare(gen_random_uuid())$$,
  'Randul nu exista sau a fost deja confirmat.',
  'organizare.confirma_inrolare: rand inexistent');
select is(pg_temp.randuri($$update organizare.inrolare_apartamente set numar = '11' where id = pg_temp.id('inr1')$$), 0,
  'politica "Administratorul corecteaza o propunere": un rand confirmat nu se mai modifica');
select is(pg_temp.randuri($$delete from organizare.inrolare_apartamente where id = pg_temp.id('inr1')$$), 0,
  'politica "Administratorul sterge o propunere": un rand confirmat nu se sterge');
reset role;
insert into pg_temp.t_id values ('apN1', (pg_temp.j('ap1') #>> '{}')::uuid);

select results_eq(
  $$select bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza, suprafata_mp from organizare.apartamente where id = pg_temp.id('apN1')$$,
  $$values (pg_temp.id('blocN'), '1'::text, 0::smallint, true, 'Pop Ion'::text, 55.5::numeric(7,4), 60::numeric(7,2))$$,
  'organizare.confirma_inrolare: apartamentul cu datele de pe hartie (parterul scutit de lift)');
select results_eq(
  $$select valabil_din, numar_persoane, modificat_de from organizare.apartamente_persoane where apartament_id = pg_temp.id('apN1')$$,
  $$values ('2026-08-01'::date, 2::smallint, pg_temp.id('adminA'))$$,
  'organizare.confirma_inrolare: persoanele din luna de start');
select results_eq(
  $$select stare, confirmat_de, confirmat_la is not null, apartament_id from organizare.inrolare_apartamente where id = pg_temp.id('inr1')$$,
  $$values ('confirmat'::text, pg_temp.id('adminA'), true, pg_temp.id('apN1'))$$,
  'organizare.confirma_inrolare: randul devine confirmat');
select results_eq(
  $$select tip, date ->> 'bloc_id', date ->> 'luna', (date ->> 'restanta')::numeric, date -> 'index_rece', date ->> 'serie_rece', date -> 'index_calda'
    from evenimente.coada where agregat_id = pg_temp.id('apN1')$$,
  $$values ('ApartamentCreat'::text, pg_temp.id('blocN')::text, '2026-08-01'::text, 120.5, '10.5'::jsonb, 'R1'::text, 'null'::jsonb)$$,
  'organizare.confirma_inrolare: evenimentul ApartamentCreat duce restanta si indexurile');

-- -----------------------------------------------------------------------------
-- organizare.activeaza_bloc
-- -----------------------------------------------------------------------------

select pg_temp.ca('adminA');
set local role authenticated;
select throws_like($$select organizare.activeaza_bloc(pg_temp.id('blocN'))$$,
  'Blocul nu este complet: 1 apartamente, cote 55.5000 din 100, 0 fara persoane, 0 contoare fara index, 2 randuri neconfirmate.',
  'organizare.activeaza_bloc: "Blocul nu este complet: " cu cotele si randurile neconfirmate');
select throws_like($$select organizare.activeaza_bloc(pg_temp.id('blocGol'))$$,
  'Blocul nu este complet: 0 apartamente%',
  'organizare.activeaza_bloc: un bloc fara apartamente nu se activeaza');
select is(pg_temp.randuri($$delete from organizare.inrolare_apartamente where id = pg_temp.id('inr3')$$), 1,
  'politica "Administratorul sterge o propunere": administratorul sterge un rand propus');
reset role;

select pg_temp.ca_serviciu();
select is(organizare.confirma_inrolare(pg_temp.id('inr2')) is not null, true,
  'organizare.confirma_inrolare: serviciul poate confirma');
select results_eq(
  $$select a.scutit_lift, a.suprafata_mp, p.valabil_din, p.modificat_de, i.confirmat_de
    from organizare.inrolare_apartamente i join organizare.apartamente a on a.id = i.apartament_id
    join organizare.apartamente_persoane p on p.apartament_id = a.id
    where i.id = pg_temp.id('inr2')$$,
  $$values (false, 45::numeric(7,2), date_trunc('month', current_date)::date, null::uuid, null::uuid)$$,
  'organizare.confirma_inrolare: fara luna_start se foloseste luna curenta; etajul 2 nu e scutit');

insert into contorizare.contoare (bloc_id, apartament_id, tip, serie) values (pg_temp.id('blocN'), pg_temp.id('apN1'), 'rece', 'R1');
select pg_temp.ca('adminA');
set local role authenticated;
select throws_like($$select organizare.activeaza_bloc(pg_temp.id('blocN'))$$,
  'Blocul nu este complet: 2 apartamente, cote 100.0000 din 100, 0 fara persoane, 1 contoare fara index, 0 randuri neconfirmate.',
  'organizare.activeaza_bloc: un contor fara index de pornire opreste activarea');
reset role;
-- Handler-ul ApartamentCreat pune indexul de pornire pe contorul existent.
select contorizare.la_apartament_creat((select date from evenimente.coada where agregat_id = pg_temp.id('apN1')));

select pg_temp.ca('adminB');
set local role authenticated;
select throws_ok($$select organizare.activeaza_bloc(pg_temp.id('blocN'))$$,
  'Doar administratorul blocului il poate activa.',
  'organizare.activeaza_bloc: administratorul altui bloc este refuzat');
reset role;
select pg_temp.ca('presA');
set local role authenticated;
select throws_ok($$select organizare.activeaza_bloc(pg_temp.id('blocN'))$$,
  'Doar administratorul blocului il poate activa.',
  'organizare.activeaza_bloc: presedintele este refuzat');
reset role;
select pg_temp.ca('adminA');
set local role authenticated;
select lives_ok($$select organizare.activeaza_bloc(pg_temp.id('blocN'))$$,
  'organizare.activeaza_bloc: blocul complet se activeaza');
select results_eq($$select stare, activat_la = now() from organizare.blocuri where id = pg_temp.id('blocN')$$,
  $$values ('activ'::text, true)$$,
  'organizare.activeaza_bloc: stare activ si data activarii');
reset role;
select pg_temp.ca_serviciu();
select lives_ok($$select organizare.activeaza_bloc(pg_temp.id('blocA2'))$$,
  'organizare.activeaza_bloc: serviciul activeaza un bloc complet');
select todo('[NOU-2] activeaza_bloc pe un bloc inexistent nu da eroare (verificarile citesc null)', 1);
select throws_ok($$select organizare.activeaza_bloc(gen_random_uuid())$$, null, null,
  '[NOU-2] activeaza_bloc refuza un bloc inexistent');

-- -----------------------------------------------------------------------------
-- organizare.contacte_asociatie si politicile contacte
-- -----------------------------------------------------------------------------

insert into organizare.contacte (asociatie_id, bloc_id, rol, nume, telefon, apartament_id, ordine) values
  (pg_temp.id('asocA'), null, 'presedinte', 'Ion Presedinte', '0711', pg_temp.id('apA1'), 1),
  (pg_temp.id('asocA'), pg_temp.id('blocA'), 'administrator', 'Ana Admin', '0722', null, 0),
  (pg_temp.id('asocA'), pg_temp.id('blocA2'), 'lift', 'Firma Lift', '0733', null, 2),
  (pg_temp.id('asocB'), null, 'administrator', 'Bogdan B', '0744', null, 0);

select pg_temp.ca('locA1');
set local role authenticated;
select results_eq(
  $$select nume, rol, apartament_numar, ordine from organizare.contacte_asociatie(pg_temp.id('asocA'))$$,
  $$values ('Ana Admin'::text, 'administrator'::text, null::text, 0::smallint), ('Ion Presedinte', 'presedinte', '1', 1::smallint)$$,
  'organizare.contacte_asociatie: locatarul vede contactele asociatiei si ale blocului lui, in ordine');
select throws_ok($$select * from organizare.contacte_asociatie(pg_temp.id('asocB'))$$,
  'Nu ai acces la aceasta asociatie.',
  'organizare.contacte_asociatie: nu pentru alta asociatie');
select set_eq($$select nume from organizare.contacte where asociatie_id in (pg_temp.id('asocA'), pg_temp.id('asocB'))$$,
  array['Ion Presedinte', 'Ana Admin', 'Firma Lift'],
  'politica "Contactele se vad in toata asociatia": locatarul vede contactele asociatiei, nu si ale altora');
select throws_ok($$insert into organizare.contacte (asociatie_id, rol, nume, telefon) values (pg_temp.id('asocA'), 'altul', 'X', '1')$$,
  '42501', null, 'politica "Administratorul adauga contacte": locatarul nu adauga');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select is((select count(*)::int from organizare.contacte_asociatie(pg_temp.id('asocA'))), 3,
  'organizare.contacte_asociatie: administratorul vede contactele tuturor blocurilor');
select lives_ok($$insert into organizare.contacte (asociatie_id, rol, nume, telefon) values (pg_temp.id('asocA'), 'cenzor', 'Cornel Cenzor', '0755')$$,
  'politica "Administratorul adauga contacte": administratorul asociatiei');
select is(pg_temp.randuri($$update organizare.contacte set telefon = '0799' where nume = 'Firma Lift' and asociatie_id = pg_temp.id('asocA')$$), 1,
  'politica "Administratorul modifica contacte": administratorul asociatiei');
select is(pg_temp.randuri($$delete from organizare.contacte where nume = 'Cornel Cenzor' and asociatie_id = pg_temp.id('asocA')$$), 1,
  'politica "Administratorul sterge contacte": administratorul asociatiei');
reset role;

select pg_temp.ca('adminB');
set local role authenticated;
select throws_ok($$select * from organizare.contacte_asociatie(pg_temp.id('asocA'))$$,
  'Nu ai acces la aceasta asociatie.',
  'organizare.contacte_asociatie: administratorul altei asociatii este refuzat');
select throws_ok($$insert into organizare.contacte (asociatie_id, rol, nume, telefon) values (pg_temp.id('asocA'), 'altul', 'X', '1')$$,
  '42501', null, 'politica "Administratorul adauga contacte": nu in asociatia altuia');
select is(pg_temp.randuri($$update organizare.contacte set telefon = '0' where asociatie_id = pg_temp.id('asocA')$$), 0,
  'politica "Administratorul modifica contacte": nu in asociatia altuia');
select is(pg_temp.randuri($$delete from organizare.contacte where asociatie_id = pg_temp.id('asocA')$$), 0,
  'politica "Administratorul sterge contacte": nu in asociatia altuia');
reset role;

select pg_temp.ca('fostA1');
set local role authenticated;
select throws_ok($$select * from organizare.contacte_asociatie(pg_temp.id('asocA'))$$,
  'Nu ai acces la aceasta asociatie.',
  'organizare.contacte_asociatie: fostul locatar nu mai are acces');
reset role;
select pg_temp.ca_anonim();
set local role anon;
select throws_ok($$select * from organizare.contacte_asociatie(pg_temp.id('asocA'))$$, '42501', null,
  'organizare.contacte_asociatie: anon nu are acces');
reset role;

-- -----------------------------------------------------------------------------
-- Politicile asociatii si blocuri
-- -----------------------------------------------------------------------------

select pg_temp.ca('locA1');
set local role authenticated;
select set_eq($$select id from organizare.asociatii where id in (pg_temp.id('asocA'), pg_temp.id('asocB'))$$, array[pg_temp.id('asocA')],
  'politica "Asociatia se vede de membrii si locatarii ei": locatarul vede doar asociatia lui');
select set_eq($$select id from organizare.blocuri where id in (pg_temp.id('blocA'), pg_temp.id('blocA2'), pg_temp.id('blocB'))$$, array[pg_temp.id('blocA')],
  'politica "Blocul se vede de membrii si locatarii lui": locatarul vede doar blocul lui');
select throws_ok($$update organizare.blocuri set adresa = 'Hack' where id = pg_temp.id('blocA')$$,
  '42501', null, 'politica "Administratorul modifica blocul" a fost scoasa [S1]: locatarul nu modifica');
reset role;

select pg_temp.ca('presA');
set local role authenticated;
select set_eq($$select id from organizare.blocuri where id in (pg_temp.id('blocA'), pg_temp.id('blocA2'), pg_temp.id('blocB'))$$,
  array[pg_temp.id('blocA'), pg_temp.id('blocA2')],
  'politica "Blocul se vede de membrii si locatarii lui": presedintele vede blocurile asociatiei');
reset role;

select pg_temp.ca('strain');
set local role authenticated;
select is_empty($$select 1 from organizare.asociatii where id in (pg_temp.id('asocA'), pg_temp.id('asocB'))$$,
  'politica "Asociatia se vede de membrii si locatarii ei": un cont fara legaturi nu vede nimic');
reset role;
select pg_temp.ca('adminNou');
set local role authenticated;
select is_empty($$select 1 from organizare.blocuri where asociatie_id = pg_temp.id('asocA')$$,
  'politica "Blocul se vede de membrii si locatarii lui": administratorul neaprobat nu vede nimic');
reset role;
select pg_temp.ca('fostA1');
set local role authenticated;
select is_empty($$select 1 from organizare.asociatii where id = pg_temp.id('asocA')$$,
  'politica "Asociatia se vede de membrii si locatarii ei": fostul locatar nu mai vede');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select todo('[S16] politica de update pe asociatii nu are grant: administratorul nu isi poate modifica asociatia', 1);
select lives_ok($$update organizare.asociatii set telefon = '0700' where id = pg_temp.id('asocA')$$,
  '[S16] administratorul modifica datele asociatiei');
reset role;
-- Ca sa verificam expresia politicii, dam grant-ul lipsa doar in tranzactie.
grant update on organizare.asociatii to authenticated;
set local role authenticated;
select is(pg_temp.randuri($$update organizare.asociatii set telefon = '0700' where id = pg_temp.id('asocA')$$), 1,
  'politica "Administratorul modifica datele asociatiei": administratorul asociatiei (cu grant-ul lipsa dat in test)');
select is(pg_temp.randuri($$update organizare.asociatii set telefon = '0700' where id = pg_temp.id('asocB')$$), 0,
  'politica "Administratorul modifica datele asociatiei": nu asociatia altuia');
select throws_ok($$update organizare.blocuri set adresa = 'Str. Testului 1A' where id = pg_temp.id('blocA')$$,
  '42501', null, 'politica "Administratorul modifica blocul" a fost scoasa [S1]: nici administratorul nu modifica blocul direct');
select throws_ok($$update organizare.blocuri set adresa = 'Hack' where id = pg_temp.id('blocB')$$,
  '42501', null, 'politica "Administratorul modifica blocul" a fost scoasa [S1]: nici blocul altuia');
select throws_ok($$insert into organizare.blocuri (asociatie_id, denumire, adresa, etaje) values (pg_temp.id('asocA'), 'Bloc direct', 'X', 1)$$,
  '42501', null, 'organizare.blocuri: blocul nou nu se adauga direct (nicio politica de insert)');
-- [S1] invariantii blocului nu mai pot fi ocoliti prin scrieri directe
select throws_ok($$update organizare.blocuri set stare = 'activ' where id = pg_temp.id('blocS1')$$, null, null,
  '[S1] blocul nu trece in activ fara activeaza_bloc');
select throws_ok($$update organizare.blocuri set arhivat_la = now() where id = pg_temp.id('blocS1')$$, null, null,
  '[S1] administratorul nu isi arhiveaza singur blocul');
select throws_ok($$update organizare.blocuri set asociatie_id = pg_temp.id('asocB') where id = pg_temp.id('blocS1')$$, null, null,
  '[S1] blocul nu se muta in alta asociatie');
select throws_ok($$update organizare.apartamente set cota_indiviza = 45.37 where id = pg_temp.id('apA21')$$, null, null,
  '[S1] cotele unui bloc activ nu mai pot iesi din 100');
reset role;

-- -----------------------------------------------------------------------------
-- Politicile apartamente si apartamente_persoane
-- -----------------------------------------------------------------------------

select pg_temp.ca('locA1');
set local role authenticated;
select set_eq($$select id from organizare.apartamente where id in (pg_temp.id('apA1'), pg_temp.id('apA2'), pg_temp.id('apA21'), pg_temp.id('apB1'))$$,
  array[pg_temp.id('apA1')],
  'politica "Apartamentele se vad de conducere, al tau se vede de tine": locatarul vede doar apartamentul lui');
select set_eq($$select distinct apartament_id from organizare.apartamente_persoane where apartament_id in (pg_temp.id('apA1'), pg_temp.id('apA2'), pg_temp.id('apB1'))$$,
  array[pg_temp.id('apA1')],
  'politica "Persoanele se vad ca apartamentul": locatarul vede doar persoanele lui');
select throws_ok($$insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza) values (pg_temp.id('blocA'), '7', 1, 'X', 1)$$,
  '42501', null, 'politica "Administratorul adauga apartamente": locatarul nu adauga');
select throws_ok($$update organizare.apartamente set proprietar_nume = 'Hack' where id = pg_temp.id('apA1')$$,
  '42501', null, 'politica "Administratorul modifica fisa apartamentului" a fost scoasa [S1]: locatarul nu isi modifica fisa');
select throws_ok($$insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane, modificat_de)
    values (pg_temp.id('apA1'), date_trunc('month', current_date)::date, 9, pg_temp.id('locA1'))$$,
  '42501', null, 'politica "Administratorul adauga o schimbare de persoane": locatarul nu adauga');
reset role;

select pg_temp.ca('presA');
set local role authenticated;
select set_eq($$select id from organizare.apartamente where id in (pg_temp.id('apA1'), pg_temp.id('apA2'), pg_temp.id('apA21'), pg_temp.id('apB1'))$$,
  array[pg_temp.id('apA1'), pg_temp.id('apA2'), pg_temp.id('apA21')],
  'politica "Apartamentele se vad de conducere, al tau se vede de tine": presedintele vede tot blocul');
select set_eq($$select distinct apartament_id from organizare.apartamente_persoane where apartament_id in (pg_temp.id('apA1'), pg_temp.id('apA2'), pg_temp.id('apB1'))$$,
  array[pg_temp.id('apA1'), pg_temp.id('apA2')],
  'politica "Persoanele se vad ca apartamentul": presedintele vede persoanele blocului');
reset role;

select pg_temp.ca('fostA1');
set local role authenticated;
select is_empty($$select 1 from organizare.apartamente where id = pg_temp.id('apA1')$$,
  'politica "Apartamentele se vad de conducere, al tau se vede de tine": fostul locatar nu mai vede apartamentul');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select throws_ok($$insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza) values (pg_temp.id('blocGol'), '1', 1, 'Nou', 100)$$,
  '42501', null, 'politica "Administratorul adauga apartamente" a fost scoasa [S1]: apartamentele intra doar prin confirma_inrolare');
select throws_ok($$insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza) values (pg_temp.id('blocB'), '7', 1, 'X', 1)$$,
  '42501', null, 'politica "Administratorul adauga apartamente": nu in blocul altuia');
select throws_ok($$update organizare.apartamente set proprietar_nume = 'Proprietar A2 nou' where id = pg_temp.id('apA2')$$,
  '42501', null, 'politica "Administratorul modifica fisa apartamentului" a fost scoasa [S1]: nici administratorul nu modifica direct');
select throws_ok($$update organizare.apartamente set proprietar_nume = 'Hack' where id = pg_temp.id('apB1')$$,
  '42501', null, 'politica "Administratorul modifica fisa apartamentului" a fost scoasa [S1]: nici apartamentul altuia');
select throws_ok($$update organizare.apartamente set bloc_id = pg_temp.id('blocB') where id = pg_temp.id('apA2')$$,
  '42501', null, 'politica "Administratorul modifica fisa apartamentului": apartamentul nu se muta in blocul altuia');
select throws_ok($$delete from organizare.apartamente where id = pg_temp.id('apA2')$$,
  '42501', null, 'organizare.apartamente: apartamentele nu se sterg');
select lives_ok($$insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane, modificat_de, motiv)
    values (pg_temp.id('apA2'), date_trunc('month', current_date)::date, 3, pg_temp.id('adminA'), 'S-a nascut un copil')$$,
  'politica "Administratorul adauga o schimbare de persoane": de luna curenta, semnata de administrator');
select throws_ok($$insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane, modificat_de)
    values (pg_temp.id('apA2'), (date_trunc('month', current_date) - interval '1 month')::date, 1, pg_temp.id('adminA'))$$,
  '42501', null, 'politica "Administratorul adauga o schimbare de persoane": nu in urma');
select throws_ok($$insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane, modificat_de)
    values (pg_temp.id('apA1'), (date_trunc('month', current_date) + interval '1 month')::date, 1, pg_temp.id('locA1'))$$,
  '42501', null, 'politica "Administratorul adauga o schimbare de persoane": semnatura trebuie sa fie a lui');
reset role;

select pg_temp.ca('adminB');
set local role authenticated;
select set_eq($$select id from organizare.apartamente where id in (pg_temp.id('apA1'), pg_temp.id('apA2'), pg_temp.id('apB1'))$$,
  array[pg_temp.id('apB1')],
  'politica "Apartamentele se vad de conducere, al tau se vede de tine": administratorul B vede doar blocul lui');
select throws_ok($$insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane, modificat_de)
    values (pg_temp.id('apA1'), (date_trunc('month', current_date) + interval '1 month')::date, 1, pg_temp.id('adminB'))$$,
  '42501', null, 'politica "Administratorul adauga o schimbare de persoane": nu in blocul altuia');
reset role;

select * from finish();
rollback;
