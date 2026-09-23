-- Financiar, platile (migratia 20260919120017_financiar.sql): constrangerile
-- registrului, financiar.deschide_cont, aloca_plata, aloca_avansuri,
-- emite_chitanta (numerotare fara goluri), inregistreaza_plata,
-- inregistreaza_incasare
-- (idempotenta) si view-urile datorii_rest si solduri.
-- Bug nou: NOU-2 (todo).
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

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


-- Datoriile de pornire: ap1 are o restanta veche de 100 si intretinere de 200,
-- ap2 intretinere de 150. ap3 nu datoreaza nimic.
insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), 'sold_initial', null, 100, pg_temp.luna(-3) + 24, 'Restanta de pe hartie'),
       (pg_temp.fx('ap1'), pg_temp.fx('bloc'), 'intretinere', pg_temp.luna(-2), 200, pg_temp.luna(-1) + 24, 'Intretinere luna -2'),
       (pg_temp.fx('ap2'), pg_temp.fx('bloc'), 'intretinere', pg_temp.luna(-2), 150, pg_temp.luna(-1) + 24, 'Intretinere luna -2');
select set_config('fx.d_vechi', (select id from financiar.datorii where apartament_id = pg_temp.fx('ap1') and tip = 'sold_initial')::text, true);
select set_config('fx.d_nou', (select id from financiar.datorii where apartament_id = pg_temp.fx('ap1') and tip = 'intretinere')::text, true);

-- =============================================================================
-- financiar.deschide_cont (trigger pe organizare.apartamente)
-- =============================================================================

select results_eq(
  $$select apartament_id, bloc_id from financiar.conturi where bloc_id = pg_temp.fx('bloc') order by apartament_id$$,
  $$select id, bloc_id from organizare.apartamente where bloc_id = pg_temp.fx('bloc') order by id$$,
  'financiar.deschide_cont: fiecare apartament nou primeste contul lui');
select lives_ok(
  $$insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza) values (pg_temp.fx('bloc2'), '2', 0, 'Alt Vecin', 1)$$,
  'financiar.deschide_cont: apartamentul se insereaza, contul se deschide in aceeasi tranzactie');
select is((select count(*)::int from financiar.conturi c join organizare.apartamente a on a.id = c.apartament_id
            where a.bloc_id = pg_temp.fx('bloc2') and a.numar = '2'), 1,
  'financiar.deschide_cont: contul apartamentului nou exista');

-- =============================================================================
-- Constrangerile registrului
-- =============================================================================

select throws_like($$update financiar.setari_financiare set procent_penalizare_zi = 0.21 where asociatie_id = pg_temp.fx('asociatie')$$,
  '%setari_financiare_procent_penalizare_zi_check%', 'setari_financiare: plafonul legal de 0,2% pe zi');
select throws_like($$update financiar.setari_financiare set zile_gratie = -1 where asociatie_id = pg_temp.fx('asociatie')$$,
  '%setari_financiare_zile_gratie_check%', 'setari_financiare: zilele de gratie nu sunt negative');
select throws_like($$update financiar.setari_financiare set zi_scadenta = 29 where asociatie_id = pg_temp.fx('asociatie')$$,
  '%setari_financiare_zi_scadenta_check%', 'setari_financiare: ziua scadentei intre 1 si 28');
select throws_like($$update financiar.setari_financiare set chitanta_serie = ' ' where asociatie_id = pg_temp.fx('asociatie')$$,
  '%setari_financiare_chitanta_serie_check%', 'setari_financiare: seria chitantei nu e goala');
select throws_like($$update financiar.setari_financiare set chitanta_ultimul_numar = -1 where asociatie_id = pg_temp.fx('asociatie')$$,
  '%setari_financiare_chitanta_ultimul_numar_check%', 'setari_financiare: numarul chitantei nu e negativ');

select throws_like($$insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere) values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 'amenda', 10, current_date, 'X')$$,
  '%datorii_tip_check%', 'datorii: tipul din lista');
select throws_like($$insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere) values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 'intretinere', current_date - extract(day from current_date)::int + 2, 10, current_date, 'X')$$,
  '%datorii_luna_check%', 'datorii: luna este prima zi a lunii');
select throws_like($$insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere) values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 'intretinere', 10, current_date, '  ')$$,
  '%datorii_descriere_check%', 'datorii: descrierea nu e goala');
select throws_like($$insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere) values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 'intretinere', -5, current_date, 'X')$$,
  '%datorii_suma_check%', 'datorii: o datorie obisnuita este pozitiva');
select throws_like($$insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere) values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 'corectie', 0, current_date, 'X')$$,
  '%datorii_suma_check%', 'datorii: o corectie nu este zero');
-- J12: o corectie negativa are nevoie de o datorie de intretinere sora,
-- aceeasi lista_id (nu doar amandoua fara ea: null = null nu se potriveste
-- niciodata) si acelasi apartament — o lista dedicata, ca sa nu interfereze
-- cu lista pe luna(-4) folosita mai jos pentru testul de unicitate.
insert into intretinere.liste_lunare (bloc_id, luna, stare, scadenta, publicata_la, total_repartizat)
values (pg_temp.fx('bloc2'), pg_temp.luna(-6), 'publicata', current_date, now(), 5);
select lives_ok(
  $$insert into financiar.datorii (apartament_id, bloc_id, tip, luna, lista_id, versiune, suma, scadenta, descriere)
    select pg_temp.fx('ap21'), pg_temp.fx('bloc2'), 'intretinere', pg_temp.luna(-6), id, 1, 5, current_date, 'Intretinere sora, pentru corectie test'
    from intretinere.liste_lunare where bloc_id = pg_temp.fx('bloc2') and luna = pg_temp.luna(-6)$$,
  'datorii: pregatire, datoria de intretinere sora a corectiei de mai jos');
select lives_ok(
  $$insert into financiar.datorii (apartament_id, bloc_id, tip, luna, lista_id, versiune, suma, scadenta, descriere)
    select pg_temp.fx('ap21'), pg_temp.fx('bloc2'), 'corectie', pg_temp.luna(-6), id, 1, -5, current_date, 'Corectie test'
    from intretinere.liste_lunare where bloc_id = pg_temp.fx('bloc2') and luna = pg_temp.luna(-6)$$,
  'datorii: o corectie poate fi negativa');
-- [K15] Trigger-ul J12 pazea doar randul de corectie: stergerea sau mutarea
-- datoriei-sora refacea exact corectia orfana pe care J12 o interzice.
savepoint k15_test;
select throws_ok(
  $$delete from financiar.datorii where apartament_id = pg_temp.fx('ap21') and tip = 'intretinere' and luna = pg_temp.luna(-6)$$,
  'Datoria de intretinere are o corectie negativa pe aceeasi lista; fara ea, corectia ar ramane orfana.',
  '[K15] financiar.pazeste_sora_corectiei: datoria-sora a unei corectii negative nu se sterge');
select throws_ok(
  $$update financiar.datorii set lista_id = null where apartament_id = pg_temp.fx('ap21') and tip = 'intretinere' and luna = pg_temp.luna(-6)$$,
  'Datoria de intretinere are o corectie negativa pe aceeasi lista; fara ea, corectia ar ramane orfana.',
  '[K15] ...si nu se muta de pe lista ei');
select lives_ok(
  $$update financiar.datorii set descriere = 'Intretinere sora, descriere noua' where apartament_id = pg_temp.fx('ap21') and tip = 'intretinere' and luna = pg_temp.luna(-6)$$,
  '[K15] o modificare care nu o desparte de corectie ramane permisa');
insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
values (pg_temp.fx('ap21'), pg_temp.fx('bloc2'), 'intretinere', pg_temp.luna(-7), 3, current_date, 'Fara corectie');
select lives_ok(
  $$delete from financiar.datorii where apartament_id = pg_temp.fx('ap21') and descriere = 'Fara corectie'$$,
  '[K15] o datorie de intretinere fara corectie negativa se poate sterge, ca inainte');
rollback to savepoint k15_test;
select throws_like($$insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere) values (pg_temp.fx('ap21'), pg_temp.fx('bloc'), 'intretinere', 10, current_date, 'X')$$,
  '%datorii_cont_fk%', 'datorii: contul si blocul trebuie sa se potriveasca');
insert into intretinere.liste_lunare (bloc_id, luna, stare, scadenta, publicata_la, total_repartizat)
values (pg_temp.fx('bloc2'), pg_temp.luna(-4), 'publicata', current_date, now(), 10);
insert into financiar.datorii (apartament_id, bloc_id, tip, luna, lista_id, versiune, suma, scadenta, descriere)
select pg_temp.fx('ap21'), pg_temp.fx('bloc2'), 'intretinere', pg_temp.luna(-4), id, 1, 10, current_date, 'Intretinere'
from intretinere.liste_lunare where bloc_id = pg_temp.fx('bloc2') and luna = pg_temp.luna(-4);
select throws_like($$insert into financiar.datorii (apartament_id, bloc_id, tip, luna, lista_id, versiune, suma, scadenta, descriere)
    select pg_temp.fx('ap21'), pg_temp.fx('bloc2'), 'intretinere', pg_temp.luna(-4), id, 1, 10, current_date, 'Intretinere'
    from intretinere.liste_lunare where bloc_id = pg_temp.fx('bloc2') and luna = pg_temp.luna(-4)$$,
  '%datorii_lista_versiune_apartament_tip_key%', 'datorii: o singura datorie pe lista, versiune, apartament si tip');

select throws_like($$insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare) values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 0, 'numerar', 'rambursata')$$,
  '%plati_suma_check%', 'plati: suma pozitiva');
select throws_like($$insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare) values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 1, 'card', 'rambursata')$$,
  '%plati_metoda_check%', 'plati: metoda este numerar sau transfer');
select throws_like($$insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare) values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 1, 'numerar', 'pierduta')$$,
  '%plati_stare_check%', 'plati: starea din lista');
select throws_like($$insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare) values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 1, 'numerar', 'confirmata')$$,
  '%plati_confirmata_check%', 'plati: o plata confirmata are data confirmarii');
select throws_like($$insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare) values (pg_temp.fx('ap21'), pg_temp.fx('bloc'), 1, 'numerar', 'rambursata')$$,
  '%plati_cont_fk%', 'plati: contul si blocul trebuie sa se potriveasca');

-- =============================================================================
-- financiar.aloca_plata
-- =============================================================================

insert into financiar.plati (id, apartament_id, bloc_id, suma, metoda, stare)
values ('00000000-0000-0000-0000-0000000000b1', pg_temp.fx('ap1'), pg_temp.fx('bloc'), 250, 'transfer', 'rambursata');
select lives_ok($$select financiar.aloca_plata('00000000-0000-0000-0000-0000000000b1')$$, 'aloca_plata: o plata neconfirmata nu se aloca');
select is((select count(*)::int from financiar.alocari_plati where plata_id = '00000000-0000-0000-0000-0000000000b1'), 0,
  'aloca_plata: nicio alocare pentru plata neconfirmata');
select lives_ok($$select financiar.aloca_plata(gen_random_uuid())$$, 'aloca_plata: plata inexistenta nu face nimic');

update financiar.plati set stare = 'confirmata', confirmata_la = now() - interval '3 days' where id = '00000000-0000-0000-0000-0000000000b1';
select financiar.aloca_plata('00000000-0000-0000-0000-0000000000b1');
select results_eq(
  $$select datorie_id, suma from financiar.alocari_plati where plata_id = '00000000-0000-0000-0000-0000000000b1' order by suma$$,
  $$values (pg_temp.fx('d_vechi'), 100.00::numeric(12,2)), (pg_temp.fx('d_nou'), 150.00::numeric(12,2))$$,
  'aloca_plata: intai cea mai veche scadenta, apoi restul pe urmatoarea');
select financiar.aloca_plata('00000000-0000-0000-0000-0000000000b1');
select is((select sum(suma) from financiar.alocari_plati where plata_id = '00000000-0000-0000-0000-0000000000b1'), 250.00::numeric,
  'aloca_plata: a doua rulare nu aloca nimic in plus');
select throws_like($$insert into financiar.alocari_plati (plata_id, datorie_id, suma) values ('00000000-0000-0000-0000-0000000000b1', pg_temp.fx('d_nou'), 1)$$,
  '%alocari_plati_plata_datorie_key%', 'alocari_plati: o alocare pe plata si datorie');
select throws_like($$insert into financiar.alocari_plati (plata_id, datorie_id, suma) values ('00000000-0000-0000-0000-0000000000b1', (select id from financiar.datorii where apartament_id = pg_temp.fx('ap2')), 0)$$,
  '%alocari_plati_suma_check%', 'alocari_plati: suma pozitiva');

-- Plata mai mare decat datoriile: restul ramane avans.
insert into financiar.plati (id, apartament_id, bloc_id, suma, metoda, stare, confirmata_la)
values ('00000000-0000-0000-0000-0000000000b2', pg_temp.fx('ap1'), pg_temp.fx('bloc'), 90, 'transfer', 'confirmata', now() - interval '2 days');
select financiar.aloca_plata('00000000-0000-0000-0000-0000000000b2');
select results_eq(
  $$select datorie_id, suma from financiar.alocari_plati where plata_id = '00000000-0000-0000-0000-0000000000b2'$$,
  $$values (pg_temp.fx('d_nou'), 50.00::numeric(12,2))$$,
  'aloca_plata: acopera doar cat mai este de plata; 40 lei raman avans');

-- =============================================================================
-- Views datorii_rest si solduri
-- =============================================================================

select results_eq(
  $$select id, rest from financiar.datorii_rest where apartament_id = pg_temp.fx('ap1') order by scadenta$$,
  $$values (pg_temp.fx('d_vechi'), 0.00::numeric), (pg_temp.fx('d_nou'), 0.00::numeric)$$,
  'datorii_rest: restul fiecarei datorii se calculeaza din alocari');
select results_eq(
  $$select apartament_id, sold from financiar.solduri where bloc_id = pg_temp.fx('bloc') order by sold$$,
  $$values (pg_temp.fx('ap1'), -40.00::numeric), (pg_temp.fx('ap3'), 0::numeric), (pg_temp.fx('ap2'), 150.00::numeric)$$,
  'solduri: datoriile minus platile confirmate; avansul apare negativ');

-- =============================================================================
-- financiar.aloca_avansuri
-- =============================================================================

insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), 'intretinere', pg_temp.luna(-1), 30, pg_temp.luna() + 24, 'Intretinere luna -1');
select financiar.aloca_avansuri(pg_temp.fx('ap1'));
select results_eq(
  $$select a.plata_id, a.suma from financiar.alocari_plati a join financiar.datorii d on d.id = a.datorie_id
    where d.apartament_id = pg_temp.fx('ap1') and d.luna = pg_temp.luna(-1)$$,
  $$values ('00000000-0000-0000-0000-0000000000b2'::uuid, 30.00::numeric(12,2))$$,
  'aloca_avansuri: avansul acopera datoria noua');

-- Doua avansuri: se consuma intai cel confirmat mai devreme.
insert into financiar.plati (id, apartament_id, bloc_id, suma, metoda, stare, confirmata_la)
values ('00000000-0000-0000-0000-0000000000b4', pg_temp.fx('ap3'), pg_temp.fx('bloc'), 50, 'transfer', 'confirmata', now() - interval '1 day'),
       ('00000000-0000-0000-0000-0000000000b3', pg_temp.fx('ap3'), pg_temp.fx('bloc'), 50, 'transfer', 'confirmata', now() - interval '2 days');
insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
values (pg_temp.fx('ap3'), pg_temp.fx('bloc'), 'intretinere', pg_temp.luna(-1), 70, pg_temp.luna() + 24, 'Intretinere luna -1');
select financiar.aloca_avansuri(pg_temp.fx('ap3'));
select results_eq(
  $$select a.plata_id, a.suma from financiar.alocari_plati a join financiar.plati p on p.id = a.plata_id
    where p.apartament_id = pg_temp.fx('ap3') order by a.plata_id$$,
  $$values ('00000000-0000-0000-0000-0000000000b3'::uuid, 50.00::numeric(12,2)), ('00000000-0000-0000-0000-0000000000b4'::uuid, 20.00::numeric(12,2))$$,
  'aloca_avansuri: avansurile se folosesc in ordinea confirmarii');
select lives_ok($$select financiar.aloca_avansuri(pg_temp.fx('ap2'))$$, 'aloca_avansuri: fara avans nu face nimic');

-- =============================================================================
-- financiar.emite_chitanta
-- =============================================================================

select set_config('fx.ch1', financiar.emite_chitanta('00000000-0000-0000-0000-0000000000b1')::text, true);
select results_eq(
  $$select asociatie_id, serie, numar, emisa_la from financiar.chitante where id = pg_temp.fx('ch1')$$,
  $$select pg_temp.fx('asociatie'), 'TB'::text, 42, confirmata_la from financiar.plati where id = '00000000-0000-0000-0000-0000000000b1'$$,
  'emite_chitanta: urmatorul numar din serie (41 + 1), cu data confirmarii');
select is(financiar.emite_chitanta('00000000-0000-0000-0000-0000000000b1'), pg_temp.fx('ch1'),
  'emite_chitanta: a doua cerere intoarce aceeasi chitanta');
select is((select chitanta_ultimul_numar from financiar.setari_financiare where asociatie_id = pg_temp.fx('asociatie')), 42,
  'emite_chitanta: a doua cerere nu consuma un numar');
select throws_ok(
  $$select case when financiar.emite_chitanta('00000000-0000-0000-0000-0000000000b2') is not null then 1 / (random() * 0)::int end$$,
  '22012', null,
  'emite_chitanta: o tranzactie anulata dupa emitere...');
select set_config('fx.ch2', financiar.emite_chitanta('00000000-0000-0000-0000-0000000000b2')::text, true);
select is((select numar from financiar.chitante where id = pg_temp.fx('ch2')), 43,
  'emite_chitanta: ...nu lasa gol in numerotare (43 urmeaza dupa 42)');
select throws_like($$insert into financiar.chitante (asociatie_id, plata_id, serie, numar, emisa_la) values (pg_temp.fx('asociatie'), '00000000-0000-0000-0000-0000000000b3', 'TB', 43, now())$$,
  '%chitante_asociatie_serie_numar_key%', 'chitante: numarul este unic pe serie');
select throws_like($$insert into financiar.chitante (asociatie_id, plata_id, serie, numar, emisa_la) values (pg_temp.fx('asociatie'), '00000000-0000-0000-0000-0000000000b1', 'TB', 99, now())$$,
  '%chitante_plata_key%', 'chitante: o singura chitanta pe plata');
select throws_like($$insert into financiar.chitante (asociatie_id, plata_id, serie, numar, emisa_la) values (pg_temp.fx('asociatie'), '00000000-0000-0000-0000-0000000000b3', 'TB', 0, now())$$,
  '%chitante_numar_check%', 'chitante: numarul este pozitiv');

-- O asociatie fara setari financiare.
delete from financiar.setari_financiare where asociatie_id = pg_temp.fx('asociatie2');
insert into financiar.plati (id, apartament_id, bloc_id, suma, metoda, stare, confirmata_la)
values ('00000000-0000-0000-0000-0000000000b5', pg_temp.fx('ap21'), pg_temp.fx('bloc2'), 10, 'numerar', 'confirmata', now());
select throws_ok($$select financiar.emite_chitanta('00000000-0000-0000-0000-0000000000b5')$$,
  'Asociatia nu are setarile financiare completate.', 'emite_chitanta: refuza fara setari financiare');

-- =============================================================================
-- financiar.inregistreaza_plata
-- =============================================================================

select throws_ok($$select financiar.inregistreaza_plata(gen_random_uuid(), 10, 'transfer')$$,
  'Apartamentul nu are cont.', 'inregistreaza_plata: apartamentul fara cont');
select throws_ok($$select financiar.inregistreaza_plata(pg_temp.fx('ap2'), 0, 'transfer')$$,
  'Suma trebuie sa fie mai mare decat zero.', 'inregistreaza_plata: suma zero');
select throws_ok($$select financiar.inregistreaza_plata(pg_temp.fx('ap2'), -3, 'transfer')$$,
  'Suma trebuie sa fie mai mare decat zero.', 'inregistreaza_plata: suma negativa');
select throws_ok($$select financiar.inregistreaza_plata(pg_temp.fx('ap2'), null, 'transfer')$$,
  'Suma trebuie sa fie mai mare decat zero.', 'inregistreaza_plata: suma lipsa');

select set_config('fx.p_transfer', financiar.inregistreaza_plata(pg_temp.fx('ap2'), 100.456, 'transfer', '2026-02-03 08:00:00+00',
  pg_temp.fx('loc2'), null)::text, true);
select results_eq(
  $$select suma, metoda, stare, creat_la, confirmata_la, platita_de, inregistrata_de
    from financiar.plati where id = pg_temp.fx('p_transfer')$$,
  $$values (100.46::numeric(12,2), 'transfer'::text, 'confirmata'::text, '2026-02-03 08:00:00+00'::timestamptz, '2026-02-03 08:00:00+00'::timestamptz,
            pg_temp.fx('loc2'), null::uuid)$$,
  'inregistreaza_plata: plata confirmata, rotunjita la ban, cu data ei');
select is((select sum(suma) from financiar.alocari_plati where plata_id = pg_temp.fx('p_transfer')), 100.46::numeric,
  'inregistreaza_plata: plata se aloca pe datorie');
select results_eq($$select serie, numar, emisa_la from financiar.chitante where plata_id = pg_temp.fx('p_transfer')$$,
  $$values ('TB'::text, 44, '2026-02-03 08:00:00+00'::timestamptz)$$,
  'inregistreaza_plata: chitanta cu numarul urmator');
select is(
  (select date from evenimente.coada where tip = 'PlataConfirmata' and date ->> 'plata_id' = pg_temp.fx('p_transfer')::text),
  jsonb_build_object('plata_id', pg_temp.fx('p_transfer'), 'apartament_id', pg_temp.fx('ap2'), 'bloc_id', pg_temp.fx('bloc'), 'suma', 100.46, 'metoda', 'transfer'),
  'inregistreaza_plata: evenimentul PlataConfirmata');

select throws_ok($$select financiar.inregistreaza_plata(pg_temp.fx('ap2'), 0.004, 'transfer')$$,
  'Suma trebuie sa fie mai mare decat zero.', '[NOU-2] 0,004 lei este refuzat ca suma zero');

-- =============================================================================
-- financiar.inregistreaza_incasare
-- =============================================================================

set local role authenticated;
select pg_temp.ca('loc2');
select throws_ok($$select financiar.inregistreaza_incasare(pg_temp.fx('ap2'), 10, 'numerar')$$,
  'Doar administratorul blocului inregistreaza incasari.', 'inregistreaza_incasare: locatarul nu inregistreaza');
select pg_temp.ca('pres');
select throws_ok($$select financiar.inregistreaza_incasare(pg_temp.fx('ap2'), 10, 'numerar')$$,
  'Doar administratorul blocului inregistreaza incasari.', 'inregistreaza_incasare: presedintele nu inregistreaza');
select pg_temp.ca('admin2');
select throws_ok($$select financiar.inregistreaza_incasare(pg_temp.fx('ap2'), 10, 'numerar')$$,
  'Doar administratorul blocului inregistreaza incasari.', 'inregistreaza_incasare: administratorul altui bloc nu inregistreaza');
select pg_temp.ca('admin');
select throws_ok($$select financiar.inregistreaza_incasare(pg_temp.fx('ap2'), 0, 'numerar')$$,
  'Suma trebuie sa fie mai mare decat zero.', 'inregistreaza_incasare: suma zero');
select set_config('fx.p_cash', financiar.inregistreaza_incasare(pg_temp.fx('ap2'), 49.54, 'numerar')::text, true);
select results_eq(
  $$select suma, metoda, stare, platita_de, inregistrata_de from financiar.plati where id = pg_temp.fx('p_cash')$$,
  $$values (49.54::numeric(12,2), 'numerar'::text, 'confirmata'::text, null::uuid, pg_temp.fx('admin'))$$,
  'inregistreaza_incasare: plata cash, inregistrata de administrator');
select results_eq($$select serie, numar from financiar.chitante where plata_id = pg_temp.fx('p_cash')$$,
  $$values ('TB'::text, 45)$$, 'inregistreaza_incasare: chitanta emisa imediat');
select throws_ok($$select financiar.inregistreaza_incasare(pg_temp.fx('ap2'), 10, 'card')$$,
  'Banii primiti sunt fie in numerar, fie prin transfer bancar.', 'inregistreaza_incasare: alta metoda este refuzata');
select throws_ok($$select financiar.inregistreaza_incasare(pg_temp.fx('ap2'), 10, null)$$,
  'Banii primiti sunt fie in numerar, fie prin transfer bancar.', 'inregistreaza_incasare: metoda lipsa este refuzata');
select throws_ok($$select financiar.aloca_plata(pg_temp.fx('p_cash'))$$,
  '42501', null, 'financiar: functiile interne nu se pot apela din API');
reset role;
select pg_temp.serviciu();
select is((select sold from financiar.solduri where apartament_id = pg_temp.fx('ap2')), 0.00::numeric,
  'solduri: ap2 a platit tot (150 = 100,46 + 49,54)');

-- Chitantele raman numerotate fara goluri pe toata asociatia
select results_eq($$select numar from financiar.chitante where asociatie_id = pg_temp.fx('asociatie') order by numar$$,
  $$values (42), (43), (44), (45)$$,
  'chitante: numerotare continua, fara goluri, pe toata asociatia');

select * from finish();
rollback;
