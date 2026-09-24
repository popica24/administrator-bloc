-- Administratorul face contul locatarului: trece numarul lui de telefon in
-- aplicatie, iar sistemul creeaza contul si intoarce o parola, pe care
-- administratorul i-o da omului pe hartie sau la telefon.
--
-- Contul din Supabase Auth il creeaza Edge Function-ul cont-locatar, cu cheia
-- de serviciu (numai ea poate crea conturi). Aici sunt cele doua functii pe
-- care le foloseste:
--   * apartament_de_administrat() raspunde la intrebarea "am voie pe
--     apartamentul asta?", cu tokenul administratorului, inainte de orice
--     scriere. Intoarce si blocul, ca functia sa nu mai caute o data.
--   * leaga_locatar() scrie legatura dintre contul nou si apartament. Doar
--     cheia de serviciu o poate chema: profilul vine din contul tocmai creat,
--     deci nu se poate verifica prin auth.uid().

create function identitate.apartament_de_administrat(p_apartament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ap organizare.apartamente;
begin
  if p_apartament_id not in (select private.apartamente_administrate()) then
    raise exception 'Doar administratorul blocului poate face conturi.';
  end if;
  select * into v_ap from organizare.apartamente where id = p_apartament_id;
  return jsonb_build_object('apartament_id', v_ap.id, 'bloc_id', v_ap.bloc_id, 'numar', v_ap.numar);
end;
$$;

comment on function identitate.apartament_de_administrat(uuid) is
  'Raspunde daca apartamentul este al unui bloc administrat de cel care intreaba; altfel refuza. Folosita de Edge Function-ul cont-locatar inainte sa creeze contul.';

revoke all on function identitate.apartament_de_administrat(uuid) from public, anon;
grant execute on function identitate.apartament_de_administrat(uuid) to authenticated, service_role;

create function identitate.leaga_locatar(p_profil_id uuid, p_apartament_id uuid, p_calitate text default 'proprietar')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ap organizare.apartamente;
  v_id uuid;
begin
  if not private.este_serviciu() then
    raise exception 'Doar dezvoltatorul poate lega un cont de un apartament.';
  end if;
  select * into v_ap from organizare.apartamente where id = p_apartament_id;
  if not found then
    raise exception 'Apartamentul nu exista.';
  end if;
  if exists (
    select 1 from identitate.locatari
    where profil_id = p_profil_id and apartament_id = p_apartament_id and activ_pana is null
  ) then
    raise exception 'Contul este deja legat de acest apartament.';
  end if;
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (p_apartament_id, v_ap.bloc_id, p_profil_id, p_calitate, current_date)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function identitate.leaga_locatar(uuid, uuid, text) is
  'Leaga un cont de un apartament, din ziua de azi. O cheama Edge Function-ul cont-locatar, cu cheia de serviciu, dupa ce a creat contul in Supabase Auth.';

revoke all on function identitate.leaga_locatar(uuid, uuid, text) from public, anon, authenticated;
grant execute on function identitate.leaga_locatar(uuid, uuid, text) to service_role;

-- Profilul unui cont nou pastreaza numarul de telefon: el este identitatea
-- omului, iar adresa din auth.users este doar forma ceruta de Supabase Auth.
create or replace function identitate.la_cont_nou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into identitate.profiluri (id, nume, telefon, email)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nume'), ''), 'Utilizator'),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'telefon'), ''), nullif(btrim(new.phone), '')),
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
