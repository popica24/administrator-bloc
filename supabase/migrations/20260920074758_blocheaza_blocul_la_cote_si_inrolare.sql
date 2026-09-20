-- organizare.schimba_cotele_blocului numara apartamentele si scrie cotele
-- fara niciun lock (audit 2: G8): daca intre numarare si scriere se confirma
-- o inrolare (organizare.confirma_inrolare, singura cale prin care apar
-- apartamente noi pe un bloc deja activ), verificarea "lista acopera exact
-- apartamentele blocului" lucreaza pe numarul vechi. Redistribuirea trece,
-- apartamentul nou ramane in afara ei, si suma reala a blocului depaseste 100.
--
-- Fixul blocheaza randul blocului (organizare.blocuri, `for update`) in
-- amandoua functiile: cine ajunge primul (o inrolare confirmata sau o
-- redistribuire de cote) tine locul cat dureaza operatia, iar celalalt
-- asteapta si lucreaza apoi pe numarul proaspat de apartamente.

create or replace function organizare.confirma_inrolare(p_inrolare_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r organizare.inrolare_apartamente;
  v_ap uuid;
  v_luna date;
begin
  select * into v_r from organizare.inrolare_apartamente where id = p_inrolare_id for update;
  if not found or v_r.stare <> 'propus' then
    raise exception 'Randul nu exista sau a fost deja confirmat.';
  end if;
  if v_r.bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul blocului confirma randurile.';
  end if;

  -- Blocheaza randul blocului cat dureaza adaugarea apartamentului, ca o
  -- redistribuire de cote pornita in acelasi timp sa astepte si sa numere
  -- apartamentele din nou, nu pe cele de dinainte.
  perform 1 from organizare.blocuri where id = v_r.bloc_id for update;

  v_luna := coalesce((v_r.date ->> 'luna_start')::date, date_trunc('month', current_date)::date);

  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza, suprafata_mp)
  values (
    v_r.bloc_id, v_r.numar,
    coalesce((v_r.date ->> 'etaj')::smallint, 0),
    coalesce((v_r.date ->> 'scutit_lift')::boolean, coalesce((v_r.date ->> 'etaj')::smallint, 0) = 0),
    v_r.date ->> 'proprietar',
    (v_r.date ->> 'cota')::numeric,
    (v_r.date ->> 'suprafata')::numeric
  )
  returning id into v_ap;

  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane, motiv, modificat_de)
  values (v_ap, v_luna, coalesce((v_r.date ->> 'persoane')::smallint, 0), 'Preluat de pe lista de hartie', auth.uid());

  update organizare.inrolare_apartamente
     set stare = 'confirmat', confirmat_de = auth.uid(), confirmat_la = now(), apartament_id = v_ap
   where id = p_inrolare_id;

  perform evenimente.inregistreaza('ApartamentCreat', 'organizare', v_ap, jsonb_build_object(
    'apartament_id', v_ap, 'bloc_id', v_r.bloc_id, 'luna', v_luna, 'document_id', v_r.document_id,
    'restanta', coalesce((v_r.date ->> 'restanta')::numeric, 0),
    'restanta_scadenta', v_r.date ->> 'restanta_scadenta',
    'restanta_descriere', v_r.date ->> 'restanta_descriere',
    'serie_rece', v_r.date ->> 'serie_rece', 'serie_calda', v_r.date ->> 'serie_calda',
    'index_rece', v_r.date -> 'index_rece', 'index_calda', v_r.date -> 'index_calda'));
  return v_ap;
end;
$$;

comment on function organizare.confirma_inrolare(uuid) is
  'Transforma un rand propus in apartament activ. Blocheaza randul blocului (for update) cat dureaza, ca o redistribuire de cote pornita in acelasi timp sa numere apartamentele proaspat, nu pe cele de dinainte.';

create or replace function organizare.schimba_cotele_blocului(
  p_bloc_id uuid,
  p_cote jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numar_apartamente integer;
  v_numar_intrari integer;
  v_suma numeric(9, 4);
begin
  if not exists (
    select 1 from organizare.blocuri
     where id = p_bloc_id
       and (id in (select private.blocuri_administrate()) or private.este_serviciu())
     for update
  ) then
    raise exception 'Blocul nu exista sau nu este administrat de tine.';
  end if;

  if p_cote is null or jsonb_typeof(p_cote) <> 'array' or jsonb_array_length(p_cote) = 0 then
    raise exception 'Trimite cota fiecarui apartament din bloc.';
  end if;

  select count(*) into v_numar_apartamente from organizare.apartamente where bloc_id = p_bloc_id;
  select count(distinct (e ->> 'apartament_id')::uuid) into v_numar_intrari
    from jsonb_array_elements(p_cote) e;

  if v_numar_intrari <> v_numar_apartamente
     or jsonb_array_length(p_cote) <> v_numar_apartamente
     or exists (
       select 1 from jsonb_array_elements(p_cote) e
        where not exists (
          select 1 from organizare.apartamente a
           where a.id = (e ->> 'apartament_id')::uuid and a.bloc_id = p_bloc_id
        )
     )
  then
    raise exception 'Lista trebuie sa contina o singura cota pentru fiecare apartament din bloc, fara lipsuri sau duplicate.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_cote) e
     where (e ->> 'cota') is null or (e ->> 'cota')::numeric <= 0 or (e ->> 'cota')::numeric > 100
  ) then
    raise exception 'Cota indiviza trebuie sa fie un numar intre 0 si 100.';
  end if;

  select sum((e ->> 'cota')::numeric) into v_suma from jsonb_array_elements(p_cote) e;
  if abs(v_suma - 100) > 0.01 then
    raise exception 'Cotele trimise insumeaza %, nu 100. Corecteaza-le pe toate inainte de a le salva.', v_suma;
  end if;

  update organizare.apartamente a
     set cota_indiviza = round((e ->> 'cota')::numeric, 4)
    from jsonb_array_elements(p_cote) e
   where a.id = (e ->> 'apartament_id')::uuid and a.bloc_id = p_bloc_id;
end;
$$;

comment on function organizare.schimba_cotele_blocului(uuid, jsonb) is
  'Rescrie cota fiecarui apartament din bloc dintr-o data, cu suma verificata o singura data pe lista intreaga. p_cote: [{"apartament_id", "cota"}, ...], cate o intrare pentru fiecare apartament al blocului. Blocheaza randul blocului (for update) cat dureaza, ca o inrolare confirmata in acelasi timp sa nu ramana in afara numararii.';
