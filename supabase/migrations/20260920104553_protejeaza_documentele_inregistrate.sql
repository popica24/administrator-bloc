-- S7: promisiunea de transparenta ("orice suma se deschide in factura si
-- documentul din spate") presupune ca documentul inregistrat ramane cel pe
-- care l-a vazut locatarul. Patru gauri lasau administratorul sa strice asta:
--
-- 1) fisierul din spatele unui document inregistrat se putea sterge din
--    storage (bucket "documente"), lasand un rand orfan (link mort);
-- 2) update pe comunicare.documente.cale repointa documentul spre alt
--    fisier, fara nicio urma ca s-a schimbat continutul;
-- 3) un document deja vazut de locatari (vizibil_locatarilor = true) putea
--    fi ascuns oricand;
-- 4) insert pe comunicare.documente nu verifica prefixul caii: un document
--    inregistrat pe asociatia ta putea indica fisierul altei asociatii.
--
-- Reparatie: (1) si (4) sunt politici RLS; (2) si (3) sunt un trigger, pentru
-- ca RLS nu poate compara valoarea noua cu cea veche a aceluiasi rand.

drop policy "Administratorul incarca documente" on comunicare.documente;
create policy "Administratorul incarca documente"
  on comunicare.documente for insert to authenticated
  with check (
    asociatie_id in (select private.asociatii_administrate())
    and incarcat_de = (select auth.uid())
    and cale like (asociatie_id::text || '/%')
  );

create function comunicare.protejeaza_documentul()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cale <> old.cale then
    raise exception 'Calea documentului nu se poate schimba dupa incarcare.';
  end if;
  if old.vizibil_locatarilor and not new.vizibil_locatarilor then
    raise exception 'Un document vazut de locatari nu se mai poate ascunde.';
  end if;
  return new;
end;
$$;

create trigger documente_protejeaza
  before update on comunicare.documente
  for each row execute function comunicare.protejeaza_documentul();

drop policy "Documente: stergere de catre administrator" on storage.objects;
create policy "Documente: stergere de catre administrator"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documente'
    and (storage.foldername(name))[1] in (select a::text from private.asociatii_administrate() a)
    and not exists (select 1 from comunicare.documente d where d.cale = storage.objects.name)
  );
