-- Intretinere, lista in ciorna (migratia 20260919120015_intretinere.sql):
-- constrangerile, intretinere.deschide_lista, date_pentru_motor,
-- randuri_rezultat, marcheaza_factura_platita si toate politicile RLS.
-- Publicarea si recalcularea sunt in b-intretinere-publicare.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(89);

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


-- Un furnizor, o lista publicata direct (luna -3) cu o factura, pentru RLS.
insert into intretinere.furnizori (asociatie_id, denumire, metoda_implicita, tip_apa_implicit)
values (pg_temp.fx('asociatie'), 'Apa Nova Test', 'consum', 'rece');
select set_config('fx.furnizor', (select id from intretinere.furnizori where asociatie_id = pg_temp.fx('asociatie') and denumire = 'Apa Nova Test')::text, true);
insert into intretinere.liste_lunare (bloc_id, luna, stare, scadenta, publicata_la, total_repartizat)
values (pg_temp.fx('bloc'), pg_temp.luna(-3), 'publicata', pg_temp.luna(-2) + 24, now(), 90);
select set_config('fx.lista_pub', (select id from intretinere.liste_lunare where bloc_id = pg_temp.fx('bloc') and luna = pg_temp.luna(-3))::text, true);
insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda)
values (pg_temp.fx('lista_pub'), 'factura', 'C1', 'Salubritate', pg_temp.fx('furnizor'), 90, 'apartamente');
insert into intretinere.repartizari (cheltuiala_id, lista_id, versiune, apartament_id, bloc_id, suma, baza_valoare, baza_total, unitate)
select c.id, c.lista_id, 1, a.id, a.bloc_id, 30, 1, 3, 'apartamente'
from intretinere.cheltuieli c, organizare.apartamente a
where c.lista_id = pg_temp.fx('lista_pub') and a.bloc_id = pg_temp.fx('bloc');

-- =============================================================================
-- Constrangerile tabelelor
-- =============================================================================

select throws_like($$insert into intretinere.furnizori (asociatie_id, denumire) values (pg_temp.fx('asociatie'), '   ')$$,
  '%furnizori_denumire_check%', 'furnizori: denumirea nu e goala');
select throws_like($$insert into intretinere.furnizori (asociatie_id, denumire, metoda_implicita) values (pg_temp.fx('asociatie'), 'X', 'ghicit')$$,
  '%furnizori_metoda_implicita_check%', 'furnizori: metoda implicita din lista');
select throws_like($$insert into intretinere.furnizori (asociatie_id, denumire, tip_apa_implicit) values (pg_temp.fx('asociatie'), 'X', 'tiede')$$,
  '%furnizori_tip_apa_implicit_check%', 'furnizori: tipul de apa implicit rece sau calda');
select throws_like($$insert into intretinere.furnizori (asociatie_id, denumire) values (pg_temp.fx('asociatie'), 'Apa Nova Test')$$,
  '%furnizori_asociatie_denumire_key%', 'furnizori: denumirea este unica in asociatie');

select throws_like($$insert into intretinere.cheltuieli_recurente (bloc_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('bloc'), 'altceva', 'F1', 'Fond', 10, 'apartamente')$$,
  '%cheltuieli_recurente_tip_check%', 'cheltuieli_recurente: tipul fond_reparatii sau factura');
select throws_like($$insert into intretinere.cheltuieli_recurente (bloc_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('bloc'), 'fond_reparatii', ' ', 'Fond', 10, 'apartamente')$$,
  '%cheltuieli_recurente_cod_check%', 'cheltuieli_recurente: codul nu e gol');
select throws_like($$insert into intretinere.cheltuieli_recurente (bloc_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('bloc'), 'fond_reparatii', 'F1', '', 10, 'apartamente')$$,
  '%cheltuieli_recurente_categorie_check%', 'cheltuieli_recurente: categoria nu e goala');
select throws_like($$insert into intretinere.cheltuieli_recurente (bloc_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('bloc'), 'fond_reparatii', 'F1', 'Fond', 0, 'apartamente')$$,
  '%cheltuieli_recurente_suma_check%', 'cheltuieli_recurente: suma pozitiva');
select throws_like($$insert into intretinere.cheltuieli_recurente (bloc_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('bloc'), 'fond_reparatii', 'F1', 'Fond', 10, 'consum')$$,
  '%cheltuieli_recurente_metoda_check%', 'cheltuieli_recurente: fara metoda consum');

select throws_like($$insert into intretinere.liste_lunare (bloc_id, luna) values (pg_temp.fx('bloc'), pg_temp.luna(-1) + 1)$$,
  '%liste_lunare_luna_check%', 'liste_lunare: luna este prima zi a lunii');
select throws_like($$insert into intretinere.liste_lunare (bloc_id, luna, stare, scadenta, publicata_la, total_repartizat) values (pg_temp.fx('bloc'), pg_temp.luna(-4), 'arhivata', current_date, now(), 1)$$,
  '%liste_lunare_stare_check%', 'liste_lunare: starea ciorna sau publicata');
select throws_like($$insert into intretinere.liste_lunare (bloc_id, luna, versiune) values (pg_temp.fx('bloc'), pg_temp.luna(-4), 0)$$,
  '%liste_lunare_versiune_check%', 'liste_lunare: versiunea incepe de la 1');
select throws_like($$insert into intretinere.liste_lunare (bloc_id, luna) values (pg_temp.fx('bloc'), pg_temp.luna(-3))$$,
  '%liste_lunare_bloc_luna_key%', 'liste_lunare: o singura lista pe bloc si luna');
select throws_like($$insert into intretinere.liste_lunare (bloc_id, luna, stare, scadenta) values (pg_temp.fx('bloc'), pg_temp.luna(-4), 'publicata', current_date)$$,
  '%liste_lunare_publicata_check%', 'liste_lunare: o lista publicata are data, scadenta si total');

select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('lista_pub'), 'alt', 'C9', 'X', 10, 'apartamente')$$,
  '%cheltuieli_tip_check%', 'cheltuieli: tipul factura sau fond_reparatii');
select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('lista_pub'), 'fond_reparatii', ' ', 'X', 10, 'apartamente')$$,
  '%cheltuieli_cod_check%', 'cheltuieli: codul nu e gol');
select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('lista_pub'), 'fond_reparatii', 'C9', ' ', 10, 'apartamente')$$,
  '%cheltuieli_categorie_check%', 'cheltuieli: categoria nu e goala');
select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('lista_pub'), 'fond_reparatii', 'C9', 'X', -1, 'apartamente')$$,
  '%cheltuieli_suma_check%', 'cheltuieli: suma pozitiva');
select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('lista_pub'), 'fond_reparatii', 'C9', 'X', 10, 'suprafata')$$,
  '%cheltuieli_metoda_check%', 'cheltuieli: metoda cunoscuta');
select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda, tip_apa) values (pg_temp.fx('lista_pub'), 'factura', 'C9', 'X', pg_temp.fx('furnizor'), 10, 'consum', 'tiede')$$,
  '%cheltuieli_tip_apa_check%', 'cheltuieli: tipul de apa rece sau calda');
select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('lista_pub'), 'fond_reparatii', 'C1', 'X', 10, 'apartamente')$$,
  '%cheltuieli_lista_cod_key%', 'cheltuieli: codul este unic in lista');
select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda) values (pg_temp.fx('lista_pub'), 'factura', 'C9', 'Apa', pg_temp.fx('furnizor'), 10, 'consum')$$,
  '%cheltuieli_tip_apa_consum_check%', 'cheltuieli: metoda consum cere tipul de apa');
select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda, tip_apa) values (pg_temp.fx('lista_pub'), 'factura', 'C9', 'Apa', pg_temp.fx('furnizor'), 10, 'persoane', 'rece')$$,
  '%cheltuieli_tip_apa_consum_check%', 'cheltuieli: tipul de apa doar la metoda consum');
select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('lista_pub'), 'factura', 'C9', 'X', 10, 'apartamente')$$,
  '%cheltuieli_furnizor_factura_check%', 'cheltuieli: o factura are furnizor');
select throws_like($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda) values (pg_temp.fx('lista_pub'), 'fond_reparatii', 'C9', 'X', pg_temp.fx('furnizor'), 10, 'apartamente')$$,
  '%cheltuieli_fond_fara_furnizor_check%', 'cheltuieli: fondul de reparatii nu are furnizor');

select throws_like($$insert into intretinere.repartizari (cheltuiala_id, lista_id, versiune, apartament_id, bloc_id, suma, baza_valoare, baza_total, unitate)
    select c.id, c.lista_id, 2, pg_temp.fx('ap1'), pg_temp.fx('bloc'), -1, 1, 3, 'apartamente' from intretinere.cheltuieli c where c.lista_id = pg_temp.fx('lista_pub')$$,
  '%repartizari_suma_check%', 'repartizari: suma nu este negativa');
select throws_like($$insert into intretinere.repartizari (cheltuiala_id, lista_id, versiune, apartament_id, bloc_id, suma, baza_valoare, baza_total, unitate)
    select c.id, c.lista_id, 2, pg_temp.fx('ap1'), pg_temp.fx('bloc'), 1, 1, 3, 'bucati' from intretinere.cheltuieli c where c.lista_id = pg_temp.fx('lista_pub')$$,
  '%repartizari_unitate_check%', 'repartizari: unitatea din lista');
select throws_like($$insert into intretinere.repartizari (cheltuiala_id, lista_id, versiune, apartament_id, bloc_id, suma, baza_valoare, baza_total, unitate)
    select c.id, c.lista_id, 1, pg_temp.fx('ap1'), pg_temp.fx('bloc'), 1, 1, 3, 'apartamente' from intretinere.cheltuieli c where c.lista_id = pg_temp.fx('lista_pub')$$,
  '%repartizari_cheltuiala_apartament_versiune_key%', 'repartizari: un rand pe cheltuiala, apartament si versiune');
select throws_like($$insert into intretinere.repartizari (cheltuiala_id, lista_id, versiune, apartament_id, bloc_id, suma, baza_valoare, baza_total, unitate)
    select c.id, c.lista_id, 2, pg_temp.fx('ap21'), pg_temp.fx('bloc'), 1, 1, 3, 'apartamente' from intretinere.cheltuieli c where c.lista_id = pg_temp.fx('lista_pub')$$,
  '%repartizari_apartament_fk%', 'repartizari: apartamentul este din blocul listei');

-- =============================================================================
-- intretinere.deschide_lista
-- =============================================================================

insert into intretinere.cheltuieli_recurente (bloc_id, tip, cod, categorie, suma, metoda, hotarare, activa)
values (pg_temp.fx('bloc'), 'fond_reparatii', 'F1', 'Fond de reparatii', 100, 'apartamente', 'HAG 3/2026', true),
       (pg_temp.fx('bloc'), 'fond_reparatii', 'F2', 'Fond vechi', 40, 'cota', 'HAG 1/2020', false),
       (pg_temp.fx('bloc'), 'factura', 'R1', 'Abonament', 25, 'apartamente', null, true);

set local role authenticated;
select pg_temp.ca('loc1');
select throws_ok($$select intretinere.deschide_lista(pg_temp.fx('bloc'), pg_temp.luna(-1))$$,
  'Doar administratorul blocului poate incepe o lista.', 'deschide_lista: locatarul nu incepe o lista');
select pg_temp.ca('pres');
select throws_ok($$select intretinere.deschide_lista(pg_temp.fx('bloc'), pg_temp.luna(-1))$$,
  'Doar administratorul blocului poate incepe o lista.', 'deschide_lista: presedintele doar citeste');
select pg_temp.ca('admin2');
select throws_ok($$select intretinere.deschide_lista(pg_temp.fx('bloc'), pg_temp.luna(-1))$$,
  'Doar administratorul blocului poate incepe o lista.', 'deschide_lista: administratorul altui bloc nu incepe o lista');
select pg_temp.ca('admin');
select set_config('fx.lista', intretinere.deschide_lista(pg_temp.fx('bloc'), pg_temp.luna(-1))::text, true);
select results_eq(
  $$select stare, versiune, publicata_la, scadenta from intretinere.liste_lunare where id = pg_temp.fx('lista')$$,
  $$values ('ciorna'::text, 1::smallint, null::timestamptz, null::date)$$,
  'deschide_lista: lista noua este ciorna, versiunea 1');
select results_eq(
  $$select tip, cod, categorie, serie_numar, suma, metoda, furnizor_id from intretinere.cheltuieli where lista_id = pg_temp.fx('lista')$$,
  $$values ('fond_reparatii'::text, 'F1'::text, 'Fond de reparatii'::text, 'HAG 3/2026'::text, 100.00::numeric(12,2), 'apartamente'::text, null::uuid)$$,
  'deschide_lista: se copiaza doar fondul de reparatii activ, cu hotararea AG');
select is(intretinere.deschide_lista(pg_temp.fx('bloc'), pg_temp.luna(-1)), pg_temp.fx('lista'),
  'deschide_lista: a doua deschidere intoarce aceeasi lista');
select is((select count(*)::int from intretinere.cheltuieli where lista_id = pg_temp.fx('lista')), 1,
  'deschide_lista: a doua deschidere nu dubleaza cheltuielile');
reset role;
select pg_temp.serviciu();
select isnt(intretinere.deschide_lista(pg_temp.fx('bloc'), pg_temp.luna(-2)), null,
  'deschide_lista: serviciul poate incepe o lista');

-- =============================================================================
-- intretinere.date_pentru_motor
-- =============================================================================

-- Consumul validat al lunii -1: 10 / 15 / 20 mc rece, 5 mc calda la ap1, general 60.
insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
values (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-1), 100, 110, 'locatar', 'validata'),
       (pg_temp.fx('c1c'), 'calda', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-1), 50, 55, 'locatar', 'validata'),
       (pg_temp.fx('c2'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap2'), pg_temp.luna(-1), 200, 215, 'locatar', 'validata'),
       (pg_temp.fx('c3'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap3'), pg_temp.luna(-1), 300, 320, 'locatar', 'trimisa'),
       (pg_temp.fx('cg'), 'rece', pg_temp.fx('bloc'), null, pg_temp.luna(-1), 1000, 1060, 'administrator', 'validata');

set local role authenticated;
select pg_temp.ca('admin');
insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda, tip_apa)
values (pg_temp.fx('lista'), 'factura', 'C1', 'Apa rece', pg_temp.fx('furnizor'), 300, 'consum', 'rece');

select throws_ok($$select intretinere.date_pentru_motor(gen_random_uuid())$$,
  'Lista nu exista.', 'date_pentru_motor: lista inexistenta');
select is(
  intretinere.date_pentru_motor(pg_temp.fx('lista')) -> 'lista',
  jsonb_build_object('id', pg_temp.fx('lista'), 'bloc_id', pg_temp.fx('bloc'), 'luna', pg_temp.luna(-1), 'stare', 'ciorna', 'versiune', 1),
  'date_pentru_motor: antetul listei');
select is(
  intretinere.date_pentru_motor(pg_temp.fx('lista')) -> 'apartamente',
  jsonb_build_array(
    jsonb_build_object('id', pg_temp.fx('ap1'), 'numar', '1', 'persoane', 2, 'cota', 30, 'scutitLift', true),
    jsonb_build_object('id', pg_temp.fx('ap2'), 'numar', '2', 'persoane', 3, 'cota', 30, 'scutitLift', false),
    jsonb_build_object('id', pg_temp.fx('ap3'), 'numar', '3', 'persoane', 1, 'cota', 40, 'scutitLift', false)),
  'date_pentru_motor: apartamentele, in ordinea numarului, cu persoanele lunii si numarul (R2: motorul desparte egalitatile de rest dupa numar)');
select is(
  intretinere.date_pentru_motor(pg_temp.fx('lista')) -> 'cheltuieli',
  (select jsonb_agg(jsonb_build_object('id', id, 'cod', cod, 'suma', suma, 'metoda', metoda, 'tipApa', tip_apa) order by cod)
     from intretinere.cheltuieli where lista_id = pg_temp.fx('lista')),
  'date_pentru_motor: cheltuielile listei, in ordinea codului');
select is(
  intretinere.date_pentru_motor(pg_temp.fx('lista')) -> 'consum',
  jsonb_build_object(pg_temp.fx('ap1')::text, jsonb_build_object('rece', 10, 'calda', 5), pg_temp.fx('ap2')::text, jsonb_build_object('rece', 15)),
  'date_pentru_motor: consumul validat (ap3 are doar o citire trimisa)');
select is(
  intretinere.date_pentru_motor(pg_temp.fx('lista')) -> 'contorGeneral',
  '{"rece": 60}'::jsonb,
  'date_pentru_motor: contorul general');
select pg_temp.ca('loc1');
select throws_ok($$select intretinere.date_pentru_motor(pg_temp.fx('lista_pub'))$$,
  'Doar administratorul blocului poate calcula lista.', 'date_pentru_motor: locatarul nu calculeaza lista');
select pg_temp.ca('admin2');
select throws_ok($$select intretinere.date_pentru_motor(pg_temp.fx('lista'))$$,
  'Doar administratorul blocului poate calcula lista.', 'date_pentru_motor: administratorul altui bloc nu o calculeaza');
reset role;
select pg_temp.serviciu();
select is(intretinere.date_pentru_motor(pg_temp.fx('lista')) #>> '{lista,stare}', 'ciorna',
  'date_pentru_motor: serviciul (publica-lista) citeste datele');

-- =============================================================================
-- intretinere.randuri_rezultat
-- =============================================================================

select results_eq(
  $$select * from intretinere.randuri_rezultat(jsonb_build_object('repartizari', jsonb_build_array(
      jsonb_build_object('cheltuialaId', '00000000-0000-0000-0000-00000000000a', 'apartamentId', '00000000-0000-0000-0000-00000000000b',
        'suma', 75.004, 'baza', jsonb_build_object('valoare', 15.00001, 'total', 60, 'unitate', 'mc'),
        'rotunjire', 0.01, 'detaliu', jsonb_build_object('tip', 'rece', 'pretMc', 5)),
      jsonb_build_object('cheltuialaId', '00000000-0000-0000-0000-00000000000c', 'apartamentId', '00000000-0000-0000-0000-00000000000b',
        'suma', 33.33, 'baza', jsonb_build_object('valoare', 1, 'total', 3, 'unitate', 'apartamente'), 'detaliu', null))))$$,
  $$values ('00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000b'::uuid, 75.00::numeric(12,2),
            15.0000::numeric(12,4), 60.0000::numeric(12,4), 'mc'::text, 0.01::numeric(12,2), '{"tip": "rece", "pretMc": 5}'::jsonb),
           ('00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000b'::uuid, 33.33::numeric(12,2),
            1.0000::numeric(12,4), 3.0000::numeric(12,4), 'apartamente'::text, 0.00::numeric(12,2), null::jsonb)$$,
  'randuri_rezultat: JSON-ul motorului devine randuri tipizate, rotunjirea lipsa este 0, detaliul null ramane null');
select is((select count(*)::int from intretinere.randuri_rezultat('{"repartizari": []}'::jsonb)), 0,
  'randuri_rezultat: fara repartizari, fara randuri');

-- =============================================================================
-- intretinere.marcheaza_factura_platita
-- =============================================================================

set local role authenticated;
select pg_temp.ca('loc1');
select throws_ok(
  $$select intretinere.marcheaza_factura_platita((select id from intretinere.cheltuieli where lista_id = pg_temp.fx('lista_pub') and cod = 'C1'), true)$$,
  'Factura nu exista sau nu este din blocul tau.', 'marcheaza_factura_platita: locatarul nu marcheaza');
select pg_temp.ca('admin2');
select throws_ok(
  format('select intretinere.marcheaza_factura_platita(%L, true)', (select id from intretinere.cheltuieli where lista_id = pg_temp.fx('lista') and cod = 'C1')),
  'Factura nu exista sau nu este din blocul tau.', 'marcheaza_factura_platita: administratorul altui bloc nu marcheaza');
select pg_temp.ca('admin');
select throws_ok(
  $$select intretinere.marcheaza_factura_platita((select id from intretinere.cheltuieli where lista_id = pg_temp.fx('lista') and cod = 'F1'), true)$$,
  'Factura nu exista sau nu este din blocul tau.', 'marcheaza_factura_platita: randul de fond nu este o factura');
select lives_ok(
  $$select intretinere.marcheaza_factura_platita((select id from intretinere.cheltuieli where lista_id = pg_temp.fx('lista_pub') and cod = 'C1'), true)$$,
  'marcheaza_factura_platita: merge si dupa publicare');
select is((select achitata_furnizor_la from intretinere.cheltuieli where lista_id = pg_temp.fx('lista_pub') and cod = 'C1'), current_date,
  'marcheaza_factura_platita: data platii este azi');
select lives_ok(
  $$select intretinere.marcheaza_factura_platita((select id from intretinere.cheltuieli where lista_id = pg_temp.fx('lista_pub') and cod = 'C1'), false)$$,
  'marcheaza_factura_platita: se poate anula');
select is((select achitata_furnizor_la from intretinere.cheltuieli where lista_id = pg_temp.fx('lista_pub') and cod = 'C1'), null,
  'marcheaza_factura_platita: anularea sterge data');

-- =============================================================================
-- RLS
-- =============================================================================

-- "Furnizorii se vad in asociatie"
select pg_temp.ca('loc1');
select is((select count(*)::int from intretinere.furnizori), 1, '"Furnizorii se vad in asociatie": locatarul vede furnizorul asociatiei');
select pg_temp.ca('strain');
select is((select count(*)::int from intretinere.furnizori), 0, '"Furnizorii se vad in asociatie": strainul nu vede furnizori');
select pg_temp.ca('admin2');
select is((select count(*)::int from intretinere.furnizori where asociatie_id = pg_temp.fx('asociatie')), 0,
  '"Furnizorii se vad in asociatie": alta asociatie nu vede furnizorii');

-- "Administratorul adauga furnizori"
select throws_ok($$insert into intretinere.furnizori (asociatie_id, denumire) values (pg_temp.fx('asociatie'), 'Intrus SRL')$$,
  '42501', null, '"Administratorul adauga furnizori": administratorul altei asociatii este refuzat');
select pg_temp.ca('loc1');
select throws_ok($$insert into intretinere.furnizori (asociatie_id, denumire) values (pg_temp.fx('asociatie'), 'Intrus SRL')$$,
  '42501', null, '"Administratorul adauga furnizori": locatarul este refuzat');
select pg_temp.ca('admin');
select lives_ok($$insert into intretinere.furnizori (asociatie_id, denumire, cui) values (pg_temp.fx('asociatie'), 'Lift Service', 'RO1')$$,
  '"Administratorul adauga furnizori": administratorul adauga');

-- "Administratorul modifica furnizori"
update intretinere.furnizori set cui = 'RO2' where denumire = 'Lift Service';
select pg_temp.ca('loc1');
update intretinere.furnizori set cui = 'RO3' where denumire = 'Lift Service';
select pg_temp.ca('admin');
select is((select cui from intretinere.furnizori where denumire = 'Lift Service' and asociatie_id = pg_temp.fx('asociatie')), 'RO2',
  '"Administratorul modifica furnizori": doar modificarea administratorului are efect');

-- "Cheltuielile recurente se vad de conducere"
select is((select count(*)::int from intretinere.cheltuieli_recurente), 3, '"Cheltuielile recurente se vad de conducere": administratorul');
select pg_temp.ca('pres');
select is((select count(*)::int from intretinere.cheltuieli_recurente), 3, '"Cheltuielile recurente se vad de conducere": presedintele');
select pg_temp.ca('loc1');
select is((select count(*)::int from intretinere.cheltuieli_recurente), 0, '"Cheltuielile recurente se vad de conducere": nu si locatarul');

-- "Administratorul adauga cheltuieli recurente"
select pg_temp.ca('pres');
select throws_ok($$insert into intretinere.cheltuieli_recurente (bloc_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('bloc'), 'fond_reparatii', 'F3', 'Fond', 10, 'apartamente')$$,
  '42501', null, '"Administratorul adauga cheltuieli recurente": presedintele este refuzat');
select pg_temp.ca('admin');
select lives_ok($$insert into intretinere.cheltuieli_recurente (bloc_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('bloc'), 'fond_reparatii', 'F3', 'Fond', 10, 'apartamente')$$,
  '"Administratorul adauga cheltuieli recurente": administratorul adauga');

-- "Administratorul modifica cheltuieli recurente"
update intretinere.cheltuieli_recurente set suma = 120 where cod = 'F1';
select pg_temp.ca('pres');
update intretinere.cheltuieli_recurente set suma = 999 where cod = 'F1';
select pg_temp.ca('admin');
select is((select suma from intretinere.cheltuieli_recurente where cod = 'F1'), 120.00::numeric(12,2),
  '"Administratorul modifica cheltuieli recurente": doar modificarea administratorului are efect');
select is((select suma from intretinere.cheltuieli where lista_id = pg_temp.fx('lista') and cod = 'F1'), 100.00::numeric(12,2),
  'cheltuieli_recurente: schimbarea sumei nu atinge lista deja deschisa');

-- "Listele: conducerea le vede pe toate, locatarii doar publicate"
select is((select count(*)::int from intretinere.liste_lunare), 3, '"Listele: conducerea le vede pe toate, locatarii doar publicate": administratorul vede si ciornele');
select pg_temp.ca('pres');
select is((select count(*)::int from intretinere.liste_lunare), 3, '"Listele: conducerea le vede pe toate, locatarii doar publicate": presedintele vede si ciornele');
select pg_temp.ca('loc1');
select results_eq($$select id from intretinere.liste_lunare$$, $$values (pg_temp.fx('lista_pub'))$$,
  '"Listele: conducerea le vede pe toate, locatarii doar publicate": locatarul vede doar lista publicata');
select pg_temp.ca('fost');
select is((select count(*)::int from intretinere.liste_lunare), 0, '"Listele: conducerea le vede pe toate, locatarii doar publicate": fostul locatar nu vede nimic');

-- "Administratorul schimba scadenta cat timp lista e ciorna"
select pg_temp.ca('loc1');
update intretinere.liste_lunare set scadenta = current_date + 1 where id = pg_temp.fx('lista_pub');
select pg_temp.ca('admin');
update intretinere.liste_lunare set scadenta = pg_temp.luna() + 9 where id = pg_temp.fx('lista');
update intretinere.liste_lunare set scadenta = current_date + 99 where id = pg_temp.fx('lista_pub');
select results_eq($$select scadenta from intretinere.liste_lunare where id in (pg_temp.fx('lista'), pg_temp.fx('lista_pub')) order by luna$$,
  $$values (pg_temp.luna(-2) + 24), (pg_temp.luna() + 9)$$,
  '"Administratorul schimba scadenta cat timp lista e ciorna": doar pe ciorna, doar administratorul');
select throws_ok($$update intretinere.liste_lunare set stare = 'publicata' where id = pg_temp.fx('lista')$$,
  '42501', null, 'liste_lunare: administratorul nu poate publica direct (grant doar pe scadenta)');

-- "Cheltuielile se vad ca lista lor"
select pg_temp.ca('loc1');
select results_eq($$select lista_id, cod from intretinere.cheltuieli$$, $$values (pg_temp.fx('lista_pub'), 'C1'::text)$$,
  '"Cheltuielile se vad ca lista lor": locatarul vede doar cheltuielile listelor publicate');
select pg_temp.ca('strain');
select is((select count(*)::int from intretinere.cheltuieli), 0, '"Cheltuielile se vad ca lista lor": strainul nu vede nimic');
select pg_temp.ca('admin');
select is((select count(*)::int from intretinere.cheltuieli where lista_id = pg_temp.fx('lista')), 2,
  '"Cheltuielile se vad ca lista lor": administratorul vede ciorna');

-- "Administratorul adauga cheltuieli in lista ciorna"
select throws_ok($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('lista_pub'), 'fond_reparatii', 'C7', 'X', 10, 'apartamente')$$,
  '42501', null, '"Administratorul adauga cheltuieli in lista ciorna": nu intr-o lista publicata');
select lives_ok($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda) values (pg_temp.fx('lista'), 'factura', 'C2', 'Lift', pg_temp.fx('furnizor'), 90, 'persoane_fara_lift')$$,
  '"Administratorul adauga cheltuieli in lista ciorna": in ciorna, da');
select pg_temp.ca('pres');
select throws_ok($$insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('lista'), 'fond_reparatii', 'C8', 'X', 10, 'apartamente')$$,
  '42501', null, '"Administratorul adauga cheltuieli in lista ciorna": presedintele este refuzat');

-- "Administratorul modifica cheltuieli in lista ciorna"
update intretinere.cheltuieli set suma = 1 where lista_id = pg_temp.fx('lista') and cod = 'C2';
select pg_temp.ca('admin');
update intretinere.cheltuieli set suma = 95 where lista_id = pg_temp.fx('lista') and cod = 'C2';
update intretinere.cheltuieli set suma = 1 where lista_id = pg_temp.fx('lista_pub') and cod = 'C1';
select results_eq($$select suma from intretinere.cheltuieli where cod in ('C1', 'C2') and lista_id in (pg_temp.fx('lista'), pg_temp.fx('lista_pub')) order by cod desc, suma desc$$,
  $$values (95.00::numeric(12,2)), (300.00::numeric(12,2)), (90.00::numeric(12,2))$$,
  '"Administratorul modifica cheltuieli in lista ciorna": doar in ciorna, doar administratorul');

-- "Administratorul sterge cheltuieli din lista ciorna"
delete from intretinere.cheltuieli where lista_id = pg_temp.fx('lista_pub') and cod = 'C1';
select pg_temp.ca('pres');
delete from intretinere.cheltuieli where lista_id = pg_temp.fx('lista') and cod = 'C2';
select pg_temp.ca('admin');
select is((select count(*)::int from intretinere.cheltuieli where lista_id in (pg_temp.fx('lista'), pg_temp.fx('lista_pub'))), 4,
  '"Administratorul sterge cheltuieli din lista ciorna": nimic sters din lista publicata sau de presedinte');
delete from intretinere.cheltuieli where lista_id = pg_temp.fx('lista') and cod = 'C2';
select is((select count(*)::int from intretinere.cheltuieli where lista_id = pg_temp.fx('lista')), 2,
  '"Administratorul sterge cheltuieli din lista ciorna": administratorul sterge din ciorna');

-- "Repartizarile: apartamentul propriu si blocurile conduse"
select is((select count(*)::int from intretinere.repartizari), 3, '"Repartizarile: apartamentul propriu si blocurile conduse": administratorul vede tot blocul');
select pg_temp.ca('pres');
select is((select count(*)::int from intretinere.repartizari), 3, '"Repartizarile: apartamentul propriu si blocurile conduse": presedintele vede tot blocul');
select pg_temp.ca('loc1');
select results_eq($$select apartament_id from intretinere.repartizari$$, $$values (pg_temp.fx('ap1'))$$,
  '"Repartizarile: apartamentul propriu si blocurile conduse": locatarul vede doar randul lui');
select pg_temp.ca('strain');
select is((select count(*)::int from intretinere.repartizari), 0, '"Repartizarile: apartamentul propriu si blocurile conduse": strainul nu vede nimic');
select throws_ok($$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), '{"repartizari": []}'::jsonb)$$,
  '42501', null, 'salveaza_lista_publicata: doar service_role o poate apela');

select * from finish();
rollback;
