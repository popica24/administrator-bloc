-- [K13] Sapte interogari de destinatari verificau doar activ_pana, nu si
-- activ_din: un locatar cu acces viitor (activ_din in viitor) era numarat
-- printre destinatari si notificat inainte de vreme. comunicare.notifica
-- prin comunicare.locatari_apartamente() si RLS prin private.apartamentele_mele()
-- verifica deja amandoua conditiile; aceste sase functii din comunicare plus
-- reaminteste_vot din guvernanta interogau identitate.locatari direct, cu
-- verificarea incompleta.

create or replace function comunicare.publica_anunt(p_bloc_id uuid, p_titlu text, p_corp text, p_urgent boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asociatie uuid;
  v_id uuid;
  v_profil uuid;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) then
    raise exception 'Doar administratorul publica anunturi.';
  end if;
  select asociatie_id into v_asociatie from organizare.blocuri where id = p_bloc_id;
  insert into comunicare.anunturi (asociatie_id, bloc_id, autor_id, titlu, corp, urgent)
  values (v_asociatie, p_bloc_id, auth.uid(), btrim(p_titlu), btrim(p_corp), coalesce(p_urgent, false))
  returning id into v_id;
  if p_urgent then
    for v_profil in
      select distinct l.profil_id from identitate.locatari l
      where l.bloc_id = p_bloc_id and l.activ_din <= current_date and (l.activ_pana is null or l.activ_pana > current_date)
    loop
      perform comunicare.notifica(v_profil, v_asociatie, 'anunt', 'Urgent: ' || btrim(p_titlu), btrim(p_corp), jsonb_build_object('anunt_id', v_id));
    end loop;
  end if;
  return v_id;
end;
$$;

create or replace function comunicare.la_lista_publicata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asociatie uuid := (p_date ->> 'asociatie_id')::uuid;
  v_profil uuid;
begin
  if not exists (select 1 from comunicare.remindere_setari where asociatie_id = v_asociatie and tip = 'lista_publicata' and activ) then
    return;
  end if;
  for v_profil in
    select distinct l.profil_id from identitate.locatari l
    where l.bloc_id = (p_date ->> 'bloc_id')::uuid and l.activ_din <= current_date and (l.activ_pana is null or l.activ_pana > current_date)
  loop
    perform comunicare.notifica(v_profil, v_asociatie, 'lista_publicata',
      'Lista pe ' || comunicare.luna_text((p_date ->> 'luna')::date) || ' a fost publicata',
      'Vezi in aplicatie cat ai de plata si cum s-a calculat fiecare suma. Termenul de plata este ' || comunicare.data_text((p_date ->> 'scadenta')::date) || '.',
      jsonb_build_object('lista_id', p_date ->> 'lista_id'));
  end loop;
end;
$$;

create or replace function comunicare.la_lista_recalculata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profil uuid;
  v_asociatie uuid;
begin
  select asociatie_id into v_asociatie from organizare.blocuri where id = (p_date ->> 'bloc_id')::uuid;
  for v_profil in
    select distinct l.profil_id from identitate.locatari l
    where l.bloc_id = (p_date ->> 'bloc_id')::uuid and l.activ_din <= current_date and (l.activ_pana is null or l.activ_pana > current_date)
  loop
    perform comunicare.notifica(v_profil, v_asociatie, 'lista_recalculata',
      'Lista pe ' || comunicare.luna_text((p_date ->> 'luna')::date) || ' a fost corectata',
      'O factura a fost corectata si lista a fost recalculata. Diferenta apare ca un rand separat, cu explicatia lui.',
      jsonb_build_object('lista_id', p_date ->> 'lista_id'));
  end loop;
end;
$$;

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
        comunicare.data_text((p_date ->> 'data_ora')::timestamptz::date) || ', ' || (p_date ->> 'loc') || '. ' || (p_date ->> 'ordine_de_zi'),
        jsonb_build_object('adunare_id', p_date ->> 'adunare_id'));
    end loop;
  end if;
end;
$$;

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
  v_termen date;
  v_profil uuid;
begin
  for v_r in select * from comunicare.remindere_setari where activ loop
    for v_bloc in select b.id from organizare.blocuri b where b.asociatie_id = v_r.asociatie_id and b.stare = 'activ' and b.arhivat_la is null loop
      if v_r.tip = 'citire_contoare' then
        select v_luna + (coalesce(s.zi_limita_citire, 25) - 1) into v_termen from contorizare.setari_contorizare s where s.bloc_id = v_bloc.id;
        if v_termen - v_r.zile = current_date then
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

create or replace function guvernanta.reaminteste_vot(p_vot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vot guvernanta.voturi;
  v_apartamente uuid[];
  v_destinatari integer;
begin
  select * into v_vot from guvernanta.voturi where id = p_vot_id;
  if not found or v_vot.asociatie_id not in (select private.asociatii_administrate()) then
    raise exception 'Votul nu exista.';
  end if;
  select coalesce(array_agg(a.id), '{}') into v_apartamente
  from organizare.apartamente a join organizare.blocuri b on b.id = a.bloc_id
  where b.asociatie_id = v_vot.asociatie_id
    and not exists (select 1 from guvernanta.voturi_exprimate e where e.vot_id = p_vot_id and e.apartament_id = a.id);
  select count(*) into v_destinatari from identitate.locatari l
  where l.apartament_id = any (v_apartamente) and l.activ_din <= current_date and (l.activ_pana is null or l.activ_pana > current_date);
  perform evenimente.inregistreaza('VotReamintit', 'guvernanta', p_vot_id,
    jsonb_build_object('vot_id', p_vot_id, 'asociatie_id', v_vot.asociatie_id, 'titlu', v_vot.titlu, 'apartamente', to_jsonb(v_apartamente)));
  return jsonb_build_object('apartamente', coalesce(array_length(v_apartamente, 1), 0), 'destinatari', v_destinatari);
end;
$$;
