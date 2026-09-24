-- Presedintele si cenzorul asociatiei: mandatele exista de la inceput
-- (identitate.membri_asociatie, private.asociatii_supravegheate), dar nimeni
-- nu le putea scrie din aplicatie si nimeni nu putea intra in cont cu ele:
-- identitate.eu() nu intorcea niciodata rolurile acestea, deci un presedinte
-- fara apartament ramanea la ecranul "contul nu este legat de un apartament".
--
-- Adunarea generala ii alege; administratorul trece in aplicatie ce s-a
-- hotarat. De aceea comenzile de mai jos sunt ale administratorului asociatiei,
-- nu ale dezvoltatorului:
--   * numeste_in_conducere() incepe un mandat de presedinte sau de cenzor;
--   * incheie_mandat() il inchide, cu data reala (istoricul ramane).
--
-- Ei citesc tot blocul, dar nu scriu nimic: dreptul de citire il dau helperii
-- private.blocuri_supravegheate() / blocuri_conduse(), iar comenzile de
-- scriere cer private.blocuri_administrate(), care nu ii cuprinde.

create function identitate.numeste_in_conducere(p_profil_id uuid, p_rol text, p_activ_din date default current_date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asociatie uuid;
  v_id uuid;
begin
  if p_rol not in ('presedinte', 'cenzor') then
    raise exception 'Mandatul este de presedinte sau de cenzor.';
  end if;
  select a into v_asociatie from private.asociatii_administrate() a limit 1;
  if v_asociatie is null then
    raise exception 'Doar administratorul asociatiei numeste presedintele si cenzorul.';
  end if;
  if not exists (select 1 from identitate.profiluri where id = p_profil_id) then
    raise exception 'Persoana nu exista.';
  end if;

  insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
  values (v_asociatie, p_profil_id, p_rol, p_activ_din)
  on conflict (asociatie_id, profil_id, rol) do update
    set activ_din = excluded.activ_din, activ_pana = null
    where identitate.membri_asociatie.activ_pana is not null
  returning id into v_id;

  if v_id is null then
    raise exception 'Persoana are deja acest mandat, in curs.';
  end if;
  return v_id;
end;
$$;

comment on function identitate.numeste_in_conducere(uuid, text, date) is
  'Incepe un mandat de presedinte sau de cenzor in asociatia administrata de cel care cere. Un mandat incheiat se redeschide cu data noua; unul in curs nu se dubleaza.';

revoke all on function identitate.numeste_in_conducere(uuid, text, date) from public, anon;
grant execute on function identitate.numeste_in_conducere(uuid, text, date) to authenticated, service_role;

create function identitate.incheie_mandat(p_membru_id uuid, p_data date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membru identitate.membri_asociatie;
begin
  select * into v_membru from identitate.membri_asociatie
   where id = p_membru_id
     and asociatie_id in (select private.asociatii_administrate())
     and rol in ('presedinte', 'cenzor')
     and activ_pana is null;
  if not found then
    raise exception 'Mandatul nu exista, s-a incheiat deja sau nu este in asociatia ta.';
  end if;
  update identitate.membri_asociatie
     set activ_pana = greatest(p_data, activ_din + 1)
   where id = p_membru_id;
end;
$$;

comment on function identitate.incheie_mandat(uuid, date) is
  'Incheie un mandat de presedinte sau de cenzor, cu data reala. Istoricul ramane: randul nu se sterge.';

revoke all on function identitate.incheie_mandat(uuid, date) from public, anon;
grant execute on function identitate.incheie_mandat(uuid, date) to authenticated, service_role;

-- identitate.eu(): rolurile de conducere, intre administrator si locatar.
-- Un presedinte care are si apartament vede blocul (pentru asta i s-a dat
-- contul); apartamentul lui il gaseste in Apartamente, ca orice alt apartament.
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
