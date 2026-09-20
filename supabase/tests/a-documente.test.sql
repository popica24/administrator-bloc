-- Teste pgTAP: documente (agentul a-). Vezi antetul pentru ajutoare si este_serviciu().
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

-- =============================================================================
-- Ajutoare comune fisierelor a-*.test.sql (acelasi text in fiecare fisier).
--
-- Totul ruleaza intr-o tranzactie anulata la sfarsit (rollback): fisierul nu
-- depinde de datele seed si nu lasa nimic in urma.
--
-- Actori: utilizatori inserati direct in auth.users (trigger-ul
-- identitate.la_cont_nou le creeaza profilul), tinuti in pg_temp.t_id dupa
-- nume. Ca sa lucrezi ca un utilizator:
--     select pg_temp.ca('locA1'); set local role authenticated;
--     ... ;
--     reset role;
-- pg_temp.ca_anonim() si pg_temp.ca_serviciu() pun claim-urile rolurilor anon
-- si service_role.
--
-- Problema private.este_serviciu(): functia intoarce true cand session_user
-- este postgres, iar supabase test db (pg_prove) se conecteaza ca postgres.
-- `set local role` schimba doar current_user, iar `set session authorization`
-- este refuzat (postgres nu este superuser in Supabase). Asa ca, in fiecare
-- fisier, inlocuim functia DOAR in tranzactia testului (rollback o reface) cu
-- aceeasi expresie, in care session_user se poate simula prin
--     set local teste.sesiune = 'authenticator';
-- adica rolul cu care PostgREST se conecteaza in productie. Inainte de
-- inlocuire verificam ca textul original este exact cel asteptat; daca
-- cineva schimba functia, fisierul cade si inlocuirea trebuie revazuta.
-- Refuzurile "doar serviciul" au fost verificate si invers: fara simulare
-- (session_user = postgres) acelasi apel trece.
-- =============================================================================

create temp table t_id (nume text primary key, id uuid not null);
grant select on t_id to authenticated, anon, service_role;

create function pg_temp.id(p_nume text) returns uuid
language sql stable as $$ select id from pg_temp.t_id where nume = p_nume $$;

create function pg_temp.utilizator(p_nume text, p_meta jsonb default null) returns uuid
language plpgsql as $$
declare
  v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          lower(p_nume) || '.' || substr(v::text, 1, 8) || '@teste.local',
          coalesce(p_meta, jsonb_build_object('nume', 'Test ' || p_nume)), now(), now());
  insert into pg_temp.t_id values (p_nume, v);
  return v;
end;
$$;

create function pg_temp.ca(p_nume text) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_nume), 'role', 'authenticated')::text, true);
$$;

create function pg_temp.ca_anonim() returns void
language sql as $$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;

create function pg_temp.ca_serviciu() returns void
language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

-- Cate randuri atinge o comanda (update/delete/insert), cu drepturile si RLS
-- ale rolului curent: pg_temp.randuri($$update ... $$).
create function pg_temp.randuri(p_sql text) returns integer
language plpgsql as $$
declare v integer;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end;
$$;

create function pg_temp.fara_claims() returns void
language sql as $$ select set_config('request.jwt.claims', '', true); $$;

-- Lumea de test:
--   asocA cu blocA (apA1 cota 60, etaj 0, 3 persoane; apA2 cota 40, etaj 1,
--   2 persoane) si blocA2 (apA21 cota 100); asocB cu blocB (apB1 cota 100).
--   adminA, adminB: administratori aprobati; adminNou: cerere in asteptare, cu
--   mandat pe asocA; adminFost: aprobat, mandat pe asocA terminat ieri;
--   presA: presedinte al asocA; locA1 (proprietar apA1), locA2 (chirias apA2),
--   fostA1 (apA1, acces inchis ieri), viitorA1 (apA1, acces de peste 10 zile),
--   locB1 (apB1), strain (cont fara nicio legatura).
create function pg_temp.lume() returns void
language plpgsql as $$
declare
  r jsonb;
  v_cui text := 'TA' || substr(md5(random()::text), 1, 10);
  v_ap uuid;
begin
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia de test A', 'cui', v_cui),
    'bloc', jsonb_build_object('denumire', 'Bloc test A', 'adresa', 'Str. Testului 1', 'etaje', 4)));
  insert into pg_temp.t_id values ('asocA', (r ->> 'asociatie_id')::uuid), ('blocA', (r ->> 'bloc_id')::uuid);
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia de test A', 'cui', v_cui),
    'bloc', jsonb_build_object('denumire', 'Bloc test A2', 'adresa', 'Str. Testului 2', 'etaje', 2)));
  insert into pg_temp.t_id values ('blocA2', (r ->> 'bloc_id')::uuid);
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia de test B', 'cui', 'TB' || substr(md5(random()::text), 1, 10)),
    'bloc', jsonb_build_object('denumire', 'Bloc test B', 'adresa', 'Str. Testului 3', 'etaje', 4)));
  insert into pg_temp.t_id values ('asocB', (r ->> 'asociatie_id')::uuid), ('blocB', (r ->> 'bloc_id')::uuid);

  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza)
  values (pg_temp.id('blocA'), '1', 0, true, 'Proprietar A1', 60) returning id into v_ap;
  insert into pg_temp.t_id values ('apA1', v_ap);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.id('blocA'), '2', 1, 'Proprietar A2', 40) returning id into v_ap;
  insert into pg_temp.t_id values ('apA2', v_ap);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.id('blocA2'), '1', 1, 'Proprietar A21', 100) returning id into v_ap;
  insert into pg_temp.t_id values ('apA21', v_ap);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.id('blocB'), '1', 1, 'Proprietar B1', 100) returning id into v_ap;
  insert into pg_temp.t_id values ('apB1', v_ap);

  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (pg_temp.id('apA1'), '2026-01-01', 3), (pg_temp.id('apA2'), '2026-01-01', 2),
         (pg_temp.id('apA21'), '2026-01-01', 1), (pg_temp.id('apB1'), '2026-01-01', 4);

  perform pg_temp.utilizator('adminA');
  perform pg_temp.utilizator('adminB');
  perform pg_temp.utilizator('adminNou');
  perform pg_temp.utilizator('adminFost');
  perform pg_temp.utilizator('presA');
  perform pg_temp.utilizator('locA1');
  perform pg_temp.utilizator('locA2');
  perform pg_temp.utilizator('fostA1');
  perform pg_temp.utilizator('viitorA1');
  perform pg_temp.utilizator('locB1');
  perform pg_temp.utilizator('strain');

  perform identitate.numeste_administrator(pg_temp.id('adminA'), pg_temp.id('asocA'), 'AT-A', current_date - 100);
  perform identitate.numeste_administrator(pg_temp.id('adminB'), pg_temp.id('asocB'), 'AT-B', current_date - 100);
  perform identitate.numeste_administrator(pg_temp.id('adminFost'), pg_temp.id('asocA'), 'AT-F', current_date - 100);
  update identitate.membri_asociatie set activ_pana = current_date - 1 where profil_id = pg_temp.id('adminFost');
  insert into identitate.administratori (profil_id, numar_atestat, stare) values (pg_temp.id('adminNou'), 'AT-N', 'in_asteptare');
  insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
  values (pg_temp.id('asocA'), pg_temp.id('adminNou'), 'administrator', current_date - 10),
         (pg_temp.id('asocA'), pg_temp.id('presA'), 'presedinte', current_date - 10);

  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din, activ_pana)
  values (pg_temp.id('apA1'), pg_temp.id('blocA'), pg_temp.id('locA1'), 'proprietar', current_date - 30, null),
         (pg_temp.id('apA2'), pg_temp.id('blocA'), pg_temp.id('locA2'), 'chirias', current_date - 30, null),
         (pg_temp.id('apA1'), pg_temp.id('blocA'), pg_temp.id('fostA1'), 'proprietar', current_date - 60, current_date - 1),
         (pg_temp.id('apA1'), pg_temp.id('blocA'), pg_temp.id('viitorA1'), 'membru_familie', current_date + 10, null),
         (pg_temp.id('apB1'), pg_temp.id('blocB'), pg_temp.id('locB1'), 'proprietar', current_date - 30, null);
end;
$$;

do $$ begin perform pg_temp.lume(); end $$;

do $$
begin
  if (select btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) from pg_proc
      where oid = 'private.este_serviciu()'::regprocedure)
     <> 'select coalesce(auth.role(), '''') = ''service_role'' or session_user in (''postgres'', ''supabase_admin'');' then
    raise exception 'private.este_serviciu() s-a schimbat: revezi inlocuirea din testele a-*.';
  end if;
end;
$$;

create or replace function private.este_serviciu()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or coalesce(nullif(current_setting('teste.sesiune', true), ''), session_user) in ('postgres', 'supabase_admin');
$$;

-- De aici incolo sesiunea se comporta ca o conexiune PostgREST.
set local teste.sesiune = 'authenticator';

-- =============================================================================
-- Documente si Storage (migratia 20260919120012_documente)
-- =============================================================================

-- Calea unui fisier: <id sau text>/<id sau text>/<fisier>.
create function pg_temp.n(a text, b text, f text) returns text language sql stable as $$
  select coalesce(pg_temp.id(a)::text, a) || '/' || coalesce(pg_temp.id(b)::text, b) || '/' || f
$$;

do $$
begin
  insert into comunicare.documente (asociatie_id, bloc_id, titlu, tip, cale, vizibil_locatarilor, incarcat_de) values
    (pg_temp.id('asocA'), null, 'Regulament', 'regulament', pg_temp.n('asocA', 'general', 'regulament.pdf'), true, pg_temp.id('adminA')),
    (pg_temp.id('asocA'), pg_temp.id('blocA'), 'Lista august', 'lista_plata', pg_temp.n('asocA', 'blocA', 'lista.pdf'), true, pg_temp.id('adminA')),
    (pg_temp.id('asocA'), pg_temp.id('blocA'), 'Contract lift', 'contract', pg_temp.n('asocA', 'blocA', 'contract.pdf'), false, pg_temp.id('adminA')),
    (pg_temp.id('asocA'), pg_temp.id('blocA2'), 'Lista A2', 'lista_plata', pg_temp.n('asocA', 'blocA2', 'lista.pdf'), true, pg_temp.id('adminA')),
    (pg_temp.id('asocB'), null, 'Regulament B', 'regulament', pg_temp.n('asocB', 'general', 'b.pdf'), true, pg_temp.id('adminB'));
  insert into storage.objects (bucket_id, name) values
    ('documente', pg_temp.n('asocA', 'general', 'regulament.pdf')),
    ('documente', pg_temp.n('asocA', 'blocA', 'lista.pdf')),
    ('documente', pg_temp.n('asocA', 'blocA', 'contract.pdf')),
    ('documente', pg_temp.n('asocA', 'blocA2', 'lista.pdf')),
    ('documente', pg_temp.n('asocA', 'blocA', 'fara-rand.pdf')),
    ('documente', pg_temp.n('asocB', 'general', 'b.pdf')),
    ('documente', pg_temp.n('asocB', 'general', 'secret.pdf')),
    ('poze', pg_temp.n('blocA', 'apA1', 'p1.jpg')),
    ('poze', pg_temp.n('blocA', 'apA2', 'p2.jpg')),
    ('poze', pg_temp.n('blocB', 'apB1', 'p3.jpg')),
    ('atestate', pg_temp.id('adminNou')::text || '/atestat.pdf');
end;
$$;

create function pg_temp.doc(p_titlu text) returns uuid language sql stable as $$
  select id from comunicare.documente where titlu = p_titlu and asociatie_id in (pg_temp.id('asocA'), pg_temp.id('asocB'))
$$;
create function pg_temp.docs_vazute() returns setof text language sql stable as $$
  select titlu from comunicare.documente where asociatie_id in (pg_temp.id('asocA'), pg_temp.id('asocB'))
$$;
create function pg_temp.obiecte_vazute(p_bucket text) returns setof text language sql stable as $$
  select name from storage.objects
   where bucket_id = p_bucket
     and split_part(name, '/', 1) in (select id::text from pg_temp.t_id)
$$;

-- -----------------------------------------------------------------------------
-- comunicare.documente
-- -----------------------------------------------------------------------------

select pg_temp.ca('adminA');
set local role authenticated;
select set_eq($$select pg_temp.docs_vazute()$$,
  array['Regulament', 'Lista august', 'Contract lift', 'Lista A2'],
  'politica "Documentele se vad de conducere, cele publice si de locatari": administratorul vede tot, inclusiv documentele ascunse');
select lives_ok($$insert into comunicare.documente (asociatie_id, bloc_id, titlu, tip, cale, incarcat_de)
    values (pg_temp.id('asocA'), pg_temp.id('blocA'), 'Raport', 'raport', pg_temp.n('asocA', 'blocA', 'raport.pdf'), pg_temp.id('adminA'))$$,
  'politica "Administratorul incarca documente": administratorul asociatiei, semnat de el');
select throws_ok($$insert into comunicare.documente (asociatie_id, titlu, tip, cale, incarcat_de)
    values (pg_temp.id('asocA'), 'Fals', 'altul', pg_temp.n('asocA', 'general', 'fals.pdf'), pg_temp.id('locA1'))$$,
  '42501', null, 'politica "Administratorul incarca documente": nu in numele altcuiva');
select is(pg_temp.randuri($$update comunicare.documente set titlu = 'Lista august 2026' where id = pg_temp.doc('Lista august')$$), 1,
  'politica "Administratorul modifica documente": administratorul asociatiei');
-- [H5] Inainte de reparatia H5, mutarea intr-o asociatie neadministrata era
-- oprita doar de RLS (with check), cu eroarea 42501. Acum trigger-ul
-- comunicare.protejeaza_documentul() refuza orice schimbare de asociatie_id
-- mai devreme, cu un mesaj clar, indiferent daca destinatia e administrata.
select throws_ok($$update comunicare.documente set asociatie_id = pg_temp.id('asocB') where id = pg_temp.doc('Regulament')$$,
  'Asociatia documentului nu se poate schimba dupa incarcare.',
  'politica "Administratorul modifica documente": documentul nu se muta in alta asociatie');
select throws_ok($$delete from comunicare.documente where id = pg_temp.doc('Regulament')$$,
  '42501', null, 'comunicare.documente: documentele nu se sterg din aplicatie');
reset role;

select pg_temp.ca('presA');
set local role authenticated;
select set_eq($$select pg_temp.docs_vazute()$$,
  array['Regulament', 'Lista august 2026', 'Contract lift', 'Lista A2', 'Raport'],
  'politica "Documentele se vad de conducere, cele publice si de locatari": presedintele vede tot');
select throws_ok($$insert into comunicare.documente (asociatie_id, titlu, tip, cale, incarcat_de)
    values (pg_temp.id('asocA'), 'P', 'altul', pg_temp.n('asocA', 'general', 'p.pdf'), pg_temp.id('presA'))$$,
  '42501', null, 'politica "Administratorul incarca documente": presedintele nu incarca');
reset role;

select pg_temp.ca('locA1');
set local role authenticated;
select set_eq($$select pg_temp.docs_vazute()$$,
  array['Regulament', 'Lista august 2026', 'Raport'],
  'politica "Documentele se vad de conducere, cele publice si de locatari": locatarul vede doar documentele publice ale blocului si asociatiei');
select is(pg_temp.randuri($$update comunicare.documente set titlu = 'Hack' where id = pg_temp.doc('Regulament')$$), 0,
  'politica "Administratorul modifica documente": locatarul nu modifica');
select throws_ok($$insert into comunicare.documente (asociatie_id, titlu, tip, cale, incarcat_de)
    values (pg_temp.id('asocA'), 'L', 'altul', pg_temp.n('asocA', 'general', 'l.pdf'), pg_temp.id('locA1'))$$,
  '42501', null, 'politica "Administratorul incarca documente": locatarul nu incarca');
reset role;

select pg_temp.ca('fostA1');
set local role authenticated;
select is_empty($$select pg_temp.docs_vazute()$$,
  'politica "Documentele se vad de conducere, cele publice si de locatari": fostul locatar nu mai vede nimic');
reset role;
select pg_temp.ca('adminNou');
set local role authenticated;
select is_empty($$select pg_temp.docs_vazute()$$,
  'politica "Documentele se vad de conducere, cele publice si de locatari": administratorul neaprobat nu vede nimic');
reset role;

select pg_temp.ca('adminB');
set local role authenticated;
select set_eq($$select pg_temp.docs_vazute()$$, array['Regulament B'],
  'politica "Documentele se vad de conducere, cele publice si de locatari": administratorul B vede doar asociatia lui');
select throws_ok($$insert into comunicare.documente (asociatie_id, titlu, tip, cale, incarcat_de)
    values (pg_temp.id('asocA'), 'B', 'altul', pg_temp.n('asocA', 'general', 'b.pdf'), pg_temp.id('adminB'))$$,
  '42501', null, 'politica "Administratorul incarca documente": nu in asociatia altuia');
select is(pg_temp.randuri($$update comunicare.documente set titlu = 'Hack' where id = pg_temp.doc('Regulament')$$), 0,
  'politica "Administratorul modifica documente": nu in asociatia altuia');
reset role;

-- -----------------------------------------------------------------------------
-- storage.objects, bucket documente
-- -----------------------------------------------------------------------------

select pg_temp.ca('locA1');
set local role authenticated;
select set_eq($$select pg_temp.obiecte_vazute('documente')$$,
  array[pg_temp.n('asocA', 'general', 'regulament.pdf'), pg_temp.n('asocA', 'blocA', 'lista.pdf')],
  'politica "Documente: citire ca randul din tabela": locatarul citeste doar fisierele documentelor pe care le vede');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('documente', pg_temp.n('asocA', 'blocA', 'l.pdf'))$$,
  '42501', null, 'politica "Documente: incarcare de catre administrator": locatarul nu incarca');
select set_config('storage.allow_delete_query', 'true', true);
select is(pg_temp.randuri($$delete from storage.objects where bucket_id = 'documente' and name = pg_temp.n('asocA', 'general', 'regulament.pdf')$$), 0,
  'politica "Documente: stergere de catre administrator": locatarul nu sterge');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select set_eq($$select pg_temp.obiecte_vazute('documente')$$,
  array[pg_temp.n('asocA', 'general', 'regulament.pdf'), pg_temp.n('asocA', 'blocA', 'lista.pdf'), pg_temp.n('asocA', 'blocA', 'contract.pdf'),
        pg_temp.n('asocA', 'blocA2', 'lista.pdf'), pg_temp.n('asocA', 'blocA', 'fara-rand.pdf')],
  'politica "Documente: citire ca randul din tabela": administratorul citeste tot ce e sub asociatia lui');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('documente', pg_temp.n('asocA', 'blocA', 'raport.pdf'))$$,
  'politica "Documente: incarcare de catre administrator": sub <asociatie_id>/');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('documente', pg_temp.n('asocB', 'general', 'x.pdf'))$$,
  '42501', null, 'politica "Documente: incarcare de catre administrator": nu sub asociatia altuia');
select is(pg_temp.randuri($$delete from storage.objects where bucket_id = 'documente' and name = pg_temp.n('asocA', 'blocA', 'fara-rand.pdf')$$), 1,
  'politica "Documente: stergere de catre administrator": administratorul sterge un fisier al asociatiei');
select is(pg_temp.randuri($$delete from storage.objects where bucket_id = 'documente' and name = pg_temp.n('asocB', 'general', 'secret.pdf')$$), 0,
  'politica "Documente: stergere de catre administrator": nu fisierele altei asociatii');

select is(pg_temp.randuri($$delete from storage.objects where bucket_id = 'documente' and name = pg_temp.n('asocA', 'blocA', 'lista.pdf')$$), 0,
  '[S7] fisierul din spatele unui document inregistrat nu se sterge');
select throws_ok($$update comunicare.documente set cale = pg_temp.n('asocA', 'blocA', 'alt.pdf') where id = pg_temp.doc('Lista august 2026')$$,
  'Calea documentului nu se poate schimba dupa incarcare.',
  '[S7] documentul nu se repointeaza spre alt fisier');
select throws_ok($$update comunicare.documente set vizibil_locatarilor = false where id = pg_temp.doc('Regulament')$$,
  'Un document vazut de locatari nu se mai poate ascunde.',
  '[S7] documentul publicat nu se ascunde de locatari');
select throws_ok($$insert into comunicare.documente (asociatie_id, titlu, tip, cale, incarcat_de)
    values (pg_temp.id('asocA'), 'Furat', 'altul', pg_temp.n('asocB', 'general', 'secret.pdf'), pg_temp.id('adminA'))$$,
  '42501', null,
  '[S7] calea documentului incepe cu asociatie_id/');
select lives_ok($$update comunicare.documente set vizibil_locatarilor = true where id = pg_temp.doc('Contract lift')$$,
  '[S7] un document inca nevazut de locatari se poate publica (sensul invers ramane liber)');

-- H5: RLS pe update verifica doar asociatie_id, nu si bloc_id. Fara paza in
-- trigger, administratorul asociatiei A putea muta un document vazut de
-- locatari (vizibil_locatarilor ramas true) din blocA in blocA2, scotandu-l
-- din vederea locatarilor blocului A fara ca vizibil_locatarilor sa o arate.
select throws_ok($$update comunicare.documente set bloc_id = pg_temp.id('blocA2') where id = pg_temp.doc('Lista august 2026')$$,
  'Blocul documentului nu se poate schimba dupa incarcare.',
  '[H5] documentul nu se muta in alt bloc dupa incarcare');
select throws_ok($$update comunicare.documente set bloc_id = null where id = pg_temp.doc('Lista august 2026')$$,
  'Blocul documentului nu se poate schimba dupa incarcare.',
  '[H5] documentul nu se largeste la toata asociatia dupa incarcare');
select has_trigger('comunicare', 'documente', 'documente_protejeaza',
  '[S7] exista trigger-ul comunicare.documente_protejeaza (functia comunicare.protejeaza_documentul)');
reset role;

select pg_temp.ca('adminB');
set local role authenticated;
select set_eq($$select pg_temp.obiecte_vazute('documente')$$,
  array[pg_temp.n('asocB', 'general', 'b.pdf'), pg_temp.n('asocB', 'general', 'secret.pdf')],
  'politica "Documente: citire ca randul din tabela": administratorul B nu citeste fisierele asociatiei A');
reset role;
select pg_temp.ca('strain');
set local role authenticated;
select is_empty($$select pg_temp.obiecte_vazute('documente')$$,
  'politica "Documente: citire ca randul din tabela": un cont fara legaturi nu citeste nimic');
reset role;

-- -----------------------------------------------------------------------------
-- storage.objects, bucket poze
-- -----------------------------------------------------------------------------

select pg_temp.ca('presA');
set local role authenticated;
select set_eq($$select pg_temp.obiecte_vazute('poze')$$,
  array[pg_temp.n('blocA', 'apA1', 'p1.jpg'), pg_temp.n('blocA', 'apA2', 'p2.jpg')],
  'politica "Poze: citire de catre apartament si conducerea blocului": presedintele vede pozele blocului');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('poze', pg_temp.n('blocA', 'apA1', 'pres.jpg'))$$,
  '42501', null, 'politica "Poze: incarcare pentru apartamentul propriu": presedintele fara apartament nu incarca');
reset role;

select pg_temp.ca('locA1');
set local role authenticated;
select set_eq($$select pg_temp.obiecte_vazute('poze')$$,
  array[pg_temp.n('blocA', 'apA1', 'p1.jpg')],
  'politica "Poze: citire de catre apartament si conducerea blocului": locatarul vede doar pozele apartamentului lui');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('poze', pg_temp.n('blocA', 'apA1', 'citire.jpg'))$$,
  'politica "Poze: incarcare pentru apartamentul propriu": locatarul incarca pentru apartamentul lui');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('poze', pg_temp.n('blocA', 'apA2', 'vecin.jpg'))$$,
  '42501', null, 'politica "Poze: incarcare pentru apartamentul propriu": nu pentru apartamentul vecinului');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('poze', gen_random_uuid()::text || '/' || pg_temp.id('apA1')::text || '/alt-bloc.jpg')$$,
  '42501', null, '[A7] prefixul trebuie sa fie <blocul apartamentului>/<apartament>/');
reset role;

select pg_temp.ca('locA2');
set local role authenticated;
select set_eq($$select pg_temp.obiecte_vazute('poze')$$,
  array[pg_temp.n('blocA', 'apA2', 'p2.jpg')],
  'politica "Poze: citire de catre apartament si conducerea blocului": vecinul nu vede pozele altuia');
reset role;

select pg_temp.ca('fostA1');
set local role authenticated;
select is_empty($$select pg_temp.obiecte_vazute('poze')$$,
  'politica "Poze: citire de catre apartament si conducerea blocului": fostul locatar nu mai vede');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('poze', pg_temp.n('blocA', 'apA1', 'fost.jpg'))$$,
  '42501', null, 'politica "Poze: incarcare pentru apartamentul propriu": fostul locatar nu mai incarca');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select lives_ok($$insert into storage.objects (bucket_id, name) values ('poze', pg_temp.n('blocA', 'apA2', 'admin.jpg'))$$,
  'politica "Poze: incarcare pentru apartamentul propriu": administratorul incarca in blocul lui');
reset role;

select pg_temp.ca('adminB');
set local role authenticated;
select set_eq($$select pg_temp.obiecte_vazute('poze')$$,
  array[pg_temp.n('blocB', 'apB1', 'p3.jpg')],
  'politica "Poze: citire de catre apartament si conducerea blocului": administratorul B vede doar blocul lui');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('poze', pg_temp.n('blocA', 'apA1', 'b.jpg'))$$,
  '42501', null, 'politica "Poze: incarcare pentru apartamentul propriu": nu in blocul altuia');
reset role;

-- -----------------------------------------------------------------------------
-- storage.objects, bucket atestate
-- -----------------------------------------------------------------------------

select pg_temp.ca('adminNou');
set local role authenticated;
select set_eq($$select name from storage.objects where bucket_id = 'atestate' and name like pg_temp.id('adminNou')::text || '/%'$$,
  array[pg_temp.id('adminNou')::text || '/atestat.pdf'],
  'politica "Atestate: titularul isi vede atestatul": titularul');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('atestate', pg_temp.id('adminNou')::text || '/atestat-2.pdf')$$,
  'politica "Atestate: titularul isi incarca atestatul": sub <profil_id>/');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('atestate', pg_temp.id('adminA')::text || '/fals.pdf')$$,
  '42501', null, 'politica "Atestate: titularul isi incarca atestatul": nu in folderul altuia');
reset role;

select pg_temp.ca('adminA');
set local role authenticated;
select is_empty($$select name from storage.objects where bucket_id = 'atestate' and name like pg_temp.id('adminNou')::text || '/%'$$,
  'politica "Atestate: titularul isi vede atestatul": altcineva nu il vede');
reset role;

select pg_temp.ca_anonim();
set local role anon;
select is_empty($$select 1 from storage.objects where bucket_id in ('documente', 'poze', 'atestate') and split_part(name, '/', 1) in (select id::text from pg_temp.t_id)$$,
  'storage: anon nu vede niciun fisier din bucket-urile private');
reset role;

select results_eq(
  $$select id, public, file_size_limit from storage.buckets where id in ('documente', 'poze', 'atestate') order by id$$,
  $$values ('atestate'::text, false, 5242880::bigint), ('documente', false, 10485760::bigint), ('poze', false, 1048576::bigint)$$,
  'storage: cele trei bucket-uri sunt private, cu limitele de marime');

select * from finish();
rollback;
