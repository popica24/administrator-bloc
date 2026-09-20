-- F2: o corectie negativa (facuta de financiar.la_lista_recalculata cand
-- suma noua e mai mica decat cea veche) scadea soldul total al
-- apartamentului (financiar.solduri, deja corect), dar ramanea o datorie
-- separata, cu propriul "rest" negativ, fara sa reduca vreodata restul
-- datoriei initiale de intretinere. Un locatar care platise integral
-- datoria initiala, dupa care lista s-a recalculat in minus, ramanea cu
-- banii "in plus" blocati intr-o corectie negativa pe care nimic nu-i aloca
-- mai departe: suma nu se elibereaza pentru urmatoarea datorie.
--
-- Reparatie: o corectie negativa nu mai apare ca datorie deschisa proprie
-- (restul ei propriu devine 0 in financiar.datorii_rest); in schimb reduce
-- direct restul datoriei de intretinere din aceeasi lista si acelasi
-- apartament. financiar.aloca_plata() foloseste aceeasi regula, ca alocarea
-- reala a platilor sa vada exact restul afisat.

create or replace view financiar.datorii_rest
with (security_invoker = true)
as
select d.*,
  case
    when d.tip = 'corectie' and d.suma < 0 then 0
    else (d.suma - coalesce((select sum(a.suma) from financiar.alocari_plati a where a.datorie_id = d.id), 0))
      + case when d.tip = 'intretinere' then
          coalesce((
            select sum(c.suma - coalesce((select sum(a2.suma) from financiar.alocari_plati a2 where a2.datorie_id = c.id), 0))
            from financiar.datorii c
            where c.tip = 'corectie' and c.suma < 0
              and c.lista_id = d.lista_id and c.apartament_id = d.apartament_id
          ), 0)
        else 0 end
  end as rest
from financiar.datorii d;

comment on view financiar.datorii_rest is
  'Datoriile cu restul neachitat. Restul se calculeaza din alocari, nu se stocheaza. O corectie negativa nu ramane deschisa singura: reduce direct restul datoriei de intretinere din aceeasi lista si acelasi apartament.';

create or replace function financiar.aloca_plata(p_plata_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plata financiar.plati;
  v_ramas numeric(12, 2);
  v_d record;
  v_x numeric(12, 2);
begin
  select * into v_plata from financiar.plati where id = p_plata_id;
  if not found or v_plata.stare <> 'confirmata' then
    return;
  end if;
  v_ramas := v_plata.suma - coalesce((select sum(suma) from financiar.alocari_plati where plata_id = p_plata_id), 0);
  for v_d in
    select d.id,
      case
        when d.tip = 'corectie' and d.suma < 0 then 0
        else (d.suma - coalesce((select sum(a.suma) from financiar.alocari_plati a where a.datorie_id = d.id), 0))
          + case when d.tip = 'intretinere' then
              coalesce((
                select sum(c.suma - coalesce((select sum(a2.suma) from financiar.alocari_plati a2 where a2.datorie_id = c.id), 0))
                from financiar.datorii c
                where c.tip = 'corectie' and c.suma < 0
                  and c.lista_id = d.lista_id and c.apartament_id = d.apartament_id
              ), 0)
            else 0 end
      end as rest
    from financiar.datorii d
    where d.apartament_id = v_plata.apartament_id
    order by d.scadenta, d.creat_la, d.id
  loop
    exit when v_ramas <= 0;
    continue when v_d.rest <= 0;
    v_x := least(v_ramas, v_d.rest);
    insert into financiar.alocari_plati (plata_id, datorie_id, suma)
    values (p_plata_id, v_d.id, v_x)
    on conflict (plata_id, datorie_id) do update set suma = financiar.alocari_plati.suma + excluded.suma;
    v_ramas := v_ramas - v_x;
  end loop;
end;
$$;
