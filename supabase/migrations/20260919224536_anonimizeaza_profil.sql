-- Stergerea unei persoane (audit 2: X02).
--
-- Pana acum nu exista nicio cale: stergerea contului din Auth esua pe cheile
-- straine, pentru ca o plata, o chitanta sau o datorie trimit la profil si
-- trebuie sa ramana (contabilitatea asociatiei se pastreaza ani). Raspunsul
-- corect nu este stergerea randului, ci anonimizarea lui: randurile de bani
-- raman intacte, dar nu mai duc la un om.
--
-- Ce face comanda:
--   - numele devine 'Persoana stearsa', emailul si telefonul dispar, atat in
--     identitate.profiluri cat si in auth.users (unde emailul devine unul
--     imposibil de folosit, ca sa nu se mai poata intra in cont);
--   - legaturile active de locatar se inchid azi, ca persoana sa nu mai apara
--     pe niciun ecran de administrator;
--   - codurile de invitatie facute de ea si nefolosite inca se revoca;
--   - nimic din financiar, intretinere sau sesizari nu se sterge.
-- Doar dezvoltatorul (service_role sau un job) o poate apela: este o cerere de
-- stergere care se verifica in afara aplicatiei.

create function identitate.anonimizeaza_profil(p_profil_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legaturi integer;
  v_invitatii integer;
begin
  if not private.este_serviciu() then
    raise exception 'Doar dezvoltatorul poate sterge o persoana.';
  end if;
  if not exists (select 1 from identitate.profiluri where id = p_profil_id) then
    raise exception 'Persoana nu exista.';
  end if;

  update identitate.profiluri
     set nume = 'Persoana stearsa', email = null, telefon = null
   where id = p_profil_id;

  update auth.users
     set email = 'anonim-' || p_profil_id || '@adminbloc.invalid',
         phone = null,
         raw_user_meta_data = '{}'::jsonb
   where id = p_profil_id;

  update identitate.locatari
     set activ_pana = greatest(current_date, activ_din + 1)
   where profil_id = p_profil_id and activ_pana is null;
  get diagnostics v_legaturi = row_count;

  update identitate.invitatii
     set revocata_la = now()
   where creat_de = p_profil_id and folosita_la is null and revocata_la is null;
  get diagnostics v_invitatii = row_count;

  return jsonb_build_object('legaturi_inchise', v_legaturi, 'invitatii_revocate', v_invitatii);
end;
$$;

comment on function identitate.anonimizeaza_profil(uuid) is
  'Sterge datele personale ale unei persoane si ii inchide accesul, pastrand randurile contabile care trimit la ea.';

revoke execute on function identitate.anonimizeaza_profil(uuid) from public, anon, authenticated;
grant execute on function identitate.anonimizeaza_profil(uuid) to service_role;
