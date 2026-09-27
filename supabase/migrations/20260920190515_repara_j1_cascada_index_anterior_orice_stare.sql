-- J1: cascada H1 (index_anterior recalculat dupa validare) atingea doar
-- citirile "trimisa" ale lunilor de dupa cea tocmai validata. Doua cai
-- readuc dublarea de consum pe care H1 trebuia sa o rezolve:
--
-- 1) Validare in afara ordinii cronologice, exact ce invita ecranul
--    AdminCitiri, care se deschide pe luna curenta. Daca administratorul
--    valideaza intai luna B (mai noua) si abia apoi luna A (mai veche), luna
--    B e deja "validata" cand A se valideaza; cascada veche o sarea (cauta
--    doar stare = 'trimisa'), asa ca index_anterior si consumul lunii B
--    raman inghetate la valoarea gresita pentru totdeauna, luna B nu se mai
--    poate revalida (valideaza_citire refuza o citire care nu mai e
--    "trimisa").
-- 2) Estimare fara nicio greseala: contorizare.estimeaza_citiri() insereaza
--    citirea lipsa direct ca "validata", dar nu recalculeaza nimic dupa ea.
--    Daca luna urmatoare fusese deja transmisa si validata cat luna
--    estimata inca lipsea, indexul ei anterior a fost inghetat sarind peste
--    luna lipsa; estimarea o umple abia acum, iar luna urmatoare ramane cu
--    un index_anterior prea mic, deci recalculeaza (dubleaza) consumul
--    lunii tocmai estimate.
--
-- Reparatie: o singura functie de cascada, contorizare.recalculeaza_viitorul,
-- apelata dupa acceptarea unei citiri (valideaza_citire,
-- valideaza_citiri_apartament) si dupa estimare (estimeaza_citiri). Ea
-- recalculeaza index_anterior (si, prin coloana generata, consum) al
-- tuturor citirilor de dupa luna data, ale aceluiasi contor, indiferent de
-- starea lor (trimisa sau validata) cu doua exceptii: o citire respinsa nu
-- conteaza niciodata (index_anterior() o ignora deja), iar o luna a carei
-- lista e deja publicata nu se mai atinge (banii ei sunt inghetati de
-- motor, invariantul central al aplicatiei).

create or replace function contorizare.recalculeaza_viitorul(p_contor_id uuid, p_bloc_id uuid, p_dupa_luna date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update contorizare.citiri c2
     set index_anterior = contorizare.index_anterior(c2.contor_id, c2.luna)
   where c2.contor_id = p_contor_id
     and c2.luna > p_dupa_luna
     and c2.stare <> 'respinsa'
     and not exists (
       select 1 from intretinere.liste_lunare ll
       where ll.bloc_id = p_bloc_id and ll.luna = c2.luna and ll.stare = 'publicata'
     );
end;
$$;

comment on function contorizare.recalculeaza_viitorul(uuid, uuid, date) is
  'J1: dupa ce o citire devine validata (prin validare sau estimare), recalculeaza index_anterior al citirilor mai noi ale aceluiasi contor, oricare le-ar fi starea (mai putin respinsa), fara sa atinga o luna deja publicata.';

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

  -- J1: cascada acopera acum orice stare de dupa (mai putin respinsa), nu
  -- doar "trimisa", vezi contorizare.recalculeaza_viitorul.
  if p_accepta then
    perform contorizare.recalculeaza_viitorul(v_citire.contor_id, v_citire.bloc_id, v_citire.luna);
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

    -- J1: aceeasi cascada extinsa ca in valideaza_citire, pe contorul acestei citiri.
    if p_accepta then
      perform contorizare.recalculeaza_viitorul(v_citire.contor_id, v_citire.bloc_id, v_citire.luna);
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

create or replace function contorizare.estimeaza_citiri(p_bloc_id uuid, p_luna date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contor contorizare.contoare;
  v_medie numeric;
  v_anterior numeric;
  v_n integer := 0;
  v_zi_limita smallint;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul blocului estimeaza citirile.';
  end if;
  select coalesce(zi_limita_citire, 25) into v_zi_limita
    from contorizare.setari_contorizare where bloc_id = p_bloc_id;
  if current_date < (p_luna + (coalesce(v_zi_limita, 25) - 1) * interval '1 day')::date then
    raise exception 'Poti estima citirile lunii % abia dupa ziua % a lunii.', p_luna, coalesce(v_zi_limita, 25);
  end if;
  if exists (
    select 1 from intretinere.liste_lunare
    where bloc_id = p_bloc_id and luna = p_luna and stare = 'publicata'
  ) then
    raise exception 'Lista lunii % este deja publicata; citirile nu se mai pot estima.', p_luna;
  end if;
  for v_contor in
    select * from contorizare.contoare c
    where c.bloc_id = p_bloc_id and c.apartament_id is not null and c.scos_la is null
      and not exists (select 1 from contorizare.citiri x where x.contor_id = c.id and x.luna = p_luna and x.stare <> 'respinsa')
  loop
    select coalesce(round(avg(consum), 3), 0) into v_medie
    from (
      select x.consum from contorizare.citiri x
      where x.contor_id = v_contor.id and x.luna < p_luna and x.stare = 'validata' and x.sursa <> 'pornire'
      order by x.luna desc limit 3
    ) ultimele;
    v_anterior := contorizare.index_anterior(v_contor.id, p_luna);
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare, verificata_de, verificata_la)
    values (v_contor.id, v_contor.tip, v_contor.bloc_id, v_contor.apartament_id, p_luna, v_anterior, v_anterior + v_medie, 'estimat', 'validata', auth.uid(), now());
    v_n := v_n + 1;

    -- J1: o citire estimata devine "validata" direct, fara sa treaca prin
    -- valideaza_citire, nimeni nu cascada pana acum daca luna urmatoare
    -- fusese deja transmisa/validata sarind peste aceasta luna, lipsa.
    perform contorizare.recalculeaza_viitorul(v_contor.id, v_contor.bloc_id, p_luna);
  end loop;
  return v_n;
end;
$$;

grant execute on function contorizare.recalculeaza_viitorul(uuid, uuid, date) to service_role;
