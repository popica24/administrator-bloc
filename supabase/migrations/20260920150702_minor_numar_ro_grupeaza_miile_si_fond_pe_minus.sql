-- Doua defecte minore de formatare a numerelor in mesajele de refuz:
--
-- 1) public.numar_ro() punea virgula zecimala, dar nu grupa miile: "1234,50"
--    in loc de "1.234,50", cum arata restul aplicatiei (RandLista, listele
--    de plata).
-- 2) financiar.inregistreaza_iesire_fond() nu folosea public.numar_ro():
--    refuzul "Fondul are % lei; o iesire de % lei l-ar duce pe minus."
--    folosea direct to_char cu punct zecimal si fara separator de mii
--    ("749.50", "800.00"), englezesc, chiar langa alte mesaje care deja
--    foloseau formatul romanesc.
--
-- Reparatie: numar_ro grupeaza acum cifrele intregii in grupe de trei, cu
-- punct; inregistreaza_iesire_fond foloseste numar_ro in loc de to_char.

create or replace function public.numar_ro(p_numar numeric, p_zecimale integer default 2)
returns text
language sql
immutable
as $$
  with baza as (
    select to_char(
             round(abs(p_numar), greatest(p_zecimale, 0)),
             'FM999999999999990' || case when p_zecimale > 0 then '.' || repeat('0', p_zecimale) else '' end
           ) as f
  ),
  parti as (
    select split_part(f, '.', 1) as intreg,
           case when p_zecimale > 0 then split_part(f, '.', 2) end as zecimal
    from baza
  )
  select
    case when p_numar < 0 then '-' else '' end
    || regexp_replace(intreg, '(\d)(?=(\d{3})+(?!\d))', '\1.', 'g')
    || case when zecimal is not null then ',' || zecimal else '' end
  from parti;
$$;

comment on function public.numar_ro(numeric, integer) is
  'Formateaza un numar pe romaneste (punct la mii, virgula zecimala, doua zecimale implicit), pentru mesajele de eroare aratate utilizatorului.';

create or replace function financiar.inregistreaza_iesire_fond(
  p_fond_id uuid,
  p_suma numeric,
  p_descriere text,
  p_data date,
  p_document_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asociatie uuid;
  v_sold numeric;
  v_id uuid;
begin
  select b.asociatie_id into v_asociatie
    from financiar.fonduri f
    join organizare.blocuri b on b.id = f.bloc_id
   where f.id = p_fond_id
     and (f.bloc_id in (select private.blocuri_administrate()) or private.este_serviciu())
   for update of f;
  if not found then
    raise exception 'Fondul nu exista sau nu este al unui bloc administrat de tine.';
  end if;

  if p_suma is null or p_suma >= 0 then
    raise exception 'Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.';
  end if;

  select coalesce(sum(m.suma), 0) into v_sold from financiar.miscari_fond m where m.fond_id = p_fond_id;
  if v_sold + p_suma < 0 then
    raise exception 'Fondul are % lei; o iesire de % lei l-ar duce pe minus.',
      public.numar_ro(v_sold), public.numar_ro(-p_suma);
  end if;

  if coalesce(btrim(p_descriere), '') = '' then
    raise exception 'Scrie pentru ce au iesit banii din fond.';
  end if;
  if p_document_id is null then
    raise exception 'Fiecare iesire din fond are nevoie de documentul care o justifica.';
  end if;
  if not exists (select 1 from comunicare.documente d where d.id = p_document_id and d.asociatie_id = v_asociatie) then
    raise exception 'Documentul nu este al asociatiei tale.';
  end if;
  if p_data is null or p_data > current_date then
    raise exception 'Data iesirii din fond nu poate fi in viitor.';
  end if;

  insert into financiar.miscari_fond (fond_id, data, suma, descriere, lista_id, document_id, creat_de)
  values (p_fond_id, p_data, round(p_suma, 2), btrim(p_descriere), null, p_document_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
