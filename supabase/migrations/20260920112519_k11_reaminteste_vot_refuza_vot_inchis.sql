-- [K11] reaminteste_vot accepta un vot deja inchis: nu are sens sa
-- "reamintesti" ceva ce nu se mai poate schimba, si nici nu are limita cate
-- reamintiri se pot trimite.

create or replace function guvernanta.reaminteste_vot(p_vot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vot guvernanta.voturi;
  v_apartamente uuid[];
  v_destinatari integer;
begin
  select * into v_vot from guvernanta.voturi where id = p_vot_id;
  if not found or v_vot.asociatie_id not in (select private.asociatii_administrate()) then
    raise exception 'Votul nu exista.';
  end if;
  if now() >= v_vot.inchide_la then
    raise exception 'Votul s-a inchis. Nu se mai pot trimite reamintiri.';
  end if;
  select coalesce(array_agg(a.id), '{}') into v_apartamente
  from organizare.apartamente a join organizare.blocuri b on b.id = a.bloc_id
  where b.asociatie_id = v_vot.asociatie_id
    and not exists (select 1 from guvernanta.voturi_exprimate e where e.vot_id = p_vot_id and e.apartament_id = a.id);
  select count(*) into v_destinatari from identitate.locatari l
  where l.apartament_id = any (v_apartamente) and l.activ_din <= current_date and (l.activ_pana is null or l.activ_pana > current_date);
  perform evenimente.inregistreaza('VotReamintit', 'guvernanta', p_vot_id,
    jsonb_build_object('vot_id', p_vot_id, 'asociatie_id', v_vot.asociatie_id, 'titlu', v_vot.titlu, 'apartamente', to_jsonb(v_apartamente)));
  return jsonb_build_object('apartamente', coalesce(array_length(v_apartamente, 1), 0), 'destinatari', v_destinatari);
end;
$$;
