-- identitate.eu() alegea asociatia administratorului cu
-- `private.asociatii_administrate() ... limit 1`, fara `order by`: cand
-- acelasi profil administreaza doua asociatii (mandate pe amandoua),
-- Postgres nu garanteaza care asociatie iese prima, deci un administrator
-- cu doua asociatii ajungea, imprevizibil, la una singura, iar celalalte
-- blocuri deveneau invizibile in aplicatie (audit S12).
--
-- Reparatie: alegerea devine determinista (cea mai veche numire, ca sa fie
-- stabila in timp), iar eu() expune acum si lista completa a blocurilor
-- administrate (id, denumire, asociatie_id), ca sa poata exista un selector
-- de bloc in aplicatie in loc sa se piarda restul asociatiilor.

create or replace function identitate.eu()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    select l.apartament_id, l.bloc_id into v_ap, v_bloc
    from identitate.locatari l
    where l.profil_id = v_uid and l.activ_din <= current_date
      and (l.activ_pana is null or l.activ_pana > current_date)
    order by l.activ_din
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
  );
end;
$$;
