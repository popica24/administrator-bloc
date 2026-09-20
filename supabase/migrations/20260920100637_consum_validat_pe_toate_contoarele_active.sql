-- L5: contorizare.consum_validat() cerea o singura citire validata pe
-- apartament si tip de apa, nu cate una pentru fiecare contor activ. Un
-- apartament cu doua contoare de apa rece (de exemplu bucatarie si baie),
-- cu un singur contor validat, aparea in consumul lunii cu jumatate din apa
-- consumata: motorul de repartizare l-ar factura pe jumatate.
--
-- Reparatie: un apartament intra in consumul validat al unui tip de apa doar
-- cand numarul de citiri validate pe luna acopera toate contoarele lui
-- active de acel tip. Pana atunci apartamentul lipseste din 'consum' pentru
-- tipul respectiv (ca si cum n-ar fi transmis inca), exact ca înainte cand
-- avea un singur contor netransmis.

create or replace function contorizare.consum_validat(p_bloc_id uuid, p_luna date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with valide as (
    select x.apartament_id, x.tip, sum(x.consum) as mc, count(*) as nr_validate
    from contorizare.citiri x
    where x.bloc_id = p_bloc_id and x.luna = p_luna and x.stare = 'validata' and x.sursa <> 'pornire'
    group by x.apartament_id, x.tip
  ),
  active as (
    select c.apartament_id, c.tip, count(*) as nr_active
    from contorizare.contoare c
    where c.bloc_id = p_bloc_id and c.scos_la is null
    group by c.apartament_id, c.tip
  ),
  complete as (
    select v.apartament_id, v.tip, v.mc
    from valide v
    join active a
      on a.apartament_id is not distinct from v.apartament_id and a.tip = v.tip
    where v.nr_validate >= a.nr_active
  ),
  pe_apartament as (
    select c.apartament_id, jsonb_object_agg(c.tip, c.mc) as tipuri
    from complete c
    where c.apartament_id is not null
    group by c.apartament_id
  )
  select jsonb_build_object(
    'consum', coalesce((select jsonb_object_agg(pa.apartament_id::text, pa.tipuri) from pe_apartament pa), '{}'::jsonb),
    'contorGeneral', coalesce((select jsonb_object_agg(c.tip, c.mc) from complete c where c.apartament_id is null), '{}'::jsonb)
  );
$$;
