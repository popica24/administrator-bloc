-- public.numar_ro nu avea search_path fixat (advisorul Supabase
-- "function_search_path_mutable", pe productie, 21 septembrie): isi cauta
-- functiile dupa calea celui care o apeleaza, deci un obiect cu acelasi nume
-- pus inaintea celui real ar fi folosit in locul lui. Corpul foloseste doar
-- functii din pg_catalog (to_char, round, regexp_replace...), care se gasesc
-- si cu calea goala, ca in restul functiilor proiectului.
--
-- Testul f-paze-pe-toata-baza verifica de acum regula pentru toate functiile
-- aplicatiei, ca urmatoarea sa fie prinsa la prima migratie.
alter function public.numar_ro(numeric, integer) set search_path = '';
