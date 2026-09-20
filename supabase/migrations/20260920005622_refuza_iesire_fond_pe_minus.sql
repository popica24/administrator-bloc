-- financiar.inregistreaza_iesire_fond nu verifica soldul (audit 2: C5).
--
-- O iesire de zece ori soldul disponibil a fost acceptata si fondul a ajuns
-- la -173.057,40 lei, vizibil tuturor locatarilor pe ecranul de Fonduri: banii
-- care ies dintr-un fond de reparatii sunt banii adunati de locatari, deci nu
-- pot fi mai multi decat cati sunt inauntru.
--
-- Aici este verificarea care lipsea: soldul curent (financiar.fonduri_solduri,
-- suma miscarilor deja inregistrate) plus iesirea ceruta (negativa) nu poate
-- fi negativ. O iesire care goleste fondul exact la zero ramane permisa.
-- Restul functiei este neschimbat.

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
     and (f.bloc_id in (select private.blocuri_administrate()) or private.este_serviciu());
  if not found then
    raise exception 'Fondul nu exista sau nu este al unui bloc administrat de tine.';
  end if;

  if p_suma is null or p_suma >= 0 then
    raise exception 'Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.';
  end if;

  select coalesce(sum(m.suma), 0) into v_sold from financiar.miscari_fond m where m.fond_id = p_fond_id;
  if v_sold + p_suma < 0 then
    raise exception 'Fondul are % lei; o iesire de % lei l-ar duce pe minus.',
      to_char(v_sold, 'FM999999999990.00'), to_char(-p_suma, 'FM999999999990.00');
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

comment on function financiar.inregistreaza_iesire_fond(uuid, numeric, text, date, uuid) is
  'Singura cale prin care ies bani dintr-un fond. Suma este negativa, documentul justificativ este obligatoriu, iar soldul fondului nu poate scadea sub zero.';
