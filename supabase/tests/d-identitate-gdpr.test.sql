-- Datele personale si fortarea codurilor de invitatie (audit 2: X02, X07):
--   identitate.anonimizeaza_profil    - stergerea unei persoane, cu pastrarea
--     randurilor contabile;
--   identitate.foloseste_invitatie    - limita de incercari cu cod gresit,
--     tinuta in identitate.incercari_invitatii.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- ---------------------------------------------------------------------------
-- Fixture (acelasi tipar ca in fisierele b-* si d-*; anulat la rollback).
-- ---------------------------------------------------------------------------
create or replace function private.este_serviciu()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (session_user in ('postgres', 'supabase_admin') and coalesce(auth.role(), '') = '');
$$;

create function pg_temp.utilizator(p_nume text)
returns uuid
language plpgsql
as $$
declare
  v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, phone, raw_user_meta_data)
  values (v, 'g-' || v || '@test.local', '07' || substr(replace(v::text, '-', ''), 1, 8),
          jsonb_build_object('nume', p_nume, 'telefon', '0700 000 000'));
  update identitate.profiluri set telefon = '0700 000 000' where id = v;
  return v;
end;
$$;

create function pg_temp.fx(p_cheie text)
returns uuid
language sql
stable
as $$
  select current_setting('fx.' || p_cheie)::uuid;
$$;

create function pg_temp.ca(p_cheie text)
returns text
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(p_cheie), 'role', 'authenticated')::text, true);
$$;

create function pg_temp.serviciu()
returns text
language sql
as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- Asociatia G cu blocul activ G (ap1 cota 100), administratorul adminG, locatarul
-- locG (activ) si fostG (acces inchis ieri). locG a platit 100 de lei, cu chitanta.
create function pg_temp.fixture()
returns void
language plpgsql
as $$
declare
  r jsonb;
  v_id uuid;
  v_luna0 date := (date_trunc('month', current_date) - interval '3 months')::date;
begin
  perform set_config('request.jwt.claims', '', true);

  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test G', 'cui', 'RG' || (floor(random() * 1e9))::bigint),
    'setari', jsonb_build_object('chitantaSerie', 'TG'),
    'bloc', jsonb_build_object('denumire', 'Bloc G', 'adresa', 'Str. Test G 1', 'etaje', 1)));
  perform set_config('fx.asociatie', r ->> 'asociatie_id', true);
  perform set_config('fx.bloc', r ->> 'bloc_id', true);

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('bloc'), '1', 0, 'Ion Unu', 100) returning id into v_id;
  perform set_config('fx.ap1', v_id::text, true);
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (pg_temp.fx('ap1'), v_luna0, 2);
  perform organizare.activeaza_bloc(pg_temp.fx('bloc'));

  perform set_config('fx.admin', pg_temp.utilizator('Admin G')::text, true);
  perform identitate.numeste_administrator(pg_temp.fx('admin'), pg_temp.fx('asociatie'), 'AT-G-1', current_date - 30);
  perform set_config('fx.loc', pg_temp.utilizator('Locatar G')::text, true);
  perform set_config('fx.fost', pg_temp.utilizator('Fost Locatar G')::text, true);
  perform set_config('fx.nou', pg_temp.utilizator('Cont Nou G')::text, true);
  perform set_config('fx.nou2', pg_temp.utilizator('Alt Cont Nou G')::text, true);
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), pg_temp.fx('loc'), 'proprietar', current_date - 30);
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din, activ_pana)
  values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), pg_temp.fx('fost'), 'chirias', current_date - 90, current_date - 1);

  -- Bani: o datorie, o plata cu chitanta si alocarea ei.
  insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
  values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), 'intretinere', v_luna0, 100, v_luna0 + 24, 'Intretinere de test');
  perform set_config('fx.plata',
    financiar.inregistreaza_plata(pg_temp.fx('ap1'), 100, 'numerar', now(), pg_temp.fx('loc'), pg_temp.fx('admin'))::text, true);

  -- Coduri de invitatie: unul neconsumat, unul deja folosit, toate facute de adminG.
  insert into identitate.invitatii (apartament_id, cod, calitate, creat_de, expira_la)
  values (pg_temp.fx('ap1'), 'GCDBUNAA', 'membru_familie', pg_temp.fx('admin'), now() + interval '30 days'),
         (pg_temp.fx('ap1'), 'GCDBUNAB', 'membru_familie', pg_temp.fx('admin'), now() + interval '30 days'),
         (pg_temp.fx('ap1'), 'GCDFLSTA', 'membru_familie', pg_temp.fx('admin'), now() + interval '30 days');
  update identitate.invitatii set folosita_la = now(), folosita_de = pg_temp.fx('fost') where cod = 'GCDFLSTA';
  -- Doua coduri fara autor, ca revocarea de la anonimizare sa nu le atinga: cu
  -- ele se testeaza limita de incercari.
  insert into identitate.invitatii (apartament_id, cod, calitate, creat_de, expira_la)
  values (pg_temp.fx('ap1'), 'GCDBUNAC', 'membru_familie', null, now() + interval '30 days'),
         (pg_temp.fx('ap1'), 'GCDBUNAD', 'membru_familie', null, now() + interval '30 days');
end;
$$;

select pg_temp.fixture();
-- --------------------------------------------------------------------------- sfarsit fixture

-- =============================================================================
-- identitate.anonimizeaza_profil (X02)
-- =============================================================================

select pg_temp.ca('admin');
select throws_ok(
  $$select identitate.anonimizeaza_profil(pg_temp.fx('loc'))$$,
  'Doar dezvoltatorul poate sterge o persoana.',
  'anonimizeaza_profil: administratorul nu sterge persoane');
select pg_temp.ca('loc');
select throws_ok(
  $$select identitate.anonimizeaza_profil(pg_temp.fx('loc'))$$,
  'Doar dezvoltatorul poate sterge o persoana.',
  'anonimizeaza_profil: nici persoana insasi nu o poate face singura');
set local role authenticated;
select throws_ok(
  $$select identitate.anonimizeaza_profil(pg_temp.fx('loc'))$$,
  '42501', null,
  'anonimizeaza_profil: authenticated nu are drept de executie');
reset role;

select pg_temp.serviciu();
select throws_ok(
  $$select identitate.anonimizeaza_profil(gen_random_uuid())$$,
  'Persoana nu exista.',
  'anonimizeaza_profil: un profil inexistent este refuzat');

-- Ce era inainte, ca sa se poata compara dupa
create temp table t_inainte as
select (select count(*) from financiar.plati where apartament_id = pg_temp.fx('ap1')) as plati,
       (select count(*) from financiar.chitante c join financiar.plati p on p.id = c.plata_id where p.apartament_id = pg_temp.fx('ap1')) as chitante,
       (select count(*) from financiar.datorii where apartament_id = pg_temp.fx('ap1')) as datorii,
       (select count(*) from financiar.alocari_plati a join financiar.plati p on p.id = a.plata_id where p.apartament_id = pg_temp.fx('ap1')) as alocari,
       (select platita_de from financiar.plati where id = pg_temp.fx('plata')) as platita_de;

select is(
  identitate.anonimizeaza_profil(pg_temp.fx('loc')),
  jsonb_build_object('legaturi_inchise', 1, 'invitatii_revocate', 0),
  'anonimizeaza_profil: raporteaza ce a inchis si ce a revocat');
select results_eq(
  $$select nume, email, telefon from identitate.profiluri where id = pg_temp.fx('loc')$$,
  $$values ('Persoana stearsa', null::text, null::text)$$,
  'anonimizeaza_profil: numele, emailul si telefonul devin neutre');
select results_eq(
  $$select email like 'anonim-%@adminbloc.invalid', phone, raw_user_meta_data
      from auth.users where id = pg_temp.fx('loc')$$,
  $$values (true, null::text, '{}'::jsonb)$$,
  'anonimizeaza_profil: contul din Auth nu mai are email, telefon sau metadate reale');
select is(
  (select activ_pana from identitate.locatari where profil_id = pg_temp.fx('loc')),
  current_date,
  'anonimizeaza_profil: legatura activa de locatar se inchide azi');
select is(
  (select activ_pana from identitate.locatari where profil_id = pg_temp.fx('fost')),
  current_date - 1,
  'anonimizeaza_profil: legaturile deja inchise ale altora nu se ating');

select results_eq(
  $$select (select count(*) from financiar.plati where apartament_id = pg_temp.fx('ap1')),
           (select count(*) from financiar.chitante c join financiar.plati p on p.id = c.plata_id where p.apartament_id = pg_temp.fx('ap1')),
           (select count(*) from financiar.datorii where apartament_id = pg_temp.fx('ap1')),
           (select count(*) from financiar.alocari_plati a join financiar.plati p on p.id = a.plata_id where p.apartament_id = pg_temp.fx('ap1'))$$,
  $$select plati, chitante, datorii, alocari from t_inainte$$,
  'anonimizeaza_profil: platile, chitantele, datoriile si alocarile raman toate');
select is(
  (select platita_de from financiar.plati where id = pg_temp.fx('plata')),
  (select platita_de from t_inainte),
  'anonimizeaza_profil: plata ramane legata de acelasi profil, pentru urma contabila');

select pg_temp.ca('loc');
select is(identitate.eu() ->> 'rol', 'fara_apartament',
  'anonimizeaza_profil: persoana nu mai are apartament in aplicatie');
select pg_temp.ca('admin');
set local role authenticated;
select is(
  (select nume from identitate.profiluri where id = pg_temp.fx('loc')),
  'Persoana stearsa',
  'anonimizeaza_profil: administratorul vede doar numele neutru pe fisa apartamentului');
reset role;

select pg_temp.serviciu();
select is(
  identitate.anonimizeaza_profil(pg_temp.fx('admin')),
  jsonb_build_object('legaturi_inchise', 0, 'invitatii_revocate', 2),
  'anonimizeaza_profil: codurile nefolosite ale persoanei se revoca');
select is(
  (select count(*)::int from identitate.invitatii
    where creat_de = pg_temp.fx('admin') and revocata_la is not null),
  2,
  'anonimizeaza_profil: cele doua coduri nefolosite sunt revocate');
select is(
  (select revocata_la from identitate.invitatii where cod = 'GCDFLSTA'),
  null::timestamptz,
  'anonimizeaza_profil: un cod deja folosit nu se revoca');
select is(
  identitate.anonimizeaza_profil(pg_temp.fx('admin')),
  jsonb_build_object('legaturi_inchise', 0, 'invitatii_revocate', 0),
  'anonimizeaza_profil: a doua stergere a aceleiasi persoane nu mai schimba nimic');

-- =============================================================================
-- identitate.foloseste_invitatie: limita de incercari (X07)
-- =============================================================================

select pg_temp.ca('nou');
set local role authenticated;

select is(
  identitate.foloseste_invitatie('ZZZZZZZZ') ->> 'eroare',
  'Codul nu este valabil. Cere administratorului un cod nou.',
  'foloseste_invitatie: un cod gresit intoarce mesajul, nu o exceptie, ca incercarea sa ramana numarata');
select is(identitate.foloseste_invitatie('ZZZZZZZY') ->> 'eroare',
  'Codul nu este valabil. Cere administratorului un cod nou.', 'foloseste_invitatie: a doua incercare gresita');
select is(identitate.foloseste_invitatie('ZZZZZZZX') ->> 'eroare',
  'Codul nu este valabil. Cere administratorului un cod nou.', 'foloseste_invitatie: a treia incercare gresita');
select is(identitate.foloseste_invitatie('ZZZZZZZW') ->> 'eroare',
  'Codul nu este valabil. Cere administratorului un cod nou.', 'foloseste_invitatie: a patra incercare gresita');
select is(identitate.foloseste_invitatie('ZZZZZZZV') ->> 'eroare',
  'Codul nu este valabil. Cere administratorului un cod nou.', 'foloseste_invitatie: a cincea incercare gresita');
reset role;
select is(
  (select count(*)::int from identitate.incercari_invitatii where profil_id = pg_temp.fx('nou')),
  5,
  'foloseste_invitatie: cele cinci incercari gresite sunt inregistrate');
set local role authenticated;
select is(
  identitate.foloseste_invitatie('ZZZZZZZU') ->> 'eroare',
  'Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.',
  'foloseste_invitatie: a sasea incercare este refuzata de limita');
select is(
  identitate.foloseste_invitatie('GCDBUNAC') ->> 'eroare',
  'Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.',
  'foloseste_invitatie: cat tine limita, nici codul bun nu mai trece');
select is(
  (select count(*)::int from identitate.locatari where profil_id = pg_temp.fx('nou')),
  0,
  'foloseste_invitatie: sub limita nu se leaga niciun apartament');
reset role;

-- Limita este pe persoana, nu pe codurile din baza: alt cont porneste curat.
select pg_temp.ca('nou2');
set local role authenticated;
select is(
  identitate.foloseste_invitatie('ZZZZZZZZ') ->> 'eroare',
  'Codul nu este valabil. Cere administratorului un cod nou.',
  'foloseste_invitatie: limita se numara pe fiecare cont in parte');
select is(
  identitate.foloseste_invitatie('  gcdbunac  ') -> 'apartament_numar',
  to_jsonb('1'::text),
  'foloseste_invitatie: un cont curat foloseste in continuare codul bun');
reset role;
select is(
  (select count(*)::int from identitate.incercari_invitatii where profil_id = pg_temp.fx('nou2')),
  0,
  'foloseste_invitatie: dupa un cod bun, incercarile gresite se sterg');

-- Incercarile mai vechi decat fereastra nu mai conteaza.
update identitate.incercari_invitatii set creat_la = now() - interval '16 minutes' where profil_id = pg_temp.fx('nou');
select pg_temp.ca('nou');
set local role authenticated;
select is(
  identitate.foloseste_invitatie('GCDBUNAD') -> 'apartament_numar',
  to_jsonb('1'::text),
  'foloseste_invitatie: dupa un sfert de ora contul poate incerca din nou');
reset role;

select pg_temp.serviciu();
select is(
  (select count(*)::int from identitate.incercari_invitatii where profil_id = pg_temp.fx('nou')),
  0,
  'foloseste_invitatie: incercarile iesite din fereastra se sterg singure');

set local role anon;
select throws_ok(
  $$select count(*) from identitate.incercari_invitatii$$,
  '42501', null,
  'incercari_invitatii: tabela nu se citeste din API');
reset role;

select * from finish();
rollback;
