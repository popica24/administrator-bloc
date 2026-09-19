-- Intretinere, domeniul central (docs/schema-propunere.md §3.C, §1.1, §1.2):
-- lista lunara a unui bloc, cheltuielile ei si repartizarea pe apartamente.
--
-- Sumele se calculeaza o singura data, la publicare, de motorul JS
-- (supabase/functions/_shared/motor.js) rulat de Edge Function-ul
-- publica-lista. Rezultatul se scrie aici prin salveaza_lista_publicata, intr-o
-- singura tranzactie, si nu se mai recalculeaza la citire. Ce a vazut locatarul
-- in ziua platii este ce va vedea si peste un an.

create table intretinere.furnizori (
  id uuid primary key default gen_random_uuid(),

  asociatie_id uuid not null
    references organizare.asociatii (id) on delete restrict,

  denumire text not null
    constraint furnizori_denumire_check check (length(btrim(denumire)) > 0),

  cui text,
  categorie_implicita text,

  metoda_implicita text
    constraint furnizori_metoda_implicita_check check (metoda_implicita in ('consum', 'persoane', 'persoane_fara_lift', 'apartamente', 'cota')),

  tip_apa_implicit text
    constraint furnizori_tip_apa_implicit_check check (tip_apa_implicit in ('rece', 'calda')),

  cod_implicit text,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint furnizori_asociatie_denumire_key unique (asociatie_id, denumire)
);

comment on table intretinere.furnizori is
  'Furnizorii asociatiei. Valorile implicite precompleteaza formularul: "alegi furnizorul, scrii suma".';

create trigger furnizori_actualizat_la
  before update on intretinere.furnizori
  for each row execute function public.seteaza_actualizat_la();

create table intretinere.cheltuieli_recurente (
  id uuid primary key default gen_random_uuid(),

  bloc_id uuid not null
    references organizare.blocuri (id) on delete restrict,

  tip text not null
    constraint cheltuieli_recurente_tip_check check (tip in ('fond_reparatii', 'factura')),

  cod text not null
    constraint cheltuieli_recurente_cod_check check (length(btrim(cod)) > 0),

  categorie text not null
    constraint cheltuieli_recurente_categorie_check check (length(btrim(categorie)) > 0),

  suma numeric(12, 2) not null
    constraint cheltuieli_recurente_suma_check check (suma > 0),

  metoda text not null
    constraint cheltuieli_recurente_metoda_check check (metoda in ('persoane', 'persoane_fara_lift', 'apartamente', 'cota')),

  hotarare text,

  document_id uuid
    references comunicare.documente (id) on delete restrict,

  activa boolean not null default true,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table intretinere.cheltuieli_recurente is
  'Randurile care revin lunar (contributia la fondul de reparatii votata de AG). Precompleteaza fiecare lista noua; schimbarea sumei nu atinge listele publicate.';

create index cheltuieli_recurente_bloc_id_idx on intretinere.cheltuieli_recurente (bloc_id);
create index cheltuieli_recurente_document_id_idx on intretinere.cheltuieli_recurente (document_id);

create trigger cheltuieli_recurente_actualizat_la
  before update on intretinere.cheltuieli_recurente
  for each row execute function public.seteaza_actualizat_la();

create table intretinere.liste_lunare (
  id uuid primary key default gen_random_uuid(),

  bloc_id uuid not null
    references organizare.blocuri (id) on delete restrict,

  luna date not null
    constraint liste_lunare_luna_check check (private.este_luna(luna)),

  stare text not null default 'ciorna'
    constraint liste_lunare_stare_check check (stare in ('ciorna', 'publicata')),

  versiune smallint not null default 1
    constraint liste_lunare_versiune_check check (versiune >= 1),

  scadenta date,
  publicata_la timestamptz,

  publicata_de uuid
    references identitate.profiluri (id) on delete restrict,

  total_repartizat numeric(12, 2),
  apartamente_repartizate smallint,

  document_id uuid
    references comunicare.documente (id) on delete restrict,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint liste_lunare_bloc_luna_key unique (bloc_id, luna),
  constraint liste_lunare_publicata_check check (stare = 'ciorna' or (publicata_la is not null and scadenta is not null and total_repartizat is not null))
);

comment on table intretinere.liste_lunare is
  'Lista de intretinere a lunii. In ciorna administratorul adauga facturi; publicata o vad locatarii si exista datoriile. O corectura dupa publicare creeaza o versiune noua (§7).';
comment on column intretinere.liste_lunare.total_repartizat is
  'Suma repartizarilor versiunii curente, scrisa la publicare. Locatarul o compara cu totalul facturilor fara sa vada randurile altora.';

create index liste_lunare_publicata_de_idx on intretinere.liste_lunare (publicata_de);
create index liste_lunare_document_id_idx on intretinere.liste_lunare (document_id);

create trigger liste_lunare_actualizat_la
  before update on intretinere.liste_lunare
  for each row execute function public.seteaza_actualizat_la();

create table intretinere.cheltuieli (
  id uuid primary key default gen_random_uuid(),

  lista_id uuid not null
    references intretinere.liste_lunare (id) on delete restrict,

  tip text not null
    constraint cheltuieli_tip_check check (tip in ('factura', 'fond_reparatii')),

  cod text not null
    constraint cheltuieli_cod_check check (length(btrim(cod)) > 0),

  categorie text not null
    constraint cheltuieli_categorie_check check (length(btrim(categorie)) > 0),

  furnizor_id uuid
    references intretinere.furnizori (id) on delete restrict,

  serie_numar text,

  suma numeric(12, 2) not null
    constraint cheltuieli_suma_check check (suma > 0),

  metoda text not null
    constraint cheltuieli_metoda_check check (metoda in ('consum', 'persoane', 'persoane_fara_lift', 'apartamente', 'cota')),

  tip_apa text
    constraint cheltuieli_tip_apa_check check (tip_apa in ('rece', 'calda')),

  data_emitere date,
  scadenta_furnizor date,
  achitata_furnizor_la date,

  document_id uuid
    references comunicare.documente (id) on delete restrict,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint cheltuieli_lista_cod_key unique (lista_id, cod),
  -- Apa se imparte dupa contoare: tipul de apa este explicit, nu ghicit din nume.
  constraint cheltuieli_tip_apa_consum_check check ((metoda = 'consum') = (tip_apa is not null)),
  constraint cheltuieli_furnizor_factura_check check (tip <> 'factura' or furnizor_id is not null),
  constraint cheltuieli_fond_fara_furnizor_check check (tip = 'factura' or furnizor_id is null)
);

comment on table intretinere.cheltuieli is
  'Un rand de impartit: o factura de la furnizor sau contributia la fondul de reparatii. Se modifica doar cat timp lista este ciorna.';
comment on column intretinere.cheltuieli.cod is 'C1, C2, ... codul randului pe care il vede locatarul.';

create index cheltuieli_furnizor_id_idx on intretinere.cheltuieli (furnizor_id);
create index cheltuieli_document_id_idx on intretinere.cheltuieli (document_id);

create trigger cheltuieli_actualizat_la
  before update on intretinere.cheltuieli
  for each row execute function public.seteaza_actualizat_la();

create table intretinere.repartizari (
  id uuid primary key default gen_random_uuid(),

  cheltuiala_id uuid not null
    references intretinere.cheltuieli (id) on delete restrict,

  lista_id uuid not null
    references intretinere.liste_lunare (id) on delete restrict,

  versiune smallint not null,

  apartament_id uuid not null,
  bloc_id uuid not null,

  suma numeric(12, 2) not null
    constraint repartizari_suma_check check (suma >= 0),

  baza_valoare numeric(12, 4) not null,
  baza_total numeric(12, 4) not null,

  unitate text not null
    constraint repartizari_unitate_check check (unitate in ('persoane', 'apartamente', '%', 'mc')),

  rotunjire numeric(12, 2) not null default 0,
  detaliu jsonb,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint repartizari_cheltuiala_apartament_versiune_key unique (cheltuiala_id, apartament_id, versiune),
  constraint repartizari_apartament_fk foreign key (apartament_id, bloc_id)
    references organizare.apartamente (id, bloc_id) on delete restrict
);

comment on table intretinere.repartizari is
  'RandLista stocat: partea fiecarui apartament din fiecare cheltuiala, cu baza din care s-a calculat. Scris doar de motor, la publicare. Se pastreaza si randurile cu suma zero.';
comment on column intretinere.repartizari.detaliu is
  'Doar pentru apa: consumul propriu, contorul general, suma contoarelor, diferenta, partea din diferenta, pretul pe mc.';
comment on column intretinere.repartizari.rotunjire is
  'Cat a adaugat corectia de rotunjire, ca totalul sa fie egal la ban cu factura.';

-- Lista unui apartament pe o luna (RandLista, §10.5).
create index repartizari_apartament_lista_idx on intretinere.repartizari (apartament_id, lista_id);
create index repartizari_lista_versiune_idx on intretinere.repartizari (lista_id, versiune);
create index repartizari_apartament_bloc_idx on intretinere.repartizari (apartament_id, bloc_id);

create trigger repartizari_actualizat_la
  before update on intretinere.repartizari
  for each row execute function public.seteaza_actualizat_la();

create trigger liste_lunare_audit after insert or update or delete on intretinere.liste_lunare
  for each row execute function audit.inregistreaza();
create trigger cheltuieli_audit after insert or update or delete on intretinere.cheltuieli
  for each row execute function audit.inregistreaza();

-- =============================================================================
-- RLS
-- =============================================================================

alter table intretinere.furnizori enable row level security;
alter table intretinere.cheltuieli_recurente enable row level security;
alter table intretinere.liste_lunare enable row level security;
alter table intretinere.cheltuieli enable row level security;
alter table intretinere.repartizari enable row level security;

-- Numele furnizorului apare si pe lista de la avizier: il vede toata asociatia.
create policy "Furnizorii se vad in asociatie"
  on intretinere.furnizori for select to authenticated
  using (asociatie_id in (select private.asociatii_vizibile()));
create policy "Administratorul adauga furnizori"
  on intretinere.furnizori for insert to authenticated
  with check (asociatie_id in (select private.asociatii_administrate()));
create policy "Administratorul modifica furnizori"
  on intretinere.furnizori for update to authenticated
  using (asociatie_id in (select private.asociatii_administrate()))
  with check (asociatie_id in (select private.asociatii_administrate()));

create policy "Cheltuielile recurente se vad de conducere"
  on intretinere.cheltuieli_recurente for select to authenticated
  using (bloc_id in (select private.blocuri_conduse()));
create policy "Administratorul adauga cheltuieli recurente"
  on intretinere.cheltuieli_recurente for insert to authenticated
  with check (bloc_id in (select private.blocuri_administrate()));
create policy "Administratorul modifica cheltuieli recurente"
  on intretinere.cheltuieli_recurente for update to authenticated
  using (bloc_id in (select private.blocuri_administrate()))
  with check (bloc_id in (select private.blocuri_administrate()));

create policy "Listele: conducerea le vede pe toate, locatarii doar publicate"
  on intretinere.liste_lunare for select to authenticated
  using (bloc_id in (select private.blocuri_conduse()) or (stare = 'publicata' and bloc_id in (select private.blocurile_mele())));
create policy "Administratorul schimba scadenta cat timp lista e ciorna"
  on intretinere.liste_lunare for update to authenticated
  using (stare = 'ciorna' and bloc_id in (select private.blocuri_administrate()))
  with check (stare = 'ciorna' and bloc_id in (select private.blocuri_administrate()));

-- RLS pe liste_lunare se aplica si in subinterogare: locatarul vede doar
-- cheltuielile listelor publicate din blocul lui.
create policy "Cheltuielile se vad ca lista lor"
  on intretinere.cheltuieli for select to authenticated
  using (exists (select 1 from intretinere.liste_lunare l where l.id = lista_id));
create policy "Administratorul adauga cheltuieli in lista ciorna"
  on intretinere.cheltuieli for insert to authenticated
  with check (exists (
    select 1 from intretinere.liste_lunare l
    where l.id = lista_id and l.stare = 'ciorna' and l.bloc_id in (select private.blocuri_administrate())
  ));
create policy "Administratorul modifica cheltuieli in lista ciorna"
  on intretinere.cheltuieli for update to authenticated
  using (exists (
    select 1 from intretinere.liste_lunare l
    where l.id = lista_id and l.stare = 'ciorna' and l.bloc_id in (select private.blocuri_administrate())
  ))
  with check (exists (
    select 1 from intretinere.liste_lunare l
    where l.id = lista_id and l.stare = 'ciorna' and l.bloc_id in (select private.blocuri_administrate())
  ));
create policy "Administratorul sterge cheltuieli din lista ciorna"
  on intretinere.cheltuieli for delete to authenticated
  using (exists (
    select 1 from intretinere.liste_lunare l
    where l.id = lista_id and l.stare = 'ciorna' and l.bloc_id in (select private.blocuri_administrate())
  ));

create policy "Repartizarile: apartamentul propriu si blocurile conduse"
  on intretinere.repartizari for select to authenticated
  using (apartament_id in (select private.apartamentele_mele()) or bloc_id in (select private.blocuri_conduse()));

grant select on all tables in schema intretinere to authenticated;
grant insert, update on intretinere.furnizori, intretinere.cheltuieli_recurente to authenticated;
grant insert, update, delete on intretinere.cheltuieli to authenticated;
grant update (scadenta) on intretinere.liste_lunare to authenticated;
grant all on all tables in schema intretinere to service_role;

-- =============================================================================
-- Comenzile
-- =============================================================================

-- Incepe lista unei luni, precompletata din cheltuielile recurente.
create function intretinere.deschide_lista(p_bloc_id uuid, p_luna date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul blocului poate incepe o lista.';
  end if;
  select id into v_id from intretinere.liste_lunare where bloc_id = p_bloc_id and luna = p_luna;
  if found then
    return v_id;
  end if;
  insert into intretinere.liste_lunare (bloc_id, luna) values (p_bloc_id, p_luna) returning id into v_id;
  insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, serie_numar, suma, metoda, document_id)
  select v_id, r.tip, r.cod, r.categorie, r.hotarare, r.suma, r.metoda, r.document_id
  from intretinere.cheltuieli_recurente r
  where r.bloc_id = p_bloc_id and r.activa and r.tip = 'fond_reparatii';
  return v_id;
end;
$$;

-- Datele de intrare ale motorului, exact in forma pe care o asteapta
-- calculeazaLista(): apartamentele cu persoanele din luna listei, cheltuielile
-- si consumul validat din Contorizare.
create function intretinere.date_pentru_motor(p_lista_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lista intretinere.liste_lunare;
  v_consum jsonb;
begin
  select * into v_lista from intretinere.liste_lunare where id = p_lista_id;
  if not found then
    raise exception 'Lista nu exista.';
  end if;
  if v_lista.bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul blocului poate calcula lista.';
  end if;
  v_consum := contorizare.consum_validat(v_lista.bloc_id, v_lista.luna);
  return jsonb_build_object(
    'lista', jsonb_build_object('id', v_lista.id, 'bloc_id', v_lista.bloc_id, 'luna', v_lista.luna, 'stare', v_lista.stare, 'versiune', v_lista.versiune),
    'apartamente', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'persoane', p.persoane, 'cota', a.cota_indiviza, 'scutitLift', a.scutit_lift) order by a.numar)
      from organizare.apartamente a
      join organizare.persoane_pe_luna(v_lista.bloc_id, v_lista.luna) p on p.apartament_id = a.id
      where a.bloc_id = v_lista.bloc_id
    ), '[]'::jsonb),
    'cheltuieli', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'cod', c.cod, 'suma', c.suma, 'metoda', c.metoda, 'tipApa', c.tip_apa) order by c.cod)
      from intretinere.cheltuieli c where c.lista_id = p_lista_id
    ), '[]'::jsonb),
    'consum', v_consum -> 'consum',
    'contorGeneral', v_consum -> 'contorGeneral'
  );
end;
$$;

-- Rezultatul motorului (JSON) ca randuri tipizate: ce urmeaza sa devina repartizari.
create function intretinere.randuri_rezultat(p_rezultat jsonb)
returns table (
  cheltuiala_id uuid, apartament_id uuid, suma numeric(12, 2), baza_valoare numeric(12, 4),
  baza_total numeric(12, 4), unitate text, rotunjire numeric(12, 2), detaliu jsonb
)
language sql
immutable
set search_path = ''
as $$
  select (r ->> 'cheltuialaId')::uuid,
         (r ->> 'apartamentId')::uuid,
         (r ->> 'suma')::numeric(12, 2),
         (r -> 'baza' ->> 'valoare')::numeric(12, 4),
         (r -> 'baza' ->> 'total')::numeric(12, 4),
         r -> 'baza' ->> 'unitate',
         coalesce((r ->> 'rotunjire')::numeric(12, 2), 0),
         case when jsonb_typeof(r -> 'detaliu') = 'object' then r -> 'detaliu' end
  from jsonb_array_elements(p_rezultat -> 'repartizari') r;
$$;

-- Scrie rezultatul motorului, intr-o singura tranzactie: repartizarile, lista
-- publicata si evenimentul ListaPublicata. Verifica inainte ca lista sa fie
-- inca ciorna si ca fiecare cheltuiala sa fie impartita exact, la ban.
-- Cu p_recalculare = true, pe o lista deja publicata, scrie o versiune noua
-- si inregistreaza ListaRecalculata (§7). Doar pentru service_role.
create function intretinere.salveaza_lista_publicata(
  p_lista_id uuid,
  p_rezultat jsonb,
  p_publicata_de uuid default null,
  p_recalculare boolean default false,
  p_publicata_la timestamptz default now()
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista intretinere.liste_lunare;
  v_bloc organizare.blocuri;
  v_versiune smallint;
  v_nr_apartamente integer;
  v_gresita record;
  v_total numeric(12, 2);
  v_scadenta date;
  v_zi smallint;
begin
  select * into v_lista from intretinere.liste_lunare where id = p_lista_id for update;
  if not found then
    raise exception 'Lista nu exista.';
  end if;
  select * into v_bloc from organizare.blocuri where id = v_lista.bloc_id;
  if v_bloc.stare <> 'activ' then
    raise exception 'Blocul este inca in configurare. Lista se poate publica dupa activarea blocului.';
  end if;
  if p_recalculare then
    if v_lista.stare <> 'publicata' then
      raise exception 'Doar o lista publicata se recalculeaza.';
    end if;
    v_versiune := v_lista.versiune + 1;
  else
    if v_lista.stare <> 'ciorna' then
      raise exception 'Lista este deja publicata.';
    end if;
    v_versiune := v_lista.versiune;
  end if;
  if not exists (select 1 from intretinere.cheltuieli where lista_id = p_lista_id) then
    raise exception 'Lista nu are nicio cheltuiala.';
  end if;

  -- Randurile rezultatului, citite prin intretinere.randuri_rezultat(p_rezultat).

  -- Fiecare cheltuiala a listei, impartita exact, pe toate apartamentele blocului.
  select count(*) into v_nr_apartamente from organizare.apartamente where bloc_id = v_lista.bloc_id;
  for v_gresita in
    select c.cod, c.suma, coalesce(sum(t.suma), 0) as repartizat, count(t.apartament_id) as randuri
    from intretinere.cheltuieli c
    left join intretinere.randuri_rezultat(p_rezultat) t on t.cheltuiala_id = c.id
    where c.lista_id = p_lista_id
    group by c.id, c.cod, c.suma
    having coalesce(sum(t.suma), 0) <> c.suma or count(t.apartament_id) <> v_nr_apartamente
  loop
    raise exception 'Cheltuiala % nu este impartita corect: % lei din %, pe % apartamente din %.',
      v_gresita.cod, v_gresita.repartizat, v_gresita.suma, v_gresita.randuri, v_nr_apartamente;
  end loop;
  if exists (
    select 1 from intretinere.randuri_rezultat(p_rezultat) t
    where not exists (select 1 from intretinere.cheltuieli c where c.id = t.cheltuiala_id and c.lista_id = p_lista_id)
       or not exists (select 1 from organizare.apartamente a where a.id = t.apartament_id and a.bloc_id = v_lista.bloc_id)
  ) then
    raise exception 'Rezultatul contine randuri care nu apartin acestei liste.';
  end if;

  insert into intretinere.repartizari (cheltuiala_id, lista_id, versiune, apartament_id, bloc_id, suma, baza_valoare, baza_total, unitate, rotunjire, detaliu)
  select t.cheltuiala_id, p_lista_id, v_versiune, t.apartament_id, v_lista.bloc_id, t.suma, t.baza_valoare, t.baza_total, t.unitate, t.rotunjire, t.detaliu
  from intretinere.randuri_rezultat(p_rezultat) t;

  select coalesce(sum(t.suma), 0) into v_total from intretinere.randuri_rezultat(p_rezultat) t;

  if p_recalculare then
    update intretinere.liste_lunare
       set versiune = v_versiune, total_repartizat = v_total
     where id = p_lista_id;
    return evenimente.inregistreaza('ListaRecalculata', 'intretinere', p_lista_id,
      jsonb_build_object('lista_id', p_lista_id, 'bloc_id', v_lista.bloc_id, 'luna', v_lista.luna,
                         'versiune_veche', v_lista.versiune, 'versiune', v_versiune));
  end if;

  select zi_scadenta into v_zi from financiar.setari_financiare where asociatie_id = v_bloc.asociatie_id;
  v_scadenta := coalesce(v_lista.scadenta, (v_lista.luna + interval '1 month')::date + (coalesce(v_zi, 25) - 1));

  update intretinere.liste_lunare
     set stare = 'publicata',
         publicata_la = p_publicata_la,
         publicata_de = p_publicata_de,
         scadenta = v_scadenta,
         total_repartizat = v_total,
         apartamente_repartizate = v_nr_apartamente
   where id = p_lista_id;

  return evenimente.inregistreaza('ListaPublicata', 'intretinere', p_lista_id,
    jsonb_build_object('lista_id', p_lista_id, 'bloc_id', v_lista.bloc_id, 'asociatie_id', v_bloc.asociatie_id,
                       'luna', v_lista.luna, 'versiune', v_versiune, 'scadenta', v_scadenta));
end;
$$;

-- Factura platita furnizorului: singura modificare permisa dupa publicare.
create function intretinere.marcheaza_factura_platita(p_cheltuiala_id uuid, p_platita boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update intretinere.cheltuieli c
     set achitata_furnizor_la = case when p_platita then current_date end
   where c.id = p_cheltuiala_id
     and c.tip = 'factura'
     and exists (select 1 from intretinere.liste_lunare l where l.id = c.lista_id and l.bloc_id in (select private.blocuri_administrate()));
  if not found then
    raise exception 'Factura nu exista sau nu este din blocul tau.';
  end if;
end;
$$;

revoke execute on all functions in schema intretinere from public, anon;
grant execute on function intretinere.deschide_lista(uuid, date), intretinere.date_pentru_motor(uuid),
  intretinere.marcheaza_factura_platita(uuid, boolean)
  to authenticated;
grant execute on all functions in schema intretinere to service_role;
