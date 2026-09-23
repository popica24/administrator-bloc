-- [B5] Transferul se inregistreaza cu data in care au intrat banii.
--
-- Banii intra in contul asociatiei pe 20 septembrie; administratorul verifica
-- extrasul si ii confirma pe 2 octombrie. Pana acum plata intra in registru cu
-- data de azi, deci chitanta purta 2 octombrie, iar zilele dintre 20 si 2 erau
-- zile de intarziere pentru apartament.
--
-- Acum ecranul poate spune data reala. Ea nu poate fi in viitor si nu poate
-- merge mai departe de sase luni in urma: o chitanta cu data de anul trecut nu
-- se mai poate emite din aplicatie, fiindca numerele de chitanta sunt date in
-- ordinea emiterii.
--
-- Ce ramane de facut: penalizarea calculata intre timp pe zilele acelea nu se
-- recalculeaza singura (vezi docs/audit-4-2026-09-24.md, B5).

drop function financiar.inregistreaza_incasare(uuid, numeric, text, uuid);

create function financiar.inregistreaza_incasare(
  p_apartament_id uuid,
  p_suma numeric,
  p_metoda text,
  p_cheie_client uuid default null,
  p_data date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_la timestamptz;
  v_azi date := (now() at time zone 'Europe/Bucharest')::date;
begin
  if p_apartament_id not in (select private.apartamente_administrate()) then
    raise exception 'Doar administratorul blocului inregistreaza incasari.';
  end if;
  if p_metoda is null or p_metoda not in ('numerar', 'transfer') then
    raise exception 'Banii primiti sunt fie in numerar, fie prin transfer bancar.';
  end if;
  if p_data is not null and p_data > v_azi then
    raise exception 'Data in care au intrat banii nu poate fi in viitor.';
  end if;
  if p_data is not null and p_data < v_azi - 180 then
    raise exception 'Data in care au intrat banii nu poate fi mai veche de sase luni.';
  end if;
  -- ora 12, ca ziua sa ramana aceeasi oriunde s-ar citi
  v_la := case when p_data is null then now()
               else (p_data + time '12:00') at time zone 'Europe/Bucharest' end;

  if p_cheie_client is not null then
    select id into v_id from financiar.plati
     where apartament_id = p_apartament_id and cheie_client = p_cheie_client;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  begin
    return financiar.inregistreaza_plata(p_apartament_id, p_suma, p_metoda, v_la, null, auth.uid(), p_cheie_client);
  exception when unique_violation then
    -- doua cereri deodata: a doua gaseste plata scrisa de prima
    select id into v_id from financiar.plati
     where apartament_id = p_apartament_id and cheie_client = p_cheie_client;
    if v_id is null then
      raise;
    end if;
    return v_id;
  end;
end;
$$;

comment on function financiar.inregistreaza_incasare(uuid, numeric, text, uuid, date) is
  'Administratorul confirma banii primiti de la un apartament, in numerar sau prin transfer bancar, cu data in care au intrat (B5): plata intra in registru, se aloca pe cea mai veche datorie si primeste chitanta. Cu aceeasi cheie a cererii, a doua incercare intoarce aceeasi plata (B2).';

revoke all on function financiar.inregistreaza_incasare(uuid, numeric, text, uuid, date) from public, anon;
grant execute on function financiar.inregistreaza_incasare(uuid, numeric, text, uuid, date) to authenticated, service_role;
