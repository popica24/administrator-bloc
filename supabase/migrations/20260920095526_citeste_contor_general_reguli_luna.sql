-- contorizare.citeste_contor_general() nu verifica luna deloc (audit A3):
-- accepta o luna viitoare, si rescria contorul general al unei luni a carei
-- lista era deja publicata, dupa ce banii pentru luna aceea fusesera deja
-- calculati din vechea citire. In plus nu verifica indexul fata de o citire
-- deja existenta pe luna urmatoare, deci un index prea mare ar face
-- consumul lunii urmatoare negativ.
--
-- Reparatie: refuza o luna viitoare, refuza luna unei liste deja publicate,
-- si refuza un index mai mare decat cel deja inregistrat drept "anterior" pe
-- luna urmatoare (daca exista o citire acolo). Stergerea si reinserarea
-- randului raman (corectia inlocuieste, nu adauga), dar acum trec prin
-- audit.jurnal ca orice alta modificare pe contorizare.citiri (trigger deja
-- existent citiri_audit): valoarea veche a corectiei nu se pierde, chiar
-- daca randul din contorizare.citiri e inlocuit.

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
    raise exception 'Lista lunii % este deja publicata; contorul general nu se mai poate schimba.', p_luna;
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
  select index_anterior into v_index_urmator
    from contorizare.citiri
    where contor_id = v_contor.id and luna = (p_luna + interval '1 month')::date and stare <> 'respinsa'
    limit 1;
  if v_index_urmator is not null and p_index > v_index_urmator then
    raise exception 'Indexul nou (%) nu poate fi mai mare decat indexul de pornire al lunii urmatoare (%).', p_index, v_index_urmator;
  end if;
  delete from contorizare.citiri where contor_id = v_contor.id and luna = p_luna;
  insert into contorizare.citiri (contor_id, tip, bloc_id, luna, index_anterior, index_curent, sursa, stare, transmisa_de, verificata_de, verificata_la)
  values (v_contor.id, v_contor.tip, p_bloc_id, p_luna, v_anterior, p_index, 'administrator', 'validata', auth.uid(), auth.uid(), now());
end;
$$;
