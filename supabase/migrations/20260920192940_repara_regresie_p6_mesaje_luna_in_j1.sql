-- Regresie introdusa de migratia J1
-- (20260920190515_repara_j1_cascada_index_anterior_orice_stare.sql):
-- functiile contorizare.valideaza_citire, valideaza_citiri_apartament si
-- estimeaza_citiri au fost recreate pornind de la versiunea lor dinaintea
-- migratiei P6 (mesaje_luna_in_romana), care le invatase sa scrie luna in
-- mesajul de refuz cu comunicare.luna_text() ("iunie 2026"), nu cu formatul
-- implicit al Postgres pentru date ("2026-06-01"). "Create or replace"
-- inlocuieste intreaga functie, deci corpul mai vechi a sters fara sa vrea
-- imbunatatirea P6, exact bug-ul "lista locatarului si raportul
-- administratorului nu se potrivesc", dar la nivel de mesaj de eroare:
-- testele care asteptau "Lista lunii iunie 2026 este deja publicata..."
-- primeau in schimb "Lista lunii 2026-06-01 este deja publicata...".
--
-- Reparatie: acelasi cod ca in J1 (cascada contorizare.recalculeaza_viitorul,
-- apelata in loc de update-ul inline pe stare = 'trimisa'), de data asta
-- pastrand comunicare.luna_text() in toate cele trei mesaje, ca in P6.

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
    raise exception 'Lista lunii % este deja publicata; citirile nu se mai pot verifica.', comunicare.luna_text(p_luna);
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
    raise exception 'Poti estima citirile lunii % abia dupa ziua % a lunii.', comunicare.luna_text(p_luna), coalesce(v_zi_limita, 25);
  end if;
  if exists (
    select 1 from intretinere.liste_lunare
    where bloc_id = p_bloc_id and luna = p_luna and stare = 'publicata'
  ) then
    raise exception 'Lista lunii % este deja publicata; citirile nu se mai pot estima.', comunicare.luna_text(p_luna);
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

    perform contorizare.recalculeaza_viitorul(v_contor.id, v_contor.bloc_id, p_luna);
  end loop;
  return v_n;
end;
$$;
