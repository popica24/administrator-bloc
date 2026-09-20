-- [minor] identitate.anonimizeaza_profil() inchidea legaturile de locatar si
-- mandatele de administrator cu `greatest(current_date, activ_din + 1)`,
-- formula pe care reparatia S11 a corectat-o deja in
-- identitate.inchide_acces_locatar (fara +1). O legatura facuta chiar azi
-- si anonimizata azi ramanea, din formula veche, activa pana maine.
--
-- Reparatie: aceeasi formula ca S11, `greatest(current_date, activ_din)`,
-- in ambele update-uri. Restul functiei ramane neschimbat.

create or replace function identitate.anonimizeaza_profil(p_profil_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legaturi integer;
  v_invitatii integer;
  v_mandate integer;
  v_administratori integer;
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

  update auth.identities
     set identity_data = (identity_data || jsonb_build_object('email', 'anonim-' || p_profil_id || '@adminbloc.invalid'))
                          - 'name' - 'phone'
   where user_id = p_profil_id and identity_data ? 'email';

  delete from auth.sessions where user_id = p_profil_id;
  delete from auth.refresh_tokens where user_id = p_profil_id::text;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'atestate' and (storage.foldername(name))[1] = p_profil_id::text;
  update identitate.administratori
     set numar_atestat = null, atestat_cale = null
   where profil_id = p_profil_id and (numar_atestat is not null or atestat_cale is not null);

  update identitate.locatari
     set activ_pana = greatest(current_date, activ_din)
   where profil_id = p_profil_id and activ_pana is null;
  get diagnostics v_legaturi = row_count;

  update identitate.membri_asociatie
     set activ_pana = greatest(current_date, activ_din)
   where profil_id = p_profil_id and activ_pana is null;
  get diagnostics v_mandate = row_count;

  update identitate.administratori
     set stare = 'respins', motiv_respingere = 'Persoana stearsa.'
   where profil_id = p_profil_id and stare <> 'respins';
  get diagnostics v_administratori = row_count;

  update identitate.invitatii
     set revocata_la = now()
   where creat_de = p_profil_id and folosita_la is null and revocata_la is null;
  get diagnostics v_invitatii = row_count;

  return jsonb_build_object(
    'legaturi_inchise', v_legaturi, 'invitatii_revocate', v_invitatii,
    'mandate_inchise', v_mandate, 'administrator_revocat', v_administratori > 0);
end;
$$;
