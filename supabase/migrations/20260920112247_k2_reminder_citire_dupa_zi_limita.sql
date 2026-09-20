-- [K2] Reminderul de citire a contoarelor se declanseaza cand
-- (ziua_limita_a_lunii_curente - zile) = azi. UI-ul ofera pana la 30 de zile,
-- dar zi_limita_citire e de obicei sub 30 (implicit 25): cand zile este mai
-- mare sau egal cu zi_limita_citire, tinta cade in luna trecuta si azi (mereu
-- in luna curenta) nu o poate atinge niciodata. Comparam si cu termenul lunii
-- urmatoare, ca reminderul sa nu rateze la nesfarsit orice zile >= zi_limita.

create or replace function comunicare.trimite_remindere_zilnice()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r record;
  v_bloc record;
  v_luna date := date_trunc('month', current_date)::date;
  v_zi_limita smallint;
  v_termen date;
  v_termen_viitor date;
  v_profil uuid;
begin
  for v_r in select * from comunicare.remindere_setari where activ loop
    for v_bloc in select b.id from organizare.blocuri b where b.asociatie_id = v_r.asociatie_id and b.stare = 'activ' and b.arhivat_la is null loop
      if v_r.tip = 'citire_contoare' then
        select coalesce(s.zi_limita_citire, 25) into v_zi_limita from contorizare.setari_contorizare s where s.bloc_id = v_bloc.id;
        v_termen := v_luna + (v_zi_limita - 1);
        v_termen_viitor := (v_luna + interval '1 month')::date + (v_zi_limita - 1);
        if v_termen - v_r.zile = current_date or v_termen_viitor - v_r.zile = current_date then
          perform comunicare.trimite_reminder(v_bloc.id, 'citire_contoare');
        end if;
      elsif v_r.tip = 'plata' then
        if exists (select 1 from intretinere.liste_lunare l where l.bloc_id = v_bloc.id and l.stare = 'publicata' and l.scadenta - v_r.zile = current_date) then
          perform comunicare.trimite_reminder(v_bloc.id, 'plata');
        end if;
      elsif v_r.tip = 'restanta' then
        if exists (select 1 from intretinere.liste_lunare l where l.bloc_id = v_bloc.id and l.stare = 'publicata' and l.scadenta + v_r.zile = current_date) then
          perform comunicare.trimite_reminder(v_bloc.id, 'restanta');
        end if;
      elsif v_r.tip = 'adunare_generala' then
        for v_profil in
          select distinct l.profil_id
          from guvernanta.adunari_generale g
          join identitate.locatari l on l.bloc_id = v_bloc.id and l.activ_din <= current_date and (l.activ_pana is null or l.activ_pana > current_date)
          where g.asociatie_id = v_r.asociatie_id and g.data_ora::date - v_r.zile = current_date
        loop
          perform comunicare.notifica(v_profil, v_r.asociatie_id, 'adunare_generala', 'Adunarea generala se apropie',
            'Adunarea generala are loc peste ' || v_r.zile || ' zile. Confirma prezenta din aplicatie.', null);
        end loop;
      end if;
    end loop;
  end loop;
end;
$$;
