-- [T1] Stornarea unei incasari: ce se intampla cu penalizarile pe care plata
-- le-a anulat.
--
-- Administratorul confirma un transfer cu data din extras (B5), iar
-- financiar.anuleaza_penalizari_dupa_plata taie din penalizare zilele in care
-- banii erau deja in cont. Daca acea incasare se dovedeste gresita si se
-- storneaza, banii nu au fost niciodata acolo: penalizarea trebuie sa se
-- intoarca intreaga.
--
-- Anularile nu se sterg si nu se contrazic cu randuri noi: fiecare stie plata
-- care a provocat-o, iar o plata stornata nu se mai socoteste nicaieri -- nici
-- in sold, nici in anularile ei.
--
-- Fixture: ap1 datoreaza 1000 de lei, scadenti acum 40 de zile, 0,2% pe zi,
-- fara zile de gratie. Penalizarea s-a calculat acum 10 zile, pe 30 de zile de
-- intarziere: 60 de lei. Plata de 1000 se inregistreaza azi, cu data de acum
-- 20 de zile, deci penalizarea scade la 40.
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

create function pg_temp.fx(p_cheie text)
returns uuid
language sql
stable
as $$
  select current_setting('fx.' || p_cheie)::uuid;
$$;

create function pg_temp.rest(p_id uuid)
returns numeric
language sql
stable
as $$
  select rest from financiar.datorii_rest where id = p_id;
$$;

create function pg_temp.pen()
returns uuid
language sql
stable
as $$
  select p.datorie_id from financiar.penalizari p
  join financiar.datorii d on d.id = p.datorie_sursa_id
  where d.apartament_id = pg_temp.fx('ap1');
$$;

do $$
declare
  r jsonb;
  v_bloc uuid;
  v_id uuid;
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test T1', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TT1'),
    'bloc', jsonb_build_object('denumire', 'Bloc T1', 'adresa', 'Str. Test T1', 'etaje', 0)));
  v_bloc := (r ->> 'bloc_id')::uuid;
  perform set_config('fx.bloc', v_bloc::text, true);
  update financiar.setari_financiare set procent_penalizare_zi = 0.2, zile_gratie = 0
    where asociatie_id = (r ->> 'asociatie_id')::uuid;

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '1', 0, 'Ion Unu', 100) returning id into v_id;
  perform set_config('fx.ap1', v_id::text, true);
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_id, date_trunc('month', current_date - 100)::date, 1);
  perform organizare.activeaza_bloc(v_bloc);

  insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
  values (v_id, v_bloc, 'intretinere', date_trunc('month', current_date - 40)::date,
          1000, current_date - 40, 'Intretinere de test')
  returning id into v_id;
  perform set_config('fx.datorie', v_id::text, true);

  perform financiar.calculeaza_penalizari(current_date - 10);

  -- administratorul asociatiei, cel care va storna
  perform set_config('fx.admin', gen_random_uuid()::text, true);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (pg_temp.fx('admin'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'admin.t1.' || substr(pg_temp.fx('admin')::text, 1, 8) || '@teste.local',
          jsonb_build_object('nume', 'Admin T1'), now(), now());
  perform identitate.numeste_administrator(pg_temp.fx('admin'), (r ->> 'asociatie_id')::uuid, 'AT-T1', current_date - 30);
end;
$$;

select is((select suma from financiar.datorii where id = pg_temp.pen()), 60.00::numeric,
  '[T1] pregatire: 1000 de lei, 30 de zile, 0,2% pe zi: penalizarea este 60 de lei');

-- incasarea de azi, cu data din extras de acum 20 de zile, scrisa de administrator
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.fx('admin'), 'role', 'authenticated')::text, true);
select set_config('fx.plata', financiar.inregistreaza_incasare(
  pg_temp.fx('ap1'), 1000, 'transfer', null, current_date - 20)::text, true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.rest(pg_temp.pen()), 40.00::numeric,
  '[T1] pregatire: B5 taie din penalizare zilele in care banii erau deja in cont');

-- [T1] plata inregistrata azi, chiar daca banii au intrat acum 20 de zile
select is((select (creat_la at time zone 'Europe/Bucharest')::date from financiar.plati where id = pg_temp.fx('plata')),
  (now() at time zone 'Europe/Bucharest')::date,
  '[T1] plata poarta ziua in care a fost scrisa in aplicatie, nu data din extras');
select is((select (confirmata_la at time zone 'Europe/Bucharest')::date from financiar.plati where id = pg_temp.fx('plata')),
  current_date - 20,
  '[T1] ...iar data din extras ramane data la care au intrat banii');

-- stornarea
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.fx('admin'), 'role', 'authenticated')::text, true);
select lives_ok($$select financiar.storneaza_incasare(pg_temp.fx('plata'), 'Transferul nu a intrat in cont')$$,
  '[T1] administratorul storneaza incasarea scrisa azi');
reset role;
select set_config('request.jwt.claims', '', true);

select is(pg_temp.rest(pg_temp.pen()), 60.00::numeric,
  '[T1] penalizarea se intoarce intreaga: banii nu au fost niciodata in cont');
select is(pg_temp.rest(pg_temp.fx('datorie')), 1000.00::numeric,
  '[T1] datoria se redeschide, cu toata suma ei');
select is((select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')), 1060.00::numeric,
  '[T1] soldul este datoria plus penalizarea intreaga');
select is(
  (select sum(rest) from financiar.datorii_rest where apartament_id = pg_temp.fx('ap1')),
  (select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')),
  '[T1] suma resturilor ramane egala cu soldul din registru');

select * from finish();
rollback;
