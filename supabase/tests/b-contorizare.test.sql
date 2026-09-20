-- Contorizare (migratia 20260919120014_contorizare.sql): constrangerile,
-- contorizare.index_anterior, transmite_citire, valideaza_citire,
-- citeste_contor_general, estimeaza_citiri, consum_validat, consum_mediu_bloc
-- si politicile RLS. Bug-urile cunoscute din audit (A2, A3, A4, A6, L5) sunt
-- scrise pentru comportamentul corect si marcate todo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(86);

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


-- =============================================================================
-- Constrangerile tabelelor
-- =============================================================================

select throws_like(
  $$update contorizare.setari_contorizare set zi_limita_citire = 29 where bloc_id = pg_temp.fx('bloc')$$,
  '%setari_contorizare_zi_limita_citire_check%',
  'setari_contorizare: ziua limita trebuie sa fie intre 1 si 28');
select throws_like(
  $$update contorizare.setari_contorizare set metoda_estimare = 'mediana' where bloc_id = pg_temp.fx('bloc')$$,
  '%setari_contorizare_metoda_estimare_check%',
  'setari_contorizare: doar metoda medie_3_luni');
select throws_like(
  $$insert into contorizare.contoare (bloc_id, apartament_id, tip) values (pg_temp.fx('bloc'), pg_temp.fx('ap1'), 'gaz')$$,
  '%contoare_tip_check%',
  'contoare: tipul este rece sau calda');
select throws_like(
  $$insert into contorizare.contoare (bloc_id, apartament_id, tip) values (pg_temp.fx('bloc'), null, 'rece')$$,
  '%contoare_general_activ_key%',
  'contoare: un singur contor general activ pe tip de apa');
select lives_ok(
  $$insert into contorizare.contoare (bloc_id, apartament_id, tip, scos_la) values (pg_temp.fx('bloc'), null, 'rece', current_date - 400)$$,
  'contoare: un contor general scos din uz nu intra in unicitate');
select throws_like(
  $$insert into contorizare.contoare (bloc_id, apartament_id, tip) values (pg_temp.fx('bloc'), pg_temp.fx('ap21'), 'rece')$$,
  '%contoare_apartament_fk%',
  'contoare: apartamentul trebuie sa fie din acelasi bloc');

select throws_like(
  $$insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa)
    values (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-1) + 3, 100, 101, 'locatar')$$,
  '%citiri_luna_check%',
  'citiri: luna este prima zi a lunii');
select throws_like(
  $$insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa)
    values (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-1), 100, 99, 'locatar')$$,
  '%citiri_index_curent_check%',
  'citiri: indexul curent nu scade sub cel anterior');
select throws_like(
  $$insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa)
    values (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-1), 100, 101, 'ghicit')$$,
  '%citiri_sursa_check%',
  'citiri: sursa din lista permisa');
select throws_like(
  $$insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
    values (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-1), 100, 101, 'locatar', 'uitata')$$,
  '%citiri_stare_check%',
  'citiri: starea din lista permisa');
select throws_like(
  $$insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa)
    values (pg_temp.fx('c1'), 'calda', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-1), 100, 101, 'locatar')$$,
  '%citiri_contor_tip_fk%',
  'citiri: tipul citirii este tipul contorului');
select throws_like(
  $$insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa)
    values (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc2'), pg_temp.fx('ap1'), pg_temp.luna(-1), 100, 101, 'locatar')$$,
  '%citiri_apartament_fk%',
  'citiri: apartamentul este din blocul citirii');
select throws_like(
  $$insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare, motiv_respingere)
    values (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-1), 100, 101, 'locatar', 'respinsa', '  ')$$,
  '%citiri_respinsa_motiv_check%',
  'citiri: o citire respinsa are motiv');
select throws_like(
  $$insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
    values (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-5), 100, 101, 'locatar', 'trimisa')$$,
  '%citiri_valabila_key%',
  'citiri: cel mult o citire valabila pe contor si luna');

-- O citire respinsa in luna -1 (si motivul ei), folosita mai jos.
insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare, motiv_respingere)
values (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-1), 100, 150, 'locatar', 'respinsa', 'Poza altui contor');

select is(
  (select consum from contorizare.citiri where contor_id = pg_temp.fx('c1') and luna = pg_temp.luna(-1)),
  50.000::numeric,
  'citiri: consumul este generat din cele doua indexuri');

-- =============================================================================
-- contorizare.index_anterior
-- =============================================================================

select is(contorizare.index_anterior(pg_temp.fx('c1'), pg_temp.luna()), 100.000::numeric,
  'index_anterior: ultima citire valabila, fara cea respinsa');
select is(contorizare.index_anterior(pg_temp.fx('c1'), pg_temp.luna(-5)), 0::numeric,
  'index_anterior: fara citiri anterioare intoarce 0');

-- =============================================================================
-- contorizare.transmite_citire (ca locatarul ap1)
-- =============================================================================

set local role authenticated;
select pg_temp.ca('loc1');

select throws_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap2'), pg_temp.luna(), jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c2'), 'index', 210)))$$,
  'Nu ai acces la acest apartament.',
  'transmite_citire: refuza apartamentul altcuiva');
select throws_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(-1), jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c1'), 'index', 110)))$$,
  'Se poate transmite doar indexul lunii curente.',
  'transmite_citire: refuza alta luna decat cea curenta');
select throws_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(), '[]'::jsonb)$$,
  'Scrie cel putin un index.',
  'transmite_citire: refuza lista goala');
select throws_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(), jsonb_build_object('contor_id', pg_temp.fx('c1'), 'index', 110))$$,
  'Scrie cel putin un index.',
  'transmite_citire: refuza un obiect in loc de lista');
select throws_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(), jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c2'), 'index', 210)))$$,
  'Contorul nu este al apartamentului tau.',
  'transmite_citire: refuza contorul altui apartament');
select throws_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(), jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c1'), 'index', 90)))$$,
  'Indexul nou (90) nu poate fi mai mic decat cel anterior (100.000).',
  'transmite_citire: refuza un index mai mic decat cel anterior');
select throws_like(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(), jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c1'))))$$,
  'Indexul nou (<NULL>) nu poate fi mai mic%',
  'transmite_citire: refuza un index lipsa');
select lives_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(),
      jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c1'), 'index', 110),
                        jsonb_build_object('contor_id', pg_temp.fx('c1c'), 'index', 55)),
      pg_temp.fx('bloc')::text || '/' || pg_temp.fx('ap1')::text || '/poza.jpg')$$,
  'transmite_citire: locatarul transmite ambele contoare');
select throws_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(),
      jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c1'), 'index', 111)),
      pg_temp.fx('bloc')::text || '/' || pg_temp.fx('ap2')::text || '/imprumutata.jpg')$$,
  'Poza contorului trebuie sa fie a acestui apartament.',
  '[A7] transmite_citire refuza ca dovada poza altui apartament');
select lives_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(),
      jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c1'), 'index', 112)))$$,
  'transmite_citire: o citire netrimisa inca la validare se poate corecta');
select results_eq(
  $$select tip, index_anterior, index_curent, sursa, stare, transmisa_de
    from contorizare.citiri where apartament_id = pg_temp.fx('ap1') and luna = pg_temp.luna() order by tip$$,
  $$values ('calda', 50.000::numeric(10,3), 55.000::numeric(10,3), 'locatar', 'trimisa', pg_temp.fx('loc1')),
           ('rece', 100.000::numeric(10,3), 112.000::numeric(10,3), 'locatar', 'trimisa', pg_temp.fx('loc1'))$$,
  'transmite_citire: randul vechi este inlocuit, cu indexul anterior si autorul');

reset role;
select pg_temp.serviciu();

select is(
  (select count(*)::int from evenimente.coada
    where tip = 'CitireTransmisa' and agregat_id = pg_temp.fx('ap1') and date ->> 'luna' = pg_temp.luna()::text),
  2,
  'transmite_citire: fiecare transmitere inregistreaza CitireTransmisa');

-- Fostul locatar (activ_pana ieri) nu mai are acces.
set local role authenticated;
select pg_temp.ca('fost');
select throws_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap3'), pg_temp.luna(), jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c3'), 'index', 330)))$$,
  'Nu ai acces la acest apartament.',
  'transmite_citire: fostul locatar nu mai transmite');

-- =============================================================================
-- contorizare.valideaza_citire
-- =============================================================================

select pg_temp.ca('loc1');
select throws_ok(
  $$select contorizare.valideaza_citire((select id from contorizare.citiri where contor_id = pg_temp.fx('c1') and luna = pg_temp.luna()), true)$$,
  'Citirea nu exista sau nu este din blocul tau.',
  'valideaza_citire: locatarul nu valideaza');
select pg_temp.ca('admin2');
select throws_ok(
  format('select contorizare.valideaza_citire(%L, true)',
    (select id from contorizare.citiri where contor_id = pg_temp.fx('c1') and luna = pg_temp.luna())),
  'Citirea nu exista sau nu este din blocul tau.',
  'valideaza_citire: administratorul altui bloc nu valideaza');
select pg_temp.ca('admin');
select throws_ok(
  $$select contorizare.valideaza_citire(gen_random_uuid(), true)$$,
  'Citirea nu exista sau nu este din blocul tau.',
  'valideaza_citire: citire inexistenta');
select throws_ok(
  $$select contorizare.valideaza_citire((select id from contorizare.citiri where contor_id = pg_temp.fx('c1c') and luna = pg_temp.luna()), false, '   ')$$,
  'Scrie motivul, ca locatarul sa stie ce sa corecteze.',
  'valideaza_citire: respingerea cere motiv');
select lives_ok(
  $$select contorizare.valideaza_citire((select id from contorizare.citiri where contor_id = pg_temp.fx('c1') and luna = pg_temp.luna()), true)$$,
  'valideaza_citire: administratorul accepta');
select lives_ok(
  $$select contorizare.valideaza_citire((select id from contorizare.citiri where contor_id = pg_temp.fx('c1c') and luna = pg_temp.luna()), false, '  Poza neclara ')$$,
  'valideaza_citire: administratorul respinge cu motiv');
select results_eq(
  $$select tip, stare, motiv_respingere, verificata_de, verificata_la is not null
    from contorizare.citiri where apartament_id = pg_temp.fx('ap1') and luna = pg_temp.luna() order by tip$$,
  $$values ('calda', 'respinsa', 'Poza neclara', pg_temp.fx('admin'), true),
           ('rece', 'validata', null, pg_temp.fx('admin'), true)$$,
  'valideaza_citire: starea, motivul curatat si cine a verificat');
select throws_ok(
  $$select contorizare.valideaza_citire((select id from contorizare.citiri where contor_id = pg_temp.fx('c1') and luna = pg_temp.luna()), false, 'alt motiv')$$,
  'Citirea a fost deja verificata.',
  'valideaza_citire: o citire verificata nu se mai schimba');

reset role;
select pg_temp.serviciu();
select is(
  (select date ->> 'motiv' from evenimente.coada where tip = 'CitireRespinsa' and agregat_id = pg_temp.fx('c1c') order by id desc limit 1),
  'Poza neclara',
  'valideaza_citire: respingerea inregistreaza CitireRespinsa cu motivul');

set local role authenticated;
select pg_temp.ca('loc1');
select throws_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(), jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c1'), 'index', 115)))$$,
  'Indexul pe aceasta luna a fost deja validat de administrator.',
  'transmite_citire: refuza un contor deja validat in luna');
select lives_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap1'), pg_temp.luna(), jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c1c'), 'index', 56)))$$,
  'transmite_citire: dupa respingere, locatarul retrimite');
select is(
  (select count(*)::int from contorizare.citiri where contor_id = pg_temp.fx('c1c') and luna = pg_temp.luna()),
  2,
  'transmite_citire: citirea respinsa ramane ca istoric langa cea noua');

-- =============================================================================
-- contorizare.citeste_contor_general
-- =============================================================================

select throws_ok(
  $$select contorizare.citeste_contor_general(pg_temp.fx('bloc'), pg_temp.luna(), 'rece', 1040)$$,
  'Doar administratorul blocului citeste contorul general.',
  'citeste_contor_general: locatarul nu citeste contorul general');
select pg_temp.ca('admin');
select throws_ok(
  $$select contorizare.citeste_contor_general(pg_temp.fx('bloc'), pg_temp.luna(), 'calda', 10)$$,
  'Blocul nu are contor general pentru apa calda.',
  'citeste_contor_general: blocul fara contor general de apa calda');
select throws_ok(
  $$select contorizare.citeste_contor_general(pg_temp.fx('bloc'), pg_temp.luna(), 'rece', 999)$$,
  'Indexul nou nu poate fi mai mic decat cel anterior (1000.000).',
  'citeste_contor_general: refuza indexul mai mic');
select lives_ok(
  $$select contorizare.citeste_contor_general(pg_temp.fx('bloc'), pg_temp.luna(), 'rece', 1040)$$,
  'citeste_contor_general: administratorul citeste');
select lives_ok(
  $$select contorizare.citeste_contor_general(pg_temp.fx('bloc'), pg_temp.luna(), 'rece', 1045)$$,
  'citeste_contor_general: o corectura inlocuieste citirea lunii');
select results_eq(
  $$select index_anterior, index_curent, sursa, stare, transmisa_de, verificata_de
    from contorizare.citiri where contor_id = pg_temp.fx('cg') and luna = pg_temp.luna()$$,
  $$values (1000.000::numeric(10,3), 1045.000::numeric(10,3), 'administrator', 'validata', pg_temp.fx('admin'), pg_temp.fx('admin'))$$,
  'citeste_contor_general: un singur rand, validat, cu indexul corectat');

-- =============================================================================
-- contorizare.estimeaza_citiri
-- =============================================================================

reset role;
select pg_temp.serviciu();
-- Istoric pentru ap3: 10, 6 si 9 mc in lunile -4, -3, -2.
insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
values (pg_temp.fx('c3'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap3'), pg_temp.luna(-4), 300, 310, 'locatar', 'validata'),
       (pg_temp.fx('c3'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap3'), pg_temp.luna(-3), 310, 316, 'locatar', 'validata'),
       (pg_temp.fx('c3'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap3'), pg_temp.luna(-2), 316, 325, 'locatar', 'validata');

set local role authenticated;
select pg_temp.ca('loc1');
select throws_ok(
  $$select contorizare.estimeaza_citiri(pg_temp.fx('bloc'), pg_temp.luna(-1))$$,
  'Doar administratorul blocului estimeaza citirile.',
  'estimeaza_citiri: locatarul nu estimeaza');
select pg_temp.ca('admin2');
select throws_ok(
  $$select contorizare.estimeaza_citiri(pg_temp.fx('bloc'), pg_temp.luna(-1))$$,
  'Doar administratorul blocului estimeaza citirile.',
  'estimeaza_citiri: administratorul altui bloc nu estimeaza');
select pg_temp.ca('admin');
select is(contorizare.estimeaza_citiri(pg_temp.fx('bloc'), pg_temp.luna(-1)), 4,
  'estimeaza_citiri: estimeaza cele 4 contoare de apartament fara citire valabila (contorul general nu)');
select results_eq(
  $$select index_anterior, index_curent, sursa, stare, verificata_de
    from contorizare.citiri where contor_id = pg_temp.fx('c3') and luna = pg_temp.luna(-1)$$,
  $$values (325.000::numeric(10,3), 333.333::numeric(10,3), 'estimat', 'validata', pg_temp.fx('admin'))$$,
  'estimeaza_citiri: media ultimelor trei luni validate (10, 6, 9 -> 8,333)');
select is(
  (select consum from contorizare.citiri where contor_id = pg_temp.fx('c2') and luna = pg_temp.luna(-1)),
  0.000::numeric,
  'estimeaza_citiri: fara istoric (doar pornirea) estimarea este 0');
select is(contorizare.estimeaza_citiri(pg_temp.fx('bloc'), pg_temp.luna(-1)), 0,
  'estimeaza_citiri: a doua rulare nu mai gaseste nimic de estimat');

reset role;
select pg_temp.serviciu();
select is(contorizare.estimeaza_citiri(pg_temp.fx('bloc'), pg_temp.luna(-2)), 3,
  'estimeaza_citiri: serviciul (jobul) poate estima; ap3 are deja citire in luna -2');

-- =============================================================================
-- contorizare.consum_validat
-- =============================================================================

select is(
  contorizare.consum_validat(pg_temp.fx('bloc'), pg_temp.luna()),
  jsonb_build_object('consum', jsonb_build_object(pg_temp.fx('ap1')::text, jsonb_build_object('rece', 12)),
                     'contorGeneral', jsonb_build_object('rece', 45)),
  'consum_validat: doar citirile validate (calda e doar trimisa), plus contorul general');
select is(
  contorizare.consum_validat(pg_temp.fx('bloc'), pg_temp.luna(-5)),
  '{"consum": {}, "contorGeneral": {}}'::jsonb,
  'consum_validat: indexurile de pornire nu sunt consum');

-- =============================================================================
-- contorizare.consum_mediu_bloc
-- =============================================================================

set local role authenticated;
select pg_temp.ca('strain');
select throws_ok(
  $$select * from contorizare.consum_mediu_bloc(pg_temp.fx('bloc'))$$,
  'Nu ai acces la acest bloc.',
  'consum_mediu_bloc: strainul nu vede blocul');
select pg_temp.ca('loc1');
select results_eq(
  $$select rece, calda, apartamente from contorizare.consum_mediu_bloc(pg_temp.fx('bloc')) where luna = pg_temp.luna(-4)$$,
  $$values (10.00::numeric, null::numeric, 1)$$,
  'consum_mediu_bloc: mc pe persoana, pe tip de apa (ap3: 10 mc, 1 persoana)');
select results_eq(
  $$select rece, calda, apartamente from contorizare.consum_mediu_bloc(pg_temp.fx('bloc')) where luna = pg_temp.luna(-2)$$,
  $$values (1.50::numeric, 0.00::numeric, 3)$$,
  'consum_mediu_bloc: media blocului, cu persoanele lunii (9 mc / 6 persoane)');
select is(
  (select count(*)::int from contorizare.consum_mediu_bloc(pg_temp.fx('bloc')) where luna = pg_temp.luna(-5)),
  0,
  'consum_mediu_bloc: pornirea nu apare ca luna de consum');

-- =============================================================================
-- RLS
-- =============================================================================

reset role;
select pg_temp.serviciu();
select set_config('fx.nr_citiri', (select count(*) from contorizare.citiri where bloc_id = pg_temp.fx('bloc'))::text, true);
set local role authenticated;
select pg_temp.ca('loc1');

-- "Setarile de citire se vad in bloc"
select is((select count(*)::int from contorizare.setari_contorizare), 1,
  '"Setarile de citire se vad in bloc": locatarul vede setarile blocului lui');
select pg_temp.ca('strain');
select is((select count(*)::int from contorizare.setari_contorizare), 0,
  '"Setarile de citire se vad in bloc": strainul nu vede nimic');

-- "Administratorul schimba termenul de citire"
select pg_temp.ca('loc1');
update contorizare.setari_contorizare set zi_limita_citire = 5 where bloc_id = pg_temp.fx('bloc');
select pg_temp.ca('admin2');
update contorizare.setari_contorizare set zi_limita_citire = 6 where bloc_id = pg_temp.fx('bloc');
select pg_temp.ca('admin');
update contorizare.setari_contorizare set zi_limita_citire = 20 where bloc_id = pg_temp.fx('bloc');
select is((select zi_limita_citire from contorizare.setari_contorizare where bloc_id = pg_temp.fx('bloc')), 20::smallint,
  '"Administratorul schimba termenul de citire": doar actualizarea administratorului a avut efect');
select throws_ok(
  $$update contorizare.setari_contorizare set metoda_estimare = 'medie_3_luni' where bloc_id = pg_temp.fx('bloc')$$,
  '42501', null,
  'setari_contorizare: administratorul schimba doar ziua limita (grant pe coloana)');

-- "Contoarele proprii si cele din blocurile conduse"
select is((select count(*)::int from contorizare.contoare where bloc_id = pg_temp.fx('bloc')), 6,
  '"Contoarele proprii si cele din blocurile conduse": administratorul vede toate contoarele');
select pg_temp.ca('pres');
select is((select count(*)::int from contorizare.contoare where bloc_id = pg_temp.fx('bloc')), 6,
  '"Contoarele proprii si cele din blocurile conduse": presedintele vede toate contoarele');
select pg_temp.ca('loc1');
select results_eq($$select id from contorizare.contoare order by tip$$,
  $$values (pg_temp.fx('c1c')), (pg_temp.fx('c1'))$$,
  '"Contoarele proprii si cele din blocurile conduse": locatarul vede doar contoarele lui');
select pg_temp.ca('fost');
select is((select count(*)::int from contorizare.contoare), 0,
  '"Contoarele proprii si cele din blocurile conduse": fostul locatar nu mai vede nimic');

-- "Citirile proprii si cele din blocurile conduse"
select is((select count(*)::int from contorizare.citiri), 0,
  '"Citirile proprii si cele din blocurile conduse": fostul locatar nu vede citiri');
select pg_temp.ca('loc1');
select is((select count(*)::int from contorizare.citiri where apartament_id is distinct from pg_temp.fx('ap1')), 0,
  '"Citirile proprii si cele din blocurile conduse": locatarul nu vede citirile altora');
select ok((select count(*) from contorizare.citiri) > 0,
  '"Citirile proprii si cele din blocurile conduse": locatarul isi vede citirile');
select pg_temp.ca('admin');
select is((select count(*)::int from contorizare.citiri where bloc_id = pg_temp.fx('bloc')),
  current_setting('fx.nr_citiri')::int,
  '"Citirile proprii si cele din blocurile conduse": administratorul vede tot blocul');
select ok((select count(*) from contorizare.citiri where apartament_id is null) > 0,
  '"Citirile proprii si cele din blocurile conduse": administratorul vede si contorul general');
select throws_ok(
  $$insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa)
    values (pg_temp.fx('c2'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap2'), pg_temp.luna(), 200, 201, 'administrator')$$,
  '42501', null,
  'citiri: nimeni nu scrie direct in tabela, doar prin comenzi');

-- =============================================================================
-- Bug-uri cunoscute (todo): comportamentul corect
-- =============================================================================

reset role;
select pg_temp.serviciu();
select set_config('fx.loc3', pg_temp.utilizator('Locatar Trei')::text, true);
insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), pg_temp.fx('loc3'), 'proprietar', current_date - 1);
-- Lista pe luna -3 este publicata; o citire a ap2 din acea luna asteapta inca validarea.
insert into intretinere.liste_lunare (bloc_id, luna, stare, scadenta, publicata_la, total_repartizat)
values (pg_temp.fx('bloc'), pg_temp.luna(-3), 'publicata', pg_temp.luna(-2) + 24, now(), 100);
insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
values (pg_temp.fx('c2'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap2'), pg_temp.luna(-3), 200, 203, 'locatar', 'trimisa');
-- Al doilea contor de apa rece la ap2: unul validat, celalalt doar trimis, in luna curenta.
insert into contorizare.contoare (bloc_id, apartament_id, tip, serie) values (pg_temp.fx('bloc'), pg_temp.fx('ap2'), 'rece', 'BUCATARIE');
insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
values (pg_temp.fx('c2'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap2'), pg_temp.luna(), 200, 204, 'locatar', 'validata'),
       ((select id from contorizare.contoare where serie = 'BUCATARIE' and apartament_id = pg_temp.fx('ap2')), 'rece',
        pg_temp.fx('bloc'), pg_temp.fx('ap2'), pg_temp.luna(), 0, 7, 'locatar', 'trimisa');

set local role authenticated;

-- [A2] o estimare prea mare nu mai blocheaza indexul real al lunii urmatoare
select pg_temp.ca('loc3');
select throws_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap3'), pg_temp.luna(), jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c3'), 'index', 320)))$$,
  'P0001', null,
  '[A2] sub ultima citire reala (325) indexul ramane refuzat, chiar dupa o estimare');
select lives_ok(
  $$select contorizare.transmite_citire(pg_temp.fx('ap3'), pg_temp.luna(), jsonb_build_array(jsonb_build_object('contor_id', pg_temp.fx('c3'), 'index', 330)))$$,
  '[A2] indexul real 330 (peste ultimul real 325) este acceptat, desi estimarea a urcat la 333,333');
select results_eq(
  $$select index_anterior, index_curent, consum from contorizare.citiri where contor_id = pg_temp.fx('c3') and luna = pg_temp.luna() and stare = 'trimisa'$$,
  $$values (330::numeric, 330::numeric, 0::numeric)$$,
  '[A2] citirea pleaca de la indexul real: consum 0 pe luna aceasta, lantul continua de la 330');
select pg_temp.ca('loc3');

select pg_temp.ca('admin');
select throws_ok(
  $$select contorizare.citeste_contor_general(pg_temp.fx('bloc'), pg_temp.luna(1), 'rece', 1100)$$,
  'Nu poti citi contorul general pe o luna viitoare.',
  '[A3] refuza o luna viitoare');
select throws_ok(
  $$select contorizare.citeste_contor_general(pg_temp.fx('bloc'), pg_temp.luna(-3), 'rece', 1020)$$,
  'Lista lunii ' || pg_temp.luna(-3)::text || ' este deja publicata; contorul general nu se mai poate schimba.',
  '[A3] refuza luna unei liste deja publicate');

-- O citire deja inregistrata pe luna urmatoare fixeaza plafonul de sus:
-- indexul de pe luna curenta nu poate trece de indexul de pornire al lunii
-- urmatoare, altfel consumul lunii urmatoare ar iesi negativ.
reset role;
select pg_temp.serviciu();
insert into contorizare.citiri (contor_id, tip, bloc_id, luna, index_anterior, index_curent, sursa, stare)
values (pg_temp.fx('cg'), 'rece', pg_temp.fx('bloc'), (pg_temp.luna() + interval '1 month')::date, 1045, 1050, 'administrator', 'validata');
set local role authenticated;
select pg_temp.ca('admin');
select throws_ok(
  $$select contorizare.citeste_contor_general(pg_temp.fx('bloc'), pg_temp.luna(), 'rece', 1046)$$,
  'Indexul nou (1046) nu poate fi mai mare decat indexul de pornire al lunii urmatoare (1045.000).',
  '[A3] refuza un index mai mare decat indexul de pornire al lunii urmatoare');

select throws_ok(
  $$select contorizare.index_anterior(pg_temp.fx('c1'), pg_temp.luna())$$,
  '42501', null,
  'index_anterior: functie interna, fara drept de executie pentru authenticated');

reset role;
select pg_temp.serviciu();
select is(contorizare.index_anterior(pg_temp.fx('c1c'), pg_temp.luna(1)), 50.000::numeric,
  '[A4] citirea calda doar trimisa (56) nu devine indexul anterior');
set local role authenticated;
select pg_temp.ca('admin');
select throws_ok(
  $$select contorizare.valideaza_citire((select id from contorizare.citiri where contor_id = pg_temp.fx('c2') and luna = pg_temp.luna(-3)), true)$$,
  'Lista lunii ' || pg_temp.luna(-3)::text || ' este deja publicata; citirea nu se mai poate verifica.',
  '[A4] refuza validarea unei citiri din luna unei liste publicate');

select todo('[A6] estimarea nu porneste inainte de ziua limita a citirilor', 1);
select throws_ok(
  $$select contorizare.estimeaza_citiri(pg_temp.fx('bloc'), pg_temp.luna(1))$$,
  null, null,
  '[A6] refuza estimarea inainte de termen (luna urmatoare)');

select todo('[L5] consumul apartamentului cere cate o citire validata pe fiecare contor activ', 1);
reset role;
select pg_temp.serviciu();
select is(
  contorizare.consum_validat(pg_temp.fx('bloc'), pg_temp.luna()) -> 'consum' -> (pg_temp.fx('ap2')::text),
  null,
  '[L5] ap2 cu un contor validat si unul doar trimis nu are inca consum validat');

select * from finish();
rollback;
