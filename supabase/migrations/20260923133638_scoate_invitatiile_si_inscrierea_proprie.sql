-- Contul nu se mai face de om, ci de administrator (decizie, 23 septembrie).
-- Administratorul trece numarul de telefon al locatarului in aplicatie, iar
-- sistemul face contul; parola i se comunica omului pe alta cale. Contul de
-- administrator il facem noi, la inceput.
--
-- Prin urmare dispar amandoua drumurile de inscriere de pana acum:
--   * codurile de invitatie (identitate.invitatii) si limitele lor de
--     incercari (identitate.incercari_invitatii), impreuna cu tot ce le
--     servea: invita_locatar, foloseste_invitatie, revoca_invitatie si
--     adresa_cererii (care citea IP-ul cererii doar pentru acele limite);
--   * cererea de verificare a atestatului (cere_verificare_administrator),
--     pe care si-o trimitea singur cineva care isi facea cont.
--
-- Raman: identitate.administratori cu atestatul si starea lui,
-- verifica_administrator si numeste_administrator, adica drumurile prin care
-- un administrator este numit de noi, cu cheia de serviciu.

drop function identitate.foloseste_invitatie(text);
drop function identitate.invita_locatar(uuid, text);
drop function identitate.revoca_invitatie(uuid);
drop function identitate.adresa_cererii();
drop function identitate.cere_verificare_administrator(text, text);

-- inchide_acces_locatar nu mai are coduri de revocat
create or replace function identitate.inchide_acces_locatar(p_locatar_id uuid, p_data date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update identitate.locatari
     set activ_pana = greatest(p_data, activ_din)
   where id = p_locatar_id
     and bloc_id in (select private.blocuri_administrate())
     and activ_pana is null;
  if not found then
    raise exception 'Legatura nu exista sau nu este in blocul tau.';
  end if;
end;
$$;

-- Nici anonimizarea: nu mai exista invitatii de revocat
create or replace function identitate.anonimizeaza_profil(p_profil_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legaturi integer;
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

  return jsonb_build_object(
    'legaturi_inchise', v_legaturi,
    'mandate_inchise', v_mandate, 'administrator_revocat', v_administratori > 0);
end;
$$;

drop table identitate.incercari_invitatii;
drop table identitate.invitatii;
