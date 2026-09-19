-- Guvernanta (docs/schema-propunere.md §3.G): ce au hotarat proprietarii si
-- cine a participat. Votul apartine apartamentului, nu fiecarui membru al
-- familiei. Rezultatele se numara, nu se stocheaza niciodata.

create table guvernanta.adunari_generale (
  id uuid primary key default gen_random_uuid(),

  asociatie_id uuid not null
    references organizare.asociatii (id) on delete restrict,

  data_ora timestamptz not null,

  loc text not null
    constraint adunari_generale_loc_check check (length(btrim(loc)) > 0),

  ordine_de_zi text not null
    constraint adunari_generale_ordine_de_zi_check check (length(btrim(ordine_de_zi)) > 0),

  document_id uuid
    references comunicare.documente (id) on delete restrict,

  convocata_de uuid
    references identitate.profiluri (id) on delete restrict,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on column guvernanta.adunari_generale.document_id is 'Procesul-verbal, null pana e redactat.';

create index adunari_generale_asociatie_id_idx on guvernanta.adunari_generale (asociatie_id);
create index adunari_generale_document_id_idx on guvernanta.adunari_generale (document_id);
create index adunari_generale_convocata_de_idx on guvernanta.adunari_generale (convocata_de);

create trigger adunari_generale_actualizat_la
  before update on guvernanta.adunari_generale
  for each row execute function public.seteaza_actualizat_la();

create table guvernanta.adunari_prezente (
  id uuid primary key default gen_random_uuid(),

  adunare_id uuid not null
    references guvernanta.adunari_generale (id) on delete restrict,

  apartament_id uuid not null
    references organizare.apartamente (id) on delete restrict,

  profil_id uuid
    references identitate.profiluri (id) on delete restrict,

  confirmat_la timestamptz not null default now(),

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint adunari_prezente_adunare_apartament_key unique (adunare_id, apartament_id)
);

comment on column guvernanta.adunari_prezente.profil_id is
  'Cine a confirmat din aplicatie; null cand prezenta a fost trecuta de administrator de pe hartie.';

create index adunari_prezente_apartament_id_idx on guvernanta.adunari_prezente (apartament_id);
create index adunari_prezente_profil_id_idx on guvernanta.adunari_prezente (profil_id);

create trigger adunari_prezente_actualizat_la
  before update on guvernanta.adunari_prezente
  for each row execute function public.seteaza_actualizat_la();

create table guvernanta.voturi (
  id uuid primary key default gen_random_uuid(),

  asociatie_id uuid not null
    references organizare.asociatii (id) on delete restrict,

  adunare_id uuid
    references guvernanta.adunari_generale (id) on delete restrict,

  titlu text not null
    constraint voturi_titlu_check check (length(btrim(titlu)) > 0),

  descriere text,

  deschis_la timestamptz not null default now(),
  inchide_la timestamptz not null,

  numarare text not null default 'apartament'
    constraint voturi_numarare_check check (numarare in ('apartament', 'cota')),

  creat_de uuid
    references identitate.profiluri (id) on delete restrict,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint voturi_perioada_check check (inchide_la > deschis_la)
);

comment on column guvernanta.voturi.numarare is 'cota: hotararea se ia ponderat cu cota indiviza.';

create index voturi_asociatie_id_idx on guvernanta.voturi (asociatie_id);
create index voturi_adunare_id_idx on guvernanta.voturi (adunare_id);
create index voturi_creat_de_idx on guvernanta.voturi (creat_de);

create trigger voturi_actualizat_la
  before update on guvernanta.voturi
  for each row execute function public.seteaza_actualizat_la();

create table guvernanta.voturi_optiuni (
  id uuid primary key default gen_random_uuid(),

  vot_id uuid not null
    references guvernanta.voturi (id) on delete restrict,

  text text not null
    constraint voturi_optiuni_text_check check (length(btrim(text)) > 0),

  ordine smallint not null,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint voturi_optiuni_vot_id_key unique (vot_id, id)
);

create trigger voturi_optiuni_actualizat_la
  before update on guvernanta.voturi_optiuni
  for each row execute function public.seteaza_actualizat_la();

create table guvernanta.voturi_exprimate (
  id uuid primary key default gen_random_uuid(),

  vot_id uuid not null
    references guvernanta.voturi (id) on delete restrict,

  optiune_id uuid not null,

  apartament_id uuid not null
    references organizare.apartamente (id) on delete restrict,

  profil_id uuid
    references identitate.profiluri (id) on delete restrict,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  -- Un singur vot pe apartament.
  constraint voturi_exprimate_vot_apartament_key unique (vot_id, apartament_id),
  -- Nu se poate vota cu o optiune de pe alt buletin.
  constraint voturi_exprimate_optiune_fk foreign key (vot_id, optiune_id)
    references guvernanta.voturi_optiuni (vot_id, id) on delete restrict
);

comment on column guvernanta.voturi_exprimate.profil_id is
  'Cine a votat din aplicatie; null cand votul de pe buletinul de hartie a fost inregistrat de administrator.';

create index voturi_exprimate_optiune_idx on guvernanta.voturi_exprimate (vot_id, optiune_id);
create index voturi_exprimate_apartament_id_idx on guvernanta.voturi_exprimate (apartament_id);
create index voturi_exprimate_profil_id_idx on guvernanta.voturi_exprimate (profil_id);

create trigger voturi_exprimate_actualizat_la
  before update on guvernanta.voturi_exprimate
  for each row execute function public.seteaza_actualizat_la();

alter table guvernanta.adunari_generale enable row level security;
alter table guvernanta.adunari_prezente enable row level security;
alter table guvernanta.voturi enable row level security;
alter table guvernanta.voturi_optiuni enable row level security;
alter table guvernanta.voturi_exprimate enable row level security;

create policy "Adunarile se vad in asociatie"
  on guvernanta.adunari_generale for select to authenticated
  using (asociatie_id in (select private.asociatii_vizibile()));
create policy "Prezenta proprie si toata prezenta pentru conducere"
  on guvernanta.adunari_prezente for select to authenticated
  using (
    apartament_id in (select private.apartamentele_mele())
    or exists (
      select 1 from guvernanta.adunari_generale a
      where a.id = adunare_id
        and (a.asociatie_id in (select private.asociatii_administrate()) or a.asociatie_id in (select private.asociatii_supravegheate()))
    )
  );
create policy "Voturile se vad in asociatie"
  on guvernanta.voturi for select to authenticated
  using (asociatie_id in (select private.asociatii_vizibile()));
create policy "Optiunile se vad ca votul lor"
  on guvernanta.voturi_optiuni for select to authenticated
  using (exists (select 1 from guvernanta.voturi v where v.id = vot_id));
create policy "Votul propriu si toate voturile pentru conducere"
  on guvernanta.voturi_exprimate for select to authenticated
  using (
    apartament_id in (select private.apartamentele_mele())
    or exists (
      select 1 from guvernanta.voturi v
      where v.id = vot_id
        and (v.asociatie_id in (select private.asociatii_administrate()) or v.asociatie_id in (select private.asociatii_supravegheate()))
    )
  );

grant select on all tables in schema guvernanta to authenticated;
grant all on all tables in schema guvernanta to service_role;

-- =============================================================================
-- Comenzile si interogarile
-- =============================================================================

create function guvernanta.deschide_vot(
  p_asociatie_id uuid,
  p_titlu text,
  p_descriere text,
  p_optiuni text[],
  p_inchide_la timestamptz,
  p_numarare text default 'apartament'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_optiuni text[];
begin
  if p_asociatie_id not in (select private.asociatii_administrate()) then
    raise exception 'Doar administratorul poate deschide un vot.';
  end if;
  select array_agg(btrim(o)) into v_optiuni from unnest(p_optiuni) o where length(btrim(o)) > 0;
  if coalesce(array_length(v_optiuni, 1), 0) < 2 then
    raise exception 'Un vot are nevoie de cel putin doua variante.';
  end if;
  if p_inchide_la <= now() then
    raise exception 'Data de inchidere trebuie sa fie in viitor.';
  end if;
  insert into guvernanta.voturi (asociatie_id, titlu, descriere, inchide_la, numarare, creat_de)
  values (p_asociatie_id, btrim(p_titlu), nullif(btrim(p_descriere), ''), p_inchide_la, p_numarare, auth.uid())
  returning id into v_id;
  insert into guvernanta.voturi_optiuni (vot_id, text, ordine)
  select v_id, t, o::smallint from unnest(v_optiuni) with ordinality as x(t, o);
  perform evenimente.inregistreaza('VotDeschis', 'guvernanta', v_id,
    jsonb_build_object('vot_id', v_id, 'asociatie_id', p_asociatie_id, 'titlu', btrim(p_titlu), 'inchide_la', p_inchide_la));
  return v_id;
end;
$$;

create function guvernanta.voteaza(p_vot_id uuid, p_optiune_id uuid, p_apartament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vot guvernanta.voturi;
begin
  if p_apartament_id not in (select private.apartamentele_mele()) then
    raise exception 'Poti vota doar pentru apartamentul tau.';
  end if;
  select * into v_vot from guvernanta.voturi where id = p_vot_id;
  if not found or v_vot.asociatie_id not in (
    select b.asociatie_id from organizare.blocuri b join organizare.apartamente a on a.bloc_id = b.id where a.id = p_apartament_id
  ) then
    raise exception 'Votul nu exista.';
  end if;
  if now() >= v_vot.inchide_la or now() < v_vot.deschis_la then
    raise exception 'Votul nu este deschis.';
  end if;
  insert into guvernanta.voturi_exprimate (vot_id, optiune_id, apartament_id, profil_id)
  values (p_vot_id, p_optiune_id, p_apartament_id, auth.uid());
exception
  when unique_violation then
    raise exception 'Apartamentul a votat deja.';
  when foreign_key_violation then
    raise exception 'Optiunea nu apartine acestui vot.';
end;
$$;

-- Voturile asociatiei cu rezultatele numarate. Locatarul vede totalurile si
-- votul apartamentului lui; conducerea vede si ce apartamente nu au votat.
create function guvernanta.situatie_voturi(p_asociatie_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conducere boolean;
begin
  if p_asociatie_id not in (select private.asociatii_vizibile()) then
    raise exception 'Nu ai acces la aceasta asociatie.';
  end if;
  v_conducere := p_asociatie_id in (select private.asociatii_administrate())
              or p_asociatie_id in (select private.asociatii_supravegheate());
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id,
      'titlu', v.titlu,
      'descriere', v.descriere,
      'deschisLa', v.deschis_la,
      'inchideLa', v.inchide_la,
      'numarare', v.numarare,
      'optiuni', (
        select jsonb_agg(jsonb_build_object(
          'id', o.id, 'text', o.text,
          'voturi', (select count(*) from guvernanta.voturi_exprimate e where e.optiune_id = o.id),
          'cote', (select coalesce(sum(a.cota_indiviza), 0) from guvernanta.voturi_exprimate e join organizare.apartamente a on a.id = e.apartament_id where e.optiune_id = o.id)
        ) order by o.ordine)
        from guvernanta.voturi_optiuni o where o.vot_id = v.id
      ),
      'votanti', (select count(*) from guvernanta.voturi_exprimate e where e.vot_id = v.id),
      'totalApartamente', (select count(*) from organizare.apartamente a join organizare.blocuri b on b.id = a.bloc_id where b.asociatie_id = v.asociatie_id),
      'votulMeu', (select e.optiune_id from guvernanta.voturi_exprimate e where e.vot_id = v.id and e.apartament_id in (select private.apartamentele_mele()) limit 1),
      'nevotate', case when v_conducere then (
        select coalesce(jsonb_agg(a.numar order by nullif(regexp_replace(a.numar, '\D', '', 'g'), '')::int, a.numar), '[]'::jsonb)
        from organizare.apartamente a join organizare.blocuri b on b.id = a.bloc_id
        where b.asociatie_id = v.asociatie_id
          and not exists (select 1 from guvernanta.voturi_exprimate e where e.vot_id = v.id and e.apartament_id = a.id)
      ) end
    ) order by v.deschis_la desc)
    from guvernanta.voturi v
    where v.asociatie_id = p_asociatie_id
  ), '[]'::jsonb);
end;
$$;

-- Reaminteste celor care nu au votat. Comunicare trimite notificarile.
create function guvernanta.reaminteste_vot(p_vot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vot guvernanta.voturi;
  v_apartamente uuid[];
  v_destinatari integer;
begin
  select * into v_vot from guvernanta.voturi where id = p_vot_id;
  if not found or v_vot.asociatie_id not in (select private.asociatii_administrate()) then
    raise exception 'Votul nu exista.';
  end if;
  select coalesce(array_agg(a.id), '{}') into v_apartamente
  from organizare.apartamente a join organizare.blocuri b on b.id = a.bloc_id
  where b.asociatie_id = v_vot.asociatie_id
    and not exists (select 1 from guvernanta.voturi_exprimate e where e.vot_id = p_vot_id and e.apartament_id = a.id);
  select count(*) into v_destinatari from identitate.locatari l
  where l.apartament_id = any (v_apartamente) and (l.activ_pana is null or l.activ_pana > current_date);
  perform evenimente.inregistreaza('VotReamintit', 'guvernanta', p_vot_id,
    jsonb_build_object('vot_id', p_vot_id, 'asociatie_id', v_vot.asociatie_id, 'titlu', v_vot.titlu, 'apartamente', to_jsonb(v_apartamente)));
  return jsonb_build_object('apartamente', coalesce(array_length(v_apartamente, 1), 0), 'destinatari', v_destinatari);
end;
$$;

create function guvernanta.convoaca_adunare(p_asociatie_id uuid, p_data_ora timestamptz, p_loc text, p_ordine_de_zi text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_asociatie_id not in (select private.asociatii_administrate()) then
    raise exception 'Doar administratorul poate convoca adunarea generala.';
  end if;
  if p_data_ora <= now() then
    raise exception 'Data adunarii trebuie sa fie in viitor.';
  end if;
  insert into guvernanta.adunari_generale (asociatie_id, data_ora, loc, ordine_de_zi, convocata_de)
  values (p_asociatie_id, p_data_ora, btrim(p_loc), btrim(p_ordine_de_zi), auth.uid())
  returning id into v_id;
  perform evenimente.inregistreaza('AdunareConvocata', 'guvernanta', v_id,
    jsonb_build_object('adunare_id', v_id, 'asociatie_id', p_asociatie_id, 'data_ora', p_data_ora, 'loc', btrim(p_loc), 'ordine_de_zi', btrim(p_ordine_de_zi)));
  return v_id;
end;
$$;

create function guvernanta.confirma_prezenta(p_adunare_id uuid, p_apartament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_apartament_id not in (select private.apartamentele_mele()) then
    raise exception 'Poti confirma doar pentru apartamentul tau.';
  end if;
  if not exists (
    select 1 from guvernanta.adunari_generale g
    join organizare.blocuri b on b.asociatie_id = g.asociatie_id
    join organizare.apartamente a on a.bloc_id = b.id
    where g.id = p_adunare_id and a.id = p_apartament_id and g.data_ora > now()
  ) then
    raise exception 'Adunarea nu exista sau a avut deja loc.';
  end if;
  insert into guvernanta.adunari_prezente (adunare_id, apartament_id, profil_id)
  values (p_adunare_id, p_apartament_id, auth.uid())
  on conflict (adunare_id, apartament_id) do nothing;
end;
$$;

create function guvernanta.situatie_adunari(p_asociatie_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_asociatie_id not in (select private.asociatii_vizibile()) then
    raise exception 'Nu ai acces la aceasta asociatie.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id,
      'dataOra', g.data_ora,
      'loc', g.loc,
      'ordineDeZi', g.ordine_de_zi,
      'convocataLa', g.creat_la,
      'documentId', g.document_id,
      'prezente', (select count(*) from guvernanta.adunari_prezente p where p.adunare_id = g.id),
      'totalApartamente', (select count(*) from organizare.apartamente a join organizare.blocuri b on b.id = a.bloc_id where b.asociatie_id = g.asociatie_id),
      'prezentaMea', exists (select 1 from guvernanta.adunari_prezente p where p.adunare_id = g.id and p.apartament_id in (select private.apartamentele_mele()))
    ) order by g.data_ora desc)
    from guvernanta.adunari_generale g
    where g.asociatie_id = p_asociatie_id
  ), '[]'::jsonb);
end;
$$;

revoke execute on all functions in schema guvernanta from public, anon;
grant execute on all functions in schema guvernanta to authenticated, service_role;
