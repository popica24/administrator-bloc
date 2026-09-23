-- Plata cu cardul iese din produs (decizie, 23 septembrie): banii ajung la
-- asociatie in numerar, in mana administratorului, sau prin transfer bancar,
-- iar administratorul confirma incasarea in aplicatie
-- (financiar.inregistreaza_incasare). Nu mai exista procesator de plati, deci
-- nu mai are cine sa creeze o plata "in asteptare" si cine sa o confirme
-- printr-un webhook.
--
-- Registrul nu pierde nimic: nicio plata nu a fost facuta cu cardul (in
-- productie tabela e goala). Daca ar fi existat, migratia ar fi cazut la
-- constrangerea de metoda, nu ar fi schimbat tacut istoria.

drop function financiar.confirma_plata_card(text, text, boolean);
drop function financiar.creeaza_plata_card(uuid, numeric, uuid, text, text);

-- inregistreaza_plata ramane fara parametrii procesatorului
drop function financiar.inregistreaza_plata(uuid, numeric, text, timestamptz, uuid, uuid, text, text);

create function financiar.inregistreaza_plata(
  p_apartament_id uuid,
  p_suma numeric,
  p_metoda text,
  p_la timestamptz default now(),
  p_platita_de uuid default null,
  p_inregistrata_de uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cont financiar.conturi;
  v_id uuid;
begin
  select * into v_cont from financiar.conturi where apartament_id = p_apartament_id for update;
  if not found then
    raise exception 'Apartamentul nu are cont.';
  end if;
  -- Verificarea merge pe suma rotunjita la ban (migratia
  -- repara_plata_suma_rotunjita_la_zero): 0,004 lei ar deveni o plata de 0 lei.
  if p_suma is null or round(p_suma, 2) <= 0 then
    raise exception 'Suma trebuie sa fie mai mare decat zero.';
  end if;
  insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare, platita_de, inregistrata_de, confirmata_la, creat_la)
  values (p_apartament_id, v_cont.bloc_id, round(p_suma, 2), p_metoda, 'confirmata', p_platita_de, p_inregistrata_de, p_la, p_la)
  returning id into v_id;
  perform financiar.aloca_plata(v_id);
  perform financiar.emite_chitanta(v_id);
  perform evenimente.inregistreaza('PlataConfirmata', 'financiar', p_apartament_id,
    jsonb_build_object('plata_id', v_id, 'apartament_id', p_apartament_id, 'bloc_id', v_cont.bloc_id, 'suma', round(p_suma, 2), 'metoda', p_metoda));
  return v_id;
end;
$$;

comment on function financiar.inregistreaza_plata(uuid, numeric, text, timestamptz, uuid, uuid) is
  'O plata confirmata, intr-o singura tranzactie: lock pe cont, plata, alocarea pe cea mai veche datorie, chitanta si evenimentul PlataConfirmata.';

revoke all on function financiar.inregistreaza_plata(uuid, numeric, text, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function financiar.inregistreaza_plata(uuid, numeric, text, timestamptz, uuid, uuid) to service_role;

-- Tabela plati: fara urmele procesatorului si fara starile lui
alter table financiar.plati
  drop constraint plati_procesator_referinta_key,
  drop column procesator,
  drop column referinta_procesator,
  drop constraint plati_metoda_check,
  add constraint plati_metoda_check check (metoda in ('numerar', 'transfer')),
  drop constraint plati_stare_check,
  add constraint plati_stare_check check (stare in ('confirmata', 'rambursata'));

comment on table financiar.plati is
  'Banii primiti de asociatie, in numerar sau prin transfer bancar, confirmati de administrator. In sold intra doar platile confirmate.';
