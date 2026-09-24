-- [B8, S4] Chitanta pastreaza apartamentul si proprietarul de la emitere.
--
-- PDF-ul chitantei se genereaza de fiecare data din datele de azi, deci randul
-- cu numele lua proprietarul curent al apartamentului: dupa o vanzare, toate
-- chitantele vechi ale apartamentului se retipareau pe numele noului
-- proprietar. Un document de casa incepea sa spuna altceva decat a spus cand a
-- fost emis (auditul 3, S4, lasat atunci ca test `fixme`).
--
-- [B8] Tot acolo, textul spunea "Am primit de la <proprietar>", desi banii
-- putea sa-i aduca chiriasul, un copil sau un vecin: plata nu tine minte cine
-- a venit cu ei (financiar.plati.platita_de este null la incasarile facute de
-- administrator). Chitanta spune acum pentru ce apartament au fost primiti, si
-- trece proprietarul ca atare, nu ca platitor.

alter table financiar.chitante add column emis_pentru jsonb not null default '{}'::jsonb;

comment on column financiar.chitante.emis_pentru is
  'Apartamentul, proprietarul si blocul, asa cum erau la emitere: documentul nu se schimba dupa o vanzare (S4).';

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
  v_pentru jsonb;
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

  -- [S4] pentru cine s-a emis, asa cum era atunci
  select jsonb_build_object('apartament', a.numar, 'proprietar', a.proprietar_nume, 'bloc', b.denumire)
    into v_pentru
  from organizare.apartamente a
  join organizare.blocuri b on b.id = a.bloc_id
  where a.id = v_plata.apartament_id;

  insert into financiar.chitante (asociatie_id, plata_id, serie, numar, emisa_la, randuri, emis_pentru)
  values (v_asociatie, p_plata_id, v_serie, v_numar, coalesce(v_plata.confirmata_la, now()), v_randuri, coalesce(v_pentru, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function financiar.emite_chitanta(uuid) is
  'Chitanta unei plati: serie si numar fara goluri, randurile inghetate ale platii (B6) si apartamentul cu proprietarul de la emitere (S4). A doua chemare intoarce chitanta existenta.';
