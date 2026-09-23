-- [B6] Chitanta isi ingheata randurile la emitere.
--
-- Chitanta are serie si numar, fara goluri, si este documentul pe care omul il
-- pune la dosar. Continutul ei, insa, se construia de fiecare data din
-- alocarile de azi ale platii. O recalculare a listei elibereaza alocari
-- (K1/K7) si le pune pe altele, deci aceeasi chitanta, cu acelasi numar,
-- descarcata a doua zi, spunea altceva:
--
--   emisa:  "Intretinere august: 300,00 / Penalizare august: 30,00"
--   maine:  "Intretinere august: 200,00 / Penalizare august: 20,00 / Avans: 110,00"
--
-- In cazul in care toate alocarile se eliberau, o chitanta de 330 de lei
-- numerar ajungea sa scrie "Avans pentru listele urmatoare".
--
-- Acum randurile se scriu o data, la emitere, si raman asa. Ce se intampla
-- dupa aceea cu banii (realocari, avans) se vede in registru si pe ecranul
-- "Platile mele", nu pe document.

alter table financiar.chitante add column randuri jsonb not null default '[]'::jsonb;

comment on column financiar.chitante.randuri is
  'Ce a acoperit plata in momentul emiterii, inghetat: [{tip, luna, descriere, suma}]. Nu se mai schimba dupa aceea (B6).';

create or replace function financiar.emite_chitanta(p_plata_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plata financiar.plati;
  v_asociatie uuid;
  v_serie text;
  v_numar integer;
  v_id uuid;
  v_randuri jsonb;
  v_avans numeric(12, 2);
begin
  select id into v_id from financiar.chitante where plata_id = p_plata_id;
  if found then
    return v_id;
  end if;
  select * into v_plata from financiar.plati where id = p_plata_id;
  select asociatie_id into v_asociatie from organizare.blocuri where id = v_plata.bloc_id;
  update financiar.setari_financiare
     set chitanta_ultimul_numar = chitanta_ultimul_numar + 1
   where asociatie_id = v_asociatie
  returning chitanta_serie, chitanta_ultimul_numar into v_serie, v_numar;
  if v_serie is null then
    raise exception 'Asociatia nu are setarile financiare completate.';
  end if;

  -- [B6] ce acopera plata acum, in ordinea in care s-a alocat
  select coalesce(jsonb_agg(
           jsonb_build_object('tip', d.tip, 'luna', d.luna, 'descriere', d.descriere, 'suma', a.suma)
           order by d.scadenta, d.creat_la, d.id), '[]'::jsonb)
    into v_randuri
  from financiar.alocari_plati a
  join financiar.datorii d on d.id = a.datorie_id
  where a.plata_id = p_plata_id;
  v_avans := v_plata.suma - coalesce((select sum(a.suma) from financiar.alocari_plati a where a.plata_id = p_plata_id), 0);
  if v_avans > 0 then
    v_randuri := v_randuri || jsonb_build_array(jsonb_build_object('tip', 'avans', 'suma', v_avans));
  end if;

  insert into financiar.chitante (asociatie_id, plata_id, serie, numar, emisa_la, randuri)
  values (v_asociatie, p_plata_id, v_serie, v_numar, coalesce(v_plata.confirmata_la, now()), v_randuri)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function financiar.emite_chitanta(uuid) is
  'Chitanta unei plati: serie si numar fara goluri, plus randurile inghetate ale platii (B6). A doua chemare intoarce chitanta existenta.';
