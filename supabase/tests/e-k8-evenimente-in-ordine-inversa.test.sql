-- K8 (audit 3): daca ListaRecalculata se proceseaza inaintea lui
-- ListaPublicata (webhook esuat, `for update skip locked`), datoriile de
-- intretinere ale listei nu exista inca, iar trigger-ul J12 refuza corectia
-- negativa ("O corectie negativa are nevoie de o datorie de intretinere
-- sora"). Handler-ul cadea la fiecare reincercare, iar dupa 10 incercari
-- evenimentul era abandonat: corectiile intregului bloc se pierdeau tacut, cu
-- repartizarile noi pe ecran si sumele vechi in registru.
--
-- Reparatie: la_lista_recalculata aplica intai efectele publicarii, cand
-- lipsesc (la_lista_publicata e idempotenta), deci ordinea nu mai conteaza.
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

create function pg_temp.fx(p_cheie text)
returns uuid
language sql
stable
as $$
  select current_setting('fx.' || p_cheie)::uuid;
$$;

-- Rezultatul motorului: cheltuiala C1 impartita p1 / p2 intre ap1 si ap2.
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

do $$
declare
  v_r jsonb;
  v_bloc uuid;
  v_id uuid;
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test K8', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TK8'),
    'bloc', jsonb_build_object('denumire', 'Bloc K8', 'adresa', 'Str. Test K8', 'etaje', 0)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;
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
          (select id from intretinere.furnizori where asociatie_id = (v_r ->> 'asociatie_id')::uuid), 100, 'apartamente');
end;
$$;

-- Publicarea (60 / 40), apoi recalcularea (50 / 50): ap1 -10, ap2 +10.
-- Niciun eveniment nu se proceseaza inca.
select set_config('fx.ev_pub', intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat(60, 40))::text, true);
select set_config('fx.ev_rec', intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat(50, 50), null, true)::text, true);

-- Ordinea inversa: intai recalcularea.
select lives_ok(
  $$select financiar.la_lista_recalculata((select date from evenimente.coada where id = current_setting('fx.ev_rec')::bigint))$$,
  '[K8] la_lista_recalculata nu cade cand ListaPublicata nu a fost procesat inca');
select results_eq(
  $$select apartament_id, tip, suma from financiar.datorii where lista_id = pg_temp.fx('lista') order by tip desc, suma$$,
  $$values (pg_temp.fx('ap2'), 'intretinere'::text, 40.00::numeric(12,2)), (pg_temp.fx('ap1'), 'intretinere'::text, 60.00::numeric(12,2)),
           (pg_temp.fx('ap1'), 'corectie'::text, -10.00::numeric(12,2)), (pg_temp.fx('ap2'), 'corectie'::text, 10.00::numeric(12,2))$$,
  '[K8] ...aplica intai publicarea (60 / 40), apoi corectiile (-10 / +10)');
select results_eq(
  $$select apartament_id, sum(rest) from financiar.datorii_rest where lista_id = pg_temp.fx('lista') group by apartament_id order by 2$$,
  $$values (pg_temp.fx('ap1'), 50.00::numeric), (pg_temp.fx('ap2'), 50.00::numeric)$$,
  '[K8] registrul ajunge la sumele recalculate, 50 / 50');

-- ListaPublicata vine apoi, cu intarziere: nu dubleaza nimic.
select lives_ok(
  $$select financiar.la_lista_publicata((select date from evenimente.coada where id = current_setting('fx.ev_pub')::bigint))$$,
  '[K8] ListaPublicata procesat dupa recalculare nu cade...');
select is(
  (select count(*)::int from financiar.datorii where lista_id = pg_temp.fx('lista')),
  4,
  '[K8] ...si nu dubleaza datoriile');
select is(
  (select sum(rest) from financiar.datorii_rest where lista_id = pg_temp.fx('lista')),
  100.00::numeric,
  '[K8] totalul ramane cel al listei, 100 de lei');

select * from finish();
rollback;
