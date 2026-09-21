-- [K4] situatie_bloc citeste restul din financiar.datorii_rest, ca restul
-- aplicatiei.
--
-- Era a treia implementare a lui "rest" (suma - alocari) si nu primise
-- reparatiile F2/H3: nu scadea corectiile negative ale listei din datoria de
-- intretinere. Dupa o recalculare cu -10% pe iulie, situatie_bloc arata
-- 6.398,46 lei restante, iar datorii_rest 6.091,44: ecranul Bloc al
-- locatarului si Sumarul administratorului contraziceau ecranul Plata.
--
-- Doar sursa restului se schimba; accesul, filtrul pe datoriile scadente si
-- forma raspunsului raman cele din 20260919120017_financiar.sql, singura
-- migratie care a definit functia pana acum.
create or replace function financiar.situatie_bloc(p_bloc_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_bloc_id not in (select private.blocuri_vizibile()) then
    raise exception 'Nu ai acces la acest bloc.';
  end if;
  return (
    with restante as (
      select a.id,
             coalesce((
               select sum(d.rest)
               from financiar.datorii_rest d
               where d.apartament_id = a.id and d.scadenta < current_date
             ), 0) as rest
      from organizare.apartamente a
      where a.bloc_id = p_bloc_id
    )
    select jsonb_build_object(
      'apartamente', count(*),
      'faraRestanta', count(*) filter (where rest <= 0),
      'restanteTotal', coalesce(sum(rest) filter (where rest > 0), 0)
    )
    from restante
  );
end;
$$;
