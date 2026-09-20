-- Comunicare, partea intai (docs/schema-propunere.md §3.H, §9 pasul 3):
-- biblioteca de documente si bucket-urile din Storage. Vine devreme pentru ca
-- facturile scanate, listele de hartie si procesele-verbale sunt toate
-- documente la care trimit celelalte contexte.

create table comunicare.documente (
  id uuid primary key default gen_random_uuid(),

  asociatie_id uuid not null
    references organizare.asociatii (id) on delete restrict,

  bloc_id uuid
    references organizare.blocuri (id) on delete restrict,

  titlu text not null
    constraint documente_titlu_check check (length(btrim(titlu)) > 0),

  tip text not null
    constraint documente_tip_check check (tip in ('lista_plata', 'raport', 'proces_verbal', 'contract', 'regulament', 'factura', 'altul')),

  cale text not null
    constraint documente_cale_check check (length(btrim(cale)) > 0),

  vizibil_locatarilor boolean not null default true,

  incarcat_de uuid
    references identitate.profiluri (id) on delete restrict,

  creat_la timestamptz not null default now(),
  actualizat_la timestamptz not null default now(),

  constraint documente_cale_key unique (cale)
);

comment on table comunicare.documente is
  'Facturi scanate, liste de hartie, contracte, procese-verbale. Fisierul sta in bucket-ul privat documente, la calea <asociatie_id>/<bloc_id>/...';
comment on column comunicare.documente.bloc_id is 'Null inseamna tot asociatia.';

create index documente_asociatie_id_idx on comunicare.documente (asociatie_id);
create index documente_bloc_id_idx on comunicare.documente (bloc_id);
create index documente_incarcat_de_idx on comunicare.documente (incarcat_de);

create trigger documente_actualizat_la
  before update on comunicare.documente
  for each row execute function public.seteaza_actualizat_la();

alter table organizare.inrolare_apartamente
  add constraint inrolare_apartamente_document_id_fkey
  foreign key (document_id) references comunicare.documente (id) on delete restrict;

alter table comunicare.documente enable row level security;

create policy "Documentele se vad de conducere, cele publice si de locatari"
  on comunicare.documente for select to authenticated
  using (
    asociatie_id in (select private.asociatii_administrate())
    or asociatie_id in (select private.asociatii_supravegheate())
    or (
      vizibil_locatarilor
      and asociatie_id in (select private.asociatii_vizibile())
      and (bloc_id is null or bloc_id in (select private.blocuri_vizibile()))
    )
  );
create policy "Administratorul incarca documente"
  on comunicare.documente for insert to authenticated
  with check (asociatie_id in (select private.asociatii_administrate()) and incarcat_de = (select auth.uid()));
create policy "Administratorul modifica documente"
  on comunicare.documente for update to authenticated
  using (asociatie_id in (select private.asociatii_administrate()))
  with check (asociatie_id in (select private.asociatii_administrate()));

grant select, insert, update on comunicare.documente to authenticated;
grant all on comunicare.documente to service_role;

-- =============================================================================
-- Storage: trei bucket-uri private
-- poze are limita de 1 MB si doar JPEG/WebP: aplicatia micsoreaza poza
-- inainte de upload, iar serverul refuza una nemicsorata (§10.4).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documente', 'documente', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('poze', 'poze', false, 1048576, array['image/jpeg', 'image/webp']),
  ('atestate', 'atestate', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- documente: <asociatie_id>/<bloc_id>/<fisier>. Se citeste cine vede randul
-- din comunicare.documente (RLS-ul tabelei se aplica si in subinterogare).
create policy "Documente: citire ca randul din tabela"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documente'
    and (
      exists (select 1 from comunicare.documente d where d.cale = storage.objects.name)
      or (storage.foldername(name))[1] in (select a::text from private.asociatii_administrate() a)
    )
  );
create policy "Documente: incarcare de catre administrator"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documente'
    and (storage.foldername(name))[1] in (select a::text from private.asociatii_administrate() a)
  );
create policy "Documente: stergere de catre administrator"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documente'
    and (storage.foldername(name))[1] in (select a::text from private.asociatii_administrate() a)
  );

-- poze: <bloc_id>/<apartament_id>/<fisier>, pentru citiri si sesizari.
create policy "Poze: citire de catre apartament si conducerea blocului"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'poze'
    and (
      (storage.foldername(name))[1] in (select b::text from private.blocuri_conduse() b)
      or (storage.foldername(name))[2] in (select a::text from private.apartamentele_mele() a)
    )
  );
create policy "Poze: incarcare pentru apartamentul propriu"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'poze'
    and (
      (storage.foldername(name))[2] in (select a::text from private.apartamentele_mele() a)
      or (storage.foldername(name))[1] in (select b::text from private.blocuri_administrate() b)
    )
  );

-- atestate: <profil_id>/<fisier>, vazut doar de titular (si de dezvoltator).
create policy "Atestate: titularul isi incarca atestatul"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'atestate' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Atestate: titularul isi vede atestatul"
  on storage.objects for select to authenticated
  using (bucket_id = 'atestate' and (storage.foldername(name))[1] = (select auth.uid())::text);
