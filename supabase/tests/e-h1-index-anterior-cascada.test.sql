-- H1: index_anterior se ingheata pe rand la transmitere (transmite_citire)
-- si la estimare, folosind contorizare.index_anterior() care, dupa
-- reparatia A4, numara doar citirile validate. Daca un locatar transmite
-- luna M cat timp luna M-1 e inca "trimisa" (nevalidata), indexul anterior
-- al lunii M se calculeaza sarind peste luna M-1 (se duce la ultima citire
-- *validata*, mai veche). Cand administratorul valideaza apoi ambele luni,
-- consumul lunii M-1 se factureaza a doua oara, in interiorul consumului
-- lunii M (reprodus pe D14 ap. 3: 51.820 mc in loc de 33.740 mc).
--
-- Reparatie: contorizare.valideaza_citire() si
-- contorizare.valideaza_citiri_apartament() recalculeaza, dupa ce accepta
-- o citire, index_anterior (si deci consum, coloana generata) al citirilor
-- inca "trimisa" ale aceluiasi contor, pentru lunile de dupa cea tocmai
-- validata.
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

create function pg_temp.luna(p_decalaj integer default 0)
returns date
language sql
stable
as $$
  select (date_trunc('month', current_date) + make_interval(months => p_decalaj))::date;
$$;

do $$
declare
  v_r jsonb;
  v_bloc uuid;
  v_ap uuid;
  v_c1 uuid;
  v_admin uuid := gen_random_uuid();
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test E1', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TE1'),
    'bloc', jsonb_build_object('denumire', 'Bloc E1', 'adresa', 'Str. Test E1', 'etaje', 1)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '3', 2, 'Dan Trei', 100) returning id into v_ap;
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap, pg_temp.luna(-5), 1);

  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (v_bloc, v_ap, 'rece') returning id into v_c1;

  -- Pornire, validata, luna -5: indexul 100.
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_c1, 'rece', v_bloc, v_ap, pg_temp.luna(-5), 100, 100, 'pornire', 'validata');

  perform organizare.activeaza_bloc(v_bloc);

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'e-h1-' || v_admin || '@test.local', jsonb_build_object('nume', 'Admin E1'));
  perform identitate.numeste_administrator(v_admin, (v_r ->> 'asociatie_id')::uuid, 'AT-E-1', current_date - 30);

  -- Luna A (luna -2): transmisa cand pornirea e singura citire validata.
  -- Anterior corect = 100, consum adevarat = 30.
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_c1, 'rece', v_bloc, v_ap, pg_temp.luna(-2), 100, 130, 'locatar', 'trimisa');

  -- Luna B (luna -1): transmisa cat luna A era inca "trimisa" (nevalidata).
  -- index_anterior() la momentul transmiterii sare peste luna A si ia tot
  -- indexul 100 al pornirii — exact defectul H1. Consumul adevarat al lunii
  -- B este 190 - 130 = 60; cel inghetat gresit ar fi 190 - 100 = 90 (30 din
  -- luna A, facturate a doua oara).
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_c1, 'rece', v_bloc, v_ap, pg_temp.luna(-1), 100, 190, 'locatar', 'trimisa');

  perform set_config('fx.admin', v_admin::text, true);
  perform set_config('fx.c1', v_c1::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('fx.admin'), 'role', 'authenticated')::text, true);

-- Administratorul valideaza luna A. Aceasta trebuie sa recalculeze
-- index_anterior (si consum) al lunii B, inca "trimisa".
select lives_ok(
  $$select contorizare.valideaza_citire(
      (select id from contorizare.citiri where contor_id = current_setting('fx.c1')::uuid and luna = pg_temp.luna(-2)), true)$$,
  'valideaza_citire: administratorul valideaza luna A');

select is(
  (select consum from contorizare.citiri where contor_id = current_setting('fx.c1')::uuid and luna = pg_temp.luna(-2)),
  30.000::numeric,
  'valideaza_citire: consumul lunii A ramane corect (30)');

select is(
  (select index_anterior from contorizare.citiri where contor_id = current_setting('fx.c1')::uuid and luna = pg_temp.luna(-1) and stare = 'trimisa'),
  130.000::numeric,
  'valideaza_citire: cascada actualizeaza index_anterior al lunii B, inca netrimisa, la indexul curent validat al lunii A');

select is(
  (select consum from contorizare.citiri where contor_id = current_setting('fx.c1')::uuid and luna = pg_temp.luna(-1) and stare = 'trimisa'),
  60.000::numeric,
  'valideaza_citire: cascada corecteaza consumul lunii B la valoarea adevarata (60), nu 90');

-- Administratorul valideaza acum si luna B.
select lives_ok(
  $$select contorizare.valideaza_citire(
      (select id from contorizare.citiri where contor_id = current_setting('fx.c1')::uuid and luna = pg_temp.luna(-1)), true)$$,
  'valideaza_citire: administratorul valideaza si luna B');

select is(
  (select consum from contorizare.citiri where contor_id = current_setting('fx.c1')::uuid and luna = pg_temp.luna(-1)),
  60.000::numeric,
  'valideaza_citire: consumul validat final al lunii B este 60, nu dublat');

select * from finish();
rollback;
