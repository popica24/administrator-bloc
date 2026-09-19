-- Organizare (docs/schema-propunere.md §3.A): asociatia de proprietari,
-- blocurile ei, apartamentele cu persoanele si cotele lor, contactele.
-- Este contextul din amonte: Intretinere, Contorizare, Financiar si Guvernanta
-- citesc apartamentele de aici, niciodata invers.
--
-- RLS se activeaza aici, iar politicile se scriu in migratia identitate, dupa
-- functiile ajutatoare din schema private pe care le folosesc.

-- =============================================================================
-- asociatii: persoana juridica ce administreaza blocurile (administratia blocului)
-- =============================================================================

create table organizare.asociatii (
  id uuid primary key default gen_random_uuid(),

  denumire text not null
    constraint asociatii_denumire_check check (length(btrim(denumire)) > 0),

  cui text,
  iban text,
  banca text,
  adresa text,
  telefon text,
  email text,
  arhivata_la timestamptz,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint asociatii_cui_key unique (cui)
);

comment on table organizare.asociatii is
  'Asociatia de proprietari: entitatea care incaseaza banii si are un administrator. Separata de nomenclator.administratii_locale, care este UAT-ul in care se afla blocul.';
comment on column organizare.asociatii.arhivata_la is
  'Stergere logica. Documentele contabile se pastreaza, deci o asociatie nu se sterge fizic.';

create trigger asociatii_actualizat_la
  before update on organizare.asociatii
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- blocuri: unitatea pentru care se calculeaza o lista lunara
-- =============================================================================

create table organizare.blocuri (
  id uuid primary key default gen_random_uuid(),

  asociatie_id uuid not null
    references organizare.asociatii (id) on delete restrict,

  uat_id uuid
    references nomenclator.administratii_locale (id) on delete restrict,

  denumire text not null
    constraint blocuri_denumire_check check (length(btrim(denumire)) > 0),

  adresa text not null
    constraint blocuri_adresa_check check (length(btrim(adresa)) > 0),

  etaje smallint not null
    constraint blocuri_etaje_check check (etaje >= 0),

  stare text not null default 'in_configurare'
    constraint blocuri_stare_check check (stare in ('in_configurare', 'activ')),

  activat_la timestamptz,
  arhivat_la timestamptz,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table organizare.blocuri is
  'O cladire sau o scara. Cat timp este in_configurare, nicio lista nu se poate publica (§11.4).';

create index blocuri_asociatie_id_idx on organizare.blocuri (asociatie_id);
create index blocuri_uat_id_idx on organizare.blocuri (uat_id);

create trigger blocuri_actualizat_la
  before update on organizare.blocuri
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- apartamente: fisa apartamentului
-- =============================================================================

create table organizare.apartamente (
  id uuid primary key default gen_random_uuid(),

  bloc_id uuid not null
    references organizare.blocuri (id) on delete restrict,

  numar text not null
    constraint apartamente_numar_check check (length(btrim(numar)) > 0),

  etaj smallint not null,
  scutit_lift boolean not null default false,

  proprietar_nume text not null
    constraint apartamente_proprietar_nume_check check (length(btrim(proprietar_nume)) > 0),

  cota_indiviza numeric(7, 4) not null
    constraint apartamente_cota_indiviza_check check (cota_indiviza > 0 and cota_indiviza <= 100),

  suprafata_mp numeric(7, 2)
    constraint apartamente_suprafata_mp_check check (suprafata_mp > 0),

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint apartamente_bloc_numar_key unique (bloc_id, numar),
  -- Tinta cheilor straine compuse (apartament_id, bloc_id) din celelalte
  -- contexte: baza de date refuza un rand al carui apartament e din alt bloc.
  constraint apartamente_id_bloc_key unique (id, bloc_id)
);

comment on table organizare.apartamente is
  'Fisa apartamentului. Numarul de persoane nu sta aici, ci in apartamente_persoane, cu istoric.';
comment on column organizare.apartamente.numar is
  'Text, pentru ca exista "3A" si "12bis".';
comment on column organizare.apartamente.scutit_lift is
  'Metoda persoane_fara_lift ignora persoanele din apartamentele scutite. Implicit parterul.';
comment on column organizare.apartamente.proprietar_nume is
  'Numele de pe lista de plata; apare si cand proprietarul nu are cont in aplicatie.';

create trigger apartamente_actualizat_la
  before update on organizare.apartamente
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- apartamente_persoane: cate persoane locuiesc acolo, in timp
-- Numarul pentru luna L este randul cu cel mai recent valabil_din <= L.
-- Randurile nu se modifica niciodata, doar se adauga.
-- =============================================================================

create table organizare.apartamente_persoane (
  id uuid primary key default gen_random_uuid(),

  apartament_id uuid not null
    references organizare.apartamente (id) on delete restrict,

  valabil_din date not null
    constraint apartamente_persoane_valabil_din_check check (private.este_luna(valabil_din)),

  numar_persoane smallint not null
    constraint apartamente_persoane_numar_persoane_check check (numar_persoane >= 0),

  motiv text,
  modificat_de uuid,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint apartamente_persoane_apartament_valabil_din_key unique (apartament_id, valabil_din)
);

comment on table organizare.apartamente_persoane is
  'Istoricul numarului de persoane. Recalcularea unei luni vechi foloseste numarul de atunci.';

create index apartamente_persoane_modificat_de_idx on organizare.apartamente_persoane (modificat_de);

create trigger apartamente_persoane_actualizat_la
  before update on organizare.apartamente_persoane
  for each row execute function public.seteaza_actualizat_la();

-- Persoanele fiecarui apartament dintr-un bloc, intr-o luna. Interfata publica
-- a contextului, folosita de motorul de repartizare.
create function organizare.persoane_pe_luna(p_bloc_id uuid, p_luna date)
returns table (apartament_id uuid, persoane smallint)
language sql
stable
set search_path = ''
as $$
  select a.id,
         coalesce((
           select p.numar_persoane
           from organizare.apartamente_persoane p
           where p.apartament_id = a.id and p.valabil_din <= p_luna
           order by p.valabil_din desc
           limit 1
         ), 0::smallint)
  from organizare.apartamente a
  where a.bloc_id = p_bloc_id;
$$;

-- =============================================================================
-- inrolare_apartamente: apartamentele propuse de pe hartie, inainte de confirmare
-- =============================================================================

create table organizare.inrolare_apartamente (
  id uuid primary key default gen_random_uuid(),

  bloc_id uuid not null
    references organizare.blocuri (id) on delete restrict,

  numar text not null
    constraint inrolare_apartamente_numar_check check (length(btrim(numar)) > 0),

  date jsonb not null,

  sursa text not null
    constraint inrolare_apartamente_sursa_check check (sursa in ('administrator', 'operator', 'automat')),

  document_id uuid,

  stare text not null default 'propus'
    constraint inrolare_apartamente_stare_check check (stare in ('propus', 'confirmat')),

  confirmat_de uuid,
  confirmat_la timestamptz,

  apartament_id uuid
    references organizare.apartamente (id) on delete restrict,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table organizare.inrolare_apartamente is
  'Randuri propuse de pe foaia de hartie. Nimic nu ajunge in apartamente pana cand administratorul nu confirma randul cu foaia in fata (§11.4).';
comment on column organizare.inrolare_apartamente.date is
  'Valorile propuse: etaj, proprietar, persoane, cota, suprafata, scutit_lift, restanta, index_rece, index_calda.';

-- Un singur rand propus pe numar de apartament.
create unique index inrolare_apartamente_propus_key
  on organizare.inrolare_apartamente (bloc_id, numar) where stare = 'propus';
create index inrolare_apartamente_document_id_idx on organizare.inrolare_apartamente (document_id);
create index inrolare_apartamente_apartament_id_idx on organizare.inrolare_apartamente (apartament_id);
create index inrolare_apartamente_confirmat_de_idx on organizare.inrolare_apartamente (confirmat_de);

create trigger inrolare_apartamente_actualizat_la
  before update on organizare.inrolare_apartamente
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- contacte: "Pe cine suna"
-- =============================================================================

create table organizare.contacte (
  id uuid primary key default gen_random_uuid(),

  asociatie_id uuid not null
    references organizare.asociatii (id) on delete restrict,

  bloc_id uuid
    references organizare.blocuri (id) on delete restrict,

  rol text not null
    constraint contacte_rol_check check (rol in ('administrator', 'presedinte', 'cenzor', 'lift', 'altul')),

  nume text not null
    constraint contacte_nume_check check (length(btrim(nume)) > 0),

  telefon text not null
    constraint contacte_telefon_check check (length(btrim(telefon)) > 0),

  program text,

  apartament_id uuid
    references organizare.apartamente (id) on delete restrict,

  ordine smallint not null default 0,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table organizare.contacte is
  'Ce vede locatarul la "Pe cine suni". Separat de mandate: omul cu liftul nu va avea niciodata cont.';
comment on column organizare.contacte.bloc_id is 'Null inseamna toata asociatia.';

create index contacte_asociatie_id_idx on organizare.contacte (asociatie_id);
create index contacte_bloc_id_idx on organizare.contacte (bloc_id);
create index contacte_apartament_id_idx on organizare.contacte (apartament_id);

create trigger contacte_actualizat_la
  before update on organizare.contacte
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- Audit, RLS si drepturi
-- =============================================================================

create trigger asociatii_audit after insert or update or delete on organizare.asociatii
  for each row execute function audit.inregistreaza();
create trigger apartamente_audit after insert or update or delete on organizare.apartamente
  for each row execute function audit.inregistreaza();
create trigger apartamente_persoane_audit after insert or update or delete on organizare.apartamente_persoane
  for each row execute function audit.inregistreaza();

alter table organizare.asociatii enable row level security;
alter table organizare.blocuri enable row level security;
alter table organizare.apartamente enable row level security;
alter table organizare.apartamente_persoane enable row level security;
alter table organizare.inrolare_apartamente enable row level security;
alter table organizare.contacte enable row level security;

grant select on all tables in schema organizare to authenticated;
grant insert, update on organizare.blocuri, organizare.apartamente, organizare.contacte,
  organizare.inrolare_apartamente to authenticated;
grant insert on organizare.apartamente_persoane to authenticated;
grant delete on organizare.contacte, organizare.inrolare_apartamente to authenticated;
grant all on all tables in schema organizare to service_role;
grant execute on function organizare.persoane_pe_luna(uuid, date) to authenticated, service_role;
