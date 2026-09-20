-- Doua mesaje de refuz tipareau numarul asa cum il formateaza Postgres implicit
-- ("105.0000 din 100"), cu punct si patru zecimale, in loc de formatul
-- romanesc pe care il foloseste restul aplicatiei ("105,00") (audit 2: F2).
--
-- public.numar_ro este un helper mic, reutilizabil oriunde un mesaj de eroare
-- trebuie sa arate un numar catre un om: doua zecimale fixe, cu virgula.
create or replace function public.numar_ro(p_numar numeric, p_zecimale integer default 2)
returns text
language sql
immutable
as $$
  select case
    when p_zecimale <= 0 then to_char(round(p_numar, 0), 'FM999999999990')
    else replace(to_char(round(p_numar, p_zecimale), 'FM999999999990.' || repeat('0', p_zecimale)), '.', ',')
  end;
$$;

comment on function public.numar_ro(numeric, integer) is
  'Formateaza un numar pe romaneste (virgula zecimala, doua zecimale implicit), pentru mesajele de eroare aratate utilizatorului.';

create or replace function organizare.schimba_fisa_apartament(
  p_apartament_id uuid,
  p_proprietar_nume text,
  p_cota_indiviza numeric,
  p_suprafata_mp numeric,
  p_scutit_lift boolean,
  p_etaj smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ap organizare.apartamente;
  v_stare text;
  v_suma numeric(9, 4);
begin
  select * into v_ap from organizare.apartamente
   where id = p_apartament_id
     and (bloc_id in (select private.blocuri_administrate()) or private.este_serviciu())
   for update;
  if not found then
    raise exception 'Apartamentul nu exista sau nu este in blocul tau.';
  end if;

  if coalesce(btrim(p_proprietar_nume), '') = '' then
    raise exception 'Scrie numele proprietarului.';
  end if;
  if p_cota_indiviza is null or p_cota_indiviza <= 0 or p_cota_indiviza > 100 then
    raise exception 'Cota indiviza trebuie sa fie un numar intre 0 si 100.';
  end if;
  if p_suprafata_mp is not null and p_suprafata_mp <= 0 then
    raise exception 'Suprafata trebuie sa fie mai mare decat zero.';
  end if;
  if p_etaj is null then
    raise exception 'Scrie etajul apartamentului.';
  end if;

  select stare into v_stare from organizare.blocuri where id = v_ap.bloc_id;
  if v_stare = 'activ' and round(p_cota_indiviza, 4) <> v_ap.cota_indiviza then
    select coalesce(sum(cota_indiviza), 0) - v_ap.cota_indiviza + round(p_cota_indiviza, 4)
      into v_suma
      from organizare.apartamente where bloc_id = v_ap.bloc_id;
    if abs(v_suma - 100) > 0.01 then
      raise exception 'Cotele blocului ar ajunge la % din 100. Schimba si celelalte apartamente, altfel lista nu se mai imparte corect.', public.numar_ro(v_suma);
    end if;
  end if;

  update organizare.apartamente
     set proprietar_nume = btrim(p_proprietar_nume),
         cota_indiviza = p_cota_indiviza,
         suprafata_mp = p_suprafata_mp,
         scutit_lift = p_scutit_lift,
         etaj = p_etaj
   where id = p_apartament_id;
end;
$$;

comment on function organizare.schimba_fisa_apartament(uuid, text, numeric, numeric, boolean, smallint) is
  'Singura cale de a schimba fisa unui apartament. Pe un bloc activ, cotele trebuie sa ramana 100.';

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
    raise exception 'Cotele trimise insumeaza %, nu 100. Corecteaza-le pe toate inainte de a le salva.', public.numar_ro(v_suma);
  end if;

  update organizare.apartamente a
     set cota_indiviza = round((e ->> 'cota')::numeric, 4)
    from jsonb_array_elements(p_cote) e
   where a.id = (e ->> 'apartament_id')::uuid and a.bloc_id = p_bloc_id;
end;
$$;

comment on function organizare.schimba_cotele_blocului(uuid, jsonb) is
  'Rescrie cota fiecarui apartament din bloc dintr-o data, cu suma verificata o singura data pe lista intreaga. p_cote: [{"apartament_id", "cota"}, ...], cate o intrare pentru fiecare apartament al blocului. Blocheaza randul blocului (for update) cat dureaza, ca o inrolare confirmata in acelasi timp sa nu ramana in afara numararii.';
