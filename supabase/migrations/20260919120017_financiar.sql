-- Financiar (docs/schema-propunere.md §3.E, §1.3): banii sunt un registru in
-- care doar se adauga. Tot ce se datoreaza este un rand in datorii, tot ce se
-- plateste un rand in plati, iar alocari_plati spune ce plata a acoperit ce
-- datorie. Soldul se calculeaza, nu se stocheaza niciodata.
--
-- Nimeni nu scrie direct in aceste tabele din aplicatie (§1.7): datoriile vin
-- din handlerul ListaPublicata, penalizarile din jobul lunar, platile din
-- inregistreaza_plata_numerar si din Edge Function-urile de plata cu cardul.

-- =============================================================================
-- conturi: radacina agregatului pentru bani, un rand pe apartament
-- =============================================================================

create table financiar.conturi (
  apartament_id uuid primary key,
  bloc_id uuid not null,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint conturi_apartament_bloc_key unique (apartament_id, bloc_id),
  constraint conturi_apartament_fk foreign key (apartament_id, bloc_id)
    references organizare.apartamente (id, bloc_id) on delete restrict
);

comment on table financiar.conturi is
  'Contul apartamentului. Orice modificare a banilor unui apartament incepe cu select ... for update pe acest rand, ca platile simultane sa nu acopere aceeasi datorie de doua ori.';

create index conturi_bloc_id_idx on financiar.conturi (bloc_id);

create trigger conturi_actualizat_la
  before update on financiar.conturi
  for each row execute function public.seteaza_actualizat_la();

-- Contul se deschide odata cu apartamentul (§3.E).
create function financiar.deschide_cont()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into financiar.conturi (apartament_id, bloc_id) values (new.id, new.bloc_id)
  on conflict (apartament_id) do nothing;
  return new;
end;
$$;

create trigger apartamente_deschide_cont
  after insert on organizare.apartamente
  for each row execute function financiar.deschide_cont();

-- =============================================================================
-- setari_financiare: regulile de bani ale unei asociatii
-- =============================================================================

create table financiar.setari_financiare (
  asociatie_id uuid primary key
    references organizare.asociatii (id) on delete restrict,

  procent_penalizare_zi numeric(5, 3) not null default 0.02
    constraint setari_financiare_procent_penalizare_zi_check check (procent_penalizare_zi between 0 and 0.2),

  zile_gratie smallint not null default 30
    constraint setari_financiare_zile_gratie_check check (zile_gratie >= 0),

  zi_scadenta smallint not null default 25
    constraint setari_financiare_zi_scadenta_check check (zi_scadenta between 1 and 28),

  chitanta_serie text not null
    constraint setari_financiare_chitanta_serie_check check (length(btrim(chitanta_serie)) > 0),

  chitanta_ultimul_numar integer not null default 0
    constraint setari_financiare_chitanta_ultimul_numar_check check (chitanta_ultimul_numar >= 0),

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table financiar.setari_financiare is
  'Procentul de penalizare (% pe zi, plafon legal 0,2), zilele de gratie, ziua scadentei si numerotarea chitantelor. Penalizarile trecute isi pastreaza copia parametrilor.';

create trigger setari_financiare_actualizat_la
  before update on financiar.setari_financiare
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- datorii
-- =============================================================================

create table financiar.datorii (
  id uuid primary key default gen_random_uuid(),

  apartament_id uuid not null,
  bloc_id uuid not null,

  tip text not null
    constraint datorii_tip_check check (tip in ('intretinere', 'penalizare', 'fond_rulment', 'sold_initial', 'corectie')),

  luna date
    constraint datorii_luna_check check (luna is null or private.este_luna(luna)),

  lista_id uuid
    references intretinere.liste_lunare (id) on delete restrict,

  versiune smallint,

  suma numeric(12, 2) not null,

  scadenta date not null,
  descriere text not null
    constraint datorii_descriere_check check (length(btrim(descriere)) > 0),

  document_id uuid
    references comunicare.documente (id) on delete restrict,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint datorii_suma_check check ((tip = 'corectie' and suma <> 0) or (tip <> 'corectie' and suma > 0)),
  constraint datorii_cont_fk foreign key (apartament_id, bloc_id)
    references financiar.conturi (apartament_id, bloc_id) on delete restrict,
  -- Handlerul ListaPublicata poate rula de doua ori fara sa dubleze datoriile.
  constraint datorii_lista_versiune_apartament_tip_key unique (lista_id, versiune, apartament_id, tip)
);

comment on table financiar.datorii is
  'Tot ce datoreaza un apartament. sold_initial vine de pe lista de hartie (cu documentul ei), corectie dintr-o recalculare.';

-- Soldul si zilele de intarziere ale unui apartament (§10.5).
create index datorii_apartament_scadenta_idx on financiar.datorii (apartament_id, scadenta);
create index datorii_cont_idx on financiar.datorii (apartament_id, bloc_id);
create index datorii_bloc_id_idx on financiar.datorii (bloc_id);
create index datorii_document_id_idx on financiar.datorii (document_id);

create trigger datorii_actualizat_la
  before update on financiar.datorii
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- plati, alocari_plati, chitante
-- =============================================================================

create table financiar.plati (
  id uuid primary key default gen_random_uuid(),

  apartament_id uuid not null,
  bloc_id uuid not null,

  suma numeric(12, 2) not null
    constraint plati_suma_check check (suma > 0),

  metoda text not null
    constraint plati_metoda_check check (metoda in ('card', 'numerar', 'transfer')),

  stare text not null
    constraint plati_stare_check check (stare in ('in_asteptare', 'confirmata', 'esuata', 'rambursata')),

  procesator text,
  referinta_procesator text,

  platita_de uuid
    references identitate.profiluri (id) on delete restrict,

  inregistrata_de uuid
    references identitate.profiluri (id) on delete restrict,

  confirmata_la timestamptz,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint plati_cont_fk foreign key (apartament_id, bloc_id)
    references financiar.conturi (apartament_id, bloc_id) on delete restrict,
  -- Webhook-ul procesatorului poate sosi de doua ori fara efecte duble.
  constraint plati_procesator_referinta_key unique (procesator, referinta_procesator),
  constraint plati_confirmata_check check (stare <> 'confirmata' or confirmata_la is not null)
);

comment on table financiar.plati is
  'Banii primiti. Plata cu cardul porneste in_asteptare si devine confirmata doar prin webhook-ul procesatorului. In sold intra doar platile confirmate.';

create index plati_cont_idx on financiar.plati (apartament_id, bloc_id);
create index plati_bloc_id_idx on financiar.plati (bloc_id);
create index plati_platita_de_idx on financiar.plati (platita_de);
create index plati_inregistrata_de_idx on financiar.plati (inregistrata_de);

create trigger plati_actualizat_la
  before update on financiar.plati
  for each row execute function public.seteaza_actualizat_la();

create table financiar.alocari_plati (
  id uuid primary key default gen_random_uuid(),

  plata_id uuid not null
    references financiar.plati (id) on delete restrict,

  datorie_id uuid not null
    references financiar.datorii (id) on delete restrict,

  suma numeric(12, 2) not null
    constraint alocari_plati_suma_check check (suma > 0),

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint alocari_plati_plata_datorie_key unique (plata_id, datorie_id)
);

comment on table financiar.alocari_plati is
  'Ce plata a acoperit ce datorie. Alocarea o face serverul, de la cea mai veche scadenta.';

create index alocari_plati_datorie_id_idx on financiar.alocari_plati (datorie_id);

create trigger alocari_plati_actualizat_la
  before update on financiar.alocari_plati
  for each row execute function public.seteaza_actualizat_la();

create table financiar.chitante (
  id uuid primary key default gen_random_uuid(),

  asociatie_id uuid not null
    references organizare.asociatii (id) on delete restrict,

  plata_id uuid not null
    references financiar.plati (id) on delete restrict,

  serie text not null,
  numar integer not null
    constraint chitante_numar_check check (numar > 0),

  emisa_la timestamptz not null,
  pdf_cale text,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint chitante_plata_key unique (plata_id),
  constraint chitante_asociatie_serie_numar_key unique (asociatie_id, serie, numar)
);

comment on table financiar.chitante is
  'O chitanta pe plata, cu numerotare continua pe serie: numarul se ia prin update ... returning pe setari_financiare, in aceeasi tranzactie, deci un rollback nu lasa goluri.';

create trigger chitante_actualizat_la
  before update on financiar.chitante
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- penalizari: explicatia fiecarei datorii de tip penalizare
-- =============================================================================

create table financiar.penalizari (
  id uuid primary key default gen_random_uuid(),

  datorie_sursa_id uuid not null
    references financiar.datorii (id) on delete restrict,

  datorie_id uuid not null
    references financiar.datorii (id) on delete restrict,

  luna_calcul date not null,

  rest_neachitat numeric(12, 2) not null
    constraint penalizari_rest_neachitat_check check (rest_neachitat > 0),

  zile_intarziere integer not null
    constraint penalizari_zile_intarziere_check check (zile_intarziere > 0),

  zile_gratie smallint not null,

  zile_taxate integer not null
    constraint penalizari_zile_taxate_check check (zile_taxate > 0),

  procent_zi numeric(5, 3) not null,

  suma numeric(12, 2) not null,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint penalizari_datorie_key unique (datorie_id),
  constraint penalizari_sursa_luna_key unique (datorie_sursa_id, luna_calcul),
  -- O penalizare nu depaseste niciodata datoria la care se aplica.
  constraint penalizari_suma_check check (suma > 0 and suma <= rest_neachitat)
);

comment on table financiar.penalizari is
  'Cum s-a calculat o penalizare: rest_neachitat x procent_zi% x zile_taxate. Parametrii sunt copiati in momentul calculului, ca schimbarea setarilor sa nu rescrie istoricul.';
comment on column financiar.penalizari.zile_taxate is
  'Zilele penalizate la acest calcul: de la sfarsitul perioadei de gratie, sau de la calculul anterior, pana la luna_calcul.';

create trigger penalizari_actualizat_la
  before update on financiar.penalizari
  for each row execute function public.seteaza_actualizat_la();

-- =============================================================================
-- fonduri si miscari_fond
-- =============================================================================

create table financiar.fonduri (
  id uuid primary key default gen_random_uuid(),

  bloc_id uuid not null
    references organizare.blocuri (id) on delete restrict,

  tip text not null
    constraint fonduri_tip_check check (tip in ('reparatii', 'rulment', 'special')),

  denumire text not null
    constraint fonduri_denumire_check check (length(btrim(denumire)) > 0),

  suma_per_apartament numeric(12, 2),

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table financiar.fonduri is
  'Fondul de reparatii, fondul de rulment si fondurile speciale. Soldul este suma miscarilor.';

create unique index fonduri_bloc_tip_key on financiar.fonduri (bloc_id, tip) where tip in ('reparatii', 'rulment');
create index fonduri_bloc_id_idx on financiar.fonduri (bloc_id);

create trigger fonduri_actualizat_la
  before update on financiar.fonduri
  for each row execute function public.seteaza_actualizat_la();

create table financiar.miscari_fond (
  id uuid primary key default gen_random_uuid(),

  fond_id uuid not null
    references financiar.fonduri (id) on delete restrict,

  data date not null,

  suma numeric(12, 2) not null
    constraint miscari_fond_suma_check check (suma <> 0),

  descriere text not null
    constraint miscari_fond_descriere_check check (length(btrim(descriere)) > 0),

  lista_id uuid
    references intretinere.liste_lunare (id) on delete restrict,

  document_id uuid
    references comunicare.documente (id) on delete restrict,

  creat_de uuid
    references identitate.profiluri (id) on delete restrict,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table financiar.miscari_fond is
  'Bani care intra in fond sau ies din el. O intrare trimite la lista a carei publicare a adus-o; o iesire, la factura platita.';

-- Handlerul ListaPublicata adauga o singura intrare pe lista.
create unique index miscari_fond_fond_lista_key on financiar.miscari_fond (fond_id, lista_id) where lista_id is not null;
create index miscari_fond_lista_id_idx on financiar.miscari_fond (lista_id);
create index miscari_fond_document_id_idx on financiar.miscari_fond (document_id);
create index miscari_fond_creat_de_idx on financiar.miscari_fond (creat_de);

create trigger miscari_fond_actualizat_la
  before update on financiar.miscari_fond
  for each row execute function public.seteaza_actualizat_la();

create trigger datorii_audit after insert or update or delete on financiar.datorii
  for each row execute function audit.inregistreaza();
create trigger plati_audit after insert or update or delete on financiar.plati
  for each row execute function audit.inregistreaza();
create trigger miscari_fond_audit after insert or update or delete on financiar.miscari_fond
  for each row execute function audit.inregistreaza();

-- =============================================================================
-- Interfata publica: view-uri cu security_invoker, ca RLS sa se aplice
-- =============================================================================

-- Fiecare datorie cu cat a ramas neplatit din ea.
create view financiar.datorii_rest
with (security_invoker = true)
as
select d.*,
       d.suma - coalesce((select sum(a.suma) from financiar.alocari_plati a where a.datorie_id = d.id), 0) as rest
from financiar.datorii d;

comment on view financiar.datorii_rest is 'Datoriile cu restul neachitat. Restul se calculeaza din alocari, nu se stocheaza.';

-- Soldul fiecarui apartament: datoriile minus platile confirmate.
create view financiar.solduri
with (security_invoker = true)
as
select c.apartament_id,
       c.bloc_id,
       coalesce((select sum(d.suma) from financiar.datorii d where d.apartament_id = c.apartament_id), 0)
       - coalesce((select sum(p.suma) from financiar.plati p where p.apartament_id = c.apartament_id and p.stare = 'confirmata'), 0) as sold
from financiar.conturi c;

comment on view financiar.solduri is 'Sold = suma datoriilor - suma platilor confirmate (§1.3). Mereu calculat.';

create view financiar.fonduri_solduri
with (security_invoker = true)
as
select f.*, coalesce((select sum(m.suma) from financiar.miscari_fond m where m.fond_id = f.id), 0) as sold
from financiar.fonduri f;

-- =============================================================================
-- RLS
-- =============================================================================

alter table financiar.conturi enable row level security;
alter table financiar.setari_financiare enable row level security;
alter table financiar.datorii enable row level security;
alter table financiar.plati enable row level security;
alter table financiar.alocari_plati enable row level security;
alter table financiar.chitante enable row level security;
alter table financiar.penalizari enable row level security;
alter table financiar.fonduri enable row level security;
alter table financiar.miscari_fond enable row level security;

create policy "Contul propriu si conturile blocurilor conduse"
  on financiar.conturi for select to authenticated
  using (apartament_id in (select private.apartamentele_mele()) or bloc_id in (select private.blocuri_conduse()));

create policy "Regulile de bani se vad in toata asociatia"
  on financiar.setari_financiare for select to authenticated
  using (asociatie_id in (select private.asociatii_vizibile()));
create policy "Administratorul schimba regulile de bani"
  on financiar.setari_financiare for update to authenticated
  using (asociatie_id in (select private.asociatii_administrate()))
  with check (asociatie_id in (select private.asociatii_administrate()));

create policy "Datoriile proprii si cele din blocurile conduse"
  on financiar.datorii for select to authenticated
  using (apartament_id in (select private.apartamentele_mele()) or bloc_id in (select private.blocuri_conduse()));

create policy "Platile proprii si cele din blocurile conduse"
  on financiar.plati for select to authenticated
  using (apartament_id in (select private.apartamentele_mele()) or bloc_id in (select private.blocuri_conduse()));

create policy "Alocarile se vad ca plata lor"
  on financiar.alocari_plati for select to authenticated
  using (exists (select 1 from financiar.plati p where p.id = plata_id));

create policy "Chitantele se vad ca plata lor"
  on financiar.chitante for select to authenticated
  using (exists (select 1 from financiar.plati p where p.id = plata_id));

create policy "Penalizarile se vad ca datoria lor"
  on financiar.penalizari for select to authenticated
  using (exists (select 1 from financiar.datorii d where d.id = datorie_id));

create policy "Fondurile se vad de tot blocul"
  on financiar.fonduri for select to authenticated
  using (bloc_id in (select private.blocuri_vizibile()));

create policy "Miscarile fondurilor se vad de tot blocul"
  on financiar.miscari_fond for select to authenticated
  using (exists (select 1 from financiar.fonduri f where f.id = fond_id));
create policy "Administratorul inregistreaza iesiri din fond"
  on financiar.miscari_fond for insert to authenticated
  with check (
    lista_id is null
    and creat_de = (select auth.uid())
    and exists (select 1 from financiar.fonduri f where f.id = fond_id and f.bloc_id in (select private.blocuri_administrate()))
  );

grant select on all tables in schema financiar to authenticated;
grant update (procent_penalizare_zi, zile_gratie, zi_scadenta) on financiar.setari_financiare to authenticated;
grant insert on financiar.miscari_fond to authenticated;
grant all on all tables in schema financiar to service_role;

-- =============================================================================
-- Regulile agregatului ContApartament (functii interne, fara acces din API)
-- =============================================================================

-- Aloca o plata confirmata pe datoriile deschise, de la cea mai veche scadenta.
create function financiar.aloca_plata(p_plata_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plata financiar.plati;
  v_ramas numeric(12, 2);
  v_d record;
  v_x numeric(12, 2);
begin
  select * into v_plata from financiar.plati where id = p_plata_id;
  if not found or v_plata.stare <> 'confirmata' then
    return;
  end if;
  v_ramas := v_plata.suma - coalesce((select sum(suma) from financiar.alocari_plati where plata_id = p_plata_id), 0);
  for v_d in
    select d.id,
           d.suma - coalesce((select sum(a.suma) from financiar.alocari_plati a where a.datorie_id = d.id), 0) as rest
    from financiar.datorii d
    where d.apartament_id = v_plata.apartament_id
    order by d.scadenta, d.creat_la, d.id
  loop
    exit when v_ramas <= 0;
    continue when v_d.rest <= 0;
    v_x := least(v_ramas, v_d.rest);
    insert into financiar.alocari_plati (plata_id, datorie_id, suma)
    values (p_plata_id, v_d.id, v_x)
    on conflict (plata_id, datorie_id) do update set suma = financiar.alocari_plati.suma + excluded.suma;
    v_ramas := v_ramas - v_x;
  end loop;
end;
$$;

-- Banii platiti in avans se aloca pe datoriile aparute ulterior.
create function financiar.aloca_avansuri(p_apartament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select p.id from financiar.plati p
    where p.apartament_id = p_apartament_id and p.stare = 'confirmata'
      and p.suma > coalesce((select sum(a.suma) from financiar.alocari_plati a where a.plata_id = p.id), 0)
    order by p.confirmata_la
  loop
    perform financiar.aloca_plata(v_id);
  end loop;
end;
$$;

-- Chitanta cu urmatorul numar din serie; lock-ul pe setari serializeaza chitantele.
create function financiar.emite_chitanta(p_plata_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plata financiar.plati;
  v_asociatie uuid;
  v_serie text;
  v_numar integer;
  v_id uuid;
begin
  select id into v_id from financiar.chitante where plata_id = p_plata_id;
  if found then
    return v_id;
  end if;
  select * into v_plata from financiar.plati where id = p_plata_id;
  select asociatie_id into v_asociatie from organizare.blocuri where id = v_plata.bloc_id;
  update financiar.setari_financiare
     set chitanta_ultimul_numar = chitanta_ultimul_numar + 1
   where asociatie_id = v_asociatie
  returning chitanta_serie, chitanta_ultimul_numar into v_serie, v_numar;
  if v_serie is null then
    raise exception 'Asociatia nu are setarile financiare completate.';
  end if;
  insert into financiar.chitante (asociatie_id, plata_id, serie, numar, emisa_la)
  values (v_asociatie, p_plata_id, v_serie, v_numar, coalesce(v_plata.confirmata_la, now()))
  returning id into v_id;
  return v_id;
end;
$$;

-- O plata confirmata: lock pe cont, plata, alocare, chitanta, eveniment.
create function financiar.inregistreaza_plata(
  p_apartament_id uuid,
  p_suma numeric,
  p_metoda text,
  p_la timestamptz default now(),
  p_platita_de uuid default null,
  p_inregistrata_de uuid default null,
  p_procesator text default null,
  p_referinta text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cont financiar.conturi;
  v_id uuid;
begin
  select * into v_cont from financiar.conturi where apartament_id = p_apartament_id for update;
  if not found then
    raise exception 'Apartamentul nu are cont.';
  end if;
  if p_suma is null or p_suma <= 0 then
    raise exception 'Suma trebuie sa fie mai mare decat zero.';
  end if;
  insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare, procesator, referinta_procesator, platita_de, inregistrata_de, confirmata_la, creat_la)
  values (p_apartament_id, v_cont.bloc_id, round(p_suma, 2), p_metoda, 'confirmata', p_procesator, p_referinta, p_platita_de, p_inregistrata_de, p_la, p_la)
  returning id into v_id;
  perform financiar.aloca_plata(v_id);
  perform financiar.emite_chitanta(v_id);
  perform evenimente.inregistreaza('PlataConfirmata', 'financiar', p_apartament_id,
    jsonb_build_object('plata_id', v_id, 'apartament_id', p_apartament_id, 'bloc_id', v_cont.bloc_id, 'suma', round(p_suma, 2), 'metoda', p_metoda));
  return v_id;
end;
$$;

-- =============================================================================
-- Comenzile
-- =============================================================================

-- Administratorul inregistreaza banii primiti cash si emite chitanta.
create function financiar.inregistreaza_plata_numerar(p_apartament_id uuid, p_suma numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_apartament_id not in (select private.apartamente_administrate()) then
    raise exception 'Doar administratorul blocului inregistreaza incasari.';
  end if;
  return financiar.inregistreaza_plata(p_apartament_id, p_suma, 'numerar', now(), null, auth.uid());
end;
$$;

-- Plata cu cardul, pasul 1: plata in asteptare, creata de Edge Function-ul
-- plata-card dupa ce procesatorul a deschis sesiunea. Doar service_role.
create function financiar.creeaza_plata_card(
  p_apartament_id uuid,
  p_suma numeric,
  p_platita_de uuid,
  p_procesator text,
  p_referinta text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cont financiar.conturi;
  v_id uuid;
begin
  if not exists (
    select 1 from identitate.locatari l
    where l.apartament_id = p_apartament_id and l.profil_id = p_platita_de
      and l.activ_din <= current_date and (l.activ_pana is null or l.activ_pana > current_date)
  ) then
    raise exception 'Platitorul nu este locatar al apartamentului.';
  end if;
  select * into v_cont from financiar.conturi where apartament_id = p_apartament_id;
  insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare, procesator, referinta_procesator, platita_de)
  values (p_apartament_id, v_cont.bloc_id, round(p_suma, 2), 'card', 'in_asteptare', p_procesator, p_referinta, p_platita_de)
  returning id into v_id;
  return v_id;
end;
$$;

-- Plata cu cardul, pasul 2: webhook-ul procesatorului confirma sau refuza.
-- Idempotenta: un al doilea webhook pentru aceeasi referinta nu schimba nimic.
create function financiar.confirma_plata_card(p_procesator text, p_referinta text, p_reusita boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plata financiar.plati;
begin
  select * into v_plata from financiar.plati
    where procesator = p_procesator and referinta_procesator = p_referinta;
  if not found then
    raise exception 'Plata cu referinta % nu exista.', p_referinta;
  end if;
  perform 1 from financiar.conturi where apartament_id = v_plata.apartament_id for update;
  select * into v_plata from financiar.plati where id = v_plata.id for update;
  if v_plata.stare <> 'in_asteptare' then
    return v_plata.id;
  end if;
  if not p_reusita then
    update financiar.plati set stare = 'esuata' where id = v_plata.id;
    return v_plata.id;
  end if;
  update financiar.plati set stare = 'confirmata', confirmata_la = now() where id = v_plata.id;
  perform financiar.aloca_plata(v_plata.id);
  perform financiar.emite_chitanta(v_plata.id);
  perform evenimente.inregistreaza('PlataConfirmata', 'financiar', v_plata.apartament_id,
    jsonb_build_object('plata_id', v_plata.id, 'apartament_id', v_plata.apartament_id, 'bloc_id', v_plata.bloc_id, 'suma', v_plata.suma, 'metoda', 'card'));
  return v_plata.id;
end;
$$;

-- Jobul lunar de penalizari (pg_cron, pe 1 ale lunii). Pentru fiecare datorie
-- ramasa neachitata dupa zilele de gratie: rest x procent% x zilele de la
-- ultimul calcul. Parametrii se copiaza in randul din penalizari.
create function financiar.calculeaza_penalizari(p_la date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d record;
  v_inceput date;
  v_ultim date;
  v_dela date;
  v_zile integer;
  v_rest numeric(12, 2);
  v_suma numeric(12, 2);
  v_pen uuid;
  v_n integer := 0;
begin
  for v_d in
    select d.*, s.procent_penalizare_zi, s.zile_gratie
    from financiar.datorii d
    join organizare.blocuri b on b.id = d.bloc_id
    join financiar.setari_financiare s on s.asociatie_id = b.asociatie_id
    where d.tip <> 'penalizare' and d.suma > 0 and d.scadenta < p_la
    order by d.apartament_id, d.scadenta, d.creat_la
  loop
    continue when exists (select 1 from financiar.penalizari where datorie_sursa_id = v_d.id and luna_calcul = p_la);
    v_inceput := v_d.scadenta + v_d.zile_gratie;
    select max(luna_calcul) into v_ultim from financiar.penalizari where datorie_sursa_id = v_d.id;
    v_dela := greatest(v_inceput, coalesce(v_ultim, v_inceput));
    v_zile := p_la - v_dela;
    continue when v_zile <= 0;
    v_rest := v_d.suma - coalesce((select sum(a.suma) from financiar.alocari_plati a where a.datorie_id = v_d.id), 0);
    continue when v_rest <= 0;
    v_suma := least(v_rest, round(v_rest * v_d.procent_penalizare_zi / 100 * v_zile, 2));
    continue when v_suma <= 0;

    perform 1 from financiar.conturi where apartament_id = v_d.apartament_id for update;
    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
    values (v_d.apartament_id, v_d.bloc_id, 'penalizare', date_trunc('month', p_la)::date, v_suma, p_la,
            'Penalizare pentru ' || lower(v_d.descriere))
    returning id into v_pen;
    insert into financiar.penalizari (datorie_sursa_id, datorie_id, luna_calcul, rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma)
    values (v_d.id, v_pen, p_la, v_rest, p_la - v_d.scadenta, v_d.zile_gratie, v_zile, v_d.procent_penalizare_zi, v_suma);
    perform financiar.aloca_avansuri(v_d.apartament_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Situatia incasarilor pe bloc, fara nume: ce vede locatarul la "Fonduri".
create function financiar.situatie_bloc(p_bloc_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_bloc_id not in (select private.blocuri_vizibile()) then
    raise exception 'Nu ai acces la acest bloc.';
  end if;
  return (
    with restante as (
      select a.id,
             coalesce((
               select sum(d.suma - coalesce((select sum(x.suma) from financiar.alocari_plati x where x.datorie_id = d.id), 0))
               from financiar.datorii d
               where d.apartament_id = a.id and d.scadenta < current_date
             ), 0) as rest
      from organizare.apartamente a
      where a.bloc_id = p_bloc_id
    )
    select jsonb_build_object(
      'apartamente', count(*),
      'faraRestanta', count(*) filter (where rest <= 0),
      'restanteTotal', coalesce(sum(rest) filter (where rest > 0), 0)
    )
    from restante
  );
end;
$$;

-- =============================================================================
-- Handlerele de evenimente (apelate de dispecer, niciodata din aplicatie)
-- =============================================================================

-- ListaPublicata: o datorie de intretinere pe apartament si intrarea in fondul
-- de reparatii. Idempotent prin cheile unice.
create function financiar.la_lista_publicata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista intretinere.liste_lunare;
  v_versiune smallint := (p_date ->> 'versiune')::smallint;
  v_r record;
  v_fond uuid;
  v_suma_fond numeric(12, 2);
  v_luna_text text;
begin
  select * into v_lista from intretinere.liste_lunare where id = (p_date ->> 'lista_id')::uuid;
  v_luna_text := (array['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'])[extract(month from v_lista.luna)::int]
                 || ' ' || extract(year from v_lista.luna)::int;

  for v_r in
    select r.apartament_id, r.bloc_id, sum(r.suma) as total
    from intretinere.repartizari r
    where r.lista_id = v_lista.id and r.versiune = v_versiune
    group by r.apartament_id, r.bloc_id
    having sum(r.suma) > 0
  loop
    perform 1 from financiar.conturi where apartament_id = v_r.apartament_id for update;
    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, lista_id, versiune, suma, scadenta, descriere)
    values (v_r.apartament_id, v_r.bloc_id, 'intretinere', v_lista.luna, v_lista.id, v_versiune, v_r.total, v_lista.scadenta,
            'Intretinere ' || v_luna_text)
    on conflict (lista_id, versiune, apartament_id, tip) do nothing;
    perform financiar.aloca_avansuri(v_r.apartament_id);
  end loop;

  select id into v_fond from financiar.fonduri where bloc_id = v_lista.bloc_id and tip = 'reparatii';
  select coalesce(sum(suma), 0) into v_suma_fond from intretinere.cheltuieli where lista_id = v_lista.id and tip = 'fond_reparatii';
  if v_fond is not null and v_suma_fond > 0 then
    insert into financiar.miscari_fond (fond_id, data, suma, descriere, lista_id)
    values (v_fond, v_lista.publicata_la::date, v_suma_fond, 'Contributii fond reparatii, lista pe ' || v_luna_text, v_lista.id)
    on conflict do nothing;
  end if;
end;
$$;

-- ListaRecalculata: diferenta dintre versiunea noua si cea veche devine o
-- datorie de tip corectie; datoria initiala si alocarile ei nu se ating (§7).
create function financiar.la_lista_recalculata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista intretinere.liste_lunare;
  v_r record;
begin
  select * into v_lista from intretinere.liste_lunare where id = (p_date ->> 'lista_id')::uuid;
  for v_r in
    select a.id as apartament_id, a.bloc_id,
           coalesce((select sum(r.suma) from intretinere.repartizari r where r.lista_id = v_lista.id and r.apartament_id = a.id and r.versiune = (p_date ->> 'versiune')::smallint), 0)
           - coalesce((select sum(r.suma) from intretinere.repartizari r where r.lista_id = v_lista.id and r.apartament_id = a.id and r.versiune = (p_date ->> 'versiune_veche')::smallint), 0) as diferenta
    from organizare.apartamente a
    where a.bloc_id = v_lista.bloc_id
  loop
    continue when v_r.diferenta = 0;
    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, lista_id, versiune, suma, scadenta, descriere)
    values (v_r.apartament_id, v_r.bloc_id, 'corectie', v_lista.luna, v_lista.id, (p_date ->> 'versiune')::smallint, v_r.diferenta,
            greatest(v_lista.scadenta, current_date + 15), 'Corectie dupa recalcularea listei')
    on conflict (lista_id, versiune, apartament_id, tip) do nothing;
    perform financiar.aloca_avansuri(v_r.apartament_id);
  end loop;
end;
$$;

revoke execute on all functions in schema financiar from public, anon, authenticated;
grant execute on function financiar.inregistreaza_plata_numerar(uuid, numeric), financiar.situatie_bloc(uuid) to authenticated;
grant execute on all functions in schema financiar to service_role;
