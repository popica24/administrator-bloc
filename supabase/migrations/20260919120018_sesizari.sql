-- Sesizari (docs/schema-propunere.md §3.F): ce s-a stricat si cine repara.
-- O sesizare este o conversatie ("am cumparat becul" -> "tot nu merge"), nu un
-- singur raspuns. Scrierea trece prin comenzi; RLS pe tabele este de citire.
--
-- §8.4: locatarul vede si ce au semnalat altii, ca sa nu scrie de doua ori,
-- dar fara apartamentul si fara autorul lor (functia sesizari_bloc).

create table sesizari.sesizari (
  id uuid primary key default gen_random_uuid(),

  bloc_id uuid not null,
  apartament_id uuid not null,

  autor_id uuid not null
    references identitate.profiluri (id) on delete restrict,

  categorie text not null
    constraint sesizari_categorie_check check (categorie in ('instalatii', 'iluminat', 'acces', 'curatenie', 'altele')),

  titlu text not null
    constraint sesizari_titlu_check check (length(btrim(titlu)) > 0),

  descriere text not null
    constraint sesizari_descriere_check check (length(btrim(descriere)) > 0),

  stare text not null default 'noua'
    constraint sesizari_stare_check check (stare in ('noua', 'in_lucru', 'rezolvata')),

  preluata_de uuid
    references identitate.profiluri (id) on delete restrict,

  preluata_la timestamptz,
  rezolvata_la timestamptz,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint sesizari_apartament_fk foreign key (apartament_id, bloc_id)
    references organizare.apartamente (id, bloc_id) on delete restrict
);

comment on table sesizari.sesizari is
  'O defectiune raportata. Momentele de stare dau "de cat timp asteapta" fara coloane in plus.';
comment on column sesizari.sesizari.autor_id is
  'Locatarul care a scris-o, sau administratorul care a preluat-o la telefon.';

-- Sesizarile deschise si de cat timp asteapta (§10.5).
create index sesizari_deschise_idx on sesizari.sesizari (bloc_id, creat_la) where stare <> 'rezolvata';
create index sesizari_apartament_idx on sesizari.sesizari (apartament_id, bloc_id);
create index sesizari_autor_id_idx on sesizari.sesizari (autor_id);
create index sesizari_preluata_de_idx on sesizari.sesizari (preluata_de);

create trigger sesizari_actualizat_la
  before update on sesizari.sesizari
  for each row execute function public.seteaza_actualizat_la();

create table sesizari.sesizari_mesaje (
  id uuid primary key default gen_random_uuid(),

  sesizare_id uuid not null
    references sesizari.sesizari (id) on delete restrict,

  autor_id uuid not null
    references identitate.profiluri (id) on delete restrict,

  din_administratie boolean not null default false,

  text text not null
    constraint sesizari_mesaje_text_check check (length(btrim(text)) > 0),

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

create index sesizari_mesaje_sesizare_id_idx on sesizari.sesizari_mesaje (sesizare_id, creat_la);
create index sesizari_mesaje_autor_id_idx on sesizari.sesizari_mesaje (autor_id);

create trigger sesizari_mesaje_actualizat_la
  before update on sesizari.sesizari_mesaje
  for each row execute function public.seteaza_actualizat_la();

create table sesizari.sesizari_poze (
  id uuid primary key default gen_random_uuid(),

  sesizare_id uuid not null
    references sesizari.sesizari (id) on delete restrict,

  cale text not null
    constraint sesizari_poze_cale_check check (length(btrim(cale)) > 0),

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on column sesizari.sesizari_poze.cale is 'Calea in bucket-ul poze: <bloc_id>/<apartament_id>/<fisier>.';

create index sesizari_poze_sesizare_id_idx on sesizari.sesizari_poze (sesizare_id);

create trigger sesizari_poze_actualizat_la
  before update on sesizari.sesizari_poze
  for each row execute function public.seteaza_actualizat_la();

alter table sesizari.sesizari enable row level security;
alter table sesizari.sesizari_mesaje enable row level security;
alter table sesizari.sesizari_poze enable row level security;

create policy "Sesizarile proprii si cele din blocurile conduse"
  on sesizari.sesizari for select to authenticated
  using (apartament_id in (select private.apartamentele_mele()) or bloc_id in (select private.blocuri_conduse()));

create policy "Mesajele se vad ca sesizarea lor"
  on sesizari.sesizari_mesaje for select to authenticated
  using (exists (select 1 from sesizari.sesizari s where s.id = sesizare_id));

create policy "Pozele se vad ca sesizarea lor"
  on sesizari.sesizari_poze for select to authenticated
  using (exists (select 1 from sesizari.sesizari s where s.id = sesizare_id));

grant select on all tables in schema sesizari to authenticated;
grant all on all tables in schema sesizari to service_role;

-- =============================================================================
-- Comenzile
-- =============================================================================

create function sesizari.adauga_sesizare(
  p_apartament_id uuid,
  p_titlu text,
  p_categorie text,
  p_descriere text,
  p_poze text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bloc uuid;
  v_id uuid;
begin
  if p_apartament_id not in (select private.apartamentele_mele()) then
    raise exception 'Poti trimite sesizari doar pentru apartamentul tau.';
  end if;
  select bloc_id into v_bloc from organizare.apartamente where id = p_apartament_id;
  insert into sesizari.sesizari (bloc_id, apartament_id, autor_id, categorie, titlu, descriere)
  values (v_bloc, p_apartament_id, auth.uid(), p_categorie, btrim(p_titlu), coalesce(nullif(btrim(p_descriere), ''), btrim(p_titlu)))
  returning id into v_id;
  insert into sesizari.sesizari_poze (sesizare_id, cale)
  select v_id, c from unnest(coalesce(p_poze, '{}')) as c
  where c like v_bloc::text || '/' || p_apartament_id::text || '/%';
  perform evenimente.inregistreaza('SesizareDeschisa', 'sesizari', v_id,
    jsonb_build_object('sesizare_id', v_id, 'bloc_id', v_bloc, 'apartament_id', p_apartament_id, 'titlu', btrim(p_titlu)));
  return v_id;
end;
$$;

-- Un mesaj in conversatie. Primul raspuns al administratiei preia sesizarea.
create function sesizari.scrie_mesaj(p_sesizare_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s sesizari.sesizari;
  v_admin boolean;
begin
  select * into v_s from sesizari.sesizari where id = p_sesizare_id for update;
  if not found then
    raise exception 'Sesizarea nu exista.';
  end if;
  v_admin := v_s.bloc_id in (select private.blocuri_administrate());
  if not v_admin and v_s.apartament_id not in (select private.apartamentele_mele()) then
    raise exception 'Nu poti scrie la aceasta sesizare.';
  end if;
  if v_s.stare = 'rezolvata' then
    raise exception 'Sesizarea este rezolvata. Scrie o sesizare noua daca problema a revenit.';
  end if;
  insert into sesizari.sesizari_mesaje (sesizare_id, autor_id, din_administratie, text)
  values (p_sesizare_id, auth.uid(), v_admin, btrim(p_text));
  if v_admin then
    if v_s.stare = 'noua' then
      update sesizari.sesizari set stare = 'in_lucru', preluata_de = auth.uid(), preluata_la = now() where id = p_sesizare_id;
    end if;
    perform evenimente.inregistreaza('SesizareRaspuns', 'sesizari', p_sesizare_id,
      jsonb_build_object('sesizare_id', p_sesizare_id, 'apartament_id', v_s.apartament_id, 'titlu', v_s.titlu, 'text', btrim(p_text)));
  end if;
end;
$$;

create function sesizari.preia_sesizare(p_sesizare_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update sesizari.sesizari
     set stare = 'in_lucru', preluata_de = auth.uid(), preluata_la = now()
   where id = p_sesizare_id and stare = 'noua' and bloc_id in (select private.blocuri_administrate());
end;
$$;

create function sesizari.rezolva_sesizare(p_sesizare_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s sesizari.sesizari;
begin
  update sesizari.sesizari
     set stare = 'rezolvata', rezolvata_la = now(),
         preluata_de = coalesce(preluata_de, auth.uid()), preluata_la = coalesce(preluata_la, now())
   where id = p_sesizare_id and stare <> 'rezolvata' and bloc_id in (select private.blocuri_administrate())
  returning * into v_s;
  if not found then
    raise exception 'Sesizarea nu exista, este deja rezolvata sau nu este din blocul tau.';
  end if;
  perform evenimente.inregistreaza('SesizareRezolvata', 'sesizari', p_sesizare_id,
    jsonb_build_object('sesizare_id', p_sesizare_id, 'apartament_id', v_s.apartament_id, 'titlu', v_s.titlu));
end;
$$;

-- Ce s-a semnalat in bloc, fara apartament si fara autor (§8.4).
create function sesizari.sesizari_bloc(p_bloc_id uuid)
returns table (id uuid, titlu text, categorie text, descriere text, stare text, creat_la timestamptz, preluata_la timestamptz, rezolvata_la timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_bloc_id not in (select private.blocuri_vizibile()) then
    raise exception 'Nu ai acces la acest bloc.';
  end if;
  return query
  select s.id, s.titlu, s.categorie, s.descriere, s.stare, s.creat_la, s.preluata_la, s.rezolvata_la
  from sesizari.sesizari s
  where s.bloc_id = p_bloc_id
    and s.apartament_id not in (select private.apartamentele_mele())
    and (s.stare <> 'rezolvata' or s.rezolvata_la > now() - interval '30 days')
  order by s.creat_la desc;
end;
$$;

revoke execute on all functions in schema sesizari from public, anon;
grant execute on all functions in schema sesizari to authenticated, service_role;

create trigger sesizari_audit after insert or update or delete on sesizari.sesizari
  for each row execute function audit.inregistreaza();
