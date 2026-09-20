-- J2: contorizare.transmite_citire() este singura comanda de scriere din
-- contorizare fara paza "lista lunii e deja publicata", pe care cele patru
-- surori o au (valideaza_citire, valideaza_citiri_apartament,
-- citeste_contor_general, estimeaza_citiri). transmite_citire accepta doar
-- luna curenta (date_trunc('month', current_date)), dar o lista poate fi
-- publicata inainte de sfarsitul lunii ei: daca administratorul publica
-- lista lunii curente mai devreme, iar locatarul transmite (sau retrimite)
-- un index dupa aceea, citirea intra cu stare "trimisa" si ramane asa
-- pentru totdeauna — valideaza_citire refuza sa o verifice pentru ca luna
-- ei e deja publicata, deci badge-ul "De verificat" al administratorului nu
-- mai ajunge niciodata la zero.
--
-- Reparatie: acelasi mesaj si aceeasi verificare ca la surori, imediat dupa
-- ce se afla blocul apartamentului.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

create or replace function private.este_serviciu()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (session_user in ('postgres', 'supabase_admin') and coalesce(auth.role(), '') = '');
$$;

create function pg_temp.luna(p_decalaj integer default 0)
returns date
language sql
stable
as $$
  select (date_trunc('month', current_date) + make_interval(months => p_decalaj))::date;
$$;

do $$
declare
  v_r jsonb;
  v_bloc uuid;
  v_ap uuid;
  v_c1 uuid;
  v_profil uuid := gen_random_uuid();
  v_cui text := 'RO' || (floor(random() * 1e9))::bigint;
begin
  v_r := organizare.creeaza_asociatie(jsonb_build_object(
    'asociatie', jsonb_build_object('denumire', 'Asociatia Test J2', 'cui', v_cui),
    'setari', jsonb_build_object('chitantaSerie', 'TJ2'),
    'bloc', jsonb_build_object('denumire', 'Bloc J2', 'adresa', 'Str. Test J2', 'etaje', 1)));
  v_bloc := (v_r ->> 'bloc_id')::uuid;

  insert into organizare.apartamente (bloc_id, numar, etaj, proprietar_nume, cota_indiviza)
  values (v_bloc, '1', 0, 'Ion Unu', 100) returning id into v_ap;
  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane)
  values (v_ap, pg_temp.luna(-5), 1);
  insert into contorizare.contoare (bloc_id, apartament_id, tip) values (v_bloc, v_ap, 'rece') returning id into v_c1;
  insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare)
  values (v_c1, 'rece', v_bloc, v_ap, pg_temp.luna(-5), 100, 100, 'pornire', 'validata');

  perform organizare.activeaza_bloc(v_bloc);

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_profil, 'e-j2-' || v_profil || '@test.local', jsonb_build_object('nume', 'Locatar J2'));
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (v_ap, v_bloc, v_profil, 'proprietar', current_date - 30);

  -- Lista lunii curente e deja publicata (publicata mai devreme in luna).
  insert into intretinere.liste_lunare (bloc_id, luna, stare, scadenta, publicata_la, total_repartizat)
  values (v_bloc, pg_temp.luna(), 'publicata', pg_temp.luna() + 24, now(), 100);

  perform set_config('fx.profil', v_profil::text, true);
  perform set_config('fx.bloc', v_bloc::text, true);
  perform set_config('fx.ap', v_ap::text, true);
  perform set_config('fx.c1', v_c1::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('fx.profil'), 'role', 'authenticated')::text, true);

select throws_ok(
  format('select contorizare.transmite_citire(%L, %L, %L::jsonb)',
    current_setting('fx.ap')::uuid, pg_temp.luna(),
    jsonb_build_array(jsonb_build_object('contor_id', current_setting('fx.c1')::uuid, 'index', 150))::text),
  'Lista lunii ' || comunicare.luna_text(pg_temp.luna()) || ' este deja publicata; nu se mai poate transmite un index.',
  'transmite_citire: refuza luna curenta a carei lista e deja publicata');

select is(
  (select count(*)::int from contorizare.citiri where contor_id = current_setting('fx.c1')::uuid and luna = pg_temp.luna()),
  0,
  'transmite_citire: nu insereaza nicio citire pentru luna publicata refuzata');

select * from finish();
rollback;
