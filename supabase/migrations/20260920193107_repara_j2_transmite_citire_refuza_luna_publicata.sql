-- J2: contorizare.transmite_citire() este singura comanda de scriere din
-- schema contorizare fara paza "lista lunii e deja publicata", pe care
-- cele patru surori o au deja (valideaza_citire, valideaza_citiri_apartament,
-- citeste_contor_general, estimeaza_citiri). transmite_citire accepta doar
-- luna curenta (p_luna = date_trunc('month', current_date)), dar o lista
-- poate fi publicata inainte de sfarsitul lunii ei: daca administratorul
-- publica lista lunii curente mai devreme, iar locatarul transmite (sau
-- retrimite) un index dupa aceea, citirea intra oricum, cu starea
-- "trimisa" — si ramane asa pentru totdeauna, pentru ca valideaza_citire
-- refuza sa o verifice ("Lista lunii % este deja publicata; citirea nu se
-- mai poate verifica."). Badge-ul "De verificat" al administratorului nu
-- mai ajunge niciodata la zero.
--
-- Reparatie: aceeasi verificare si acelasi stil de mesaj ca la surori,
-- imediat dupa ce se afla blocul apartamentului (necesar oricum pentru
-- verificarea caii pozei, adaugata de A7).

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

  -- J2: aceeasi paza ca la valideaza_citire, valideaza_citiri_apartament,
  -- citeste_contor_general si estimeaza_citiri.
  if exists (
    select 1 from intretinere.liste_lunare
    where bloc_id = v_bloc_id and luna = p_luna and stare = 'publicata'
  ) then
    raise exception 'Lista lunii % este deja publicata; nu se mai poate transmite un index.', comunicare.luna_text(p_luna);
  end if;

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
