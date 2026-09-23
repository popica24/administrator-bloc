-- K7 (audit 3): o penalizare deja calculata nu se anula cand o recalculare a
-- listei scadea datoria pe care fusese calculata. Totalul depindea de ordine:
-- penalizari apoi corectie lasa penalizarea pe o datorie ajunsa la 0; corectie
-- apoi penalizari da 0. Aceeasi stare finala, doua rezultate.
--
-- Decizia (21 septembrie, varianta A): penalizarea se recalculeaza pe datoria
-- corectata, cu parametrii inghetati la calcul, ca si cum lista ar fi fost
-- corecta de la inceput. Diferenta intra in registru ca "anulare_penalizare",
-- un rand negativ legat de penalizarea lui, vizibil locatarului. Doar in jos:
-- o corectie care mareste datoria nu mareste retroactiv penalizarea.
--
-- Fixture: ap1 datoreaza 300 de lei pe lista, cu scadenta acum 50 de zile;
-- 0,2% pe zi (plafonul legal), fara zile de gratie: penalizarea este 30 de lei.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

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

create function pg_temp.fx(p_cheie text)
returns uuid
language sql
stable
as $$
  select current_setting('fx.' || p_cheie)::uuid;
$$;

-- Rezultatul motorului pentru C1: p1 la ap1, p2 la ap2.
create function pg_temp.rezultat(p1 numeric, p2 numeric)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('repartizari', jsonb_build_array(
    jsonb_build_object('cheltuialaId', c.id, 'apartamentId', pg_temp.fx('ap1'), 'suma', p1,
      'baza', jsonb_build_object('valoare', 1, 'total', 2, 'unitate', 'apartamente')),
    jsonb_build_object('cheltuialaId', c.id, 'apartamentId', pg_temp.fx('ap2'), 'suma', p2,
      'baza', jsonb_build_object('valoare', 1, 'total', 2, 'unitate', 'apartamente'))))
  from intretinere.cheltuieli c where c.lista_id = pg_temp.fx('lista') and c.cod = 'C1';
$$;

-- Recalculeaza lista la p1 / p2 si proceseaza evenimentul.
create function pg_temp.recalculeaza(p1 numeric, p2 numeric)
returns void
language plpgsql
as $$
declare
  v_ev bigint;
begin
  update intretinere.cheltuieli set suma = p1 + p2 where lista_id = pg_temp.fx('lista') and cod = 'C1';
  v_ev := intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat(p1, p2), null, true);
  perform financiar.la_lista_recalculata((select date from evenimente.coada where id = v_ev));
end;
$$;

create function pg_temp.rest(p_id uuid)
returns numeric
language sql
stable
as $$
  select rest from financiar.datorii_rest where id = p_id;
$$;

create function pg_temp.anulari()
returns numeric
language sql
stable
as $$
  select coalesce(sum(suma), 0) from financiar.datorii
  where tip = 'anulare_penalizare' and anuleaza_datorie_id = pg_temp.fx('pen');
$$;

do $$
declare
  v_r jsonb;
  v_bloc uuid;
  v_id uuid;
  v_ev bigint;
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test K7', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TK7'),
    'bloc', jsonb_build_object('denumire', 'Bloc K7', 'adresa', 'Str. Test K7', 'etaje', 0)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;
  update financiar.setari_financiare set procent_penalizare_zi = 0.2, zile_gratie = 0
    where asociatie_id = (v_r ->> 'asociatie_id')::uuid;
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '1', 0, 'Ion Unu', 50) returning id into v_id;
  perform set_config('fx.ap1', v_id::text, true);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '2', 0, 'Ana Doi', 50) returning id into v_id;
  perform set_config('fx.ap2', v_id::text, true);
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (pg_temp.fx('ap1'), pg_temp.luna(-5), 1), (pg_temp.fx('ap2'), pg_temp.luna(-5), 1);
  perform organizare.activeaza_bloc(v_bloc);

  insert into intretinere.furnizori (asociatie_id, denumire) values ((v_r ->> 'asociatie_id')::uuid, 'Curatenie SRL');
  insert into intretinere.liste_lunare (bloc_id, luna, scadenta) values (v_bloc, pg_temp.luna(-1), current_date + 30);
  perform set_config('fx.lista', (select id from intretinere.liste_lunare where bloc_id = v_bloc and luna = pg_temp.luna(-1))::text, true);
  insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda)
  values (pg_temp.fx('lista'), 'factura', 'C1', 'Curatenie',
          (select id from intretinere.furnizori where asociatie_id = (v_r ->> 'asociatie_id')::uuid), 300, 'apartamente');

  v_ev := intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat(300, 0));
  perform financiar.la_lista_publicata((select date from evenimente.coada where id = v_ev));
  update financiar.datorii set scadenta = current_date - 50 where lista_id = pg_temp.fx('lista') and tip = 'intretinere';
  perform set_config('fx.intr', (select id from financiar.datorii where lista_id = pg_temp.fx('lista') and tip = 'intretinere')::text, true);

  perform financiar.calculeaza_penalizari(current_date);
  perform set_config('fx.pen', (select datorie_id from financiar.penalizari where datorie_sursa_id = pg_temp.fx('intr'))::text, true);
  -- Penalizarea s-a calculat ieri; recalcularea vine azi.
  update financiar.penalizari set creat_la = now() - interval '1 day' where datorie_sursa_id = pg_temp.fx('intr');
end;
$$;

select is((select suma from financiar.datorii where id = pg_temp.fx('pen')), 30.00::numeric,
  '[K7] pregatire: 300 lei, 50 de zile, 0,2% pe zi: penalizarea este 30 de lei');

-- -----------------------------------------------------------------------------
-- Recalcularea in jos anuleaza partea de penalizare care nu mai are baza
-- -----------------------------------------------------------------------------
savepoint scade;
select pg_temp.recalculeaza(200, 100);
select results_eq(
  $$select suma, anuleaza_datorie_id, descriere from financiar.datorii
    where tip = 'anulare_penalizare' and apartament_id = pg_temp.fx('ap1')$$,
  $$values (-10.00::numeric(12,2), pg_temp.fx('pen'), 'Penalizare anulata dupa recalcularea listei'::text)$$,
  '[K7] financiar.anuleaza_penalizari_in_plus: datoria scade la 200, penalizarea corecta e 20, deci se anuleaza 10');
select is(pg_temp.rest(pg_temp.fx('pen')), 20.00::numeric, '[K7] restul penalizarii este cel corect, 20');
select is((select rest from financiar.datorii_rest where anuleaza_datorie_id = pg_temp.fx('pen')), 0.00::numeric,
  '[K7] anularea nu are rest propriu: se scade din penalizarea ei');
select is(
  (select sum(rest) from financiar.datorii_rest where apartament_id = pg_temp.fx('ap1')),
  (select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')),
  '[K7] suma resturilor ramane egala cu soldul din registru');

select financiar.la_lista_recalculata((select date from evenimente.coada where tip = 'ListaRecalculata' order by id desc limit 1));
select is(pg_temp.anulari(), -10.00::numeric, '[K7] evenimentul livrat de doua ori nu anuleaza de doua ori');

select pg_temp.recalculeaza(0, 300);
select is(pg_temp.anulari(), -30.00::numeric, '[K7] a doua recalculare, la 0: se anuleaza inca 20, deci toata penalizarea');
select is(pg_temp.rest(pg_temp.fx('pen')), 0.00::numeric, '[K7] o datorie ajunsa la 0 nu mai are penalizare');
rollback to savepoint scade;

-- -----------------------------------------------------------------------------
-- Aceeasi stare finala, acelasi rezultat, oricare ar fi ordinea
-- -----------------------------------------------------------------------------
savepoint ordine;
select pg_temp.recalculeaza(0, 300);
select is(pg_temp.rest(pg_temp.fx('pen')), 0.00::numeric,
  '[K7] penalizari apoi corectie la 0: penalizarea ajunge la 0, ca in ordinea inversa');
rollback to savepoint ordine;

-- -----------------------------------------------------------------------------
-- O penalizare deja platita: banii anulati se elibereaza, ca la K1
-- -----------------------------------------------------------------------------
savepoint platita;
select financiar.inregistreaza_plata(pg_temp.fx('ap1'), 330, 'transfer');
select is(pg_temp.rest(pg_temp.fx('pen')), 0.00::numeric, '[K7] pregatire: plata de 330 acopera intretinerea si penalizarea');
select pg_temp.recalculeaza(200, 100);
select is(pg_temp.rest(pg_temp.fx('pen')), 0.00::numeric,
  '[K7] financiar.elibereaza_alocari_datoriei: penalizarea platita nu trece pe minus dupa anulare');
select is(pg_temp.rest(pg_temp.fx('intr')), 0.00::numeric, '[K7] ...nici intretinerea (K1)');
select is(
  (select sum(a.suma) from financiar.alocari_plati a join financiar.plati p on p.id = a.plata_id where p.apartament_id = pg_temp.fx('ap1')),
  220.00::numeric,
  '[K7] din 330, raman alocati 220 (200 intretinere, 20 penalizare): 110 se elibereaza');
select is((select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')), -110.00::numeric,
  '[K7] ...si raman avans al apartamentului');
-- [B6] Chitanta are numar si se pune la dosar: ce scrie pe ea nu se schimba
-- dupa ce o recalculare muta banii de pe o datorie pe alta.
select results_eq(
  $$select r ->> 'tip', (r ->> 'suma')::numeric
      from financiar.chitante c, jsonb_array_elements(c.randuri) r
     where c.plata_id = (select id from financiar.plati where apartament_id = pg_temp.fx('ap1') order by creat_la desc limit 1)$$,
  $$values ('intretinere'::text, 300.00::numeric), ('penalizare'::text, 30.00::numeric)$$,
  '[B6] chitanta pastreaza randurile de la emitere, desi alocarile s-au schimbat');
rollback to savepoint platita;

-- -----------------------------------------------------------------------------
-- [B1] O corectura in sus, apoi una in jos sub suma initiala
-- -----------------------------------------------------------------------------
-- Auditul 4: corectiile negative erau scazute toate din randul de intretinere,
-- fara sa fie compensate cu cele pozitive. Lista urca la 700 (corectie +400) si
-- coboara la 100 (corectie -600): intretinerea ramanea cu rest -300, iar
-- corectia de +400 cu rest 400, desi omul datoreaza 100. Plata lui se ducea pe
-- corectie, restul negativ nu se mai putea consuma niciodata (aloca_plata sare
-- peste rest <= 0), iar penalizarile urmatoare se calculau pe 400.
savepoint sus_apoi_jos;
select pg_temp.recalculeaza(700, 0);
select pg_temp.recalculeaza(100, 600);
select is(pg_temp.rest(pg_temp.fx('intr')), 100.00::numeric,
  '[B1] reducerea se scade intai din corectia pe care o anuleaza; pe intretinere ramane datoria reala');
select is(
  (select rest from financiar.datorii_rest
    where lista_id = pg_temp.fx('lista') and apartament_id = pg_temp.fx('ap1') and tip = 'corectie' and suma > 0),
  0.00::numeric,
  '[B1] corectia pozitiva anulata de una negativa nu mai cere nimic');
select is(
  (select sum(rest) from financiar.datorii_rest where apartament_id = pg_temp.fx('ap1')),
  (select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')),
  '[B1] suma resturilor ramane egala cu soldul din registru');
-- datoria ramane pe randul de intretinere, cu scadenta lui: penalizarea se
-- recalculeaza pe 100 de lei (10 lei in loc de 30), deci soldul este 110
select is((select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')), 110.00::numeric,
  '[B1] soldul este datoria reala plus penalizarea ei recalculata');
select financiar.inregistreaza_plata(pg_temp.fx('ap1'),
  (select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')), 'numerar');
select is(
  (select sum(rest) from financiar.datorii_rest where apartament_id = pg_temp.fx('ap1')),
  0.00::numeric,
  '[B1] plata soldului real inchide tot, fara rand ramas pe ecran');
rollback to savepoint sus_apoi_jos;

-- -----------------------------------------------------------------------------
-- [B3] Datoria nu a scazut, doar s-a mutat de pe un rand pe altul
-- -----------------------------------------------------------------------------
-- Auditul 4: K7 se uita doar la penalizarile calculate pe randul de
-- intretinere si scadea din baza lor toate corectiile negative de dupa calcul,
-- fara sa tina cont de cele pozitive. Lista urca la 700, corectia de +400
-- primeste si ea penalizare, apoi lista coboara inapoi la 300: datoria reala a
-- fost 300 tot timpul, dar penalizarea intretinerii era taiata ca si cum ar fi
-- fost 0, iar penalizarea corectiei ramanea neatinsa.
savepoint mutata;
select pg_temp.recalculeaza(700, 0);
update financiar.datorii set scadenta = current_date - 20
  where tip = 'corectie' and suma > 0 and lista_id = pg_temp.fx('lista') and apartament_id = pg_temp.fx('ap1');
select financiar.calculeaza_penalizari(current_date);
select set_config('fx.pen_cor', (select p.datorie_id from financiar.penalizari p
  join financiar.datorii d on d.id = p.datorie_sursa_id
  where d.tip = 'corectie' and d.lista_id = pg_temp.fx('lista') and d.apartament_id = pg_temp.fx('ap1'))::text, true);
select cmp_ok((select suma from financiar.datorii where id = pg_temp.fx('pen_cor')), '>', 0::numeric,
  '[B3] pregatire: corectia in sus, ajunsa scadenta, primeste si ea penalizare');
select pg_temp.recalculeaza(300, 400);
select is(financiar.baza_dupa_corectii(pg_temp.fx('intr')), 300.00::numeric,
  '[B3] financiar.baza_dupa_corectii: datoria de baza a ramas intreaga, corectiile s-au anulat intre ele');
select is(pg_temp.rest(pg_temp.fx('pen_cor')), 0.00::numeric,
  '[B3] corectia anulata isi pierde penalizarea');
select is(pg_temp.rest(pg_temp.fx('pen')), 30.00::numeric,
  '[B3] ...iar penalizarea datoriei care nu s-a schimbat ramane intreaga');
select is(
  (select sum(rest) from financiar.datorii_rest where apartament_id = pg_temp.fx('ap1')),
  (select sold from financiar.solduri where apartament_id = pg_temp.fx('ap1')),
  '[B3] suma resturilor ramane egala cu soldul din registru');
rollback to savepoint mutata;

-- -----------------------------------------------------------------------------
-- Doar in jos
-- -----------------------------------------------------------------------------
savepoint creste;
select pg_temp.recalculeaza(400, 0);
select is(pg_temp.anulari(), 0::numeric, '[K7] o corectie care mareste datoria nu atinge penalizarea deja calculata');
select is(pg_temp.rest(pg_temp.fx('pen')), 30.00::numeric, '[K7] ...care ramane 30');
rollback to savepoint creste;

-- -----------------------------------------------------------------------------
-- Plafonul penalizarilor viitoare foloseste penalizarile nete
-- -----------------------------------------------------------------------------
savepoint plafon;
select pg_temp.recalculeaza(200, 100);
-- Peste 500 de zile: 200 × 0,2% × 500 = 200, plafonat la datorie minus
-- penalizarile deja cerute, nete: 200 - 20 = 180 (brut ar fi fost 170).
select financiar.calculeaza_penalizari(current_date + 500);
select is(
  (select p.suma from financiar.penalizari p where p.datorie_sursa_id = pg_temp.fx('intr') and p.luna_calcul = current_date + 500),
  180.00::numeric,
  '[K7] financiar.calculeaza_penalizari: plafonul scade penalizarile nete, dupa anulari');
rollback to savepoint plafon;

-- -----------------------------------------------------------------------------
-- Registrul pazeste forma anularii, indiferent cine scrie
-- -----------------------------------------------------------------------------
select throws_like(
  format($$insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere)
    values (%L, (select bloc_id from financiar.datorii where id = %L), 'anulare_penalizare', -1, current_date, 'x')$$,
    pg_temp.fx('ap1'), pg_temp.fx('pen')),
  '%datorii_anulare_check%', '[K7] o anulare arata mereu spre penalizarea ei');
select throws_like(
  format($$insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere, anuleaza_datorie_id)
    values (%L, (select bloc_id from financiar.datorii where id = %L), 'anulare_penalizare', 1, current_date, 'x', %L)$$,
    pg_temp.fx('ap1'), pg_temp.fx('pen'), pg_temp.fx('pen')),
  '%datorii_suma_check%', '[K7] o anulare este negativa');
select throws_like(
  format($$insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere, anuleaza_datorie_id)
    values (%L, (select bloc_id from financiar.datorii where id = %L), 'penalizare', 1, current_date, 'x', %L)$$,
    pg_temp.fx('ap1'), pg_temp.fx('pen'), pg_temp.fx('pen')),
  '%datorii_anulare_check%', '[K7] doar o anulare arata spre alta datorie');
select throws_ok(
  format($$insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere, anuleaza_datorie_id)
    values (%L, (select bloc_id from financiar.datorii where id = %L), 'anulare_penalizare', -1, current_date, 'x', %L)$$,
    pg_temp.fx('ap1'), pg_temp.fx('pen'), pg_temp.fx('intr')),
  'O anulare de penalizare trebuie sa arate spre o penalizare a aceluiasi apartament.',
  '[K7] financiar.verifica_anulare_penalizare: nu se anuleaza altceva decat o penalizare');
select throws_ok(
  format($$insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere, anuleaza_datorie_id)
    values (%L, (select bloc_id from financiar.datorii where id = %L), 'anulare_penalizare', -1, current_date, 'x', %L)$$,
    pg_temp.fx('ap2'), pg_temp.fx('pen'), pg_temp.fx('pen')),
  'O anulare de penalizare trebuie sa arate spre o penalizare a aceluiasi apartament.',
  '[K7] ...si nu a altui apartament');

select * from finish();
rollback;
