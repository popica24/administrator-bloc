-- [K2] O citire de apartament validata din greseala se poate respinge, cat
-- timp lista lunii nu este publicata.
--
-- Pana acum, dupa validare nu mai exista nicio comanda care sa o schimbe:
-- valideaza_citire raspundea "Citirea a fost deja verificata",
-- valideaza_citiri_apartament "Nu mai sunt citiri de verificat",
-- estimeaza_citiri o sarea, transmite_citire raspundea "deja validat", iar
-- authenticated are doar SELECT pe citiri. Cu un index scris gresit (1900 mc
-- in loc de 130), motorul refuza apoi lista ("contorul general e mai mic
-- decat suma contoarelor"): luna devenea nepublicabila, iar singura iesire era
-- sa falsifici contorul general.
--
-- Acum administratorul respinge citirea validata, cu motiv, ca pe una
-- trimisa: locatarul este anuntat (CitireRespinsa) si o retrimite, iar lunile
-- de dupa isi refac indexul anterior din ultima citire valida
-- (contorizare.recalculeaza_viitorul, cascada comuna din J1).
--
-- Raman refuzate: acceptarea a doua oara, citirea de pornire (referinta
-- contorului; fara ea tot lantul ramane fara baza), contorul general (se
-- corecteaza cu citeste_contor_general, J7) si orice citire dintr-o luna cu
-- lista publicata.
--
-- Definitia de baza este cea din 20260920192940_repara_regresie_p6_mesaje_luna_in_j1.sql,
-- ultima care a rescris functia; se schimba doar garda de stare si cascada.
create or replace function contorizare.valideaza_citire(p_citire_id uuid, p_accepta boolean, p_motiv text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_citire contorizare.citiri;
  v_corectie boolean;
begin
  select * into v_citire from contorizare.citiri where id = p_citire_id for update;
  if not found or v_citire.bloc_id not in (select private.blocuri_administrate()) then
    raise exception 'Citirea nu exista sau nu este din blocul tau.';
  end if;
  -- [K2] o citire de apartament validata se mai poate respinge (nu accepta)
  v_corectie := v_citire.stare = 'validata' and not p_accepta
                and v_citire.sursa <> 'pornire' and v_citire.apartament_id is not null;
  if v_citire.stare <> 'trimisa' and not v_corectie then
    raise exception 'Citirea a fost deja verificata.';
  end if;
  if exists (
    select 1 from intretinere.liste_lunare
    where bloc_id = v_citire.bloc_id and luna = v_citire.luna and stare = 'publicata'
  ) then
    raise exception 'Lista lunii % este deja publicata; citirea nu se mai poate verifica.', comunicare.luna_text(v_citire.luna);
  end if;
  if not p_accepta and coalesce(btrim(p_motiv), '') = '' then
    raise exception 'Scrie motivul, ca locatarul sa stie ce sa corecteze.';
  end if;
  update contorizare.citiri
     set stare = case when p_accepta then 'validata' else 'respinsa' end,
         motiv_respingere = case when p_accepta then null else btrim(p_motiv) end,
         verificata_de = auth.uid(),
         verificata_la = now()
   where id = p_citire_id;

  -- Lunile de dupa isi iau indexul anterior din ultima citire validata: se
  -- refac cand una devine validata si cand una validata iese din joc.
  if p_accepta or v_corectie then
    perform contorizare.recalculeaza_viitorul(v_citire.contor_id, v_citire.bloc_id, v_citire.luna);
  end if;

  if not p_accepta then
    perform evenimente.inregistreaza('CitireRespinsa', 'contorizare', v_citire.contor_id,
      jsonb_build_object('citire_id', v_citire.id, 'apartament_id', v_citire.apartament_id, 'bloc_id', v_citire.bloc_id,
                         'luna', v_citire.luna, 'motiv', btrim(p_motiv)));
  end if;
end;
$$;
