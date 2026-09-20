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
select plan(15);

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
  values (v_bloc, '3', 2, 'Dan Trei', 40) returning id into v_ap;
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap, pg_temp.luna(-5), 1);

  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (v_bloc, v_ap, 'rece') returning id into v_c1;

  -- Pornire, validata, luna -5: indexul 100.
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_c1, 'rece', v_bloc, v_ap, pg_temp.luna(-5), 100, 100, 'pornire', 'validata');

  -- Scenariul 2 (validare in afara ordinii cronologice): apartamentul 4, cu
  -- propriul contor si aceeasi pornire, luna -5, indexul 100.
  declare
    v_ap2 uuid;
    v_c2 uuid;
    v_ap3 uuid;
    v_c3 uuid;
  begin
    insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
    values (v_bloc, '4', 2, 'Dan Patru', 30) returning id into v_ap2;
    insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
    values (v_ap2, pg_temp.luna(-5), 1);
    insert into contorizare.contoare (bloc_id, apartament_id, tip) values (v_bloc, v_ap2, 'rece') returning id into v_c2;
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
    values (v_c2, 'rece', v_bloc, v_ap2, pg_temp.luna(-5), 100, 100, 'pornire', 'validata');

    -- Luna A (luna -2): trimisa, anterior corect = 100.
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
    values (v_c2, 'rece', v_bloc, v_ap2, pg_temp.luna(-2), 100, 130, 'locatar', 'trimisa');
    -- Luna B (luna -1): trimisa cat A era inca netransmisa/nevalidata; index_anterior()
    -- ignora luna A (inca "trimisa") si ia pornirea (100), exact ca in scenariul 1.
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
    values (v_c2, 'rece', v_bloc, v_ap2, pg_temp.luna(-1), 100, 190, 'locatar', 'trimisa');

    -- Scenariul 3 (estimare fara cascada): apartamentul 5, pornire luna -5, indexul 100.
    insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
    values (v_bloc, '5', 2, 'Dan Cinci', 30) returning id into v_ap3;
    insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
    values (v_ap3, pg_temp.luna(-5), 1);
    insert into contorizare.contoare (bloc_id, apartament_id, tip) values (v_bloc, v_ap3, 'rece') returning id into v_c3;
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
    values (v_c3, 'rece', v_bloc, v_ap3, pg_temp.luna(-5), 100, 100, 'pornire', 'validata');
    -- Luna A (luna -3): transmisa si validata normal, consum adevarat 30.
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
    values (v_c3, 'rece', v_bloc, v_ap3, pg_temp.luna(-3), 100, 130, 'locatar', 'validata');
    -- Luna B (luna -2): lipseste; va fi estimata mai tarziu, dupa ce C e deja validata.
    -- Luna C (luna -1): transmisa si validata cat B lipsea; index_anterior() sare
    -- peste B (inexistenta) si ia luna A (130) drept anterior — corect doar daca B
    -- va avea consum 0, ceea ce nu e cazul odata ce B se estimeaza cu medie > 0.
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
    values (v_c3, 'rece', v_bloc, v_ap3, pg_temp.luna(-1), 130, 190, 'locatar', 'validata');

    perform set_config('fx.c2', v_c2::text, true);
    perform set_config('fx.c3', v_c3::text, true);
    perform set_config('fx.bloc', v_bloc::text, true);
  end;

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

-- Scenariile 2 si 3 de mai jos exercita contorizare.recalculeaza_viitorul(),
-- cascada comuna apelata din valideaza_citire, valideaza_citiri_apartament
-- si estimeaza_citiri (J1).

-- Scenariul 2: validare in afara ordinii cronologice. Administratorul valideaza
-- mai intai luna B (-1), apoi luna A (-2) — exact ce invita ecranul AdminCitiri,
-- care se deschide pe luna curenta. Cascada trebuie sa corecteze index_anterior
-- al lunii B chiar daca B e deja "validata" (nu doar "trimisa") in acel moment.
select lives_ok(
  $$select contorizare.valideaza_citire(
      (select id from contorizare.citiri where contor_id = current_setting('fx.c2')::uuid and luna = pg_temp.luna(-1)), true)$$,
  'valideaza_citire: administratorul valideaza intai luna B (in afara ordinii)');

select is(
  (select consum from contorizare.citiri where contor_id = current_setting('fx.c2')::uuid and luna = pg_temp.luna(-1)),
  90.000::numeric,
  'valideaza_citire: luna B validata cu indexul anterior inghetat gresit (consum 90, dubleaza luna A)');

select lives_ok(
  $$select contorizare.valideaza_citire(
      (select id from contorizare.citiri where contor_id = current_setting('fx.c2')::uuid and luna = pg_temp.luna(-2)), true)$$,
  'valideaza_citire: administratorul valideaza apoi luna A');

select is(
  (select index_anterior from contorizare.citiri where contor_id = current_setting('fx.c2')::uuid and luna = pg_temp.luna(-1)),
  130.000::numeric,
  'valideaza_citire: cascada recalculeaza index_anterior al lunii B desi B e deja validata, nu doar trimisa');

select is(
  (select consum from contorizare.citiri where contor_id = current_setting('fx.c2')::uuid and luna = pg_temp.luna(-1)),
  60.000::numeric,
  'valideaza_citire: consumul lunii B ajunge la valoarea adevarata (60), nu ramane dublat la 90');

-- Scenariul 3: estimarea unei luni lipsa dupa ce luna urmatoare e deja
-- validata — flux normal, fara nicio greseala a administratorului. Luna C
-- (-1) e deja validata cu index_anterior inghetat la 130 (sarind peste luna
-- B, inexistenta la acel moment). Estimarea lunii B trebuie sa recalculeze
-- si index_anterior/consumul lunii C.
select lives_ok(
  $$select contorizare.estimeaza_citiri(current_setting('fx.bloc')::uuid, pg_temp.luna(-2))$$,
  'estimeaza_citiri: administratorul estimeaza luna B, lipsa, dupa ce C e deja validata');

select is(
  (select index_curent from contorizare.citiri where contor_id = current_setting('fx.c3')::uuid and luna = pg_temp.luna(-2) and sursa = 'estimat'),
  160.000::numeric,
  'estimeaza_citiri: luna B estimata cu media (30) peste anteriorul corect (130)');

select is(
  (select index_anterior from contorizare.citiri where contor_id = current_setting('fx.c3')::uuid and luna = pg_temp.luna(-1)),
  160.000::numeric,
  'estimeaza_citiri: cascada recalculeaza index_anterior al lunii C dupa ce B a fost estimata');

select is(
  (select consum from contorizare.citiri where contor_id = current_setting('fx.c3')::uuid and luna = pg_temp.luna(-1)),
  30.000::numeric,
  'estimeaza_citiri: consumul lunii C ajunge la valoarea adevarata (30), nu ramane dublat la 60');

select * from finish();
rollback;
