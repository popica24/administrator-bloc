-- Comanda care lipsea dupa revocarea scrierilor directe (audit 2: X05, D5).
--
-- Ieri s-a revocat insertul direct in financiar.miscari_fond, pentru ca o
-- miscare fara document si cu orice semn umfla soldul pe care il vad toti
-- locatarii. Intrarile vin din publicarea listei (financiar.la_lista_publicata);
-- iesirile nu mai aveau nicio cale, deci soldul fondului de reparatii crestea
-- la nesfarsit, chiar daca banii fusesera cheltuiti.
--
-- Regulile iesirii, toate verificate aici:
--   - doar administratorul blocului caruia ii apartine fondul (sau serviciul);
--   - suma este negativa: o iesire scoate bani, nu ii adauga;
--   - documentul justificativ (factura, chitanta, proces-verbal) este
--     obligatoriu si trebuie sa fie al aceleiasi asociatii;
--   - data nu poate fi in viitor;
--   - lista_id ramane null: randul de lista il scrie doar handlerul
--     ListaPublicata, iar indexul unic (fond_id, lista_id) este al lui.
-- Randul intra in audit.jurnal prin trigger-ul miscari_fond_audit.

create function financiar.inregistreaza_iesire_fond(
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
  'Singura cale prin care ies bani dintr-un fond. Suma este negativa, documentul justificativ este obligatoriu.';

revoke execute on function financiar.inregistreaza_iesire_fond(uuid, numeric, text, date, uuid) from public, anon;
grant execute on function financiar.inregistreaza_iesire_fond(uuid, numeric, text, date, uuid) to authenticated, service_role;
