-- [B5] Plata inregistrata cu data ei nu lasa in urma penalizarea zilelor in
-- care banii erau deja la asociatie.
--
-- Banii intra in contul asociatiei pe 20 septembrie. Administratorul verifica
-- extrasul si ii confirma pe 2 octombrie, cu data reala (B5, partea intai).
-- Jobul de penalizari a rulat insa pe 1 octombrie si a taxat si zilele de
-- dupa 20 septembrie, cand datoria era deja acoperita.
--
-- Decizia, in spiritul lui K7: penalizarea se recalculeaza cu parametrii ei
-- inghetati, impartind zilele in doua -- cele dinainte de plata, pe restul de
-- atunci, si cele de dupa, pe restul ramas dupa plata. Diferenta intra in
-- registru ca "anulare_penalizare", vizibila locatarului. Doar in jos.
--
-- Fixture: trei apartamente la fel, fiecare cu 1000 de lei scadenti acum 40 de
-- zile, 0,2% pe zi, fara zile de gratie. Penalizarea s-a calculat acum 10 zile,
-- pe 30 de zile de intarziere: 60 de lei de fiecare. Fiecare apartament
-- primeste plata lui, cu alta data, ca scenariile sa nu se calce in picioare.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

/* Penalizarea apartamentului dat, dupa anularile ei */
create function pg_temp.pen(p_cheie text)
returns uuid
language sql
stable
as $$
  select p.datorie_id from financiar.penalizari p
  join financiar.datorii d on d.id = p.datorie_sursa_id
  where d.apartament_id = pg_temp.fx(p_cheie);
$$;

create function pg_temp.anulari(p_cheie text)
returns integer
language sql
stable
as $$
  select count(*)::int from financiar.datorii
  where tip = 'anulare_penalizare' and apartament_id = pg_temp.fx(p_cheie);
$$;

do $$
declare
  r jsonb;
  v_bloc uuid;
  v_id uuid;
  v_cheie text;
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test B5', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TB5'),
    'bloc', jsonb_build_object('denumire', 'Bloc B5', 'adresa', 'Str. Test B5', 'etaje', 0)));
  v_bloc := (r ->> 'bloc_id')::uuid;
  update financiar.setari_financiare set procent_penalizare_zi = 0.2, zile_gratie = 0
    where asociatie_id = (r ->> 'asociatie_id')::uuid;

  foreach v_cheie in array array['ap1', 'ap2', 'ap3'] loop
    insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
    values (v_bloc, right(v_cheie, 1), 0, 'Proprietar ' || v_cheie, 100.0 / 3) returning id into v_id;
    perform set_config('fx.' || v_cheie, v_id::text, true);
    insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
    values (v_id, date_trunc('month', current_date - 100)::date, 1);
    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
    values (v_id, v_bloc, 'intretinere', date_trunc('month', current_date - 40)::date,
            1000, current_date - 40, 'Intretinere de test')
    returning id into v_id;
    perform set_config('fx.datorie_' || v_cheie, v_id::text, true);
  end loop;
  -- cotele nu ies rotund la trei apartamente; blocul se activeaza cu ele egale
  update organizare.apartamente set cota_indiviza = 33.34 where bloc_id = v_bloc and numar = '1';
  update organizare.apartamente set cota_indiviza = 33.33 where bloc_id = v_bloc and numar in ('2', '3');
  perform organizare.activeaza_bloc(v_bloc);

  -- penalizarile s-au calculat acum 10 zile, pe 30 de zile de intarziere
  perform financiar.calculeaza_penalizari(current_date - 10);
end;
$$;

select is((select suma from financiar.datorii where id = pg_temp.pen('ap1')), 60.00::numeric,
  '[B5] pregatire: 1000 de lei, 30 de zile, 0,2% pe zi: penalizarea este 60 de lei');

-- -----------------------------------------------------------------------------
-- Plata cu data ei taie zilele in care banii erau deja la asociatie
-- -----------------------------------------------------------------------------
select set_config('fx.plata', financiar.inregistreaza_plata(
  pg_temp.fx('ap1'), 1000, 'transfer', (current_date - 20 + time '12:00') at time zone 'Europe/Bucharest')::text, true);
select results_eq(
  $$select suma, anuleaza_datorie_id from financiar.datorii
     where tip = 'anulare_penalizare' and apartament_id = pg_temp.fx('ap1')$$,
  $$values (-20.00::numeric(12,2), pg_temp.pen('ap1'))$$,
  '[B5] din cele 30 de zile taxate, 10 erau dupa plata: se anuleaza 20 de lei');
select is(pg_temp.rest(pg_temp.pen('ap1')), 40.00::numeric,
  '[B5] penalizarea ramane cea a zilelor in care banii chiar lipseau');
select is(pg_temp.rest(pg_temp.fx('datorie_ap1')), 0.00::numeric,
  '[B5] datoria este acoperita de plata');
select is(
  (select sum(rest) from financiar.datorii_rest where apartament_id = pg_temp.fx('ap1')),
  (select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')),
  '[B5] suma resturilor ramane egala cu soldul din registru');
-- a doua livrare a aceleiasi plati nu mai anuleaza inca o data
select financiar.anuleaza_penalizari_dupa_plata(pg_temp.fx('plata'));
select is(pg_temp.anulari('ap1'), 1,
  '[B5] chemata a doua oara, comanda nu mai anuleaza nimic');

-- -----------------------------------------------------------------------------
-- O plata de azi nu atinge penalizarile: zilele au fost zile de intarziere
-- -----------------------------------------------------------------------------
select financiar.inregistreaza_plata(pg_temp.fx('ap2'), 1000, 'numerar');
select is(pg_temp.anulari('ap2'), 0,
  '[B5] plata de azi nu anuleaza nimic: banii chiar au lipsit pana azi');

-- -----------------------------------------------------------------------------
-- O plata din chiar ziua scadentei lasa penalizarea fara nicio zi
-- -----------------------------------------------------------------------------
select financiar.inregistreaza_plata(
  pg_temp.fx('ap3'), 1000, 'transfer', (current_date - 40 + time '12:00') at time zone 'Europe/Bucharest');
select is(pg_temp.rest(pg_temp.pen('ap3')), 0.00::numeric,
  '[B5] plata din chiar ziua scadentei lasa penalizarea fara nicio zi');

select * from finish();
rollback;
