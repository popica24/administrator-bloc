-- Teste pgTAP: evenimente (agentul a-). Vezi antetul pentru ajutoare si este_serviciu().
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

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
-- Evenimente: dispecerul, handlerele ApartamentCreat, webhook-ul si pg_cron
-- (migratia 20260919120023_evenimente_si_joburi)
-- =============================================================================

create temp table t_nr (nume text primary key, n bigint not null);
grant select on t_nr to authenticated, anon, service_role;
create function pg_temp.nr(p text) returns bigint language sql stable as $$ select n from pg_temp.t_nr where nume = p $$;
create function pg_temp.eveniment(p_nume text, p_tip text, p_agregat uuid, p_date jsonb) returns bigint
language plpgsql as $$
declare v bigint;
begin
  v := evenimente.inregistreaza(p_tip, 'teste', p_agregat, p_date);
  insert into pg_temp.t_nr values (p_nume, v);
  return v;
end;
$$;

do $$
begin
  perform pg_temp.eveniment('creatA2', 'ApartamentCreat', pg_temp.id('apA2'), jsonb_build_object(
    'apartament_id', pg_temp.id('apA2'), 'bloc_id', pg_temp.id('blocA'), 'luna', '2026-08-01', 'document_id', null,
    'restanta', 99.9, 'restanta_scadenta', '2026-08-25', 'restanta_descriere', null,
    'serie_rece', 'R-A2', 'serie_calda', 'C-A2', 'index_rece', 5, 'index_calda', 7));
  perform pg_temp.eveniment('creatGresit', 'ApartamentCreat', gen_random_uuid(), jsonb_build_object(
    'apartament_id', gen_random_uuid(), 'bloc_id', pg_temp.id('blocA'), 'luna', '2026-08-01', 'index_rece', 1));
  perform pg_temp.eveniment('faraConsumator', 'CitireTransmisa', pg_temp.id('apA1'), '{}');
  perform pg_temp.eveniment('aprobat', 'AdministratorAprobat', pg_temp.id('adminNou'), jsonb_build_object('profil_id', pg_temp.id('adminNou')));
end;
$$;

-- -----------------------------------------------------------------------------
-- evenimente.proceseaza
-- -----------------------------------------------------------------------------

select is(evenimente.proceseaza(-1), false, 'evenimente.proceseaza: un eveniment inexistent intoarce false');
select is(evenimente.proceseaza(pg_temp.nr('creatA2')), true, 'evenimente.proceseaza: ApartamentCreat se proceseaza');
select results_eq(
  $$select procesat_la is not null, incercari, ultima_eroare from evenimente.coada where id = pg_temp.nr('creatA2')$$,
  $$values (true, 1, null::text)$$,
  'evenimente.proceseaza: evenimentul e marcat procesat, cu o incercare');
select is(evenimente.proceseaza(pg_temp.nr('creatA2')), false, 'evenimente.proceseaza: un eveniment procesat nu se reia');

select results_eq(
  $$select c.tip, c.serie, c.amplasare, x.luna, x.index_anterior, x.index_curent, x.sursa, x.stare
    from contorizare.contoare c join contorizare.citiri x on x.contor_id = c.id
    where c.apartament_id = pg_temp.id('apA2') order by c.tip$$,
  $$values ('calda'::text, 'C-A2'::text, 'baie'::text, '2026-08-01'::date, 7::numeric, 7::numeric, 'pornire'::text, 'validata'::text),
           ('rece', 'R-A2', 'baie', '2026-08-01'::date, 5::numeric, 5::numeric, 'pornire', 'validata')$$,
  'contorizare.la_apartament_creat: doua contoare cu indexul de pornire validat');
select results_eq(
  $$select (select count(*)::int from financiar.conturi where apartament_id = pg_temp.id('apA2')), d.tip, d.suma, d.scadenta, d.descriere
    from financiar.datorii d where d.apartament_id = pg_temp.id('apA2')$$,
  $$values (1, 'sold_initial'::text, 99.9::numeric, '2026-08-25'::date, 'Restanta preluata de pe lista de plata pe hartie'::text)$$,
  'financiar.la_apartament_creat: contul si restanta de pe hartie');

select lives_ok($$select contorizare.la_apartament_creat((select date from evenimente.coada where id = pg_temp.nr('creatA2')))$$,
  'contorizare.la_apartament_creat: rulat a doua oara nu da eroare');
select lives_ok($$select financiar.la_apartament_creat((select date from evenimente.coada where id = pg_temp.nr('creatA2')))$$,
  'financiar.la_apartament_creat: rulat a doua oara nu da eroare');
select results_eq(
  $$select (select count(*)::int from contorizare.contoare where apartament_id = pg_temp.id('apA2')),
           (select count(*)::int from contorizare.citiri where apartament_id = pg_temp.id('apA2')),
           (select count(*)::int from financiar.datorii where apartament_id = pg_temp.id('apA2')),
           (select count(*)::int from financiar.conturi where apartament_id = pg_temp.id('apA2'))$$,
  $$values (2, 2, 1, 1)$$,
  'handlerele ApartamentCreat sunt idempotente');

select lives_ok($$select contorizare.la_apartament_creat(jsonb_build_object('apartament_id', pg_temp.id('apB1'), 'bloc_id', pg_temp.id('blocB'), 'luna', '2026-09-01', 'index_rece', 12.5))$$,
  'contorizare.la_apartament_creat: doar cu indexul de apa rece');
select lives_ok($$select financiar.la_apartament_creat(jsonb_build_object('apartament_id', pg_temp.id('apB1'), 'bloc_id', pg_temp.id('blocB'), 'restanta', 0))$$,
  'financiar.la_apartament_creat: fara restanta');
select results_eq(
  $$select (select string_agg(tip, ',') from contorizare.contoare where apartament_id = pg_temp.id('apB1')),
           (select count(*)::int from financiar.conturi where apartament_id = pg_temp.id('apB1')),
           (select count(*)::int from financiar.datorii where apartament_id = pg_temp.id('apB1'))$$,
  $$values ('rece'::text, 1, 0)$$,
  'handlerele ApartamentCreat: fara index cald nu se creeaza contor cald; restanta 0 nu devine datorie');
select contorizare.la_apartament_creat(jsonb_build_object('apartament_id', pg_temp.id('apA21'), 'bloc_id', pg_temp.id('blocA2'), 'luna', '2026-09-01'));
select results_eq(
  $$select x.tip, index_anterior, index_curent, sursa, stare
    from contorizare.contoare c join contorizare.citiri x on x.contor_id = c.id
    where c.apartament_id = pg_temp.id('apA21')$$,
  $$values ('rece'::text, 0::numeric(10,3), 0::numeric(10,3), 'pornire'::text, 'validata'::text)$$,
  '[A11] fara index de pornire, apartamentul primeste totusi contorul de apa rece, cu index 0');
select is_empty($$select 1 from contorizare.contoare where apartament_id = pg_temp.id('apA21') and tip = 'calda'$$,
  '[A11] fara index cald, tot nu se creeaza contor cald');

select is(evenimente.proceseaza(pg_temp.nr('creatGresit')), false, 'evenimente.proceseaza: un handler care cade intoarce false');
select results_eq(
  $$select procesat_la is null, incercari, ultima_eroare is not null,
           (select count(*)::int from contorizare.contoare c where c.apartament_id = (e.date ->> 'apartament_id')::uuid)
    from evenimente.coada e where id = pg_temp.nr('creatGresit')$$,
  $$values (true, 1, true, 0)$$,
  'evenimente.proceseaza: eroarea ramane pe eveniment, efectele se anuleaza');

select is(evenimente.proceseaza(pg_temp.nr('faraConsumator')), true, 'evenimente.proceseaza: un tip fara consumator se marcheaza procesat');
select is(evenimente.proceseaza(pg_temp.nr('aprobat')), true, 'evenimente.proceseaza: AdministratorAprobat');
select results_eq(
  $$select tip from comunicare.notificari where profil_id = pg_temp.id('adminNou')$$,
  $$values ('bun_venit'::text)$$,
  'evenimente.proceseaza: AdministratorAprobat trimite mesajul de bun venit');

-- -----------------------------------------------------------------------------
-- evenimente.proceseaza_restante si functiile publice
-- -----------------------------------------------------------------------------

do $$
begin
  perform pg_temp.eveniment('restant', 'SesizareDeschisa', pg_temp.id('apA1'), '{}');
  perform pg_temp.eveniment('abandonat', 'ApartamentCreat', gen_random_uuid(), jsonb_build_object(
    'apartament_id', gen_random_uuid(), 'bloc_id', pg_temp.id('blocA'), 'luna', '2026-08-01', 'index_rece', 1));
  update evenimente.coada set incercari = 10 where id = pg_temp.nr('abandonat');
end;
$$;

select cmp_ok(evenimente.proceseaza_restante(100000), '>=', 1, 'evenimente.proceseaza_restante: intoarce cate evenimente au reusit');
select results_eq(
  $$select nume, procesat_la is not null, incercari from evenimente.coada e join pg_temp.t_nr t on t.n = e.id
    where t.nume in ('restant', 'abandonat', 'creatGresit') order by nume$$,
  $$values ('abandonat'::text, false, 10), ('creatGresit', false, 2), ('restant', true, 1)$$,
  'evenimente.proceseaza_restante: reia ce a ramas, sare peste evenimentele cu 10 incercari');

do $$
begin
  perform pg_temp.eveniment('public1', 'SesizareDeschisa', pg_temp.id('apA1'), '{}');
  perform pg_temp.eveniment('public2', 'SesizareDeschisa', pg_temp.id('apA1'), '{}');
end;
$$;

select pg_temp.ca('adminA');
set local role authenticated;
select throws_ok($$select public.proceseaza_eveniment(pg_temp.nr('public1'))$$, '42501', null,
  'public.proceseaza_eveniment: authenticated nu are drept de executie');
select throws_ok($$select public.proceseaza_evenimente_restante()$$, '42501', null,
  'public.proceseaza_evenimente_restante: authenticated nu are drept de executie');
select throws_ok($$select evenimente.proceseaza(pg_temp.nr('public1'))$$, '42501', null,
  'evenimente.proceseaza: authenticated nu are acces la schema evenimente');
select throws_ok($$select contorizare.la_apartament_creat('{}')$$, '42501', null,
  'contorizare.la_apartament_creat: authenticated nu are drept de executie');
select throws_ok($$select financiar.la_apartament_creat('{}')$$, '42501', null,
  'financiar.la_apartament_creat: authenticated nu are drept de executie');
reset role;
select pg_temp.ca_anonim();
set local role anon;
select throws_ok($$select public.proceseaza_eveniment(1)$$, '42501', null,
  'public.proceseaza_eveniment: anon nu are drept de executie');
reset role;

select pg_temp.ca_serviciu();
set local role service_role;
select is(public.proceseaza_eveniment(pg_temp.nr('public1')), true,
  'public.proceseaza_eveniment: service_role proceseaza un eveniment');
select cmp_ok(public.proceseaza_evenimente_restante(), '>=', 1,
  'public.proceseaza_evenimente_restante: service_role reia restantele');
reset role;
select is((select procesat_la is not null from evenimente.coada where id = pg_temp.nr('public2')), true,
  'public.proceseaza_evenimente_restante: evenimentul ramas a fost procesat');

-- -----------------------------------------------------------------------------
-- evenimente.anunta_functia (Database Webhook prin pg_net)
-- -----------------------------------------------------------------------------

select results_eq(
  $$select q.method::text, q.url = (select decrypted_secret from vault.decrypted_secrets where name = 'url_proceseaza_eveniment'),
           q.headers ->> 'Authorization' = 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cheie_serviciu'),
           convert_from(q.body, 'utf8')::jsonb
    from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'id' = pg_temp.nr('restant')::text$$,
  $$values ('POST'::text, true, true, jsonb_build_object('id', pg_temp.nr('restant'), 'tip', 'SesizareDeschisa'))$$,
  'evenimente.anunta_functia: fiecare eveniment nou anunta Edge Function-ul cu cheia din Vault');
delete from vault.secrets where name = 'cheie_serviciu';
do $$ begin perform pg_temp.eveniment('faraCheie', 'SesizareDeschisa', pg_temp.id('apA1'), '{}'); end $$;
select is_empty(
  $$select 1 from net.http_request_queue where convert_from(body, 'utf8')::jsonb ->> 'id' = pg_temp.nr('faraCheie')::text$$,
  'evenimente.anunta_functia: fara cheie in Vault nu trimite nimic (preia jobul)');
select is((select procesat_la from evenimente.coada where id = pg_temp.nr('faraCheie')), null,
  'evenimente.anunta_functia: evenimentul ramane in coada pentru job');

-- -----------------------------------------------------------------------------
-- pg_cron
-- -----------------------------------------------------------------------------

select results_eq(
  $$select jobname::text, schedule::text, command::text, active from cron.job
    where jobname in ('calculeaza-penalizari', 'trimite-remindere', 'proceseaza-evenimente', 'curata-evenimente') order by jobname$$,
  $$values ('calculeaza-penalizari'::text, '5 0 1 * *'::text, 'select financiar.calculeaza_penalizari(current_date)'::text, true),
           ('curata-evenimente', '30 3 * * *', 'delete from evenimente.coada where procesat_la < now() - interval ''30 days''', true),
           ('proceseaza-evenimente', '* * * * *', 'select evenimente.proceseaza_restante(200)', true),
           ('trimite-remindere', '0 9 * * *', 'select comunicare.trimite_remindere_zilnice()', true)$$,
  'pg_cron: cele patru joburi programate');

select * from finish();
rollback;
