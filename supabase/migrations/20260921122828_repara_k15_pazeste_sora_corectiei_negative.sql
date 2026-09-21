-- [K15] Datoria de intretinere a unei corectii negative nu se sterge si nu
-- se desparte de corectie.
--
-- Trigger-ul J12 (datorii_corectie_are_sora) refuza o corectie negativa fara
-- datoria de intretinere sora, dar pazea doar randul de corectie. Stergerea
-- datoriei-sora sau mutarea ei pe alta lista ori alt apartament refacea
-- exact starea interzisa: o corectie negativa orfana, cu un rest pe care
-- aloca_plata nu il poate inchide niciodata. service_role are DELETE si
-- UPDATE pe financiar.datorii, iar J12 promitea ca registrul nu permite
-- starea asta "indiferent de cine scrie".
--
-- "Sora" inseamna acelasi lucru ca in J12, datorii_rest, aloca_plata si
-- calculeaza_penalizari: aceeasi lista_id, acelasi apartament, tip
-- 'intretinere'. Se refuza doar cand, dupa schimbare, corectia n-ar mai avea
-- nicio sora.
create or replace function financiar.pazeste_sora_corectiei()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.tip = old.tip and new.lista_id is not distinct from old.lista_id and new.apartament_id = old.apartament_id then
    return new;
  end if;
  if exists (
       select 1 from financiar.datorii c
       where c.tip = 'corectie' and c.suma < 0 and c.lista_id = old.lista_id and c.apartament_id = old.apartament_id
     )
     and not exists (
       select 1 from financiar.datorii s
       where s.tip = 'intretinere' and s.lista_id = old.lista_id and s.apartament_id = old.apartament_id and s.id <> old.id
     ) then
    raise exception 'Datoria de intretinere are o corectie negativa pe aceeasi lista; fara ea, corectia ar ramane orfana.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function financiar.pazeste_sora_corectiei() is
  'K15: completeaza J12 pe partea cealalta. Datoria de intretinere a unei corectii negative nu se sterge si nu se muta pe alta lista sau alt apartament, altfel corectia ar ramane orfana.';

revoke execute on function financiar.pazeste_sora_corectiei() from public, anon, authenticated;

create trigger datorii_pazeste_sora_corectiei
  before delete or update of tip, lista_id, apartament_id on financiar.datorii
  for each row
  when (old.tip = 'intretinere')
  execute function financiar.pazeste_sora_corectiei();
