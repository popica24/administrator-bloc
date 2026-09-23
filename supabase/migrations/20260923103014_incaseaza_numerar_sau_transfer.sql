-- Administratorul confirma banii primiti, spunand si cum au venit: in numerar,
-- in mana lui, sau prin transfer in contul asociatiei. Pana acum ecranul putea
-- inregistra doar numerar, asa ca o plata venita prin banca ajungea in registru
-- (si pe chitanta) ca "numerar".
--
-- inregistreaza_plata_numerar(uuid, numeric) este inlocuita de
-- inregistreaza_incasare(uuid, numeric, text), care primeste metoda. Nimic nu
-- se schimba in registru: alocarea pe cea mai veche datorie si chitanta raman
-- ale lui financiar.inregistreaza_plata.

create function financiar.inregistreaza_incasare(p_apartament_id uuid, p_suma numeric, p_metoda text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_apartament_id not in (select private.apartamente_administrate()) then
    raise exception 'Doar administratorul blocului inregistreaza incasari.';
  end if;
  if p_metoda is null or p_metoda not in ('numerar', 'transfer') then
    raise exception 'Banii primiti sunt fie in numerar, fie prin transfer bancar.';
  end if;
  return financiar.inregistreaza_plata(p_apartament_id, p_suma, p_metoda, now(), null, auth.uid());
end;
$$;

comment on function financiar.inregistreaza_incasare(uuid, numeric, text) is
  'Administratorul confirma banii primiti de la un apartament, in numerar sau prin transfer bancar: plata intra in registru, se aloca pe cea mai veche datorie si primeste chitanta.';

revoke all on function financiar.inregistreaza_incasare(uuid, numeric, text) from public, anon;
grant execute on function financiar.inregistreaza_incasare(uuid, numeric, text) to authenticated, service_role;

drop function financiar.inregistreaza_plata_numerar(uuid, numeric);
