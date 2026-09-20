-- H2: identitate.eu() alegea apartamentul locatarului cu
-- `order by l.activ_din limit 1`, fara tiebreaker: un locatar cu doua
-- legaturi active (doua apartamente) primea intre reincarcari cand un
-- apartament, cand celalalt, in functie de ordinea fizica a randurilor —
-- exact defectul deja reparat pe ramura administratorului (S12).
--
-- Reparatie: adauga apartament_id ca tiebreaker, ca alegerea sa fie
-- determinista (cel mai vechi activ_din, apoi cel mai mic apartament_id).
--
-- Testul insereaza intai legatura cu apartamentul cu id-ul mai mare, apoi
-- cea cu id-ul mai mic, ambele cu acelasi activ_din. Fara tiebreaker,
-- scanarea secventiala a unui tabel proaspat intoarce randurile in ordinea
-- inserarii, deci "limit 1" ar alege apartamentul mai mare — asta arata
-- rosu inainte de reparatie. Cu tiebreaker, alegerea e mereu apartamentul
-- cu id-ul mai mic, indiferent de ordinea de inserare.
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

do $$
declare
  v_r jsonb;
  v_bloc uuid;
  v_ap_mare uuid;
  v_ap_mic uuid;
  v_profil uuid := gen_random_uuid();
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test E2', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TE2'),
    'bloc', jsonb_build_object('denumire', 'Bloc E2', 'adresa', 'Str. Test E2', 'etaje', 1)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '1', 0, 'Proprietar Unu', 50), (v_bloc, '2', 0, 'Proprietar Doi', 50);

  -- Alege in mod repetabil care apartament are id-ul mai mare / mai mic.
  select id into v_ap_mic from organizare.apartamente where bloc_id = v_bloc order by id asc limit 1;
  select id into v_ap_mare from organizare.apartamente where bloc_id = v_bloc order by id desc limit 1;

  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap_mic, date_trunc('month', current_date)::date, 1),
         (v_ap_mare, date_trunc('month', current_date)::date, 1);

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_profil, 'e-h2-' || v_profil || '@test.local', jsonb_build_object('nume', 'Locatar Dublu'));

  -- Insereaza intai legatura cu apartamentul mare, apoi cu cel mic: fara
  -- tiebreaker, o scanare secventiala fara index pe activ_din intoarce
  -- prima legatura inserata.
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (v_ap_mare, v_bloc, v_profil, 'proprietar', current_date - 30),
         (v_ap_mic, v_bloc, v_profil, 'proprietar', current_date - 30);

  perform set_config('fx.profil', v_profil::text, true);
  perform set_config('fx.ap_mic', v_ap_mic::text, true);
  perform set_config('fx.ap_mare', v_ap_mare::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('fx.profil'), 'role', 'authenticated')::text, true);

select is(
  (identitate.eu() ->> 'apartament_id')::uuid,
  current_setting('fx.ap_mic')::uuid,
  'eu(): locatarul cu doua apartamente primeste deterministic pe cel cu id-ul mai mic');

select is(
  (identitate.eu() ->> 'apartament_id')::uuid,
  current_setting('fx.ap_mic')::uuid,
  'eu(): a doua chemare da acelasi rezultat (deterministic, nu doar stabil in aceeasi tranzactie)');

select * from finish();
rollback;
