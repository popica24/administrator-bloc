-- Repara R2: motorul de repartizare desparte egalitatile de rest dupa numarul
-- apartamentului (text, comparat numeric), nu dupa id. Id-ul nu inseamna
-- acelasi lucru in cele doua surse ale aplicatiei (UUID in Supabase,
-- "ap-1", "ap-2", ... in sursa demonstrativa), deci acelasi bloc calculat de
-- surse diferite impartea centimetrul ramas la apartamente diferite.
-- intretinere.date_pentru_motor trebuie asadar sa trimita si numarul
-- apartamentului, nu doar id-ul, persoanele, cota si scutirea de lift.
create or replace function intretinere.date_pentru_motor(p_lista_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lista intretinere.liste_lunare;
  v_consum jsonb;
begin
  select * into v_lista from intretinere.liste_lunare where id = p_lista_id;
  if not found then
    raise exception 'Lista nu exista.';
  end if;
  if v_lista.bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul blocului poate calcula lista.';
  end if;
  v_consum := contorizare.consum_validat(v_lista.bloc_id, v_lista.luna);
  return jsonb_build_object(
    'lista', jsonb_build_object('id', v_lista.id, 'bloc_id', v_lista.bloc_id, 'luna', v_lista.luna, 'stare', v_lista.stare, 'versiune', v_lista.versiune),
    'apartamente', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'numar', a.numar, 'persoane', p.persoane, 'cota', a.cota_indiviza, 'scutitLift', a.scutit_lift) order by a.numar)
      from organizare.apartamente a
      join organizare.persoane_pe_luna(v_lista.bloc_id, v_lista.luna) p on p.apartament_id = a.id
      where a.bloc_id = v_lista.bloc_id
    ), '[]'::jsonb),
    'cheltuieli', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'cod', c.cod, 'suma', c.suma, 'metoda', c.metoda, 'tipApa', c.tip_apa) order by c.cod)
      from intretinere.cheltuieli c where c.lista_id = p_lista_id
    ), '[]'::jsonb),
    'consum', v_consum -> 'consum',
    'contorGeneral', v_consum -> 'contorGeneral'
  );
end;
$$;

comment on function intretinere.date_pentru_motor(uuid) is
  'Datele de intrare ale motorului de repartizare (calculeazaLista), inclusiv numarul apartamentului: motorul il foloseste ca sa desparta egalitatile de rest la fel in orice sursa (R2).';
