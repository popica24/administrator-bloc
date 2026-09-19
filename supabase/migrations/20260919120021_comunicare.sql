-- Comunicare, restul (docs/schema-propunere.md §3.H): avizierul, cele cinci
-- remindere automate si notificarile. Notificarea din aplicatie este canalul
-- implicit; un rand in notificari este si dovada ca instiintarea s-a trimis.
-- Aproape toate notificarile pornesc din evenimentele celorlalte contexte.

create table comunicare.anunturi (
  id uuid primary key default gen_random_uuid(),

  asociatie_id uuid not null
    references organizare.asociatii (id) on delete restrict,

  bloc_id uuid
    references organizare.blocuri (id) on delete restrict,

  autor_id uuid
    references identitate.profiluri (id) on delete restrict,

  titlu text not null
    constraint anunturi_titlu_check check (length(btrim(titlu)) > 0),

  corp text not null
    constraint anunturi_corp_check check (length(btrim(corp)) > 0),

  urgent boolean not null default false,
  publicat_la timestamptz not null default now(),
  expira_la timestamptz,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on column comunicare.anunturi.bloc_id is 'O oprire a apei priveste o scara; null inseamna toata asociatia.';

create index anunturi_asociatie_publicat_idx on comunicare.anunturi (asociatie_id, publicat_la desc);
create index anunturi_bloc_id_idx on comunicare.anunturi (bloc_id);
create index anunturi_autor_id_idx on comunicare.anunturi (autor_id);

create trigger anunturi_actualizat_la
  before update on comunicare.anunturi
  for each row execute function public.seteaza_actualizat_la();

create table comunicare.anunturi_citiri (
  anunt_id uuid not null
    references comunicare.anunturi (id) on delete restrict,

  profil_id uuid not null
    references identitate.profiluri (id) on delete restrict,

  citit_la timestamptz not null default now(),

  primary key (anunt_id, profil_id)
);

comment on table comunicare.anunturi_citiri is
  'Cine a vazut un anunt: raspunsul la "cati locatari au vazut anuntul". Fara id propriu (§3.H).';

create index anunturi_citiri_profil_id_idx on comunicare.anunturi_citiri (profil_id);

create table comunicare.remindere_setari (
  asociatie_id uuid not null
    references organizare.asociatii (id) on delete restrict,

  tip text not null
    constraint remindere_setari_tip_check check (tip in ('lista_publicata', 'citire_contoare', 'plata', 'restanta', 'adunare_generala')),

  activ boolean not null default true,

  zile smallint not null default 0
    constraint remindere_setari_zile_check check (zile between 0 and 60),

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  primary key (asociatie_id, tip)
);

comment on table comunicare.remindere_setari is
  'Cele cinci remindere din PDF. zile este decalajul: "cu 5 zile inainte de termen".';

create trigger remindere_setari_actualizat_la
  before update on comunicare.remindere_setari
  for each row execute function public.seteaza_actualizat_la();

create table comunicare.notificari (
  id uuid primary key default gen_random_uuid(),

  profil_id uuid not null
    references identitate.profiluri (id) on delete restrict,

  asociatie_id uuid
    references organizare.asociatii (id) on delete restrict,

  tip text not null,

  titlu text not null
    constraint notificari_titlu_check check (length(btrim(titlu)) > 0),

  corp text,

  canal text not null default 'aplicatie'
    constraint notificari_canal_check check (canal in ('aplicatie', 'email', 'sms')),

  trimisa_la timestamptz not null default now(),
  citita_la timestamptz,
  referinta jsonb,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now()
);

comment on table comunicare.notificari is
  'Mesajele trimise unui om. Cele de tip restanta se pastreaza: dovedesc instiintarea.';

-- Mesajele unui om, cele mai noi primele.
create index notificari_profil_trimisa_idx on comunicare.notificari (profil_id, trimisa_la desc);
create index notificari_asociatie_id_idx on comunicare.notificari (asociatie_id);

create trigger notificari_actualizat_la
  before update on comunicare.notificari
  for each row execute function public.seteaza_actualizat_la();

alter table comunicare.anunturi enable row level security;
alter table comunicare.anunturi_citiri enable row level security;
alter table comunicare.remindere_setari enable row level security;
alter table comunicare.notificari enable row level security;

create policy "Anunturile se vad in asociatie si in bloc"
  on comunicare.anunturi for select to authenticated
  using (asociatie_id in (select private.asociatii_vizibile()) and (bloc_id is null or bloc_id in (select private.blocuri_vizibile())));

create policy "Citirea proprie si toate citirile pentru conducere"
  on comunicare.anunturi_citiri for select to authenticated
  using (
    profil_id = (select auth.uid())
    or exists (
      select 1 from comunicare.anunturi a
      where a.id = anunt_id
        and (a.asociatie_id in (select private.asociatii_administrate()) or a.asociatie_id in (select private.asociatii_supravegheate()))
    )
  );

create policy "Reminderele se vad de conducere"
  on comunicare.remindere_setari for select to authenticated
  using (asociatie_id in (select private.asociatii_administrate()) or asociatie_id in (select private.asociatii_supravegheate()));

create policy "Fiecare isi vede notificarile"
  on comunicare.notificari for select to authenticated
  using (profil_id = (select auth.uid()));

grant select on all tables in schema comunicare to authenticated;
grant all on all tables in schema comunicare to service_role;

-- =============================================================================
-- Functii interne
-- =============================================================================

create function comunicare.luna_text(p date)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'])[extract(month from p)::int]
         || ' ' || extract(year from p)::int;
$$;

create function comunicare.data_text(p date)
returns text
language sql
immutable
set search_path = ''
as $$
  select extract(day from p)::int || ' ' || comunicare.luna_text(p);
$$;

create function comunicare.notifica(
  p_profil_id uuid,
  p_asociatie_id uuid,
  p_tip text,
  p_titlu text,
  p_corp text,
  p_referinta jsonb default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into comunicare.notificari (profil_id, asociatie_id, tip, titlu, corp, referinta)
  values (p_profil_id, p_asociatie_id, p_tip, p_titlu, p_corp, p_referinta);
$$;

-- Locatarii cu cont ai unor apartamente, azi.
create function comunicare.locatari_apartamente(p_apartamente uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct l.profil_id
  from identitate.locatari l
  where l.apartament_id = any (p_apartamente)
    and l.activ_din <= current_date
    and (l.activ_pana is null or l.activ_pana > current_date);
$$;

create function comunicare.asociatie_apartament(p_apartament_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.asociatie_id from organizare.apartamente a join organizare.blocuri b on b.id = a.bloc_id where a.id = p_apartament_id;
$$;

-- Apartamentele care au de platit ceva: toate datoriile, sau doar cele trecute de scadenta.
create function comunicare.apartamente_cu_sold(p_bloc_id uuid, p_doar_restante boolean)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct d.apartament_id
  from financiar.datorii d
  where d.bloc_id = p_bloc_id
    and (not p_doar_restante or d.scadenta < current_date)
    and d.suma - coalesce((select sum(a.suma) from financiar.alocari_plati a where a.datorie_id = d.id), 0) > 0;
$$;

-- =============================================================================
-- Comenzile
-- =============================================================================

create function comunicare.publica_anunt(p_bloc_id uuid, p_titlu text, p_corp text, p_urgent boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asociatie uuid;
  v_id uuid;
  v_profil uuid;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) then
    raise exception 'Doar administratorul publica anunturi.';
  end if;
  select asociatie_id into v_asociatie from organizare.blocuri where id = p_bloc_id;
  insert into comunicare.anunturi (asociatie_id, bloc_id, autor_id, titlu, corp, urgent)
  values (v_asociatie, p_bloc_id, auth.uid(), btrim(p_titlu), btrim(p_corp), coalesce(p_urgent, false))
  returning id into v_id;
  if p_urgent then
    for v_profil in
      select distinct l.profil_id from identitate.locatari l
      where l.bloc_id = p_bloc_id and (l.activ_pana is null or l.activ_pana > current_date)
    loop
      perform comunicare.notifica(v_profil, v_asociatie, 'anunt', 'Urgent: ' || btrim(p_titlu), btrim(p_corp), jsonb_build_object('anunt_id', v_id));
    end loop;
  end if;
  return v_id;
end;
$$;

create function comunicare.marcheaza_anunt_citit(p_anunt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from comunicare.anunturi a
    where a.id = p_anunt_id and a.asociatie_id in (select private.asociatii_vizibile())
  ) then
    raise exception 'Anuntul nu exista.';
  end if;
  insert into comunicare.anunturi_citiri (anunt_id, profil_id) values (p_anunt_id, auth.uid())
  on conflict do nothing;
end;
$$;

create function comunicare.marcheaza_notificare_citita(p_notificare_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update comunicare.notificari set citita_la = now()
  where id = p_notificare_id and profil_id = auth.uid() and citita_la is null;
$$;

create function comunicare.seteaza_reminder(p_asociatie_id uuid, p_tip text, p_activ boolean, p_zile smallint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_asociatie_id not in (select private.asociatii_administrate()) then
    raise exception 'Doar administratorul schimba reminderele.';
  end if;
  update comunicare.remindere_setari
     set activ = p_activ, zile = coalesce(p_zile, zile)
   where asociatie_id = p_asociatie_id and tip = p_tip;
end;
$$;

-- Trimite acum un reminder catre apartamentele vizate de el.
create function comunicare.trimite_reminder(p_bloc_id uuid, p_tip text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asociatie uuid;
  v_apartamente uuid[];
  v_profil uuid;
  v_n integer := 0;
  v_luna date := date_trunc('month', current_date)::date;
  v_zi smallint;
  v_titlu text;
  v_corp text;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul trimite remindere.';
  end if;
  select asociatie_id into v_asociatie from organizare.blocuri where id = p_bloc_id;

  if p_tip = 'citire_contoare' then
    select coalesce(zi_limita_citire, 25) into v_zi from contorizare.setari_contorizare where bloc_id = p_bloc_id;
    select coalesce(array_agg(a.id), '{}') into v_apartamente from organizare.apartamente a
    where a.bloc_id = p_bloc_id
      and not exists (select 1 from contorizare.citiri c where c.apartament_id = a.id and c.luna = v_luna and c.stare <> 'respinsa');
    v_titlu := 'Transmite indexul la apa';
    v_corp := 'Te rugam sa transmiti indexul contoarelor pana pe ' || comunicare.data_text((v_luna + (coalesce(v_zi, 25) - 1))::date) || ', cu o poza a contoarelor.';
  elsif p_tip = 'restanta' then
    select coalesce(array_agg(x), '{}') into v_apartamente from comunicare.apartamente_cu_sold(p_bloc_id, true) x;
    v_titlu := 'Instiintare de plata';
    v_corp := 'Aveti sume neachitate trecute de scadenta. Va rugam sa le achitati ca sa opriti penalizarile.';
  elsif p_tip = 'plata' then
    select coalesce(array_agg(x), '{}') into v_apartamente from comunicare.apartamente_cu_sold(p_bloc_id, false) x;
    v_titlu := 'Reamintire de plata';
    v_corp := 'Se apropie termenul de plata al intretinerii. Vezi in aplicatie suma si calculul ei.';
  else
    raise exception 'Reminderul % nu se trimite manual.', p_tip;
  end if;

  for v_profil in select * from comunicare.locatari_apartamente(v_apartamente) loop
    perform comunicare.notifica(v_profil, v_asociatie, p_tip, v_titlu, v_corp, null);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('apartamente', coalesce(array_length(v_apartamente, 1), 0), 'destinatari', v_n);
end;
$$;

-- Instiintarea de plata pentru un singur restantier.
create function comunicare.trimite_instiintare(p_apartament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profil uuid;
  v_n integer := 0;
begin
  if p_apartament_id not in (select private.apartamente_administrate()) then
    raise exception 'Apartamentul nu este din blocul tau.';
  end if;
  for v_profil in select * from comunicare.locatari_apartamente(array[p_apartament_id]) loop
    perform comunicare.notifica(v_profil, comunicare.asociatie_apartament(p_apartament_id), 'restanta', 'Instiintare de plata',
      'Aveti sume neachitate trecute de scadenta. Va rugam sa le achitati ca sa opriti penalizarile.', jsonb_build_object('apartament_id', p_apartament_id));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('destinatari', v_n);
end;
$$;

-- Jobul zilnic al reminderelor automate (pg_cron). Fiecare reminder activ
-- pleaca in ziua potrivita decalajului lui.
create function comunicare.trimite_remindere_zilnice()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r record;
  v_bloc record;
  v_luna date := date_trunc('month', current_date)::date;
  v_termen date;
  v_profil uuid;
begin
  for v_r in select * from comunicare.remindere_setari where activ loop
    for v_bloc in select b.id from organizare.blocuri b where b.asociatie_id = v_r.asociatie_id and b.stare = 'activ' and b.arhivat_la is null loop
      if v_r.tip = 'citire_contoare' then
        select v_luna + (coalesce(s.zi_limita_citire, 25) - 1) into v_termen from contorizare.setari_contorizare s where s.bloc_id = v_bloc.id;
        if v_termen - v_r.zile = current_date then
          perform comunicare.trimite_reminder(v_bloc.id, 'citire_contoare');
        end if;
      elsif v_r.tip = 'plata' then
        if exists (select 1 from intretinere.liste_lunare l where l.bloc_id = v_bloc.id and l.stare = 'publicata' and l.scadenta - v_r.zile = current_date) then
          perform comunicare.trimite_reminder(v_bloc.id, 'plata');
        end if;
      elsif v_r.tip = 'restanta' then
        if exists (select 1 from intretinere.liste_lunare l where l.bloc_id = v_bloc.id and l.stare = 'publicata' and l.scadenta + v_r.zile = current_date) then
          perform comunicare.trimite_reminder(v_bloc.id, 'restanta');
        end if;
      elsif v_r.tip = 'adunare_generala' then
        for v_profil in
          select distinct l.profil_id
          from guvernanta.adunari_generale g
          join identitate.locatari l on l.bloc_id = v_bloc.id and (l.activ_pana is null or l.activ_pana > current_date)
          where g.asociatie_id = v_r.asociatie_id and g.data_ora::date - v_r.zile = current_date
        loop
          perform comunicare.notifica(v_profil, v_r.asociatie_id, 'adunare_generala', 'Adunarea generala se apropie',
            'Adunarea generala are loc peste ' || v_r.zile || ' zile. Confirma prezenta din aplicatie.', null);
        end loop;
      end if;
    end loop;
  end loop;
end;
$$;

-- =============================================================================
-- Handlerele de evenimente
-- =============================================================================

create function comunicare.la_lista_publicata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asociatie uuid := (p_date ->> 'asociatie_id')::uuid;
  v_profil uuid;
begin
  if not exists (select 1 from comunicare.remindere_setari where asociatie_id = v_asociatie and tip = 'lista_publicata' and activ) then
    return;
  end if;
  for v_profil in
    select distinct l.profil_id from identitate.locatari l
    where l.bloc_id = (p_date ->> 'bloc_id')::uuid and (l.activ_pana is null or l.activ_pana > current_date)
  loop
    perform comunicare.notifica(v_profil, v_asociatie, 'lista_publicata',
      'Lista pe ' || comunicare.luna_text((p_date ->> 'luna')::date) || ' a fost publicata',
      'Vezi in aplicatie cat ai de plata si cum s-a calculat fiecare suma. Termenul de plata este ' || comunicare.data_text((p_date ->> 'scadenta')::date) || '.',
      jsonb_build_object('lista_id', p_date ->> 'lista_id'));
  end loop;
end;
$$;

create function comunicare.la_lista_recalculata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profil uuid;
  v_asociatie uuid;
begin
  select asociatie_id into v_asociatie from organizare.blocuri where id = (p_date ->> 'bloc_id')::uuid;
  for v_profil in
    select distinct l.profil_id from identitate.locatari l
    where l.bloc_id = (p_date ->> 'bloc_id')::uuid and (l.activ_pana is null or l.activ_pana > current_date)
  loop
    perform comunicare.notifica(v_profil, v_asociatie, 'lista_recalculata',
      'Lista pe ' || comunicare.luna_text((p_date ->> 'luna')::date) || ' a fost corectata',
      'O factura a fost corectata si lista a fost recalculata. Diferenta apare ca un rand separat, cu explicatia lui.',
      jsonb_build_object('lista_id', p_date ->> 'lista_id'));
  end loop;
end;
$$;

create function comunicare.la_citire_respinsa(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profil uuid;
  v_ap uuid := (p_date ->> 'apartament_id')::uuid;
begin
  for v_profil in select * from comunicare.locatari_apartamente(array[v_ap]) loop
    perform comunicare.notifica(v_profil, comunicare.asociatie_apartament(v_ap), 'citire', 'Indexul trimis a fost respins',
      (p_date ->> 'motiv') || ' Te rugam sa trimiti din nou indexul, cu o poza clara.', p_date);
  end loop;
end;
$$;

create function comunicare.la_sesizare(p_tip text, p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profil uuid;
  v_ap uuid := (p_date ->> 'apartament_id')::uuid;
begin
  for v_profil in select * from comunicare.locatari_apartamente(array[v_ap]) loop
    if p_tip = 'SesizareRaspuns' then
      perform comunicare.notifica(v_profil, comunicare.asociatie_apartament(v_ap), 'sesizare', 'Raspuns la sesizarea ta',
        (p_date ->> 'titlu') || ': ' || (p_date ->> 'text'), jsonb_build_object('sesizare_id', p_date ->> 'sesizare_id'));
    elsif p_tip = 'SesizareRezolvata' then
      perform comunicare.notifica(v_profil, comunicare.asociatie_apartament(v_ap), 'sesizare', 'Sesizare rezolvata',
        p_date ->> 'titlu', jsonb_build_object('sesizare_id', p_date ->> 'sesizare_id'));
    end if;
  end loop;
end;
$$;

create function comunicare.la_plata_confirmata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ch financiar.chitante;
  v_profil uuid;
  v_ap uuid := (p_date ->> 'apartament_id')::uuid;
begin
  select * into v_ch from financiar.chitante where plata_id = (p_date ->> 'plata_id')::uuid;
  for v_profil in select * from comunicare.locatari_apartamente(array[v_ap]) loop
    perform comunicare.notifica(v_profil, v_ch.asociatie_id, 'plata', 'Plata a fost inregistrata',
      'Am primit ' || to_char((p_date ->> 'suma')::numeric, 'FM999G990D00') || ' lei. Chitanta ' || v_ch.serie || ' nr. ' || lpad(v_ch.numar::text, 6, '0') || ' este in aplicatie, la Platile mele.',
      jsonb_build_object('plata_id', p_date ->> 'plata_id'));
  end loop;
end;
$$;

create function comunicare.la_vot(p_tip text, p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profil uuid;
  v_asociatie uuid := (p_date ->> 'asociatie_id')::uuid;
begin
  if p_tip = 'VotDeschis' then
    for v_profil in
      select distinct l.profil_id from identitate.locatari l join organizare.blocuri b on b.id = l.bloc_id
      where b.asociatie_id = v_asociatie and (l.activ_pana is null or l.activ_pana > current_date)
    loop
      perform comunicare.notifica(v_profil, v_asociatie, 'vot', 'Vot nou: ' || (p_date ->> 'titlu'),
        'Votul se inchide pe ' || comunicare.data_text((p_date ->> 'inchide_la')::date) || '. Voteaza din aplicatie, la Bloc.', jsonb_build_object('vot_id', p_date ->> 'vot_id'));
    end loop;
  elsif p_tip = 'VotReamintit' then
    for v_profil in
      select * from comunicare.locatari_apartamente(array(select jsonb_array_elements_text(p_date -> 'apartamente')::uuid))
    loop
      perform comunicare.notifica(v_profil, v_asociatie, 'vot', 'Nu ai votat inca', p_date ->> 'titlu', jsonb_build_object('vot_id', p_date ->> 'vot_id'));
    end loop;
  elsif p_tip = 'AdunareConvocata' then
    for v_profil in
      select distinct l.profil_id from identitate.locatari l join organizare.blocuri b on b.id = l.bloc_id
      where b.asociatie_id = v_asociatie and (l.activ_pana is null or l.activ_pana > current_date)
    loop
      perform comunicare.notifica(v_profil, v_asociatie, 'adunare_generala', 'Convocare la adunarea generala',
        comunicare.data_text((p_date ->> 'data_ora')::timestamptz::date) || ', ' || (p_date ->> 'loc') || '. ' || (p_date ->> 'ordine_de_zi'),
        jsonb_build_object('adunare_id', p_date ->> 'adunare_id'));
    end loop;
  end if;
end;
$$;

create function comunicare.la_administrator_aprobat(p_date jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  select comunicare.notifica((p_date ->> 'profil_id')::uuid, null, 'bun_venit', 'Contul de administrator a fost aprobat',
    'Bine ai venit in AdminBloc. Dupa ce esti legat de asociatie, vezi aici blocurile pe care le administrezi.', null);
$$;

revoke execute on all functions in schema comunicare from public, anon, authenticated;
grant execute on function comunicare.publica_anunt(uuid, text, text, boolean),
  comunicare.marcheaza_anunt_citit(uuid),
  comunicare.marcheaza_notificare_citita(uuid),
  comunicare.seteaza_reminder(uuid, text, boolean, smallint),
  comunicare.trimite_reminder(uuid, text),
  comunicare.trimite_instiintare(uuid),
  comunicare.luna_text(date),
  comunicare.data_text(date)
  to authenticated;
grant execute on all functions in schema comunicare to service_role;
