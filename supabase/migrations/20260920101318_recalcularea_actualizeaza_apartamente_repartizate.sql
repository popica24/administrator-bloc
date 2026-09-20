-- L9: recalcularea unei liste publicate (p_recalculare = true) actualiza
-- versiune si total_repartizat, dar nu si apartamente_repartizate. Cand un
-- apartament nou intra in bloc dupa publicare si lista se recalculeaza pe
-- toate apartamentele, coloana ramanea cu numarul vechi, dinaintea noului
-- vecin.

create or replace function intretinere.salveaza_lista_publicata(
  p_lista_id uuid,
  p_rezultat jsonb,
  p_publicata_de uuid default null,
  p_recalculare boolean default false,
  p_publicata_la timestamptz default now()
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista intretinere.liste_lunare;
  v_bloc organizare.blocuri;
  v_versiune smallint;
  v_nr_apartamente integer;
  v_gresita record;
  v_total numeric(12, 2);
  v_scadenta date;
  v_zi smallint;
begin
  select * into v_lista from intretinere.liste_lunare where id = p_lista_id for update;
  if not found then
    raise exception 'Lista nu exista.';
  end if;
  select * into v_bloc from organizare.blocuri where id = v_lista.bloc_id;
  if v_bloc.stare <> 'activ' then
    raise exception 'Blocul este inca in configurare. Lista se poate publica dupa activarea blocului.';
  end if;
  if p_recalculare then
    if v_lista.stare <> 'publicata' then
      raise exception 'Doar o lista publicata se recalculeaza.';
    end if;
    v_versiune := v_lista.versiune + 1;
  else
    if v_lista.stare <> 'ciorna' then
      raise exception 'Lista este deja publicata.';
    end if;
    v_versiune := v_lista.versiune;
  end if;
  if not exists (select 1 from intretinere.cheltuieli where lista_id = p_lista_id) then
    raise exception 'Lista nu are nicio cheltuiala.';
  end if;

  -- Randurile rezultatului, citite prin intretinere.randuri_rezultat(p_rezultat).

  -- Fiecare cheltuiala a listei, impartita exact, pe toate apartamentele blocului.
  select count(*) into v_nr_apartamente from organizare.apartamente where bloc_id = v_lista.bloc_id;
  for v_gresita in
    select c.cod, c.suma, coalesce(sum(t.suma), 0) as repartizat, count(t.apartament_id) as randuri
    from intretinere.cheltuieli c
    left join intretinere.randuri_rezultat(p_rezultat) t on t.cheltuiala_id = c.id
    where c.lista_id = p_lista_id
    group by c.id, c.cod, c.suma
    having coalesce(sum(t.suma), 0) <> c.suma or count(t.apartament_id) <> v_nr_apartamente
  loop
    raise exception 'Cheltuiala % nu este impartita corect: % lei din %, pe % apartamente din %.',
      v_gresita.cod, v_gresita.repartizat, v_gresita.suma, v_gresita.randuri, v_nr_apartamente;
  end loop;
  if exists (
    select 1 from intretinere.randuri_rezultat(p_rezultat) t
    where not exists (select 1 from intretinere.cheltuieli c where c.id = t.cheltuiala_id and c.lista_id = p_lista_id)
       or not exists (select 1 from organizare.apartamente a where a.id = t.apartament_id and a.bloc_id = v_lista.bloc_id)
  ) then
    raise exception 'Rezultatul contine randuri care nu apartin acestei liste.';
  end if;

  insert into intretinere.repartizari (cheltuiala_id, lista_id, versiune, apartament_id, bloc_id, suma, baza_valoare, baza_total, unitate, rotunjire, detaliu)
  select t.cheltuiala_id, p_lista_id, v_versiune, t.apartament_id, v_lista.bloc_id, t.suma, t.baza_valoare, t.baza_total, t.unitate, t.rotunjire, t.detaliu
  from intretinere.randuri_rezultat(p_rezultat) t;

  select coalesce(sum(t.suma), 0) into v_total from intretinere.randuri_rezultat(p_rezultat) t;

  if p_recalculare then
    update intretinere.liste_lunare
       set versiune = v_versiune, total_repartizat = v_total, apartamente_repartizate = v_nr_apartamente
     where id = p_lista_id;
    return evenimente.inregistreaza('ListaRecalculata', 'intretinere', p_lista_id,
      jsonb_build_object('lista_id', p_lista_id, 'bloc_id', v_lista.bloc_id, 'luna', v_lista.luna,
                         'versiune_veche', v_lista.versiune, 'versiune', v_versiune));
  end if;

  select zi_scadenta into v_zi from financiar.setari_financiare where asociatie_id = v_bloc.asociatie_id;
  v_scadenta := coalesce(v_lista.scadenta, (v_lista.luna + interval '1 month')::date + (coalesce(v_zi, 25) - 1));

  update intretinere.liste_lunare
     set stare = 'publicata',
         publicata_la = p_publicata_la,
         publicata_de = p_publicata_de,
         scadenta = v_scadenta,
         total_repartizat = v_total,
         apartamente_repartizate = v_nr_apartamente
   where id = p_lista_id;

  return evenimente.inregistreaza('ListaPublicata', 'intretinere', p_lista_id,
    jsonb_build_object('lista_id', p_lista_id, 'bloc_id', v_lista.bloc_id, 'asociatie_id', v_bloc.asociatie_id,
                       'luna', v_lista.luna, 'versiune', v_versiune, 'scadenta', v_scadenta));
end;
$$;
