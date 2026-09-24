-- [B5] Plata inregistrata cu data ei nu lasa in urma penalizarea zilelor in
-- care banii erau deja la asociatie.
--
-- Migratia dinainte a lasat administratorul sa scrie ziua din extrasul de cont
-- (banii intra pe 20, el confirma pe 2). Jobul de penalizari ruleaza insa pe 1
-- ale lunii si taxeaza toate zilele pana atunci, deci penalizarea includea si
-- zilele de dupa 20, cand datoria era deja acoperita.
--
-- Decizia este cea de la K7, cu aceeasi unealta (un rand "anulare_penalizare",
-- vizibil locatarului): penalizarea se recalculeaza cu parametrii ei inghetati,
-- cu zilele impartite in doua -- cele dinainte de plata, pe restul de atunci,
-- si cele de dupa, pe restul ramas dupa plata. Doar in jos: o plata nu poate
-- mari niciodata o penalizare.
--
-- Exemplu (0,2% pe zi): datorie 1000 de lei, scadenta acum 40 de zile,
-- penalizare calculata acum 10 zile pe 30 de zile de intarziere = 60 de lei.
-- Plata de 1000 a intrat acum 20 de zile, deci 20 de zile raman taxate si 10
-- nu: penalizarea corecta este 40, iar in registru intra o anulare de -20.

create function financiar.anuleaza_penalizari_dupa_plata(p_plata_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plata financiar.plati;
  v_data date;
  v_azi date := (now() at time zone 'Europe/Bucharest')::date;
  v_p record;
  v_start date;
  v_zile_dupa integer;
  v_zile_inainte integer;
  v_baza_dupa numeric(12, 2);
  v_tinta numeric(12, 2);
  v_acum numeric(12, 2);
begin
  select * into v_plata from financiar.plati where id = p_plata_id;
  if not found or v_plata.stare <> 'confirmata' then
    return;
  end if;
  v_data := (v_plata.confirmata_la at time zone 'Europe/Bucharest')::date;
  -- o plata de azi nu are ce indrepta: banii chiar au lipsit pana azi
  if v_data >= v_azi then
    return;
  end if;

  for v_p in
    -- materialized: bucla schimba alocarile, iar randurile alese trebuie sa
    -- ramana cele de la inceput
    with alese as materialized (
      select p.id, p.datorie_id, p.datorie_sursa_id, p.luna_calcul, p.rest_neachitat,
             p.zile_taxate, p.procent_zi, p.suma, d.luna as luna_penalizare, a.suma as acoperit
        from financiar.penalizari p
        join financiar.datorii d on d.id = p.datorie_id
        join financiar.alocari_plati a on a.plata_id = p_plata_id and a.datorie_id = p.datorie_sursa_id
       where p.luna_calcul > v_data
    )
    select * from alese order by luna_calcul, id
  loop
    v_start := v_p.luna_calcul - v_p.zile_taxate;
    v_zile_dupa := greatest(v_p.luna_calcul - greatest(v_data, v_start), 0);
    v_zile_inainte := v_p.zile_taxate - v_zile_dupa;
    v_baza_dupa := greatest(v_p.rest_neachitat - v_p.acoperit, 0);
    v_tinta := least(
      v_p.suma,
      round(v_p.rest_neachitat * v_p.procent_zi / 100 * v_zile_inainte, 2)
        + round(v_baza_dupa * v_p.procent_zi / 100 * v_zile_dupa, 2));
    v_acum := v_p.suma + coalesce((
      select sum(x.suma) from financiar.datorii x
      where x.tip = 'anulare_penalizare' and x.anuleaza_datorie_id = v_p.datorie_id
    ), 0);
    continue when v_tinta >= v_acum;

    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere, anuleaza_datorie_id)
    values (v_plata.apartament_id, v_plata.bloc_id, 'anulare_penalizare', v_p.luna_penalizare, v_tinta - v_acum,
            current_date, 'Penalizare anulata: banii intrasera deja in cont', v_p.datorie_id);
    perform financiar.elibereaza_alocari_datoriei(v_p.datorie_id);
  end loop;

  perform financiar.aloca_avansuri(v_plata.apartament_id);
end;
$$;

comment on function financiar.anuleaza_penalizari_dupa_plata(uuid) is
  'B5: dupa o plata inregistrata cu o data din trecut, reduce penalizarile calculate intre timp la zilele in care banii chiar lipseau. Doar in jos.';

revoke execute on function financiar.anuleaza_penalizari_dupa_plata(uuid) from public, anon, authenticated;

-- inregistreaza_plata: indreptarea se face inainte de chitanta, ca documentul
-- sa inghete starea finala (B6)
create or replace function financiar.inregistreaza_plata(
  p_apartament_id uuid,
  p_suma numeric,
  p_metoda text,
  p_la timestamptz default now(),
  p_platita_de uuid default null,
  p_inregistrata_de uuid default null,
  p_cheie_client uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cont financiar.conturi;
  v_id uuid;
begin
  select * into v_cont from financiar.conturi where apartament_id = p_apartament_id for update;
  if not found then
    raise exception 'Apartamentul nu are cont.';
  end if;
  -- Verificarea merge pe suma rotunjita la ban (migratia
  -- repara_plata_suma_rotunjita_la_zero): 0,004 lei ar deveni o plata de 0 lei.
  if p_suma is null or round(p_suma, 2) <= 0 then
    raise exception 'Suma trebuie sa fie mai mare decat zero.';
  end if;
  insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare, platita_de, inregistrata_de, confirmata_la, creat_la, cheie_client)
  values (p_apartament_id, v_cont.bloc_id, round(p_suma, 2), p_metoda, 'confirmata', p_platita_de, p_inregistrata_de, p_la, p_la, p_cheie_client)
  returning id into v_id;
  perform financiar.aloca_plata(v_id);
  -- [B5] plata cu data din trecut: penalizarile zilelor in care banii erau
  -- deja la asociatie se anuleaza inainte de emiterea chitantei
  perform financiar.anuleaza_penalizari_dupa_plata(v_id);
  perform financiar.emite_chitanta(v_id);
  perform evenimente.inregistreaza('PlataConfirmata', 'financiar', p_apartament_id,
    jsonb_build_object('plata_id', v_id, 'apartament_id', p_apartament_id, 'bloc_id', v_cont.bloc_id, 'suma', round(p_suma, 2), 'metoda', p_metoda));
  return v_id;
end;
$$;
