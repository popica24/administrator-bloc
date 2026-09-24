-- [B2] Aceiasi bani, o singura data: incasarea primeste o cheie a cererii.
--
-- Cand plata cu cardul a fost scoasa, o data cu coloanele procesatorului a
-- disparut si `plati_procesator_referinta_key`, singura cheie de deduplicare a
-- tabelei. Singura aparare ramasa era in ecran (butonul se blocheaza cat timp
-- comanda e in aer), ceea ce nu ajuta la:
--
--   administratorul incaseaza 500 de lei, cererea trece prin server, dar
--   raspunsul se pierde pe drum (retea mobila). El apasa din nou. In registru
--   intra doua plati de 500 de lei si doua chitante consecutive, soldul
--   apartamentului scade cu 500 de lei fata de realitate, iar a doua plata se
--   aloca pe datoriile urmatoare. Stornare nu exista: greseala ramane
--   definitiva.
--
-- Acum ecranul trimite o cheie a cererii (un uuid facut cand se deschide
-- formularul, acelasi la fiecare reincercare), iar a doua cerere cu aceeasi
-- cheie intoarce plata deja inregistrata, fara sa mai scrie nimic. Cheia este
-- unica pe apartament, deci nici doua cereri simultane nu trec amandoua.

alter table financiar.plati add column cheie_client uuid;

comment on column financiar.plati.cheie_client is
  'Cheia cererii care a inregistrat plata: a doua cerere cu aceeasi cheie intoarce aceeasi plata (B2).';

create unique index plati_cheie_client_key
  on financiar.plati (apartament_id, cheie_client)
  where cheie_client is not null;

-- inregistreaza_plata primeste cheia si o scrie pe plata
drop function financiar.inregistreaza_plata(uuid, numeric, text, timestamptz, uuid, uuid);

create function financiar.inregistreaza_plata(
  p_apartament_id uuid,
  p_suma numeric,
  p_metoda text,
  p_la timestamptz default now(),
  p_platita_de uuid default null,
  p_inregistrata_de uuid default null,
  p_cheie_client uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cont financiar.conturi;
  v_id uuid;
begin
  select * into v_cont from financiar.conturi where apartament_id = p_apartament_id for update;
  if not found then
    raise exception 'Apartamentul nu are cont.';
  end if;
  -- Verificarea merge pe suma rotunjita la ban (migratia
  -- repara_plata_suma_rotunjita_la_zero): 0,004 lei ar deveni o plata de 0 lei.
  if p_suma is null or round(p_suma, 2) <= 0 then
    raise exception 'Suma trebuie sa fie mai mare decat zero.';
  end if;
  insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare, platita_de, inregistrata_de, confirmata_la, creat_la, cheie_client)
  values (p_apartament_id, v_cont.bloc_id, round(p_suma, 2), p_metoda, 'confirmata', p_platita_de, p_inregistrata_de, p_la, p_la, p_cheie_client)
  returning id into v_id;
  perform financiar.aloca_plata(v_id);
  perform financiar.emite_chitanta(v_id);
  perform evenimente.inregistreaza('PlataConfirmata', 'financiar', p_apartament_id,
    jsonb_build_object('plata_id', v_id, 'apartament_id', p_apartament_id, 'bloc_id', v_cont.bloc_id, 'suma', round(p_suma, 2), 'metoda', p_metoda));
  return v_id;
end;
$$;

comment on function financiar.inregistreaza_plata(uuid, numeric, text, timestamptz, uuid, uuid, uuid) is
  'O plata confirmata, intr-o singura tranzactie: lock pe cont, plata, alocarea pe cea mai veche datorie, chitanta si evenimentul PlataConfirmata.';

revoke all on function financiar.inregistreaza_plata(uuid, numeric, text, timestamptz, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function financiar.inregistreaza_plata(uuid, numeric, text, timestamptz, uuid, uuid, uuid) to service_role;

-- inregistreaza_incasare: aceeasi cheie, aceeasi plata
drop function financiar.inregistreaza_incasare(uuid, numeric, text);

create function financiar.inregistreaza_incasare(p_apartament_id uuid, p_suma numeric, p_metoda text, p_cheie_client uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_apartament_id not in (select private.apartamente_administrate()) then
    raise exception 'Doar administratorul blocului inregistreaza incasari.';
  end if;
  if p_metoda is null or p_metoda not in ('numerar', 'transfer') then
    raise exception 'Banii primiti sunt fie in numerar, fie prin transfer bancar.';
  end if;
  if p_cheie_client is not null then
    select id into v_id from financiar.plati
     where apartament_id = p_apartament_id and cheie_client = p_cheie_client;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  begin
    return financiar.inregistreaza_plata(p_apartament_id, p_suma, p_metoda, now(), null, auth.uid(), p_cheie_client);
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

comment on function financiar.inregistreaza_incasare(uuid, numeric, text, uuid) is
  'Administratorul confirma banii primiti de la un apartament, in numerar sau prin transfer bancar: plata intra in registru, se aloca pe cea mai veche datorie si primeste chitanta. Cu aceeasi cheie a cererii, a doua incercare intoarce aceeasi plata (B2).';

revoke all on function financiar.inregistreaza_incasare(uuid, numeric, text, uuid) from public, anon;
grant execute on function financiar.inregistreaza_incasare(uuid, numeric, text, uuid) to authenticated, service_role;
