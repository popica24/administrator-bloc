-- Golurile din jurnalul de audit si indexurile care lipseau (audit 2: X08, P2).
--   X08: voturile, optiunile, voturile exprimate, documentele, invitatiile si
--        chitantele nu lasau nicio urma in audit.jurnal;
--   P2:  repartizari (bloc_id, lista_id), citiri (bloc_id, luna) si
--        sesizari (bloc_id, creat_la) se citeau prin seq scan.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- ---------------------------------------------------------------------------
-- Fixture (acelasi tipar ca in fisierele b-* si d-*; anulat la rollback).
-- ---------------------------------------------------------------------------
create or replace function private.este_serviciu()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (session_user in ('postgres', 'supabase_admin') and coalesce(auth.role(), '') = '');
$$;

create function pg_temp.utilizator(p_nume text)
returns uuid
language plpgsql
as $$
declare
  v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v, 'x-' || v || '@test.local', jsonb_build_object('nume', p_nume));
  return v;
end;
$$;

create function pg_temp.fx(p_cheie text)
returns uuid
language sql
stable
as $$
  select current_setting('fx.' || p_cheie)::uuid;
$$;

create function pg_temp.ca(p_cheie text)
returns text
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(p_cheie), 'role', 'authenticated')::text, true);
$$;

-- Cate randuri de jurnal exista pentru un rand dintr-o tabela.
create function pg_temp.jurnal(p_tabela text, p_rand uuid, p_operatie text)
returns integer
language sql
stable
as $$
  select count(*)::int from audit.jurnal
   where tabela = p_tabela and rand_id = p_rand and operatie = p_operatie;
$$;

-- Planul unei interogari, ca text, pentru verificarea indexului folosit.
create function pg_temp.plan_text(p_sql text)
returns text
language plpgsql
as $$
declare
  r record;
  v text := '';
begin
  for r in execute 'explain (costs off) ' || p_sql loop
    v := v || r."QUERY PLAN" || e'\n';
  end loop;
  return v;
end;
$$;

create function pg_temp.fixture()
returns void
language plpgsql
as $$
declare
  r jsonb;
  v_id uuid;
  v_luna0 date := (date_trunc('month', current_date) - interval '2 months')::date;
begin
  perform set_config('request.jwt.claims', '', true);
  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test X', 'cui', 'RX' || (floor(random() * 1e9))::bigint),
    'setari', jsonb_build_object('chitantaSerie', 'TX'),
    'bloc', jsonb_build_object('denumire', 'Bloc X', 'adresa', 'Str. Test X 1', 'etaje', 1)));
  perform set_config('fx.asociatie', r ->> 'asociatie_id', true);
  perform set_config('fx.bloc', r ->> 'bloc_id', true);

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('bloc'), '1', 0, 'Ion Unu', 100) returning id into v_id;
  perform set_config('fx.ap1', v_id::text, true);
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (pg_temp.fx('ap1'), v_luna0, 2);
  perform organizare.activeaza_bloc(pg_temp.fx('bloc'));

  perform set_config('fx.admin', pg_temp.utilizator('Admin X')::text, true);
  perform identitate.numeste_administrator(pg_temp.fx('admin'), pg_temp.fx('asociatie'), 'AT-X-1', current_date - 30);
  perform set_config('fx.loc', pg_temp.utilizator('Locatar X')::text, true);
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), pg_temp.fx('loc'), 'proprietar', current_date - 30);
end;
$$;

select pg_temp.fixture();
-- --------------------------------------------------------------------------- sfarsit fixture

-- =============================================================================
-- X08: fiecare tabela primeste urma ei in audit.jurnal
-- =============================================================================

select pg_temp.ca('admin');
select set_config('fx.vot', guvernanta.deschide_vot(
  pg_temp.fx('asociatie'), 'Schimbam interfonul?', 'Doua oferte', array['Da', 'Nu'],
  now() + interval '10 days', 'apartament')::text, true);
select set_config('fx.optiune',
  (select id::text from guvernanta.voturi_optiuni where vot_id = pg_temp.fx('vot') order by ordine limit 1), true);

select is(pg_temp.jurnal('guvernanta.voturi', pg_temp.fx('vot'), 'INSERT'), 1,
  'audit: votul deschis lasa urma in jurnal');
select is(pg_temp.jurnal('guvernanta.voturi_optiuni', pg_temp.fx('optiune'), 'INSERT'), 1,
  'audit: fiecare optiune de vot lasa urma in jurnal');

select pg_temp.ca('loc');
select guvernanta.voteaza(pg_temp.fx('vot'), pg_temp.fx('optiune'), pg_temp.fx('ap1'));
select set_config('fx.exprimat',
  (select id::text from guvernanta.voturi_exprimate where vot_id = pg_temp.fx('vot')), true);
select is(pg_temp.jurnal('guvernanta.voturi_exprimate', pg_temp.fx('exprimat'), 'INSERT'), 1,
  'audit: votul exprimat lasa urma in jurnal');

select pg_temp.ca('admin');
set local role authenticated;
insert into comunicare.documente (asociatie_id, bloc_id, titlu, tip, cale, incarcat_de)
values (pg_temp.fx('asociatie'), pg_temp.fx('bloc'), 'Contract firma de curatenie', 'contract',
        pg_temp.fx('asociatie') || '/' || gen_random_uuid() || '.pdf', pg_temp.fx('admin'));
reset role;
select set_config('fx.doc',
  (select id::text from comunicare.documente where asociatie_id = pg_temp.fx('asociatie') limit 1), true);
select is(pg_temp.jurnal('comunicare.documente', pg_temp.fx('doc'), 'INSERT'), 1,
  'audit: documentul incarcat lasa urma in jurnal');

-- [S7] calea si vizibilitatea (o data publicat) nu se mai pot schimba, deci
-- modificarea care lasa urma aici e titlul, nu ascunderea.
update comunicare.documente set titlu = 'Contract firma de curatenie (revizuit)' where id = pg_temp.fx('doc');
select is(pg_temp.jurnal('comunicare.documente', pg_temp.fx('doc'), 'UPDATE'), 1,
  'audit: modificarea unui document lasa urma in jurnal');

insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), 'intretinere',
        (date_trunc('month', current_date) - interval '1 month')::date, 50, current_date - 1, 'Intretinere de test');
select set_config('fx.plata', financiar.inregistreaza_incasare(pg_temp.fx('ap1'), 50, 'numerar')::text, true);
select set_config('fx.chitanta',
  (select id::text from financiar.chitante where plata_id = pg_temp.fx('plata')), true);
select is(pg_temp.jurnal('financiar.chitante', pg_temp.fx('chitanta'), 'INSERT'), 1,
  'audit: chitanta emisa lasa urma in jurnal');
select is(
  (select (nou ->> 'numar')::int from audit.jurnal
    where tabela = 'financiar.chitante' and rand_id = pg_temp.fx('chitanta')),
  (select numar from financiar.chitante where id = pg_temp.fx('chitanta')),
  'audit: jurnalul chitantei retine numarul din chitantier');
select is(
  (select autor_id from audit.jurnal
    where tabela = 'financiar.chitante' and rand_id = pg_temp.fx('chitanta')),
  pg_temp.fx('admin'),
  'audit: jurnalul retine cine a facut modificarea');

delete from guvernanta.voturi_exprimate where id = pg_temp.fx('exprimat');
select is(pg_temp.jurnal('guvernanta.voturi_exprimate', pg_temp.fx('exprimat'), 'DELETE'), 1,
  'audit: stergerea unui vot exprimat lasa urma in jurnal');

-- =============================================================================
-- P2: indexurile pe bloc_id
-- =============================================================================

select has_index('intretinere', 'repartizari', 'repartizari_bloc_lista_idx',
  'P2: intretinere.repartizari are index pe (bloc_id, lista_id)');
select has_index('contorizare', 'citiri', 'citiri_bloc_luna_idx',
  'P2: contorizare.citiri are index pe (bloc_id, luna)');
select has_index('sesizari', 'sesizari', 'sesizari_bloc_creat_la_idx',
  'P2: sesizari.sesizari are index pe (bloc_id, creat_la)');

select is(
  (select pg_get_indexdef(c.oid) from pg_class c where c.relname = 'repartizari_bloc_lista_idx'),
  'CREATE INDEX repartizari_bloc_lista_idx ON intretinere.repartizari USING btree (bloc_id, lista_id)',
  'P2: indexul de pe repartizari incepe cu bloc_id, apoi lista_id');
select is(
  (select pg_get_indexdef(c.oid) from pg_class c where c.relname = 'citiri_bloc_luna_idx'),
  'CREATE INDEX citiri_bloc_luna_idx ON contorizare.citiri USING btree (bloc_id, luna)',
  'P2: indexul de pe citiri incepe cu bloc_id, apoi luna');
select is(
  (select pg_get_indexdef(c.oid) from pg_class c where c.relname = 'sesizari_bloc_creat_la_idx'),
  'CREATE INDEX sesizari_bloc_creat_la_idx ON sesizari.sesizari USING btree (bloc_id, creat_la)',
  'P2: indexul de pe sesizari incepe cu bloc_id, apoi creat_la');

-- Tabelele sunt goale in tranzactia testului, deci planificatorul ar alege
-- oricum seq scan; oprindu-l, se vede daca indexul chiar acopera interogarea
-- pe care o face aplicatia.
set local enable_seqscan = off;
select matches(
  pg_temp.plan_text($$select * from intretinere.repartizari where bloc_id = '00000000-0000-0000-0000-000000000000'$$),
  'repartizari_bloc_lista_idx',
  'P2: citirea repartizarilor unui bloc foloseste indexul nou');
select matches(
  pg_temp.plan_text($$select * from contorizare.citiri where bloc_id = '00000000-0000-0000-0000-000000000000' and luna = '2026-01-01'$$),
  'citiri_bloc_luna_idx',
  'P2: citirile unui bloc pe o luna folosesc indexul nou');
select matches(
  pg_temp.plan_text($$select * from sesizari.sesizari where bloc_id = '00000000-0000-0000-0000-000000000000' order by creat_la desc$$),
  'sesizari_bloc_creat_la_idx',
  'P2: sesizarile unui bloc, cele mai noi intai, folosesc indexul nou');
set local enable_seqscan = on;

select * from finish();
rollback;
