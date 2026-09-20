-- Teste pgTAP pentru sesizari (migratia 20260919120018_sesizari.sql): comenzi, refuzuri, RLS.
-- Toate datele sunt create aici si se anuleaza la rollback.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

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

-- =============================================================================
-- adauga_sesizare
-- =============================================================================
select pg_temp.ca('loc1');
select pg_temp.pune('s1', sesizari.adauga_sesizare(pg_temp.id('a1'), '  Bec ars pe scara  ', 'iluminat', '   ',
  array[pg_temp.id('bloc') || '/' || pg_temp.id('a1') || '/poza1.jpg',
        pg_temp.id('bloc') || '/' || pg_temp.id('a2') || '/strain.jpg',
        'poza-fara-folder.jpg']));

select isnt(pg_temp.id('s1'), null, 'sesizari.adauga_sesizare: locatarul trimite o sesizare pentru apartamentul lui');
select results_eq(
  $$ select titlu, descriere, stare, categorie, autor_id, bloc_id from sesizari.sesizari where id = pg_temp.id('s1') $$,
  $$ values ('Bec ars pe scara'::text, 'Bec ars pe scara'::text, 'noua'::text, 'iluminat'::text, pg_temp.id('loc1'), pg_temp.id('bloc')) $$,
  'adauga_sesizare: titlul se curata, descrierea goala devine titlul, starea este noua, autorul si blocul sunt ale lui');
select results_eq(
  $$ select cale from sesizari.sesizari_poze where sesizare_id = pg_temp.id('s1') $$,
  $$ values (pg_temp.id('bloc') || '/' || pg_temp.id('a1') || '/poza1.jpg') $$,
  'adauga_sesizare: se pastreaza doar pozele din folderul <bloc>/<apartament>/');

select pg_temp.pune('s2', sesizari.adauga_sesizare(pg_temp.id('a1'), 'Usa de la intrare', 'acces', 'Nu se inchide', null));
select is((select descriere from sesizari.sesizari where id = pg_temp.id('s2')), 'Nu se inchide',
  'adauga_sesizare: descrierea data se pastreaza, iar poze null nu strica nimic');

select throws_ok(
  $$ select sesizari.adauga_sesizare(pg_temp.id('a2'), 'Alt apartament', 'altele', 'x') $$,
  'P0001', 'Poti trimite sesizari doar pentru apartamentul tau.',
  'adauga_sesizare: refuza apartamentul altcuiva');
select throws_ok(
  $$ select sesizari.adauga_sesizare(pg_temp.id('a1'), 'Categorie gresita', 'lift', 'x') $$,
  '23514', null,
  'adauga_sesizare: categoria trebuie sa fie una din lista');

select pg_temp.ca('fost3');
select throws_ok(
  $$ select sesizari.adauga_sesizare(pg_temp.id('a3'), 'Fost locatar', 'altele', 'x') $$,
  'P0001', 'Poti trimite sesizari doar pentru apartamentul tau.',
  'adauga_sesizare: fostul locatar nu mai poate trimite');
select pg_temp.ca('viitor');
select throws_ok(
  $$ select sesizari.adauga_sesizare(pg_temp.id('a2'), 'Inca nu locuiesc', 'altele', 'x') $$,
  'P0001', 'Poti trimite sesizari doar pentru apartamentul tau.',
  'adauga_sesizare: locatarul cu acces din viitor nu poate trimite inca');
select pg_temp.ca('adm');
select throws_ok(
  $$ select sesizari.adauga_sesizare(pg_temp.id('a1'), 'Admin', 'altele', 'x') $$,
  'P0001', 'Poti trimite sesizari doar pentru apartamentul tau.',
  'adauga_sesizare: administratorul nu scrie in numele unui apartament');

reset role;
select is((select count(*)::int from evenimente.coada where tip = 'SesizareDeschisa' and agregat_id = pg_temp.id('s1')), 1,
  'adauga_sesizare: emite SesizareDeschisa');
select is((select date ->> 'titlu' from evenimente.coada where tip = 'SesizareDeschisa' and agregat_id = pg_temp.id('s1')), 'Bec ars pe scara',
  'adauga_sesizare: evenimentul poarta titlul curatat');

-- =============================================================================
-- RLS "Sesizarile proprii si cele din blocurile conduse"
-- =============================================================================
select pg_temp.ca('loc1');
select is((select count(*)::int from sesizari.sesizari where bloc_id = pg_temp.id('bloc')), 2,
  'RLS "Sesizarile proprii si cele din blocurile conduse": locatarul isi vede sesizarile');
select pg_temp.ca('chirias1');
select is((select count(*)::int from sesizari.sesizari where bloc_id = pg_temp.id('bloc')), 2,
  'RLS "Sesizarile proprii si cele din blocurile conduse": colocatarul vede sesizarile apartamentului');
select pg_temp.ca('loc2');
select is((select count(*)::int from sesizari.sesizari where id = pg_temp.id('s1')), 0,
  'RLS "Sesizarile proprii si cele din blocurile conduse": vecinul nu vede tabelul altui apartament');
select pg_temp.ca('adm');
select is((select count(*)::int from sesizari.sesizari where bloc_id = pg_temp.id('bloc')), 2,
  'RLS "Sesizarile proprii si cele din blocurile conduse": administratorul vede tot blocul');
select pg_temp.ca('pres');
select is((select count(*)::int from sesizari.sesizari where bloc_id = pg_temp.id('bloc')), 2,
  'RLS "Sesizarile proprii si cele din blocurile conduse": presedintele vede tot blocul');
select pg_temp.ca('admB');
select is((select count(*)::int from sesizari.sesizari where bloc_id = pg_temp.id('bloc')), 0,
  'RLS "Sesizarile proprii si cele din blocurile conduse": administratorul altei asociatii nu vede nimic');
select pg_temp.ca('neaprobat');
select is((select count(*)::int from sesizari.sesizari where bloc_id = pg_temp.id('bloc')), 0,
  'RLS "Sesizarile proprii si cele din blocurile conduse": administratorul neaprobat nu vede nimic');
select pg_temp.ca('loc1');
select throws_ok(
  $$ insert into sesizari.sesizari (bloc_id, apartament_id, autor_id, categorie, titlu, descriere)
     values (pg_temp.id('bloc'), pg_temp.id('a1'), pg_temp.id('loc1'), 'altele', 'Direct', 'Direct') $$,
  '42501', null,
  'sesizari.sesizari: scrierea directa este refuzata, doar prin comenzi');

-- RLS "Pozele se vad ca sesizarea lor"
select is((select count(*)::int from sesizari.sesizari_poze where sesizare_id = pg_temp.id('s1')), 1,
  'RLS "Pozele se vad ca sesizarea lor": autorul vede poza');
select pg_temp.ca('loc2');
select is((select count(*)::int from sesizari.sesizari_poze where sesizare_id = pg_temp.id('s1')), 0,
  'RLS "Pozele se vad ca sesizarea lor": vecinul nu vede poza');
select pg_temp.ca('pres');
select is((select count(*)::int from sesizari.sesizari_poze where sesizare_id = pg_temp.id('s1')), 1,
  'RLS "Pozele se vad ca sesizarea lor": conducerea vede poza');

-- =============================================================================
-- scrie_mesaj
-- =============================================================================
select pg_temp.ca('loc1');
select throws_ok(
  $$ select sesizari.scrie_mesaj(gen_random_uuid(), 'Alo') $$,
  'P0001', 'Sesizarea nu exista.',
  'sesizari.scrie_mesaj: sesizare inexistenta');
select lives_ok(
  $$ select sesizari.scrie_mesaj(pg_temp.id('s1'), '  Tot nu merge  ') $$,
  'scrie_mesaj: locatarul scrie la sesizarea lui');
reset role;
select results_eq(
  $$ select stare, preluata_de from sesizari.sesizari where id = pg_temp.id('s1') $$,
  $$ values ('noua'::text, null::uuid) $$,
  'scrie_mesaj: mesajul locatarului nu preia sesizarea');
select results_eq(
  $$ select text, din_administratie, autor_id from sesizari.sesizari_mesaje where sesizare_id = pg_temp.id('s1') $$,
  $$ values ('Tot nu merge'::text, false, pg_temp.id('loc1')) $$,
  'scrie_mesaj: mesajul locatarului se salveaza curatat, fara marca administratiei');
select is((select count(*)::int from evenimente.coada where tip = 'SesizareRaspuns' and agregat_id = pg_temp.id('s1')), 0,
  'scrie_mesaj: mesajul locatarului nu emite SesizareRaspuns');

select pg_temp.ca('loc2');
select throws_ok(
  $$ select sesizari.scrie_mesaj(pg_temp.id('s1'), 'Si la mine') $$,
  'P0001', 'Nu poti scrie la aceasta sesizare.',
  'scrie_mesaj: vecinul nu poate scrie la sesizarea altuia');
select pg_temp.ca('pres');
select throws_ok(
  $$ select sesizari.scrie_mesaj(pg_temp.id('s1'), 'Presedintele') $$,
  'P0001', 'Nu poti scrie la aceasta sesizare.',
  'scrie_mesaj: presedintele citeste, dar nu raspunde in numele administratiei');
select pg_temp.ca('admB');
select throws_ok(
  $$ select sesizari.scrie_mesaj(pg_temp.id('s1'), 'Alt bloc') $$,
  'P0001', 'Nu poti scrie la aceasta sesizare.',
  'scrie_mesaj: administratorul altei asociatii este refuzat');
select pg_temp.ca('neaprobat');
select throws_ok(
  $$ select sesizari.scrie_mesaj(pg_temp.id('s1'), 'Neaprobat') $$,
  'P0001', 'Nu poti scrie la aceasta sesizare.',
  'scrie_mesaj: administratorul neaprobat este refuzat');

select pg_temp.ca('adm');
select lives_ok(
  $$ select sesizari.scrie_mesaj(pg_temp.id('s1'), 'Venim maine cu becul') $$,
  'scrie_mesaj: administratorul raspunde');
reset role;
select results_eq(
  $$ select stare, preluata_de, preluata_la is not null from sesizari.sesizari where id = pg_temp.id('s1') $$,
  $$ values ('in_lucru'::text, pg_temp.id('adm'), true) $$,
  'scrie_mesaj: primul raspuns al administratiei preia sesizarea');
select is((select din_administratie from sesizari.sesizari_mesaje where sesizare_id = pg_temp.id('s1') and autor_id = pg_temp.id('adm')), true,
  'scrie_mesaj: raspunsul este marcat din administratie');
select results_eq(
  $$ select date ->> 'text', date ->> 'titlu', (date ->> 'apartament_id')::uuid from evenimente.coada
     where tip = 'SesizareRaspuns' and agregat_id = pg_temp.id('s1') $$,
  $$ values ('Venim maine cu becul'::text, 'Bec ars pe scara'::text, pg_temp.id('a1')) $$,
  'scrie_mesaj: raspunsul administratiei emite SesizareRaspuns');

-- Al doilea raspuns nu muta momentul preluarii.
update sesizari.sesizari set preluata_la = now() - interval '2 days' where id = pg_temp.id('s1');
select pg_temp.ca('adm');
select sesizari.scrie_mesaj(pg_temp.id('s1'), 'Am cumparat becul');
reset role;
select ok((select preluata_la < now() - interval '1 day' from sesizari.sesizari where id = pg_temp.id('s1')),
  'scrie_mesaj: un raspuns pe o sesizare in lucru nu schimba preluarea');
select is((select count(*)::int from evenimente.coada where tip = 'SesizareRaspuns' and agregat_id = pg_temp.id('s1')), 2,
  'scrie_mesaj: fiecare raspuns al administratiei emite un eveniment');

-- RLS "Mesajele se vad ca sesizarea lor"
select pg_temp.ca('chirias1');
select is((select count(*)::int from sesizari.sesizari_mesaje where sesizare_id = pg_temp.id('s1')), 3,
  'RLS "Mesajele se vad ca sesizarea lor": apartamentul vede toata conversatia');
select pg_temp.ca('loc2');
select is((select count(*)::int from sesizari.sesizari_mesaje where sesizare_id = pg_temp.id('s1')), 0,
  'RLS "Mesajele se vad ca sesizarea lor": vecinul nu vede conversatia');
select pg_temp.ca('pres');
select is((select count(*)::int from sesizari.sesizari_mesaje where sesizare_id = pg_temp.id('s1')), 3,
  'RLS "Mesajele se vad ca sesizarea lor": presedintele vede conversatia');
select pg_temp.ca('admB');
select is((select count(*)::int from sesizari.sesizari_mesaje where sesizare_id = pg_temp.id('s1')), 0,
  'RLS "Mesajele se vad ca sesizarea lor": administratorul strain nu vede conversatia');

-- =============================================================================
-- preia_sesizare
-- =============================================================================
select pg_temp.ca('loc2');
select pg_temp.pune('s3', sesizari.adauga_sesizare(pg_temp.id('a2'), 'Liftul nu merge', 'altele', 'Blocat la etajul 2'));
select throws_ok($$ select sesizari.preia_sesizare(pg_temp.id('s3')) $$, 'P0001', null,
  '[K12] sesizari.preia_sesizare: locatarul nu poate prelua sesizarea, ridica eroare');
reset role;
select is((select stare from sesizari.sesizari where id = pg_temp.id('s3')), 'noua',
  'preia_sesizare: locatarul nu poate prelua sesizarea');

select pg_temp.ca('admB');
select throws_ok($$ select sesizari.preia_sesizare(pg_temp.id('s3')) $$, 'P0001', null,
  '[K12] preia_sesizare: administratorul altei asociatii nu o poate prelua, ridica eroare');
reset role;
select is((select stare from sesizari.sesizari where id = pg_temp.id('s3')), 'noua',
  'preia_sesizare: administratorul altei asociatii nu o poate prelua');

select pg_temp.ca('adm');
select lives_ok($$ select sesizari.preia_sesizare(pg_temp.id('s3')) $$, 'preia_sesizare: administratorul preia');
reset role;
select results_eq(
  $$ select stare, preluata_de, preluata_la is not null from sesizari.sesizari where id = pg_temp.id('s3') $$,
  $$ values ('in_lucru'::text, pg_temp.id('adm'), true) $$,
  'preia_sesizare: sesizarea trece in lucru, cu cine si cand');

select pg_temp.ca('adm');
select throws_ok($$ select sesizari.preia_sesizare(pg_temp.id('s3')) $$, 'P0001', null,
  '[K12] preia_sesizare pe o sesizare deja in lucru ridica eroare');
select pg_temp.ca('admB');
select throws_ok($$ select sesizari.preia_sesizare(pg_temp.id('s2')) $$, 'P0001', null,
  '[K12] preia_sesizare pe o sesizare din alt bloc ridica eroare');

-- =============================================================================
-- rezolva_sesizare
-- =============================================================================
select pg_temp.ca('loc1');
select throws_ok($$ select sesizari.rezolva_sesizare(pg_temp.id('s2')) $$,
  'P0001', 'Sesizarea nu exista, este deja rezolvata sau nu este din blocul tau.',
  'sesizari.rezolva_sesizare: locatarul nu isi poate rezolva singur sesizarea');
select pg_temp.ca('admB');
select throws_ok($$ select sesizari.rezolva_sesizare(pg_temp.id('s2')) $$,
  'P0001', 'Sesizarea nu exista, este deja rezolvata sau nu este din blocul tau.',
  'rezolva_sesizare: administratorul altei asociatii este refuzat');
select pg_temp.ca('adm');
select throws_ok($$ select sesizari.rezolva_sesizare(gen_random_uuid()) $$,
  'P0001', 'Sesizarea nu exista, este deja rezolvata sau nu este din blocul tau.',
  'rezolva_sesizare: sesizare inexistenta');
select lives_ok($$ select sesizari.rezolva_sesizare(pg_temp.id('s2')) $$,
  'rezolva_sesizare: administratorul rezolva o sesizare noua, nepreluata');
reset role;
select results_eq(
  $$ select stare, preluata_de, preluata_la is not null, rezolvata_la is not null from sesizari.sesizari where id = pg_temp.id('s2') $$,
  $$ values ('rezolvata'::text, pg_temp.id('adm'), true, true) $$,
  'rezolva_sesizare: rezolvarea completeaza si preluarea');
select results_eq(
  $$ select (date ->> 'apartament_id')::uuid, date ->> 'titlu' from evenimente.coada where tip = 'SesizareRezolvata' and agregat_id = pg_temp.id('s2') $$,
  $$ values (pg_temp.id('a1'), 'Usa de la intrare'::text) $$,
  'rezolva_sesizare: emite SesizareRezolvata');

select pg_temp.ca('adm');
select sesizari.rezolva_sesizare(pg_temp.id('s1'));
reset role;
select is((select preluata_de from sesizari.sesizari where id = pg_temp.id('s1')), pg_temp.id('adm'),
  'rezolva_sesizare: pastreaza cine a preluat-o');
select pg_temp.ca('adm');
select throws_ok($$ select sesizari.rezolva_sesizare(pg_temp.id('s1')) $$,
  'P0001', 'Sesizarea nu exista, este deja rezolvata sau nu este din blocul tau.',
  'rezolva_sesizare: o sesizare rezolvata nu se rezolva a doua oara');
select throws_ok($$ select sesizari.scrie_mesaj(pg_temp.id('s1'), 'Inca ceva') $$,
  'P0001', 'Sesizarea este rezolvata. Scrie o sesizare noua daca problema a revenit.',
  'scrie_mesaj: administratorul nu mai scrie la o sesizare rezolvata');
select pg_temp.ca('loc1');
select throws_ok($$ select sesizari.scrie_mesaj(pg_temp.id('s1'), 'A revenit') $$,
  'P0001', 'Sesizarea este rezolvata. Scrie o sesizare noua daca problema a revenit.',
  'scrie_mesaj: locatarul nu mai scrie la o sesizare rezolvata');

-- =============================================================================
-- sesizari_bloc: ce s-a semnalat in bloc, fara apartament si fara autor
-- =============================================================================
reset role;
-- o sesizare rezolvata acum 40 de zile (iese din vedere) si una acum 10 zile (ramane)
select pg_temp.ca('loc2');
select pg_temp.pune('s4', sesizari.adauga_sesizare(pg_temp.id('a2'), 'Veche', 'curatenie', 'Rezolvata demult'));
select pg_temp.pune('s5', sesizari.adauga_sesizare(pg_temp.id('a2'), 'Recenta', 'curatenie', 'Rezolvata de curand'));
reset role;
update sesizari.sesizari set stare = 'rezolvata', rezolvata_la = now() - interval '40 days' where id = pg_temp.id('s4');
update sesizari.sesizari set stare = 'rezolvata', rezolvata_la = now() - interval '10 days' where id = pg_temp.id('s5');

select pg_temp.ca('loc1');
select set_eq(
  $$ select id from sesizari.sesizari_bloc(pg_temp.id('bloc')) $$,
  $$ values (pg_temp.id('s3')), (pg_temp.id('s5')) $$,
  'sesizari.sesizari_bloc: locatarul vede sesizarile altora, deschise sau rezolvate in ultimele 30 de zile, fara ale lui');
select pg_temp.ca('loc2');
select set_eq(
  $$ select id from sesizari.sesizari_bloc(pg_temp.id('bloc')) $$,
  $$ values (pg_temp.id('s1')), (pg_temp.id('s2')) $$,
  'sesizari_bloc: vecinul vede sesizarile apartamentului 1 (rezolvate recent)');
select pg_temp.ca('adm');
select is((select count(*)::int from sesizari.sesizari_bloc(pg_temp.id('bloc'))), 4,
  'sesizari_bloc: administratorul vede toate sesizarile recente ale blocului');
select pg_temp.ca('locB');
select throws_ok($$ select * from sesizari.sesizari_bloc(pg_temp.id('bloc')) $$,
  'P0001', 'Nu ai acces la acest bloc.',
  'sesizari_bloc: locatarul altui bloc este refuzat');
select pg_temp.ca('fost3');
select throws_ok($$ select * from sesizari.sesizari_bloc(pg_temp.id('bloc')) $$,
  'P0001', 'Nu ai acces la acest bloc.',
  'sesizari_bloc: fostul locatar este refuzat');
reset role;
select ok(
  (select not ('apartament_id' = any (proargnames)) and not ('autor_id' = any (proargnames))
   from pg_proc where oid = 'sesizari.sesizari_bloc(uuid)'::regprocedure),
  'sesizari_bloc: rezultatul nu are apartamentul sau autorul');

select ok(
  (select not ('descriere' = any (proargnames)) from pg_proc where oid = 'sesizari.sesizari_bloc(uuid)'::regprocedure),
  '[K10] sesizari_bloc nu intoarce descrierea');

-- =============================================================================
-- [K4] Locatarul nou nu trebuie sa vada sesizarile fostului locatar
-- =============================================================================
insert into sesizari.sesizari (id, bloc_id, apartament_id, autor_id, categorie, titlu, descriere, creat_la)
values (gen_random_uuid(), pg_temp.id('bloc'), pg_temp.id('a3'), pg_temp.id('fost3'), 'instalatii', 'Teava sparta', 'In baie', now() - interval '60 days')
returning pg_temp.pune('s6', id);
insert into sesizari.sesizari_mesaje (sesizare_id, autor_id, text, creat_la)
values (pg_temp.id('s6'), pg_temp.id('fost3'), 'Mesaj privat al fostului locatar', now() - interval '60 days');
select pg_temp.ca('fost3');
select is((select count(*)::int from sesizari.sesizari where id = pg_temp.id('s6')), 0,
  'RLS "Sesizarile proprii si cele din blocurile conduse": fostul locatar nu isi mai vede sesizarea');
select pg_temp.ca('nou3');
select is((select count(*)::int from sesizari.sesizari where id = pg_temp.id('s6')), 0,
  '[K4] locatarul nou nu vede sesizarea fostului locatar');
select is((select count(*)::int from sesizari.sesizari_mesaje where sesizare_id = pg_temp.id('s6')), 0,
  '[K4] locatarul nou nu vede conversatia fostului locatar');
reset role;

select * from finish();
rollback;
