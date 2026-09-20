-- [minor] contorizare.valideaza_citiri_apartament si
-- identitate.revoca_invitatie revoca dreptul de executie de la PUBLIC (ca
-- toate comenzile din aceste scheme), dar il re-acorda doar catre
-- authenticated, nu si catre service_role, spre deosebire de comenzile lor
-- surori (restul comenzilor din contorizare au grant catre service_role pe
-- schema intreaga, iar identitate are acelasi grant global, dar ambele
-- comenzi au fost adaugate in migratii ulterioare acelui grant global si nu
-- au primit unul propriu). Un apel din Edge Function sau alt cod cu
-- service_role (de exemplu recalcularea, sau un script de intretinere) nu
-- poate chema aceste doua comenzi.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select ok(
  has_function_privilege('service_role', 'contorizare.valideaza_citiri_apartament(uuid,date,boolean,text)', 'EXECUTE'),
  '[minor] service_role poate executa contorizare.valideaza_citiri_apartament');

select ok(
  has_function_privilege('service_role', 'identitate.revoca_invitatie(uuid)', 'EXECUTE'),
  '[minor] service_role poate executa identitate.revoca_invitatie');

select * from finish();
rollback;
