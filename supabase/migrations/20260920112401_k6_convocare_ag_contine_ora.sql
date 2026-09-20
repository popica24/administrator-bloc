-- [K6] Convocarea adunarii generale trimitea doar data ("10 decembrie
-- 2026, Sala de la parter. Bugetul pe 2027"), fara ora la care are loc
-- adunarea. Baza ruleaza deja in Europe/Bucharest (X1), deci to_char cu
-- HH24:MI foloseste direct ora locala corecta.

create or replace function comunicare.la_vot(p_tip text, p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profil uuid;
  v_asociatie uuid := (p_date ->> 'asociatie_id')::uuid;
begin
  if p_tip = 'VotDeschis' then
    for v_profil in
      select distinct l.profil_id from identitate.locatari l join organizare.blocuri b on b.id = l.bloc_id
      where b.asociatie_id = v_asociatie and l.activ_din <= current_date and (l.activ_pana is null or l.activ_pana > current_date)
    loop
      perform comunicare.notifica(v_profil, v_asociatie, 'vot', 'Vot nou: ' || (p_date ->> 'titlu'),
        'Votul se inchide pe ' || comunicare.data_text((p_date ->> 'inchide_la')::date) || '. Voteaza din aplicatie, la Bloc.', jsonb_build_object('vot_id', p_date ->> 'vot_id'));
    end loop;
  elsif p_tip = 'VotReamintit' then
    for v_profil in
      select * from comunicare.locatari_apartamente(array(select jsonb_array_elements_text(p_date -> 'apartamente')::uuid))
    loop
      perform comunicare.notifica(v_profil, v_asociatie, 'vot', 'Nu ai votat inca', p_date ->> 'titlu', jsonb_build_object('vot_id', p_date ->> 'vot_id'));
    end loop;
  elsif p_tip = 'AdunareConvocata' then
    for v_profil in
      select distinct l.profil_id from identitate.locatari l join organizare.blocuri b on b.id = l.bloc_id
      where b.asociatie_id = v_asociatie and l.activ_din <= current_date and (l.activ_pana is null or l.activ_pana > current_date)
    loop
      perform comunicare.notifica(v_profil, v_asociatie, 'adunare_generala', 'Convocare la adunarea generala',
        comunicare.data_text((p_date ->> 'data_ora')::timestamptz::date) || ', ora ' || to_char((p_date ->> 'data_ora')::timestamptz, 'HH24:MI')
          || ', ' || (p_date ->> 'loc') || '. ' || (p_date ->> 'ordine_de_zi'),
        jsonb_build_object('adunare_id', p_date ->> 'adunare_id'));
    end loop;
  end if;
end;
$$;
