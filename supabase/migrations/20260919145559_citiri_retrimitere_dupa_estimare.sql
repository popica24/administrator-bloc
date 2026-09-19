-- Transmiterea indexului: doua situatii in care locatarul ramanea blocat
-- (audit A1, A2).
--
-- A1. Formularul trimite toate contoarele apartamentului. Daca administratorul
-- validase apa rece si respinsese apa calda, retrimiterea era refuzata in
-- intregime ("deja validat"), iar locatarul nu mai putea corecta apa calda.
-- Acum contoarele deja validate pe luna se sar; eroarea ramane doar cand nu
-- mai e nimic de trimis.
--
-- A2. O citire estimata (media ultimelor trei luni) devine indexul anterior
-- al lunii urmatoare. Cand estimarea a fost mai mare decat consumul real,
-- indexul real de pe cadran era refuzat ca "mai mic decat cel anterior", luna
-- de luna. Acum, daca indexul anterior vine dintr-o estimare, se accepta un
-- index real sub ea, dar nu sub ultima citire reala. Citirea pleaca de la
-- indexul real (consum 0 pe luna aceasta pe acel contor), iar lantul de
-- indexuri continua corect de acolo. Ce s-a platit in plus pe estimare ramane
-- de regularizat in bani, separat.

create or replace function contorizare.transmite_citire(
  p_apartament_id uuid,
  p_luna date,
  p_indexuri jsonb,
  p_poza_cale text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rand jsonb;
  v_contor contorizare.contoare;
  v_anterior numeric;
  v_ultim_real numeric;
  v_din_estimare boolean;
  v_index numeric;
  v_trimise integer := 0;
begin
  if p_apartament_id not in (select private.apartamentele_mele()) then
    raise exception 'Nu ai acces la acest apartament.';
  end if;
  if p_luna <> date_trunc('month', current_date)::date then
    raise exception 'Se poate transmite doar indexul lunii curente.';
  end if;
  if jsonb_typeof(p_indexuri) <> 'array' or jsonb_array_length(p_indexuri) = 0 then
    raise exception 'Scrie cel putin un index.';
  end if;

  for v_rand in select * from jsonb_array_elements(p_indexuri) loop
    select * into v_contor from contorizare.contoare
      where id = (v_rand ->> 'contor_id')::uuid and apartament_id = p_apartament_id and scos_la is null;
    if not found then
      raise exception 'Contorul nu este al apartamentului tau.';
    end if;
    continue when exists (select 1 from contorizare.citiri where contor_id = v_contor.id and luna = p_luna and stare = 'validata');

    v_index := (v_rand ->> 'index')::numeric;
    v_anterior := contorizare.index_anterior(v_contor.id, p_luna);
    if v_index is not null and v_index < v_anterior then
      select c.sursa = 'estimat' into v_din_estimare
      from contorizare.citiri c
      where c.contor_id = v_contor.id and c.luna < p_luna and c.stare <> 'respinsa'
      order by c.luna desc, c.transmisa_la desc
      limit 1;
      select coalesce((
        select c.index_curent from contorizare.citiri c
        where c.contor_id = v_contor.id and c.luna < p_luna and c.stare <> 'respinsa' and c.sursa <> 'estimat'
        order by c.luna desc, c.transmisa_la desc
        limit 1
      ), 0) into v_ultim_real;
      if v_din_estimare and v_index >= v_ultim_real then
        v_anterior := v_index;
      end if;
    end if;
    if v_index is null or v_index < v_anterior then
      raise exception 'Indexul nou (%) nu poate fi mai mic decat cel anterior (%).', v_index, v_anterior;
    end if;
    delete from contorizare.citiri where contor_id = v_contor.id and luna = p_luna and stare = 'trimisa';
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare, poza_cale, transmisa_de)
    values (v_contor.id, v_contor.tip, v_contor.bloc_id, p_apartament_id, p_luna, v_anterior, v_index, 'locatar', 'trimisa', p_poza_cale, auth.uid());
    v_trimise := v_trimise + 1;
  end loop;

  if v_trimise = 0 then
    raise exception 'Indexul pe aceasta luna a fost deja validat de administrator.';
  end if;
  perform evenimente.inregistreaza('CitireTransmisa', 'contorizare', p_apartament_id,
    jsonb_build_object('apartament_id', p_apartament_id, 'bloc_id', v_contor.bloc_id, 'luna', p_luna));
end;
$$;
