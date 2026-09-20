-- A11: cand fisa de inrolare nu avea niciun index de pornire (nici rece, nici
-- calda), contorizare.la_apartament_creat() sarea peste amandoua tipurile si
-- apartamentul ramanea fara niciun contor. Apa rece se repartizeaza pe toate
-- apartamentele active ale blocului (contorul general minus suma contoarelor,
-- impartita pe persoane); un apartament fara contor de apa rece nu poate
-- intra in acel calcul, deci orice lista lunara viitoare a blocului ramane
-- blocata.
--
-- Reparatie: contorul de apa rece se creeaza intotdeauna la inrolare, chiar
-- fara index transmis (index de pornire 0, de corectat ulterior de
-- administrator). Apa calda ramane optionala: fara index_calda nu se
-- creeaza contor cald, pentru ca nu toate apartamentele au incalzire
-- centralizata.

create or replace function contorizare.la_apartament_creat(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tip text;
  v_index numeric;
  v_contor uuid;
begin
  foreach v_tip in array array['rece', 'calda'] loop
    v_index := (p_date ->> ('index_' || v_tip))::numeric;
    continue when v_index is null and v_tip <> 'rece';
    v_index := coalesce(v_index, 0);
    select id into v_contor from contorizare.contoare
      where apartament_id = (p_date ->> 'apartament_id')::uuid and tip = v_tip and scos_la is null;
    if v_contor is null then
      insert into contorizare.contoare (bloc_id, apartament_id, tip, serie, amplasare)
      values ((p_date ->> 'bloc_id')::uuid, (p_date ->> 'apartament_id')::uuid, v_tip, p_date ->> ('serie_' || v_tip), 'baie')
      returning id into v_contor;
    end if;
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare, document_id)
    values (v_contor, v_tip, (p_date ->> 'bloc_id')::uuid, (p_date ->> 'apartament_id')::uuid,
            (p_date ->> 'luna')::date, v_index, v_index, 'pornire', 'validata', (p_date ->> 'document_id')::uuid)
    on conflict do nothing;
    v_contor := null;
  end loop;
end;
$$;
