-- [C11] Pozele sesizarilor raman intre locatar si administrator.
--
-- Migratia H11 a scos conducerea (presedinte, cenzor) din politica de citire a
-- sesizarilor: ce scrie un om despre casa lui il priveste pe el si pe
-- administrator. Politica de storage pe pozele sesizarilor a ramas insa pe
-- private.blocuri_conduse(), care ii cuprinde. Practic nu se ajungea la ele
-- (fara randul din sesizari_poze nu stii calea, iar calea are o marca de timp
-- in milisecunde), dar era o inconsecventa ramasa dupa H11.
--
-- Caile sunt <bloc_id>/<apartament_id>/citire-... pentru contoare si
-- <bloc_id>/<apartament_id>/sesizare-... pentru sesizari, deci politica poate
-- deosebi cele doua feluri de poze.

drop policy "Poze: citire de catre apartament si conducerea blocului" on storage.objects;

create policy "Poze: citire de catre apartament, bloc si administrator"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'poze'
    and (
      -- pozele apartamentului meu, oricare ar fi ele
      (storage.foldername(name))[2] in (select a::text from private.apartamentele_mele() a)
      -- pozele de contor: toata conducerea blocului le vede
      or (
        (storage.foldername(name))[1] in (select b::text from private.blocuri_conduse() b)
        and name not like '%/sesizare-%'
      )
      -- pozele sesizarilor: numai administratorul blocului (H11)
      or (
        (storage.foldername(name))[1] in (select b::text from private.blocuri_administrate() b)
        and name like '%/sesizare-%'
      )
    )
  );
