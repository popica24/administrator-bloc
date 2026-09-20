-- H1: contorizare.index_anterior se ingheata pe rand la transmitere
-- (transmite_citire) si la estimare (estimeaza_citiri), calculat cu
-- contorizare.index_anterior(), care de la reparatia A4 numara doar
-- citirile validate. Daca un locatar transmite luna M cat timp luna M-1 e
-- inca "trimisa" (nevalidata de administrator), index_anterior al lunii M
-- se calculeaza sarind peste luna M-1 si ajunge la ultima citire *validata*
-- dinainte, mai veche. Cand administratorul valideaza mai tarziu ambele
-- luni, consumul lunii M-1 e numarat a doua oara, in interiorul consumului
-- lunii M (reprodus pe D14 ap. 3: 51.820 mc in loc de 33.740 mc).
--
-- Reparatie: cand o citire este validata (acceptata), contorizare.valideaza_citire
-- si contorizare.valideaza_citiri_apartament recalculeaza index_anterior al
-- citirilor inca "trimisa" ale aceluiasi contor, pentru lunile de dupa cea
-- tocmai validata. consum e coloana generata din index_anterior si
-- index_curent, deci se recalculeaza automat odata cu index_anterior.
-- Recalcularea foloseste din nou contorizare.index_anterior(), asa ca
-- cascada e corecta indiferent de cate luni "trimisa" mai asteapta.

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

  -- H1: luna tocmai validata poate fi cea mai recenta validata inaintea unor
  -- luni deja transmise, dar inca nevalidate: indexul lor anterior, inghetat
  -- la transmitere, era stale. Il recalculam acum ca sa nu se mai piarda sau
  -- dubleze consum.
  if p_accepta then
    update contorizare.citiri c2
       set index_anterior = contorizare.index_anterior(c2.contor_id, c2.luna)
     where c2.contor_id = v_citire.contor_id
       and c2.luna > v_citire.luna
       and c2.stare = 'trimisa';
  end if;

  if not p_accepta then
    perform evenimente.inregistreaza('CitireRespinsa', 'contorizare', v_citire.contor_id,
      jsonb_build_object('citire_id', v_citire.id, 'apartament_id', v_citire.apartament_id, 'bloc_id', v_citire.bloc_id,
                         'luna', v_citire.luna, 'motiv', btrim(p_motiv)));
  end if;
end;
$$;

create or replace function contorizare.valideaza_citiri_apartament(
  p_apartament_id uuid,
  p_luna date,
  p_accepta boolean,
  p_motiv text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_apartament organizare.apartamente;
  v_citire contorizare.citiri;
  v_numar integer := 0;
begin
  select * into v_apartament from organizare.apartamente where id = p_apartament_id;
  if not found or v_apartament.bloc_id not in (select private.blocuri_administrate()) then
    raise exception 'Apartamentul nu exista sau nu este din blocul tau.';
  end if;

  if exists (
    select 1 from intretinere.liste_lunare
    where bloc_id = v_apartament.bloc_id and luna = p_luna and stare = 'publicata'
  ) then
    raise exception 'Lista lunii % este deja publicata; citirile nu se mai pot verifica.', p_luna;
  end if;

  if not p_accepta and coalesce(btrim(p_motiv), '') = '' then
    raise exception 'Scrie motivul, ca locatarul sa stie ce sa corecteze.';
  end if;

  for v_citire in
    select * from contorizare.citiri
    where apartament_id = p_apartament_id and luna = p_luna and stare = 'trimisa'
    order by id
    for update
  loop
    update contorizare.citiri
       set stare = case when p_accepta then 'validata' else 'respinsa' end,
           motiv_respingere = case when p_accepta then null else btrim(p_motiv) end,
           verificata_de = auth.uid(),
           verificata_la = now()
     where id = v_citire.id;

    -- H1: aceeasi cascada ca in valideaza_citire, pe contorul acestei citiri.
    if p_accepta then
      update contorizare.citiri c2
         set index_anterior = contorizare.index_anterior(c2.contor_id, c2.luna)
       where c2.contor_id = v_citire.contor_id
         and c2.luna > v_citire.luna
         and c2.stare = 'trimisa';
    end if;

    if not p_accepta then
      perform evenimente.inregistreaza('CitireRespinsa', 'contorizare', v_citire.contor_id,
        jsonb_build_object('citire_id', v_citire.id, 'apartament_id', v_citire.apartament_id, 'bloc_id', v_citire.bloc_id,
                           'luna', v_citire.luna, 'motiv', btrim(p_motiv)));
    end if;
    v_numar := v_numar + 1;
  end loop;

  if v_numar = 0 then
    raise exception 'Nu mai sunt citiri de verificat pentru acest apartament si aceasta luna.';
  end if;

  return jsonb_build_object('validate', v_numar);
end;
$$;
