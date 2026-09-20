-- Teste pgTAP pentru guvernanta (migratia 20260919120020_guvernanta.sql): voturi, adunari, RLS.
-- Toate datele sunt create aici si se anuleaza la rollback.
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

-- -----------------------------------------------------------------------------
-- Ajutoare si date proprii testului (pg_temp: dispar odata cu sesiunea; totul
-- se anuleaza la rollback). Nu depindem de datele din seed.
--   pg_temp.id('x')  -> uuid-ul salvat sub cheia x
--   pg_temp.ca('x')  -> de acum rulam ca utilizatorul x (rol authenticated)
--   reset role       -> inapoi la postgres
-- -----------------------------------------------------------------------------
create function pg_temp.id(k text) returns uuid language sql stable as $$
  select nullif(current_setting('t.' || k, true), '')::uuid
$$;

create function pg_temp.pune(k text, v uuid) returns uuid language sql as $$
  select set_config('t.' || k, v::text, true)::uuid
$$;

create function pg_temp.ca(k text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.' || k), 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

create function pg_temp.cont(k text) returns uuid language plpgsql as $$
declare
  v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v, 'c-' || k || '-' || v || '@test.ro', jsonb_build_object('nume', 'Test ' || k));
  return pg_temp.pune(k, v);
end;
$$;

create function pg_temp.apartament(k text, p_bloc uuid, p_numar text, p_cota numeric) returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (p_bloc, p_numar, 1, 'Proprietar ' || p_numar, p_cota)
  returning id into v;
  return pg_temp.pune(k, v);
end;
$$;

create function pg_temp.locatar(k text, p_ap text, p_calitate text, p_din date, p_pana date default null) returns void language plpgsql as $$
begin
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din, activ_pana)
  select a.id, a.bloc_id, pg_temp.id(k), p_calitate, p_din, p_pana
  from organizare.apartamente a where a.id = pg_temp.id(p_ap);
end;
$$;

-- Asociatia A (bloc activ, apartamentele 1, 2, 3 cu cotele 40/35/25) si
-- asociatia B (un bloc, un apartament), cu toate rolurile de care avem nevoie.
create function pg_temp.fixturi() returns void language plpgsql as $$
declare
  r jsonb;
begin
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia C test', 'cui', 'C-' || gen_random_uuid()),
    'bloc', jsonb_build_object('denumire', 'Bloc C', 'adresa', 'Strada Testului 1', 'etaje', 4, 'ziLimitaCitire', 25)));
  perform pg_temp.pune('asoc', (r ->> 'asociatie_id')::uuid);
  perform pg_temp.pune('bloc', (r ->> 'bloc_id')::uuid);
  update organizare.blocuri set stare = 'activ', activat_la = now() where id = pg_temp.id('bloc');

  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia C straina', 'cui', 'C-' || gen_random_uuid()),
    'bloc', jsonb_build_object('denumire', 'Bloc strain', 'adresa', 'Strada Straina 2', 'etaje', 2)));
  perform pg_temp.pune('asocB', (r ->> 'asociatie_id')::uuid);
  perform pg_temp.pune('blocB', (r ->> 'bloc_id')::uuid);
  update organizare.blocuri set stare = 'activ', activat_la = now() where id = pg_temp.id('blocB');

  perform pg_temp.apartament('a1', pg_temp.id('bloc'), '1', 40);
  perform pg_temp.apartament('a2', pg_temp.id('bloc'), '2', 35);
  perform pg_temp.apartament('a3', pg_temp.id('bloc'), '3', 25);
  perform pg_temp.apartament('b1', pg_temp.id('blocB'), '1', 100);

  perform pg_temp.cont('adm');
  perform pg_temp.cont('admB');
  perform pg_temp.cont('pres');
  perform pg_temp.cont('neaprobat');
  perform pg_temp.cont('loc1');
  perform pg_temp.cont('chirias1');
  perform pg_temp.cont('loc2');
  perform pg_temp.cont('viitor');
  perform pg_temp.cont('fost3');
  perform pg_temp.cont('nou3');
  perform pg_temp.cont('locB');

  perform identitate.numeste_administrator(pg_temp.id('adm'), pg_temp.id('asoc'), 'AT-C-1');
  perform identitate.numeste_administrator(pg_temp.id('admB'), pg_temp.id('asocB'), 'AT-C-2');
  insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
  values (pg_temp.id('asoc'), pg_temp.id('pres'), 'presedinte', current_date - 30);
  -- Administrator inregistrat, legat de asociatie, dar neaprobat inca.
  insert into identitate.administratori (profil_id, numar_atestat) values (pg_temp.id('neaprobat'), 'AT-C-3');
  insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
  values (pg_temp.id('asoc'), pg_temp.id('neaprobat'), 'administrator', current_date - 30);

  perform pg_temp.locatar('loc1', 'a1', 'proprietar', current_date - 100);
  perform pg_temp.locatar('chirias1', 'a1', 'chirias', current_date - 100);
  perform pg_temp.locatar('loc2', 'a2', 'proprietar', current_date - 100);
  -- Acces viitor: legat de apartamentul 2 abia peste 5 zile.
  perform pg_temp.locatar('viitor', 'a2', 'membru_familie', current_date + 5);
  -- Apartamentul 3 si-a schimbat locatarul acum 10 zile.
  perform pg_temp.locatar('fost3', 'a3', 'proprietar', current_date - 400, current_date - 10);
  perform pg_temp.locatar('nou3', 'a3', 'proprietar', current_date - 10);
  perform pg_temp.locatar('locB', 'b1', 'proprietar', current_date - 100);
end;
$$;

select pg_temp.fixturi();

-- Situatia unui vot din guvernanta.situatie_voturi, dupa id.
create function pg_temp.vot(p_json jsonb, p_vot text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(p_json) x where x ->> 'id' = pg_temp.id(p_vot)::text
$$;
create function pg_temp.optiune(p_vot text, p_text text) returns uuid language sql stable as $$
  select o.id from guvernanta.voturi_optiuni o where o.vot_id = pg_temp.id(p_vot) and o.text = p_text
$$;

-- =============================================================================
-- deschide_vot
-- =============================================================================
select pg_temp.ca('loc1');
select throws_ok($$ select guvernanta.deschide_vot(pg_temp.id('asoc'), 'Vot', null, array['Da', 'Nu'], now() + interval '7 days') $$,
  'P0001', 'Doar administratorul poate deschide un vot.', 'guvernanta.deschide_vot: locatarul nu deschide voturi');
select pg_temp.ca('pres');
select throws_ok($$ select guvernanta.deschide_vot(pg_temp.id('asoc'), 'Vot', null, array['Da', 'Nu'], now() + interval '7 days') $$,
  'P0001', 'Doar administratorul poate deschide un vot.', 'deschide_vot: presedintele nu deschide voturi');
select pg_temp.ca('neaprobat');
select throws_ok($$ select guvernanta.deschide_vot(pg_temp.id('asoc'), 'Vot', null, array['Da', 'Nu'], now() + interval '7 days') $$,
  'P0001', 'Doar administratorul poate deschide un vot.', 'deschide_vot: administratorul neaprobat este refuzat');
select pg_temp.ca('admB');
select throws_ok($$ select guvernanta.deschide_vot(pg_temp.id('asoc'), 'Vot', null, array['Da', 'Nu'], now() + interval '7 days') $$,
  'P0001', 'Doar administratorul poate deschide un vot.', 'deschide_vot: administratorul altei asociatii este refuzat');

select pg_temp.ca('adm');
select throws_ok($$ select guvernanta.deschide_vot(pg_temp.id('asoc'), 'Vot', null, array['Da', '   ', null], now() + interval '7 days') $$,
  'P0001', 'Un vot are nevoie de cel putin doua variante.', 'deschide_vot: variantele goale nu se numara');
select throws_ok($$ select guvernanta.deschide_vot(pg_temp.id('asoc'), 'Vot', null, null, now() + interval '7 days') $$,
  'P0001', 'Un vot are nevoie de cel putin doua variante.', 'deschide_vot: fara variante');
select throws_ok($$ select guvernanta.deschide_vot(pg_temp.id('asoc'), 'Vot', null, array['Da', 'Nu'], now() - interval '1 minute') $$,
  'P0001', 'Data de inchidere trebuie sa fie in viitor.', 'deschide_vot: data de inchidere in trecut');
select throws_ok($$ select guvernanta.deschide_vot(pg_temp.id('asoc'), 'Vot', null, array['Da', 'Nu'], now() + interval '7 days', 'persoane') $$,
  '23514', null, 'deschide_vot: numararea este pe apartament sau pe cota');

select pg_temp.pune('v1', guvernanta.deschide_vot(pg_temp.id('asoc'), '  Schimbam usa  ', '   ', array[' Da ', 'Nu', ''], now() + interval '7 days'));
select pg_temp.pune('v2', guvernanta.deschide_vot(pg_temp.id('asoc'), 'Firma de curatenie', 'Trei oferte', array['A', 'B', 'C'], now() + interval '7 days', 'cota'));
select pg_temp.pune('v3', guvernanta.deschide_vot(pg_temp.id('asoc'), 'Vopsim scara', null, array['Da', 'Nu'], now() + interval '7 days'));
reset role;
select results_eq(
  $$ select titlu, descriere, numarare, creat_de from guvernanta.voturi where id = pg_temp.id('v1') $$,
  $$ values ('Schimbam usa'::text, null::text, 'apartament'::text, pg_temp.id('adm')) $$,
  'deschide_vot: titlul curatat, descrierea goala devine null, numararea implicita pe apartament');
select results_eq(
  $$ select text, ordine::int from guvernanta.voturi_optiuni where vot_id = pg_temp.id('v1') order by ordine $$,
  $$ values ('Da'::text, 1), ('Nu'::text, 2) $$,
  'deschide_vot: variantele curatate, in ordinea data, fara cele goale');
select results_eq(
  $$ select (date ->> 'asociatie_id')::uuid, date ->> 'titlu', (date ->> 'inchide_la') is not null from evenimente.coada
     where tip = 'VotDeschis' and agregat_id = pg_temp.id('v1') $$,
  $$ values (pg_temp.id('asoc'), 'Schimbam usa'::text, true) $$,
  'deschide_vot: emite VotDeschis');

-- voturi in afara ferestrei, puse direct
insert into guvernanta.voturi (id, asociatie_id, titlu, deschis_la, inchide_la)
values (pg_temp.pune('vinchis', gen_random_uuid()), pg_temp.id('asoc'), 'Vot inchis', now() - interval '10 days', now() - interval '1 day'),
       (pg_temp.pune('vviitor', gen_random_uuid()), pg_temp.id('asoc'), 'Vot viitor', now() + interval '1 day', now() + interval '5 days');
insert into guvernanta.voturi_optiuni (vot_id, text, ordine)
values (pg_temp.id('vinchis'), 'Da', 1), (pg_temp.id('vinchis'), 'Nu', 2), (pg_temp.id('vviitor'), 'Da', 1), (pg_temp.id('vviitor'), 'Nu', 2);

-- =============================================================================
-- voteaza
-- =============================================================================
select pg_temp.ca('loc1');
select throws_ok($$ select guvernanta.voteaza(pg_temp.id('v1'), pg_temp.optiune('v1', 'Da'), pg_temp.id('a2')) $$,
  'P0001', 'Poti vota doar pentru apartamentul tau.', 'guvernanta.voteaza: nu se voteaza pentru alt apartament');
select throws_ok($$ select guvernanta.voteaza(gen_random_uuid(), pg_temp.optiune('v1', 'Da'), pg_temp.id('a1')) $$,
  'P0001', 'Votul nu exista.', 'voteaza: vot inexistent');
select throws_ok($$ select guvernanta.voteaza(pg_temp.id('vinchis'), pg_temp.optiune('vinchis', 'Da'), pg_temp.id('a1')) $$,
  'P0001', 'Votul nu este deschis.', 'voteaza: votul s-a inchis');
select throws_ok($$ select guvernanta.voteaza(pg_temp.id('vviitor'), pg_temp.optiune('vviitor', 'Da'), pg_temp.id('a1')) $$,
  'P0001', 'Votul nu este deschis.', 'voteaza: votul nu s-a deschis inca');
select throws_ok($$ select guvernanta.voteaza(pg_temp.id('v1'), pg_temp.optiune('v2', 'A'), pg_temp.id('a1')) $$,
  'P0001', 'Optiunea nu apartine acestui vot.', 'voteaza: optiunea de pe alt buletin este refuzata');
select lives_ok($$ select guvernanta.voteaza(pg_temp.id('v1'), pg_temp.optiune('v1', 'Da'), pg_temp.id('a1')) $$,
  'voteaza: proprietarul voteaza pentru apartamentul lui');
select pg_temp.ca('chirias1');
select throws_ok($$ select guvernanta.voteaza(pg_temp.id('v1'), pg_temp.optiune('v1', 'Nu'), pg_temp.id('a1')) $$,
  'P0001', 'Apartamentul a votat deja.', 'voteaza: un singur vot pe apartament');
select pg_temp.ca('locB');
select throws_ok($$ select guvernanta.voteaza(pg_temp.id('v1'), pg_temp.optiune('v1', 'Da'), pg_temp.id('b1')) $$,
  'P0001', 'Votul nu exista.', 'voteaza: votul altei asociatii nu exista pentru apartamentul tau');
select pg_temp.ca('viitor');
select throws_ok($$ select guvernanta.voteaza(pg_temp.id('v1'), pg_temp.optiune('v1', 'Da'), pg_temp.id('a2')) $$,
  'P0001', 'Poti vota doar pentru apartamentul tau.', 'voteaza: locatarul cu acces viitor nu voteaza inca');
select pg_temp.ca('fost3');
select throws_ok($$ select guvernanta.voteaza(pg_temp.id('v1'), pg_temp.optiune('v1', 'Da'), pg_temp.id('a3')) $$,
  'P0001', 'Poti vota doar pentru apartamentul tau.', 'voteaza: fostul locatar nu mai voteaza');

select pg_temp.ca('loc2');
select guvernanta.voteaza(pg_temp.id('v2'), pg_temp.optiune('v2', 'B'), pg_temp.id('a2'));
select pg_temp.ca('nou3');
select guvernanta.voteaza(pg_temp.id('v2'), pg_temp.optiune('v2', 'B'), pg_temp.id('a3'));
reset role;
select results_eq(
  $$ select apartament_id, profil_id from guvernanta.voturi_exprimate where vot_id = pg_temp.id('v1') $$,
  $$ values (pg_temp.id('a1'), pg_temp.id('loc1')) $$,
  'voteaza: votul apartine apartamentului si pastreaza cine l-a dat');

select pg_temp.ca('chirias1');
select throws_ok($$ select guvernanta.voteaza(pg_temp.id('v3'), pg_temp.optiune('v3', 'Nu'), pg_temp.id('a1')) $$,
  'P0001', null, '[K3] chiriasul nu poate vota pentru apartament');
select pg_temp.ca('loc1');
select lives_ok($$ select guvernanta.voteaza(pg_temp.id('v3'), pg_temp.optiune('v3', 'Da'), pg_temp.id('a1')) $$,
  '[K3] proprietarul poate vota dupa ce chiriasul a incercat');

-- =============================================================================
-- RLS pe voturi
-- =============================================================================
select pg_temp.ca('loc1');
select throws_ok($$ insert into guvernanta.voturi_exprimate (vot_id, optiune_id, apartament_id) values (pg_temp.id('v2'), pg_temp.optiune('v2', 'A'), pg_temp.id('a1')) $$,
  '42501', null, 'guvernanta.voturi_exprimate: votul direct in tabel este refuzat');
select is((select count(*)::int from guvernanta.voturi where asociatie_id = pg_temp.id('asoc')), 5,
  'RLS "Voturile se vad in asociatie": locatarul vede voturile asociatiei');
select is((select count(*)::int from guvernanta.voturi_optiuni where vot_id = pg_temp.id('v2')), 3,
  'RLS "Optiunile se vad ca votul lor": locatarul vede variantele');
select is((select count(*)::int from guvernanta.voturi_exprimate where vot_id = pg_temp.id('v1')), 1,
  'RLS "Votul propriu si toate voturile pentru conducere": locatarul isi vede votul');
select is((select count(*)::int from guvernanta.voturi_exprimate where vot_id = pg_temp.id('v2')), 0,
  'RLS "Votul propriu si toate voturile pentru conducere": locatarul nu vede cum au votat vecinii');
select pg_temp.ca('chirias1');
select is((select count(*)::int from guvernanta.voturi_exprimate where vot_id = pg_temp.id('v1')), 1,
  'RLS "Votul propriu si toate voturile pentru conducere": colocatarul vede votul apartamentului');
select pg_temp.ca('adm');
select is((select count(*)::int from guvernanta.voturi_exprimate where vot_id = pg_temp.id('v2')), 2,
  'RLS "Votul propriu si toate voturile pentru conducere": administratorul vede toate voturile');
select pg_temp.ca('pres');
select is((select count(*)::int from guvernanta.voturi_exprimate where vot_id = pg_temp.id('v2')), 2,
  'RLS "Votul propriu si toate voturile pentru conducere": presedintele vede toate voturile');
select pg_temp.ca('admB');
select is((select count(*)::int from guvernanta.voturi_exprimate where vot_id in (pg_temp.id('v1'), pg_temp.id('v2'))), 0,
  'RLS "Votul propriu si toate voturile pentru conducere": administratorul strain nu vede nimic');
select pg_temp.ca('locB');
select is((select count(*)::int from guvernanta.voturi where asociatie_id = pg_temp.id('asoc')), 0,
  'RLS "Voturile se vad in asociatie": locatarul altei asociatii nu vede voturile');
select is((select count(*)::int from guvernanta.voturi_optiuni where vot_id = pg_temp.id('v1')), 0,
  'RLS "Optiunile se vad ca votul lor": locatarul altei asociatii nu vede variantele');
select pg_temp.ca('viitor');
select is((select count(*)::int from guvernanta.voturi where asociatie_id = pg_temp.id('asoc')), 0,
  'RLS "Voturile se vad in asociatie": locatarul cu acces viitor nu vede inca');
select pg_temp.ca('neaprobat');
select is((select count(*)::int from guvernanta.voturi where asociatie_id = pg_temp.id('asoc')), 0,
  'RLS "Voturile se vad in asociatie": administratorul neaprobat nu vede');

-- =============================================================================
-- situatie_voturi
-- =============================================================================
select pg_temp.ca('locB');
select throws_ok($$ select guvernanta.situatie_voturi(pg_temp.id('asoc')) $$,
  'P0001', 'Nu ai acces la aceasta asociatie.', 'guvernanta.situatie_voturi: asociatia altcuiva este refuzata');
select pg_temp.ca('loc1');
select results_eq(
  $$ select (v ->> 'votulMeu')::uuid, (v ->> 'votanti')::int, (v ->> 'totalApartamente')::int, v -> 'nevotate', v ->> 'titlu', v ->> 'numarare'
     from pg_temp.vot(guvernanta.situatie_voturi(pg_temp.id('asoc')), 'v1') v $$,
  $$ values (pg_temp.optiune('v1', 'Da'), 1, 3, 'null'::jsonb, 'Schimbam usa'::text, 'apartament'::text) $$,
  'situatie_voturi: locatarul vede votul lui si totalurile, fara lista celor care nu au votat');
select is(
  (select (o ->> 'voturi')::int from jsonb_array_elements(pg_temp.vot(guvernanta.situatie_voturi(pg_temp.id('asoc')), 'v1') -> 'optiuni') o where o ->> 'text' = 'Da'),
  1, 'situatie_voturi: rezultatul se numara din voturile exprimate');
select is(jsonb_array_length(guvernanta.situatie_voturi(pg_temp.id('asoc'))), 5,
  'situatie_voturi: toate voturile asociatiei');
select pg_temp.ca('adm');
select is(pg_temp.vot(guvernanta.situatie_voturi(pg_temp.id('asoc')), 'v1') -> 'nevotate', '["2", "3"]'::jsonb,
  'situatie_voturi: administratorul vede apartamentele care nu au votat');
select results_eq(
  $$ select o ->> 'text', (o ->> 'voturi')::int, (o ->> 'cote')::numeric
     from jsonb_array_elements(pg_temp.vot(guvernanta.situatie_voturi(pg_temp.id('asoc')), 'v2') -> 'optiuni') o $$,
  $$ values ('A'::text, 0, 0::numeric), ('B'::text, 2, 60::numeric), ('C'::text, 0, 0::numeric) $$,
  'situatie_voturi: la numararea pe cota se aduna cotele indivize, variantele in ordine');
select pg_temp.ca('pres');
select is(pg_temp.vot(guvernanta.situatie_voturi(pg_temp.id('asoc')), 'v2') -> 'nevotate', '["1"]'::jsonb,
  'situatie_voturi: presedintele vede si el cine nu a votat');
select pg_temp.ca('admB');
select is(guvernanta.situatie_voturi(pg_temp.id('asocB')), '[]'::jsonb,
  'situatie_voturi: asociatia fara voturi intoarce o lista goala');

-- =============================================================================
-- reaminteste_vot
-- =============================================================================
select pg_temp.ca('loc1');
select throws_ok($$ select guvernanta.reaminteste_vot(pg_temp.id('v1')) $$,
  'P0001', 'Votul nu exista.', 'guvernanta.reaminteste_vot: locatarul nu trimite reamintiri');
select pg_temp.ca('admB');
select throws_ok($$ select guvernanta.reaminteste_vot(pg_temp.id('v1')) $$,
  'P0001', 'Votul nu exista.', 'reaminteste_vot: administratorul altei asociatii este refuzat');
select pg_temp.ca('adm');
select throws_ok($$ select guvernanta.reaminteste_vot(gen_random_uuid()) $$,
  'P0001', 'Votul nu exista.', 'reaminteste_vot: vot inexistent');
select is((guvernanta.reaminteste_vot(pg_temp.id('v1')) ->> 'apartamente')::int, 2,
  'reaminteste_vot: doua apartamente nu au votat');
reset role;
select set_eq(
  $$ select jsonb_array_elements_text(date -> 'apartamente')::uuid from evenimente.coada where tip = 'VotReamintit' and agregat_id = pg_temp.id('v1') $$,
  $$ values (pg_temp.id('a2')), (pg_temp.id('a3')) $$,
  'reaminteste_vot: emite VotReamintit cu apartamentele care nu au votat');
select pg_temp.ca('adm');
select is((guvernanta.reaminteste_vot(pg_temp.id('v1')) ->> 'destinatari')::int, 2,
  '[K13] reaminteste_vot: destinatari = loc2 si nou3 (nu fostul, nu cel cu acces viitor)');
select throws_ok($$ select guvernanta.reaminteste_vot(pg_temp.id('vinchis')) $$,
  'P0001', null, '[K11] reaminteste_vot refuza un vot inchis');

-- =============================================================================
-- convoaca_adunare, confirma_prezenta, situatie_adunari
-- =============================================================================
select pg_temp.ca('loc1');
select throws_ok($$ select guvernanta.convoaca_adunare(pg_temp.id('asoc'), now() + interval '10 days', 'Sala', 'Buget') $$,
  'P0001', 'Doar administratorul poate convoca adunarea generala.', 'guvernanta.convoaca_adunare: locatarul nu convoaca');
select pg_temp.ca('pres');
select throws_ok($$ select guvernanta.convoaca_adunare(pg_temp.id('asoc'), now() + interval '10 days', 'Sala', 'Buget') $$,
  'P0001', 'Doar administratorul poate convoca adunarea generala.', 'convoaca_adunare: nici presedintele, prin aplicatie');
select pg_temp.ca('adm');
select throws_ok($$ select guvernanta.convoaca_adunare(pg_temp.id('asoc'), now() - interval '1 hour', 'Sala', 'Buget') $$,
  'P0001', 'Data adunarii trebuie sa fie in viitor.', 'convoaca_adunare: data in trecut');
select pg_temp.pune('ag1', guvernanta.convoaca_adunare(pg_temp.id('asoc'), now() + interval '10 days', '  Sala de la parter  ', '  Bugetul pe 2027  '));
reset role;
select results_eq(
  $$ select loc, ordine_de_zi, convocata_de from guvernanta.adunari_generale where id = pg_temp.id('ag1') $$,
  $$ values ('Sala de la parter'::text, 'Bugetul pe 2027'::text, pg_temp.id('adm')) $$,
  'convoaca_adunare: adunarea se salveaza curatata, cu cine a convocat-o');
select results_eq(
  $$ select date ->> 'loc', date ->> 'ordine_de_zi', (date ->> 'asociatie_id')::uuid from evenimente.coada where tip = 'AdunareConvocata' and agregat_id = pg_temp.id('ag1') $$,
  $$ values ('Sala de la parter'::text, 'Bugetul pe 2027'::text, pg_temp.id('asoc')) $$,
  'convoaca_adunare: emite AdunareConvocata');
insert into guvernanta.adunari_generale (id, asociatie_id, data_ora, loc, ordine_de_zi)
values (pg_temp.pune('agveche', gen_random_uuid()), pg_temp.id('asoc'), now() - interval '1 day', 'Sala', 'Trecuta');

select pg_temp.ca('loc1');
select throws_ok($$ select guvernanta.confirma_prezenta(pg_temp.id('ag1'), pg_temp.id('a2')) $$,
  'P0001', 'Poti confirma doar pentru apartamentul tau.', 'guvernanta.confirma_prezenta: doar pentru apartamentul tau');
select throws_ok($$ select guvernanta.confirma_prezenta(gen_random_uuid(), pg_temp.id('a1')) $$,
  'P0001', 'Adunarea nu exista sau a avut deja loc.', 'confirma_prezenta: adunare inexistenta');
select throws_ok($$ select guvernanta.confirma_prezenta(pg_temp.id('agveche'), pg_temp.id('a1')) $$,
  'P0001', 'Adunarea nu exista sau a avut deja loc.', 'confirma_prezenta: adunarea a avut deja loc');
select lives_ok($$ select guvernanta.confirma_prezenta(pg_temp.id('ag1'), pg_temp.id('a1')) $$,
  'confirma_prezenta: locatarul confirma');
select lives_ok($$ select guvernanta.confirma_prezenta(pg_temp.id('ag1'), pg_temp.id('a1')) $$,
  'confirma_prezenta: a doua confirmare nu strica nimic');
select pg_temp.ca('chirias1');
select guvernanta.confirma_prezenta(pg_temp.id('ag1'), pg_temp.id('a1'));
select pg_temp.ca('locB');
select throws_ok($$ select guvernanta.confirma_prezenta(pg_temp.id('ag1'), pg_temp.id('b1')) $$,
  'P0001', 'Adunarea nu exista sau a avut deja loc.', 'confirma_prezenta: adunarea altei asociatii');
reset role;
select results_eq(
  $$ select apartament_id, profil_id from guvernanta.adunari_prezente where adunare_id = pg_temp.id('ag1') $$,
  $$ values (pg_temp.id('a1'), pg_temp.id('loc1')) $$,
  'confirma_prezenta: o singura prezenta pe apartament, cu primul care a confirmat');

select pg_temp.ca('locB');
select throws_ok($$ select guvernanta.situatie_adunari(pg_temp.id('asoc')) $$,
  'P0001', 'Nu ai acces la aceasta asociatie.', 'guvernanta.situatie_adunari: asociatia altcuiva este refuzata');
select pg_temp.ca('loc1');
select results_eq(
  $$ select (g ->> 'prezente')::int, (g ->> 'totalApartamente')::int, (g ->> 'prezentaMea')::boolean, g ->> 'loc'
     from jsonb_array_elements(guvernanta.situatie_adunari(pg_temp.id('asoc'))) g where g ->> 'id' = pg_temp.id('ag1')::text $$,
  $$ values (1, 3, true, 'Sala de la parter'::text) $$,
  'situatie_adunari: prezenta numarata si prezenta mea');
select is((select jsonb_agg(g ->> 'ordineDeZi') from jsonb_array_elements(guvernanta.situatie_adunari(pg_temp.id('asoc'))) g),
  '["Bugetul pe 2027", "Trecuta"]'::jsonb, 'situatie_adunari: adunarile, cele mai noi primele');
select pg_temp.ca('loc2');
select is((select (g ->> 'prezentaMea')::boolean from jsonb_array_elements(guvernanta.situatie_adunari(pg_temp.id('asoc'))) g where g ->> 'id' = pg_temp.id('ag1')::text),
  false, 'situatie_adunari: vecinul nu a confirmat');
select pg_temp.ca('admB');
select is(guvernanta.situatie_adunari(pg_temp.id('asocB')), '[]'::jsonb, 'situatie_adunari: fara adunari, lista goala');

-- RLS pe adunari
select pg_temp.ca('loc2');
select is((select count(*)::int from guvernanta.adunari_generale where asociatie_id = pg_temp.id('asoc')), 2,
  'RLS "Adunarile se vad in asociatie": locatarul vede adunarile');
select is((select count(*)::int from guvernanta.adunari_prezente where adunare_id = pg_temp.id('ag1')), 0,
  'RLS "Prezenta proprie si toata prezenta pentru conducere": vecinul nu vede prezenta altora');
select pg_temp.ca('chirias1');
select is((select count(*)::int from guvernanta.adunari_prezente where adunare_id = pg_temp.id('ag1')), 1,
  'RLS "Prezenta proprie si toata prezenta pentru conducere": apartamentul isi vede prezenta');
select pg_temp.ca('adm');
select is((select count(*)::int from guvernanta.adunari_prezente where adunare_id = pg_temp.id('ag1')), 1,
  'RLS "Prezenta proprie si toata prezenta pentru conducere": administratorul vede prezenta');
select pg_temp.ca('pres');
select is((select count(*)::int from guvernanta.adunari_prezente where adunare_id = pg_temp.id('ag1')), 1,
  'RLS "Prezenta proprie si toata prezenta pentru conducere": presedintele vede prezenta');
select pg_temp.ca('admB');
select is((select count(*)::int from guvernanta.adunari_prezente where adunare_id = pg_temp.id('ag1')), 0,
  'RLS "Prezenta proprie si toata prezenta pentru conducere": administratorul strain nu vede');
select pg_temp.ca('locB');
select is((select count(*)::int from guvernanta.adunari_generale where asociatie_id = pg_temp.id('asoc')), 0,
  'RLS "Adunarile se vad in asociatie": locatarul altei asociatii nu vede adunarile');
select pg_temp.ca('loc1');
select throws_ok($$ insert into guvernanta.adunari_prezente (adunare_id, apartament_id) values (pg_temp.id('agveche'), pg_temp.id('a1')) $$,
  '42501', null, 'guvernanta.adunari_prezente: prezenta directa in tabel este refuzata');
reset role;

select * from finish();
rollback;
