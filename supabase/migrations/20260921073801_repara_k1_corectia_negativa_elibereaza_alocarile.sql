-- [K1] O corectie negativa pe o datorie deja platita elibereaza banii platiti
-- in plus, ca sa scada urmatoarea datorie deschisa.
--
-- Pana acum: ap. 1 plateste intretinerea din august (504,86 lei), apoi lista
-- din august se recalculeaza cu 10% mai putin, deci primeste o corectie de
-- -50,49. Datoria din august ramanea cu restul -50,49 (platita peste cat se
-- datoreaza acum), iar financiar.aloca_avansuri nu avea ce muta: reia doar
-- platile cu bani nealocati, iar plata aceea era alocata integral pe august.
-- Pe lista din septembrie, de 400 de lei, omului i se cereau tot 400, desi
-- registrul (financiar.solduri) spunea 349,51. Reparatia F2 corectase restul
-- afisat, nu si locul banilor.
--
-- Acum, dupa o corectie negativa, alocarile care depasesc datoria corectata se
-- elibereaza (cele mai noi intai), iar aloca_avansuri le muta pe cea mai veche
-- datorie deschisa. Daca nu exista alta datorie deschisa, banii raman avans al
-- apartamentului, ca orice plata facuta inainte de lista.
--
-- Niciun ban nu se creeaza si nu se pierde: plata ramane alocata cu aceeasi
-- suma, doar pe alta datorie. Chitanta platii, care isi construieste randurile
-- din alocarile curente, arata dupa corectie unde se socotesc banii acum (de
-- exemplu 454,37 pentru august si 50,49 pentru septembrie).

-- Alocarile unei plati pe datoria de intretinere a unei liste, peste suma pe
-- care o mai datoreaza apartamentul dupa corectiile negative ale listei.
-- Restul din financiar.datorii_rest include deja aceste corectii (F2): un rest
-- negativ inseamna exact cat s-a alocat in plus. Idempotenta: la o a doua
-- rulare restul este deja 0 si nu se mai elibereaza nimic.
create or replace function financiar.elibereaza_alocari_in_plus(p_apartament_id uuid, p_lista_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_datorie uuid;
  v_plus numeric(12, 2);
  v_a record;
  v_x numeric(12, 2);
begin
  select id into v_datorie
    from financiar.datorii
    where tip = 'intretinere' and lista_id = p_lista_id and apartament_id = p_apartament_id;
  if not found then
    return;
  end if;

  select -rest into v_plus from financiar.datorii_rest where id = v_datorie;
  if v_plus <= 0 then
    return;
  end if;

  for v_a in
    select a.id, a.suma
      from financiar.alocari_plati a
      join financiar.plati p on p.id = a.plata_id
      where a.datorie_id = v_datorie
      order by p.confirmata_la desc, a.creat_la desc, a.id desc
      for update of a
  loop
    exit when v_plus <= 0;
    v_x := least(v_plus, v_a.suma);
    -- alocari_plati.suma > 0: o alocare golita se sterge, nu ramane pe zero
    if v_x = v_a.suma then
      delete from financiar.alocari_plati where id = v_a.id;
    else
      update financiar.alocari_plati set suma = suma - v_x where id = v_a.id;
    end if;
    v_plus := v_plus - v_x;
  end loop;
end;
$$;

comment on function financiar.elibereaza_alocari_in_plus(uuid, uuid) is
  'Dupa o corectie negativa, elibereaza alocarile care depasesc datoria de intretinere corectata a listei (cele mai noi intai), ca aloca_avansuri sa le mute pe urmatoarea datorie deschisa. [K1]';

revoke execute on function financiar.elibereaza_alocari_in_plus(uuid, uuid) from public, anon, authenticated;

-- Aceeasi functie ca inainte (definitia din 20260919120017_financiar.sql,
-- neschimbata de atunci), plus eliberarea alocarilor dupa o corectie negativa.
create or replace function financiar.la_lista_recalculata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista intretinere.liste_lunare;
  v_r record;
begin
  select * into v_lista from intretinere.liste_lunare where id = (p_date ->> 'lista_id')::uuid;
  for v_r in
    select a.id as apartament_id, a.bloc_id,
           coalesce((select sum(r.suma) from intretinere.repartizari r where r.lista_id = v_lista.id and r.apartament_id = a.id and r.versiune = (p_date ->> 'versiune')::smallint), 0)
           - coalesce((select sum(r.suma) from intretinere.repartizari r where r.lista_id = v_lista.id and r.apartament_id = a.id and r.versiune = (p_date ->> 'versiune_veche')::smallint), 0) as diferenta
    from organizare.apartamente a
    where a.bloc_id = v_lista.bloc_id
  loop
    continue when v_r.diferenta = 0;
    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, lista_id, versiune, suma, scadenta, descriere)
    values (v_r.apartament_id, v_r.bloc_id, 'corectie', v_lista.luna, v_lista.id, (p_date ->> 'versiune')::smallint, v_r.diferenta,
            greatest(v_lista.scadenta, current_date + 15), 'Corectie dupa recalcularea listei')
    on conflict (lista_id, versiune, apartament_id, tip) do nothing;
    if v_r.diferenta < 0 then
      perform financiar.elibereaza_alocari_in_plus(v_r.apartament_id, v_lista.id);
    end if;
    perform financiar.aloca_avansuri(v_r.apartament_id);
  end loop;
end;
$$;
