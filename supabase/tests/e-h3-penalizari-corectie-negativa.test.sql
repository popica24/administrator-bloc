-- H3: financiar.calculeaza_penalizari calculeaza v_rest ca `suma - alocari`,
-- ignorand regula introdusa de reparatia F2 in financiar.datorii_rest si
-- financiar.aloca_plata: o corectie negativa (dupa o recalculare) reduce
-- direct restul datoriei de intretinere din aceeasi lista si acelasi
-- apartament, in loc sa ramana o datorie deschisa separata. Reprodus:
-- datorie 300 + corectie -300 -> soldul real e 0, dar
-- calculeaza_penalizari vede tot "rest = 300" si taxeaza o penalizare in
-- fiecare luna, la nesfarsit. Plafonul (v_plafon) se calculeaza pe aceeasi
-- baza gresita (300 in loc de 0/200).
--
-- Reparatie: calculeaza_penalizari foloseste aceeasi baza corectata
-- (suma datoriei + corectiile negative surori) atat pentru rest cat si
-- pentru plafon.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

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
  v_asociatie uuid;
  v_ap1 uuid;
  v_ap2 uuid;
  v_lista1 uuid;
  v_lista2 uuid;
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test E3', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TE3'),
    'bloc', jsonb_build_object('denumire', 'Bloc E3', 'adresa', 'Str. Test E3', 'etaje', 1)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;
  v_asociatie := (v_r ->> 'asociatie_id')::uuid;

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '1', 0, 'Compensat Integral', 50) returning id into v_ap1;
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '2', 1, 'Compensat Partial', 50) returning id into v_ap2;
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap1, '2020-01-01', 1), (v_ap2, '2020-01-01', 1);

  perform organizare.activeaza_bloc(v_bloc);

  update financiar.setari_financiare set procent_penalizare_zi = 0.1, zile_gratie = 0 where asociatie_id = v_asociatie;

  insert into intretinere.liste_lunare (bloc_id, luna, stare, scadenta, publicata_la, total_repartizat)
  values (v_bloc, '2020-01-01', 'publicata', '2020-01-25', now(), 300) returning id into v_lista1;
  insert into intretinere.liste_lunare (bloc_id, luna, stare, scadenta, publicata_la, total_repartizat)
  values (v_bloc, '2020-02-01', 'publicata', '2020-02-25', now(), 300) returning id into v_lista2;

  -- ap1: intretinere 300, apoi o corectie negativa de -300 pe aceeasi lista:
  -- soldul real e 0.
  insert into financiar.datorii (apartament_id, bloc_id, tip, lista_id, luna, suma, scadenta, descriere)
  values (v_ap1, v_bloc, 'intretinere', v_lista1, '2020-01-01', 300, '2020-01-25', 'Intretinere ianuarie 2020');
  insert into financiar.datorii (apartament_id, bloc_id, tip, lista_id, luna, suma, scadenta, descriere)
  values (v_ap1, v_bloc, 'corectie', v_lista1, '2020-01-01', -300, '2020-01-25', 'Corectie dupa recalculare');

  -- ap2: intretinere 300, corectie negativa de doar -100: soldul real e 200.
  insert into financiar.datorii (apartament_id, bloc_id, tip, lista_id, luna, suma, scadenta, descriere)
  values (v_ap2, v_bloc, 'intretinere', v_lista2, '2020-02-01', 300, '2020-02-25', 'Intretinere februarie 2020');
  insert into financiar.datorii (apartament_id, bloc_id, tip, lista_id, luna, suma, scadenta, descriere)
  values (v_ap2, v_bloc, 'corectie', v_lista2, '2020-02-01', -100, '2020-02-25', 'Corectie dupa recalculare');

  perform set_config('fx.ap1', v_ap1::text, true);
  perform set_config('fx.ap2', v_ap2::text, true);
end;
$$;

-- Confirma soldurile reale (financiar.datorii_rest, deja corect dupa F2).
select is(
  (select coalesce(sum(rest), 0) from financiar.datorii_rest where apartament_id = current_setting('fx.ap1')::uuid),
  0::numeric,
  'fixture: soldul real al ap1 este 0 (300 compensat integral de corectie)');
select is(
  (select coalesce(sum(rest), 0) from financiar.datorii_rest where apartament_id = current_setting('fx.ap2')::uuid),
  200::numeric,
  'fixture: soldul real al ap2 este 200 (300 minus corectia de 100)');

-- Ruleaza jobul mult dupa scadenta: fara reparatie, ap1 primeste
-- penalizare in fiecare luna (rest vazut gresit = 300, la nesfarsit).
select financiar.calculeaza_penalizari('2020-06-01');
select is(
  (select count(*)::int from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_sursa_id
    where d.apartament_id = current_setting('fx.ap1')::uuid),
  0,
  'calculeaza_penalizari: ap1, compensat integral de corectie, nu primeste nicio penalizare');

-- ap2: penalizarea se calculeaza pe restul real (200), nu pe suma bruta (300).
select is(
  (select p.suma from financiar.penalizari p join financiar.datorii d on d.id = p.datorie_sursa_id
    where d.apartament_id = current_setting('fx.ap2')::uuid and p.luna_calcul = '2020-06-01'),
  round(200 * 0.1 / 100 * (('2020-06-01'::date) - ('2020-02-25'::date)), 2),
  'calculeaza_penalizari: ap2, penalizarea se calculeaza pe restul corectat (200), nu pe suma bruta (300)');

select * from finish();
rollback;
