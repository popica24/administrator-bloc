-- Administratii locale: unitatile administrativ-teritoriale (UAT) si sectoarele.
-- Primarii / consilii locale, tinute intr-o singura tabela ierarhica:
-- judetul este parintele municipiilor, oraselor si comunelor; municipiul
-- Bucuresti este parintele sectoarelor.

create table public.administratii_locale (
  id uuid primary key default gen_random_uuid(),

  denumire text not null
    constraint administratii_locale_denumire_check
    check (length(btrim(denumire)) > 0),

  tip text not null
    constraint administratii_locale_tip_check
    check (tip in ('judet', 'municipiu', 'oras', 'comuna', 'sector')),

  judet text not null
    constraint administratii_locale_judet_check
    check (length(btrim(judet)) > 0),

  judet_cod text
    constraint administratii_locale_judet_cod_check
    check (judet_cod ~ '^[A-Z]{1,2}$'),

  siruta text
    constraint administratii_locale_siruta_check
    check (siruta ~ '^[0-9]{1,6}$'),

  cui text,

  parinte_id uuid
    references public.administratii_locale (id) on delete restrict,

  adresa text,
  telefon text,
  email text,
  website text,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint administratii_locale_siruta_key unique (siruta),
  constraint administratii_locale_parinte_diferit
    check (parinte_id is distinct from id)
);

comment on table public.administratii_locale is
  'Unitati administrativ-teritoriale: judete, municipii, orase, comune si sectoare. Date publice, doar citire prin API.';
comment on column public.administratii_locale.siruta is
  'Codul SIRUTA al unitatii, identificatorul oficial national.';
comment on column public.administratii_locale.parinte_id is
  'Unitatea ierarhic superioara: judetul pentru localitati, municipiul Bucuresti pentru sectoare.';
comment on column public.administratii_locale.cui is
  'Codul de identificare fiscala al primariei.';

-- Interogarea de baza este listarea unitatilor dintr-un judet, respectiv a
-- copiilor unei unitati. Nu adaugam alte indexuri pana nu apar interogari.
create index administratii_locale_judet_idx
  on public.administratii_locale (judet);

create index administratii_locale_parinte_id_idx
  on public.administratii_locale (parinte_id);

-- Actualizeaza automat marca de timp la fiecare update.
-- search_path gol: functia nu depinde de search_path-ul apelantului.
create or replace function public.seteaza_actualizat_la()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizat_la = now();
  return new;
end;
$$;

create trigger administratii_locale_actualizat_la
  before update on public.administratii_locale
  for each row
  execute function public.seteaza_actualizat_la();

-- RLS: date de interes public, deci citire libera. Scrierea ramane doar
-- pentru service_role, care oricum ocoleste RLS - nu exista politici de
-- insert, update sau delete.
alter table public.administratii_locale enable row level security;

create policy "Administratiile locale pot fi citite de oricine"
  on public.administratii_locale
  for select
  to anon, authenticated
  using (true);
