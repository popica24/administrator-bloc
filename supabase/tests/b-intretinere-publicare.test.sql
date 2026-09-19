-- Intretinere, publicarea (migratia 20260919120015_intretinere.sql):
-- intretinere.salveaza_lista_publicata, cu toate refuzurile, publicarea si
-- recalcularea (versiune noua). Rezultatul motorului este scris de mana, exact
-- cum l-ar produce supabase/functions/_shared/motor.js pentru datele de mai jos.
-- Bug cunoscut: L9 (todo). Bug nou: NOU-1 (todo).
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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


-- Date: ap1 2 pers. (scutit lift), ap2 3 pers., ap3 1 pers.
--   C1 apa rece, consum, 300 lei: contoare 10 / 15 / 20 mc, general 60 mc
--      pretMc = 5; diferenta 15 mc pe persoane: 5 / 7,5 / 2,5 -> 15 / 22,5 / 22,5 mc
--      -> 75 / 112,5 / 112,5 lei
--   C2 lift, persoane_fara_lift, 90 lei: 0 / 3 / 1 din 4 -> 0 / 67,5 / 22,5
--   F1 fond reparatii, apartamente, 100 lei: 33,33 x 3 = 99,99, rotunjirea 0,01 la ap1
insert into intretinere.furnizori (asociatie_id, denumire) values (pg_temp.fx('asociatie'), 'Furnizor Test');
select set_config('fx.furnizor', (select id from intretinere.furnizori where asociatie_id = pg_temp.fx('asociatie'))::text, true);
insert into intretinere.cheltuieli_recurente (bloc_id, tip, cod, categorie, suma, metoda, hotarare)
values (pg_temp.fx('bloc'), 'fond_reparatii', 'F1', 'Fond de reparatii', 100, 'apartamente', 'HAG 3/2026');
insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
values (pg_temp.fx('c1'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap1'), pg_temp.luna(-1), 100, 110, 'locatar', 'validata'),
       (pg_temp.fx('c2'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap2'), pg_temp.luna(-1), 200, 215, 'locatar', 'validata'),
       (pg_temp.fx('c3'), 'rece', pg_temp.fx('bloc'), pg_temp.fx('ap3'), pg_temp.luna(-1), 300, 320, 'locatar', 'validata'),
       (pg_temp.fx('cg'), 'rece', pg_temp.fx('bloc'), null, pg_temp.luna(-1), 1000, 1060, 'administrator', 'validata');
select set_config('fx.lista', intretinere.deschide_lista(pg_temp.fx('bloc'), pg_temp.luna(-1))::text, true);
insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda, tip_apa)
values (pg_temp.fx('lista'), 'factura', 'C1', 'Apa rece', pg_temp.fx('furnizor'), 300, 'consum', 'rece'),
       (pg_temp.fx('lista'), 'factura', 'C2', 'Lift', pg_temp.fx('furnizor'), 90, 'persoane_fara_lift', null);

-- Un rand din rezultatul motorului.
create function pg_temp.r(p_cod text, p_ap text, p_suma numeric, p_valoare numeric, p_total numeric, p_unitate text,
                          p_rotunjire numeric default 0, p_detaliu jsonb default null, p_lista text default 'lista')
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'cheltuialaId', (select id from intretinere.cheltuieli where lista_id = pg_temp.fx(p_lista) and cod = p_cod),
    'apartamentId', pg_temp.fx(p_ap),
    'suma', p_suma,
    'baza', jsonb_build_object('valoare', p_valoare, 'total', p_total, 'unitate', p_unitate),
    'rotunjire', p_rotunjire,
    'detaliu', p_detaliu);
$$;

-- Detaliul apei, ca in motor.
create function pg_temp.apa(p_propriu numeric, p_persoane integer, p_cota numeric)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('tip', 'rece', 'consumPropriu', p_propriu, 'contorGeneral', 60, 'sumaContoare', 45,
    'diferenta', 15, 'persoane', p_persoane, 'totalPersoane', 6, 'cotaDiferenta', p_cota, 'pretMc', 5);
$$;

-- Randurile pe apa si fond, comune versiunilor.
create function pg_temp.randuri_c1_f1()
returns jsonb
language sql
stable
as $$
  select jsonb_build_array(
    pg_temp.r('C1', 'ap1', 75, 15, 60, 'mc', 0, pg_temp.apa(10, 2, 5)),
    pg_temp.r('C1', 'ap2', 112.5, 22.5, 60, 'mc', 0, pg_temp.apa(15, 3, 7.5)),
    pg_temp.r('C1', 'ap3', 112.5, 22.5, 60, 'mc', 0, pg_temp.apa(20, 1, 2.5)),
    pg_temp.r('F1', 'ap1', 33.34, 1, 3, 'apartamente', 0.01),
    pg_temp.r('F1', 'ap2', 33.33, 1, 3, 'apartamente'),
    pg_temp.r('F1', 'ap3', 33.33, 1, 3, 'apartamente'));
$$;

-- Rezultatul corect pentru prima publicare.
create function pg_temp.rezultat_v1()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('repartizari', pg_temp.randuri_c1_f1() || jsonb_build_array(
    pg_temp.r('C2', 'ap1', 0, 0, 4, 'persoane'),
    pg_temp.r('C2', 'ap2', 67.5, 3, 4, 'persoane'),
    pg_temp.r('C2', 'ap3', 22.5, 1, 4, 'persoane')));
$$;

-- O lista doar cu fondul de reparatii (100 lei pe 3 apartamente).
create function pg_temp.rezultat_fond(p_lista text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('repartizari', jsonb_build_array(
    pg_temp.r('F1', 'ap1', 33.34, 1, 3, 'apartamente', 0.01, null, p_lista),
    pg_temp.r('F1', 'ap2', 33.33, 1, 3, 'apartamente', 0, null, p_lista),
    pg_temp.r('F1', 'ap3', 33.33, 1, 3, 'apartamente', 0, null, p_lista)));
$$;

-- =============================================================================
-- Refuzurile
-- =============================================================================

select throws_ok($$select intretinere.salveaza_lista_publicata(gen_random_uuid(), pg_temp.rezultat_v1())$$,
  'Lista nu exista.', 'salveaza_lista_publicata: lista inexistenta');

-- Un bloc inca in configurare, cu o lista si o cheltuiala.
insert into organizare.blocuri (asociatie_id, denumire, adresa, etaje) values (pg_temp.fx('asociatie'), 'Bloc B-config', 'Str. Test 3', 0);
insert into intretinere.liste_lunare (bloc_id, luna)
select id, pg_temp.luna(-1) from organizare.blocuri where asociatie_id = pg_temp.fx('asociatie') and denumire = 'Bloc B-config';
select set_config('fx.lista_config', (select l.id from intretinere.liste_lunare l join organizare.blocuri b on b.id = l.bloc_id
  where b.asociatie_id = pg_temp.fx('asociatie') and b.denumire = 'Bloc B-config')::text, true);
insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, suma, metoda) values (pg_temp.fx('lista_config'), 'fond_reparatii', 'F1', 'Fond', 10, 'apartamente');
select throws_ok($$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista_config'), '{"repartizari": []}'::jsonb)$$,
  'Blocul este inca in configurare. Lista se poate publica dupa activarea blocului.',
  'salveaza_lista_publicata: blocul in configurare nu publica');

select throws_ok($$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat_v1(), null, true)$$,
  'Doar o lista publicata se recalculeaza.', 'salveaza_lista_publicata: recalcularea cere o lista publicata');

insert into intretinere.liste_lunare (bloc_id, luna) values (pg_temp.fx('bloc'), pg_temp.luna(-4));
select throws_ok(
  $$select intretinere.salveaza_lista_publicata((select id from intretinere.liste_lunare where bloc_id = pg_temp.fx('bloc') and luna = pg_temp.luna(-4)), '{"repartizari": []}'::jsonb)$$,
  'Lista nu are nicio cheltuiala.', 'salveaza_lista_publicata: lista goala nu se publica');

select throws_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'),
      jsonb_set(pg_temp.rezultat_v1(), '{repartizari,3,suma}', '33.33'))$$,
  'Cheltuiala F1 nu este impartita corect: 99.99 lei din 100.00, pe 3 apartamente din 3.',
  'salveaza_lista_publicata: refuza o cheltuiala care nu se imparte la ban');
select throws_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat_v1() #- '{repartizari,6}')$$,
  'Cheltuiala C2 nu este impartita corect: 90.00 lei din 90.00, pe 2 apartamente din 3.',
  'salveaza_lista_publicata: refuza o cheltuiala fara randul unui apartament (chiar cu suma 0)');
select throws_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'),
      jsonb_insert(pg_temp.rezultat_v1(), '{repartizari,0}',
        jsonb_build_object('cheltuialaId', gen_random_uuid(), 'apartamentId', pg_temp.fx('ap1'), 'suma', 0,
                           'baza', jsonb_build_object('valoare', 0, 'total', 1, 'unitate', 'apartamente'))))$$,
  'Rezultatul contine randuri care nu apartin acestei liste.',
  'salveaza_lista_publicata: refuza un rand pentru o cheltuiala straina');
select throws_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'),
      jsonb_set(pg_temp.rezultat_v1(), '{repartizari,5,apartamentId}', to_jsonb(pg_temp.fx('ap21'))))$$,
  'Rezultatul contine randuri care nu apartin acestei liste.',
  'salveaza_lista_publicata: refuza un apartament din alt bloc');
select is((select count(*)::int from intretinere.repartizari where lista_id = pg_temp.fx('lista')), 0,
  'salveaza_lista_publicata: un refuz nu lasa nicio repartizare');

select todo('[NOU-1] un rand dublat care ascunde un apartament lipsa cade pe cheia unica, nu pe verificarea "impartita corect"', 1);
select throws_like(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'),
      jsonb_build_object('repartizari', pg_temp.randuri_c1_f1() || jsonb_build_array(
        pg_temp.r('C2', 'ap2', 45, 3, 4, 'persoane'),
        pg_temp.r('C2', 'ap2', 45, 3, 4, 'persoane'),
        pg_temp.r('C2', 'ap1', 0, 0, 4, 'persoane'))))$$,
  'Cheltuiala C2 nu este impartita corect%',
  '[NOU-1] ap2 de doua ori si ap3 lipsa: mesaj clar, nu eroarea bruta de unicitate');

-- =============================================================================
-- Publicarea
-- =============================================================================

select set_config('fx.ev1',
  intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat_v1(), pg_temp.fx('admin'), false, '2026-01-15 10:00:00+00')::text, true);
select results_eq(
  $$select stare, versiune, publicata_la, publicata_de, scadenta, total_repartizat, apartamente_repartizate
    from intretinere.liste_lunare where id = pg_temp.fx('lista')$$,
  $$values ('publicata'::text, 1::smallint, '2026-01-15 10:00:00+00'::timestamptz, pg_temp.fx('admin'), pg_temp.luna() + 24,
            490.00::numeric(12,2), 3::smallint)$$,
  'salveaza_lista_publicata: lista publicata, scadenta pe 25 luna urmatoare, totalul si numarul apartamentelor');
select results_eq(
  $$select apartament_id, sum(suma) from intretinere.repartizari where lista_id = pg_temp.fx('lista') and versiune = 1
    group by apartament_id order by sum(suma)$$,
  $$values (pg_temp.fx('ap1'), 108.34::numeric), (pg_temp.fx('ap3'), 168.33::numeric), (pg_temp.fx('ap2'), 213.33::numeric)$$,
  'salveaza_lista_publicata: totalul pe apartament, exact ca in motor');
select results_eq(
  $$select c.cod, r.suma, r.baza_valoare, r.baza_total, r.unitate, r.rotunjire, r.bloc_id
    from intretinere.repartizari r join intretinere.cheltuieli c on c.id = r.cheltuiala_id
    where r.lista_id = pg_temp.fx('lista') and r.apartament_id = pg_temp.fx('ap1') order by c.cod$$,
  $$values ('C1'::text, 75.00::numeric(12,2), 15.0000::numeric(12,4), 60.0000::numeric(12,4), 'mc'::text, 0.00::numeric(12,2), pg_temp.fx('bloc')),
           ('C2', 0.00, 0.0000, 4.0000, 'persoane', 0.00, pg_temp.fx('bloc')),
           ('F1', 33.34, 1.0000, 3.0000, 'apartamente', 0.01, pg_temp.fx('bloc'))$$,
  'salveaza_lista_publicata: randul RandLista cu baza, unitatea si rotunjirea (si randul cu 0 lei)');
select is(
  (select r.detaliu from intretinere.repartizari r join intretinere.cheltuieli c on c.id = r.cheltuiala_id
    where r.lista_id = pg_temp.fx('lista') and r.apartament_id = pg_temp.fx('ap2') and c.cod = 'C1'),
  pg_temp.apa(15, 3, 7.5),
  'salveaza_lista_publicata: detaliul apei se pastreaza');
select is((select count(*)::int from intretinere.repartizari where lista_id = pg_temp.fx('lista') and detaliu is null), 6,
  'salveaza_lista_publicata: randurile fara apa nu au detaliu');
select results_eq(
  $$select tip, context, agregat_id, date from evenimente.coada where id = current_setting('fx.ev1')::bigint$$,
  $$values ('ListaPublicata'::text, 'intretinere'::text, pg_temp.fx('lista'),
            jsonb_build_object('lista_id', pg_temp.fx('lista'), 'bloc_id', pg_temp.fx('bloc'), 'asociatie_id', pg_temp.fx('asociatie'),
                               'luna', pg_temp.luna(-1), 'versiune', 1, 'scadenta', pg_temp.luna() + 24))$$,
  'salveaza_lista_publicata: intoarce id-ul evenimentului ListaPublicata, cu datele pentru handlere');
select throws_ok($$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat_v1())$$,
  'Lista este deja publicata.', 'salveaza_lista_publicata: o lista publicata nu se publica a doua oara');

-- Scadenta: ziua din setarile financiare, sau cea aleasa de administrator.
update financiar.setari_financiare set zi_scadenta = 10 where asociatie_id = pg_temp.fx('asociatie');
select set_config('fx.lista2', intretinere.deschide_lista(pg_temp.fx('bloc'), pg_temp.luna(-2))::text, true);
select lives_ok($$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista2'), pg_temp.rezultat_fond('lista2'))$$,
  'salveaza_lista_publicata: lista doar cu fondul de reparatii');
select results_eq($$select scadenta, publicata_de from intretinere.liste_lunare where id = pg_temp.fx('lista2')$$,
  $$values (pg_temp.luna(-1) + 9, null::uuid)$$,
  'salveaza_lista_publicata: scadenta foloseste zi_scadenta a asociatiei (10)');
select set_config('fx.lista3', intretinere.deschide_lista(pg_temp.fx('bloc'), pg_temp.luna(-3))::text, true);
update intretinere.liste_lunare set scadenta = pg_temp.luna(-2) + 4 where id = pg_temp.fx('lista3');
select lives_ok($$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista3'), pg_temp.rezultat_fond('lista3'))$$,
  'salveaza_lista_publicata: lista cu scadenta aleasa');
select is((select scadenta from intretinere.liste_lunare where id = pg_temp.fx('lista3')), pg_temp.luna(-2) + 4,
  'salveaza_lista_publicata: scadenta aleasa de administrator ramane');

-- =============================================================================
-- Recalcularea (§7): factura de lift corectata la 120 lei
-- =============================================================================

update intretinere.cheltuieli set suma = 120 where lista_id = pg_temp.fx('lista') and cod = 'C2';
select throws_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat_v1(), null, true)$$,
  'Cheltuiala C2 nu este impartita corect: 90.00 lei din 120.00, pe 3 apartamente din 3.',
  'salveaza_lista_publicata: recalcularea verifica la fel fiecare cheltuiala');
select set_config('fx.ev2', intretinere.salveaza_lista_publicata(pg_temp.fx('lista'),
  jsonb_build_object('repartizari', pg_temp.randuri_c1_f1() || jsonb_build_array(
    pg_temp.r('C2', 'ap1', 0, 0, 4, 'persoane'),
    pg_temp.r('C2', 'ap2', 90, 3, 4, 'persoane'),
    pg_temp.r('C2', 'ap3', 30, 1, 4, 'persoane'))),
  null, true)::text, true);
select results_eq(
  $$select stare, versiune, publicata_la, publicata_de, scadenta, total_repartizat
    from intretinere.liste_lunare where id = pg_temp.fx('lista')$$,
  $$values ('publicata'::text, 2::smallint, '2026-01-15 10:00:00+00'::timestamptz, pg_temp.fx('admin'), pg_temp.luna() + 24, 520.00::numeric(12,2))$$,
  'salveaza_lista_publicata: recalcularea creste versiunea si totalul, restul listei ramane');
select results_eq(
  $$select versiune, count(*)::int, sum(suma) from intretinere.repartizari where lista_id = pg_temp.fx('lista') group by versiune order by versiune$$,
  $$values (1::smallint, 9, 490.00::numeric), (2::smallint, 9, 520.00::numeric)$$,
  'salveaza_lista_publicata: versiunea veche se pastreaza, cea noua se adauga');
select results_eq(
  $$select tip, date from evenimente.coada where id = current_setting('fx.ev2')::bigint$$,
  $$values ('ListaRecalculata'::text, jsonb_build_object('lista_id', pg_temp.fx('lista'), 'bloc_id', pg_temp.fx('bloc'), 'luna', pg_temp.luna(-1),
                                                        'versiune_veche', 1, 'versiune', 2))$$,
  'salveaza_lista_publicata: recalcularea inregistreaza ListaRecalculata cu cele doua versiuni');

-- Un apartament nou in bloc, apoi o a treia versiune pe 4 apartamente.
insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza)
values (pg_temp.fx('bloc'), '4', 2, false, 'Noul Vecin', 1);
select set_config('fx.ap4', (select id from organizare.apartamente where bloc_id = pg_temp.fx('bloc') and numar = '4')::text, true);
select lives_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'),
      jsonb_build_object('repartizari', pg_temp.randuri_c1_f1() || jsonb_build_array(
        pg_temp.r('C1', 'ap4', 0, 0, 60, 'mc'),
        pg_temp.r('F1', 'ap4', 0, 0, 3, 'apartamente'),
        pg_temp.r('C2', 'ap1', 0, 0, 4, 'persoane'),
        pg_temp.r('C2', 'ap2', 90, 3, 4, 'persoane'),
        pg_temp.r('C2', 'ap3', 30, 1, 4, 'persoane'),
        pg_temp.r('C2', 'ap4', 0, 0, 4, 'persoane'))),
      null, true)$$,
  'salveaza_lista_publicata: a treia versiune, pe 4 apartamente');
select is((select versiune from intretinere.liste_lunare where id = pg_temp.fx('lista')), 3::smallint,
  'salveaza_lista_publicata: versiunea 3');

select todo('[L9] recalcularea trebuie sa actualizeze apartamente_repartizate', 1);
select is((select apartamente_repartizate from intretinere.liste_lunare where id = pg_temp.fx('lista')), 4::smallint,
  '[L9] dupa recalcularea pe 4 apartamente, lista spune 4');

select * from finish();
rollback;
