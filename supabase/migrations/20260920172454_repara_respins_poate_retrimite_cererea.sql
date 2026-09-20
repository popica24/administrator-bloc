-- identitate.cere_verificare_administrator(): un administrator respins care
-- retrimite cererea (numar de atestat corectat, eventual poza noua) ramanea
-- cu stare = 'respins'. "on conflict do update" schimba numarul si atestatul,
-- dar nu atingea coloana stare, asa ca omul nu mai avea nicio cale inainte:
-- fara eroare, dar si fara sa ajunga vreodata inapoi la verificare (S-a
-- descoperit prin [NOU-1] din a-identitate.test.sql).
--
-- Decizia: o cerere retrimisa de cineva neaprobat (in_asteptare sau respins)
-- se intoarce mereu la 'in_asteptare', cu motivul respingerii si data
-- verificarii sterse, ca sa nu mai apara vechiul motiv langa o cerere noua.

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
        atestat_cale = coalesce(excluded.atestat_cale, identitate.administratori.atestat_cale),
        stare = 'in_asteptare',
        motiv_respingere = null,
        verificat_la = null
    where identitate.administratori.stare <> 'aprobat';
end;
$$;
