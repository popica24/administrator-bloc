-- H5: comunicare.protejeaza_documentul() paza cale si vizibil_locatarilor,
-- dar nu si bloc_id/asociatie_id. RLS pe update verifica doar ca
-- asociatie_id noua e printre asociatiile administrate, nu ca bloc_id
-- ramane acelasi bloc, si nici ca asociatie_id ramane aceeasi asociatie
-- cand administratorul conduce mai multe. Un singur update putea muta un
-- document deja vazut de locatari (vizibil_locatarilor ramas true) in alt
-- bloc (sau la nivel de asociatie intreaga, cu bloc_id = null), scotandu-l
-- din vederea locatarilor care il vazusera, fara ca vreun semn sa arate
-- schimbarea.
--
-- Reparatie: bloc_id si asociatie_id devin imutabile dupa incarcare, la fel
-- ca cale.

create or replace function comunicare.protejeaza_documentul()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cale <> old.cale then
    raise exception 'Calea documentului nu se poate schimba dupa incarcare.';
  end if;
  if new.asociatie_id <> old.asociatie_id then
    raise exception 'Asociatia documentului nu se poate schimba dupa incarcare.';
  end if;
  if new.bloc_id is distinct from old.bloc_id then
    raise exception 'Blocul documentului nu se poate schimba dupa incarcare.';
  end if;
  if old.vizibil_locatarilor and not new.vizibil_locatarilor then
    raise exception 'Un document vazut de locatari nu se mai poate ascunde.';
  end if;
  return new;
end;
$$;
