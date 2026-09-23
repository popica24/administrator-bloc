-- [A4] Parola noua inchide sesiunile deschise.
--
-- Administratorul da alta parola cuiva care si-a uitat-o, dar si atunci cand
-- banuieste ca a ajuns pe mana cui nu trebuie. Pana acum, schimbarea parolei
-- nu atingea sesiunile deja deschise: cine avea aplicatia deschisa pe telefon
-- ramanea inauntru, cu tot cu datele apartamentului, zile intregi (tokenul se
-- reimprospateaza singur).
--
-- Functia este a serviciului, chemata de Edge Function-ul cont-locatar dupa ce
-- schimba parola.

create function identitate.inchide_sesiunile(p_profil_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.este_serviciu() then
    raise exception 'Doar serviciul poate inchide sesiunile unui cont.';
  end if;
  delete from auth.sessions where user_id = p_profil_id;
  delete from auth.refresh_tokens where user_id = p_profil_id::text;
end;
$$;

comment on function identitate.inchide_sesiunile(uuid) is
  'Inchide toate sesiunile deschise ale unui cont: dupa o parola noua, cine era inauntru iese (A4).';

revoke all on function identitate.inchide_sesiunile(uuid) from public, anon, authenticated;
grant execute on function identitate.inchide_sesiunile(uuid) to service_role;
