-- J7: contorizare.citeste_contor_general() refuza o corectura in sus,
-- legitima, fara nicio cale de iesire, ori de cate ori luna urmatoare are
-- deja o citire inregistrata. Plafonul folosit era index_anterior-ul
-- inghetat al lunii urmatoare, nu indexul ei chiar inregistrat
-- (index_curent): daca administratorul corecta luna curenta in sus (de
-- exemplu repara o citire trecuta gresit), refuzul ramanea definitiv, chiar
-- daca noul index era in continuare mai mic decat cel real, citit efectiv,
-- al lunii urmatoare. Contoarele de apartament au primit cascada J1
-- (contorizare.recalculeaza_viitorul) tocmai pentru cazul asta; contorul
-- general nu primise nimic.
--
-- Reparatie: plafonul devine indexul CHIAR INREGISTRAT (index_curent) al
-- lunii urmatoare, singurul motiv pentru care un plafon exista deloc este
-- ca un contor nu poate merge inapoi, si asta se verifica fata de o citire
-- reala, nu fata de un index_anterior care poate fi el insusi stale. Dupa
-- ce noul index e acceptat, contorizare.recalculeaza_viitorul() propaga
-- corectura mai departe (index_anterior si consum, generat, al lunilor de
-- dupa), exact ca la contoarele de apartament.

create or replace function contorizare.citeste_contor_general(p_bloc_id uuid, p_luna date, p_tip text, p_index numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contor contorizare.contoare;
  v_anterior numeric;
  v_index_urmator numeric;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) then
    raise exception 'Doar administratorul blocului citeste contorul general.';
  end if;
  if p_luna > date_trunc('month', current_date)::date then
    raise exception 'Nu poti citi contorul general pe o luna viitoare.';
  end if;
  if exists (
    select 1 from intretinere.liste_lunare
    where bloc_id = p_bloc_id and luna = p_luna and stare = 'publicata'
  ) then
    raise exception 'Lista lunii % este deja publicata; contorul general nu se mai poate schimba.', comunicare.luna_text(p_luna);
  end if;
  select * into v_contor from contorizare.contoare
    where bloc_id = p_bloc_id and apartament_id is null and tip = p_tip and scos_la is null;
  if not found then
    raise exception 'Blocul nu are contor general pentru apa %.', p_tip;
  end if;
  v_anterior := contorizare.index_anterior(v_contor.id, p_luna);
  if p_index < v_anterior then
    raise exception 'Indexul nou nu poate fi mai mic decat cel anterior (%).', v_anterior;
  end if;
  -- J7: plafonul e indexul chiar inregistrat (index_curent) al lunii
  -- urmatoare, nu index_anterior-ul ei inghetat, acela se recalculeaza mai
  -- jos, cu cascada, in loc sa blocheze corectura.
  select index_curent into v_index_urmator from contorizare.citiri
    where contor_id = v_contor.id and luna = (p_luna + interval '1 month')::date and stare <> 'respinsa'
    order by transmisa_la desc limit 1;
  if v_index_urmator is not null and p_index > v_index_urmator then
    raise exception 'Indexul nou (%) nu poate fi mai mare decat indexul contorului general de pe luna urmatoare (%).', p_index, v_index_urmator;
  end if;
  delete from contorizare.citiri where contor_id = v_contor.id and luna = p_luna;
  insert into contorizare.citiri (contor_id, tip, bloc_id, luna, index_anterior, index_curent, sursa, stare, transmisa_de, verificata_de, verificata_la)
  values (v_contor.id, v_contor.tip, p_bloc_id, p_luna, v_anterior, p_index, 'administrator', 'validata', auth.uid(), auth.uid(), now());

  -- J7: aceeasi cascada ca la contoarele de apartament (J1), pe contorul
  -- general.
  perform contorizare.recalculeaza_viitorul(v_contor.id, p_bloc_id, p_luna);
end;
$$;
