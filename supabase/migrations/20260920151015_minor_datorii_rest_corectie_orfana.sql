-- [minor] financiar.datorii_rest (si financiar.aloca_plata, care repeta
-- aceeasi expresie) zeroeste restul unei corectii negative neconditionat,
-- chiar si cand nu exista nicio datorie de intretinere sora pe aceeasi
-- lista si acelasi apartament care sa primeasca reducerea (de exemplu o
-- corectie facuta manual, fara lista_id). Suma corectiei disparea din
-- Sigma(rest), desi financiar.solduri (calculat independent, suma
-- datoriilor minus platile) o scadea in continuare din sold: Sigma(rest)
-- ajungea diferit de sold.
--
-- Reparatie: restul propriu al unei corectii negative devine 0 doar cand
-- exista o datorie de intretinere sora (cea care primeste reducerea).
-- Fara sora, corectia ramane cu propriul ei rest (negativ), ca suma ei sa
-- se regaseasca in Sigma(rest).

create or replace view financiar.datorii_rest
with (security_invoker = true)
as
select d.*,
  case
    when d.tip = 'corectie' and d.suma < 0 and exists (
      select 1 from financiar.datorii s
      where s.tip = 'intretinere' and s.lista_id = d.lista_id and s.apartament_id = d.apartament_id
    ) then 0
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
  'Datoriile cu restul neachitat. Restul se calculeaza din alocari, nu se stocheaza. O corectie negativa cu o datorie de intretinere sora (aceeasi lista, acelasi apartament) nu ramane deschisa singura: reduce direct restul acelei datorii. Fara sora, corectia isi pastreaza propriul rest, ca suma sa nu dispara din Sigma(rest).';

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
        when d.tip = 'corectie' and d.suma < 0 and exists (
          select 1 from financiar.datorii s
          where s.tip = 'intretinere' and s.lista_id = d.lista_id and s.apartament_id = d.apartament_id
        ) then 0
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
