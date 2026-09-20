-- A doua limita la codul de invitatie, care nu depinde de cont (audit 2: C16,
-- reproiectata dupa ce plafonul global s-a dovedit o cale de blocare).
--
-- identitate.foloseste_invitatie limiteaza incercarile gresite pe cont (5 la
-- un sfert de ora), dar spatiul codurilor este global si contul e gratuit:
-- cine isi face conturi noi cumpara incercari noi. Prima varianta a pus un
-- plafon global, numarat peste toate conturile la un loc — si a iesit o cale
-- de blocare a intregii platforme: 20 de incercari gresite opreau, pentru un
-- sfert de ora, orice om cinstit din orice asociatie, chiar cu un cod bun.
--
-- A doua limita se numara acum pe adresa de la care vine cererea (antetul
-- x-forwarded-for, pus de PostgREST in request.headers): 20 de incercari
-- gresite de la aceeasi adresa, in ultimul sfert de ora. Atacatorul isi
-- blocheaza propria adresa; oamenii de pe alte adrese nu simt nimic. Cand
-- adresa nu se cunoaste (apeluri din server, fara antet), ramane doar limita
-- pe cont.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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

/* Adresa de la care vine cererea, asa cum o pune PostgREST */
create function pg_temp.dela(p_ip text)
returns text
language sql
as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
$$;

create function pg_temp.fara_adresa()
returns text
language sql
as $$
  select set_config('request.headers', '', true);
$$;

-- O singura asociatie/bloc/apartament, cu coduri de invitatie valide.
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
  -- direct in baza locala si nu se ruleaza intr-o tranzactie anulata).
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
         (pg_temp.fx('ap1'), 'HCDBUNAC', 'membru_familie', now() + interval '30 days'),
         (pg_temp.fx('ap1'), 'HCDBUNAD', 'membru_familie', now() + interval '30 days');

  perform set_config('fx.g1', pg_temp.utilizator('Atacator 1')::text, true);
  perform set_config('fx.g2', pg_temp.utilizator('Atacator 2')::text, true);
  perform set_config('fx.g3', pg_temp.utilizator('Atacator 3')::text, true);
  perform set_config('fx.g4', pg_temp.utilizator('Atacator 4')::text, true);
  perform set_config('fx.g5', pg_temp.utilizator('Atacator 5')::text, true);
  perform set_config('fx.onest', pg_temp.utilizator('Om Cinstit')::text, true);
  perform set_config('fx.onest2', pg_temp.utilizator('Alt Om Cinstit')::text, true);
  perform set_config('fx.onest3', pg_temp.utilizator('Al Treilea Om Cinstit')::text, true);
end;
$$;

select pg_temp.fixture();
-- --------------------------------------------------------------------------- sfarsit fixture

-- Patru conturi, toate de la aceeasi adresa, isi epuizeaza fiecare limita
-- proprie: 4 x 5 = 20 de incercari gresite de la adresa 203.0.113.7.
set local role authenticated;
select pg_temp.dela('203.0.113.7');
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
select pg_temp.ca('g4');
select identitate.foloseste_invitatie('ZZZZZZY7') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZY8') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZY9') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZX1') ->> 'eroare';
select identitate.foloseste_invitatie('ZZZZZZX2') ->> 'eroare';
reset role;

select is(
  (select count(*)::int from identitate.incercari_invitatii where ip = '203.0.113.7'),
  20,
  'foloseste_invitatie: cele 20 de incercari gresite sunt numarate pe adresa de la care au venit');

-- Al cincilea cont, curat, dar de la aceeasi adresa: plafonul pe adresa il
-- opreste, chiar cu un cod bun. Atacatorul isi blocheaza propria adresa.
set local role authenticated;
select pg_temp.dela('203.0.113.7');
select pg_temp.ca('g5');
select is(
  identitate.foloseste_invitatie('HCDBUNAA') ->> 'eroare',
  'S-au incercat prea multe coduri gresite de la aceasta conexiune. Mai asteapta un sfert de ora si incearca din nou.',
  'foloseste_invitatie: peste plafonul pe adresa, si un cod bun este refuzat de la acea adresa');
reset role;

-- Omul cinstit, de pe alta adresa, trece: platforma nu se blocheaza.
set local role authenticated;
select pg_temp.dela('198.51.100.20');
select pg_temp.ca('onest');
select is(
  identitate.foloseste_invitatie('HCDBUNAA') -> 'apartament_numar',
  to_jsonb('1'::text),
  'foloseste_invitatie: un om cinstit de pe alta adresa foloseste codul bun, desi alta adresa e blocata (C16)');
reset role;

-- Fara antet de adresa (apel din server), ramane doar limita pe cont: un cont
-- curat cu un cod bun trece.
set local role authenticated;
select pg_temp.fara_adresa();
select pg_temp.ca('onest2');
select is(
  identitate.foloseste_invitatie('HCDBUNAB') -> 'apartament_numar',
  to_jsonb('1'::text),
  'foloseste_invitatie: fara adresa cunoscuta, ramane doar limita pe cont');
reset role;

-- Limita pe cont ramane neschimbata: 5 incercari gresite, a sasea e oprita.
set local role authenticated;
select pg_temp.dela('198.51.100.21');
select pg_temp.ca('onest3');
select identitate.foloseste_invitatie('QQQQQQQ1') ->> 'eroare';
select identitate.foloseste_invitatie('QQQQQQQ2') ->> 'eroare';
select identitate.foloseste_invitatie('QQQQQQQ3') ->> 'eroare';
select identitate.foloseste_invitatie('QQQQQQQ4') ->> 'eroare';
select identitate.foloseste_invitatie('QQQQQQQ5') ->> 'eroare';
select is(
  identitate.foloseste_invitatie('HCDBUNAC') ->> 'eroare',
  'Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.',
  'foloseste_invitatie: limita pe cont opreste al saselea cod, chiar daca adresa e curata');
select is(
  (select count(*)::int from identitate.locatari where profil_id = pg_temp.fx('onest3')),
  0,
  'foloseste_invitatie: cand limita pe cont opreste, niciun apartament nu se leaga');
reset role;

-- Dupa un sfert de ora, incercarile vechi ies din fereastra: adresa blocata
-- poate incerca din nou.
update identitate.incercari_invitatii set creat_la = now() - interval '16 minutes';
set local role authenticated;
select pg_temp.dela('203.0.113.7');
select pg_temp.ca('g5');
select is(
  identitate.foloseste_invitatie('HCDBUNAD') -> 'apartament_numar',
  to_jsonb('1'::text),
  'foloseste_invitatie: dupa un sfert de ora, adresa se elibereaza');
reset role;

-- identitate.adresa_cererii: primul element din x-forwarded-for, sau null
select pg_temp.dela('203.0.113.7, 70.41.3.18, 150.172.238.178');
select is(identitate.adresa_cererii(), '203.0.113.7',
  'adresa_cererii: din lantul de proxy-uri ia clientul, primul element');
select pg_temp.fara_adresa();
select is(identitate.adresa_cererii(), null,
  'adresa_cererii: fara antete, adresa nu se cunoaste');

select * from finish();
rollback;
