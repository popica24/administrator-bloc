-- A7: poza pusa ca dovada la o citire de contor putea fi a altui apartament,
-- din doua directii.
--
-- 1) contorizare.transmite_citire(p_poza_cale) nu verifica deloc calea:
--    locatarul putea trimite calea pozei altui apartament (sau orice text)
--    ca dovada a propriului index.
-- 2) politica de upload pe bucket-ul "poze" verifica separat segmentul de
--    bloc (pentru administrator) si segmentul de apartament (pentru
--    locatar), dar niciodata ca cele doua segmente sa se refere la aceeasi
--    perechere bloc-apartament: un locatar putea incarca sub
--    <orice-uuid>/<apartamentul lui>/poza.jpg, iar fisierul ajungea vizibil
--    ca fiind al unui bloc strain.
--
-- Reparatie: transmite_citire cere ca, atunci cand poza e data, calea sa
-- inceapa cu <bloc_id>/<apartament_id>/, iar politica de storage cere ca
-- segmentul de bloc din nume sa fie chiar blocul apartamentului din
-- segmentul urmator.
--
-- Functia porneste de la versiunea din 20260919145559_citiri_retrimitere_dupa_estimare.sql
-- (A1/A2: sare contoarele deja validate, accepta indexul real sub o estimare
-- prea mare), careia i se adauga doar verificarea pozei.

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
  v_bloc_id uuid;
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

  select bloc_id into v_bloc_id from organizare.apartamente where id = p_apartament_id;
  if p_poza_cale is not null
     and p_poza_cale not like (v_bloc_id::text || '/' || p_apartament_id::text || '/%')
  then
    raise exception 'Poza contorului trebuie sa fie a acestui apartament.';
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

-- poze: <bloc_id>/<apartament_id>/<fisier>. Politica veche accepta un
-- segment de bloc administrat SAU un segment de apartament propriu, fara sa
-- ceara ca cele doua sa se potriveasca.
drop policy "Poze: incarcare pentru apartamentul propriu" on storage.objects;
create policy "Poze: incarcare pentru apartamentul propriu"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'poze'
    and (storage.foldername(name))[1] = (
      select ap.bloc_id::text from organizare.apartamente ap
      where ap.id::text = (storage.foldername(name))[2]
    )
    and (
      (storage.foldername(name))[2] in (select a::text from private.apartamentele_mele() a)
      or (storage.foldername(name))[1] in (select b::text from private.blocuri_administrate() b)
    )
  );
