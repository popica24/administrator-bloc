-- [K3] Orice cont legat de apartament putea vota, definitiv, pentru el: un
-- chirias sau un membru al familiei putea vota inaintea proprietarului, care
-- gasea apoi votul "deja dat" fara sa fi participat. Legea 196/2018 da
-- dreptul de vot proprietarului (o imputernicire pentru un mandatar este in
-- afara acestei reparatii: aici alegem varianta conservatoare - doar
-- calitatea 'proprietar', activa azi, poate vota pentru apartament).
--
-- Verificarea calitatii vine dupa cea de "apartamentul a votat deja": daca
-- votul e deja dat, raspunsul e acelasi indiferent cine incearca sa mai
-- voteze o data.

create or replace function guvernanta.voteaza(p_vot_id uuid, p_optiune_id uuid, p_apartament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vot guvernanta.voturi;
begin
  if p_apartament_id not in (select private.apartamentele_mele()) then
    raise exception 'Poti vota doar pentru apartamentul tau.';
  end if;
  select * into v_vot from guvernanta.voturi where id = p_vot_id;
  if not found or v_vot.asociatie_id not in (
    select b.asociatie_id from organizare.blocuri b join organizare.apartamente a on a.bloc_id = b.id where a.id = p_apartament_id
  ) then
    raise exception 'Votul nu exista.';
  end if;
  if now() >= v_vot.inchide_la or now() < v_vot.deschis_la then
    raise exception 'Votul nu este deschis.';
  end if;
  if exists (select 1 from guvernanta.voturi_exprimate e where e.vot_id = p_vot_id and e.apartament_id = p_apartament_id) then
    raise exception 'Apartamentul a votat deja.';
  end if;
  if not exists (
    select 1 from identitate.locatari l
    where l.profil_id = (select auth.uid())
      and l.apartament_id = p_apartament_id
      and l.calitate = 'proprietar'
      and l.activ_din <= current_date
      and (l.activ_pana is null or l.activ_pana > current_date)
  ) then
    raise exception 'Doar proprietarul apartamentului poate vota (Legea 196/2018).';
  end if;
  insert into guvernanta.voturi_exprimate (vot_id, optiune_id, apartament_id, profil_id)
  values (p_vot_id, p_optiune_id, p_apartament_id, auth.uid());
exception
  when unique_violation then
    raise exception 'Apartamentul a votat deja.';
  when foreign_key_violation then
    raise exception 'Optiunea nu apartine acestui vot.';
end;
$$;
