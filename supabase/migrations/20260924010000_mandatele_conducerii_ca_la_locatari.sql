-- [C5, C6, C7, C8, C12] Mandatele de conducere, tinute ca legaturile
-- locatarilor: un rand pentru fiecare mandat, istoricul ramane.
--
-- Auditul 4 a gasit cinci lucruri in comenzile de ieri:
--
--   C7  `on conflict (asociatie_id, profil_id, rol) do update` suprascria
--       mandatul precedent la o realegere: presedinta din 2024-2026, realeasa
--       in 2028, ramanea cu un singur rand, "din 2028". Comentariul promitea
--       "istoricul ramane". Acum cheia unica este partiala, pe mandatul in
--       curs (ca locatari_activ_key), si fiecare mandat nou este un rand nou.
--   C6  `activ_pana = greatest(p_data, activ_din + 1)` tinea drepturile pana
--       a doua zi: administratorul care numea din greseala alt om si incheia
--       imediat mandatul ii lasa citire pe tot blocul pana la miezul noptii.
--       Constrangerea cerea activ_pana > activ_din; acum cere >=, iar data
--       este cea reala, ca la inchide_acces_locatar.
--   C5  asociatia se alegea cu `limit 1`, fara ordine: un administrator cu
--       doua asociatii putea trimite mandatul in cealalta asociatie decat cea
--       pe care o vede pe ecran. Acum ori o spune apelantul (p_asociatie_id),
--       ori se alege ca in identitate.eu(): cea mai veche numire.
--   C8  nimic nu oprea administratorul sa se numeasca pe el insusi cenzor,
--       adica exact separarea pe care comanda exista sa o apere.
--   C12 un mandat cu activ_din in viitor aparea pe ecran ca fiind in curs.

-- -----------------------------------------------------------------------------
-- Tabela: cheia unica este a mandatului in curs, nu a perechii (om, rol)
-- -----------------------------------------------------------------------------

alter table identitate.membri_asociatie
  drop constraint membri_asociatie_asociatie_profil_rol_key;

create unique index membri_asociatie_activ_key
  on identitate.membri_asociatie (asociatie_id, profil_id, rol)
  where activ_pana is null;

alter table identitate.membri_asociatie
  drop constraint membri_asociatie_perioada_check;
alter table identitate.membri_asociatie
  add constraint membri_asociatie_perioada_check
    check (activ_pana is null or activ_pana >= activ_din);

-- numeste_administrator mergea pe cheia unica de mai sus
create or replace function identitate.numeste_administrator(p_profil_id uuid, p_asociatie_id uuid, p_numar_atestat text, p_activ_din date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.este_serviciu() then
    raise exception 'Doar dezvoltatorul numeste administratori.';
  end if;
  insert into identitate.administratori (profil_id, numar_atestat, stare, verificat_la)
  values (p_profil_id, p_numar_atestat, 'aprobat', now())
  on conflict (profil_id) do update set stare = 'aprobat', numar_atestat = coalesce(excluded.numar_atestat, identitate.administratori.numar_atestat);
  if not exists (
    select 1 from identitate.membri_asociatie
     where asociatie_id = p_asociatie_id and profil_id = p_profil_id
       and rol = 'administrator' and activ_pana is null
  ) then
    insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
    values (p_asociatie_id, p_profil_id, 'administrator', p_activ_din);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Asociatia administrata, aleasa la fel peste tot
-- -----------------------------------------------------------------------------

create function identitate.asociatia_de_administrat(p_asociatie_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_asociatie uuid;
begin
  -- Aceleasi conditii ca private.asociatii_administrate(), cu ordinea din
  -- identitate.eu(): cea mai veche numire, apoi asociatie_id.
  select m.asociatie_id into v_asociatie
  from identitate.membri_asociatie m
  join identitate.administratori a on a.profil_id = m.profil_id and a.stare = 'aprobat'
  where m.profil_id = auth.uid()
    and m.rol = 'administrator'
    and m.activ_din <= current_date
    and (m.activ_pana is null or m.activ_pana > current_date)
    and (p_asociatie_id is null or m.asociatie_id = p_asociatie_id)
  order by m.activ_din, m.asociatie_id
  limit 1;

  if v_asociatie is null then
    raise exception 'Nu esti administratorul acestei asociatii.';
  end if;
  return v_asociatie;
end;
$$;

comment on function identitate.asociatia_de_administrat(uuid) is
  'Asociatia pe care o administrezi, aceeasi pe care o arata identitate.eu(). Arunca daca nu esti administratorul ei. O foloseste si cont-locatar, inainte de a face un cont.';

revoke all on function identitate.asociatia_de_administrat(uuid) from public, anon;
grant execute on function identitate.asociatia_de_administrat(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Comenzile conducerii
-- -----------------------------------------------------------------------------

drop function identitate.numeste_in_conducere(uuid, text, date);

create function identitate.numeste_in_conducere(p_profil_id uuid, p_rol text, p_activ_din date default current_date, p_asociatie_id uuid default null)
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
  if p_activ_din > current_date then
    raise exception 'Mandatul nu poate incepe in viitor.';
  end if;
  begin
    v_asociatie := identitate.asociatia_de_administrat(p_asociatie_id);
  exception when sqlstate 'P0001' then
    raise exception 'Doar administratorul asociatiei numeste presedintele si cenzorul.';
  end;
  if not exists (select 1 from identitate.profiluri where id = p_profil_id) then
    raise exception 'Persoana nu exista.';
  end if;
  if exists (
    select 1 from identitate.membri_asociatie
     where asociatie_id = v_asociatie and profil_id = p_profil_id
       and rol = 'administrator' and activ_pana is null
  ) then
    raise exception 'Administratorul asociatiei nu poate fi si presedinte sau cenzor: el este cel verificat.';
  end if;
  if exists (
    select 1 from identitate.membri_asociatie
     where asociatie_id = v_asociatie and profil_id = p_profil_id
       and rol = p_rol and activ_pana is null
  ) then
    raise exception 'Persoana are deja acest mandat, in curs.';
  end if;

  -- Un mandat nou este un rand nou: cel vechi ramane cu perioada lui.
  insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
  values (v_asociatie, p_profil_id, p_rol, p_activ_din)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function identitate.numeste_in_conducere(uuid, text, date, uuid) is
  'Incepe un mandat de presedinte sau de cenzor in asociatia administrata de cel care cere. Fiecare mandat este un rand nou; unul in curs nu se dubleaza.';

revoke all on function identitate.numeste_in_conducere(uuid, text, date, uuid) from public, anon;
grant execute on function identitate.numeste_in_conducere(uuid, text, date, uuid) to authenticated, service_role;

create or replace function identitate.incheie_mandat(p_membru_id uuid, p_data date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activ_din date;
begin
  select activ_din into v_activ_din from identitate.membri_asociatie
   where id = p_membru_id
     and asociatie_id in (select private.asociatii_administrate())
     and rol in ('presedinte', 'cenzor')
     and activ_pana is null;
  if not found then
    raise exception 'Mandatul nu exista, s-a incheiat deja sau nu este in asociatia ta.';
  end if;
  -- Data reala, ca la inchide_acces_locatar: un mandat incheiat azi nu mai da
  -- niciun drept azi (drepturile cer activ_pana > current_date).
  update identitate.membri_asociatie
     set activ_pana = greatest(p_data, v_activ_din)
   where id = p_membru_id;
end;
$$;
