-- Identitate (docs/schema-propunere.md §3.B, §4): cine este autentificat, ce
-- rol are si unde. De email si parola se ocupa Supabase Auth; tot restul
-- bazei de date trimite la identitate.profiluri, niciodata la auth.users.
--
-- Contine si nucleul comun (shared kernel): functiile ajutatoare din schema
-- private, pe care le folosesc politicile RLS ale tuturor contextelor.

-- =============================================================================
-- profiluri: un rand pentru fiecare cont
-- =============================================================================

create table identitate.profiluri (
  id uuid primary key
    references auth.users (id) on delete cascade,

  nume text not null
    constraint profiluri_nume_check check (length(btrim(nume)) > 0),

  telefon text,
  email text,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table identitate.profiluri is
  'Profilul unui cont din Supabase Auth. Randul il creeaza trigger-ul identitate.la_cont_nou.';
comment on column identitate.profiluri.email is
  'Copie informativa, pentru fisa apartamentului. Sursa adevarului ramane auth.users.';

create trigger profiluri_actualizat_la
  before update on identitate.profiluri
  for each row execute function public.seteaza_actualizat_la();

-- Contul nou primeste profil din metadatele trimise la inregistrare.
create function identitate.la_cont_nou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into identitate.profiluri (id, nume, telefon, email)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nume'), ''), split_part(new.email, '@', 1), 'Utilizator'),
    nullif(btrim(new.raw_user_meta_data ->> 'telefon'), ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function identitate.la_cont_nou() from public, anon, authenticated;

create trigger cont_nou_profil
  after insert on auth.users
  for each row execute function identitate.la_cont_nou();

-- =============================================================================
-- administratori: verificarea atestatului
-- =============================================================================

create table identitate.administratori (
  profil_id uuid primary key
    references identitate.profiluri (id) on delete restrict,

  numar_atestat text,
  atestat_cale text,

  stare text not null default 'in_asteptare'
    constraint administratori_stare_check check (stare in ('in_asteptare', 'aprobat', 'respins')),

  motiv_respingere text,
  verificat_la timestamptz,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table identitate.administratori is
  'Administratorii care s-au inregistrat. Doar service_role schimba starea; un administrator neaprobat nu vede nimic (§4).';

create trigger administratori_actualizat_la
  before update on identitate.administratori
  for each row execute function public.seteaza_actualizat_la();

-- Aprobarea inregistreaza AdministratorAprobat (mesajul de bun venit).
create function identitate.la_administrator_verificat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stare is distinct from old.stare and new.stare in ('aprobat', 'respins') then
    new.verificat_la := now();
    if new.stare = 'aprobat' then
      perform evenimente.inregistreaza('AdministratorAprobat', 'identitate', new.profil_id, jsonb_build_object('profil_id', new.profil_id));
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function identitate.la_administrator_verificat() from public, anon, authenticated;

create trigger administratori_verificat
  before update on identitate.administratori
  for each row execute function identitate.la_administrator_verificat();

-- =============================================================================
-- membri_asociatie: mandatele (administrator, presedinte, cenzor)
-- =============================================================================

create table identitate.membri_asociatie (
  id uuid primary key default gen_random_uuid(),

  asociatie_id uuid not null
    references organizare.asociatii (id) on delete restrict,

  profil_id uuid not null
    references identitate.profiluri (id) on delete restrict,

  rol text not null
    constraint membri_asociatie_rol_check check (rol in ('administrator', 'presedinte', 'cenzor')),

  activ_din date not null default current_date,
  activ_pana date,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint membri_asociatie_asociatie_profil_rol_key unique (asociatie_id, profil_id, rol),
  constraint membri_asociatie_perioada_check check (activ_pana is null or activ_pana > activ_din)
);

comment on table identitate.membri_asociatie is
  'Cine conduce o asociatie. Mandatele se termina cu activ_pana; istoricul ramane (§11.3).';

create index membri_asociatie_profil_id_idx on identitate.membri_asociatie (profil_id);

create trigger membri_asociatie_actualizat_la
  before update on identitate.membri_asociatie
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- locatari: ce persoana tine de ce apartament
-- =============================================================================

create table identitate.locatari (
  id uuid primary key default gen_random_uuid(),

  apartament_id uuid not null,
  bloc_id uuid not null,

  profil_id uuid not null
    references identitate.profiluri (id) on delete restrict,

  calitate text not null
    constraint locatari_calitate_check check (calitate in ('proprietar', 'chirias', 'membru_familie')),

  activ_din date not null default current_date,
  activ_pana date,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint locatari_apartament_fk foreign key (apartament_id, bloc_id)
    references organizare.apartamente (id, bloc_id) on delete restrict
);

comment on table identitate.locatari is
  'Legatura dintre un cont si un apartament. O familie are mai multe conturi, un om poate avea doua apartamente.';
comment on column identitate.locatari.activ_pana is
  'Accesul inchis la vanzare sau mutare (§11.6). Legaturile vechi raman ca istoric.';

create unique index locatari_activ_key on identitate.locatari (apartament_id, profil_id) where activ_pana is null;
create index locatari_profil_id_idx on identitate.locatari (profil_id);
create index locatari_apartament_bloc_idx on identitate.locatari (apartament_id, bloc_id);
create index locatari_bloc_id_idx on identitate.locatari (bloc_id);

create trigger locatari_actualizat_la
  before update on identitate.locatari
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- invitatii: codul de la administrator
-- =============================================================================

create table identitate.invitatii (
  id uuid primary key default gen_random_uuid(),

  apartament_id uuid not null
    references organizare.apartamente (id) on delete restrict,

  cod text not null
    constraint invitatii_cod_check check (cod ~ '^[A-HJ-NP-Z2-9]{6,8}$'),

  calitate text not null
    constraint invitatii_calitate_check check (calitate in ('proprietar', 'chirias', 'membru_familie')),

  creat_de uuid
    references identitate.profiluri (id) on delete restrict,

  expira_la timestamptz not null,

  folosita_de uuid
    references identitate.profiluri (id) on delete restrict,

  folosita_la timestamptz,
  revocata_la timestamptz,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint invitatii_cod_key unique (cod)
);

comment on table identitate.invitatii is
  'Cod de 8 caractere, fara 0/O si 1/I, valabil 30 de zile, o singura folosire. Se foloseste doar prin identitate.foloseste_invitatie.';

create index invitatii_apartament_id_idx on identitate.invitatii (apartament_id);
create index invitatii_creat_de_idx on identitate.invitatii (creat_de);
create index invitatii_folosita_de_idx on identitate.invitatii (folosita_de);

create trigger invitatii_actualizat_la
  before update on identitate.invitatii
  for each row execute function public.seteaza_actualizat_la();

-- Cheile spre profiluri care nu puteau exista in migratia organizare
alter table organizare.apartamente_persoane
  add constraint apartamente_persoane_modificat_de_fkey
  foreign key (modificat_de) references identitate.profiluri (id) on delete restrict;
alter table organizare.inrolare_apartamente
  add constraint inrolare_apartamente_confirmat_de_fkey
  foreign key (confirmat_de) references identitate.profiluri (id) on delete restrict;

-- =============================================================================
-- Nucleul comun: functiile ajutatoare pentru RLS
-- security definer, ca sa poata citi mandatele fara ca RLS sa le blocheze;
-- search_path gol; apelate in politici ca (select private.f()), deci o data
-- pe interogare, nu o data pe rand.
-- =============================================================================

-- Asociatiile in care apelantul este administrator aprobat, cu mandat activ azi.
create function private.asociatii_administrate()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.asociatie_id
  from identitate.membri_asociatie m
  join identitate.administratori a on a.profil_id = m.profil_id and a.stare = 'aprobat'
  where m.profil_id = (select auth.uid())
    and m.rol = 'administrator'
    and m.activ_din <= current_date
    and (m.activ_pana is null or m.activ_pana > current_date);
$$;

create function private.blocuri_administrate()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from organizare.blocuri b
  where b.asociatie_id in (select private.asociatii_administrate())
    and b.arhivat_la is null;
$$;

create function private.apartamente_administrate()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from organizare.apartamente a
  where a.bloc_id in (select private.blocuri_administrate());
$$;

-- Presedintele si cenzorul: citire pe vederea administratorului (§8.5).
create function private.asociatii_supravegheate()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.asociatie_id
  from identitate.membri_asociatie m
  where m.profil_id = (select auth.uid())
    and m.rol in ('presedinte', 'cenzor')
    and m.activ_din <= current_date
    and (m.activ_pana is null or m.activ_pana > current_date);
$$;

create function private.blocuri_supravegheate()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from organizare.blocuri b
  where b.asociatie_id in (select private.asociatii_supravegheate())
    and b.arhivat_la is null;
$$;

-- Apartamentele de care apelantul este legat ca locatar, azi.
create function private.apartamentele_mele()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.apartament_id
  from identitate.locatari l
  where l.profil_id = (select auth.uid())
    and l.activ_din <= current_date
    and (l.activ_pana is null or l.activ_pana > current_date);
$$;

create function private.blocurile_mele()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct l.bloc_id
  from identitate.locatari l
  where l.profil_id = (select auth.uid())
    and l.activ_din <= current_date
    and (l.activ_pana is null or l.activ_pana > current_date);
$$;

-- Tot ce poate citi apelantul, in orice rol: administrator, presedinte/cenzor, locatar.
create function private.blocuri_vizibile()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.blocuri_administrate()
  union
  select private.blocuri_supravegheate()
  union
  select private.blocurile_mele();
$$;

create function private.asociatii_vizibile()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.asociatie_id
  from organizare.blocuri b
  where b.id in (select private.blocuri_vizibile());
$$;

-- Blocurile pe care apelantul le vede cu toate apartamentele (nu doar pe al lui)
create function private.blocuri_conduse()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.blocuri_administrate()
  union
  select private.blocuri_supravegheate();
$$;

-- Apelul vine de la server: service_role prin API, sau un job pg_cron (sesiunea postgres).
-- In interiorul unei functii security definer, session_user ramane rolul de
-- conectare, deci nu poate fi fortat de un utilizator al API-ului.
create function private.este_serviciu()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role' or session_user in ('postgres', 'supabase_admin');
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- =============================================================================
-- Politicile RLS pentru Organizare
-- =============================================================================

create policy "Asociatia se vede de membrii si locatarii ei"
  on organizare.asociatii for select to authenticated
  using (id in (select private.asociatii_vizibile()));
create policy "Administratorul modifica datele asociatiei"
  on organizare.asociatii for update to authenticated
  using (id in (select private.asociatii_administrate()))
  with check (id in (select private.asociatii_administrate()));

create policy "Blocul se vede de membrii si locatarii lui"
  on organizare.blocuri for select to authenticated
  using (id in (select private.blocuri_vizibile()));
create policy "Administratorul modifica blocul"
  on organizare.blocuri for update to authenticated
  using (id in (select private.blocuri_administrate()))
  with check (id in (select private.blocuri_administrate()));

create policy "Apartamentele se vad de conducere, al tau se vede de tine"
  on organizare.apartamente for select to authenticated
  using (bloc_id in (select private.blocuri_conduse()) or id in (select private.apartamentele_mele()));
create policy "Administratorul adauga apartamente"
  on organizare.apartamente for insert to authenticated
  with check (bloc_id in (select private.blocuri_administrate()));
create policy "Administratorul modifica fisa apartamentului"
  on organizare.apartamente for update to authenticated
  using (bloc_id in (select private.blocuri_administrate()))
  with check (bloc_id in (select private.blocuri_administrate()));

create policy "Persoanele se vad ca apartamentul"
  on organizare.apartamente_persoane for select to authenticated
  using (
    apartament_id in (select private.apartamentele_mele())
    or apartament_id in (select a.id from organizare.apartamente a where a.bloc_id in (select private.blocuri_conduse()))
  );
-- Istoricul doar se completeaza: de la luna curenta inainte, niciodata in urma,
-- ca listele publicate sa ramana cum au fost calculate.
create policy "Administratorul adauga o schimbare de persoane"
  on organizare.apartamente_persoane for insert to authenticated
  with check (
    apartament_id in (select private.apartamente_administrate())
    and modificat_de = (select auth.uid())
    and valabil_din >= date_trunc('month', current_date)::date
  );

create policy "Inrolarea se vede de conducerea blocului"
  on organizare.inrolare_apartamente for select to authenticated
  using (bloc_id in (select private.blocuri_conduse()));
create policy "Administratorul propune apartamente"
  on organizare.inrolare_apartamente for insert to authenticated
  with check (bloc_id in (select private.blocuri_administrate()) and stare = 'propus');
create policy "Administratorul corecteaza o propunere"
  on organizare.inrolare_apartamente for update to authenticated
  using (bloc_id in (select private.blocuri_administrate()) and stare = 'propus')
  with check (bloc_id in (select private.blocuri_administrate()) and stare = 'propus');
create policy "Administratorul sterge o propunere"
  on organizare.inrolare_apartamente for delete to authenticated
  using (bloc_id in (select private.blocuri_administrate()) and stare = 'propus');

create policy "Contactele se vad in toata asociatia"
  on organizare.contacte for select to authenticated
  using (asociatie_id in (select private.asociatii_vizibile()));
create policy "Administratorul adauga contacte"
  on organizare.contacte for insert to authenticated
  with check (asociatie_id in (select private.asociatii_administrate()));
create policy "Administratorul modifica contacte"
  on organizare.contacte for update to authenticated
  using (asociatie_id in (select private.asociatii_administrate()))
  with check (asociatie_id in (select private.asociatii_administrate()));
create policy "Administratorul sterge contacte"
  on organizare.contacte for delete to authenticated
  using (asociatie_id in (select private.asociatii_administrate()));

-- =============================================================================
-- Politicile RLS pentru Identitate
-- =============================================================================

alter table identitate.profiluri enable row level security;
alter table identitate.administratori enable row level security;
alter table identitate.membri_asociatie enable row level security;
alter table identitate.locatari enable row level security;
alter table identitate.invitatii enable row level security;

create policy "Profilul propriu si oamenii din asociatiile tale"
  on identitate.profiluri for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select m.profil_id from identitate.membri_asociatie m where m.asociatie_id in (select private.asociatii_vizibile()))
    or id in (select l.profil_id from identitate.locatari l where l.bloc_id in (select private.blocuri_conduse()))
  );
create policy "Fiecare isi modifica profilul"
  on identitate.profiluri for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Fiecare isi vede verificarea"
  on identitate.administratori for select to authenticated
  using (profil_id = (select auth.uid()));

create policy "Mandatele se vad in asociatie"
  on identitate.membri_asociatie for select to authenticated
  using (profil_id = (select auth.uid()) or asociatie_id in (select private.asociatii_vizibile()));

create policy "Legaturile proprii si cele din blocurile conduse"
  on identitate.locatari for select to authenticated
  using (profil_id = (select auth.uid()) or bloc_id in (select private.blocuri_conduse()));

create policy "Administratorul vede invitatiile blocului"
  on identitate.invitatii for select to authenticated
  using (apartament_id in (select private.apartamente_administrate()));

grant select on all tables in schema identitate to authenticated;
grant update (nume, telefon) on identitate.profiluri to authenticated;
grant all on all tables in schema identitate to service_role;

-- =============================================================================
-- Comenzile Identitate
-- =============================================================================

-- Cine sunt si ce vad: rolul principal al apelantului, cum il foloseste aplicatia.
create function identitate.eu()
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
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_profil from identitate.profiluri where id = v_uid;
  select * into v_adm from identitate.administratori where profil_id = v_uid;
  select asociatie_id into v_asociatie from private.asociatii_administrate() as t(asociatie_id) limit 1;

  if v_asociatie is not null then
    v_rol := 'administrator';
    select id into v_bloc from organizare.blocuri
      where asociatie_id = v_asociatie and arhivat_la is null order by creat_la limit 1;
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
    'apartament_id', v_ap
  );
end;
$$;

-- Administratorul care se inregistreaza singur: cerere in asteptare.
create function identitate.cere_verificare_administrator(p_numar_atestat text, p_atestat_cale text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Nu esti autentificat.';
  end if;
  if coalesce(btrim(p_numar_atestat), '') = '' then
    raise exception 'Scrie numarul atestatului.';
  end if;
  insert into identitate.administratori (profil_id, numar_atestat, atestat_cale, stare)
  values (auth.uid(), btrim(p_numar_atestat), p_atestat_cale, 'in_asteptare')
  on conflict (profil_id) do update
    set numar_atestat = excluded.numar_atestat,
        atestat_cale = coalesce(excluded.atestat_cale, identitate.administratori.atestat_cale)
    where identitate.administratori.stare <> 'aprobat';
end;
$$;

-- Genereaza codul de invitatie pentru un apartament.
create function identitate.invita_locatar(p_apartament_id uuid, p_calitate text default 'proprietar')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alfabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_cod text;
  v_octeti bytea;
begin
  if p_apartament_id not in (select private.apartamente_administrate()) then
    raise exception 'Doar administratorul blocului poate invita locatari.';
  end if;
  loop
    v_octeti := extensions.gen_random_bytes(8);
    v_cod := '';
    for i in 0..7 loop
      v_cod := v_cod || substr(v_alfabet, (get_byte(v_octeti, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from identitate.invitatii where cod = v_cod);
  end loop;
  insert into identitate.invitatii (apartament_id, cod, calitate, creat_de, expira_la)
  values (p_apartament_id, v_cod, p_calitate, auth.uid(), now() + interval '30 days');
  return v_cod;
end;
$$;

-- Leaga apelantul de apartamentul din cod. Singurul drum spre identitate.locatari.
create function identitate.foloseste_invitatie(p_cod text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv identitate.invitatii;
  v_ap organizare.apartamente;
begin
  if auth.uid() is null then
    raise exception 'Nu esti autentificat.';
  end if;
  select * into v_inv from identitate.invitatii
    where cod = upper(btrim(p_cod))
    for update;
  if not found or v_inv.revocata_la is not null or v_inv.folosita_la is not null or v_inv.expira_la < now() then
    raise exception 'Codul nu este valabil. Cere administratorului un cod nou.';
  end if;
  select * into v_ap from organizare.apartamente where id = v_inv.apartament_id;
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (v_ap.id, v_ap.bloc_id, auth.uid(), v_inv.calitate, current_date)
  on conflict do nothing;
  update identitate.invitatii set folosita_la = now(), folosita_de = auth.uid() where id = v_inv.id;
  return jsonb_build_object('apartament_id', v_ap.id, 'apartament_numar', v_ap.numar);
end;
$$;

-- Inchide accesul unui locatar (vanzare, mutare). Istoricul ramane.
create function identitate.inchide_acces_locatar(p_locatar_id uuid, p_data date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update identitate.locatari
     set activ_pana = greatest(p_data, activ_din + 1)
   where id = p_locatar_id
     and bloc_id in (select private.blocuri_administrate())
     and activ_pana is null;
  if not found then
    raise exception 'Legatura nu exista sau nu este in blocul tau.';
  end if;
end;
$$;

-- Dezvoltatorul aproba sau respinge un administrator (doar service_role).
create function identitate.verifica_administrator(p_profil_id uuid, p_aprobat boolean, p_motiv text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update identitate.administratori
     set stare = case when p_aprobat then 'aprobat' else 'respins' end,
         motiv_respingere = case when p_aprobat then null else p_motiv end
   where profil_id = p_profil_id;
$$;

revoke execute on all functions in schema identitate from public, anon;
grant execute on function identitate.eu(), identitate.cere_verificare_administrator(text, text),
  identitate.invita_locatar(uuid, text), identitate.foloseste_invitatie(text),
  identitate.inchide_acces_locatar(uuid, date)
  to authenticated;
grant execute on all functions in schema identitate to service_role;
revoke execute on function identitate.la_cont_nou(), identitate.la_administrator_verificat(),
  identitate.verifica_administrator(uuid, boolean, text) from authenticated;

create trigger locatari_audit after insert or update or delete on identitate.locatari
  for each row execute function audit.inregistreaza();
create trigger administratori_audit after insert or update or delete on identitate.administratori
  for each row execute function audit.inregistreaza();
create trigger membri_asociatie_audit after insert or update or delete on identitate.membri_asociatie
  for each row execute function audit.inregistreaza();
