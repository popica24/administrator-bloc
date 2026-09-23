-- [C2] Presedintele care locuieste in bloc ramane si locatar.
--
-- Legea 196/2018 cere ca presedintele sa fie proprietar in asociatie, deci
-- cazul este regula, nu exceptia. In identitate.eu() ramura conducerii era
-- pusa inaintea celei de locatar si nu completa apartamentul, asa ca dupa
-- numire omul nu mai putea transmite indexul de apa (administratorul avea sa
-- ii estimeze consumul), nu mai putea scrie o sesizare si nu mai putea vota
-- sau confirma prezenta la adunarea generala: situatie_voturi era chemat cu
-- p_apartament_id null, desi guvernanta.voteaza l-ar fi lasat.
--
-- Acum eu() intoarce si apartamentul lui. Aplicatia ii da amandoua: ecranele
-- de locatar pentru apartamentul lui si panoul de verificare pentru bloc.

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
    -- Conducerea care verifica: presedinte, apoi cenzor (acelasi drept de
    -- citire; rolul se arata pe ecran).
    select m.rol, m.asociatie_id into v_rol, v_asociatie
    from identitate.membri_asociatie m
    where m.profil_id = v_uid
      and m.rol in ('presedinte', 'cenzor')
      and m.activ_din <= current_date
      and (m.activ_pana is null or m.activ_pana > current_date)
    order by (m.rol = 'presedinte') desc, m.activ_din, m.asociatie_id
    limit 1;

    if v_asociatie is not null then
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
        and m.rol in ('presedinte', 'cenzor')
        and m.activ_din <= current_date
        and (m.activ_pana is null or m.activ_pana > current_date);

      -- [C2] ... si, daca locuieste in bloc, apartamentul lui: ramane
      -- locatarul care isi transmite indexul, isi scrie sesizarea si
      -- voteaza. Aceeasi ordine ca la locatari (H2).
      select l.apartament_id into v_ap
      from identitate.locatari l
      where l.profil_id = v_uid and l.bloc_id = v_bloc and l.activ_din <= current_date
        and (l.activ_pana is null or l.activ_pana > current_date)
      order by l.activ_din, l.apartament_id
      limit 1;
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
  end if;

  return jsonb_build_object(
    'profil_id', v_uid,
    'nume', coalesce(v_profil.nume, ''),
    'telefon', v_profil.telefon,
    'rol', v_rol,
    'asociatie_id', v_asociatie,
    'bloc_id', v_bloc,
    'apartament_id', v_ap,
    'blocuri', coalesce(v_blocuri, '[]'::jsonb)
  )
  -- [K21] doar omul respins afla motivul, ca sa-si poata corecta cererea
  || case when v_rol = 'respins' then jsonb_build_object('motiv_respingere', v_adm.motiv_respingere) else '{}'::jsonb end;
end;
$$;
