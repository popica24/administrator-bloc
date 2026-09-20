-- financiar.inregistreaza_iesire_fond citea soldul fara niciun lock (audit 2:
-- G1), spre deosebire de restul codului de bani (financiar.conturi, mereu cu
-- `for update`). Doua iesiri concurente pentru tot soldul fondului au fost
-- reproduse manual (doua sesiuni psql, aceeasi logica): amandoua au citit
-- acelasi sold vechi, amandoua au trecut verificarea "nu duce pe minus" si
-- fondul a ajuns pe minus dupa ce amandoua au fost inregistrate.
--
-- Aici este lock-ul care lipsea: verificarea de proprietate ("fondul e al
-- unui bloc administrat de tine") ia acum si un `for update of f` pe randul
-- din financiar.fonduri. A doua cerere pentru acelasi fond asteapta prima
-- tranzactie sa se termine, deci citeste soldul proaspat, nu unul vechi.
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
  'Singura cale prin care ies bani dintr-un fond. Suma este negativa, documentul justificativ este obligatoriu, soldul fondului nu poate scadea sub zero, iar randul fondului este blocat (for update) cat dureaza verificarea, ca doua iesiri simultane sa nu citeasca acelasi sold vechi.';
