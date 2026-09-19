-- Plafonul penalizarilor (audit F1, F7).
--
-- Legea 196/2018: penalitatile nu pot depasi suma la care s-au aplicat.
-- Calculul lunar plafona fiecare penalizare la restul neachitat din acel
-- moment, dar nu si totalul lor: in 24 de luni, o restanta de 967 lei a strans
-- 1427 lei penalizari. Acum fiecare penalizare noua se opreste la ce a ramas
-- din plafon: suma datoriei minus penalizarile deja calculate pe ea.
--
-- Tot aici, contul apartamentului se blocheaza inainte de a citi restul (F7),
-- ca o plata confirmata in acelasi moment sa nu lase o penalizare calculata
-- pe un rest vechi.

create or replace function financiar.calculeaza_penalizari(p_la date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d record;
  v_inceput date;
  v_ultim date;
  v_dela date;
  v_zile integer;
  v_rest numeric(12, 2);
  v_plafon numeric(12, 2);
  v_suma numeric(12, 2);
  v_pen uuid;
  v_n integer := 0;
begin
  for v_d in
    select d.*, s.procent_penalizare_zi, s.zile_gratie
    from financiar.datorii d
    join organizare.blocuri b on b.id = d.bloc_id
    join financiar.setari_financiare s on s.asociatie_id = b.asociatie_id
    where d.tip <> 'penalizare' and d.suma > 0 and d.scadenta < p_la
    order by d.apartament_id, d.scadenta, d.creat_la
  loop
    continue when exists (select 1 from financiar.penalizari where datorie_sursa_id = v_d.id and luna_calcul = p_la);
    v_inceput := v_d.scadenta + v_d.zile_gratie;
    select max(luna_calcul) into v_ultim from financiar.penalizari where datorie_sursa_id = v_d.id;
    v_dela := greatest(v_inceput, coalesce(v_ultim, v_inceput));
    v_zile := p_la - v_dela;
    continue when v_zile <= 0;

    perform 1 from financiar.conturi where apartament_id = v_d.apartament_id for update;
    v_rest := v_d.suma - coalesce((select sum(a.suma) from financiar.alocari_plati a where a.datorie_id = v_d.id), 0);
    continue when v_rest <= 0;
    v_plafon := v_d.suma - coalesce((select sum(p.suma) from financiar.penalizari p where p.datorie_sursa_id = v_d.id), 0);
    v_suma := least(v_rest, v_plafon, round(v_rest * v_d.procent_penalizare_zi / 100 * v_zile, 2));
    continue when v_suma <= 0;

    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
    values (v_d.apartament_id, v_d.bloc_id, 'penalizare', date_trunc('month', p_la)::date, v_suma, p_la,
            'Penalizare pentru ' || lower(v_d.descriere))
    returning id into v_pen;
    insert into financiar.penalizari (datorie_sursa_id, datorie_id, luna_calcul, rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma)
    values (v_d.id, v_pen, p_la, v_rest, p_la - v_d.scadenta, v_d.zile_gratie, v_zile, v_d.procent_penalizare_zi, v_suma);
    perform financiar.aloca_avansuri(v_d.apartament_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
