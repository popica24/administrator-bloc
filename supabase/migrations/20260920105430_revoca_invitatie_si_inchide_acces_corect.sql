-- S11: patru gauri in ciclul de viata al codului de invitatie si al
-- accesului locatarului.
--
-- 1) identitate.foloseste_invitatie() insera legatura cu
--    `on conflict do nothing`: cand profilul avea deja o legatura activa cu
--    acelasi apartament, insert-ul nu facea nimic, dar codul era marcat
--    folosit oricum, parea reusit, fara niciun efect real.
-- 2) identitate.inchide_acces_locatar() fixa activ_pana la
--    greatest(p_data, activ_din + 1): o legatura facuta si inchisa in
--    aceeasi zi ramanea, din aceasta formula, activa pana a doua zi.
-- 3) inchiderea accesului nu revoca si codurile de invitatie nefolosite ale
--    apartamentului: un cod dat inainte de vanzare ramanea valabil dupa.
-- 4) nu exista nicio comanda separata pentru revocarea unui cod, pentru
--    cazul in care administratorul vrea sa anuleze o invitatie fara sa
--    inchida vreun acces (cod dat gresit, trimis catre alt apartament etc).

create or replace function identitate.foloseste_invitatie(p_cod text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ip text := identitate.adresa_cererii();
  v_inv identitate.invitatii;
  v_ap organizare.apartamente;
  v_gresite integer;
  v_gresite_adresa integer;
  v_locatar_id uuid;
begin
  if v_uid is null then
    raise exception 'Nu esti autentificat.';
  end if;

  delete from identitate.incercari_invitatii where creat_la < now() - interval '15 minutes';

  if v_ip is not null then
    select count(*) into v_gresite_adresa from identitate.incercari_invitatii where ip = v_ip;
    if v_gresite_adresa >= 20 then
      return jsonb_build_object('eroare',
        'S-au incercat prea multe coduri gresite de la aceasta conexiune. Mai asteapta un sfert de ora si incearca din nou.');
    end if;
  end if;

  select count(*) into v_gresite from identitate.incercari_invitatii where profil_id = v_uid;
  if v_gresite >= 5 then
    return jsonb_build_object('eroare',
      'Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.');
  end if;

  select * into v_inv from identitate.invitatii
    where cod = upper(btrim(p_cod))
    for update;
  if not found or v_inv.revocata_la is not null or v_inv.folosita_la is not null or v_inv.expira_la < now() then
    insert into identitate.incercari_invitatii (profil_id, ip) values (v_uid, v_ip);
    return jsonb_build_object('eroare', 'Codul nu este valabil. Cere administratorului un cod nou.');
  end if;

  select * into v_ap from organizare.apartamente where id = v_inv.apartament_id;

  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (v_inv.apartament_id, v_ap.bloc_id, v_uid, v_inv.calitate, current_date)
  on conflict do nothing
  returning id into v_locatar_id;
  if v_locatar_id is null then
    raise exception 'Esti deja legat de acest apartament.';
  end if;

  update identitate.invitatii
    set folosita_la = now(), folosita_de = v_uid
    where id = v_inv.id;

  delete from identitate.incercari_invitatii where profil_id = v_uid;

  return jsonb_build_object('apartament_id', v_ap.id, 'apartament_numar', v_ap.numar);
end;
$$;

-- Inchide accesul unui locatar (vanzare, mutare). Istoricul ramane. Codurile
-- de invitatie nefolosite ale apartamentului se revoca odata cu accesul: un
-- cod dat inainte de vanzare nu mai trebuie sa fie valabil dupa.
create or replace function identitate.inchide_acces_locatar(p_locatar_id uuid, p_data date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locatar identitate.locatari;
begin
  update identitate.locatari
     set activ_pana = greatest(p_data, activ_din)
   where id = p_locatar_id
     and bloc_id in (select private.blocuri_administrate())
     and activ_pana is null
  returning * into v_locatar;
  if not found then
    raise exception 'Legatura nu exista sau nu este in blocul tau.';
  end if;
  update identitate.invitatii
     set revocata_la = now()
   where apartament_id = v_locatar.apartament_id
     and folosita_la is null
     and revocata_la is null;
end;
$$;

-- Revocarea unui cod fara sa inchida vreun acces: cod dat gresit, trimis
-- catre alt apartament, sau pur si simplu regretat inainte sa fie folosit.
create function identitate.revoca_invitatie(p_invitatie_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv identitate.invitatii;
begin
  select * into v_inv from identitate.invitatii where id = p_invitatie_id for update;
  if not found or v_inv.apartament_id not in (select private.apartamente_administrate()) then
    raise exception 'Codul nu exista sau nu este din blocul tau.';
  end if;
  if v_inv.folosita_la is not null then
    raise exception 'Codul a fost deja folosit; revocarea nu mai are efect.';
  end if;
  update identitate.invitatii set revocata_la = now() where id = p_invitatie_id and revocata_la is null;
end;
$$;

revoke execute on function identitate.revoca_invitatie(uuid) from public, anon;
grant execute on function identitate.revoca_invitatie(uuid) to authenticated;
