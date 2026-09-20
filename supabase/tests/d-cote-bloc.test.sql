-- Comanda de corectare a cotelor unui bloc intreg (audit 2, urmarea X06/D1):
-- organizare.schimba_fisa_apartament tolereaza doar o abatere de 0,01 din suma
-- de 100 pe un bloc activ, deci nu exista nicio cale sa muti, de exemplu, doua
-- procente de la un apartament la altul. organizare.schimba_cotele_blocului
-- primeste dintr-o data cota fiecarui apartament din bloc si verifica o
-- singura data suma lor, apoi le scrie pe toate intr-o singura actualizare.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- ---------------------------------------------------------------------------
-- Fixture (acelasi tipar ca in d-comenzi-fisa-fond.test.sql).
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
  insert into auth.users (id, email, raw_user_meta_data)
  values (v, 'e-' || v || '@test.local', jsonb_build_object('nume', p_nume));
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

-- Asociatia E1, blocul activ E1 (ap1 30, ap2 30, ap3 40) si blocul Ec, ramas in
-- configurare (apc 50). Asociatia E2, cu blocul activ E2 (apx 100) si alt
-- administrator, pentru refuzul incrucisat.
create function pg_temp.fixture()
returns void
language plpgsql
as $$
declare
  r jsonb;
  v_id uuid;
  v_luna0 date := (date_trunc('month', current_date) - interval '3 months')::date;
  v_cui text := 'RE' || (floor(random() * 1e9))::bigint;
begin
  perform set_config('request.jwt.claims', '', true);

  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test E1', 'cui', v_cui),
    'bloc', jsonb_build_object('denumire', 'Bloc E1', 'adresa', 'Str. Test E 1', 'etaje', 2)));
  perform set_config('fx.asociatie', r ->> 'asociatie_id', true);
  perform set_config('fx.bloc', r ->> 'bloc_id', true);

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('bloc'), '1', 0, 'Ion Unu', 30) returning id into v_id;
  perform set_config('fx.ap1', v_id::text, true);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('bloc'), '2', 1, 'Ana Doi', 30) returning id into v_id;
  perform set_config('fx.ap2', v_id::text, true);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('bloc'), '3', 2, 'Dan Trei', 40) returning id into v_id;
  perform set_config('fx.ap3', v_id::text, true);
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (pg_temp.fx('ap1'), v_luna0, 2), (pg_temp.fx('ap2'), v_luna0, 3), (pg_temp.fx('ap3'), v_luna0, 1);
  perform organizare.activeaza_bloc(pg_temp.fx('bloc'));

  insert into organizare.blocuri (asociatie_id, denumire, adresa, etaje)
  values (pg_temp.fx('asociatie'), 'Bloc Ec', 'Str. Test E 2', 1) returning id into v_id;
  perform set_config('fx.blocc', v_id::text, true);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('blocc'), '1', 0, 'Vasile Configurare', 50) returning id into v_id;
  perform set_config('fx.apc', v_id::text, true);

  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test E2', 'cui', v_cui || 'X'),
    'bloc', jsonb_build_object('denumire', 'Bloc E2', 'adresa', 'Str. Test E 3', 'etaje', 0)));
  perform set_config('fx.asociatie2', r ->> 'asociatie_id', true);
  perform set_config('fx.bloc2', r ->> 'bloc_id', true);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('bloc2'), '1', 0, 'Vecin Strain', 100) returning id into v_id;
  perform set_config('fx.apx', v_id::text, true);
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane) values (v_id, v_luna0, 2);
  perform organizare.activeaza_bloc(pg_temp.fx('bloc2'));

  perform set_config('fx.admin', pg_temp.utilizator('Admin E1')::text, true);
  perform identitate.numeste_administrator(pg_temp.fx('admin'), pg_temp.fx('asociatie'), 'AT-E-1', current_date - 30);
  perform set_config('fx.admin2', pg_temp.utilizator('Admin E2')::text, true);
  perform identitate.numeste_administrator(pg_temp.fx('admin2'), pg_temp.fx('asociatie2'), 'AT-E-2', current_date - 30);
  perform set_config('fx.loc1', pg_temp.utilizator('Locatar Unu')::text, true);
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), pg_temp.fx('loc1'), 'proprietar', current_date - 30);
  perform set_config('fx.pres', pg_temp.utilizator('Presedinte E1')::text, true);
  insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
  values (pg_temp.fx('asociatie'), pg_temp.fx('pres'), 'presedinte', current_date - 30);
end;
$$;

select pg_temp.fixture();
-- --------------------------------------------------------------------------- sfarsit fixture

select pg_temp.ca('admin');

-- Cazul principal: redistribuie cotele blocului activ (30/30/40 -> 25/35/40)
-- intr-o singura comanda, ceva ce schimba_fisa_apartament nu poate face pentru
-- ca fiecare apartament, luat separat, ar strica suma de 100.
select lives_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 25),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', 35),
      jsonb_build_object('apartament_id', pg_temp.fx('ap3'), 'cota', 40)))$$,
  'schimba_cotele_blocului: administratorul redistribuie cotele blocului activ dintr-o data');
select results_eq(
  $$select numar, cota_indiviza from organizare.apartamente where bloc_id = pg_temp.fx('bloc') order by numar$$,
  $$values ('1', 25.0000::numeric(7,4)), ('2', 35.0000::numeric(7,4)), ('3', 40.0000::numeric(7,4))$$,
  'schimba_cotele_blocului: fiecare apartament primeste noua lui cota');
select is(
  (select count(*)::int from audit.jurnal
    where tabela = 'organizare.apartamente' and rand_id = pg_temp.fx('ap1') and operatie = 'UPDATE'),
  1,
  'schimba_cotele_blocului: fiecare actualizare ajunge in audit.jurnal');

-- Suma gresita: nimic nu se scrie.
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 30),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', 35),
      jsonb_build_object('apartament_id', pg_temp.fx('ap3'), 'cota', 40)))$$,
  'Cotele trimise insumeaza 105,00, nu 100. Corecteaza-le pe toate inainte de a le salva.',
  'schimba_cotele_blocului: suma diferita de 100 este refuzata, mesajul in format romanesc (F2)');
select is(
  (select cota_indiviza from organizare.apartamente where id = pg_temp.fx('ap1')),
  25.0000::numeric(7,4),
  'schimba_cotele_blocului: dupa refuz, cotele raman cele dinainte');

-- Lista incompleta (lipseste ap3).
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 60),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', 40)))$$,
  'Lista trebuie sa contina o singura cota pentru fiecare apartament din bloc, fara lipsuri sau duplicate.',
  'schimba_cotele_blocului: o lista incompleta este refuzata');

-- Duplicat pe acelasi apartament.
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 20),
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 5),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', 35),
      jsonb_build_object('apartament_id', pg_temp.fx('ap3'), 'cota', 40)))$$,
  'Lista trebuie sa contina o singura cota pentru fiecare apartament din bloc, fara lipsuri sau duplicate.',
  'schimba_cotele_blocului: un apartament aparut de doua ori este refuzat');

-- Apartament dintr-un alt bloc.
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 25),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', 35),
      jsonb_build_object('apartament_id', pg_temp.fx('apx'), 'cota', 40)))$$,
  'Lista trebuie sa contina o singura cota pentru fiecare apartament din bloc, fara lipsuri sau duplicate.',
  'schimba_cotele_blocului: un apartament din alt bloc face lista incompleta pentru blocul curent');

-- Cota in afara intervalului.
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 0),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', 60),
      jsonb_build_object('apartament_id', pg_temp.fx('ap3'), 'cota', 40)))$$,
  'Cota indiviza trebuie sa fie un numar intre 0 si 100.',
  'schimba_cotele_blocului: o cota zero este refuzata, chiar daca suma iese 100');
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 25),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', null),
      jsonb_build_object('apartament_id', pg_temp.fx('ap3'), 'cota', 75)))$$,
  'Cota indiviza trebuie sa fie un numar intre 0 si 100.',
  'schimba_cotele_blocului: o cota necompletata este refuzata');

-- Lista goala.
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), '[]'::jsonb)$$,
  'Trimite cota fiecarui apartament din bloc.',
  'schimba_cotele_blocului: o lista goala este refuzata');
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), null)$$,
  'Trimite cota fiecarui apartament din bloc.',
  'schimba_cotele_blocului: lipsa listei este refuzata');

-- Un bloc in configurare accepta acelasi drum.
select lives_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('blocc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('apc'), 'cota', 100)))$$,
  'schimba_cotele_blocului: pe un bloc in configurare, singurul apartament ajunge la 100');

select throws_ok(
  $$select organizare.schimba_cotele_blocului(gen_random_uuid(), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 100)))$$,
  'Blocul nu exista sau nu este administrat de tine.',
  'schimba_cotele_blocului: un bloc inexistent este refuzat');

select pg_temp.ca('loc1');
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 25),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', 35),
      jsonb_build_object('apartament_id', pg_temp.fx('ap3'), 'cota', 40)))$$,
  'Blocul nu exista sau nu este administrat de tine.',
  'schimba_cotele_blocului: locatarul nu redistribuie cotele');
select pg_temp.ca('pres');
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 25),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', 35),
      jsonb_build_object('apartament_id', pg_temp.fx('ap3'), 'cota', 40)))$$,
  'Blocul nu exista sau nu este administrat de tine.',
  'schimba_cotele_blocului: presedintele supravegheaza, dar nu redistribuie cotele');
select pg_temp.ca('admin2');
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 25),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', 35),
      jsonb_build_object('apartament_id', pg_temp.fx('ap3'), 'cota', 40)))$$,
  'Blocul nu exista sau nu este administrat de tine.',
  'schimba_cotele_blocului: administratorul altei asociatii nu ajunge la bloc');

select pg_temp.serviciu();
select lives_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc2'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('apx'), 'cota', 100)))$$,
  'schimba_cotele_blocului: serviciul poate redistribui cotele oricarui bloc');

set local role anon;
select throws_ok(
  $$select organizare.schimba_cotele_blocului(pg_temp.fx('bloc'), jsonb_build_array(
      jsonb_build_object('apartament_id', pg_temp.fx('ap1'), 'cota', 25),
      jsonb_build_object('apartament_id', pg_temp.fx('ap2'), 'cota', 35),
      jsonb_build_object('apartament_id', pg_temp.fx('ap3'), 'cota', 40)))$$,
  '42501', null,
  'schimba_cotele_blocului: anon nu are drept de executie');
reset role;

-- public.numar_ro: formatul romanesc (virgula, doua zecimale) folosit in
-- mesajele de refuz de mai sus (F2).
select is(public.numar_ro(102.98), '102,98', 'numar_ro: doua zecimale, cu virgula');
select is(public.numar_ro(105), '105,00', 'numar_ro: un numar intreg capata doua zecimale');
select is(public.numar_ro(105.4, 0), '105', 'numar_ro: zero zecimale, fara virgula');

select * from finish();
rollback;
