-- Fundatia modelului DDD (docs/schema-propunere.md §2, §9 pasul 0).
-- Fiecare bounded context primeste propria schema Postgres, ca granitele dintre
-- contexte sa existe in baza de date, nu doar pe hartie. Schemele expuse prin
-- Data API sunt trecute in supabase/config.toml, [api] schemas.
--
--   expuse:    nomenclator, organizare, identitate, intretinere, contorizare,
--              financiar, sesizari, guvernanta, comunicare
--   neexpuse:  private (functiile ajutatoare pentru RLS, nucleul comun),
--              evenimente (coada evenimentelor de domeniu), audit (jurnalul)

create schema nomenclator;
create schema organizare;
create schema identitate;
create schema intretinere;
create schema contorizare;
create schema financiar;
create schema sesizari;
create schema guvernanta;
create schema comunicare;
create schema private;
create schema evenimente;
create schema audit;

comment on schema nomenclator is 'Date de referinta: localitatile din Romania.';
comment on schema organizare is 'Asociatii, blocuri, apartamente, persoane, cote, contacte.';
comment on schema identitate is 'Profiluri, administratori verificati, mandate, locatari, invitatii.';
comment on schema intretinere is 'Domeniul central: lista lunara, cheltuieli si repartizarea lor.';
comment on schema contorizare is 'Contoarele de apa si citirile lor.';
comment on schema financiar is 'Registrul banilor: datorii, plati, alocari, chitante, penalizari, fonduri.';
comment on schema sesizari is 'Defectiunile raportate de locatari si raspunsurile administratiei.';
comment on schema guvernanta is 'Voturi si adunari generale.';
comment on schema comunicare is 'Avizier, documente, remindere si notificari.';
comment on schema private is 'Functiile ajutatoare pentru RLS. Nu se expune prin API.';
comment on schema evenimente is 'Coada evenimentelor de domeniu dintre contexte. Nu se expune prin API.';
comment on schema audit is 'Istoricul modificarilor. Nu se expune prin API.';

-- Fara usage pe schema, RLS nici nu ajunge sa ruleze. anon vede doar
-- nomenclatorul; authenticated are nevoie si de private, pentru ca politicile
-- RLS apeleaza functiile de acolo cu drepturile utilizatorului.
grant usage on schema nomenclator to anon, authenticated, service_role;
grant usage on schema organizare, identitate, intretinere, contorizare, financiar,
  sesizari, guvernanta, comunicare, private
  to authenticated, service_role;
grant usage on schema evenimente, audit to service_role;

-- Nomenclatorul: tabela existenta a unitatilor administrativ-teritoriale se
-- muta in schema contextului ei. Datele, constrangerile si politicile raman.
alter table public.administratii_locale set schema nomenclator;
grant select on nomenclator.administratii_locale to anon, authenticated;
grant all on nomenclator.administratii_locale to service_role;

-- =============================================================================
-- Evenimentele de domeniu
-- Cand o comanda trebuie sa produca efecte in alt context, agregatul scrie un
-- rand aici, in aceeasi tranzactie. Randul nu se poate pierde; il consuma
-- dispecerul (evenimente.proceseaza), apelat de Edge Function-ul
-- proceseaza-eveniment si, ca plasa de siguranta, de un job pg_cron.
-- =============================================================================

create table evenimente.coada (
  id bigint generated always as identity primary key,

  tip text not null
    constraint coada_tip_check check (length(btrim(tip)) > 0),

  context text not null
    constraint coada_context_check check (length(btrim(context)) > 0),

  agregat_id uuid not null,
  date jsonb not null default '{}'::jsonb,
  creat_la timestamptz not null default now(),
  procesat_la timestamptz,
  incercari integer not null default 0,
  ultima_eroare text
);

comment on table evenimente.coada is
  'Evenimentele de domeniu, scrise in aceeasi tranzactie cu modificarea care le produce. procesat_la ramane null pana cand toate handlerele au reusit.';

-- Interogarea dispecerului: evenimentele inca neprocesate, in ordine.
create index coada_neprocesate_idx on evenimente.coada (id) where procesat_la is null;

alter table evenimente.coada enable row level security;
-- Fara politici, intentionat: coada o citeste doar service_role, care ocoleste RLS.

grant all on evenimente.coada to service_role;

-- Inregistreaza un eveniment. O apeleaza doar functiile security definer ale
-- contextelor, niciodata aplicatia direct.
create function evenimente.inregistreaza(
  p_tip text,
  p_context text,
  p_agregat_id uuid,
  p_date jsonb default '{}'::jsonb
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into evenimente.coada (tip, context, agregat_id, date)
  values (p_tip, p_context, p_agregat_id, coalesce(p_date, '{}'::jsonb))
  returning id;
$$;

revoke execute on function evenimente.inregistreaza(text, text, uuid, jsonb) from public, anon, authenticated;

-- =============================================================================
-- Auditul: cine a schimbat ce si cand
-- O singura functie de trigger, atasata tabelelor in care o modificare are
-- consecinte. auth.uid() este null cand scrie service_role.
-- =============================================================================

create table audit.jurnal (
  id bigint generated always as identity primary key,

  tabela text not null,
  rand_id uuid,

  operatie text not null
    constraint jurnal_operatie_check check (operatie in ('INSERT', 'UPDATE', 'DELETE')),

  vechi jsonb,
  nou jsonb,
  autor_id uuid,
  la timestamptz not null default now()
);

comment on table audit.jurnal is
  'Istoricul modificarilor pe tabelele cu consecinte. Se scrie doar prin trigger, doar prin adaugare.';

-- Interogarea de baza: istoricul unui rand anume.
create index jurnal_tabela_rand_idx on audit.jurnal (tabela, rand_id);

alter table audit.jurnal enable row level security;
-- Fara politici, intentionat: jurnalul il citeste doar dezvoltatorul, prin service_role.

grant all on audit.jurnal to service_role;

create function audit.inregistreaza()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vechi jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_nou jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  insert into audit.jurnal (tabela, rand_id, operatie, vechi, nou, autor_id)
  values (
    tg_table_schema || '.' || tg_table_name,
    nullif(coalesce(v_nou, v_vechi) ->> 'id', '')::uuid,
    tg_op,
    v_vechi,
    v_nou,
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;

revoke execute on function audit.inregistreaza() from public, anon, authenticated;

-- Prima zi a lunii: tipul valoric "Luna" din model. Toate coloanele luna au
-- check-ul private.este_luna(luna).
create function private.este_luna(p date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and extract(day from p) = 1;
$$;

grant execute on function private.este_luna(date) to authenticated, service_role;
