-- [K10] Vederea anonima a sesizarilor blocului (sesizari.sesizari_bloc)
-- intorcea si descrierea libera, iar formularul cere "etajul, locul exact":
-- suficient ca autorul sa fie recunoscut chiar fara nume sau numar de
-- apartament. Decizie de produs, varianta conservatoare: scoatem descrierea
-- din vederea anonima si pastram doar titlul, categoria si starea. (Cealalta
-- varianta din audit — un avertisment in formular despre ce vad ceilalti —
-- ramane de facut in AdminBloc.jsx, in afara ariei acestei reparatii.)

drop function sesizari.sesizari_bloc(uuid);

create function sesizari.sesizari_bloc(p_bloc_id uuid)
returns table (id uuid, titlu text, categorie text, stare text, creat_la timestamptz, preluata_la timestamptz, rezolvata_la timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_bloc_id not in (select private.blocuri_vizibile()) then
    raise exception 'Nu ai acces la acest bloc.';
  end if;
  return query
  select s.id, s.titlu, s.categorie, s.stare, s.creat_la, s.preluata_la, s.rezolvata_la
  from sesizari.sesizari s
  where s.bloc_id = p_bloc_id
    and s.apartament_id not in (select private.apartamentele_mele())
    and (s.stare <> 'rezolvata' or s.rezolvata_la > now() - interval '30 days')
  order by s.creat_la desc;
end;
$$;

revoke execute on function sesizari.sesizari_bloc(uuid) from public, anon, authenticated;
grant execute on function sesizari.sesizari_bloc(uuid) to authenticated, service_role;
