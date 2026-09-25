-- Redistribuirea cotelor unui bloc intreg (audit 2, urmarea X06/D1: C4).
--
-- organizare.schimba_fisa_apartament schimba un singur apartament, iar pe un
-- bloc activ refuza orice cota care ar duce suma cotelor mai departe de 100
-- cu peste 0,01. Corect ca regula, dar fara nicio cale de a o respecta: suma
-- este mereu 100 pe un bloc activ, deci orice redistribuire reala (a lua doua
-- procente de la un apartament si a le da altuia) trece printr-o stare
-- intermediara in care suma nu mai e 100, iar comanda de-a apartament refuza
-- primul pas.
--
-- Aici este comanda care lipsea: primeste dintr-o data cota fiecarui
-- apartament din bloc si verifica suma o singura data, pe lista intreaga, nu
-- pe fiecare pas. schimba_fisa_apartament ramane singura cale pentru nume,
-- suprafata, scutirea de lift si etaj (si pentru o corectie mica de cota, sub
-- pragul de 0,01, sau pe un bloc inca in configurare).
--
-- Reguli:
--   - doar administratorul blocului (sau serviciul);
--   - lista trebuie sa acopere exact apartamentele blocului: nici unul in
--     plus, nici unul lipsa, nici unul de doua ori, altfel suma verificata
--     nu ar mai fi suma reala a blocului dupa scriere;
--   - fiecare cota este un numar intre 0 (exclusiv) si 100 (inclusiv);
--   - suma lor ramane 100, cu aceeasi toleranta de 0,01 ca la activare
--     (organizare.activeaza_bloc) si ca la schimba_fisa_apartament.
-- Fiecare actualizare intra in audit.jurnal prin trigger-ul apartamente_audit,
-- care exista din migratia organizare.

create function organizare.schimba_cotele_blocului(
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
  'Rescrie cota fiecarui apartament din bloc dintr-o data, cu suma verificata o singura data pe lista intreaga. p_cote: [{"apartament_id", "cota"}, ...], cate o intrare pentru fiecare apartament al blocului.';

revoke execute on function organizare.schimba_cotele_blocului(uuid, jsonb) from public, anon;
grant execute on function organizare.schimba_cotele_blocului(uuid, jsonb) to authenticated, service_role;
