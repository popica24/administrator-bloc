-- [K5] Reminderul de plata ("Se apropie termenul de plata al intretinerii")
-- pleca la orice apartament cu vreo datorie deschisa, inclusiv la cei deja
-- restanti, carora nu li se potriveste mesajul. Acum, pe apartamentele care
-- au deja o datorie scadenta, trimite in schimb instiintarea de restanta
-- (acelasi text ca sesizari.trimite_instiintare / reminderul 'restanta').
-- Numarul de apartamente si de destinatari raportat de functie ramane
-- acelasi (orice apartament cu sold, scadent sau nu); se schimba doar
-- continutul notificarii primite de restantieri.

create or replace function comunicare.trimite_reminder(p_bloc_id uuid, p_tip text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asociatie uuid;
  v_apartamente uuid[];
  v_restante uuid[];
  v_ap uuid;
  v_profil uuid;
  v_n integer := 0;
  v_luna date := date_trunc('month', current_date)::date;
  v_zi smallint;
  v_titlu text;
  v_corp text;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul trimite remindere.';
  end if;
  select asociatie_id into v_asociatie from organizare.blocuri where id = p_bloc_id;

  if p_tip = 'citire_contoare' then
    select coalesce(zi_limita_citire, 25) into v_zi from contorizare.setari_contorizare where bloc_id = p_bloc_id;
    select coalesce(array_agg(a.id), '{}') into v_apartamente from organizare.apartamente a
    where a.bloc_id = p_bloc_id
      and not exists (select 1 from contorizare.citiri c where c.apartament_id = a.id and c.luna = v_luna and c.stare <> 'respinsa');
    v_titlu := 'Transmite indexul la apa';
    v_corp := 'Te rugam sa transmiti indexul contoarelor pana pe ' || comunicare.data_text((v_luna + (coalesce(v_zi, 25) - 1))::date) || ', cu o poza a contoarelor.';
    for v_profil in select * from comunicare.locatari_apartamente(v_apartamente) loop
      perform comunicare.notifica(v_profil, v_asociatie, p_tip, v_titlu, v_corp, null);
      v_n := v_n + 1;
    end loop;
  elsif p_tip = 'restanta' then
    select coalesce(array_agg(x), '{}') into v_apartamente from comunicare.apartamente_cu_sold(p_bloc_id, true) x;
    v_titlu := 'Instiintare de plata';
    v_corp := 'Aveti sume neachitate trecute de scadenta. Va rugam sa le achitati ca sa opriti penalizarile.';
    for v_profil in select * from comunicare.locatari_apartamente(v_apartamente) loop
      perform comunicare.notifica(v_profil, v_asociatie, p_tip, v_titlu, v_corp, null);
      v_n := v_n + 1;
    end loop;
  elsif p_tip = 'plata' then
    select coalesce(array_agg(x), '{}') into v_apartamente from comunicare.apartamente_cu_sold(p_bloc_id, false) x;
    select coalesce(array_agg(x), '{}') into v_restante from comunicare.apartamente_cu_sold(p_bloc_id, true) x;
    -- Apartamentele deja restante primesc instiintarea de restanta, nu
    -- "se apropie termenul": mesajul ar contrazice realitatea lor.
    for v_ap in select unnest(v_apartamente) loop
      for v_profil in select * from comunicare.locatari_apartamente(array[v_ap]) loop
        if v_ap = any (v_restante) then
          perform comunicare.notifica(v_profil, v_asociatie, 'restanta', 'Instiintare de plata',
            'Aveti sume neachitate trecute de scadenta. Va rugam sa le achitati ca sa opriti penalizarile.', null);
        else
          perform comunicare.notifica(v_profil, v_asociatie, p_tip, 'Reamintire de plata',
            'Se apropie termenul de plata al intretinerii. Vezi in aplicatie suma si calculul ei.', null);
        end if;
        v_n := v_n + 1;
      end loop;
    end loop;
  else
    raise exception 'Reminderul % nu se trimite manual.', p_tip;
  end if;

  return jsonb_build_object('apartamente', coalesce(array_length(v_apartamente, 1), 0), 'destinatari', v_n);
end;
$$;
