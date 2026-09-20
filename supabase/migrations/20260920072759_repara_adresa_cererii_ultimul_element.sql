-- identitate.adresa_cererii lua primul element din x-forwarded-for (audit 2:
-- G4), care este exact partea pe care clientul o scrie singur. O cerere cu
-- antetul "orice-text-vrei-tu" trecea drept "adresa" ei, deci plafonul pe
-- adresa (migratia limita_invitatii_pe_adresa) se ocolea la fiecare cerere cu
-- un antet nou, iar un bloc intreg din spatele unui singur NAT/CGNAT se bloca
-- singur din prima incercare gresita a oricui din el.
--
-- PostgREST pune in request.headers exact ce a primit procesul care il
-- deserveste. Cand acesta sta in spatele unui proxy de incredere (load
-- balancer, Kong local), acel proxy ADAUGA la coada antetului adresa reala pe
-- care a vazut-o el, deci elementul de incredere este ULTIMUL, nu primul:
-- clientul poate scrie orice prefix vrea, dar nu poate scrie ce vine dupa
-- virgula pusa de proxy. Aici este corectia: se ia ultimul element.
--
-- Un prefix falsificat nu mai cumpara incercari noi (testul o demonstreaza in
-- d-limita-globala-invitatii.test.sql): un atacator deja blocat pe adresa lui
-- reala ramane blocat oricate adrese false ar pretinde inaintea ei.

create or replace function identitate.adresa_cererii()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with lista as (
    select string_to_array(
      coalesce(
        nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
        ''),
      ',') as elemente
  )
  select nullif(btrim(elemente[array_length(elemente, 1)]), '')
  from lista;
$$;

comment on function identitate.adresa_cererii() is
  'Adresa clientului din antetele cererii: ultimul element din x-forwarded-for, cel adaugat de proxy-ul de incredere, nu primul (scris de client si deci falsificabil). Null cand nu se cunoaste.';
