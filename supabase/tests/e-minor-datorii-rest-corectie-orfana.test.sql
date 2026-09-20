-- [minor] financiar.datorii_rest zeroes o corectie negativa necondiTionat,
-- chiar si cand nu are nicio datorie de intretinere sora pe aceeasi lista
-- (lista_id fara potrivire, de exemplu o corectie facuta manual, fara
-- legatura cu o lista): suma corectiei dispare din Sigma(rest), desi
-- financiar.solduri (calculat independent, suma datoriilor minus platile)
-- o scade in continuare din sold. Rezultatul: Sigma(rest) <> sold.
--
-- Reparatie: o corectie negativa isi zeroeste restul propriu doar cand
-- exista o datorie de intretinere sora, cea care primeste reducerea. Fara
-- sora, corectia ramane vizibila cu propriul ei rest (negativ), ca suma sa
-- se regaseasca undeva in Sigma(rest).
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
  v_ap uuid;
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test Minor Rest', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TMR'),
    'bloc', jsonb_build_object('denumire', 'Bloc Minor Rest', 'adresa', 'Str. Test MR', 'etaje', 1)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '1', 0, 'Corectie Orfana', 100) returning id into v_ap;
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap, '2020-01-01', 1);

  perform organizare.activeaza_bloc(v_bloc);

  -- O datorie de intretinere obisnuita (100), platita integral, plus o
  -- corectie negativa (-40) fara lista_id, deci fara nicio sora de
  -- intretinere care sa o "absoarba".
  insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
  values (v_ap, v_bloc, 'intretinere', '2020-01-01', 100, '2020-01-25', 'Intretinere ianuarie 2020');
  perform financiar.inregistreaza_plata(v_ap, 100, 'numerar', '2020-01-10 10:00:00+00');
  insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
  values (v_ap, v_bloc, 'corectie', '2020-01-01', -40, '2020-01-25', 'Corectie fara lista (orfana)');

  perform set_config('fx.ap', v_ap::text, true);
end;
$$;

select is(
  (select coalesce(sum(rest), 0) from financiar.datorii_rest where apartament_id = current_setting('fx.ap')::uuid),
  (select sold from financiar.solduri where apartament_id = current_setting('fx.ap')::uuid),
  '[minor] datorii_rest: suma resturilor este egala cu soldul, chiar si cu o corectie fara sora de intretinere');

select is(
  (select sold from financiar.solduri where apartament_id = current_setting('fx.ap')::uuid),
  -40::numeric,
  '[minor] fixture: soldul real este -40 (100 platit integral, apoi o corectie de -40 fara sora)');

select * from finish();
rollback;
