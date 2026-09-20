-- Teste pgTAP pentru comunicare (migratia 20260919120021_comunicare.sql): anunturi, notificari, remindere manuale, RLS.
-- Toate datele sunt create aici si se anuleaza la rollback.
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

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

-- Notificarile primite de un utilizator, dupa tip.
create function pg_temp.notificari(k text, p_tip text) returns int language sql stable as $$
  select count(*)::int from comunicare.notificari where profil_id = pg_temp.id(k) and tip = p_tip
$$;

-- =============================================================================
-- Functiile interne
-- =============================================================================
select is(comunicare.luna_text('2026-09-15'), 'septembrie 2026', 'comunicare.luna_text: luna si anul in romana');
select is(comunicare.luna_text('2027-01-01'), 'ianuarie 2027', 'luna_text: ianuarie');
select is(comunicare.luna_text('2026-12-31'), 'decembrie 2026', 'luna_text: decembrie');
select is(comunicare.data_text('2026-03-05'), '5 martie 2026', 'comunicare.data_text: ziua fara zero in fata');

select comunicare.notifica(pg_temp.id('loc1'), pg_temp.id('asoc'), 'test', 'Titlu test', 'Corp test', '{"x": 1}');
select results_eq(
  $$ select asociatie_id, titlu, corp, canal, citita_la is null, referinta from comunicare.notificari where profil_id = pg_temp.id('loc1') and tip = 'test' $$,
  $$ values (pg_temp.id('asoc'), 'Titlu test'::text, 'Corp test'::text, 'aplicatie'::text, true, '{"x": 1}'::jsonb) $$,
  'comunicare.notifica: scrie notificarea in aplicatie, necitita');

select set_eq(
  $$ select comunicare.locatari_apartamente(array[pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3')]) $$,
  $$ values (pg_temp.id('loc1')), (pg_temp.id('chirias1')), (pg_temp.id('loc2')), (pg_temp.id('nou3')) $$,
  'comunicare.locatari_apartamente: doar locatarii activi azi (fara fostul si fara cel cu acces viitor)');
select is(comunicare.asociatie_apartament(pg_temp.id('a2')), pg_temp.id('asoc'), 'comunicare.asociatie_apartament: asociatia apartamentului');

-- Datorii: a1 nescadenta, a2 restanta, a3 restanta dar platita.
insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere) values
  (pg_temp.id('a1'), pg_temp.id('bloc'), 'sold_initial', 100, current_date + 5, 'Test nescadent'),
  (pg_temp.id('a2'), pg_temp.id('bloc'), 'sold_initial', 50, current_date - 5, 'Test restant'),
  (pg_temp.id('a3'), pg_temp.id('bloc'), 'sold_initial', 30, current_date - 5, 'Test platit');
select financiar.inregistreaza_plata(pg_temp.id('a3'), 30, 'numerar');
select set_eq($$ select comunicare.apartamente_cu_sold(pg_temp.id('bloc'), false) $$,
  $$ values (pg_temp.id('a1')), (pg_temp.id('a2')) $$,
  'comunicare.apartamente_cu_sold: toate datoriile neachitate; cea platita nu conteaza');
select set_eq($$ select comunicare.apartamente_cu_sold(pg_temp.id('bloc'), true) $$,
  $$ values (pg_temp.id('a2')) $$,
  'apartamente_cu_sold: doar restantele trecute de scadenta');

select pg_temp.ca('loc1');
select throws_ok($$ select comunicare.notifica(pg_temp.id('loc2'), null, 'x', 'Fals', null) $$,
  '42501', null, 'notifica: locatarul nu poate trimite notificari direct');
select throws_ok($$ select comunicare.locatari_apartamente(array[pg_temp.id('a2')]) $$,
  '42501', null, 'locatari_apartamente: nu este expusa utilizatorilor');

-- =============================================================================
-- publica_anunt
-- =============================================================================
select throws_ok($$ select comunicare.publica_anunt(pg_temp.id('bloc'), 'Anunt', 'Corp') $$,
  'P0001', 'Doar administratorul publica anunturi.', 'comunicare.publica_anunt: locatarul nu publica');
select pg_temp.ca('pres');
select throws_ok($$ select comunicare.publica_anunt(pg_temp.id('bloc'), 'Anunt', 'Corp') $$,
  'P0001', 'Doar administratorul publica anunturi.', 'publica_anunt: presedintele nu publica');
select pg_temp.ca('admB');
select throws_ok($$ select comunicare.publica_anunt(pg_temp.id('bloc'), 'Anunt', 'Corp') $$,
  'P0001', 'Doar administratorul publica anunturi.', 'publica_anunt: administratorul altei asociatii nu publica');

select pg_temp.ca('adm');
select pg_temp.pune('an1', comunicare.publica_anunt(pg_temp.id('bloc'), '  Curatenie  ', '  Sambata la 10  '));
select pg_temp.pune('an2', comunicare.publica_anunt(pg_temp.id('bloc'), 'Oprire apa', 'Maine intre 9 si 12', true));
select pg_temp.pune('an3', comunicare.publica_anunt(pg_temp.id('bloc'), 'Fara urgenta', 'Null', null));
reset role;
select results_eq(
  $$ select asociatie_id, bloc_id, autor_id, titlu, corp, urgent from comunicare.anunturi where id = pg_temp.id('an1') $$,
  $$ values (pg_temp.id('asoc'), pg_temp.id('bloc'), pg_temp.id('adm'), 'Curatenie'::text, 'Sambata la 10'::text, false) $$,
  'publica_anunt: anuntul curatat, cu autorul');
select is((select count(*)::int from comunicare.notificari where referinta ->> 'anunt_id' in (pg_temp.id('an1')::text, pg_temp.id('an3')::text)), 0,
  'publica_anunt: un anunt obisnuit nu trimite notificari');
select is((select urgent from comunicare.anunturi where id = pg_temp.id('an3')), false, 'publica_anunt: urgent null inseamna neurgent');
select set_eq(
  $$ select profil_id from comunicare.notificari where referinta ->> 'anunt_id' = pg_temp.id('an2')::text and profil_id <> pg_temp.id('viitor') $$,
  $$ values (pg_temp.id('loc1')), (pg_temp.id('chirias1')), (pg_temp.id('loc2')), (pg_temp.id('nou3')) $$,
  'publica_anunt: anuntul urgent ajunge la locatarii blocului, nu la fostul locatar sau la alt bloc');
select results_eq(
  $$ select titlu, corp, tip, asociatie_id from comunicare.notificari where referinta ->> 'anunt_id' = pg_temp.id('an2')::text and profil_id = pg_temp.id('loc1') $$,
  $$ values ('Urgent: Oprire apa'::text, 'Maine intre 9 si 12'::text, 'anunt'::text, pg_temp.id('asoc')) $$,
  'publica_anunt: notificarea urgenta are titlul marcat');
select is(pg_temp.notificari('viitor', 'anunt'), 0, '[K13] publica_anunt: locatarul cu acces viitor nu este notificat');

-- Anunt pentru toata asociatia si anunt pentru alt bloc al asociatiei.
insert into organizare.blocuri (id, asociatie_id, denumire, adresa, etaje)
values (pg_temp.pune('bloc2', gen_random_uuid()), pg_temp.id('asoc'), 'Bloc C2', 'Strada Testului 3', 2);
insert into comunicare.anunturi (id, asociatie_id, bloc_id, titlu, corp)
values (pg_temp.pune('an_asoc', gen_random_uuid()), pg_temp.id('asoc'), null, 'Pentru toata asociatia', 'x'),
       (pg_temp.pune('an_bloc2', gen_random_uuid()), pg_temp.id('asoc'), pg_temp.id('bloc2'), 'Doar pentru blocul 2', 'x');

select pg_temp.ca('loc1');
select set_eq($$ select id from comunicare.anunturi where asociatie_id = pg_temp.id('asoc') $$,
  $$ values (pg_temp.id('an1')), (pg_temp.id('an2')), (pg_temp.id('an3')), (pg_temp.id('an_asoc')) $$,
  'RLS "Anunturile se vad in asociatie si in bloc": anunturile blocului si ale asociatiei, nu ale altui bloc');
select pg_temp.ca('adm');
select is((select count(*)::int from comunicare.anunturi where asociatie_id = pg_temp.id('asoc')), 5,
  'RLS "Anunturile se vad in asociatie si in bloc": administratorul vede toate blocurile');
select pg_temp.ca('locB');
select is((select count(*)::int from comunicare.anunturi where asociatie_id = pg_temp.id('asoc')), 0,
  'RLS "Anunturile se vad in asociatie si in bloc": alta asociatie nu vede nimic');
select pg_temp.ca('fost3');
select is((select count(*)::int from comunicare.anunturi where asociatie_id = pg_temp.id('asoc')), 0,
  'RLS "Anunturile se vad in asociatie si in bloc": fostul locatar nu mai vede avizierul');

-- =============================================================================
-- marcheaza_anunt_citit
-- =============================================================================
select pg_temp.ca('locB');
select throws_ok($$ select comunicare.marcheaza_anunt_citit(pg_temp.id('an1')) $$,
  'P0001', 'Anuntul nu exista.', 'comunicare.marcheaza_anunt_citit: anuntul altei asociatii');
select pg_temp.ca('loc1');
select throws_ok($$ select comunicare.marcheaza_anunt_citit(gen_random_uuid()) $$,
  'P0001', 'Anuntul nu exista.', 'marcheaza_anunt_citit: anunt inexistent');
select lives_ok($$ select comunicare.marcheaza_anunt_citit(pg_temp.id('an1')) $$, 'marcheaza_anunt_citit: locatarul citeste anuntul');
select lives_ok($$ select comunicare.marcheaza_anunt_citit(pg_temp.id('an1')) $$, 'marcheaza_anunt_citit: a doua citire nu strica nimic');
select pg_temp.ca('loc2');
select comunicare.marcheaza_anunt_citit(pg_temp.id('an1'));
reset role;
select is((select count(*)::int from comunicare.anunturi_citiri where anunt_id = pg_temp.id('an1')), 2,
  'marcheaza_anunt_citit: o citire pe om');

select pg_temp.ca('loc1');
select results_eq($$ select profil_id from comunicare.anunturi_citiri where anunt_id = pg_temp.id('an1') $$,
  $$ values (pg_temp.id('loc1')) $$,
  'RLS "Citirea proprie si toate citirile pentru conducere": locatarul isi vede doar citirea lui');
select pg_temp.ca('adm');
select is((select count(*)::int from comunicare.anunturi_citiri where anunt_id = pg_temp.id('an1')), 2,
  'RLS "Citirea proprie si toate citirile pentru conducere": administratorul vede cine a citit');
select pg_temp.ca('pres');
select is((select count(*)::int from comunicare.anunturi_citiri where anunt_id = pg_temp.id('an1')), 2,
  'RLS "Citirea proprie si toate citirile pentru conducere": presedintele vede cine a citit');
select pg_temp.ca('admB');
select is((select count(*)::int from comunicare.anunturi_citiri where anunt_id = pg_temp.id('an1')), 0,
  'RLS "Citirea proprie si toate citirile pentru conducere": administratorul strain nu vede');

-- =============================================================================
-- marcheaza_notificare_citita si RLS pe notificari
-- =============================================================================
reset role;
select pg_temp.pune('n_loc1', (select id from comunicare.notificari where profil_id = pg_temp.id('loc1') and tip = 'test'));
select pg_temp.pune('n_loc2', (select id from comunicare.notificari where profil_id = pg_temp.id('loc2') and tip = 'anunt'));
select pg_temp.ca('loc2');
select comunicare.marcheaza_notificare_citita(pg_temp.id('n_loc1'));
reset role;
select is((select citita_la from comunicare.notificari where id = pg_temp.id('n_loc1')), null,
  'comunicare.marcheaza_notificare_citita: nu poti marca notificarea altcuiva');
select pg_temp.ca('loc1');
select comunicare.marcheaza_notificare_citita(pg_temp.id('n_loc1'));
reset role;
select isnt((select citita_la from comunicare.notificari where id = pg_temp.id('n_loc1')), null,
  'marcheaza_notificare_citita: notificarea proprie devine citita');
update comunicare.notificari set citita_la = now() - interval '3 days' where id = pg_temp.id('n_loc1');
select pg_temp.ca('loc1');
select comunicare.marcheaza_notificare_citita(pg_temp.id('n_loc1'));
reset role;
select ok((select citita_la < now() - interval '2 days' from comunicare.notificari where id = pg_temp.id('n_loc1')),
  'marcheaza_notificare_citita: momentul primei citiri nu se schimba');

select pg_temp.ca('loc1');
select is((select count(*)::int from comunicare.notificari where id = pg_temp.id('n_loc2')), 0,
  'RLS "Fiecare isi vede notificarile": locatarul nu vede notificarile vecinului');
select is((select count(*)::int from comunicare.notificari where id = pg_temp.id('n_loc1')), 1,
  'RLS "Fiecare isi vede notificarile": locatarul isi vede notificarile');
select pg_temp.ca('adm');
select is((select count(*)::int from comunicare.notificari where profil_id in (pg_temp.id('loc1'), pg_temp.id('loc2'))), 0,
  'RLS "Fiecare isi vede notificarile": nici administratorul nu citeste notificarile locatarilor');

-- =============================================================================
-- seteaza_reminder si RLS pe remindere
-- =============================================================================
select pg_temp.ca('loc1');
select throws_ok($$ select comunicare.seteaza_reminder(pg_temp.id('asoc'), 'plata', false, 7::smallint) $$,
  'P0001', 'Doar administratorul schimba reminderele.', 'comunicare.seteaza_reminder: locatarul nu schimba reminderele');
select is((select count(*)::int from comunicare.remindere_setari where asociatie_id = pg_temp.id('asoc')), 0,
  'RLS "Reminderele se vad de conducere": locatarul nu vede reminderele');
select pg_temp.ca('pres');
select throws_ok($$ select comunicare.seteaza_reminder(pg_temp.id('asoc'), 'plata', false, 7::smallint) $$,
  'P0001', 'Doar administratorul schimba reminderele.', 'seteaza_reminder: presedintele doar le vede');
select is((select count(*)::int from comunicare.remindere_setari where asociatie_id = pg_temp.id('asoc')), 5,
  'RLS "Reminderele se vad de conducere": presedintele vede cele cinci remindere');
select pg_temp.ca('admB');
select throws_ok($$ select comunicare.seteaza_reminder(pg_temp.id('asoc'), 'plata', false, 7::smallint) $$,
  'P0001', 'Doar administratorul schimba reminderele.', 'seteaza_reminder: administratorul altei asociatii');
select is((select count(*)::int from comunicare.remindere_setari where asociatie_id = pg_temp.id('asoc')), 0,
  'RLS "Reminderele se vad de conducere": administratorul strain nu le vede');
select pg_temp.ca('adm');
select comunicare.seteaza_reminder(pg_temp.id('asoc'), 'plata', false, 7::smallint);
select results_eq($$ select activ, zile::int from comunicare.remindere_setari where asociatie_id = pg_temp.id('asoc') and tip = 'plata' $$,
  $$ values (false, 7) $$, 'seteaza_reminder: administratorul opreste reminderul si schimba zilele');
select comunicare.seteaza_reminder(pg_temp.id('asoc'), 'plata', true);
select results_eq($$ select activ, zile::int from comunicare.remindere_setari where asociatie_id = pg_temp.id('asoc') and tip = 'plata' $$,
  $$ values (true, 7) $$, 'seteaza_reminder: fara zile, zilele raman cele de dinainte');
select throws_ok($$ select comunicare.seteaza_reminder(pg_temp.id('asoc'), 'plata', true, 61::smallint) $$,
  '23514', null, 'seteaza_reminder: cel mult 60 de zile');

-- =============================================================================
-- trimite_reminder
-- =============================================================================
select throws_ok($$ select comunicare.trimite_reminder(pg_temp.id('bloc'), 'lista_publicata') $$,
  'P0001', 'Reminderul lista_publicata nu se trimite manual.', 'comunicare.trimite_reminder: lista publicata pleaca doar din eveniment');
select throws_ok($$ select comunicare.trimite_reminder(pg_temp.id('bloc'), 'adunare_generala') $$,
  'P0001', 'Reminderul adunare_generala nu se trimite manual.', 'trimite_reminder: nici reminderul de adunare');

-- Citiri: a1 are citirea lunii trimisa, a2 una respinsa, a3 niciuna.
reset role;
update contorizare.setari_contorizare set zi_limita_citire = 12 where bloc_id = pg_temp.id('bloc');
insert into contorizare.contoare (id, bloc_id, apartament_id, tip) values
  (pg_temp.pune('c1', gen_random_uuid()), pg_temp.id('bloc'), pg_temp.id('a1'), 'rece'),
  (pg_temp.pune('c2', gen_random_uuid()), pg_temp.id('bloc'), pg_temp.id('a2'), 'rece');
insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare, motiv_respingere) values
  (pg_temp.id('c1'), 'rece', pg_temp.id('bloc'), pg_temp.id('a1'), date_trunc('month', current_date)::date, 10, 12, 'locatar', 'trimisa', null),
  (pg_temp.id('c2'), 'rece', pg_temp.id('bloc'), pg_temp.id('a2'), date_trunc('month', current_date)::date, 10, 11, 'locatar', 'respinsa', 'Poza neclara');

select pg_temp.ca('adm');
select is(comunicare.trimite_reminder(pg_temp.id('bloc'), 'citire_contoare'), '{"apartamente": 2, "destinatari": 2}'::jsonb,
  'trimite_reminder citire_contoare: apartamentele fara citire valabila in luna curenta (a2 respinsa, a3 lipsa)');
reset role;
select set_eq($$ select profil_id from comunicare.notificari where tip = 'citire_contoare' and asociatie_id = pg_temp.id('asoc') $$,
  $$ values (pg_temp.id('loc2')), (pg_temp.id('nou3')) $$,
  'trimite_reminder citire_contoare: ajunge la locatarii activi ai acelor apartamente');
select is((select corp from comunicare.notificari where tip = 'citire_contoare' and profil_id = pg_temp.id('loc2')),
  'Te rugam sa transmiti indexul contoarelor pana pe ' || comunicare.data_text(date_trunc('month', current_date)::date + 11) || ', cu o poza a contoarelor.',
  'trimite_reminder citire_contoare: termenul este ziua limita a blocului din luna curenta');

select pg_temp.ca('adm');
select is(comunicare.trimite_reminder(pg_temp.id('bloc'), 'restanta'), '{"apartamente": 1, "destinatari": 1}'::jsonb,
  'trimite_reminder restanta: doar apartamentele cu datorii trecute de scadenta');
select is(comunicare.trimite_reminder(pg_temp.id('bloc'), 'plata'), '{"apartamente": 2, "destinatari": 3}'::jsonb,
  'trimite_reminder plata: apartamentele cu orice datorie neachitata');
reset role;
-- distinct: apelul de mai sus (restanta) si redirectarea din 'plata' pentru
-- acelasi apartament deja restant (K5) trimit acelasi text, catre acelasi om.
select results_eq($$ select distinct titlu, corp from comunicare.notificari where tip = 'restanta' and profil_id = pg_temp.id('loc2') $$,
  $$ values ('Instiintare de plata'::text, 'Aveti sume neachitate trecute de scadenta. Va rugam sa le achitati ca sa opriti penalizarile.'::text) $$,
  'trimite_reminder restanta: textul instiintarii');
select is(pg_temp.notificari('loc1', 'restanta'), 0, 'trimite_reminder restanta: cine nu e restant nu primeste instiintare');
select is(pg_temp.notificari('loc2', 'plata'), 0, '[K5] trimite_reminder plata: restantierul nu primeste "se apropie termenul"');

-- Refuzul: sub psql, session_user = postgres face private.este_serviciu() adevarata
-- pentru orice rol. Inlocuim functia, doar in aceasta tranzactie, cu ramura
-- service_role (cea care conteaza prin API), ca refuzul sa poata fi observat.
select pg_temp.ca('loc1');
select ok(private.este_serviciu(), 'private.este_serviciu: sub psql (session_user postgres) este adevarata si pentru locatar');
reset role;
create or replace function private.este_serviciu()
returns boolean language sql stable set search_path = ''
as $$ select coalesce(auth.role(), '') = 'service_role' $$;

select pg_temp.ca('loc1');
select ok(not private.este_serviciu(), 'private.este_serviciu (fara ramura postgres): locatarul nu este serviciu');
select throws_ok($$ select comunicare.trimite_reminder(pg_temp.id('bloc'), 'restanta') $$,
  'P0001', 'Doar administratorul trimite remindere.', 'trimite_reminder: locatarul este refuzat');
select pg_temp.ca('adm');
select throws_ok($$ select comunicare.trimite_reminder(pg_temp.id('blocB'), 'restanta') $$,
  'P0001', 'Doar administratorul trimite remindere.', 'trimite_reminder: administratorul altei asociatii este refuzat');
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select lives_ok($$ select comunicare.trimite_reminder(pg_temp.id('blocB'), 'restanta') $$,
  'trimite_reminder: service_role trimite pentru orice bloc');
select set_config('request.jwt.claims', '', true);

-- =============================================================================
-- trimite_instiintare
-- =============================================================================
select pg_temp.ca('loc1');
select throws_ok($$ select comunicare.trimite_instiintare(pg_temp.id('a2')) $$,
  'P0001', 'Apartamentul nu este din blocul tau.', 'comunicare.trimite_instiintare: locatarul este refuzat');
select pg_temp.ca('admB');
select throws_ok($$ select comunicare.trimite_instiintare(pg_temp.id('a2')) $$,
  'P0001', 'Apartamentul nu este din blocul tau.', 'trimite_instiintare: administratorul altei asociatii este refuzat');
select pg_temp.ca('adm');
select is(comunicare.trimite_instiintare(pg_temp.id('a1')), '{"destinatari": 2}'::jsonb,
  'trimite_instiintare: toti locatarii activi ai apartamentului');
reset role;
select results_eq(
  $$ select asociatie_id, titlu, (referinta ->> 'apartament_id')::uuid from comunicare.notificari where tip = 'restanta' and profil_id = pg_temp.id('chirias1') $$,
  $$ values (pg_temp.id('asoc'), 'Instiintare de plata'::text, pg_temp.id('a1')) $$,
  'trimite_instiintare: instiintarea are asociatia si apartamentul');

select * from finish();
rollback;
