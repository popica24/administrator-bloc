-- [K8] Recalcularea unei liste aplica intai efectele publicarii, daca ele
-- lipsesc, ca ordinea in care se proceseaza evenimentele sa nu mai conteze.
--
-- Daca ListaRecalculata se procesa inaintea lui ListaPublicata (webhook
-- esuat, `for update skip locked`), datoriile de intretinere ale listei nu
-- existau inca, iar trigger-ul J12 refuza corectia negativa: "O corectie
-- negativa are nevoie de o datorie de intretinere sora". Handler-ul cadea la
-- fiecare reincercare, iar proceseaza_restante renunta dupa 10 incercari:
-- corectiile intregului bloc se pierdeau tacut, cu repartizarile noi pe ecran
-- si sumele vechi in registru.
--
-- financiar.la_lista_publicata este idempotenta (on conflict do nothing),
-- deci se poate rula aici, cu datele evenimentului ListaPublicata al listei,
-- iar cand acesta vine mai tarziu nu mai are nimic de facut.
--
-- Definitia de baza este cea din 20260921073801_repara_k1_corectia_negativa_elibereaza_alocarile.sql;
-- se adauga doar pasul de la inceput.
create or replace function financiar.la_lista_recalculata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista intretinere.liste_lunare;
  v_r record;
begin
  select * into v_lista from intretinere.liste_lunare where id = (p_date ->> 'lista_id')::uuid;

  -- [K8] publicarea intai, daca evenimentul ei n-a fost inca procesat
  if not exists (select 1 from financiar.datorii where lista_id = v_lista.id and tip = 'intretinere') then
    perform financiar.la_lista_publicata(c.date)
      from evenimente.coada c
      where c.tip = 'ListaPublicata' and c.agregat_id = v_lista.id;
  end if;

  for v_r in
    select a.id as apartament_id, a.bloc_id,
           coalesce((select sum(r.suma) from intretinere.repartizari r where r.lista_id = v_lista.id and r.apartament_id = a.id and r.versiune = (p_date ->> 'versiune')::smallint), 0)
           - coalesce((select sum(r.suma) from intretinere.repartizari r where r.lista_id = v_lista.id and r.apartament_id = a.id and r.versiune = (p_date ->> 'versiune_veche')::smallint), 0) as diferenta
    from organizare.apartamente a
    where a.bloc_id = v_lista.bloc_id
  loop
    continue when v_r.diferenta = 0;
    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, lista_id, versiune, suma, scadenta, descriere)
    values (v_r.apartament_id, v_r.bloc_id, 'corectie', v_lista.luna, v_lista.id, (p_date ->> 'versiune')::smallint, v_r.diferenta,
            greatest(v_lista.scadenta, current_date + 15), 'Corectie dupa recalcularea listei')
    on conflict (lista_id, versiune, apartament_id, tip) do nothing;
    if v_r.diferenta < 0 then
      perform financiar.elibereaza_alocari_in_plus(v_r.apartament_id, v_lista.id);
    end if;
    perform financiar.aloca_avansuri(v_r.apartament_id);
  end loop;
end;
$$;
