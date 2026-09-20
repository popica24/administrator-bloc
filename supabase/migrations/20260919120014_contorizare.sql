-- Contorizare (docs/schema-propunere.md §3.D): contoarele de apa si citirile
-- lor. Motorul de repartizare cere de aici consumul validat al lunii, prin
-- contorizare.consum_validat; nimic din alt context nu citeste tabelele direct.
--
-- Scrierea se face doar prin comenzi (transmite_citire, valideaza_citire,
-- citeste_contor_general, estimeaza_citiri). RLS pe tabele este doar de citire.

create table contorizare.setari_contorizare (
  bloc_id uuid primary key
    references organizare.blocuri (id) on delete restrict,

  zi_limita_citire smallint not null default 25
    constraint setari_contorizare_zi_limita_citire_check check (zi_limita_citire between 1 and 28),

  metoda_estimare text not null default 'medie_3_luni'
    constraint setari_contorizare_metoda_estimare_check check (metoda_estimare in ('medie_3_luni')),

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table contorizare.setari_contorizare is
  'Termenul pentru citiri si regula de estimare pentru cine nu transmite indexul.';

create trigger setari_contorizare_actualizat_la
  before update on contorizare.setari_contorizare
  for each row execute function public.seteaza_actualizat_la();

create table contorizare.contoare (
  id uuid primary key default gen_random_uuid(),

  bloc_id uuid not null
    references organizare.blocuri (id) on delete restrict,

  apartament_id uuid,

  tip text not null
    constraint contoare_tip_check check (tip in ('rece', 'calda')),

  serie text,
  amplasare text,
  montat_la date,
  scos_la date,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint contoare_apartament_fk foreign key (apartament_id, bloc_id)
    references organizare.apartamente (id, bloc_id) on delete restrict,
  -- Tinta cheii compuse din citiri: tipul citirii este tipul contorului.
  constraint contoare_id_tip_key unique (id, tip)
);

comment on table contorizare.contoare is
  'Contoarele de apa. apartament_id null inseamna contorul general al blocului, de la subsol.';

-- Un singur contor general activ pe tip de apa.
create unique index contoare_general_activ_key
  on contorizare.contoare (bloc_id, tip) where apartament_id is null and scos_la is null;
create index contoare_bloc_id_idx on contorizare.contoare (bloc_id);
create index contoare_apartament_id_idx on contorizare.contoare (apartament_id, bloc_id);

create trigger contoare_actualizat_la
  before update on contorizare.contoare
  for each row execute function public.seteaza_actualizat_la();

create table contorizare.citiri (
  id uuid primary key default gen_random_uuid(),

  contor_id uuid not null
    references contorizare.contoare (id) on delete restrict,

  tip text not null,

  bloc_id uuid not null
    references organizare.blocuri (id) on delete restrict,

  apartament_id uuid,

  luna date not null
    constraint citiri_luna_check check (private.este_luna(luna)),

  index_anterior numeric(10, 3) not null,

  index_curent numeric(10, 3) not null,

  consum numeric(10, 3) generated always as (index_curent - index_anterior) stored,

  sursa text not null
    constraint citiri_sursa_check check (sursa in ('locatar', 'administrator', 'estimat', 'pornire')),

  stare text not null default 'trimisa'
    constraint citiri_stare_check check (stare in ('trimisa', 'validata', 'respinsa')),

  poza_cale text,

  document_id uuid
    references comunicare.documente (id) on delete restrict,

  transmisa_de uuid
    references identitate.profiluri (id) on delete restrict,

  transmisa_la timestamptz not null default now(),

  verificata_de uuid
    references identitate.profiluri (id) on delete restrict,

  verificata_la timestamptz,
  motiv_respingere text,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint citiri_index_curent_check check (index_curent >= index_anterior),
  constraint citiri_contor_tip_fk foreign key (contor_id, tip)
    references contorizare.contoare (id, tip) on delete restrict,
  constraint citiri_apartament_fk foreign key (apartament_id, bloc_id)
    references organizare.apartamente (id, bloc_id) on delete restrict,
  constraint citiri_respinsa_motiv_check check (stare <> 'respinsa' or length(btrim(coalesce(motiv_respingere, ''))) > 0)
);

comment on table contorizare.citiri is
  'O citire lunara a unui contor. consum este generat, ca sa nu poata contrazice cele doua indexuri. index_anterior se pastreaza pe rand, ca citirea sa se explice singura.';
comment on column contorizare.citiri.poza_cale is
  'Calea in bucket-ul privat poze: <bloc_id>/<apartament_id>/<fisier>. Poza e micsorata in aplicatie inainte de upload.';

-- O citire respinsa se poate retrimite, dar exista cel mult o citire valabila pe contor pe luna.
create unique index citiri_valabila_key on contorizare.citiri (contor_id, luna) where stare <> 'respinsa';
create index citiri_contor_luna_idx on contorizare.citiri (contor_id, luna);
create index citiri_contor_tip_idx on contorizare.citiri (contor_id, tip);
-- Citirile care asteapta validarea administratorului (§10.5).
create index citiri_de_verificat_idx on contorizare.citiri (bloc_id, luna) where stare = 'trimisa';
create index citiri_apartament_idx on contorizare.citiri (apartament_id, bloc_id);
create index citiri_document_id_idx on contorizare.citiri (document_id);
create index citiri_transmisa_de_idx on contorizare.citiri (transmisa_de);
create index citiri_verificata_de_idx on contorizare.citiri (verificata_de);

create trigger citiri_actualizat_la
  before update on contorizare.citiri
  for each row execute function public.seteaza_actualizat_la();

create trigger citiri_audit after insert or update or delete on contorizare.citiri
  for each row execute function audit.inregistreaza();

alter table contorizare.setari_contorizare enable row level security;
alter table contorizare.contoare enable row level security;
alter table contorizare.citiri enable row level security;

create policy "Setarile de citire se vad in bloc"
  on contorizare.setari_contorizare for select to authenticated
  using (bloc_id in (select private.blocuri_vizibile()));
create policy "Administratorul schimba termenul de citire"
  on contorizare.setari_contorizare for update to authenticated
  using (bloc_id in (select private.blocuri_administrate()))
  with check (bloc_id in (select private.blocuri_administrate()));

create policy "Contoarele proprii si cele din blocurile conduse"
  on contorizare.contoare for select to authenticated
  using (bloc_id in (select private.blocuri_conduse()) or apartament_id in (select private.apartamentele_mele()));

create policy "Citirile proprii si cele din blocurile conduse"
  on contorizare.citiri for select to authenticated
  using (bloc_id in (select private.blocuri_conduse()) or apartament_id in (select private.apartamentele_mele()));

grant select on all tables in schema contorizare to authenticated;
grant update (zi_limita_citire) on contorizare.setari_contorizare to authenticated;
grant all on all tables in schema contorizare to service_role;

-- =============================================================================
-- Interfata publica si comenzile
-- =============================================================================

-- Indexul de la care porneste citirea lunii: ultima citire valabila dinainte.
create function contorizare.index_anterior(p_contor_id uuid, p_luna date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.index_curent
    from contorizare.citiri c
    where c.contor_id = p_contor_id and c.luna < p_luna and c.stare <> 'respinsa'
    order by c.luna desc, c.transmisa_la desc
    limit 1
  ), 0);
$$;

-- Locatarul transmite indexurile lunii curente, cu poza. O citire netrimisa
-- inca la validare se poate corecta: randul vechi e inlocuit.
create function contorizare.transmite_citire(
  p_apartament_id uuid,
  p_luna date,
  p_indexuri jsonb,
  p_poza_cale text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rand jsonb;
  v_contor contorizare.contoare;
  v_anterior numeric;
  v_index numeric;
begin
  if p_apartament_id not in (select private.apartamentele_mele()) then
    raise exception 'Nu ai acces la acest apartament.';
  end if;
  if p_luna <> date_trunc('month', current_date)::date then
    raise exception 'Se poate transmite doar indexul lunii curente.';
  end if;
  if jsonb_typeof(p_indexuri) <> 'array' or jsonb_array_length(p_indexuri) = 0 then
    raise exception 'Scrie cel putin un index.';
  end if;

  for v_rand in select * from jsonb_array_elements(p_indexuri) loop
    select * into v_contor from contorizare.contoare
      where id = (v_rand ->> 'contor_id')::uuid and apartament_id = p_apartament_id and scos_la is null;
    if not found then
      raise exception 'Contorul nu este al apartamentului tau.';
    end if;
    if exists (select 1 from contorizare.citiri where contor_id = v_contor.id and luna = p_luna and stare = 'validata') then
      raise exception 'Indexul pe aceasta luna a fost deja validat de administrator.';
    end if;
    v_index := (v_rand ->> 'index')::numeric;
    v_anterior := contorizare.index_anterior(v_contor.id, p_luna);
    if v_index is null or v_index < v_anterior then
      raise exception 'Indexul nou (%) nu poate fi mai mic decat cel anterior (%).', v_index, v_anterior;
    end if;
    delete from contorizare.citiri where contor_id = v_contor.id and luna = p_luna and stare = 'trimisa';
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare, poza_cale, transmisa_de)
    values (v_contor.id, v_contor.tip, v_contor.bloc_id, p_apartament_id, p_luna, v_anterior, v_index, 'locatar', 'trimisa', p_poza_cale, auth.uid());
  end loop;

  perform evenimente.inregistreaza('CitireTransmisa', 'contorizare', p_apartament_id,
    jsonb_build_object('apartament_id', p_apartament_id, 'bloc_id', v_contor.bloc_id, 'luna', p_luna));
end;
$$;

-- Administratorul accepta sau respinge o citire trimisa, dupa poza.
create function contorizare.valideaza_citire(p_citire_id uuid, p_accepta boolean, p_motiv text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_citire contorizare.citiri;
begin
  select * into v_citire from contorizare.citiri where id = p_citire_id for update;
  if not found or v_citire.bloc_id not in (select private.blocuri_administrate()) then
    raise exception 'Citirea nu exista sau nu este din blocul tau.';
  end if;
  if v_citire.stare <> 'trimisa' then
    raise exception 'Citirea a fost deja verificata.';
  end if;
  if not p_accepta and coalesce(btrim(p_motiv), '') = '' then
    raise exception 'Scrie motivul, ca locatarul sa stie ce sa corecteze.';
  end if;
  update contorizare.citiri
     set stare = case when p_accepta then 'validata' else 'respinsa' end,
         motiv_respingere = case when p_accepta then null else btrim(p_motiv) end,
         verificata_de = auth.uid(),
         verificata_la = now()
   where id = p_citire_id;
  if not p_accepta then
    perform evenimente.inregistreaza('CitireRespinsa', 'contorizare', v_citire.contor_id,
      jsonb_build_object('citire_id', v_citire.id, 'apartament_id', v_citire.apartament_id, 'bloc_id', v_citire.bloc_id,
                         'luna', v_citire.luna, 'motiv', btrim(p_motiv)));
  end if;
end;
$$;

-- Administratorul citeste contorul general de la subsol.
create function contorizare.citeste_contor_general(p_bloc_id uuid, p_luna date, p_tip text, p_index numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contor contorizare.contoare;
  v_anterior numeric;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) then
    raise exception 'Doar administratorul blocului citeste contorul general.';
  end if;
  select * into v_contor from contorizare.contoare
    where bloc_id = p_bloc_id and apartament_id is null and tip = p_tip and scos_la is null;
  if not found then
    raise exception 'Blocul nu are contor general pentru apa %.', p_tip;
  end if;
  v_anterior := contorizare.index_anterior(v_contor.id, p_luna);
  if p_index < v_anterior then
    raise exception 'Indexul nou nu poate fi mai mic decat cel anterior (%).', v_anterior;
  end if;
  delete from contorizare.citiri where contor_id = v_contor.id and luna = p_luna;
  insert into contorizare.citiri (contor_id, tip, bloc_id, luna, index_anterior, index_curent, sursa, stare, transmisa_de, verificata_de, verificata_la)
  values (v_contor.id, v_contor.tip, p_bloc_id, p_luna, v_anterior, p_index, 'administrator', 'validata', auth.uid(), auth.uid(), now());
end;
$$;

-- Cine nu a transmis primeste consum estimat pe media ultimelor trei luni.
-- Estimarea ramane vizibila ca atare pe lista locatarului.
create function contorizare.estimeaza_citiri(p_bloc_id uuid, p_luna date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contor contorizare.contoare;
  v_medie numeric;
  v_anterior numeric;
  v_n integer := 0;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul blocului estimeaza citirile.';
  end if;
  for v_contor in
    select * from contorizare.contoare c
    where c.bloc_id = p_bloc_id and c.apartament_id is not null and c.scos_la is null
      and not exists (select 1 from contorizare.citiri x where x.contor_id = c.id and x.luna = p_luna and x.stare <> 'respinsa')
  loop
    select coalesce(round(avg(consum), 3), 0) into v_medie
    from (
      select x.consum from contorizare.citiri x
      where x.contor_id = v_contor.id and x.luna < p_luna and x.stare = 'validata' and x.sursa <> 'pornire'
      order by x.luna desc limit 3
    ) ultimele;
    v_anterior := contorizare.index_anterior(v_contor.id, p_luna);
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare, verificata_de, verificata_la)
    values (v_contor.id, v_contor.tip, v_contor.bloc_id, v_contor.apartament_id, p_luna, v_anterior, v_anterior + v_medie, 'estimat', 'validata', auth.uid(), now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Consumul validat al lunii: pe apartament si la contorul general. Interfata
-- folosita de motorul de repartizare (§2.3).
create function contorizare.consum_validat(p_bloc_id uuid, p_luna date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with valide as (
    select x.apartament_id, x.tip, sum(x.consum) as mc
    from contorizare.citiri x
    where x.bloc_id = p_bloc_id and x.luna = p_luna and x.stare = 'validata' and x.sursa <> 'pornire'
    group by x.apartament_id, x.tip
  ),
  pe_apartament as (
    select v.apartament_id, jsonb_object_agg(v.tip, v.mc) as tipuri
    from valide v
    where v.apartament_id is not null
    group by v.apartament_id
  )
  select jsonb_build_object(
    'consum', coalesce((select jsonb_object_agg(pa.apartament_id::text, pa.tipuri) from pe_apartament pa), '{}'::jsonb),
    'contorGeneral', coalesce((select jsonb_object_agg(v.tip, v.mc) from valide v where v.apartament_id is null), '{}'::jsonb)
  );
$$;

-- Media blocului pe persoana, luna de luna. Locatarul se compara cu ea fara
-- sa vada randurile altor apartamente.
create function contorizare.consum_mediu_bloc(p_bloc_id uuid)
returns table (luna date, rece numeric, calda numeric, apartamente integer)
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
  with cit as (
    select c.luna, c.tip, c.apartament_id, sum(c.consum) as consum
    from contorizare.citiri c
    where c.bloc_id = p_bloc_id and c.apartament_id is not null and c.stare = 'validata' and c.sursa <> 'pornire'
    group by c.luna, c.tip, c.apartament_id
  ),
  pers as (
    select cit.luna, cit.tip, cit.apartament_id, cit.consum,
           (select p.persoane from organizare.persoane_pe_luna(p_bloc_id, cit.luna) p where p.apartament_id = cit.apartament_id) as persoane
    from cit
  )
  select p.luna,
         round(sum(p.consum) filter (where p.tip = 'rece') / nullif(sum(p.persoane) filter (where p.tip = 'rece'), 0), 2),
         round(sum(p.consum) filter (where p.tip = 'calda') / nullif(sum(p.persoane) filter (where p.tip = 'calda'), 0), 2),
         count(distinct p.apartament_id)::integer
  from pers p
  group by p.luna
  order by p.luna;
end;
$$;

revoke execute on all functions in schema contorizare from public, anon;
grant execute on function contorizare.transmite_citire(uuid, date, jsonb, text),
  contorizare.valideaza_citire(uuid, boolean, text),
  contorizare.citeste_contor_general(uuid, date, text, numeric),
  contorizare.estimeaza_citiri(uuid, date),
  contorizare.consum_mediu_bloc(uuid)
  to authenticated;
grant execute on all functions in schema contorizare to service_role;
