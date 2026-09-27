-- J6: guvernanta.situatie_voturi() si situatie_adunari() calculau
-- "votulMeu"/"prezentaMea" cu
-- `... apartament_id in (select private.apartamentele_mele()) limit 1`,
-- adica orice apartament al meu, in ordinea arbitrara a scanarii, nu
-- apartamentul pe care omul l-a ales ca activ (vezi [P5] in
-- src/sursa-supabase.js). Un locatar cu doua apartamente in acelasi bloc,
-- unul care a votat/participat si altul care n-a facut-o, vedea mereu
-- rezultatul primului gasit, indiferent care apartament il avea deschis pe
-- ecran: apartamentul care n-a votat aparea ca "ai votat deja", iar
-- celalalt nu se mai putea vota niciodata din aceasta cauza (ecranul crede
-- ca a votat deja).
--
-- Reparatie: ambele functii primesc un parametru optional p_apartament_id;
-- cand e dat si apartine chemarii curente (private.apartamentele_mele()),
-- votulMeu/prezentaMea se calculeaza strict pentru el. Fara el (sau daca nu
-- e al meu), comportamentul vechi ramane neschimbat (compatibil cu
-- apelurile fara alegere, de exemplu administratorul).
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

do $$
declare
  v_r jsonb;
  v_bloc uuid;
  v_asoc uuid;
  v_ap1 uuid;
  v_ap2 uuid;
  v_profil uuid := gen_random_uuid();
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
  v_vot uuid;
  v_optiune uuid;
  v_adunare uuid;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test J6', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TJ6'),
    'bloc', jsonb_build_object('denumire', 'Bloc J6', 'adresa', 'Str. Test J6', 'etaje', 1)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;
  v_asoc := (v_r ->> 'asociatie_id')::uuid;

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '1', 0, 'Locatar Dublu', 50) returning id into v_ap1;
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '2', 0, 'Locatar Dublu', 50) returning id into v_ap2;
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap1, date_trunc('month', current_date)::date, 1), (v_ap2, date_trunc('month', current_date)::date, 1);

  perform organizare.activeaza_bloc(v_bloc);

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_profil, 'e-j6-' || v_profil || '@test.local', jsonb_build_object('nume', 'Locatar Dublu'));
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (v_ap1, v_bloc, v_profil, 'proprietar', current_date - 30),
         (v_ap2, v_bloc, v_profil, 'proprietar', current_date - 30);

  -- Vot deschis; doar apartamentul 2 a votat.
  insert into guvernanta.voturi (asociatie_id, titlu, deschis_la, inchide_la)
  values (v_asoc, 'Buget 2026', now() - interval '1 day', now() + interval '5 days') returning id into v_vot;
  insert into guvernanta.voturi_optiuni (vot_id, text, ordine) values (v_vot, 'Da', 1) returning id into v_optiune;
  insert into guvernanta.voturi_exprimate (vot_id, optiune_id, apartament_id, profil_id)
  values (v_vot, v_optiune, v_ap2, v_profil);

  -- Adunare; doar apartamentul 2 e prezent.
  insert into guvernanta.adunari_generale (asociatie_id, data_ora, loc, ordine_de_zi)
  values (v_asoc, now() - interval '1 day', 'Sala de festivitati', 'Buget 2026') returning id into v_adunare;
  insert into guvernanta.adunari_prezente (adunare_id, apartament_id, profil_id)
  values (v_adunare, v_ap2, v_profil);

  perform set_config('fx.profil', v_profil::text, true);
  perform set_config('fx.asoc', v_asoc::text, true);
  perform set_config('fx.ap1', v_ap1::text, true);
  perform set_config('fx.ap2', v_ap2::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('fx.profil'), 'role', 'authenticated')::text, true);

-- Apartamentul 1 (ales) nu a votat si nu a fost prezent, desi apartamentul
-- 2, al aceluiasi om, a facut-o pe amandoua.
select is(
  (guvernanta.situatie_voturi(current_setting('fx.asoc')::uuid, current_setting('fx.ap1')::uuid) -> 0 ->> 'votulMeu'),
  null::text,
  'situatie_voturi: apartamentul ales, care n-a votat, nu arata votul celuilalt apartament al aceluiasi om');

select is(
  (guvernanta.situatie_adunari(current_setting('fx.asoc')::uuid, current_setting('fx.ap1')::uuid) -> 0 ->> 'prezentaMea'),
  'false',
  'situatie_adunari: apartamentul ales, care n-a fost prezent, nu arata prezenta celuilalt apartament al aceluiasi om');

-- Apartamentul 2 (ales), care chiar a votat si a fost prezent.
select is(
  (guvernanta.situatie_voturi(current_setting('fx.asoc')::uuid, current_setting('fx.ap2')::uuid) -> 0 ->> 'votulMeu')::uuid,
  (select optiune_id from guvernanta.voturi_exprimate where apartament_id = current_setting('fx.ap2')::uuid),
  'situatie_voturi: apartamentul 2, ales, isi arata propriul vot');

select is(
  (guvernanta.situatie_adunari(current_setting('fx.asoc')::uuid, current_setting('fx.ap2')::uuid) -> 0 ->> 'prezentaMea'),
  'true',
  'situatie_adunari: apartamentul 2, ales, isi arata propria prezenta');

select * from finish();
rollback;
