-- Teste pgTAP: fundatie (agentul a-). Vezi antetul pentru ajutoare si este_serviciu().
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

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
-- public.seteaza_actualizat_la si politica nomenclatorului
-- (migratiile 20260907115303_administratii_locale, 20260919120008_fundatia)
-- =============================================================================

create function pg_temp.uat_nou() returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into nomenclator.administratii_locale (denumire, tip, judet, actualizat_la)
  values ('Comuna de test', 'comuna', 'Judetul de test', '2000-01-01')
  returning id into v;
  insert into pg_temp.t_id values ('uat', v);
  return v;
end;
$$;
do $$ begin perform pg_temp.uat_nou(); end $$;

update nomenclator.administratii_locale set denumire = 'Comuna de test 2' where id = pg_temp.id('uat');
select is(
  (select actualizat_la from nomenclator.administratii_locale where id = pg_temp.id('uat')),
  now(),
  'public.seteaza_actualizat_la: update-ul pune actualizat_la = now()');
select is(
  (select actualizat_la from organizare.asociatii where id = pg_temp.id('asocA')) <= now(),
  true,
  'public.seteaza_actualizat_la: randurile noi pastreaza valoarea implicita');

select pg_temp.ca_anonim();
set local role anon;
select is(
  (select count(*)::int from nomenclator.administratii_locale where id = pg_temp.id('uat')), 1,
  'politica "Administratiile locale pot fi citite de oricine": anon citeste');
select throws_ok(
  $$insert into nomenclator.administratii_locale (denumire, tip, judet) values ('X', 'comuna', 'Y')$$,
  '42501', null,
  'nomenclator: anon nu poate adauga (nicio politica de insert)');
select is(
  pg_temp.randuri($$update nomenclator.administratii_locale set denumire = 'Hack' where id = pg_temp.id('uat')$$), 0,
  'nomenclator: anon nu poate modifica niciun rand');
reset role;

select pg_temp.ca('strain');
set local role authenticated;
select is(
  (select count(*)::int from nomenclator.administratii_locale where id = pg_temp.id('uat')), 1,
  'politica "Administratiile locale pot fi citite de oricine": authenticated citeste');
select is(
  pg_temp.randuri($$delete from nomenclator.administratii_locale where id = pg_temp.id('uat')$$), 0,
  'nomenclator: authenticated nu poate sterge niciun rand');
reset role;

select todo('[S15] nomenclator.administratii_locale pastreaza INSERT/UPDATE/DELETE/TRUNCATE pentru anon si authenticated', 2);
select table_privs_are('nomenclator', 'administratii_locale', 'anon', array['SELECT'],
  '[S15] anon are doar SELECT pe nomenclator.administratii_locale');
select table_privs_are('nomenclator', 'administratii_locale', 'authenticated', array['SELECT'],
  '[S15] authenticated are doar SELECT pe nomenclator.administratii_locale');

-- =============================================================================
-- evenimente.inregistreaza
-- =============================================================================

insert into pg_temp.t_id values ('agregat', gen_random_uuid());
select lives_ok(
  $$select evenimente.inregistreaza('TestFundatie', 'teste', pg_temp.id('agregat'), null)$$,
  'evenimente.inregistreaza: scrie un eveniment');
select results_eq(
  $$select tip, context, date, procesat_la is null, incercari from evenimente.coada where agregat_id = pg_temp.id('agregat')$$,
  $$values ('TestFundatie'::text, 'teste'::text, '{}'::jsonb, true, 0)$$,
  'evenimente.inregistreaza: date null devine {}, evenimentul e neprocesat');
select throws_ok(
  $$select evenimente.inregistreaza(' ', 'teste', gen_random_uuid(), '{}')$$,
  '23514', null,
  'evenimente.inregistreaza: coada refuza un tip gol');

select pg_temp.ca('adminA');
set local role authenticated;
select throws_ok(
  $$select evenimente.inregistreaza('Fals', 'teste', gen_random_uuid(), '{}')$$,
  '42501', null,
  'evenimente.inregistreaza: aplicatia (authenticated) nu poate scrie evenimente');
select throws_ok(
  $$select count(*) from evenimente.coada$$,
  '42501', null,
  'evenimente.coada: authenticated nu o poate citi');
reset role;

-- =============================================================================
-- audit.inregistreaza
-- =============================================================================

select pg_temp.ca('adminA');
insert into organizare.asociatii (denumire, cui) values ('Asociatia auditata', 'AUD' || substr(md5(random()::text), 1, 9));
insert into pg_temp.t_id select 'asocAudit', id from organizare.asociatii where denumire = 'Asociatia auditata';
update organizare.asociatii set telefon = '0722000000' where id = pg_temp.id('asocAudit');
delete from organizare.asociatii where id = pg_temp.id('asocAudit');

select results_eq(
  $$select operatie, rand_id, autor_id, nou ->> 'denumire', vechi ->> 'telefon', nou ->> 'telefon'
    from audit.jurnal where tabela = 'organizare.asociatii' and rand_id = pg_temp.id('asocAudit') order by id$$,
  $$values ('INSERT'::text, pg_temp.id('asocAudit'), pg_temp.id('adminA'), 'Asociatia auditata'::text, null::text, null::text),
           ('UPDATE'::text, pg_temp.id('asocAudit'), pg_temp.id('adminA'), 'Asociatia auditata'::text, null::text, '0722000000'::text),
           ('DELETE'::text, pg_temp.id('asocAudit'), pg_temp.id('adminA'), null::text, '0722000000'::text, null::text)$$,
  'audit.inregistreaza: insert, update si delete ajung in jurnal cu rand_id si autorul');

select pg_temp.ca_serviciu();
update organizare.apartamente set proprietar_nume = 'Proprietar A1 nou' where id = pg_temp.id('apA1');
select is(
  (select autor_id from audit.jurnal where tabela = 'organizare.apartamente' and rand_id = pg_temp.id('apA1') and operatie = 'UPDATE' order by id desc limit 1),
  null,
  'audit.inregistreaza: autor_id este null cand scrie serviciul');

select pg_temp.ca('locA1');
set local role authenticated;
select throws_ok($$select count(*) from audit.jurnal$$, '42501', null,
  'audit.jurnal: authenticated nu il poate citi');
reset role;

update identitate.administratori set numar_atestat = 'AT-N2' where profil_id = pg_temp.id('adminNou');
select todo('[S14] auditul ia rand_id din ->>''id'', dar administratori are cheia profil_id', 1);
select is(
  (select rand_id from audit.jurnal where tabela = 'identitate.administratori' and operatie = 'UPDATE'
     and nou ->> 'profil_id' = pg_temp.id('adminNou')::text order by id desc limit 1),
  pg_temp.id('adminNou'),
  '[S14] audit pe identitate.administratori are rand_id = profil_id');

-- =============================================================================
-- private.este_luna
-- =============================================================================

select is(private.este_luna('2026-09-01'), true, 'private.este_luna: prima zi a lunii');
select is(private.este_luna('2026-09-15'), false, 'private.este_luna: alta zi decat 1');
select is(private.este_luna(null), false, 'private.este_luna: null nu este luna');
select throws_ok(
  $$insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane) values (pg_temp.id('apA2'), '2026-10-15', 1)$$,
  '23514', null,
  'private.este_luna: check-ul refuza o luna care nu incepe pe 1');

-- =============================================================================
-- private.este_serviciu (varianta cu session_user simulat, vezi antetul)
-- =============================================================================

select pg_temp.ca('adminA');
select is(private.este_serviciu(), false, 'private.este_serviciu: utilizator prin PostgREST -> false');
select pg_temp.fara_claims();
select is(private.este_serviciu(), false, 'private.este_serviciu: fara JWT prin PostgREST -> false');
select pg_temp.ca_serviciu();
select is(private.este_serviciu(), true, 'private.este_serviciu: service_role -> true');
set local teste.sesiune = '';
select pg_temp.ca('adminA');
select is(private.este_serviciu(), true, 'private.este_serviciu: sesiunea postgres (pg_cron, psql) -> true');
set local teste.sesiune = 'authenticator';

-- =============================================================================
-- Granitele schemelor si RLS pe tabelele interne
-- =============================================================================

select ok(has_schema_privilege('anon', 'nomenclator', 'usage'), 'anon are acces la nomenclator');
select ok(not has_schema_privilege('anon', 'organizare', 'usage'), 'anon nu are acces la organizare');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon nu are acces la private');
select ok(not has_schema_privilege('authenticated', 'evenimente', 'usage'), 'authenticated nu are acces la evenimente');
select ok(not has_schema_privilege('authenticated', 'audit', 'usage'), 'authenticated nu are acces la audit');
select ok((select relrowsecurity from pg_class where oid = 'evenimente.coada'::regclass), 'RLS activ pe evenimente.coada');
select ok((select relrowsecurity from pg_class where oid = 'audit.jurnal'::regclass), 'RLS activ pe audit.jurnal');

select * from finish();
rollback;
