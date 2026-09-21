-- K6 (audit 3): o citire ramasa "trimisa" pe o luna a carei lista se publica
-- nu mai poate fi verificata, respinsa, estimata sau retrimisa (toate refuza o
-- luna publicata), deci ramane blocata definitiv, iar contorul "De verificat"
-- nu mai ajunge la zero. Se ajungea acolo pe o cale legitima: administratorul
-- scoate apa de pe lista lunii (se factureaza separat) si publica.
--
-- Reparatie: lista nu se publica cat timp luna ei are citiri trimise.
-- Recalcularea unei liste deja publicate nu este oprita.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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

-- Rezultatul motorului pentru lista: fiecare cheltuiala, 100 de lei, pe singurul apartament.
create function pg_temp.rezultat()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('repartizari', coalesce(jsonb_agg(jsonb_build_object(
    'cheltuialaId', c.id, 'apartamentId', pg_temp.fx('ap'), 'suma', c.suma,
    'baza', jsonb_build_object('valoare', 1, 'total', 1, 'unitate', 'apartamente'))), '[]'::jsonb))
  from intretinere.cheltuieli c where c.lista_id = pg_temp.fx('lista');
$$;

do $$
declare
  v_r jsonb;
  v_bloc uuid;
  v_ap uuid;
  v_rece uuid;
  v_calda uuid;
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test K6', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TK6'),
    'bloc', jsonb_build_object('denumire', 'Bloc K6', 'adresa', 'Str. Test K6', 'etaje', 0)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '1', 0, 'Ion Unu', 100) returning id into v_ap;
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap, pg_temp.luna(-5), 1);
  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (v_bloc, v_ap, 'rece') returning id into v_rece;
  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (v_bloc, v_ap, 'calda') returning id into v_calda;
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_rece, 'rece', v_bloc, v_ap, pg_temp.luna(-5), 100, 100, 'pornire', 'validata'),
         (v_calda, 'calda', v_bloc, v_ap, pg_temp.luna(-5), 50, 50, 'pornire', 'validata'),
         -- Luna listei: ambele citiri trimise, nicio verificare inca.
         (v_rece, 'rece', v_bloc, v_ap, pg_temp.luna(-1), 100, 110, 'locatar', 'trimisa'),
         (v_calda, 'calda', v_bloc, v_ap, pg_temp.luna(-1), 50, 54, 'locatar', 'trimisa');
  perform organizare.activeaza_bloc(v_bloc);

  -- Lista lunii, fara apa (se factureaza separat): doar curatenia.
  insert into intretinere.furnizori (asociatie_id, denumire) values ((v_r ->> 'asociatie_id')::uuid, 'Curatenie SRL');
  insert into intretinere.liste_lunare (bloc_id, luna, scadenta) values (v_bloc, pg_temp.luna(-1), current_date + 30);
  perform set_config('fx.lista', (select id from intretinere.liste_lunare where bloc_id = v_bloc and luna = pg_temp.luna(-1))::text, true);
  insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, suma, metoda)
  values (pg_temp.fx('lista'), 'factura', 'C1', 'Curatenie',
          (select id from intretinere.furnizori where asociatie_id = (v_r ->> 'asociatie_id')::uuid), 100, 'apartamente');

  perform set_config('fx.ap', v_ap::text, true);
  perform set_config('fx.rece', v_rece::text, true);
  perform set_config('fx.calda', v_calda::text, true);
end;
$$;

-- Un bloc mare: 20 de citiri trimise, iar mesajul spune "20 de citiri".
savepoint k6_multe;
with c as (
  insert into contorizare.contoare (bloc_id, apartament_id, tip)
  select (select bloc_id from intretinere.liste_lunare where id = pg_temp.fx('lista')), pg_temp.fx('ap'), 'rece'
  from generate_series(1, 18)
  returning id, bloc_id
)
insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
select id, 'rece', bloc_id, pg_temp.fx('ap'), pg_temp.luna(-1), 0, 1, 'locatar', 'trimisa' from c;
select throws_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat())$$,
  format('Pe %s mai sunt 20 de citiri de verificat. Valideaza-le sau respinge-le, apoi publica lista.', comunicare.luna_text(pg_temp.luna(-1))),
  '[K6] de la 20 in sus: "20 de citiri"');
rollback to savepoint k6_multe;

select throws_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat())$$,
  format('Pe %s mai sunt 2 citiri de verificat. Valideaza-le sau respinge-le, apoi publica lista.', comunicare.luna_text(pg_temp.luna(-1))),
  '[K6] intretinere.refuza_publicarea_cu_citiri_trimise: lista nu se publica peste citiri trimise, chiar fara apa pe ea');
select is(
  (select stare from intretinere.liste_lunare where id = pg_temp.fx('lista')),
  'ciorna',
  '[K6] lista ramane ciorna, iar citirile se pot verifica in continuare');

update contorizare.citiri set stare = 'validata' where contor_id = pg_temp.fx('rece') and luna = pg_temp.luna(-1);
select throws_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat())$$,
  format('Pe %s mai este o citire de verificat. Valideaza-o sau respinge-o, apoi publica lista.', comunicare.luna_text(pg_temp.luna(-1))),
  '[K6] mesajul la singular, cand mai ramane una');

update contorizare.citiri set stare = 'respinsa', motiv_respingere = 'Poza neclara' where contor_id = pg_temp.fx('calda') and luna = pg_temp.luna(-1);
select lives_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat())$$,
  '[K6] fara citiri trimise (una validata, una respinsa), lista se publica');
select is(
  (select stare from intretinere.liste_lunare where id = pg_temp.fx('lista')),
  'publicata',
  '[K6] ...si ajunge publicata');

-- O citire trimisa ramasa dinainte de reparatie nu blocheaza recalcularea.
insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
values (pg_temp.fx('calda'), 'calda', (select bloc_id from intretinere.liste_lunare where id = pg_temp.fx('lista')),
        pg_temp.fx('ap'), pg_temp.luna(-1), 50, 55, 'locatar', 'trimisa');
select lives_ok(
  $$select intretinere.salveaza_lista_publicata(pg_temp.fx('lista'), pg_temp.rezultat(), null, true)$$,
  '[K6] recalcularea unei liste deja publicate nu e oprita de citiri trimise');

select * from finish();
rollback;
