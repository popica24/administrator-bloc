-- identitate.anonimizeaza_profil era incompleta (audit 2: C7).
--
-- Patru urme ale persoanei ii supravietuiau stergerii:
--   - identitate.membri_asociatie: un mandat de presedinte, cenzor sau
--     administrator, deschis (activ_pana null), ramanea deschis;
--   - identitate.administratori: stare ramanea 'aprobat', desi persoana nu
--     mai are nume sau email, un administrator aprobat, fantoma;
--   - auth.identities: emailul real ramanea in identity_data (coloana
--     generata `email` a tabelei se calculeaza de acolo, nu din auth.users),
--     deci persoana putea fi gasita dupa emailul "sters";
--   - auth.sessions / auth.refresh_tokens: sesiunile deschise si token-urile
--     de reimprospatare supravietuiau, deci un browser ramas autentificat
--     continua sa functioneze dupa "stergere".
--
-- Aici sunt cele patru completari. Restul functiei (profil, auth.users,
-- inchiderea legaturilor de locatar, revocarea invitatiilor nefolosite)
-- ramane neschimbat. Raportul intors capata doua chei noi: mandate_inchise
-- (cate mandate de membru_asociatie s-au inchis) si administrator_revocat
-- (daca persoana era administrator aprobat sau in asteptare si a fost trecuta
-- pe 'respins').

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

  -- Coloana `email` a lui auth.identities e generata din identity_data, nu din
  -- auth.users.email: fara aceasta actualizare, cautarea dupa email tot gasea
  -- persoana.
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', 'anonim-' || p_profil_id || '@adminbloc.invalid')
   where user_id = p_profil_id and identity_data ? 'email';

  -- O sesiune deschisa (sau un token de reimprospatare inca valid) lasa
  -- persoana autentificata dupa "stergere".
  delete from auth.sessions where user_id = p_profil_id;
  delete from auth.refresh_tokens where user_id = p_profil_id::text;

  update identitate.locatari
     set activ_pana = greatest(current_date, activ_din + 1)
   where profil_id = p_profil_id and activ_pana is null;
  get diagnostics v_legaturi = row_count;

  update identitate.membri_asociatie
     set activ_pana = greatest(current_date, activ_din + 1)
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

comment on function identitate.anonimizeaza_profil(uuid) is
  'Sterge datele personale ale unei persoane si ii inchide accesul (mandate, calitatea de administrator, identitatea Auth, sesiunile), pastrand randurile contabile care trimit la ea.';
