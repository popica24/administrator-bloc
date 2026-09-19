-- Financiar, penalizarile (migratia 20260919120017_financiar.sql):
-- financiar.calculeaza_penalizari pe mai multe luni, parametrii inghetati,
-- constrangerile tabelei penalizari. Datele sunt in 2018-2020, ca jobul sa nu
-- atinga datoriile altor teste sau ale blocului demo.
-- Bug-uri cunoscute: F1 (plafonul pe total), F7 (ordinea blocarii), todo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- ---------------------------------------------------------------------------
-- Fixture comun pentru testele b-* (copiat in fiecare fisier, anulat la rollback).
--
-- private.este_serviciu() intoarce true cand session_user este postgres, deci
-- sub psql orice refuz "doar administratorul / doar serviciul" ar fi ocolit.
-- In productie, un apel din API are session_user = authenticator si JWT-ul
-- utilizatorului. Aici redefinim functia, doar in aceasta tranzactie, ca
-- sesiunea postgres sa fie serviciu numai cand nu poarta JWT-ul unui
-- utilizator (auth.role() gol). Asa refuzurile se testeaza cu adevarat.
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

-- Un cont nou in auth.users; trigger-ul creeaza profilul.
create function pg_temp.utilizator(p_nume text)
returns uuid
language plpgsql
as $$
declare
  v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v, 'b-' || v || '@test.local', jsonb_build_object('nume', p_nume));
  return v;
end;
$$;

-- Id-ul unui obiect din fixture (tinut intr-o variabila de sesiune locala).
create function pg_temp.fx(p_cheie text)
returns uuid
language sql
stable
as $$
  select current_setting('fx.' || p_cheie)::uuid;
$$;

-- Prima zi a lunii curente, cu decalaj in luni.
create function pg_temp.luna(p_decalaj integer default 0)
returns date
language sql
stable
as $$
  select (date_trunc('month', current_date) + make_interval(months => p_decalaj))::date;
$$;

-- Asociatie + bloc activ cu 3 apartamente, contoare de apa rece (si calda la ap1),
-- administrator, doi locatari, un presedinte si un strain; plus un al doilea bloc
-- (alta asociatie, alt administrator) pentru izolare.
--   ap1: parter, scutit de lift, cota 30, 2 persoane, contor rece c1 (index 100), calda c1c (50)
--   ap2: etaj 1, cota 30, 3 persoane, contor rece c2 (200)
--   ap3: etaj 2, cota 40, 1 persoana, contor rece c3 (300)
--   contor general rece cg (1000). Pornirea este in luna -5.
create function pg_temp.fixture()
returns void
language plpgsql
as $$
declare
  r jsonb;
  v_luna0 date := pg_temp.luna(-5);
  v_id uuid;
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  perform set_config('request.jwt.claims', '', true);

  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test B', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TB', 'chitantaUltimulNumar', 41),
    'bloc', jsonb_build_object('denumire', 'Bloc B1', 'adresa', 'Str. Test 1', 'etaje', 2)));
  perform set_config('fx.asociatie', r ->> 'asociatie_id', true);
  perform set_config('fx.bloc', r ->> 'bloc_id', true);

  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza)
  values ((r ->> 'bloc_id')::uuid, '1', 0, true, 'Ion Unu', 30) returning id into v_id;
  perform set_config('fx.ap1', v_id::text, true);
  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza)
  values ((r ->> 'bloc_id')::uuid, '2', 1, false, 'Ana Doi', 30) returning id into v_id;
  perform set_config('fx.ap2', v_id::text, true);
  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza)
  values ((r ->> 'bloc_id')::uuid, '3', 2, false, 'Dan Trei', 40) returning id into v_id;
  perform set_config('fx.ap3', v_id::text, true);

  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (pg_temp.fx('ap1'), v_luna0, 2), (pg_temp.fx('ap2'), v_luna0, 3), (pg_temp.fx('ap3'), v_luna0, 1);

  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (pg_temp.fx('bloc'), null, 'rece') returning id into v_id;
  perform set_config('fx.cg', v_id::text, true);
  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (pg_temp.fx('bloc'), pg_temp.fx('ap1'), 'rece') returning id into v_id;
  perform set_config('fx.c1', v_id::text, true);
  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (pg_temp.fx('bloc'), pg_temp.fx('ap1'), 'calda') returning id into v_id;
  perform set_config('fx.c1c', v_id::text, true);
  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (pg_temp.fx('bloc'), pg_temp.fx('ap2'), 'rece') returning id into v_id;
  perform set_config('fx.c2', v_id::text, true);
  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (pg_temp.fx('bloc'), pg_temp.fx('ap3'), 'rece') returning id into v_id;
  perform set_config('fx.c3', v_id::text, true);

  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (pg_temp.fx('cg'), 'rece', pg_temp.fx('bloc'), null, v_luna0, 1000, 1000, 'pornire', 'validata'),
         (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap1'), v_luna0, 100, 100, 'pornire', 'validata'),
         (pg_temp.fx('c1c'), 'calda', pg_temp.fx('bloc'), pg_temp.fx('ap1'), v_luna0, 50, 50, 'pornire', 'validata'),
         (pg_temp.fx('c2'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap2'), v_luna0, 200, 200, 'pornire', 'validata'),
         (pg_temp.fx('c3'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap3'), v_luna0, 300, 300, 'pornire', 'validata');

  perform organizare.activeaza_bloc(pg_temp.fx('bloc'));

  perform set_config('fx.admin', pg_temp.utilizator('Admin B')::text, true);
  perform identitate.numeste_administrator(pg_temp.fx('admin'), pg_temp.fx('asociatie'), 'AT-B-1', current_date - 30);
  perform set_config('fx.loc1', pg_temp.utilizator('Locatar Unu')::text, true);
  perform set_config('fx.loc2', pg_temp.utilizator('Locatar Doi')::text, true);
  perform set_config('fx.fost', pg_temp.utilizator('Fost Locatar')::text, true);
  perform set_config('fx.strain', pg_temp.utilizator('Strain')::text, true);
  perform set_config('fx.pres', pg_temp.utilizator('Presedinte')::text, true);
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), pg_temp.fx('loc1'), 'proprietar', current_date - 30),
         (pg_temp.fx('ap2'), pg_temp.fx('bloc'), pg_temp.fx('loc2'), 'proprietar', current_date - 30);
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din, activ_pana)
  values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), pg_temp.fx('fost'), 'chirias', current_date - 60, current_date - 1);
  insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
  values (pg_temp.fx('asociatie'), pg_temp.fx('pres'), 'presedinte', current_date - 30);

  -- Al doilea bloc, in alta asociatie.
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test B2', 'cui', v_cui || 'X'),
    'setari', jsonb_build_object('chitantaSerie', 'TC'),
    'bloc', jsonb_build_object('denumire', 'Bloc B2', 'adresa', 'Str. Test 2', 'etaje', 0)));
  perform set_config('fx.asociatie2', r ->> 'asociatie_id', true);
  perform set_config('fx.bloc2', r ->> 'bloc_id', true);
  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza)
  values ((r ->> 'bloc_id')::uuid, '1', 0, true, 'Vecin Strain', 100) returning id into v_id;
  perform set_config('fx.ap21', v_id::text, true);
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane) values (v_id, v_luna0, 2);
  perform organizare.activeaza_bloc(pg_temp.fx('bloc2'));
  perform set_config('fx.admin2', pg_temp.utilizator('Admin B2')::text, true);
  perform identitate.numeste_administrator(pg_temp.fx('admin2'), pg_temp.fx('asociatie2'), 'AT-B-2', current_date - 30);
end;
$$;

-- Actiunea urmatoare ruleaza ca utilizatorul din fixture (rolul se schimba separat,
-- cu set local role authenticated).
create function pg_temp.ca(p_cheie text)
returns text
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(p_cheie), 'role', 'authenticated')::text, true);
$$;

-- Inapoi la serviciu (sesiunea postgres, fara JWT).
create function pg_temp.serviciu()
returns text
language sql
as $$
  select set_config('request.jwt.claims', '', true);
$$;

select pg_temp.fixture();
-- --------------------------------------------------------------------------- sfarsit fixture


-- Asociatia 1: 0,1% pe zi, 10 zile de gratie.
update financiar.setari_financiare set procent_penalizare_zi = 0.1, zile_gratie = 10 where asociatie_id = pg_temp.fx('asociatie');

-- ap1: intretinere 1000 lei, scadenta 25.01.2020.
insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), 'intretinere', '2020-01-01', 1000, '2020-01-25', 'Intretinere ianuarie 2020');
select set_config('fx.d1', (select id from financiar.datorii where apartament_id = pg_temp.fx('ap1') and luna = '2020-01-01')::text, true);
-- ap2: 50 lei, platiti la timp.
insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
values (pg_temp.fx('ap2'), pg_temp.fx('bloc'), 'intretinere', '2020-01-01', 50, '2020-01-25', 'Intretinere ianuarie 2020');
select financiar.inregistreaza_plata(pg_temp.fx('ap2'), 50, 'transfer', '2020-01-20 10:00:00+00');
-- ap3: un avans de 30 lei inainte de o restanta preluata fara alocare.
select financiar.inregistreaza_plata(pg_temp.fx('ap3'), 30, 'transfer', '2019-12-01 10:00:00+00');
insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 'sold_initial', null, 100, '2020-01-25', 'Restanta de pe hartie');
select set_config('fx.d3', (select id from financiar.datorii where apartament_id = pg_temp.fx('ap3') and tip = 'sold_initial')::text, true);

-- =============================================================================
-- Luna 1: inca in perioada de gratie
-- =============================================================================

select set_config('fx.n', financiar.calculeaza_penalizari('2020-02-01')::text, true);
select is(
  (select count(*)::int from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_sursa_id where d.bloc_id = pg_temp.fx('bloc')),
  0,
  'calculeaza_penalizari: in perioada de gratie (25.01 + 10 zile) nu se penalizeaza');

-- =============================================================================
-- Luna 2: prima penalizare
-- =============================================================================

select set_config('fx.n', financiar.calculeaza_penalizari('2020-03-01')::text, true);
select is(current_setting('fx.n')::int, (select count(*)::int from financiar.penalizari where luna_calcul = '2020-03-01'),
  'calculeaza_penalizari: intoarce numarul penalizarilor create');
select results_eq(
  $$select rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma
    from financiar.penalizari where datorie_sursa_id = pg_temp.fx('d1') and luna_calcul = '2020-03-01'$$,
  $$values (1000.00::numeric(12,2), 36, 10::smallint, 26, 0.100::numeric(5,3), 26.00::numeric(12,2))$$,
  'calculeaza_penalizari: 1000 x 0,1% x 26 zile (04.02 - 01.03.2020) = 26 lei');
select results_eq(
  $$select d.tip, d.luna, d.suma, d.scadenta, d.descriere, d.apartament_id
    from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_id
    where p.datorie_sursa_id = pg_temp.fx('d1') and p.luna_calcul = '2020-03-01'$$,
  $$values ('penalizare'::text, '2020-03-01'::date, 26.00::numeric(12,2), '2020-03-01'::date, 'Penalizare pentru intretinere ianuarie 2020'::text, pg_temp.fx('ap1'))$$,
  'calculeaza_penalizari: penalizarea este o datorie, cu explicatia ei');
select is((select count(*)::int from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_sursa_id where d.apartament_id = pg_temp.fx('ap2')), 0,
  'calculeaza_penalizari: datoria platita la timp nu se penalizeaza');
select results_eq(
  $$select rest_neachitat, suma from financiar.penalizari where datorie_sursa_id = pg_temp.fx('d3')$$,
  $$values (100.00::numeric(12,2), 2.60::numeric(12,2))$$,
  'calculeaza_penalizari: restanta ap3 se penalizeaza pe restul de atunci (100)');
select results_eq(
  $$select tip, rest from financiar.datorii_rest where apartament_id = pg_temp.fx('ap3') order by tip desc$$,
  $$values ('sold_initial'::text, 70.00::numeric), ('penalizare'::text, 2.60::numeric)$$,
  'calculeaza_penalizari: apoi avansul de 30 lei se aloca pe restanta (aloca_avansuri)');

select set_config('fx.n', financiar.calculeaza_penalizari('2020-03-01')::text, true);
select is((select count(*)::int from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_sursa_id
            where d.bloc_id = pg_temp.fx('bloc') and p.luna_calcul = '2020-03-01'), 2,
  'calculeaza_penalizari: a doua rulare pe aceeasi zi nu dubleaza penalizarile');

-- =============================================================================
-- Luna 3: dupa o plata partiala, de la calculul anterior
-- =============================================================================

select financiar.inregistreaza_plata(pg_temp.fx('ap1'), 400, 'numerar', '2020-03-10 10:00:00+00');
select is((select rest from financiar.datorii_rest where id = pg_temp.fx('d1')), 600.00::numeric,
  'calculeaza_penalizari: plata merge intai pe datoria cea mai veche (400 din 1000)');
select set_config('fx.n', financiar.calculeaza_penalizari('2020-04-01')::text, true);
select results_eq(
  $$select rest_neachitat, zile_intarziere, zile_taxate, procent_zi, suma
    from financiar.penalizari where datorie_sursa_id = pg_temp.fx('d1') and luna_calcul = '2020-04-01'$$,
  $$values (600.00::numeric(12,2), 67, 31, 0.100::numeric(5,3), 18.60::numeric(12,2))$$,
  'calculeaza_penalizari: 600 x 0,1% x 31 zile de la calculul anterior = 18,60');
select is(
  (select count(*)::int from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_sursa_id where d.tip = 'penalizare'),
  0,
  'calculeaza_penalizari: penalizarile nu se penalizeaza (nu se capitalizeaza)');

-- =============================================================================
-- Luna 4: procentul se schimba; penalizarile vechi isi pastreaza parametrii
-- =============================================================================

update financiar.setari_financiare set procent_penalizare_zi = 0.05 where asociatie_id = pg_temp.fx('asociatie');
select set_config('fx.n', financiar.calculeaza_penalizari('2020-05-01')::text, true);
select results_eq(
  $$select luna_calcul, procent_zi, zile_taxate, suma from financiar.penalizari where datorie_sursa_id = pg_temp.fx('d1') order by luna_calcul$$,
  $$values ('2020-03-01'::date, 0.100::numeric(5,3), 26, 26.00::numeric(12,2)),
           ('2020-04-01'::date, 0.100::numeric(5,3), 31, 18.60::numeric(12,2)),
           ('2020-05-01'::date, 0.050::numeric(5,3), 30, 9.00::numeric(12,2))$$,
  'calculeaza_penalizari: istoricul pe trei luni, cu parametrii copiati la fiecare calcul');
select is((select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')), 653.60::numeric,
  'solduri: 1000 + 26 + 18,60 + 9 - 400 = 653,60');

-- Plata integrala: nicio penalizare noua.
select financiar.inregistreaza_plata(pg_temp.fx('ap1'), 653.60, 'numerar', '2020-05-05 10:00:00+00');
select set_config('fx.n', financiar.calculeaza_penalizari('2020-06-01')::text, true);
select is((select count(*)::int from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_sursa_id
            where d.bloc_id = pg_temp.fx('bloc') and p.luna_calcul = '2020-06-01'), 1,
  'calculeaza_penalizari: dupa plata integrala, ap1 nu mai are penalizari (ramane doar ap3)');

-- =============================================================================
-- Constrangerile tabelei penalizari
-- =============================================================================

select throws_like(
  $$insert into financiar.penalizari (datorie_sursa_id, datorie_id, luna_calcul, rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma)
    values (pg_temp.fx('d1'), pg_temp.fx('d3'), '2021-01-01', 0, 1, 0, 1, 0.1, 1)$$,
  '%penalizari_rest_neachitat_check%', 'penalizari: restul neachitat este pozitiv');
select throws_like(
  $$insert into financiar.penalizari (datorie_sursa_id, datorie_id, luna_calcul, rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma)
    values (pg_temp.fx('d1'), pg_temp.fx('d3'), '2021-01-01', 10, 0, 0, 1, 0.1, 1)$$,
  '%penalizari_zile_intarziere_check%', 'penalizari: zilele de intarziere sunt pozitive');
select throws_like(
  $$insert into financiar.penalizari (datorie_sursa_id, datorie_id, luna_calcul, rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma)
    values (pg_temp.fx('d1'), pg_temp.fx('d3'), '2021-01-01', 10, 1, 0, 0, 0.1, 1)$$,
  '%penalizari_zile_taxate_check%', 'penalizari: zilele taxate sunt pozitive');
select throws_like(
  $$insert into financiar.penalizari (datorie_sursa_id, datorie_id, luna_calcul, rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma)
    values (pg_temp.fx('d1'), pg_temp.fx('d3'), '2021-01-01', 10, 1, 0, 1, 0.1, 11)$$,
  '%penalizari_suma_check%', 'penalizari: o penalizare nu depaseste restul la care se aplica');
select throws_like(
  $$insert into financiar.penalizari (datorie_sursa_id, datorie_id, luna_calcul, rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma)
    select pg_temp.fx('d1'), datorie_id, '2021-01-01', 10, 1, 0, 1, 0.1, 1 from financiar.penalizari where luna_calcul = '2020-03-01' and datorie_sursa_id = pg_temp.fx('d1')$$,
  '%penalizari_datorie_key%', 'penalizari: o explicatie pe datoria de penalizare');
select throws_like(
  $$insert into financiar.penalizari (datorie_sursa_id, datorie_id, luna_calcul, rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma)
    values (pg_temp.fx('d1'), pg_temp.fx('d3'), '2020-03-01', 10, 1, 0, 1, 0.1, 1)$$,
  '%penalizari_sursa_luna_key%', 'penalizari: un calcul pe datorie si zi');

-- =============================================================================
-- Bug-uri cunoscute (todo)
-- =============================================================================

-- F1: 100 lei neplatiti, 0,2% pe zi (plafonul legal), 24 de calcule lunare.
update financiar.setari_financiare set procent_penalizare_zi = 0.2, zile_gratie = 0 where asociatie_id = pg_temp.fx('asociatie2');
insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
values (pg_temp.fx('ap21'), pg_temp.fx('bloc2'), 'intretinere', '2018-01-01', 100, '2018-01-25', 'Intretinere ianuarie 2018');
do $$
declare
  d date;
begin
  for d in select generate_series('2018-02-01'::date, '2020-01-01'::date, interval '1 month')::date loop
    perform financiar.calculeaza_penalizari(d);
  end loop;
end;
$$;
select is((select count(*)::int from financiar.datorii where apartament_id = pg_temp.fx('ap21') and tip = 'penalizare'), 18,
  'calculeaza_penalizari: calculele lunare se opresc cand penalizarile ating datoria (18 din 24 de luni)');
select ok((select bool_and(p.suma <= p.rest_neachitat) from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_id
            where d.apartament_id = pg_temp.fx('ap21')),
  'calculeaza_penalizari: fiecare calcul luat separat respecta plafonul');

select is(
  (select sum(p.suma) from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_id where d.apartament_id = pg_temp.fx('ap21')),
  100.00::numeric,
  '[F1] plafonul se atinge exact: ultima penalizare completeaza pana la 100 lei');
select cmp_ok(
  (select sum(p.suma) from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_id where d.apartament_id = pg_temp.fx('ap21')),
  '<=', 100.00::numeric,
  '[F1] 24 de luni de penalizari pe 100 lei nu trec de 100 lei');

-- [F7] Blocarea contului inainte de citirea restului nu se mai verifica aici,
-- uitandu-ne la textul functiei, ci in tests/integrare/concurenta.test.js: doua
-- sesiuni reale, una tine lock-ul pe cont, cealalta ruleaza calculul si trebuie
-- sa astepte. Un test pgTAP nu poate face asta: totul ruleaza intr-o singura
-- tranzactie, care nu se poate astepta pe ea insasi.

select * from finish();
rollback;
