-- financiar.inregistreaza_plata(): verificarea "p_suma <= 0" ruleaza pe suma
-- primita, inainte de round(p_suma, 2). O suma ca 0.004 lei trece testul
-- (0.004 > 0), dar se rotunjeste la 0.00 la insert, si cade pe constrangerea
-- bruta plati_suma_check in loc de mesajul clar "Suma trebuie sa fie mai
-- mare decat zero." ([NOU-2] din b-financiar-plati.test.sql).
--
-- Fix: verificam suma dupa aceeasi rotunjire pe care o foloseste insert-ul,
-- ca respingerea sa vada exact ce vede baza de date.

create or replace function financiar.inregistreaza_plata(
  p_apartament_id uuid,
  p_suma numeric,
  p_metoda text,
  p_la timestamptz default now(),
  p_platita_de uuid default null,
  p_inregistrata_de uuid default null,
  p_procesator text default null,
  p_referinta text default null
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
  if p_suma is null or round(p_suma, 2) <= 0 then
    raise exception 'Suma trebuie sa fie mai mare decat zero.';
  end if;
  insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare, procesator, referinta_procesator, platita_de, inregistrata_de, confirmata_la, creat_la)
  values (p_apartament_id, v_cont.bloc_id, round(p_suma, 2), p_metoda, 'confirmata', p_procesator, p_referinta, p_platita_de, p_inregistrata_de, p_la, p_la)
  returning id into v_id;
  perform financiar.aloca_plata(v_id);
  perform financiar.emite_chitanta(v_id);
  perform evenimente.inregistreaza('PlataConfirmata', 'financiar', p_apartament_id,
    jsonb_build_object('plata_id', v_id, 'apartament_id', p_apartament_id, 'bloc_id', v_cont.bloc_id, 'suma', round(p_suma, 2), 'metoda', p_metoda));
  return v_id;
end;
$$;
