-- Teste pgTAP: identitate (agentul a-). Vezi antetul pentru ajutoare si este_serviciu().
begin;
create extension if not exists pgtap with schema extensions;
select plan(127);

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
-- Identitate (migratiile 20260919120011_identitate, 20260919120023_evenimente_si_joburi)
-- =============================================================================


do $$
begin
  perform pg_temp.utilizator('adminResp');
  insert into identitate.administratori (profil_id, numar_atestat, stare) values (pg_temp.id('adminResp'), 'AT-R', 'in_asteptare');
  perform pg_temp.utilizator('candidat');
  perform pg_temp.utilizator('deAprobat');
  insert into identitate.administratori (profil_id, numar_atestat, stare) values (pg_temp.id('deAprobat'), 'AT-DA', 'in_asteptare');
  perform pg_temp.utilizator('nou');
  perform pg_temp.utilizator('adminDublu');
  perform pg_temp.utilizator('faraMeta', '{"telefon": "  0722 111 222  "}');
  perform pg_temp.utilizator('numeGol', '{"nume": "   "}');
  insert into organizare.blocuri (asociatie_id, denumire, adresa, etaje, arhivat_la)
  values (pg_temp.id('asocA'), 'Bloc arhivat', 'Str. Veche 1', 1, now());
  insert into pg_temp.t_id select 'blocArhivat', id from organizare.blocuri where denumire = 'Bloc arhivat' and asociatie_id = pg_temp.id('asocA');
end;
$$;

-- -----------------------------------------------------------------------------
-- identitate.la_cont_nou
-- -----------------------------------------------------------------------------

select results_eq(
  $$select nume, telefon, email from identitate.profiluri where id = pg_temp.id('locA1')$$,
  $$values ('Test locA1'::text, null::text, null::text)$$,
  'identitate.la_cont_nou: profilul ia numele din metadate, fara email');
select results_eq(
  $$select nume, telefon from identitate.profiluri where id = pg_temp.id('faraMeta')$$,
  $$values ('Utilizator'::text, '0722111222'::text)$$,
  'identitate.la_cont_nou: fara nume in metadate ramane "Utilizator"; telefonul se normalizeaza');
select is(
  (select nume from identitate.profiluri where id = pg_temp.id('numeGol')),
  'Utilizator',
  'identitate.la_cont_nou: un nume din spatii nu se pastreaza');

-- -----------------------------------------------------------------------------
-- identitate.verifica_administrator si trigger-ul la_administrator_verificat
-- -----------------------------------------------------------------------------

select pg_temp.ca('adminA');
set local role authenticated;
select throws_ok(
  $$select identitate.verifica_administrator(pg_temp.id('deAprobat'), true)$$,
  '42501', null,
  'identitate.verifica_administrator: un administrator nu se poate aproba pe altul');
reset role;

-- Cu drepturi de serviciu (postgres in psql), comanda merge; verificarea
-- private.este_serviciu() ramane testata prin mesajul de mai sus.
select pg_temp.ca_serviciu();
select lives_ok(
  $$select identitate.verifica_administrator(pg_temp.id('deAprobat'), true, 'ignorat')$$,
  'identitate.verifica_administrator: serviciul aproba');
select results_eq(
  $$select stare, motiv_respingere, verificat_la = now() from identitate.administratori where profil_id = pg_temp.id('deAprobat')$$,
  $$values ('aprobat'::text, null::text, true)$$,
  'identitate.la_administrator_verificat: aprobarea seteaza verificat_la');
select results_eq(
  $$select tip, context, date ->> 'profil_id' from evenimente.coada where agregat_id = pg_temp.id('deAprobat')$$,
  $$values ('AdministratorAprobat'::text, 'identitate'::text, pg_temp.id('deAprobat')::text)$$,
  'identitate.la_administrator_verificat: aprobarea inregistreaza AdministratorAprobat');
select lives_ok(
  $$select identitate.verifica_administrator(pg_temp.id('adminResp'), false, 'Atestat expirat')$$,
  'identitate.verifica_administrator: serviciul respinge');
select results_eq(
  $$select stare, motiv_respingere, verificat_la is not null,
           (select count(*)::int from evenimente.coada where agregat_id = pg_temp.id('adminResp'))
    from identitate.administratori where profil_id = pg_temp.id('adminResp')$$,
  $$values ('respins'::text, 'Atestat expirat'::text, true, 0)$$,
  'identitate.la_administrator_verificat: respingerea pastreaza motivul, fara eveniment');
update identitate.administratori set verificat_la = '2020-01-01' where profil_id = pg_temp.id('adminA');
update identitate.administratori set numar_atestat = 'AT-A2' where profil_id = pg_temp.id('adminA');
select is(
  (select verificat_la from identitate.administratori where profil_id = pg_temp.id('adminA')),
  '2020-01-01'::timestamptz,
  'identitate.la_administrator_verificat: fara schimbare de stare, verificat_la ramane');

-- -----------------------------------------------------------------------------
-- identitate.numeste_administrator (comanda de serviciu)
-- -----------------------------------------------------------------------------

select pg_temp.ca('adminA');
select throws_ok(
  $$select identitate.numeste_administrator(pg_temp.id('strain'), pg_temp.id('asocA'), 'X')$$,
  'Doar dezvoltatorul numeste administratori.',
  'identitate.numeste_administrator: refuzat in afara serviciului');
set local teste.sesiune = '';
select lives_ok(
  $$select identitate.numeste_administrator(pg_temp.id('adminDublu'), pg_temp.id('asocB'), null, current_date - 5)$$,
  'identitate.numeste_administrator: aceeasi comanda trece pe sesiunea postgres (dovada ca refuzul vine din este_serviciu)');
set local teste.sesiune = 'authenticator';
set local role authenticated;
select throws_ok(
  $$select identitate.numeste_administrator(pg_temp.id('strain'), pg_temp.id('asocA'), 'X')$$,
  '42501', null,
  'identitate.numeste_administrator: authenticated nu are drept de executie');
reset role;
-- Cu drepturi de serviciu (postgres in psql), comanda merge; verificarea
-- private.este_serviciu() ramane testata prin mesajul de mai sus.
select pg_temp.ca_serviciu();
select lives_ok(
  $$select identitate.numeste_administrator(pg_temp.id('adminDublu'), pg_temp.id('asocA'), 'AT-D', current_date - 1)$$,
  'identitate.numeste_administrator: serviciul numeste un administrator');
select lives_ok(
  $$select identitate.numeste_administrator(pg_temp.id('adminDublu'), pg_temp.id('asocA'), null, current_date - 1)$$,
  'identitate.numeste_administrator: idempotenta la a doua numire');
select results_eq(
  $$select a.stare, a.numar_atestat, (select count(*)::int from identitate.membri_asociatie m where m.profil_id = a.profil_id)
    from identitate.administratori a where a.profil_id = pg_temp.id('adminDublu')$$,
  $$values ('aprobat'::text, 'AT-D'::text, 2)$$,
  'identitate.numeste_administrator: aprobat, atestatul pastrat, un mandat pe fiecare asociatie');
select lives_ok(
  $$select identitate.numeste_administrator(pg_temp.id('adminResp'), pg_temp.id('asocB'), null, current_date - 1)$$,
  'identitate.numeste_administrator: un administrator respins poate fi numit');
select is(
  (select stare || '/' || numar_atestat from identitate.administratori where profil_id = pg_temp.id('adminResp')),
  'aprobat/AT-R',
  'identitate.numeste_administrator: il aproba si pastreaza atestatul existent');
-- adminResp revine la respins, pentru testele eu() de mai jos
delete from identitate.membri_asociatie where profil_id = pg_temp.id('adminResp');
update identitate.administratori set stare = 'respins', motiv_respingere = 'Atestat expirat' where profil_id = pg_temp.id('adminResp');

-- -----------------------------------------------------------------------------
-- identitate.eu
-- -----------------------------------------------------------------------------

select pg_temp.fara_claims();
set local role authenticated;
select is(identitate.eu(), null, 'identitate.eu: fara autentificare intoarce null');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select results_eq(
  $$select e ->> 'rol', (e ->> 'asociatie_id')::uuid, (e ->> 'bloc_id')::uuid in (pg_temp.id('blocA'), pg_temp.id('blocA2')), e ->> 'apartament_id', e ->> 'nume'
    from identitate.eu() e$$,
  $$values ('administrator'::text, pg_temp.id('asocA'), true, null::text, 'Test adminA'::text)$$,
  'identitate.eu: administratorul aprobat primeste asociatia si un bloc nearhivat');
reset role;

select pg_temp.ca('locA1');
set local role authenticated;
select results_eq(
  $$select e ->> 'rol', (e ->> 'asociatie_id')::uuid, (e ->> 'bloc_id')::uuid, (e ->> 'apartament_id')::uuid, (e ->> 'profil_id')::uuid
    from identitate.eu() e$$,
  $$values ('locatar'::text, pg_temp.id('asocA'), pg_temp.id('blocA'), pg_temp.id('apA1'), pg_temp.id('locA1'))$$,
  'identitate.eu: locatarul primeste apartamentul, blocul si asociatia');
reset role;

select pg_temp.ca('candidat');
set local role authenticated;
select is(identitate.eu() ->> 'rol', 'fara_apartament', 'identitate.eu: un cont fara legaturi este fara_apartament');
select ok(not identitate.eu() ? 'motiv_respingere', '[K21] identitate.eu: celelalte roluri nu primesc cheia motivului');
reset role;
select pg_temp.ca('adminResp');
set local role authenticated;
select is(identitate.eu() ->> 'rol', 'respins', 'identitate.eu: administratorul respins');
select is(identitate.eu() ->> 'motiv_respingere', 'Atestat expirat',
  '[K21] identitate.eu: administratorul respins afla si motivul, ca sa-si poata corecta cererea');
reset role;
select pg_temp.ca('adminFost');
set local role authenticated;
select is(identitate.eu() ->> 'rol', 'fara_apartament', 'identitate.eu: mandatul terminat nu mai da rol de administrator');
reset role;
select pg_temp.ca('fostA1');
set local role authenticated;
select is(identitate.eu() ->> 'rol', 'fara_apartament', 'identitate.eu: fostul locatar nu mai are apartament');
reset role;
select pg_temp.ca('viitorA1');
set local role authenticated;
select is(identitate.eu() ->> 'rol', 'fara_apartament', 'identitate.eu: accesul viitor nu este inca activ');
reset role;

select pg_temp.ca('adminDublu');
set local role authenticated;
select is(
  (select count(*)::int from jsonb_array_elements(coalesce(identitate.eu() -> 'blocuri', '[]'::jsonb))),
  3,
  '[S12] eu() expune toate blocurile administrate (selector de bloc)');
reset role;

-- -----------------------------------------------------------------------------
-- identitate.apartament_de_administrat si identitate.leaga_locatar
-- (contul locatarului il face administratorul, prin Edge Function-ul
-- cont-locatar: intai intreaba daca are voie pe apartament, apoi serviciul
-- leaga contul nou de el)
-- -----------------------------------------------------------------------------

select pg_temp.ca('adminA');
set local role authenticated;
select is(
  identitate.apartament_de_administrat(pg_temp.id('apA1')),
  jsonb_build_object('apartament_id', pg_temp.id('apA1'), 'bloc_id', pg_temp.id('blocA'), 'numar', '1'),
  'identitate.apartament_de_administrat: apartamentul propriu, cu blocul lui');
select throws_ok($$select identitate.apartament_de_administrat(pg_temp.id('apB1'))$$,
  'Doar administratorul blocului poate face conturi.',
  'identitate.apartament_de_administrat: apartamentul altui bloc este refuzat');
select throws_ok($$select identitate.leaga_locatar(pg_temp.id('nou'), pg_temp.id('apA1'))$$,
  '42501', null,
  'identitate.leaga_locatar: administratorul nu o poate chema direct');
reset role;

select pg_temp.ca('locA1');
set local role authenticated;
select throws_ok($$select identitate.apartament_de_administrat(pg_temp.id('apA1'))$$,
  'Doar administratorul blocului poate face conturi.',
  'identitate.apartament_de_administrat: locatarul este refuzat');
reset role;
select pg_temp.ca('presA');
set local role authenticated;
select throws_ok($$select identitate.apartament_de_administrat(pg_temp.id('apA1'))$$,
  'Doar administratorul blocului poate face conturi.',
  'identitate.apartament_de_administrat: presedintele este refuzat');
reset role;
select pg_temp.ca('adminFost');
set local role authenticated;
select throws_ok($$select identitate.apartament_de_administrat(pg_temp.id('apA1'))$$,
  'Doar administratorul blocului poate face conturi.',
  'identitate.apartament_de_administrat: administratorul cu mandat terminat este refuzat');
reset role;
select pg_temp.ca_anonim();
set local role anon;
select throws_ok($$select identitate.apartament_de_administrat(pg_temp.id('apA1'))$$,
  '42501', null,
  'identitate.apartament_de_administrat: anon nu are acces');
select throws_ok($$select identitate.leaga_locatar(pg_temp.id('nou'), pg_temp.id('apA1'))$$,
  '42501', null,
  'identitate.leaga_locatar: anon nu are acces');
reset role;

-- Cu claim-uri de utilizator, private.este_serviciu() intoarce false chiar si
-- sub postgres: comanda refuza pe romaneste, nu doar prin lipsa dreptului.
select pg_temp.ca('adminA');
select throws_ok($$select identitate.leaga_locatar(pg_temp.id('nou'), pg_temp.id('apA1'))$$,
  'Doar dezvoltatorul poate lega un cont de un apartament.',
  'identitate.leaga_locatar: fara drepturi de serviciu, refuza pe romaneste');

select pg_temp.ca_serviciu();
select lives_ok(
  $$select identitate.leaga_locatar(pg_temp.id('nou'), pg_temp.id('apA1'), 'proprietar')$$,
  'identitate.leaga_locatar: serviciul leaga contul de apartament');
select results_eq(
  $$select apartament_id, bloc_id, calitate, activ_din, activ_pana from identitate.locatari where profil_id = pg_temp.id('nou')$$,
  $$values (pg_temp.id('apA1'), pg_temp.id('blocA'), 'proprietar'::text, current_date, null::date)$$,
  'identitate.leaga_locatar: legatura incepe azi, pe blocul apartamentului');
select throws_ok(
  $$select identitate.leaga_locatar(pg_temp.id('nou'), pg_temp.id('apA1'))$$,
  'Contul este deja legat de acest apartament.',
  'identitate.leaga_locatar: acelasi apartament de doua ori este refuzat');
select lives_ok(
  $$select identitate.leaga_locatar(pg_temp.id('nou'), pg_temp.id('apA2'), 'chirias')$$,
  '[P1/P5] identitate.leaga_locatar: acelasi om, al doilea apartament');
select throws_ok(
  $$select identitate.leaga_locatar(pg_temp.id('nou'), '00000000-0000-4000-8000-000000000000')$$,
  'Apartamentul nu exista.',
  'identitate.leaga_locatar: apartamentul inexistent este refuzat');
select throws_ok(
  $$select identitate.leaga_locatar(pg_temp.id('strain'), pg_temp.id('apA1'), 'vecin')$$,
  '23514', null,
  'identitate.leaga_locatar: calitatea necunoscuta este refuzata');

-- -----------------------------------------------------------------------------
-- identitate.inchide_acces_locatar
-- -----------------------------------------------------------------------------

insert into pg_temp.t_id select 'legA2', id from identitate.locatari where profil_id = pg_temp.id('locA2');
insert into pg_temp.t_id select 'legA1', id from identitate.locatari where profil_id = pg_temp.id('locA1');
insert into pg_temp.t_id select 'legNou', id from identitate.locatari where profil_id = pg_temp.id('nou') and apartament_id = pg_temp.id('apA1');

select pg_temp.ca('adminB');
set local role authenticated;
select throws_ok($$select identitate.inchide_acces_locatar(pg_temp.id('legA1'))$$,
  'Legatura nu exista sau nu este in blocul tau.',
  'identitate.inchide_acces_locatar: administratorul altui bloc este refuzat');
reset role;
select pg_temp.ca('locA1');
set local role authenticated;
select throws_ok($$select identitate.inchide_acces_locatar(pg_temp.id('legA1'))$$,
  'Legatura nu exista sau nu este in blocul tau.',
  'identitate.inchide_acces_locatar: locatarul nu isi inchide singur accesul');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select lives_ok($$select identitate.inchide_acces_locatar(pg_temp.id('legA2'))$$,
  'identitate.inchide_acces_locatar: administratorul inchide accesul');
select throws_ok($$select identitate.inchide_acces_locatar(pg_temp.id('legA2'))$$,
  'Legatura nu exista sau nu este in blocul tau.',
  'identitate.inchide_acces_locatar: o legatura deja inchisa este refuzata');
select lives_ok($$select identitate.inchide_acces_locatar(pg_temp.id('legNou'))$$,
  'identitate.inchide_acces_locatar: inchide si o legatura facuta azi');
reset role;
select is(
  (select activ_pana from identitate.locatari where id = pg_temp.id('legA2')), current_date,
  'identitate.inchide_acces_locatar: activ_pana = azi');
select pg_temp.ca('locA2');
set local role authenticated;
select is_empty($$select private.apartamentele_mele()$$,
  'identitate.inchide_acces_locatar: locatarul nu mai are apartament');
reset role;

select pg_temp.ca('nou');
set local role authenticated;
/* Contul are doua apartamente (P1/P5); cel inchis azi nu mai este intre ele */
select set_eq($$select private.apartamentele_mele()$$, array[pg_temp.id('apA2')],
  '[S11] o legatura facuta si inchisa azi nu mai da acces azi');
reset role;
-- -----------------------------------------------------------------------------
-- Functiile ajutatoare din private
-- -----------------------------------------------------------------------------

select pg_temp.ca('adminA');
set local role authenticated;
select set_eq($$select private.asociatii_administrate()$$, array[pg_temp.id('asocA')],
  'private.asociatii_administrate: administratorul aprobat, cu mandat activ');
select set_eq($$select private.blocuri_administrate()$$, array[pg_temp.id('blocA'), pg_temp.id('blocA2')],
  'private.blocuri_administrate: blocurile nearhivate ale asociatiei');
select set_eq($$select private.apartamente_administrate()$$, array[pg_temp.id('apA1'), pg_temp.id('apA2'), pg_temp.id('apA21')],
  'private.apartamente_administrate: apartamentele blocurilor administrate');
select is_empty($$select private.asociatii_supravegheate()$$,
  'private.asociatii_supravegheate: administratorul nu este presedinte');
select set_eq($$select private.blocuri_conduse()$$, array[pg_temp.id('blocA'), pg_temp.id('blocA2')],
  'private.blocuri_conduse: administratorul conduce blocurile lui');
select set_eq($$select private.blocuri_vizibile()$$, array[pg_temp.id('blocA'), pg_temp.id('blocA2')],
  'private.blocuri_vizibile: administratorul');
reset role;

select pg_temp.ca('presA');
set local role authenticated;
select set_eq($$select private.asociatii_supravegheate()$$, array[pg_temp.id('asocA')],
  'private.asociatii_supravegheate: presedintele');
select set_eq($$select private.blocuri_supravegheate()$$, array[pg_temp.id('blocA'), pg_temp.id('blocA2')],
  'private.blocuri_supravegheate: blocurile nearhivate ale asociatiei');
select set_eq($$select private.blocuri_conduse()$$, array[pg_temp.id('blocA'), pg_temp.id('blocA2')],
  'private.blocuri_conduse: presedintele');
select is_empty($$select private.asociatii_administrate()$$,
  'private.asociatii_administrate: presedintele nu administreaza');
reset role;

select pg_temp.ca('locA1');
set local role authenticated;
select set_eq($$select private.apartamentele_mele()$$, array[pg_temp.id('apA1')],
  'private.apartamentele_mele: locatarul activ');
select set_eq($$select private.blocurile_mele()$$, array[pg_temp.id('blocA')],
  'private.blocurile_mele: locatarul activ');
select set_eq($$select private.blocuri_vizibile()$$, array[pg_temp.id('blocA')],
  'private.blocuri_vizibile: locatarul vede doar blocul lui');
select set_eq($$select private.asociatii_vizibile()$$, array[pg_temp.id('asocA')],
  'private.asociatii_vizibile: locatarul');
select is_empty($$select private.blocuri_conduse()$$,
  'private.blocuri_conduse: locatarul nu conduce');
reset role;

select pg_temp.ca('fostA1');
set local role authenticated;
select is_empty($$select private.blocuri_vizibile()$$, 'private.blocuri_vizibile: fostul locatar nu vede nimic');
reset role;
select pg_temp.ca('viitorA1');
set local role authenticated;
select is_empty($$select private.blocurile_mele()$$, 'private.blocurile_mele: accesul viitor nu conteaza inca');
reset role;
select pg_temp.ca('adminNou');
set local role authenticated;
select is_empty($$select private.asociatii_vizibile()$$, 'private.asociatii_vizibile: administratorul neaprobat nu vede nimic');
reset role;
select pg_temp.ca('adminFost');
set local role authenticated;
select is_empty($$select private.blocuri_administrate()$$, 'private.blocuri_administrate: mandatul terminat nu mai conteaza');
reset role;
select pg_temp.ca_anonim();
set local role anon;
select throws_ok($$select private.blocuri_vizibile()$$, '42501', null, 'private: anon nu poate apela functiile ajutatoare');
reset role;

-- -----------------------------------------------------------------------------
-- Politicile RLS din Identitate
-- -----------------------------------------------------------------------------

create function pg_temp.toti() returns uuid[] language sql stable as $$ select array_agg(id) from pg_temp.t_id $$;

select pg_temp.ca('locA1');
set local role authenticated;
select set_eq($$select id from identitate.profiluri where id = any(pg_temp.toti())$$,
  array[pg_temp.id('locA1'), pg_temp.id('adminA'), pg_temp.id('adminNou'), pg_temp.id('adminFost'), pg_temp.id('presA'), pg_temp.id('adminDublu')],
  'politica "Profilul propriu si oamenii din asociatiile tale": locatarul vede conducerea, nu vecinii');
select is(pg_temp.randuri($$update identitate.profiluri set nume = 'Ion Locatar' where id = pg_temp.id('locA1')$$), 1,
  'politica "Fiecare isi modifica profilul": propriul profil');
select is(pg_temp.randuri($$update identitate.profiluri set nume = 'Hack' where id = pg_temp.id('adminA')$$), 0,
  'politica "Fiecare isi modifica profilul": nu si profilul altuia');
select throws_ok($$update identitate.profiluri set email = 'x@y.z' where id = pg_temp.id('locA1')$$, '42501', null,
  'identitate.profiluri: emailul nu se modifica din aplicatie');
-- [A2] Numarul este identitatea contului: cine si l-ar putea scrie ar primi
-- apartamentul pe care administratorul il adauga mai tarziu pe acel numar.
select throws_ok($$update identitate.profiluri set telefon = '0799000111' where id = pg_temp.id('locA1')$$, '42501', null,
  '[A2] identitate.profiluri: numarul de telefon nu se modifica din aplicatie');
select set_eq($$select profil_id from identitate.membri_asociatie where asociatie_id in (pg_temp.id('asocA'), pg_temp.id('asocB'))$$,
  array[pg_temp.id('adminA'), pg_temp.id('adminNou'), pg_temp.id('adminFost'), pg_temp.id('presA'), pg_temp.id('adminDublu')],
  'politica "Mandatele se vad in asociatie": locatarul vede mandatele asociatiei lui, nu si ale altora');
select set_eq($$select profil_id from identitate.locatari where bloc_id in (pg_temp.id('blocA'), pg_temp.id('blocB'))$$,
  array[pg_temp.id('locA1')],
  'politica "Legaturile proprii si cele din blocurile conduse": locatarul vede doar legatura lui');
select is_empty($$select 1 from identitate.administratori$$,
  'politica "Fiecare isi vede verificarea": locatarul nu vede verificari');
select throws_ok($$insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate) values (pg_temp.id('apA2'), pg_temp.id('blocA'), pg_temp.id('locA1'), 'proprietar')$$,
  '42501', null, 'identitate.locatari: legatura nu se scrie direct, ci prin comanda serviciului');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select set_eq($$select id from identitate.profiluri where id = any(pg_temp.toti())$$,
  array[pg_temp.id('adminA'), pg_temp.id('adminNou'), pg_temp.id('adminFost'), pg_temp.id('presA'), pg_temp.id('adminDublu'),
        pg_temp.id('locA1'), pg_temp.id('locA2'), pg_temp.id('fostA1'), pg_temp.id('viitorA1'), pg_temp.id('nou')],
  'politica "Profilul propriu si oamenii din asociatiile tale": administratorul vede si locatarii blocurilor');
select set_eq($$select profil_id from identitate.administratori$$, array[pg_temp.id('adminA')],
  'politica "Fiecare isi vede verificarea": doar randul propriu');
select throws_ok($$update identitate.administratori set stare = 'aprobat' where profil_id = pg_temp.id('adminNou')$$, '42501', null,
  'identitate.administratori: starea nu se schimba din aplicatie');
reset role;

select pg_temp.ca('presA');
set local role authenticated;
select set_eq($$select profil_id from identitate.locatari where bloc_id in (pg_temp.id('blocA'), pg_temp.id('blocB'))$$,
  array[pg_temp.id('locA1'), pg_temp.id('locA2'), pg_temp.id('fostA1'), pg_temp.id('viitorA1'), pg_temp.id('nou')],
  'politica "Legaturile proprii si cele din blocurile conduse": presedintele vede tot blocul');
reset role;

select pg_temp.ca('adminB');
set local role authenticated;
select set_eq($$select profil_id from identitate.locatari where bloc_id in (pg_temp.id('blocA'), pg_temp.id('blocB'))$$,
  array[pg_temp.id('locB1')],
  'politica "Legaturile proprii si cele din blocurile conduse": administratorul B nu vede blocul A');
reset role;

select pg_temp.ca('strain');
set local role authenticated;
select set_eq($$select id from identitate.profiluri where id = any(pg_temp.toti())$$, array[pg_temp.id('strain')],
  'politica "Profilul propriu si oamenii din asociatiile tale": un cont fara legaturi vede doar profilul lui');
select is_empty($$select 1 from identitate.membri_asociatie where asociatie_id in (pg_temp.id('asocA'), pg_temp.id('asocB'))$$,
  'politica "Mandatele se vad in asociatie": un cont fara legaturi nu vede mandate');
reset role;

select pg_temp.ca('adminNou');
set local role authenticated;
select set_eq($$select profil_id from identitate.membri_asociatie$$, array[pg_temp.id('adminNou')],
  'politica "Mandatele se vad in asociatie": administratorul neaprobat isi vede doar mandatul');
reset role;

-- -----------------------------------------------------------------------------
-- [H9] inchide_acces_locatar revoca doar codurile emise inainte de inchidere
-- -----------------------------------------------------------------------------
-- Ordinea fireasca la o vanzare: administratorul da cumparatorului un cod
-- nou, apoi inchide accesul vanzatorului, cu data reala de plecare (in
-- trecut, de multe ori mai devreme decat ziua in care se face hartia).
-- Inainte de reparatie, inchiderea revoca toate codurile nefolosite ale
-- apartamentului, inclusiv codul proaspat al cumparatorului. Dupa reparatie,
-- se revoca doar codurile emise pana la data la care se inchide legatura
-- (aici, acum 5 zile); codul cumparatorului, emis azi, ramane valabil.
do $$
declare
  v_ap uuid;
  v_vanzator uuid;
  v_leg uuid;
begin
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.id('blocA'), 'H9', 3, 'Vanzator H9', 1) returning id into v_ap;
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap, '2026-01-01', 1);
  v_vanzator := pg_temp.utilizator('vanzatorH9');
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (v_ap, pg_temp.id('blocA'), v_vanzator, 'proprietar', current_date - 400)
  returning id into v_leg;

  insert into pg_temp.t_id values ('apH9', v_ap);
  insert into pg_temp.t_id values ('legH9', v_leg);
end;
$$;

select pg_temp.ca('adminA');
set local role authenticated;
select lives_ok(
  format('select identitate.inchide_acces_locatar(%L, %L)', pg_temp.id('legH9'), current_date - 5),
  '[S11] inchide_acces_locatar: inchide accesul vanzatorului cu data reala de plecare, in trecut');
reset role;
select is(
  (select activ_pana from identitate.locatari where id = pg_temp.id('legH9')), current_date - 5,
  '[S11] legatura se inchide chiar la data ceruta, nu azi');

-- -----------------------------------------------------------------------------
-- Conducerea asociatiei: identitate.numeste_in_conducere si incheie_mandat
-- (adunarea generala ii alege, administratorul trece in aplicatie hotararea)
-- -----------------------------------------------------------------------------

select pg_temp.ca('presA');
set local role authenticated;
select is(identitate.eu() ->> 'rol', 'presedinte',
  'identitate.eu: presedintele isi primeste rolul, nu "fara apartament"');
select is((identitate.eu() ->> 'asociatie_id')::uuid, pg_temp.id('asocA'),
  'identitate.eu: presedintele primeste asociatia pe care o supravegheaza');
select throws_ok($$select identitate.numeste_in_conducere(pg_temp.id('locA1'), 'cenzor')$$,
  'Doar administratorul asociatiei numeste presedintele si cenzorul.',
  'numeste_in_conducere: presedintele nu numeste pe altcineva');
reset role;

select pg_temp.ca('locA1');
set local role authenticated;
select throws_ok($$select identitate.numeste_in_conducere(pg_temp.id('locA2'), 'cenzor')$$,
  'Doar administratorul asociatiei numeste presedintele si cenzorul.',
  'numeste_in_conducere: locatarul nu numeste pe nimeni');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select throws_ok($$select identitate.numeste_in_conducere(pg_temp.id('locA1'), 'administrator')$$,
  'Mandatul este de presedinte sau de cenzor.',
  'numeste_in_conducere: un mandat de administrator nu se da de aici');
select throws_ok($$select identitate.numeste_in_conducere('00000000-0000-4000-8000-000000000000', 'cenzor')$$,
  'Persoana nu exista.',
  'numeste_in_conducere: o persoana inexistenta este refuzata');
select set_config('fx.mandat', identitate.numeste_in_conducere(pg_temp.id('locA1'), 'cenzor')::text, true);
select results_eq(
  $$select rol, activ_din, activ_pana from identitate.membri_asociatie where id = current_setting('fx.mandat')::uuid$$,
  $$values ('cenzor'::text, current_date, null::date)$$,
  'numeste_in_conducere: mandatul incepe azi si este deschis');
select throws_ok($$select identitate.numeste_in_conducere(pg_temp.id('locA1'), 'cenzor')$$,
  'Persoana are deja acest mandat, in curs.',
  'numeste_in_conducere: acelasi mandat, a doua oara, este refuzat');
reset role;

select pg_temp.ca('locA1');
set local role authenticated;
select is(identitate.eu() ->> 'rol', 'cenzor',
  'identitate.eu: cenzorul care e si locatar vede blocul ca cenzor');
reset role;

select pg_temp.ca('adminB');
set local role authenticated;
select throws_ok($$select identitate.incheie_mandat(current_setting('fx.mandat')::uuid)$$,
  'Mandatul nu exista, s-a incheiat deja sau nu este in asociatia ta.',
  'incheie_mandat: administratorul altei asociatii este refuzat');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select lives_ok($$select identitate.incheie_mandat(current_setting('fx.mandat')::uuid)$$,
  'incheie_mandat: administratorul incheie mandatul');
select isnt((select activ_pana from identitate.membri_asociatie where id = current_setting('fx.mandat')::uuid), null,
  'incheie_mandat: mandatul ramane in istoric, cu data de incheiere');
select throws_ok($$select identitate.incheie_mandat(current_setting('fx.mandat')::uuid)$$,
  'Mandatul nu exista, s-a incheiat deja sau nu este in asociatia ta.',
  'incheie_mandat: un mandat incheiat nu se mai incheie o data');
select lives_ok($$select identitate.numeste_in_conducere(pg_temp.id('locA1'), 'cenzor')$$,
  'numeste_in_conducere: un mandat incheiat se poate redeschide');
-- [C7] Realegerea nu sterge mandatul dinainte: adunarea generala il alege pe
-- acelasi om peste cativa ani, iar ecranul trebuie sa arate amandoua perioadele.
select is((select count(*)::int from identitate.membri_asociatie
           where asociatie_id = pg_temp.id('asocA') and profil_id = pg_temp.id('locA1') and rol = 'cenzor'), 2,
  '[C7] numeste_in_conducere: realegerea este un mandat nou, cel vechi ramane in istoric');
select throws_ok($$select identitate.incheie_mandat(
    (select id from identitate.membri_asociatie where profil_id = pg_temp.id('adminA') and rol = 'administrator'))$$,
  'Mandatul nu exista, s-a incheiat deja sau nu este in asociatia ta.',
  'incheie_mandat: mandatul de administrator nu se incheie de aici');
-- [C8] Cel care tine banii nu poate fi si cel care ii verifica
select throws_ok($$select identitate.numeste_in_conducere(pg_temp.id('adminA'), 'cenzor')$$,
  'Administratorul asociatiei nu poate fi si presedinte sau cenzor: el este cel verificat.',
  '[C8] numeste_in_conducere: administratorul nu se numeste pe el insusi');
-- [C12] Un mandat care incepe maine ar aparea pe ecran ca fiind in curs
select throws_ok($$select identitate.numeste_in_conducere(pg_temp.id('locA2'), 'presedinte', current_date + 1)$$,
  'Mandatul nu poate incepe in viitor.',
  '[C12] numeste_in_conducere: mandatul nu incepe in viitor');
-- [C6] Numit din greseala, scos imediat: drepturile se sting azi, nu maine
select lives_ok($$select identitate.incheie_mandat(
    (select id from identitate.membri_asociatie
      where asociatie_id = pg_temp.id('asocA') and profil_id = pg_temp.id('locA1')
        and rol = 'cenzor' and activ_pana is null))$$,
  '[C6] incheie_mandat: un mandat inceput azi se incheie azi');
select is((select max(activ_pana) from identitate.membri_asociatie
           where asociatie_id = pg_temp.id('asocA') and profil_id = pg_temp.id('locA1') and rol = 'cenzor'), current_date,
  '[C6] incheie_mandat: data de incheiere este cea reala, nu ziua urmatoare');
reset role;

select pg_temp.ca('locA1');
set local role authenticated;
select is_empty($$select 1 from private.asociatii_supravegheate()$$,
  '[C6] mandatul incheiat azi nu mai da drepturi de supraveghere azi');
select is(identitate.eu() ->> 'rol', 'locatar',
  '[C6] omul scos din conducere se intoarce azi la ecranele lui de locatar');
reset role;

-- [C5] Administratorul cu doua asociatii: mandatul merge in asociatia pe care
-- o vede pe ecran, nu in oricare dintre ele.
select pg_temp.ca('adminDublu');
set local role authenticated;
select is(identitate.asociatia_de_administrat(), (identitate.eu() ->> 'asociatie_id')::uuid,
  '[C5] asociatia_de_administrat: aceeasi asociatie pe care o arata identitate.eu()');
select set_config('fx.mandatB', identitate.numeste_in_conducere(pg_temp.id('locB1'), 'cenzor')::text, true);
select is((select asociatie_id from identitate.membri_asociatie where id = current_setting('fx.mandatB')::uuid),
  (identitate.eu() ->> 'asociatie_id')::uuid,
  '[C5] numeste_in_conducere: fara asociatie ceruta, mandatul merge unde arata ecranul');
select set_config('fx.mandatA', identitate.numeste_in_conducere(pg_temp.id('locB1'), 'presedinte', current_date, pg_temp.id('asocA'))::text, true);
select is((select asociatie_id from identitate.membri_asociatie where id = current_setting('fx.mandatA')::uuid),
  pg_temp.id('asocA'),
  '[C5] numeste_in_conducere: asociatia ceruta este cea in care intra mandatul');
select throws_ok($$select identitate.numeste_in_conducere(pg_temp.id('locB1'), 'cenzor', current_date, '00000000-0000-4000-8000-000000000000')$$,
  'Doar administratorul asociatiei numeste presedintele si cenzorul.',
  '[C5] numeste_in_conducere: o asociatie straina este refuzata');
select throws_ok($$select identitate.asociatia_de_administrat('00000000-0000-4000-8000-000000000000')$$,
  'Nu esti administratorul acestei asociatii.',
  '[C5] asociatia_de_administrat: o asociatie straina este refuzata');
reset role;

select pg_temp.ca_anonim();
set local role anon;
select throws_ok($$select identitate.numeste_in_conducere(pg_temp.id('locA1'), 'cenzor')$$,
  '42501', null, 'numeste_in_conducere: anon nu are acces');
select throws_ok($$select identitate.incheie_mandat(current_setting('fx.mandat')::uuid)$$,
  '42501', null, 'incheie_mandat: anon nu are acces');
reset role;


-- -----------------------------------------------------------------------------
-- [A5] Numarul de telefon: unic si normalizat in baza, nu doar in JavaScript
-- -----------------------------------------------------------------------------

select is(private.normalizeaza_telefon('+40 0722 123 456'), '0722123456',
  '[A6] private.normalizeaza_telefon: prefixul tarii si zeroul de acasa dau acelasi numar');
select is(private.normalizeaza_telefon('0248 210 118'), '0248210118',
  '[A5] private.normalizeaza_telefon: numarul fix scris cu spatii');
select is(private.normalizeaza_telefon('+33722123456'), null,
  '[A5] private.normalizeaza_telefon: un numar strain nu este numar romanesc');

select pg_temp.ca_serviciu();
set local role service_role;
select lives_ok($$update identitate.profiluri set telefon = '0799000111' where id = pg_temp.id('locA1')$$,
  '[A5] profiluri.telefon: zece cifre care incep cu 07 intra in baza');
select throws_ok($$update identitate.profiluri set telefon = '072212' where id = pg_temp.id('locA2')$$,
  '23514', null, '[A5] profiluri.telefon: un numar scurt este refuzat de baza');
select throws_ok($$update identitate.profiluri set telefon = '0722 118 005' where id = pg_temp.id('locA2')$$,
  '23514', null, '[A5] profiluri.telefon: numarul cu spatii este refuzat, se pastreaza normalizat');
select throws_ok($$update identitate.profiluri set telefon = '0799000111' where id = pg_temp.id('locA2')$$,
  '23505', null, '[A5] profiluri.telefon: doi oameni nu pot avea acelasi numar');
reset role;

select * from finish();
rollback;
