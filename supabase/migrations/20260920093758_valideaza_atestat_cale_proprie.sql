-- identitate.cere_verificare_administrator() accepta p_atestat_cale fara sa
-- verifice ca fisierul e chiar al apelantului: un candidat putea trimite
-- calea atestatului altui utilizator (de exemplu al unui administrator deja
-- aprobat), iar dezvoltatorul care aproba cererea (§8.2) ar fi deschis
-- fisierul gresit (audit S8).
--
-- Bucket-ul "atestate" e organizat pe <profil_id>/<fisier> (politica de
-- upload din 20260919120012_documente.sql cere acelasi lucru la nivel de
-- storage), asa ca functia verifica acum aceeasi conventie.

create or replace function identitate.cere_verificare_administrator(p_numar_atestat text, p_atestat_cale text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Nu esti autentificat.';
  end if;
  if coalesce(btrim(p_numar_atestat), '') = '' then
    raise exception 'Scrie numarul atestatului.';
  end if;
  if p_atestat_cale is not null and p_atestat_cale not like (auth.uid()::text || '/%') then
    raise exception 'Poza atestatului trebuie sa fie a ta.';
  end if;
  insert into identitate.administratori (profil_id, numar_atestat, atestat_cale, stare)
  values (auth.uid(), btrim(p_numar_atestat), p_atestat_cale, 'in_asteptare')
  on conflict (profil_id) do update
    set numar_atestat = excluded.numar_atestat,
        atestat_cale = coalesce(excluded.atestat_cale, identitate.administratori.atestat_cale)
    where identitate.administratori.stare <> 'aprobat';
end;
$$;
