-- A doua limita la codul de invitatie, care nu depinde de cont (audit 2: C16).
--
-- identitate.foloseste_invitatie limiteaza incercarile gresite pe cont (5 la
-- un sfert de ora), dar spatiul codurilor este global: cine isi face conturi
-- noi cumpara incercari noi, deci limita pe cont nu opreste un atac care
-- creeaza multe conturi si incearca putin cu fiecare. Aici este a doua
-- limita, independenta de cont: un plafon pe numarul total de incercari
-- gresite din ultimul sfert de ora, indiferent cine le-a facut. Sub plafon,
-- un cont curat foloseste in continuare un cod bun (calea omului cinstit
-- ramane neatinsa).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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
  insert into auth.users (id, email, raw_user_meta_data)
  values (v, 'h-' || v || '@test.local', jsonb_build_object('nume', p_nume));
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

-- O singura asociatie/bloc/apartament, cu un cod de invitatie valid.
create function pg_temp.fixture()
returns void
language plpgsql
as $$
declare
  r jsonb;
  v_id uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  -- Curata incercarile lasate de alte rulari (testele de integrare JS scriu
  -- direct in baza locala si nu se ruleaza intr-o tranzactie anulata), ca
  -- plafonul global sa se numere doar pe ce face testul de fata.
  delete from identitate.incercari_invitatii;
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test H', 'cui', 'RH' || (floor(random() * 1e9))::bigint),
    'bloc', jsonb_build_object('denumire', 'Bloc H', 'adresa', 'Str. Test H 1', 'etaje', 1)));
  perform set_config('fx.bloc', r ->> 'bloc_id', true);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('bloc'), '1', 0, 'Ion Unu', 100) returning id into v_id;
  perform set_config('fx.ap1', v_id::text, true);

  insert into identitate.invitatii (apartament_id, cod, calitate, expira_la)
  values (pg_temp.fx('ap1'), 'HCDBUNAA', 'membru_familie', now() + interval '30 days'),
         (pg_temp.fx('ap1'), 'HCDBUNAB', 'membru_familie', now() + interval '30 days'),
         (pg_temp.fx('ap1'), 'HCDBUNAC', 'membru_familie', now() + interval '30 days');

  perform set_config('fx.g1', pg_temp.utilizator('Atacator 1')::text, true);
  perform set_config('fx.g2', pg_temp.utilizator('Atacator 2')::text, true);
  perform set_config('fx.g3', pg_temp.utilizator('Atacator 3')::text, true);
  perform set_config('fx.g4', pg_temp.utilizator('Atacator 4')::text, true);
  perform set_config('fx.onest', pg_temp.utilizator('Om Cinstit')::text, true);
  perform set_config('fx.onest2', pg_temp.utilizator('Alt Om Cinstit')::text, true);
end;
$$;

select pg_temp.fixture();
-- --------------------------------------------------------------------------- sfarsit fixture

-- Trei conturi epuizeaza fiecare limita proprie (5 incercari gresite = 15 in
-- total), sub plafonul global. A sasea incercare a fiecarui cont e refuzata
-- de limita proprie si nu se mai numara (nu insereaza rand nou), deci fiecare
-- cont contribuie cu cel mult 5 randuri la numaratoarea globala.
set local role authenticated;
select pg_temp.ca('g1');
select identitate.foloseste_invitatie('ZZZZZZZ1') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZZ2') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZZ3') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZZ4') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZZ5') ->> 'eroare';
select pg_temp.ca('g2');
select identitate.foloseste_invitatie('ZZZZZZZ6') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZZ7') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZZ8') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZZ9') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZY1') ->> 'eroare';
select pg_temp.ca('g3');
select identitate.foloseste_invitatie('ZZZZZZY2') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZY3') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZY4') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZY5') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZY6') ->> 'eroare';
reset role;

select is(
  (select count(*)::int from identitate.incercari_invitatii),
  15,
  'foloseste_invitatie: cele 15 incercari gresite, de la trei conturi diferite, sunt inregistrate');

set local role authenticated;
select pg_temp.ca('onest');
select is(
  identitate.foloseste_invitatie('HCDBUNAA') -> 'apartament_numar',
  to_jsonb('1'::text),
  'foloseste_invitatie: sub plafonul global, un cont curat tot foloseste un cod bun (calea omului cinstit)');
reset role;

-- Al patrulea atacator isi epuizeaza si el limita proprie, completand
-- plafonul global (15 + 5 = 20).
set local role authenticated;
select pg_temp.ca('g4');
select identitate.foloseste_invitatie('ZZZZZZY7') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZY8') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZY9') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZX1') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZX2') ->> 'eroare';
reset role;

select is(
  (select count(*)::int from identitate.incercari_invitatii),
  20,
  'foloseste_invitatie: plafonul global (20) este atins de al patrulea cont, fara ca vreunul sa treaca de limita proprie');

-- Un al cincilea cont, curat, cu un cod bun, este acum blocat de plafonul
-- global, desi nu a incercat niciodata inainte.
set local role authenticated;
select pg_temp.ca('onest2');
select is(
  identitate.foloseste_invitatie('HCDBUNAB') ->> 'eroare',
  'Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.',
  'foloseste_invitatie: peste plafonul global, un cont curat cu un cod bun este blocat (C16)');
reset role;
select is(
  (select count(*)::int from identitate.locatari where profil_id = pg_temp.fx('onest2')),
  0,
  'foloseste_invitatie: cand plafonul global blocheaza, niciun apartament nu se leaga');

-- Dupa un sfert de ora, incercarile vechi ies din fereastra si plafonul se
-- elibereaza: acelasi cod bun functioneaza.
update identitate.incercari_invitatii set creat_la = now() - interval '16 minutes';
set local role authenticated;
select is(
  identitate.foloseste_invitatie('HCDBUNAB') -> 'apartament_numar',
  to_jsonb('1'::text),
  'foloseste_invitatie: dupa un sfert de ora, plafonul global se elibereaza');
reset role;

select * from finish();
rollback;
