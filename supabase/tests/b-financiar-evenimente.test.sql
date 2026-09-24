-- Financiar, handlerele si citirea (migratia 20260919120017_financiar.sql):
-- financiar.la_lista_publicata, la_lista_recalculata, situatie_bloc, view-ul
-- fonduri_solduri, constrangerile fondurilor si toate politicile RLS.
-- Bug-uri cunoscute: F2, F4, L16 (todo).
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

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
  -- [S3] chirias mutat azi in apartamentul 2, peste platile celui dinaintea lui
  perform set_config('fx.nou', pg_temp.utilizator('Chirias Nou')::text, true);
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), pg_temp.fx('loc1'), 'proprietar', current_date - 30),
         (pg_temp.fx('ap2'), pg_temp.fx('bloc'), pg_temp.fx('loc2'), 'proprietar', current_date - 30);
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din, activ_pana)
  values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), pg_temp.fx('fost'), 'chirias', current_date - 60, current_date - 1);
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (pg_temp.fx('ap2'), pg_temp.fx('bloc'), pg_temp.fx('nou'), 'chirias', current_date);
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


-- Serverul ruleaza in UTC (audit X1, L16).
set local timezone = 'UTC';

-- Lista pe luna -1: lift 90 lei (persoane_fara_lift: 0 / 67,5 / 22,5) si fondul
-- de reparatii 100 lei (33,34 / 33,33 / 33,33). Publicata pe 31.08.2026 la 22:30 UTC,
-- adica 01:30 pe 1 septembrie, ora Romaniei.
insert into intretinere.furnizori (asociatie_id, denumire) values (pg_temp.fx('asociatie'), 'Lift SRL');
insert into intretinere.liste_lunare (bloc_id, luna, scadenta) values (pg_temp.fx('bloc'), pg_temp.luna(-1), current_date + 30);
select set_config('fx.lista', (select id from intretinere.liste_lunare where bloc_id = pg_temp.fx('bloc') and luna = pg_temp.luna(-1))::text, true);
insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda)
values (pg_temp.fx('lista'), 'factura', 'C2', 'Lift', (select id from intretinere.furnizori where asociatie_id = pg_temp.fx('asociatie')), 90, 'persoane_fara_lift'),
       (pg_temp.fx('lista'), 'fond_reparatii', 'F1', 'Fond de reparatii', null, 100, 'apartamente');

create function pg_temp.r(p_cod text, p_ap text, p_suma numeric, p_lista text default 'lista')
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'cheltuialaId', (select id from intretinere.cheltuieli where lista_id = pg_temp.fx(p_lista) and cod = p_cod),
    'apartamentId', pg_temp.fx(p_ap), 'suma', p_suma,
    'baza', jsonb_build_object('valoare', 1, 'total', 3, 'unitate', case when p_cod = 'F1' then 'apartamente' else 'persoane' end));
$$;

-- Numele lunii, cum apare in descriere.
create function pg_temp.luna_text(p date)
returns text
language sql
immutable
as $$
  select (array['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'])[extract(month from p)::int]
         || ' ' || extract(year from p)::int;
$$;

-- ap2 are un avans de 50 lei inainte de publicare.
select financiar.inregistreaza_plata(pg_temp.fx('ap2'), 50, 'transfer', now() - interval '5 days');

select set_config('fx.ev', intretinere.salveaza_lista_publicata(pg_temp.fx('lista'),
  jsonb_build_object('repartizari', jsonb_build_array(
    pg_temp.r('C2', 'ap1', 0), pg_temp.r('C2', 'ap2', 67.5), pg_temp.r('C2', 'ap3', 22.5),
    pg_temp.r('F1', 'ap1', 33.34), pg_temp.r('F1', 'ap2', 33.33), pg_temp.r('F1', 'ap3', 33.33))),
  pg_temp.fx('admin'), false, '2026-08-31 22:30:00+00')::text, true);

-- =============================================================================
-- financiar.la_lista_publicata
-- =============================================================================

select lives_ok($$select financiar.la_lista_publicata((select date from evenimente.coada where id = current_setting('fx.ev')::bigint))$$,
  'la_lista_publicata: handlerul ruleaza pe datele evenimentului');
select results_eq(
  $$select apartament_id, tip, luna, lista_id, versiune, suma, scadenta, descriere
    from financiar.datorii where lista_id = pg_temp.fx('lista') order by suma$$,
  $$select a, 'intretinere'::text, pg_temp.luna(-1), pg_temp.fx('lista'), 1::smallint, s::numeric(12,2), current_date + 30,
           'Intretinere ' || pg_temp.luna_text(pg_temp.luna(-1))
    from (values (pg_temp.fx('ap1'), 33.34), (pg_temp.fx('ap3'), 55.83), (pg_temp.fx('ap2'), 100.83)) v(a, s) order by s$$,
  'la_lista_publicata: o datorie de intretinere pe apartament, cu totalul lui si scadenta listei');
select is(
  (select sum(a.suma) from financiar.alocari_plati a join financiar.datorii d on d.id = a.datorie_id
    where d.lista_id = pg_temp.fx('lista') and d.apartament_id = pg_temp.fx('ap2')),
  50.00::numeric,
  'la_lista_publicata: avansul ap2 se aloca pe datoria noua');
select results_eq(
  $$select m.suma, m.descriere, m.lista_id, f.tip from financiar.miscari_fond m join financiar.fonduri f on f.id = m.fond_id
    where m.lista_id = pg_temp.fx('lista')$$,
  $$values (100.00::numeric(12,2), 'Contributii fond reparatii, lista pe ' || pg_temp.luna_text(pg_temp.luna(-1)), pg_temp.fx('lista'), 'reparatii'::text)$$,
  'la_lista_publicata: intrarea in fondul de reparatii');
select lives_ok($$select financiar.la_lista_publicata((select date from evenimente.coada where id = current_setting('fx.ev')::bigint))$$,
  'la_lista_publicata: a doua rulare (eveniment livrat de doua ori)...');
select results_eq(
  $$select (select count(*)::int from financiar.datorii where lista_id = pg_temp.fx('lista')),
           (select count(*)::int from financiar.miscari_fond where lista_id = pg_temp.fx('lista')),
           (select sum(suma) from financiar.alocari_plati where plata_id in (select id from financiar.plati where apartament_id = pg_temp.fx('ap2')))$$,
  $$values (3, 1, 50.00::numeric)$$,
  '...nu dubleaza datoriile, fondul sau alocarile');
select is(
  (select f.sold from financiar.fonduri_solduri f where f.bloc_id = pg_temp.fx('bloc') and f.tip = 'reparatii'),
  100.00::numeric,
  'fonduri_solduri: soldul fondului este suma miscarilor');
select is(
  (select f.sold from financiar.fonduri_solduri f where f.bloc_id = pg_temp.fx('bloc') and f.tip = 'rulment'),
  0::numeric,
  'fonduri_solduri: fondul fara miscari are sold 0');

-- O lista fara fond de reparatii, in care ap1 are total 0.
insert into intretinere.liste_lunare (bloc_id, luna, scadenta) values (pg_temp.fx('bloc'), pg_temp.luna(-2), current_date + 30);
select set_config('fx.lista2', (select id from intretinere.liste_lunare where bloc_id = pg_temp.fx('bloc') and luna = pg_temp.luna(-2))::text, true);
insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda)
values (pg_temp.fx('lista2'), 'factura', 'C2', 'Lift', (select id from intretinere.furnizori where asociatie_id = pg_temp.fx('asociatie')), 60, 'persoane_fara_lift');
select set_config('fx.ev3', intretinere.salveaza_lista_publicata(pg_temp.fx('lista2'),
  jsonb_build_object('repartizari', jsonb_build_array(
    pg_temp.r('C2', 'ap1', 0, 'lista2'), pg_temp.r('C2', 'ap2', 45, 'lista2'), pg_temp.r('C2', 'ap3', 15, 'lista2'))))::text, true);
select financiar.la_lista_publicata((select date from evenimente.coada where id = current_setting('fx.ev3')::bigint));
select results_eq(
  $$select apartament_id, suma from financiar.datorii where lista_id = pg_temp.fx('lista2') order by suma$$,
  $$values (pg_temp.fx('ap3'), 15.00::numeric(12,2)), (pg_temp.fx('ap2'), 45.00::numeric(12,2))$$,
  'la_lista_publicata: apartamentul cu total 0 nu primeste datorie');
select is((select count(*)::int from financiar.miscari_fond where lista_id = pg_temp.fx('lista2')), 0,
  'la_lista_publicata: fara fond de reparatii pe lista, nicio miscare in fond');

select is((select data from financiar.miscari_fond where lista_id = pg_temp.fx('lista')), '2026-09-01'::date,
  '[L16] publicata la 01:30 pe 1 septembrie (ora Romaniei): intrarea este pe 1 septembrie');

-- =============================================================================
-- financiar.la_lista_recalculata
-- =============================================================================

-- Liftul corectat la 120 lei, iar ap3 devine scutit: 0 / 120 / 0.
update intretinere.cheltuieli set suma = 120 where lista_id = pg_temp.fx('lista') and cod = 'C2';
select set_config('fx.ev2', intretinere.salveaza_lista_publicata(pg_temp.fx('lista'),
  jsonb_build_object('repartizari', jsonb_build_array(
    pg_temp.r('C2', 'ap1', 0), pg_temp.r('C2', 'ap2', 120), pg_temp.r('C2', 'ap3', 0),
    pg_temp.r('F1', 'ap1', 33.34), pg_temp.r('F1', 'ap2', 33.33), pg_temp.r('F1', 'ap3', 33.33))),
  null, true)::text, true);
select lives_ok($$select financiar.la_lista_recalculata((select date from evenimente.coada where id = current_setting('fx.ev2')::bigint))$$,
  'la_lista_recalculata: handlerul ruleaza pe datele evenimentului');
select results_eq(
  $$select apartament_id, suma, versiune, luna, scadenta, descriere from financiar.datorii
    where lista_id = pg_temp.fx('lista') and tip = 'corectie' order by suma$$,
  $$values (pg_temp.fx('ap3'), -22.50::numeric(12,2), 2::smallint, pg_temp.luna(-1), current_date + 30, 'Corectie dupa recalcularea listei'::text),
           (pg_temp.fx('ap2'), 52.50::numeric(12,2), 2::smallint, pg_temp.luna(-1), current_date + 30, 'Corectie dupa recalcularea listei'::text)$$,
  'la_lista_recalculata: diferenta pe apartament devine corectie (si negativa); ap1 fara diferenta nu primeste nimic');
select is((select count(*)::int from financiar.datorii where lista_id = pg_temp.fx('lista') and tip = 'intretinere'), 3,
  'la_lista_recalculata: datoriile initiale raman neatinse');
select lives_ok($$select financiar.la_lista_recalculata((select date from evenimente.coada where id = current_setting('fx.ev2')::bigint))$$,
  'la_lista_recalculata: a doua rulare...');
select is((select count(*)::int from financiar.datorii where lista_id = pg_temp.fx('lista') and tip = 'corectie'), 2,
  '...nu dubleaza corectiile');
select results_eq(
  $$select apartament_id, sold from financiar.solduri where bloc_id = pg_temp.fx('bloc') order by apartament_id$$,
  $$select v.a, v.s from (values (pg_temp.fx('ap1'), 33.34::numeric), (pg_temp.fx('ap2'), 100.83 + 45 + 52.50 - 50), (pg_temp.fx('ap3'), 55.83 + 15 - 22.50)) v(a, s) order by v.a$$,
  'solduri: corectia intra in sold, inclusiv cea negativa');

select is(
  (select rest from financiar.datorii_rest where lista_id = pg_temp.fx('lista') and apartament_id = pg_temp.fx('ap3') and tip = 'intretinere'),
  33.33::numeric,
  '[F2] ap3: intretinerea de 55,83 minus corectia de 22,50 lasa un rest de 33,33');
-- ap3 mai are o a doua datorie de intretinere (lista2, 15 lei), cu aceeasi
-- scadenta si acelasi creat_la (transactia de test are un singur now()): ca
-- alocarea sa nu depinda de ordinea aleatoare intre cele doua id-uri, platim
-- exact suma ramasa pe ambele (33.33 + 15) si verificam ca amandoua se inchid.
-- Plata e anulata cu savepoint, ca sa nu schimbe numarul platilor blocului
-- pentru testele de mai jos.
savepoint f2_plata_test;
select financiar.inregistreaza_plata(pg_temp.fx('ap3'), 48.33, 'transfer');
select is(
  (select rest from financiar.datorii_rest where lista_id = pg_temp.fx('lista') and apartament_id = pg_temp.fx('ap3') and tip = 'intretinere'),
  0.00::numeric,
  '[F2] o plata de 48,33 (33,33 + 15, nu 55,83 + 15) inchide integral datoria din lista, eliberata de corectia negativa');
select is(
  (select rest from financiar.datorii_rest where lista_id = pg_temp.fx('lista2') and apartament_id = pg_temp.fx('ap3') and tip = 'intretinere'),
  0.00::numeric,
  '[F2] ...si datoria din lista2, ramasa fara corectie');
rollback to savepoint f2_plata_test;

-- [K1] Corectia negativa pe o datorie deja platita elibereaza banii platiti in
-- plus. ap1 plateste integral intretinerea din lista (33,34 lei), are o datorie
-- noua, deschisa, pe lista3 (40 lei, scadenta mai tarzie), iar apoi lista se
-- recalculeaza cu 10 lei mai putin pentru el. Inainte, cei 10 lei ramaneau
-- blocati pe datoria veche (rest -10) si i se cereau in continuare 40 de lei.
savepoint k1_test;
insert into intretinere.liste_lunare (bloc_id, luna, scadenta) values (pg_temp.fx('bloc'), pg_temp.luna(0), current_date + 60);
select set_config('fx.lista3', (select id from intretinere.liste_lunare where bloc_id = pg_temp.fx('bloc') and luna = pg_temp.luna(0))::text, true);
insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda)
values (pg_temp.fx('lista3'), 'factura', 'C3', 'Curatenie', (select id from intretinere.furnizori where asociatie_id = pg_temp.fx('asociatie')), 60, 'apartamente');
select set_config('fx.ev_k1_pub', intretinere.salveaza_lista_publicata(pg_temp.fx('lista3'),
  jsonb_build_object('repartizari', jsonb_build_array(
    pg_temp.r('C3', 'ap1', 40, 'lista3'), pg_temp.r('C3', 'ap2', 10, 'lista3'), pg_temp.r('C3', 'ap3', 10, 'lista3'))))::text, true);
select financiar.la_lista_publicata((select date from evenimente.coada where id = current_setting('fx.ev_k1_pub')::bigint));
select financiar.inregistreaza_plata(pg_temp.fx('ap1'), 33.34, 'transfer');
select is(
  (select rest from financiar.datorii_rest where lista_id = pg_temp.fx('lista') and apartament_id = pg_temp.fx('ap1') and tip = 'intretinere'),
  0.00::numeric,
  '[K1] pregatire: plata de 33,34 inchide intretinerea din lista, cea cu scadenta mai veche');

-- Recalcularea: fondul scade la 90 de lei, iar partea lui ap1 cu 10 lei.
update intretinere.cheltuieli set suma = 90 where lista_id = pg_temp.fx('lista') and cod = 'F1';
select set_config('fx.ev_k1', intretinere.salveaza_lista_publicata(pg_temp.fx('lista'),
  jsonb_build_object('repartizari', jsonb_build_array(
    pg_temp.r('C2', 'ap1', 0), pg_temp.r('C2', 'ap2', 120), pg_temp.r('C2', 'ap3', 0),
    pg_temp.r('F1', 'ap1', 23.34), pg_temp.r('F1', 'ap2', 33.33), pg_temp.r('F1', 'ap3', 33.33))),
  null, true)::text, true);
select financiar.la_lista_recalculata((select date from evenimente.coada where id = current_setting('fx.ev_k1')::bigint));

select is(
  (select rest from financiar.datorii_rest where lista_id = pg_temp.fx('lista') and apartament_id = pg_temp.fx('ap1') and tip = 'intretinere'),
  0.00::numeric,
  '[K1] financiar.elibereaza_alocari_in_plus: datoria platita ramane inchisa, nu trece pe minus');
select is(
  (select rest from financiar.datorii_rest where lista_id = pg_temp.fx('lista3') and apartament_id = pg_temp.fx('ap1') and tip = 'intretinere'),
  30.00::numeric,
  '[K1] cei 10 lei platiti in plus scad datoria deschisa: 40 - 10 = 30');
select is(
  (select sum(a.suma) from financiar.alocari_plati a join financiar.plati p on p.id = a.plata_id where p.apartament_id = pg_temp.fx('ap1')),
  33.34::numeric,
  '[K1] plata ramane alocata integral: niciun ban creat sau pierdut, doar mutat');
select is(
  (select sum(rest) from financiar.datorii_rest where apartament_id = pg_temp.fx('ap1')),
  (select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')),
  '[K1] suma resturilor ramane egala cu soldul din registru');
select financiar.la_lista_recalculata((select date from evenimente.coada where id = current_setting('fx.ev_k1')::bigint));
select is(
  (select rest from financiar.datorii_rest where lista_id = pg_temp.fx('lista3') and apartament_id = pg_temp.fx('ap1') and tip = 'intretinere'),
  30.00::numeric,
  '[K1] evenimentul livrat de doua ori nu elibereaza banii de doua ori');
rollback to savepoint k1_test;

-- =============================================================================
-- financiar.situatie_bloc
-- =============================================================================

-- Restante scadente: ap3 are 40 lei, ap1 are 10 lei platiti.
insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere)
values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 'sold_initial', 40, current_date - 5, 'Restanta de pe hartie'),
       (pg_temp.fx('ap1'), pg_temp.fx('bloc'), 'sold_initial', 10, current_date - 5, 'Restanta de pe hartie');
select financiar.inregistreaza_plata(pg_temp.fx('ap1'), 10, 'numerar');

set local role authenticated;
select pg_temp.ca('strain');
select throws_ok($$select financiar.situatie_bloc(pg_temp.fx('bloc'))$$,
  'Nu ai acces la acest bloc.', 'situatie_bloc: strainul nu vede blocul');
select pg_temp.ca('fost');
select throws_ok($$select financiar.situatie_bloc(pg_temp.fx('bloc'))$$,
  'Nu ai acces la acest bloc.', 'situatie_bloc: fostul locatar nu mai vede blocul');
select pg_temp.ca('loc1');
select is(financiar.situatie_bloc(pg_temp.fx('bloc')),
  '{"apartamente": 3, "faraRestanta": 2, "restanteTotal": 40.00}'::jsonb,
  'situatie_bloc: doar datoriile scadente, fara nume (datoriile listei nu sunt inca scadente)');
select pg_temp.ca('admin');
select is(financiar.situatie_bloc(pg_temp.fx('bloc')) ->> 'restanteTotal', '40.00',
  'situatie_bloc: administratorul vede aceeasi situatie');

-- [K4] situatie_bloc isi calcula singura restul (suma - alocari), fara
-- corectiile negative ale listei (F2): ecranele Bloc si Sumar aratau alt
-- total restant decat ecranul Plata. ap1: intretinere scadenta de 30 de lei,
-- cu o corectie de -12 inca nescadenta; restul real este 18.
savepoint k4_test;
reset role;
insert into financiar.datorii (apartament_id, bloc_id, tip, luna, lista_id, versiune, suma, scadenta, descriere)
values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), 'intretinere', pg_temp.luna(-2), pg_temp.fx('lista2'), 1, 30, current_date - 3, 'Intretinere K4'),
       (pg_temp.fx('ap1'), pg_temp.fx('bloc'), 'corectie', pg_temp.luna(-2), pg_temp.fx('lista2'), 2, -12, current_date + 10, 'Corectie K4');
set local role authenticated;
select pg_temp.ca('admin');
select is(financiar.situatie_bloc(pg_temp.fx('bloc')) ->> 'restanteTotal', '58.00',
  '[K4] situatie_bloc: restul unei datorii scadente include corectia ei negativa (40 + 18), ca pe ecranul Plata');
rollback to savepoint k4_test;

-- =============================================================================
-- RLS
-- =============================================================================

-- Pentru politicile pe penalizari: o penalizare pe ap1 si una pe ap2 (scrise direct).
reset role;
select pg_temp.serviciu();
insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), 'penalizare', '2020-02-01', 1, '2020-02-01', 'Penalizare test'),
       (pg_temp.fx('ap2'), pg_temp.fx('bloc'), 'penalizare', '2020-02-01', 1, '2020-02-01', 'Penalizare test');
insert into financiar.penalizari (datorie_sursa_id, datorie_id, luna_calcul, rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma)
select (select id from financiar.datorii where apartament_id = p.apartament_id and tip = 'intretinere' and lista_id = pg_temp.fx('lista')),
       p.id, '2020-02-01', 10, 5, 0, 5, 0.02, 1
from financiar.datorii p where p.descriere = 'Penalizare test' and p.bloc_id = pg_temp.fx('bloc');
set local role authenticated;

-- "Contul propriu si conturile blocurilor conduse"
select pg_temp.ca('loc1');
select results_eq($$select apartament_id from financiar.conturi$$, $$values (pg_temp.fx('ap1'))$$,
  '"Contul propriu si conturile blocurilor conduse": locatarul vede doar contul lui');
select pg_temp.ca('pres');
select is((select count(*)::int from financiar.conturi), 3, '"Contul propriu si conturile blocurilor conduse": presedintele vede blocul');
select pg_temp.ca('admin');
select is((select count(*)::int from financiar.conturi), 3, '"Contul propriu si conturile blocurilor conduse": administratorul vede blocul');
select pg_temp.ca('fost');
select is((select count(*)::int from financiar.conturi), 0, '"Contul propriu si conturile blocurilor conduse": fostul locatar nu vede nimic');

-- "Regulile de bani se vad in toata asociatia"
select pg_temp.ca('loc1');
select results_eq($$select asociatie_id, chitanta_serie from financiar.setari_financiare$$, $$values (pg_temp.fx('asociatie'), 'TB'::text)$$,
  '"Regulile de bani se vad in toata asociatia": locatarul vede regulile asociatiei lui');
select pg_temp.ca('strain');
select is((select count(*)::int from financiar.setari_financiare), 0, '"Regulile de bani se vad in toata asociatia": strainul nu vede nimic');

-- "Administratorul schimba regulile de bani"
select pg_temp.ca('loc1');
update financiar.setari_financiare set zile_gratie = 1 where asociatie_id = pg_temp.fx('asociatie');
select pg_temp.ca('admin2');
update financiar.setari_financiare set zile_gratie = 2 where asociatie_id = pg_temp.fx('asociatie');
select pg_temp.ca('admin');
update financiar.setari_financiare set zile_gratie = 15 where asociatie_id = pg_temp.fx('asociatie');
select is((select zile_gratie from financiar.setari_financiare where asociatie_id = pg_temp.fx('asociatie')), 15::smallint,
  '"Administratorul schimba regulile de bani": doar administratorul asociatiei');
select throws_ok($$update financiar.setari_financiare set chitanta_ultimul_numar = 0 where asociatie_id = pg_temp.fx('asociatie')$$,
  '42501', null, 'setari_financiare: numerotarea chitantelor nu se poate schimba din API');

-- "Datoriile proprii si cele din blocurile conduse"
select pg_temp.ca('loc1');
select is((select count(*)::int from financiar.datorii where apartament_id <> pg_temp.fx('ap1')), 0,
  '"Datoriile proprii si cele din blocurile conduse": locatarul nu vede datoriile altora');
select is((select count(*)::int from financiar.datorii), 3,
  '"Datoriile proprii si cele din blocurile conduse": locatarul isi vede datoriile (intretinere, restanta, penalizare)');
select results_eq($$select apartament_id, sold from financiar.solduri$$, $$values (pg_temp.fx('ap1'), 34.34::numeric)$$,
  'solduri: view-ul respecta RLS (security_invoker)');
select pg_temp.ca('pres');
select is((select count(*)::int from financiar.datorii where bloc_id = pg_temp.fx('bloc')), 11,
  '"Datoriile proprii si cele din blocurile conduse": presedintele vede tot blocul');
select pg_temp.ca('admin2');
select is((select count(*)::int from financiar.datorii where bloc_id = pg_temp.fx('bloc')), 0,
  '"Datoriile proprii si cele din blocurile conduse": alt administrator nu vede blocul');

-- "Platile proprii si cele din blocurile conduse"
select pg_temp.ca('loc2');
select is((select count(*)::int from financiar.plati), 1, '"Platile din perioada mea si cele din blocurile conduse": locatarul vede plata lui');
select pg_temp.ca('admin');
select is((select count(*)::int from financiar.plati where bloc_id = pg_temp.fx('bloc')), 2,
  '"Platile din perioada mea si cele din blocurile conduse": administratorul vede toate platile blocului');
select pg_temp.ca('strain');
select is((select count(*)::int from financiar.plati), 0, '"Platile din perioada mea si cele din blocurile conduse": strainul nu vede plati');
-- [S3] Ce a platit un om din buzunarul lui este al lui: chiriasul mutat azi
-- nu vede platile si chitantele celui dinaintea lui, la fel ca la sesizari (K4).
-- Restul datoriilor ramane insa acelasi pentru oricine are voie sa le vada:
-- altfel datoriile platite de cel dinainte i-ar aparea ca neplatite.
select pg_temp.ca('nou');
select is(
  (select sum(rest) from financiar.datorii_rest where apartament_id = pg_temp.fx('ap2')),
  (select sum(d.suma - financiar.alocat_pe_datorie(d.id)) from financiar.datorii d where d.apartament_id = pg_temp.fx('ap2')),
  '[S3] financiar.alocat_pe_datorie: restul datoriei nu depinde de cine vede plata');
select is((select count(*)::int from financiar.plati), 0,
  '[S3] "Platile din perioada mea si cele din blocurile conduse": chiriasul mutat azi nu vede platile de dinaintea lui');
select is((select count(*)::int from financiar.chitante), 0,
  '[S3] "Chitantele se vad ca plata lor": nici chitantele lor');
select cmp_ok((select count(*)::int from financiar.datorii where apartament_id = pg_temp.fx('ap2')), '>', 0,
  '[S3] datoriile raman pe apartament: soldul se preia cu apartament cu tot');

-- "Alocarile se vad ca plata lor" si "Chitantele se vad ca plata lor"
select pg_temp.ca('loc2');
select is((select count(*)::int from financiar.alocari_plati), 1, '"Alocarile se vad ca plata lor": locatarul vede alocarea platii lui');
select is((select count(*)::int from financiar.chitante), 1, '"Chitantele se vad ca plata lor": locatarul vede chitanta lui');
select pg_temp.ca('loc1');
select is((select count(*)::int from financiar.alocari_plati a join financiar.plati p on p.id = a.plata_id), 1,
  '"Alocarile se vad ca plata lor": ap1 vede doar alocarea platii lui');
select is((select count(*)::int from financiar.chitante c where c.plata_id in (select id from financiar.plati where apartament_id = pg_temp.fx('ap2'))), 0,
  '"Chitantele se vad ca plata lor": ap1 nu vede chitanta ap2');
select pg_temp.ca('admin');
select is((select count(*)::int from financiar.chitante where asociatie_id = pg_temp.fx('asociatie')), 2,
  '"Chitantele se vad ca plata lor": administratorul vede toate chitantele');

-- "Penalizarile se vad ca datoria lor"
select is((select count(*)::int from financiar.penalizari), 2, '"Penalizarile se vad ca datoria lor": administratorul vede ambele penalizari');
select pg_temp.ca('loc1');
select results_eq($$select d.apartament_id from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_id$$,
  $$values (pg_temp.fx('ap1'))$$, '"Penalizarile se vad ca datoria lor": locatarul vede doar penalizarea lui');

-- "Fondurile se vad de tot blocul" si "Miscarile fondurilor se vad de tot blocul"
select is((select count(*)::int from financiar.fonduri), 2, '"Fondurile se vad de tot blocul": locatarul vede fondurile blocului');
select is((select count(*)::int from financiar.miscari_fond), 1, '"Miscarile fondurilor se vad de tot blocul": locatarul vede intrarea din lista');
select is((select sold from financiar.fonduri_solduri where tip = 'reparatii'), 100.00::numeric,
  'fonduri_solduri: locatarul vede soldul fondului');
select pg_temp.ca('strain');
select is((select count(*)::int from financiar.fonduri), 0, '"Fondurile se vad de tot blocul": strainul nu vede fonduri');
select is((select count(*)::int from financiar.miscari_fond), 0, '"Miscarile fondurilor se vad de tot blocul": strainul nu vede miscari');

-- "Administratorul inregistreaza iesiri din fond": politica si dreptul de insert au fost
-- scoase [F4]; fondul primeste miscari doar din publicarea listei (si, pe viitor, printr-o
-- comanda cu document obligatoriu). Toate scrierile directe sunt acum refuzate.
select pg_temp.ca('admin');
select throws_ok(
  $$insert into financiar.miscari_fond (fond_id, data, suma, descriere, creat_de)
    values ((select id from financiar.fonduri where bloc_id = pg_temp.fx('bloc') and tip = 'reparatii'), current_date, -40, 'Reparatie usa', pg_temp.fx('admin'))$$,
  '42501', null, '"Administratorul inregistreaza iesiri din fond" a fost scoasa: nici administratorul nu mai scrie direct');
select throws_ok(
  $$insert into financiar.miscari_fond (fond_id, data, suma, descriere, creat_de)
    values ((select id from financiar.fonduri where bloc_id = pg_temp.fx('bloc') and tip = 'reparatii'), current_date, -40, 'Reparatie', pg_temp.fx('pres'))$$,
  '42501', null, '"Administratorul inregistreaza iesiri din fond": creat_de trebuie sa fie chiar el');
select throws_ok(
  $$insert into financiar.miscari_fond (fond_id, data, suma, descriere, creat_de, lista_id)
    values ((select id from financiar.fonduri where bloc_id = pg_temp.fx('bloc') and tip = 'rulment'), current_date, -40, 'Reparatie', pg_temp.fx('admin'), pg_temp.fx('lista2'))$$,
  '42501', null, '"Administratorul inregistreaza iesiri din fond": nu poate lega miscarea de o lista');
select pg_temp.ca('pres');
select throws_ok(
  $$insert into financiar.miscari_fond (fond_id, data, suma, descriere, creat_de)
    values ((select id from financiar.fonduri where bloc_id = pg_temp.fx('bloc') and tip = 'reparatii'), current_date, -40, 'Reparatie', pg_temp.fx('pres'))$$,
  '42501', null, '"Administratorul inregistreaza iesiri din fond": presedintele nu scrie');
select pg_temp.ca('admin2');
select throws_ok(
  format($f$insert into financiar.miscari_fond (fond_id, data, suma, descriere, creat_de) values (%L, current_date, -40, 'Reparatie', %L)$f$,
    (select id from financiar.fonduri where bloc_id = pg_temp.fx('bloc') and tip = 'reparatii'), pg_temp.fx('admin2')),
  '42501', null, '"Administratorul inregistreaza iesiri din fond": alt administrator nu scrie in fondul blocului');
select pg_temp.ca('admin');
select is((select sold from financiar.fonduri_solduri where bloc_id = pg_temp.fx('bloc') and tip = 'reparatii'), 100.00::numeric,
  'fonduri_solduri: fara scrieri directe, soldul ramane intrarea din lista (100)');

select throws_ok(
  $$insert into financiar.miscari_fond (fond_id, data, suma, descriere, creat_de)
    values ((select id from financiar.fonduri where bloc_id = pg_temp.fx('bloc') and tip = 'reparatii'), '2020-01-01', 50000, 'Bani', pg_temp.fx('admin'))$$,
  '42501', null, '[F4] administratorul nu poate adauga +50000 lei cu data 2020-01-01');

-- =============================================================================
-- Constrangerile fondurilor
-- =============================================================================

reset role;
select pg_temp.serviciu();
select throws_like($$insert into financiar.fonduri (bloc_id, tip, denumire) values (pg_temp.fx('bloc'), 'vacanta', 'X')$$,
  '%fonduri_tip_check%', 'fonduri: tipul din lista');
select throws_like($$insert into financiar.fonduri (bloc_id, tip, denumire) values (pg_temp.fx('bloc'), 'special', ' ')$$,
  '%fonduri_denumire_check%', 'fonduri: denumirea nu e goala');
select throws_like($$insert into financiar.fonduri (bloc_id, tip, denumire) values (pg_temp.fx('bloc'), 'reparatii', 'Al doilea')$$,
  '%fonduri_bloc_tip_key%', 'fonduri: un singur fond de reparatii pe bloc');
select lives_ok($$insert into financiar.fonduri (bloc_id, tip, denumire) values (pg_temp.fx('bloc'), 'special', 'Fond acoperis'), (pg_temp.fx('bloc'), 'special', 'Fond interfon')$$,
  'fonduri: mai multe fonduri speciale');
select throws_like($$insert into financiar.miscari_fond (fond_id, data, suma, descriere) values ((select id from financiar.fonduri where bloc_id = pg_temp.fx('bloc') and tip = 'rulment'), current_date, 0, 'X')$$,
  '%miscari_fond_suma_check%', 'miscari_fond: suma nu este zero');
select throws_like($$insert into financiar.miscari_fond (fond_id, data, suma, descriere) values ((select id from financiar.fonduri where bloc_id = pg_temp.fx('bloc') and tip = 'rulment'), current_date, 1, ' ')$$,
  '%miscari_fond_descriere_check%', 'miscari_fond: descrierea nu e goala');
select throws_like($$insert into financiar.miscari_fond (fond_id, data, suma, descriere, lista_id) values ((select id from financiar.fonduri where bloc_id = pg_temp.fx('bloc') and tip = 'reparatii'), current_date, 1, 'X', pg_temp.fx('lista'))$$,
  '%miscari_fond_fond_lista_key%', 'miscari_fond: o singura intrare pe fond si lista');

select * from finish();
rollback;
