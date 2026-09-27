-- [minor] + J12: financiar.datorii_rest zeroes o corectie negativa
-- neconditionat, chiar si cand nu are nicio datorie de intretinere sora pe
-- aceeasi lista (lista_id fara potrivire, de exemplu o corectie facuta
-- manual, fara legatura cu o lista): suma corectiei disparea din
-- Sigma(rest), desi financiar.solduri (calculat independent, suma
-- datoriilor minus platile) o scadea in continuare din sold. Rezultatul:
-- Sigma(rest) <> sold. [minor] a facut ca o corectie negativa fara sora sa
-- isi pastreze propriul rest (negativ), vizibil, ca suma sa nu dispara din
-- Sigma(rest).
--
-- J12: dar o corectie negativa orfana, o data creata, nu mai poate fi
-- niciodata inchisa, financiar.aloca_plata sare peste orice rand cu rest
-- negativ (nu exista nimic de "platit"), asa ca ramane deschisa pentru
-- totdeauna, cu un rest fantoma pe care nimeni nu-l poate reduce. Azi
-- singura cale de a crea una e directa, prin service role (nicio comanda
-- din aplicatie n-o produce), dar registrul financiar nu ar trebui sa
-- permita starea asta indiferent de cine incearca sa o scrie.
--
-- Reparatie: financiar.datorii refuza la INSERT/UPDATE o corectie negativa
-- fara datoria de intretinere sora (aceeasi lista_id, acelasi apartament).
-- Proprietatea de reconciliere din [minor] (Sigma(rest) = sold) ramane
-- verificata separat, pentru cazul in care un asemenea rand ar ajunge
-- totusi in tabela (trigger-ul dezactivat temporar, ca aparare in adancime,
-- nu ca flux normal).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

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

  -- O datorie de intretinere obisnuita (100), platita integral.
  insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
  values (v_ap, v_bloc, 'intretinere', '2020-01-01', 100, '2020-01-25', 'Intretinere ianuarie 2020');
  perform financiar.inregistreaza_plata(v_ap, 100, 'numerar', '2020-01-10 10:00:00+00');

  perform set_config('fx.ap', v_ap::text, true);
end;
$$;

-- J12: o corectie negativa fara lista_id (deci fara nicio sora de
-- intretinere care sa o "absoarba") este refuzata direct la insert, chiar
-- si prin service role, de trigger-ul datorii_corectie_are_sora
-- (financiar.verifica_corectie_are_sora).
select throws_ok(
  format('insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
          values (%L, (select bloc_id from organizare.apartamente where id = %L), ''corectie'', ''2020-01-01'', -40, ''2020-01-25'', ''Corectie fara lista (orfana)'')',
    current_setting('fx.ap')::uuid, current_setting('fx.ap')::uuid),
  'P0001', 'O corectie negativa are nevoie de o datorie de intretinere sora, pe aceeasi lista si acelasi apartament.',
  '[J12] o corectie negativa orfana este refuzata la insert');

select is(
  (select count(*)::int from financiar.datorii where apartament_id = current_setting('fx.ap')::uuid and tip = 'corectie'),
  0,
  '[J12] corectia orfana refuzata nu a intrat in tabela');

-- [minor] Aparare in adancime: daca un asemenea rand ar ajunge totusi in
-- tabela (trigger-ul dezactivat temporar, nu un flux normal), Sigma(rest)
-- ramane egala cu soldul real, corectia orfana ramane vizibila cu
-- propriul ei rest (negativ), nu dispare tacut din Sigma(rest).
do $$
begin
  alter table financiar.datorii disable trigger datorii_corectie_are_sora;
  insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
  values (current_setting('fx.ap')::uuid, (select bloc_id from organizare.apartamente where id = current_setting('fx.ap')::uuid),
          'corectie', '2020-01-01', -40, '2020-01-25', 'Corectie fara lista (orfana, ocolind trigger-ul)');
  alter table financiar.datorii enable trigger datorii_corectie_are_sora;
end;
$$;

select is(
  (select coalesce(sum(rest), 0) from financiar.datorii_rest where apartament_id = current_setting('fx.ap')::uuid),
  (select sold from financiar.solduri where apartament_id = current_setting('fx.ap')::uuid),
  '[minor] datorii_rest: suma resturilor este egala cu soldul, chiar si cu o corectie fara sora de intretinere (ajunsa in tabela ocolind trigger-ul)');

select * from finish();
rollback;
