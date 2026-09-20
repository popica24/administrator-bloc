-- H4: contorizare.estimeaza_citiri() a primit paza termenului (nu se poate
-- estima inainte de zi_limita_citire), dar nu si paza lunii publicate, pe
-- care cele trei functii surori o au deja (citeste_contor_general,
-- valideaza_citire, valideaza_citiri_apartament). Fara ea, administratorul
-- putea estima citirile lipsa ale unei luni a carei lista fusese deja
-- publicata (banii calculati si inghetati): ecranul Contoare ar arata o
-- citire noua "Estimat" pentru luna aceea, iar indexul anterior al lunii
-- urmatoare s-ar recalcula pe baza ei — in contradictie cu lista deja
-- publicata si platita.
--
-- Reparatie: aceeasi verificare ca la surori, cu acelasi mesaj (stilul
-- "Lista lunii % este deja publicata; ... nu se mai poate ...").
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

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

do $$
declare
  v_r jsonb;
  v_bloc uuid;
  v_ap uuid;
  v_c1 uuid;
  v_admin uuid := gen_random_uuid();
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test E4', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TE4'),
    'bloc', jsonb_build_object('denumire', 'Bloc E4', 'adresa', 'Str. Test E4', 'etaje', 1)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '1', 0, 'Ion Unu', 100) returning id into v_ap;
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap, pg_temp.luna(-5), 1);
  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (v_bloc, v_ap, 'rece') returning id into v_c1;
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_c1, 'rece', v_bloc, v_ap, pg_temp.luna(-5), 100, 100, 'pornire', 'validata');

  perform organizare.activeaza_bloc(v_bloc);

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'e-h4-' || v_admin || '@test.local', jsonb_build_object('nume', 'Admin E4'));
  perform identitate.numeste_administrator(v_admin, (v_r ->> 'asociatie_id')::uuid, 'AT-E-4', current_date - 30);

  -- Lista lunii -3 este deja publicata; apartamentul nu a transmis nicio
  -- citire pentru luna aceea.
  insert into intretinere.liste_lunare (bloc_id, luna, stare, scadenta, publicata_la, total_repartizat)
  values (v_bloc, pg_temp.luna(-3), 'publicata', pg_temp.luna(-2) + 24, now(), 100);

  perform set_config('fx.admin', v_admin::text, true);
  perform set_config('fx.bloc', v_bloc::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('fx.admin'), 'role', 'authenticated')::text, true);

select throws_ok(
  format('select contorizare.estimeaza_citiri(%L, %L)', current_setting('fx.bloc')::uuid, pg_temp.luna(-3)),
  'Lista lunii ' || pg_temp.luna(-3)::text || ' este deja publicata; citirile nu se mai pot estima.',
  'estimeaza_citiri: refuza o luna a carei lista e deja publicata');

select is(
  (select count(*)::int from contorizare.citiri where bloc_id = current_setting('fx.bloc')::uuid and luna = pg_temp.luna(-3)),
  0,
  'estimeaza_citiri: nu insereaza nicio citire pentru luna publicata refuzata');

select * from finish();
rollback;
