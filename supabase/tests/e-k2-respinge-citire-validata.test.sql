-- K2 (audit 3): o citire de apartament validata din greseala nu mai putea fi
-- schimbata de nicio comanda. valideaza_citire raspundea "Citirea a fost deja
-- verificata", valideaza_citiri_apartament "Nu mai sunt citiri de verificat",
-- estimeaza_citiri o sarea, transmite_citire raspundea "deja validat", iar
-- authenticated are doar SELECT pe citiri. Cu un index gresit (1900 mc in loc
-- de 130), motorul refuza apoi lista ("contorul general e mai mic decat suma
-- contoarelor"), deci luna devenea nepublicabila; singura iesire era sa
-- falsifici contorul general.
--
-- Reparatie: administratorul poate respinge o citire de apartament deja
-- validata, cat timp lista lunii nu este publicata. Locatarul o retrimite, iar
-- lunile de dupa isi refac indexul anterior din ultima citire valida.
-- Raman refuzate: acceptarea a doua oara, citirea de pornire, contorul general
-- (are comanda lui de corectura, J7) si orice citire dintr-o luna publicata.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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

-- Citirea unui contor intr-o luna (ultima, daca sunt mai multe).
create function pg_temp.citire(p_contor text, p_luna date)
returns uuid
language sql
stable
as $$
  select id from contorizare.citiri
  where contor_id = current_setting('fx.' || p_contor)::uuid and luna = p_luna
  order by transmisa_la desc nulls last, creat_la desc
  limit 1;
$$;

do $$
declare
  v_r jsonb;
  v_bloc uuid;
  v_ap uuid;
  v_c1 uuid;
  v_cg uuid;
  v_admin uuid := gen_random_uuid();
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test K2', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TK2'),
    'bloc', jsonb_build_object('denumire', 'Bloc K2', 'adresa', 'Str. Test K2', 'etaje', 1)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '1', 0, 'Ion Unu', 100) returning id into v_ap;
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap, pg_temp.luna(-5), 1);

  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (v_bloc, v_ap, 'rece') returning id into v_c1;
  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (v_bloc, null, 'rece') returning id into v_cg;

  -- Pornirea, luna -5: indexul 100 la apartament, 5000 la contorul general.
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_c1, 'rece', v_bloc, v_ap, pg_temp.luna(-5), 100, 100, 'pornire', 'validata'),
         (v_cg, 'rece', v_bloc, null, pg_temp.luna(-5), 5000, 5000, 'pornire', 'validata');

  -- Luna -3: citire validata normal, iar lista lunii este publicata.
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_c1, 'rece', v_bloc, v_ap, pg_temp.luna(-3), 100, 110, 'locatar', 'validata');

  -- Luna -2: indexul scris gresit (1900 in loc de 130) si validat din greseala.
  -- Contorul general are o citire validata pe aceeasi luna.
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_c1, 'rece', v_bloc, v_ap, pg_temp.luna(-2), 110, 1900, 'locatar', 'validata'),
         (v_cg, 'rece', v_bloc, null, pg_temp.luna(-2), 5000, 5030, 'administrator', 'validata');

  -- Luna -1: trimisa dupa, cu indexul anterior luat din citirea gresita.
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_c1, 'rece', v_bloc, v_ap, pg_temp.luna(-1), 1900, 1950, 'locatar', 'trimisa');

  perform organizare.activeaza_bloc(v_bloc);
  insert into intretinere.liste_lunare (bloc_id, luna, scadenta, stare, publicata_la, total_repartizat)
  values (v_bloc, pg_temp.luna(-3), current_date, 'publicata', now(), 0);

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'e-k2-' || v_admin || '@test.local', jsonb_build_object('nume', 'Admin K2'));
  perform identitate.numeste_administrator(v_admin, (v_r ->> 'asociatie_id')::uuid, 'AT-K2-1', current_date - 30);

  perform set_config('fx.admin', v_admin::text, true);
  perform set_config('fx.c1', v_c1::text, true);
  perform set_config('fx.cg', v_cg::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('fx.admin'), 'role', 'authenticated')::text, true);

-- Ce ramane refuzat
select throws_ok(
  format('select contorizare.valideaza_citire(%L, true)', pg_temp.citire('c1', pg_temp.luna(-2))),
  'Citirea a fost deja verificata.',
  '[K2] valideaza_citire: o citire validata nu se accepta a doua oara');
select throws_ok(
  format('select contorizare.valideaza_citire(%L, false, %L)', pg_temp.citire('c1', pg_temp.luna(-5)), 'gresit'),
  'Citirea a fost deja verificata.',
  '[K2] valideaza_citire: citirea de pornire nu se respinge');
select throws_ok(
  format('select contorizare.valideaza_citire(%L, false, %L)', pg_temp.citire('cg', pg_temp.luna(-2)), 'gresit'),
  'Citirea a fost deja verificata.',
  '[K2] valideaza_citire: contorul general nu se respinge (are corectura lui)');
select throws_ok(
  format('select contorizare.valideaza_citire(%L, false, %L)', pg_temp.citire('c1', pg_temp.luna(-3)), 'gresit'),
  format('Lista lunii %s este deja publicata; citirea nu se mai poate verifica.', comunicare.luna_text(pg_temp.luna(-3))),
  '[K2] valideaza_citire: o citire validata dintr-o luna publicata nu se respinge');
select throws_ok(
  format('select contorizare.valideaza_citire(%L, false, %L)', pg_temp.citire('c1', pg_temp.luna(-2)), '  '),
  'Scrie motivul, ca locatarul sa stie ce sa corecteze.',
  '[K2] valideaza_citire: respingerea unei citiri validate cere tot motiv');

-- Respingerea citirii validate din greseala
select lives_ok(
  format('select contorizare.valideaza_citire(%L, false, %L)', pg_temp.citire('c1', pg_temp.luna(-2)), ' Indexul pare scris gresit, 1900 in loc de 130 '),
  '[K2] valideaza_citire: administratorul respinge o citire validata din greseala, cat timp luna nu e publicata');
select results_eq(
  format('select stare, motiv_respingere, verificata_de from contorizare.citiri where id = %L', pg_temp.citire('c1', pg_temp.luna(-2))),
  format('values (%L::text, %L::text, %L::uuid)', 'respinsa', 'Indexul pare scris gresit, 1900 in loc de 130', current_setting('fx.admin')),
  '[K2] citirea devine respinsa, cu motivul curatat si cine a respins-o');
select is(
  (select index_anterior from contorizare.citiri where id = pg_temp.citire('c1', pg_temp.luna(-1))),
  110.000::numeric,
  '[K2] luna de dupa isi reface indexul anterior din ultima citire valida (110), nu din cea respinsa (1900)');
select is(
  (select consum from contorizare.citiri where id = pg_temp.citire('c1', pg_temp.luna(-1))),
  1840.000::numeric,
  '[K2] ...deci si consumul ei (1950 - 110)');
select throws_ok(
  format('select contorizare.valideaza_citire(%L, false, %L)', pg_temp.citire('c1', pg_temp.luna(-2)), 'iar'),
  'Citirea a fost deja verificata.',
  '[K2] o citire respinsa nu se respinge a doua oara');

reset role;
select is(
  (select date ->> 'motiv' from evenimente.coada
    where tip = 'CitireRespinsa' and agregat_id = current_setting('fx.c1')::uuid order by id desc limit 1),
  'Indexul pare scris gresit, 1900 in loc de 130',
  '[K2] respingerea inregistreaza CitireRespinsa, ca locatarul sa fie anuntat');
select is(
  (select count(*)::int from contorizare.citiri where contor_id = current_setting('fx.c1')::uuid and stare = 'validata'),
  2,
  '[K2] raman validate doar pornirea si luna -3');

select * from finish();
rollback;
