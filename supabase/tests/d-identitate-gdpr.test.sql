-- Datele personale si fortarea codurilor de invitatie (audit 2: X02, X07):
--   identitate.anonimizeaza_profil    - stergerea unei persoane, cu pastrarea
--     randurilor contabile;
--   identitate.foloseste_invitatie    - limita de incercari cu cod gresit,
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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
  -- [A5] Numarul este unic si normalizat in baza, deci fiecare om de test are
  -- numarul lui, scris asa cum il tine profilul.
  v_numar text := '07' || substr(regexp_replace(v::text, '[^0-9]', '', 'g') || '00000000', 1, 8);
begin
  insert into auth.users (id, email, phone, raw_user_meta_data)
  values (v, 'g-' || v || '@test.local', v_numar,
          jsonb_build_object('nume', p_nume, 'telefon', v_numar));
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
  -- Poza atestatului administratorului, in bucket-ul privat "atestate" (C7).
  update identitate.administratori
     set atestat_cale = pg_temp.fx('admin')::text || '/atestat-test.jpg'
   where profil_id = pg_temp.fx('admin');
  insert into storage.objects (bucket_id, name, owner)
  values ('atestate', pg_temp.fx('admin')::text || '/atestat-test.jpg', pg_temp.fx('admin'));
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

  -- Identitatea Auth (login cu email), o sesiune deschisa si un token de
  -- reimprospatare, pentru loc si pentru admin (C7).
  insert into auth.identities (user_id, provider_id, provider, identity_data)
  values (pg_temp.fx('loc'), pg_temp.fx('loc')::text, 'email',
          jsonb_build_object('sub', pg_temp.fx('loc')::text, 'email', (select email from auth.users where id = pg_temp.fx('loc')))),
         (pg_temp.fx('admin'), pg_temp.fx('admin')::text, 'email',
          jsonb_build_object('sub', pg_temp.fx('admin')::text, 'email', (select email from auth.users where id = pg_temp.fx('admin')),
            'name', 'Admin G', 'phone', '0711111111'));
  -- [A8] Contul se face pe numar de telefon, deci Auth tine si o identitate
  -- "phone", cu numarul in identity_data si fara email.
  insert into auth.identities (user_id, provider_id, provider, identity_data)
  values (pg_temp.fx('loc'), '4' || (select telefon from identitate.profiluri where id = pg_temp.fx('loc')), 'phone',
          jsonb_build_object('sub', pg_temp.fx('loc')::text,
            'phone', '4' || (select telefon from identitate.profiluri where id = pg_temp.fx('loc'))));

  insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
  values (gen_random_uuid(), pg_temp.fx('loc'), now(), now(), now() + interval '1 day') returning id into v_id;
  perform set_config('fx.sesiune_loc', v_id::text, true);
  insert into auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, session_id)
  values ('rt-loc-' || pg_temp.fx('loc'), pg_temp.fx('loc')::text, false, now(), now(), v_id);

  insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
  values (gen_random_uuid(), pg_temp.fx('admin'), now(), now(), now() + interval '1 day') returning id into v_id;
  perform set_config('fx.sesiune_admin', v_id::text, true);
  insert into auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, session_id)
  values ('rt-admin-' || pg_temp.fx('admin'), pg_temp.fx('admin')::text, false, now(), now(), v_id);
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
  jsonb_build_object('legaturi_inchise', 1, 'mandate_inchise', 0, 'administrator_revocat', false),
  'anonimizeaza_profil: raporteaza ce a inchis si ce a revocat');
select results_eq(
  $$select nume, telefon from identitate.profiluri where id = pg_temp.fx('loc')$$,
  $$values ('Persoana stearsa', null::text)$$,
  'anonimizeaza_profil: numele si telefonul devin neutre');
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

-- C7: identitatea Auth, sesiunile si token-urile de reimprospatare
select is(
  (select identity_data ->> 'email' like 'anonim-%@adminbloc.invalid' from auth.identities
    where user_id = pg_temp.fx('loc') and provider = 'email'),
  true,
  'anonimizeaza_profil: identity_data din auth.identities nu mai poarta emailul real');
select is(
  (select count(*)::int from auth.identities
    where user_id = pg_temp.fx('loc') and identity_data ? 'phone'),
  0,
  '[A8] anonimizeaza_profil: numarul de telefon dispare si din identitatea "phone" a contului');
select is(
  (select count(*)::int from auth.sessions where user_id = pg_temp.fx('loc')),
  0,
  'anonimizeaza_profil: sesiunile deschise ale persoanei se inchid');
select is(
  (select count(*)::int from auth.refresh_tokens where user_id = pg_temp.fx('loc')::text),
  0,
  'anonimizeaza_profil: token-urile de reimprospatare ale persoanei dispar');

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
  jsonb_build_object('legaturi_inchise', 0, 'mandate_inchise', 1, 'administrator_revocat', true),
  'anonimizeaza_profil: mandatul se inchide, iar calitatea de administrator se revoca');

-- C7: mandatul de administrator, calitatea de administrator, identitatea Auth
-- si sesiunile administratorului
select is(
  (select activ_pana from identitate.membri_asociatie where profil_id = pg_temp.fx('admin') and rol = 'administrator'),
  current_date,
  'anonimizeaza_profil: mandatul de administrator, deschis, se inchide azi');
select results_eq(
  $$select stare, motiv_respingere is not null from identitate.administratori where profil_id = pg_temp.fx('admin')$$,
  $$values ('respins', true)$$,
  'anonimizeaza_profil: calitatea de administrator aprobat se revoca, cu motiv');
select is(
  (select identity_data ->> 'email' like 'anonim-%@adminbloc.invalid' from auth.identities where user_id = pg_temp.fx('admin')),
  true,
  'anonimizeaza_profil: identity_data a administratorului nu mai poarta emailul real');
select is(
  (select identity_data ?| array['name', 'phone'] from auth.identities where user_id = pg_temp.fx('admin')),
  false,
  'anonimizeaza_profil: identity_data nu mai poarta numele sau telefonul (C7)');
select results_eq(
  $$select numar_atestat, atestat_cale from identitate.administratori where profil_id = pg_temp.fx('admin')$$,
  $$values (null::text, null::text)$$,
  'anonimizeaza_profil: numarul atestatului si calea pozei dispar de pe fisa administratorului (C7)');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'atestate' and name like pg_temp.fx('admin')::text || '/%'),
  0,
  'anonimizeaza_profil: poza atestatului din bucket-ul privat se sterge (C7)');
select is(
  (select count(*)::int from auth.sessions where user_id = pg_temp.fx('admin')),
  0,
  'anonimizeaza_profil: sesiunile administratorului se inchid');
select is(
  (select count(*)::int from auth.refresh_tokens where user_id = pg_temp.fx('admin')::text),
  0,
  'anonimizeaza_profil: token-urile de reimprospatare ale administratorului dispar');

select is(
  identitate.anonimizeaza_profil(pg_temp.fx('admin')),
  jsonb_build_object('legaturi_inchise', 0, 'mandate_inchise', 0, 'administrator_revocat', false),
  'anonimizeaza_profil: a doua stergere a aceleiasi persoane nu mai schimba nimic');

-- [minor] anonimizeaza_profil inchidea legatura cu
-- greatest(current_date, activ_din + 1), formula pe care reparatia S11 a
-- corectat-o deja in identitate.inchide_acces_locatar (fara +1): o legatura
-- facuta chiar azi si anonimizata azi ramanea, din formula veche, activa
-- pana maine.
select pg_temp.serviciu();
do $$
declare
  v_azi uuid;
begin
  v_azi := pg_temp.utilizator('Mutat Azi G');
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), v_azi, 'chirias', current_date);
  perform set_config('fx.azi', v_azi::text, true);
end;
$$;
select identitate.anonimizeaza_profil(pg_temp.fx('azi'));
select is(
  (select activ_pana from identitate.locatari where profil_id = pg_temp.fx('azi')),
  current_date,
  '[minor] anonimizeaza_profil: o legatura facuta si stearsa azi se inchide azi, nu maine');

select * from finish();
rollback;
