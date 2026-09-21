-- [K21] identitate.eu() trimite motivul respingerii unui administrator.
--
-- Ecranul administratorului respins (K19) arata motivul si formularul de
-- retrimitere, dar eu() nu trimitea niciodata motiv_respingere catre client,
-- desi coloana exista in identitate.administratori: in aplicatia reala campul
-- lipsea mereu, iar omul nu afla de ce a fost respins.
--
-- Cheia apare doar pentru rolul "respins"; forma raspunsului pentru celelalte
-- roluri ramane neschimbata. Retrimiterea cererii sterge deja motivul
-- (20260920172454).
--
-- Definitia de baza este cea din 20260920144654_eu_locatar_tiebreak_apartament.sql,
-- ultima care a rescris functia (copiata din baza, pg_get_functiondef).
create or replace function identitate.eu()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_profil identitate.profiluri;
  v_adm identitate.administratori;
  v_asociatie uuid;
  v_bloc uuid;
  v_ap uuid;
  v_rol text;
  v_blocuri jsonb;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_profil from identitate.profiluri where id = v_uid;
  select * into v_adm from identitate.administratori where profil_id = v_uid;

  -- Aceleasi conditii ca private.asociatii_administrate(), dar cu order by:
  -- cea mai veche numire (activ_din), apoi asociatie_id, ca sa fie stabila.
  select m.asociatie_id into v_asociatie
  from identitate.membri_asociatie m
  join identitate.administratori a on a.profil_id = m.profil_id and a.stare = 'aprobat'
  where m.profil_id = v_uid
    and m.rol = 'administrator'
    and m.activ_din <= current_date
    and (m.activ_pana is null or m.activ_pana > current_date)
  order by m.activ_din, m.asociatie_id
  limit 1;

  if v_asociatie is not null then
    v_rol := 'administrator';
    select id into v_bloc from organizare.blocuri
      where asociatie_id = v_asociatie and arhivat_la is null order by creat_la limit 1;

    select jsonb_agg(
             jsonb_build_object('id', b.id, 'denumire', b.denumire, 'asociatie_id', b.asociatie_id)
             order by m.activ_din, m.asociatie_id, b.creat_la
           )
      into v_blocuri
    from identitate.membri_asociatie m
    join organizare.blocuri b on b.asociatie_id = m.asociatie_id and b.arhivat_la is null
    where m.profil_id = v_uid
      and m.rol = 'administrator'
      and m.activ_din <= current_date
      and (m.activ_pana is null or m.activ_pana > current_date);
  else
    -- H2: activ_din, apoi apartament_id, ca tiebreaker determinist.
    select l.apartament_id, l.bloc_id into v_ap, v_bloc
    from identitate.locatari l
    where l.profil_id = v_uid and l.activ_din <= current_date
      and (l.activ_pana is null or l.activ_pana > current_date)
    order by l.activ_din, l.apartament_id
    limit 1;
    if v_ap is not null then
      v_rol := 'locatar';
      select asociatie_id into v_asociatie from organizare.blocuri where id = v_bloc;
    elsif v_adm.stare = 'in_asteptare' then
      v_rol := 'in_asteptare';
    elsif v_adm.stare = 'respins' then
      v_rol := 'respins';
    else
      v_rol := 'fara_apartament';
    end if;
  end if;

  return jsonb_build_object(
    'profil_id', v_uid,
    'nume', coalesce(v_profil.nume, ''),
    'telefon', v_profil.telefon,
    'email', v_profil.email,
    'rol', v_rol,
    'asociatie_id', v_asociatie,
    'bloc_id', v_bloc,
    'apartament_id', v_ap,
    'blocuri', coalesce(v_blocuri, '[]'::jsonb)
  )
  -- [K21] doar omul respins afla motivul, ca sa-si poata corecta cererea
  || case when v_rol = 'respins' then jsonb_build_object('motiv_respingere', v_adm.motiv_respingere) else '{}'::jsonb end;
end;
$function$;
