-- Teste pgTAP pentru handlerele Comunicare rutate din evenimente.proceseaza si pentru comunicare.trimite_remindere_zilnice (migratiile 20260919120021 si 20260919120023).
-- Toate datele sunt create aici si se anuleaza la rollback.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

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

-- Ultimul eveniment de un tip pentru un agregat, si procesarea lui.
create function pg_temp.eveniment(p_tip text, p_agregat uuid) returns bigint language sql stable as $$
  select max(id) from evenimente.coada where tip = p_tip and agregat_id = p_agregat
$$;
create function pg_temp.notificari(k text, p_tip text) returns int language sql stable as $$
  select count(*)::int from comunicare.notificari where profil_id = pg_temp.id(k) and tip = p_tip
$$;
create function pg_temp.destinatari(p_tip text) returns setof uuid language sql stable as $$
  select profil_id from comunicare.notificari
  where tip = p_tip and profil_id in (select pg_temp.id(k) from unnest(array['adm','admB','pres','neaprobat','loc1','chirias1','loc2','viitor','fost3','nou3','locB']) k)
$$;
create function pg_temp.curata() returns void language sql as $$
  delete from comunicare.notificari
  where profil_id in (select pg_temp.id(k) from unnest(array['adm','admB','pres','neaprobat','loc1','chirias1','loc2','viitor','fost3','nou3','locB']) k)
$$;

-- =============================================================================
-- ListaPublicata -> comunicare.la_lista_publicata
-- =============================================================================
insert into intretinere.liste_lunare (id, bloc_id, luna, stare, scadenta, publicata_la, total_repartizat)
values (pg_temp.pune('lista', gen_random_uuid()), pg_temp.id('bloc'), '2026-08-01', 'publicata', '2026-09-25', now(), 0);
select evenimente.inregistreaza('ListaPublicata', 'intretinere', pg_temp.id('lista'), jsonb_build_object(
  'lista_id', pg_temp.id('lista'), 'bloc_id', pg_temp.id('bloc'), 'asociatie_id', pg_temp.id('asoc'),
  'luna', '2026-08-01', 'versiune', 1, 'scadenta', '2026-09-25'));
select is(evenimente.proceseaza(pg_temp.eveniment('ListaPublicata', pg_temp.id('lista'))), true,
  'evenimente.proceseaza: ListaPublicata se proceseaza');
select isnt((select procesat_la from evenimente.coada where id = pg_temp.eveniment('ListaPublicata', pg_temp.id('lista'))), null,
  'evenimente.proceseaza: evenimentul este marcat procesat');
select is(evenimente.proceseaza(pg_temp.eveniment('ListaPublicata', pg_temp.id('lista'))), false,
  'evenimente.proceseaza: un eveniment procesat nu se mai proceseaza');
select set_eq($$ select pg_temp.destinatari('lista_publicata') except select pg_temp.id('viitor') $$,
  $$ values (pg_temp.id('loc1')), (pg_temp.id('chirias1')), (pg_temp.id('loc2')), (pg_temp.id('nou3')) $$,
  'comunicare.la_lista_publicata: toti locatarii activi ai blocului, nu fostul locatar sau alt bloc');
select results_eq(
  $$ select titlu, corp, asociatie_id, referinta ->> 'lista_id' from comunicare.notificari where tip = 'lista_publicata' and profil_id = pg_temp.id('loc1') $$,
  $$ values ('Lista pe august 2026 a fost publicata'::text,
             'Vezi in aplicatie cat ai de plata si cum s-a calculat fiecare suma. Termenul de plata este 25 septembrie 2026.'::text,
             pg_temp.id('asoc'), pg_temp.id('lista')::text) $$,
  'la_lista_publicata: luna, termenul si lista in notificare');
select is(pg_temp.notificari('viitor', 'lista_publicata'), 0, '[K13] la_lista_publicata: locatarul cu acces viitor nu este notificat');

select pg_temp.curata();
update comunicare.remindere_setari set activ = false where asociatie_id = pg_temp.id('asoc') and tip = 'lista_publicata';
select comunicare.la_lista_publicata(jsonb_build_object(
  'lista_id', pg_temp.id('lista'), 'bloc_id', pg_temp.id('bloc'), 'asociatie_id', pg_temp.id('asoc'), 'luna', '2026-08-01', 'scadenta', '2026-09-25'));
select is((select count(*)::int from pg_temp.destinatari('lista_publicata')), 0,
  'la_lista_publicata: reminderul oprit nu trimite nimic');

-- =============================================================================
-- ListaRecalculata -> comunicare.la_lista_recalculata
-- =============================================================================
select evenimente.inregistreaza('ListaRecalculata', 'intretinere', pg_temp.id('lista'), jsonb_build_object(
  'lista_id', pg_temp.id('lista'), 'bloc_id', pg_temp.id('bloc'), 'luna', '2026-08-01', 'versiune_veche', 1, 'versiune', 2));
select is(evenimente.proceseaza(pg_temp.eveniment('ListaRecalculata', pg_temp.id('lista'))), true,
  'evenimente.proceseaza: ListaRecalculata se proceseaza');
select set_eq($$ select pg_temp.destinatari('lista_recalculata') except select pg_temp.id('viitor') $$,
  $$ values (pg_temp.id('loc1')), (pg_temp.id('chirias1')), (pg_temp.id('loc2')), (pg_temp.id('nou3')) $$,
  'comunicare.la_lista_recalculata: toti locatarii activi ai blocului (fara conditia reminderului)');
select results_eq(
  $$ select titlu, asociatie_id from comunicare.notificari where tip = 'lista_recalculata' and profil_id = pg_temp.id('loc2') $$,
  $$ values ('Lista pe august 2026 a fost corectata'::text, pg_temp.id('asoc')) $$,
  'la_lista_recalculata: titlul spune ce luna s-a corectat, asociatia vine din bloc');
select is(pg_temp.notificari('viitor', 'lista_recalculata'), 0, '[K13] la_lista_recalculata: locatarul cu acces viitor nu este notificat');

-- =============================================================================
-- CitireRespinsa -> comunicare.la_citire_respinsa (lantul real, din valideaza_citire)
-- =============================================================================
insert into contorizare.contoare (id, bloc_id, apartament_id, tip)
values (pg_temp.pune('c2', gen_random_uuid()), pg_temp.id('bloc'), pg_temp.id('a2'), 'rece');
insert into contorizare.citiri (id, contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa)
values (pg_temp.pune('cit2', gen_random_uuid()), pg_temp.id('c2'), 'rece', pg_temp.id('bloc'), pg_temp.id('a2'), date_trunc('month', current_date)::date, 10, 99, 'locatar');
select pg_temp.ca('adm');
select contorizare.valideaza_citire(pg_temp.id('cit2'), false, 'Poza nu se vede.');
reset role;
select is(evenimente.proceseaza(pg_temp.eveniment('CitireRespinsa', pg_temp.id('c2'))), true,
  'evenimente.proceseaza: CitireRespinsa se proceseaza');
select results_eq(
  $$ select profil_id, titlu, corp, asociatie_id, referinta ->> 'citire_id' from comunicare.notificari where tip = 'citire'
     and profil_id in (select pg_temp.destinatari('citire')) $$,
  $$ values (pg_temp.id('loc2'), 'Indexul trimis a fost respins'::text, 'Poza nu se vede. Te rugam sa trimiti din nou indexul, cu o poza clara.'::text,
             pg_temp.id('asoc'), pg_temp.id('cit2')::text) $$,
  'comunicare.la_citire_respinsa: doar locatarul activ al apartamentului, cu motivul');

-- =============================================================================
-- SesizareRaspuns / SesizareRezolvata -> comunicare.la_sesizare
-- =============================================================================
select pg_temp.ca('loc1');
select pg_temp.pune('s1', sesizari.adauga_sesizare(pg_temp.id('a1'), 'Bec ars', 'iluminat', ''));
select pg_temp.ca('adm');
select sesizari.scrie_mesaj(pg_temp.id('s1'), 'Il schimbam azi');
reset role;
select is(evenimente.proceseaza(pg_temp.eveniment('SesizareDeschisa', pg_temp.id('s1'))), true,
  'evenimente.proceseaza: SesizareDeschisa nu are consumator, dar se marcheaza procesat');
select is((select count(*)::int from pg_temp.destinatari('sesizare')), 0, 'SesizareDeschisa: nicio notificare');
select is(evenimente.proceseaza(pg_temp.eveniment('SesizareRaspuns', pg_temp.id('s1'))), true,
  'evenimente.proceseaza: SesizareRaspuns se proceseaza');
select set_eq($$ select pg_temp.destinatari('sesizare') $$, $$ values (pg_temp.id('loc1')), (pg_temp.id('chirias1')) $$,
  'comunicare.la_sesizare: raspunsul ajunge la locatarii apartamentului');
select results_eq(
  $$ select titlu, corp, referinta ->> 'sesizare_id' from comunicare.notificari where tip = 'sesizare' and profil_id = pg_temp.id('loc1') $$,
  $$ values ('Raspuns la sesizarea ta'::text, 'Bec ars: Il schimbam azi'::text, pg_temp.id('s1')::text) $$,
  'la_sesizare: titlul sesizarii si textul raspunsului');
select pg_temp.curata();
select pg_temp.ca('adm');
select sesizari.rezolva_sesizare(pg_temp.id('s1'));
reset role;
select is(evenimente.proceseaza(pg_temp.eveniment('SesizareRezolvata', pg_temp.id('s1'))), true,
  'evenimente.proceseaza: SesizareRezolvata se proceseaza');
select results_eq(
  $$ select profil_id, titlu, corp from comunicare.notificari where tip = 'sesizare' and profil_id in (select pg_temp.destinatari('sesizare')) order by profil_id = pg_temp.id('loc1') $$,
  $$ select pg_temp.id(k), 'Sesizare rezolvata'::text, 'Bec ars'::text from unnest(array['chirias1', 'loc1']) k $$,
  'la_sesizare: rezolvarea ajunge la locatarii apartamentului');
select pg_temp.curata();
select comunicare.la_sesizare('SesizareDeschisa', jsonb_build_object('apartament_id', pg_temp.id('a1'), 'titlu', 'x'));
select is((select count(*)::int from pg_temp.destinatari('sesizare')), 0, 'la_sesizare: alt tip de eveniment nu trimite nimic');

-- =============================================================================
-- PlataConfirmata -> comunicare.la_plata_confirmata
-- =============================================================================
select pg_temp.pune('plata', financiar.inregistreaza_plata(pg_temp.id('a1'), 1234.5, 'numerar'));
select is(evenimente.proceseaza(pg_temp.eveniment('PlataConfirmata', pg_temp.id('a1'))), true,
  'evenimente.proceseaza: PlataConfirmata se proceseaza');
select set_eq($$ select pg_temp.destinatari('plata') $$, $$ values (pg_temp.id('loc1')), (pg_temp.id('chirias1')) $$,
  'comunicare.la_plata_confirmata: locatarii apartamentului care a platit');
select results_eq(
  $$ select titlu, asociatie_id, referinta ->> 'plata_id', corp like '%Chitanta AP nr. 000001 este in aplicatie, la Platile mele.' from comunicare.notificari
     where tip = 'plata' and profil_id = pg_temp.id('loc1') $$,
  $$ values ('Plata a fost inregistrata'::text, pg_temp.id('asoc'), pg_temp.id('plata')::text, true) $$,
  'la_plata_confirmata: seria si numarul chitantei, asociatia din chitanta');
select todo('[NOU-1] suma din notificare se formateaza cu locale-ul serverului (1,234.50), nu romaneste ca in aplicatie', 1);
select is((select corp from comunicare.notificari where tip = 'plata' and profil_id = pg_temp.id('loc1')),
  'Am primit 1.234,50 lei. Chitanta AP nr. 000001 este in aplicatie, la Platile mele.',
  '[NOU-1] la_plata_confirmata: suma scrisa romaneste, 1.234,50 lei');

-- =============================================================================
-- VotDeschis / VotReamintit / AdunareConvocata -> comunicare.la_vot
-- =============================================================================
select pg_temp.ca('adm');
select pg_temp.pune('v1', guvernanta.deschide_vot(pg_temp.id('asoc'), 'Schimbam usa', null, array['Da', 'Nu'], '2026-12-20 12:00+00'));
reset role;
select is(evenimente.proceseaza(pg_temp.eveniment('VotDeschis', pg_temp.id('v1'))), true, 'evenimente.proceseaza: VotDeschis se proceseaza');
select set_eq($$ select pg_temp.destinatari('vot') except select pg_temp.id('viitor') $$,
  $$ values (pg_temp.id('loc1')), (pg_temp.id('chirias1')), (pg_temp.id('loc2')), (pg_temp.id('nou3')) $$,
  'comunicare.la_vot VotDeschis: toata asociatia, fara fostul locatar si fara alta asociatie');
select results_eq(
  $$ select titlu, corp, referinta ->> 'vot_id' from comunicare.notificari where tip = 'vot' and profil_id = pg_temp.id('loc2') $$,
  $$ values ('Vot nou: Schimbam usa'::text, 'Votul se inchide pe 20 decembrie 2026. Voteaza din aplicatie, la Bloc.'::text, pg_temp.id('v1')::text) $$,
  'la_vot VotDeschis: titlul si data inchiderii');
select is(pg_temp.notificari('viitor', 'vot'), 0, '[K13] la_vot VotDeschis: locatarul cu acces viitor nu este notificat');

select pg_temp.curata();
select pg_temp.ca('loc1');
select guvernanta.voteaza(pg_temp.id('v1'), (select id from guvernanta.voturi_optiuni where vot_id = pg_temp.id('v1') and text = 'Da'), pg_temp.id('a1'));
select pg_temp.ca('adm');
select guvernanta.reaminteste_vot(pg_temp.id('v1'));
reset role;
select is(evenimente.proceseaza(pg_temp.eveniment('VotReamintit', pg_temp.id('v1'))), true, 'evenimente.proceseaza: VotReamintit se proceseaza');
select set_eq($$ select pg_temp.destinatari('vot') $$, $$ values (pg_temp.id('loc2')), (pg_temp.id('nou3')) $$,
  'la_vot VotReamintit: doar locatarii activi ai apartamentelor care nu au votat');
select is((select titlu || ' / ' || corp from comunicare.notificari where tip = 'vot' and profil_id = pg_temp.id('nou3')),
  'Nu ai votat inca / Schimbam usa', 'la_vot VotReamintit: titlul votului');

select pg_temp.curata();
select pg_temp.ca('adm');
select pg_temp.pune('ag1', guvernanta.convoaca_adunare(pg_temp.id('asoc'), '2026-12-10 18:00 Europe/Bucharest', 'Sala de la parter', 'Bugetul pe 2027'));
select pg_temp.pune('ag2', guvernanta.convoaca_adunare(pg_temp.id('asoc'), '2026-12-12 00:30 Europe/Bucharest', 'Scara A', 'Lift'));
reset role;
select is(evenimente.proceseaza(pg_temp.eveniment('AdunareConvocata', pg_temp.id('ag1'))), true, 'evenimente.proceseaza: AdunareConvocata se proceseaza');
select set_eq($$ select pg_temp.destinatari('adunare_generala') except select pg_temp.id('viitor') $$,
  $$ values (pg_temp.id('loc1')), (pg_temp.id('chirias1')), (pg_temp.id('loc2')), (pg_temp.id('nou3')) $$,
  'la_vot AdunareConvocata: toata asociatia');
select results_eq(
  $$ select titlu, corp, referinta ->> 'adunare_id' from comunicare.notificari where tip = 'adunare_generala' and profil_id = pg_temp.id('loc1') $$,
  $$ values ('Convocare la adunarea generala'::text, '10 decembrie 2026, Sala de la parter. Bugetul pe 2027'::text, pg_temp.id('ag1')::text) $$,
  'la_vot AdunareConvocata: data, locul si ordinea de zi');
select todo('[K6] convocarea AG nu contine ora', 1);
select ok((select corp like '%18:00%' from comunicare.notificari where tip = 'adunare_generala' and profil_id = pg_temp.id('loc1')),
  '[K6] la_vot AdunareConvocata: convocarea contine ora (18:00)');
-- data in ora Romaniei este reparata de fusul orar al bazei [X1]
select pg_temp.curata();
select evenimente.proceseaza(pg_temp.eveniment('AdunareConvocata', pg_temp.id('ag2')));
select ok((select corp like '12 decembrie 2026%' from comunicare.notificari where tip = 'adunare_generala' and profil_id = pg_temp.id('loc1')),
  '[K6] la_vot AdunareConvocata: 00:30 ora Romaniei este tot 12 decembrie, nu 11 (UTC)');
select is(pg_temp.notificari('viitor', 'adunare_generala'), 0, '[K13] la_vot AdunareConvocata: locatarul cu acces viitor nu este notificat');

select pg_temp.curata();
select comunicare.la_vot('AltTip', jsonb_build_object('asociatie_id', pg_temp.id('asoc'), 'titlu', 'x'));
select is((select count(*)::int from comunicare.notificari where asociatie_id = pg_temp.id('asoc')), 0, 'la_vot: un tip necunoscut nu trimite nimic');

-- =============================================================================
-- AdministratorAprobat -> comunicare.la_administrator_aprobat (din trigger-ul de verificare)
-- =============================================================================
update identitate.administratori set stare = 'aprobat' where profil_id = pg_temp.id('neaprobat');
select is(evenimente.proceseaza(pg_temp.eveniment('AdministratorAprobat', pg_temp.id('neaprobat'))), true,
  'evenimente.proceseaza: AdministratorAprobat se proceseaza');
select results_eq(
  $$ select tip, titlu, asociatie_id from comunicare.notificari where profil_id = pg_temp.id('neaprobat') $$,
  $$ values ('bun_venit'::text, 'Contul de administrator a fost aprobat'::text, null::uuid) $$,
  'comunicare.la_administrator_aprobat: mesajul de bun venit');

-- Un handler care esueaza: efectele se anuleaza, eroarea ramane pe rand.
select evenimente.inregistreaza('CitireRespinsa', 'contorizare', pg_temp.id('c2'), '{"apartament_id": "nu-este-uuid", "motiv": "x"}');
select is(evenimente.proceseaza(pg_temp.eveniment('CitireRespinsa', pg_temp.id('c2'))), false,
  'evenimente.proceseaza: un handler care esueaza intoarce false');
select results_eq(
  $$ select procesat_la is null, incercari, ultima_eroare is not null from evenimente.coada where id = pg_temp.eveniment('CitireRespinsa', pg_temp.id('c2')) $$,
  $$ values (true, 1, true) $$,
  'evenimente.proceseaza: evenimentul esuat ramane neprocesat, cu eroarea si incercarea numarata');

-- Handlerele nu sunt expuse utilizatorilor.
select pg_temp.ca('loc1');
select throws_ok($$ select comunicare.la_administrator_aprobat(jsonb_build_object('profil_id', pg_temp.id('loc1'))) $$,
  '42501', null, 'la_administrator_aprobat: locatarul nu poate apela handlerul');
select throws_ok($$ select comunicare.trimite_remindere_zilnice() $$,
  '42501', null, 'trimite_remindere_zilnice: locatarul nu poate porni jobul');
reset role;

-- =============================================================================
-- trimite_remindere_zilnice: ziua in care pleaca fiecare reminder
-- Toate datele sunt relative la current_date, deci testul merge in orice zi.
-- =============================================================================
select pg_temp.curata();
-- Se opresc si reminderele asociatiei vecine: altfel, in ziua in care ar pleca
-- de la ea (zi_limita - zile), locatarul ei apare ca destinatar in plus.
update comunicare.remindere_setari set activ = false
  where asociatie_id in (pg_temp.id('asoc'), pg_temp.id('asocB'));
-- a3 are citirea lunii validata; a2 are doar una respinsa; a1 niciuna.
insert into contorizare.contoare (id, bloc_id, apartament_id, tip)
values (pg_temp.pune('c3', gen_random_uuid()), pg_temp.id('bloc'), pg_temp.id('a3'), 'rece');
insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
values (pg_temp.id('c3'), 'rece', pg_temp.id('bloc'), pg_temp.id('a3'), date_trunc('month', current_date)::date, 5, 6, 'locatar', 'validata');

create function pg_temp.zi() returns int language sql stable as $$ select extract(day from current_date)::int $$;
create function pg_temp.zile_citire() returns int language sql stable as $$ select case when pg_temp.zi() <= 25 then 3 else 0 end $$;
-- ziua limita este intre 1 si 28; in zilele 29-31 nicio configurare nu poate da azi
create function pg_temp.se_poate_citire() returns boolean language sql stable as $$ select pg_temp.zi() + pg_temp.zile_citire() <= 28 $$;
create function pg_temp.zilnic() returns void language sql as $$
  select pg_temp.curata();
  select comunicare.trimite_remindere_zilnice();
$$;

-- citire_contoare: pleaca in ziua (luna curenta + zi_limita - 1) - zile.
update comunicare.remindere_setari set activ = true, zile = pg_temp.zile_citire() where asociatie_id = pg_temp.id('asoc') and tip = 'citire_contoare';
update contorizare.setari_contorizare set zi_limita_citire = least(pg_temp.zi() + pg_temp.zile_citire(), 28) where bloc_id = pg_temp.id('bloc');
select pg_temp.zilnic();
select set_eq($$ select pg_temp.destinatari('citire_contoare') $$,
  $$ select pg_temp.id(k) from unnest(array['loc1', 'chirias1', 'loc2']) k where pg_temp.se_poate_citire() $$,
  'comunicare.trimite_remindere_zilnice citire_contoare: pleaca cu N zile inainte de ziua limita, la apartamentele fara citire valabila');
update contorizare.setari_contorizare
   set zi_limita_citire = least(case when pg_temp.zi() + pg_temp.zile_citire() <= 27 then pg_temp.zi() + pg_temp.zile_citire() + 1
                                     else pg_temp.zi() + pg_temp.zile_citire() - 1 end, 28)
 where bloc_id = pg_temp.id('bloc');
select pg_temp.zilnic();
select is((select count(*)::int from pg_temp.destinatari('citire_contoare')), 0,
  'trimite_remindere_zilnice citire_contoare: cu ziua limita mutata cu o zi nu pleaca');
update contorizare.setari_contorizare set zi_limita_citire = least(pg_temp.zi() + pg_temp.zile_citire(), 28) where bloc_id = pg_temp.id('bloc');
update comunicare.remindere_setari set activ = false where asociatie_id = pg_temp.id('asoc') and tip = 'citire_contoare';
select pg_temp.zilnic();
select is((select count(*)::int from pg_temp.destinatari('citire_contoare')), 0,
  'trimite_remindere_zilnice: reminderul oprit nu pleaca');

-- [K2] zile >= zi_limita: termenul lunii viitoare minus zile cade azi.
update contorizare.setari_contorizare set zi_limita_citire = 10 where bloc_id = pg_temp.id('bloc');
update comunicare.remindere_setari
   set activ = true, zile = ((date_trunc('month', current_date) + interval '1 month')::date + 9) - current_date
 where asociatie_id = pg_temp.id('asoc') and tip = 'citire_contoare';
select pg_temp.zilnic();
select todo('[K2] reminderul de citire nu pleaca niciodata cand zile >= zi_limita_citire', 1);
select ok(pg_temp.notificari('loc1', 'citire_contoare') = 1,
  '[K2] trimite_remindere_zilnice citire_contoare: cu zile >= zi_limita pleaca inaintea termenului din luna urmatoare');
update comunicare.remindere_setari set activ = false where asociatie_id = pg_temp.id('asoc') and tip = 'citire_contoare';

-- plata: pleaca in ziua scadenta - zile, pentru lista publicata; destinatari: orice datorie deschisa.
insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere)
values (pg_temp.id('a2'), pg_temp.id('bloc'), 'sold_initial', 50, current_date - 30, 'Test restanta'),
       (pg_temp.id('a3'), pg_temp.id('bloc'), 'sold_initial', 70, current_date + 3, 'Test nescadent');
update comunicare.remindere_setari set activ = true, zile = 3 where asociatie_id = pg_temp.id('asoc') and tip = 'plata';
update intretinere.liste_lunare set scadenta = current_date + 3 where id = pg_temp.id('lista');
select pg_temp.zilnic();
select results_eq($$ select profil_id, titlu from comunicare.notificari where tip = 'plata' and profil_id in (pg_temp.id('nou3'), pg_temp.id('loc1'), pg_temp.id('chirias1')) $$,
  $$ values (pg_temp.id('nou3'), 'Reamintire de plata'::text) $$,
  'trimite_remindere_zilnice plata: pleaca cu N zile inainte de scadenta listei, la cine are de platit (a1 are doar avans)');
select todo('[K5] reminderul de plata ajunge si la restantieri', 1);
select is(pg_temp.notificari('loc2', 'plata'), 0, '[K5] trimite_remindere_zilnice plata: restantierul nu primeste "se apropie termenul"');
update intretinere.liste_lunare set scadenta = current_date + 4 where id = pg_temp.id('lista');
select pg_temp.zilnic();
select is((select count(*)::int from pg_temp.destinatari('plata')), 0, 'trimite_remindere_zilnice plata: in alta zi nu pleaca');
update intretinere.liste_lunare set scadenta = current_date + 3, stare = 'ciorna' where id = pg_temp.id('lista');
select pg_temp.zilnic();
select is((select count(*)::int from pg_temp.destinatari('plata')), 0, 'trimite_remindere_zilnice plata: lista nepublicata nu conteaza');
update intretinere.liste_lunare set stare = 'publicata' where id = pg_temp.id('lista');
update comunicare.remindere_setari set activ = false where asociatie_id = pg_temp.id('asoc') and tip = 'plata';

-- restanta: pleaca in ziua scadenta + zile; destinatari: datorii trecute de scadenta.
update comunicare.remindere_setari set activ = true, zile = 30 where asociatie_id = pg_temp.id('asoc') and tip = 'restanta';
update intretinere.liste_lunare set scadenta = current_date - 30 where id = pg_temp.id('lista');
select pg_temp.zilnic();
select set_eq($$ select pg_temp.destinatari('restanta') $$, $$ values (pg_temp.id('loc2')) $$,
  'trimite_remindere_zilnice restanta: pleaca la N zile dupa scadenta, doar la restantieri');
update intretinere.liste_lunare set scadenta = current_date - 29 where id = pg_temp.id('lista');
select pg_temp.zilnic();
select is((select count(*)::int from pg_temp.destinatari('restanta')), 0, 'trimite_remindere_zilnice restanta: in alta zi nu pleaca');
update comunicare.remindere_setari set activ = false where asociatie_id = pg_temp.id('asoc') and tip = 'restanta';

-- adunare_generala: pleaca in ziua data_ora::date - zile, la locatarii blocurilor asociatiei.
delete from guvernanta.adunari_generale where asociatie_id = pg_temp.id('asoc');
insert into guvernanta.adunari_generale (asociatie_id, data_ora, loc, ordine_de_zi)
values (pg_temp.id('asoc'), (current_date + 10) + time '12:00', 'Sala', 'Buget');
update comunicare.remindere_setari set activ = true, zile = 10 where asociatie_id = pg_temp.id('asoc') and tip = 'adunare_generala';
select pg_temp.zilnic();
select set_eq($$ select pg_temp.destinatari('adunare_generala') except select pg_temp.id('viitor') $$,
  $$ values (pg_temp.id('loc1')), (pg_temp.id('chirias1')), (pg_temp.id('loc2')), (pg_temp.id('nou3')) $$,
  'trimite_remindere_zilnice adunare_generala: pleaca cu N zile inainte, la locatarii asociatiei');
select is((select corp from comunicare.notificari where tip = 'adunare_generala' and profil_id = pg_temp.id('loc1')),
  'Adunarea generala are loc peste 10 zile. Confirma prezenta din aplicatie.',
  'trimite_remindere_zilnice adunare_generala: textul spune peste cate zile');
select is(pg_temp.notificari('viitor', 'adunare_generala'), 0, '[K13] trimite_remindere_zilnice adunare_generala: locatarul cu acces viitor nu este notificat');
update comunicare.remindere_setari set zile = 9 where asociatie_id = pg_temp.id('asoc') and tip = 'adunare_generala';
select pg_temp.zilnic();
select is((select count(*)::int from pg_temp.destinatari('adunare_generala')), 0, 'trimite_remindere_zilnice adunare_generala: in alta zi nu pleaca');

-- Un bloc in configurare nu primeste remindere automate.
update comunicare.remindere_setari set zile = 10 where asociatie_id = pg_temp.id('asoc') and tip = 'adunare_generala';
update organizare.blocuri set stare = 'in_configurare' where id = pg_temp.id('bloc');
select pg_temp.zilnic();
select is((select count(*)::int from pg_temp.destinatari('adunare_generala')), 0, 'trimite_remindere_zilnice: blocul in configurare este sarit');
update organizare.blocuri set stare = 'activ', arhivat_la = now() where id = pg_temp.id('bloc');
select pg_temp.zilnic();
select is((select count(*)::int from pg_temp.destinatari('adunare_generala')), 0, 'trimite_remindere_zilnice: blocul arhivat este sarit');

select * from finish();
rollback;
