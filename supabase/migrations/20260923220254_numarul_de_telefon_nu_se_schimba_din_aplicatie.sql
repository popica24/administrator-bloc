-- [A2, A5] Numarul de telefon este identitatea contului, deci nu se mai scrie
-- din aplicatie si nu se mai repeta.
--
-- Contul se tine pe numar (adresa interna <numar>@telefon.adminbloc.ro), iar
-- cont-locatar cauta profilul dupa identitate.profiluri.telefon inainte de a
-- face un cont nou. Cu `grant update (nume, telefon) ... to authenticated`,
-- orice locatar isi putea scrie in profil numarul altcuiva: cand
-- administratorul adauga mai tarziu acel numar, functia gasea profilul lui si
-- ii lega apartamentul strainului, fara sa faca vreun cont nou.
--
-- Trei lucruri, impreuna:
--   * numarul nu mai e coloana pe care o poate scrie `authenticated`
--     (numele ramane; nicio parte a aplicatiei nu scria numarul oricum);
--   * numarul e unic, deci doi oameni nu pot ajunge pe acelasi numar nici prin
--     cheia de serviciu;
--   * numarul e normalizat in baza, nu doar in JavaScript: zece cifre care
--     incep cu 07, 02 sau 03, ca in _shared/telefon.js.

revoke update (telefon) on identitate.profiluri from authenticated;

-- Aceeasi regula ca in supabase/functions/_shared/telefon.js, scrisa si in
-- baza: contul se poate face si cu cheia de serviciu, fara sa treaca prin
-- JavaScript, iar numarul trebuie sa arate la fel oriunde a intrat.
create function private.normalizeaza_telefon(p_scris text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(coalesce(p_scris, ''), '[[:space:].()-]', '', 'g');
begin
  if left(v, 3) = '+40' then v := substr(v, 4);
  elsif left(v, 4) = '0040' then v := substr(v, 5);
  elsif left(v, 2) = '40' and length(v) = 11 then v := substr(v, 3);
  elsif left(v, 1) = '0' then v := substr(v, 2);
  else return null;
  end if;
  -- "+40 0722 123 456": prefixul tarii si zeroul de acasa, unul dupa altul
  if left(v, 1) = '0' then v := substr(v, 2); end if;
  v := '0' || v;
  return case when v ~ '^0[237][0-9]{8}$' then v end;
end;
$$;

comment on function private.normalizeaza_telefon(text) is
  'Numarul asa cum il tine baza: zece cifre, fara spatii si fara prefixul tarii. Null daca nu este un numar romanesc.';

-- Profilul ia numarul normalizat, nu cum a fost scris in metadate.
create or replace function identitate.la_cont_nou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into identitate.profiluri (id, nume, telefon, email)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nume'), ''), 'Utilizator'),
    private.normalizeaza_telefon(coalesce(new.raw_user_meta_data ->> 'telefon', new.phone)),
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

alter table identitate.profiluri
  add constraint profiluri_telefon_check
    check (telefon is null or telefon ~ '^0[237][0-9]{8}$');

create unique index profiluri_telefon_key
  on identitate.profiluri (telefon)
  where telefon is not null;

comment on column identitate.profiluri.telefon is
  'Identitatea contului: zece cifre normalizate (_shared/telefon.js). Il scrie numai cheia de serviciu, prin cont-locatar.';
