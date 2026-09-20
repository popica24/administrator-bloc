-- A4: doua defecte care mutau consumul intre luni.
--
-- 1) contorizare.index_anterior() lua ultima citire nerespinsa, indiferent
--    de stare: o citire doar "trimisa" (nevalidata inca de administrator),
--    sau chiar respinsa-si-retrimisa, devenea punctul de plecare al lunii
--    urmatoare inainte sa fie confirmata. Daca administratorul respingea
--    ulterior acel index, luna urmatoare ramanea calculata pe o valoare pe
--    care nimeni n-a validat-o.
-- 2) contorizare.valideaza_citire() nu verifica daca luna citirii are deja
--    lista publicata: o validare (sau respingere) facuta tarziu schimba
--    consumul validat al unei luni ale carei cheltuieli fusesera deja
--    repartizate si platite, exact bug-ul "lista locatarului si raportul
--    administratorului nu se potrivesc" pe care motorul trebuie sa il
--    previna.
--
-- Reparatie: index_anterior ia doar citirile validate; valideaza_citire
-- refuza o citire din luna unei liste deja publicate.

create or replace function contorizare.index_anterior(p_contor_id uuid, p_luna date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.index_curent
    from contorizare.citiri c
    where c.contor_id = p_contor_id and c.luna < p_luna and c.stare = 'validata'
    order by c.luna desc, c.transmisa_la desc
    limit 1
  ), 0);
$$;

create or replace function contorizare.valideaza_citire(p_citire_id uuid, p_accepta boolean, p_motiv text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_citire contorizare.citiri;
begin
  select * into v_citire from contorizare.citiri where id = p_citire_id for update;
  if not found or v_citire.bloc_id not in (select private.blocuri_administrate()) then
    raise exception 'Citirea nu exista sau nu este din blocul tau.';
  end if;
  if v_citire.stare <> 'trimisa' then
    raise exception 'Citirea a fost deja verificata.';
  end if;
  if exists (
    select 1 from intretinere.liste_lunare
    where bloc_id = v_citire.bloc_id and luna = v_citire.luna and stare = 'publicata'
  ) then
    raise exception 'Lista lunii % este deja publicata; citirea nu se mai poate verifica.', v_citire.luna;
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
  if not p_accepta then
    perform evenimente.inregistreaza('CitireRespinsa', 'contorizare', v_citire.contor_id,
      jsonb_build_object('citire_id', v_citire.id, 'apartament_id', v_citire.apartament_id, 'bloc_id', v_citire.bloc_id,
                         'luna', v_citire.luna, 'motiv', btrim(p_motiv)));
  end if;
end;
$$;
