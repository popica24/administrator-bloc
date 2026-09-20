-- A6: contorizare.estimeaza_citiri() nu verifica ziua limita a citirilor
-- (setari_contorizare.zi_limita_citire) si putea estima consumul unei luni
-- inainte ca termenul acelei luni sa fi trecut, blocand un locatar care mai
-- putea inca sa transmita indexul la timp. Textul din aplicatie promite deja
-- "Dupa termen" pentru butonul de estimare; backendul nu verifica nimic.

create or replace function contorizare.estimeaza_citiri(p_bloc_id uuid, p_luna date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contor contorizare.contoare;
  v_medie numeric;
  v_anterior numeric;
  v_n integer := 0;
  v_zi_limita smallint;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul blocului estimeaza citirile.';
  end if;
  select coalesce(zi_limita_citire, 25) into v_zi_limita
    from contorizare.setari_contorizare where bloc_id = p_bloc_id;
  if current_date < (p_luna + (coalesce(v_zi_limita, 25) - 1) * interval '1 day')::date then
    raise exception 'Poti estima citirile lunii % abia dupa ziua % a lunii.', p_luna, coalesce(v_zi_limita, 25);
  end if;
  for v_contor in
    select * from contorizare.contoare c
    where c.bloc_id = p_bloc_id and c.apartament_id is not null and c.scos_la is null
      and not exists (select 1 from contorizare.citiri x where x.contor_id = c.id and x.luna = p_luna and x.stare <> 'respinsa')
  loop
    select coalesce(round(avg(consum), 3), 0) into v_medie
    from (
      select x.consum from contorizare.citiri x
      where x.contor_id = v_contor.id and x.luna < p_luna and x.stare = 'validata' and x.sursa <> 'pornire'
      order by x.luna desc limit 3
    ) ultimele;
    v_anterior := contorizare.index_anterior(v_contor.id, p_luna);
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare, verificata_de, verificata_la)
    values (v_contor.id, v_contor.tip, v_contor.bloc_id, v_contor.apartament_id, p_luna, v_anterior, v_anterior + v_medie, 'estimat', 'validata', auth.uid(), now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
