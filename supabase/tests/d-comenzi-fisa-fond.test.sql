-- Comenzile care lipseau dupa revocarea scrierilor directe (audit 2: X06/D1, X05/D5):
--   organizare.schimba_fisa_apartament  - fisa apartamentului (proprietar, cota,
--     suprafata, scutit de lift, etaj), cu reverificarea sumei cotelor;
--   financiar.inregistreaza_iesire_fond - banii care ies din fond, cu document.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- ---------------------------------------------------------------------------
-- Fixture (acelasi tipar ca in fisierele b-*; anulat la rollback).
--
-- private.este_serviciu() intoarce true cand session_user este postgres, deci
-- sub psql orice refuz "doar administratorul" ar fi ocolit. Aici o redefinim,
-- doar in aceasta tranzactie, ca sesiunea postgres sa fie serviciu numai cand
-- nu poarta JWT-ul unui utilizator.
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
  values (v, 'd-' || v || '@test.local', jsonb_build_object('nume', p_nume));
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

create function pg_temp.serviciu()
returns text
language sql
as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- Asociatia D1 cu blocul activ D1 (ap1 cota 30 parter scutit de lift, ap2 cota
-- 30, ap3 cota 40) si blocul Dc, ramas in configurare (apc cota 50). Asociatia
-- D2, cu blocul activ D2 (apx cota 100) si alt administrator.
create function pg_temp.fixture()
returns void
language plpgsql
as $$
declare
  r jsonb;
  v_id uuid;
  v_luna0 date := (date_trunc('month', current_date) - interval '3 months')::date;
  v_cui text := 'RD' || (floor(random() * 1e9))::bigint;
begin
  perform set_config('request.jwt.claims', '', true);

  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test D1', 'cui', v_cui),
    'bloc', jsonb_build_object('denumire', 'Bloc D1', 'adresa', 'Str. Test D 1', 'etaje', 2)));
  perform set_config('fx.asociatie', r ->> 'asociatie_id', true);
  perform set_config('fx.bloc', r ->> 'bloc_id', true);

  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza, suprafata_mp)
  values (pg_temp.fx('bloc'), '1', 0, true, 'Ion Unu', 30, 40) returning id into v_id;
  perform set_config('fx.ap1', v_id::text, true);
  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('bloc'), '2', 1, false, 'Ana Doi', 30) returning id into v_id;
  perform set_config('fx.ap2', v_id::text, true);
  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('bloc'), '3', 2, false, 'Dan Trei', 40) returning id into v_id;
  perform set_config('fx.ap3', v_id::text, true);
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (pg_temp.fx('ap1'), v_luna0, 2), (pg_temp.fx('ap2'), v_luna0, 3), (pg_temp.fx('ap3'), v_luna0, 1);
  perform organizare.activeaza_bloc(pg_temp.fx('bloc'));

  insert into organizare.blocuri (asociatie_id, denumire, adresa, etaje)
  values (pg_temp.fx('asociatie'), 'Bloc Dc', 'Str. Test D 2', 1) returning id into v_id;
  perform set_config('fx.blocc', v_id::text, true);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('blocc'), '1', 0, 'Vasile Configurare', 50) returning id into v_id;
  perform set_config('fx.apc', v_id::text, true);

  r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test D2', 'cui', v_cui || 'X'),
    'bloc', jsonb_build_object('denumire', 'Bloc D2', 'adresa', 'Str. Test D 3', 'etaje', 0)));
  perform set_config('fx.asociatie2', r ->> 'asociatie_id', true);
  perform set_config('fx.bloc2', r ->> 'bloc_id', true);
  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (pg_temp.fx('bloc2'), '1', 0, 'Vecin Strain', 100) returning id into v_id;
  perform set_config('fx.apx', v_id::text, true);
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane) values (v_id, v_luna0, 2);
  perform organizare.activeaza_bloc(pg_temp.fx('bloc2'));

  perform set_config('fx.admin', pg_temp.utilizator('Admin D1')::text, true);
  perform identitate.numeste_administrator(pg_temp.fx('admin'), pg_temp.fx('asociatie'), 'AT-D-1', current_date - 30);
  perform set_config('fx.admin2', pg_temp.utilizator('Admin D2')::text, true);
  perform identitate.numeste_administrator(pg_temp.fx('admin2'), pg_temp.fx('asociatie2'), 'AT-D-2', current_date - 30);
  perform set_config('fx.loc1', pg_temp.utilizator('Locatar Unu')::text, true);
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (pg_temp.fx('ap1'), pg_temp.fx('bloc'), pg_temp.fx('loc1'), 'proprietar', current_date - 30);
  perform set_config('fx.pres', pg_temp.utilizator('Presedinte D1')::text, true);
  insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
  values (pg_temp.fx('asociatie'), pg_temp.fx('pres'), 'presedinte', current_date - 30);

  -- Documente justificative: unul al asociatiei D1, unul al asociatiei D2.
  insert into comunicare.documente (asociatie_id, bloc_id, titlu, tip, cale)
  values (pg_temp.fx('asociatie'), pg_temp.fx('bloc'), 'Factura zugravit', 'factura', 'd/' || gen_random_uuid() || '.pdf')
  returning id into v_id;
  perform set_config('fx.doc', v_id::text, true);
  insert into comunicare.documente (asociatie_id, bloc_id, titlu, tip, cale)
  values (pg_temp.fx('asociatie2'), pg_temp.fx('bloc2'), 'Factura altui bloc', 'factura', 'd/' || gen_random_uuid() || '.pdf')
  returning id into v_id;
  perform set_config('fx.doc2', v_id::text, true);

  select id into v_id from financiar.fonduri where bloc_id = pg_temp.fx('bloc') and tip = 'reparatii';
  perform set_config('fx.fond', v_id::text, true);
  select id into v_id from financiar.fonduri where bloc_id = pg_temp.fx('bloc2') and tip = 'reparatii';
  perform set_config('fx.fond2', v_id::text, true);
  insert into financiar.miscari_fond (fond_id, data, suma, descriere)
  values (pg_temp.fx('fond'), current_date - 20, 1000, 'Contributii fond reparatii');
  insert into financiar.miscari_fond (fond_id, data, suma, descriere)
  values (pg_temp.fx('fond2'), current_date - 20, 100, 'Contributii fond reparatii');
end;
$$;

select pg_temp.fixture();
-- --------------------------------------------------------------------------- sfarsit fixture

-- =============================================================================
-- organizare.schimba_fisa_apartament (X06, D1)
-- =============================================================================

select pg_temp.ca('admin');
select lives_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap1'), '  Ioana Unu-Noua  ', 30, 42.5, false, 1::smallint)$$,
  'schimba_fisa_apartament: administratorul schimba proprietarul, suprafata, liftul si etajul');
select results_eq(
  $$select proprietar_nume, cota_indiviza, suprafata_mp, scutit_lift, etaj
      from organizare.apartamente where id = pg_temp.fx('ap1')$$,
  $$values ('Ioana Unu-Noua', 30.0000::numeric(7,4), 42.50::numeric(7,2), false, 1::smallint)$$,
  'schimba_fisa_apartament: valorile noi sunt pe fisa, numele fara spatii la capete');
select is(
  (select count(*)::int from audit.jurnal
    where tabela = 'organizare.apartamente' and rand_id = pg_temp.fx('ap1') and operatie = 'UPDATE'),
  1,
  'schimba_fisa_apartament: modificarea ajunge in audit.jurnal');
select is(
  (select nou ->> 'proprietar_nume' from audit.jurnal
    where tabela = 'organizare.apartamente' and rand_id = pg_temp.fx('ap1') and operatie = 'UPDATE'),
  'Ioana Unu-Noua',
  'schimba_fisa_apartament: jurnalul retine numele nou');

select lives_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap1'), 'Ioana Unu-Noua', 30, null, false, 1::smallint)$$,
  'schimba_fisa_apartament: suprafata poate ramane necompletata');
select is(
  (select suprafata_mp from organizare.apartamente where id = pg_temp.fx('ap1')),
  null::numeric(7,2),
  'schimba_fisa_apartament: suprafata necompletata se sterge de pe fisa');

select throws_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap1'), 'Ioana Unu-Noua', 35, null, false, 1::smallint)$$,
  'Cotele blocului ar ajunge la 105.0000 din 100. Schimba si celelalte apartamente, altfel lista nu se mai imparte corect.',
  'schimba_fisa_apartament: pe un bloc activ, cota care strica suma de 100 este refuzata');
select is(
  (select cota_indiviza from organizare.apartamente where id = pg_temp.fx('ap1')),
  30.0000::numeric(7,4),
  'schimba_fisa_apartament: dupa refuz, cota veche ramane neatinsa');
select lives_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap1'), 'Ioana Unu-Noua', 30.01, null, false, 1::smallint)$$,
  'schimba_fisa_apartament: o rotunjire de 0,01 din suma cotelor este acceptata');

select lives_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('apc'), 'Vasile Configurare', 70, null, false, 0::smallint)$$,
  'schimba_fisa_apartament: pe un bloc in configurare cota se schimba liber');

select throws_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap2'), '   ', 30, null, false, 1::smallint)$$,
  'Scrie numele proprietarului.',
  'schimba_fisa_apartament: numele gol este refuzat');
select throws_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap2'), 'Ana Doi', 0, null, false, 1::smallint)$$,
  'Cota indiviza trebuie sa fie un numar intre 0 si 100.',
  'schimba_fisa_apartament: cota zero este refuzata');
select throws_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap2'), 'Ana Doi', null, null, false, 1::smallint)$$,
  'Cota indiviza trebuie sa fie un numar intre 0 si 100.',
  'schimba_fisa_apartament: cota necompletata este refuzata');
select throws_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap2'), 'Ana Doi', 30, 0, false, 1::smallint)$$,
  'Suprafata trebuie sa fie mai mare decat zero.',
  'schimba_fisa_apartament: suprafata zero este refuzata');
select throws_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap2'), 'Ana Doi', 30, null, false, null)$$,
  'Scrie etajul apartamentului.',
  'schimba_fisa_apartament: etajul necompletat este refuzat');
select throws_ok(
  $$select organizare.schimba_fisa_apartament(gen_random_uuid(), 'Cineva', 30, null, false, 1::smallint)$$,
  'Apartamentul nu exista sau nu este in blocul tau.',
  'schimba_fisa_apartament: un apartament inexistent este refuzat');

select pg_temp.ca('loc1');
select throws_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap1'), 'Furat', 30, null, false, 1::smallint)$$,
  'Apartamentul nu exista sau nu este in blocul tau.',
  'schimba_fisa_apartament: locatarul nu isi schimba singur fisa');
select pg_temp.ca('pres');
select throws_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap1'), 'Furat', 30, null, false, 1::smallint)$$,
  'Apartamentul nu exista sau nu este in blocul tau.',
  'schimba_fisa_apartament: presedintele supravegheaza, dar nu modifica fisa');
select pg_temp.ca('admin2');
select throws_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap1'), 'Furat', 30, null, false, 1::smallint)$$,
  'Apartamentul nu exista sau nu este in blocul tau.',
  'schimba_fisa_apartament: administratorul altei asociatii nu ajunge la apartament');

select pg_temp.serviciu();
select lives_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('apx'), 'Vecin Strain Nou', 100, null, false, 0::smallint)$$,
  'schimba_fisa_apartament: serviciul poate corecta orice fisa');

set local role anon;
select throws_ok(
  $$select organizare.schimba_fisa_apartament(pg_temp.fx('ap1'), 'Furat', 30, null, false, 1::smallint)$$,
  '42501', null,
  'schimba_fisa_apartament: anon nu are drept de executie');
reset role;

-- =============================================================================
-- financiar.inregistreaza_iesire_fond (X05, D5)
-- =============================================================================

select pg_temp.ca('admin');
select lives_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -250.50, '  Zugravit casa scarii  ', current_date - 1, pg_temp.fx('doc'))$$,
  'inregistreaza_iesire_fond: administratorul scoate bani din fond, cu factura');
select results_eq(
  $$select suma, descriere, data, lista_id, document_id, creat_de
      from financiar.miscari_fond where fond_id = pg_temp.fx('fond') and suma < 0$$,
  $$values (-250.50::numeric(12,2), 'Zugravit casa scarii', current_date - 1, null::uuid, pg_temp.fx('doc'), pg_temp.fx('admin'))$$,
  'inregistreaza_iesire_fond: randul are documentul, autorul si niciun lista_id');
select is(
  (select sold from financiar.fonduri_solduri where id = pg_temp.fx('fond')),
  749.50::numeric,
  'inregistreaza_iesire_fond: soldul fondului scade cu suma iesita');
select is(
  (select count(*)::int from audit.jurnal
    where tabela = 'financiar.miscari_fond' and operatie = 'INSERT'
      and (nou ->> 'fond_id')::uuid = pg_temp.fx('fond') and (nou ->> 'suma')::numeric < 0),
  1,
  'inregistreaza_iesire_fond: iesirea ajunge in audit.jurnal');

select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), 250, 'Bani in plus', current_date, pg_temp.fx('doc'))$$,
  'Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.',
  'inregistreaza_iesire_fond: o suma pozitiva este refuzata');
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), 0, 'Nimic', current_date, pg_temp.fx('doc'))$$,
  'Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.',
  'inregistreaza_iesire_fond: suma zero este refuzata');
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -10, '  ', current_date, pg_temp.fx('doc'))$$,
  'Scrie pentru ce au iesit banii din fond.',
  'inregistreaza_iesire_fond: descrierea goala este refuzata');
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -10, 'Reparatie', current_date, null)$$,
  'Fiecare iesire din fond are nevoie de documentul care o justifica.',
  'inregistreaza_iesire_fond: fara document nu se scot bani din fond');
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -10, 'Reparatie', current_date, pg_temp.fx('doc2'))$$,
  'Documentul nu este al asociatiei tale.',
  'inregistreaza_iesire_fond: documentul altei asociatii este refuzat');
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -10, 'Reparatie', current_date + 1, pg_temp.fx('doc'))$$,
  'Data iesirii din fond nu poate fi in viitor.',
  'inregistreaza_iesire_fond: o data din viitor este refuzata');
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -10, 'Reparatie', null, pg_temp.fx('doc'))$$,
  'Data iesirii din fond nu poate fi in viitor.',
  'inregistreaza_iesire_fond: data necompletata este refuzata');
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond2'), -10, 'Reparatie', current_date, pg_temp.fx('doc'))$$,
  'Fondul nu exista sau nu este al unui bloc administrat de tine.',
  'inregistreaza_iesire_fond: fondul altui bloc este refuzat');
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(gen_random_uuid(), -10, 'Reparatie', current_date, pg_temp.fx('doc'))$$,
  'Fondul nu exista sau nu este al unui bloc administrat de tine.',
  'inregistreaza_iesire_fond: un fond inexistent este refuzat');

-- C5: fondul nu poate ajunge pe minus. Soldul e acum 749.50; o iesire de 800
-- ar merge pe -50.50 si e refuzata, fara sa scrie nimic.
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -800, 'Prea mult', current_date, pg_temp.fx('doc'))$$,
  'Fondul are 749.50 lei; o iesire de 800.00 lei l-ar duce pe minus.',
  'inregistreaza_iesire_fond: o iesire mai mare decat soldul fondului este refuzata (C5)');
select is(
  (select sold from financiar.fonduri_solduri where id = pg_temp.fx('fond')),
  749.50::numeric,
  'inregistreaza_iesire_fond: dupa refuz, soldul fondului ramane neatins (C5)');
select lives_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -749.50, 'Tot ce mai e in fond', current_date, pg_temp.fx('doc'))$$,
  'inregistreaza_iesire_fond: o iesire exact egala cu soldul, pana la zero, este acceptata (C5)');
select is(
  (select sold from financiar.fonduri_solduri where id = pg_temp.fx('fond')),
  0::numeric,
  'inregistreaza_iesire_fond: soldul poate ajunge exact la zero (C5)');

select pg_temp.ca('loc1');
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -10, 'Reparatie', current_date, pg_temp.fx('doc'))$$,
  'Fondul nu exista sau nu este al unui bloc administrat de tine.',
  'inregistreaza_iesire_fond: locatarul nu scoate bani din fond');
select pg_temp.ca('pres');
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -10, 'Reparatie', current_date, pg_temp.fx('doc'))$$,
  'Fondul nu exista sau nu este al unui bloc administrat de tine.',
  'inregistreaza_iesire_fond: presedintele nu scoate bani din fond');

select pg_temp.serviciu();
select lives_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond2'), -5, 'Reparatie', current_date, pg_temp.fx('doc2'))$$,
  'inregistreaza_iesire_fond: serviciul poate inregistra iesirea oricarui fond');

set local role anon;
select throws_ok(
  $$select financiar.inregistreaza_iesire_fond(pg_temp.fx('fond'), -10, 'Reparatie', current_date, pg_temp.fx('doc'))$$,
  '42501', null,
  'inregistreaza_iesire_fond: anon nu are drept de executie');
reset role;

select * from finish();
rollback;
