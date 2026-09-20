-- H9: identitate.inchide_acces_locatar() revoca TOATE codurile de invitatie
-- nefolosite ale apartamentului, indiferent cand au fost emise. Ordinea
-- fireasca la o vanzare este sa dai cumparatorului un cod nou, apoi sa
-- inchizi accesul vanzatorului cu data reala de plecare (adesea in trecut
-- fata de ziua in care se face hartia): cu regula veche, inchiderea anula
-- si codul proaspat al cumparatorului.
--
-- Reparatie: revoca doar codurile emise pana la data la care se inchide
-- legatura (activ_pana, calculat mai sus in aceeasi functie), nu toate cele
-- nefolosite. Un cod emis dupa acea data (cazul cumparatorului) ramane
-- valabil.

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
     and revocata_la is null
     and creat_la::date <= v_locatar.activ_pana;
end;
$$;
