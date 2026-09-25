-- [K7] O penalizare deja calculata se reduce cand o recalculare a listei scade
-- datoria pe care fusese calculata.
--
-- Pana acum penalizarea ramanea intreaga, deci totalul depindea de ordine:
-- penalizari apoi corectie la 0 lasa o penalizare pe o datorie care, de fapt,
-- nu existase; corectie apoi penalizari da 0. Aceeasi stare finala, doua
-- rezultate.
--
-- Decizia (21 septembrie, varianta A): penalizarea se recalculeaza pe datoria
-- corectata, cu parametrii inghetati in financiar.penalizari (procentul,
-- zilele taxate), ca si cum lista ar fi fost corecta de la inceput. Doar in
-- jos: o corectie care mareste datoria nu mareste retroactiv o penalizare pe
-- care omul nu avea cum sa o evite.
--
-- Registrul ramane append-only: penalizarea nu se modifica, ci primeste un rand
-- nou, "anulare_penalizare", negativ si legat de ea prin anuleaza_datorie_id,
-- pe care locatarul il vede. Restul ei (datorii_rest) scade cu anularea, iar
-- anularea nu are rest propriu, ca o corectie negativa fata de intretinerea ei
-- (F2). Daca penalizarea fusese platita, banii anulati se elibereaza si merg pe
-- urmatoarea datorie deschisa sau raman avans, ca la K1.
--
-- Tot aici:
-- - aloca_plata citeste restul din financiar.datorii_rest, in loc sa-l
--   recalculeze singura: avea o copie a formulei, care ar fi trebuit schimbata
--   si ea (lectia de la K4: o singura definitie a restului);
-- - plafonul din calculeaza_penalizari scade penalizarile nete, dupa anulari.

-- -----------------------------------------------------------------------------
-- Schema: tipul nou si legatura spre penalizarea anulata
-- -----------------------------------------------------------------------------
alter table financiar.datorii
  add column anuleaza_datorie_id uuid references financiar.datorii (id) on delete restrict;

comment on column financiar.datorii.anuleaza_datorie_id is
  'Doar pentru tip anulare_penalizare: penalizarea pe care o reduce (K7).';

-- Anularile unei penalizari: restul ei in datorii_rest si calculul K7.
create index datorii_anuleaza_datorie_id_idx on financiar.datorii (anuleaza_datorie_id)
  where anuleaza_datorie_id is not null;

alter table financiar.datorii drop constraint datorii_tip_check;
alter table financiar.datorii add constraint datorii_tip_check
  check (tip in ('intretinere', 'penalizare', 'fond_rulment', 'sold_initial', 'corectie', 'anulare_penalizare'));

alter table financiar.datorii drop constraint datorii_suma_check;
alter table financiar.datorii add constraint datorii_suma_check
  check ((tip = 'corectie' and suma <> 0)
      or (tip = 'anulare_penalizare' and suma < 0)
      or (tip not in ('corectie', 'anulare_penalizare') and suma > 0));

-- O anulare arata mereu spre o datorie, si doar o anulare arata spre alta datorie.
alter table financiar.datorii add constraint datorii_anulare_check
  check ((tip = 'anulare_penalizare') = (anuleaza_datorie_id is not null));

-- Si spre o penalizare a aceluiasi apartament, indiferent cine scrie.
create or replace function financiar.verifica_anulare_penalizare()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from financiar.datorii p
    where p.id = new.anuleaza_datorie_id and p.tip = 'penalizare' and p.apartament_id = new.apartament_id
  ) then
    raise exception 'O anulare de penalizare trebuie sa arate spre o penalizare a aceluiasi apartament.';
  end if;
  return new;
end;
$$;

comment on function financiar.verifica_anulare_penalizare() is
  'K7: o anulare_penalizare reduce doar o penalizare a aceluiasi apartament.';

revoke execute on function financiar.verifica_anulare_penalizare() from public, anon, authenticated;

create trigger datorii_verifica_anulare_penalizare
  before insert or update of tip, anuleaza_datorie_id, apartament_id on financiar.datorii
  for each row
  -- fara tinta raspunde datorii_anulare_check; aici se verifica doar tinta
  when (new.tip = 'anulare_penalizare' and new.anuleaza_datorie_id is not null)
  execute function financiar.verifica_anulare_penalizare();

-- -----------------------------------------------------------------------------
-- Restul: penalizarea scade cu anularile ei; anularea nu are rest propriu
-- -----------------------------------------------------------------------------
-- Definitia de baza este cea din 20260920151015_minor_datorii_rest_corectie_orfana.sql;
-- se adauga ramura anulare_penalizare, anularile in restul penalizarii si,
-- la capat (singurul loc permis de create or replace), coloana noua.
create or replace view financiar.datorii_rest
with (security_invoker = true) as
select d.id, d.apartament_id, d.bloc_id, d.tip, d.luna, d.lista_id, d.versiune, d.suma, d.scadenta,
       d.descriere, d.document_id, d.creat_la, d.actualizat_la,
       case
         when d.tip = 'corectie' and d.suma < 0 and exists (
           select 1 from financiar.datorii s
           where s.tip = 'intretinere' and s.lista_id = d.lista_id and s.apartament_id = d.apartament_id
         ) then 0::numeric
         when d.tip = 'anulare_penalizare' then 0::numeric
         else d.suma - coalesce((select sum(a.suma) from financiar.alocari_plati a where a.datorie_id = d.id), 0)
           + case
               when d.tip = 'intretinere' then coalesce((
                 select sum(c.suma - coalesce((select sum(a2.suma) from financiar.alocari_plati a2 where a2.datorie_id = c.id), 0))
                 from financiar.datorii c
                 where c.tip = 'corectie' and c.suma < 0
                   and c.lista_id = d.lista_id and c.apartament_id = d.apartament_id
               ), 0)
               when d.tip = 'penalizare' then coalesce((
                 select sum(x.suma) from financiar.datorii x
                 where x.tip = 'anulare_penalizare' and x.anuleaza_datorie_id = d.id
               ), 0)
               else 0
             end
       end as rest,
       d.anuleaza_datorie_id
from financiar.datorii d;

-- -----------------------------------------------------------------------------
-- aloca_plata citeste restul din datorii_rest
-- -----------------------------------------------------------------------------
-- Pana acum repeta formula restului din datorii_rest. Ordinea ramane aceeasi:
-- intai cea mai veche scadenta.
create or replace function financiar.aloca_plata(p_plata_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plata financiar.plati;
  v_ramas numeric(12, 2);
  v_d record;
  v_x numeric(12, 2);
begin
  select * into v_plata from financiar.plati where id = p_plata_id;
  if not found or v_plata.stare <> 'confirmata' then
    return;
  end if;
  v_ramas := v_plata.suma - coalesce((select sum(suma) from financiar.alocari_plati where plata_id = p_plata_id), 0);
  for v_d in
    select d.id, d.rest
    from financiar.datorii_rest d
    where d.apartament_id = v_plata.apartament_id
    order by d.scadenta, d.creat_la, d.id
  loop
    exit when v_ramas <= 0;
    continue when v_d.rest <= 0;
    v_x := least(v_ramas, v_d.rest);
    insert into financiar.alocari_plati (plata_id, datorie_id, suma)
    values (p_plata_id, v_d.id, v_x)
    on conflict (plata_id, datorie_id) do update set suma = financiar.alocari_plati.suma + excluded.suma;
    v_ramas := v_ramas - v_x;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Eliberarea alocarilor in plus, pentru orice datorie
-- -----------------------------------------------------------------------------
-- K1 o facea doar pentru datoria de intretinere a unei liste; acum si pentru o
-- penalizare anulata. Un rest negativ inseamna exact cat s-a alocat in plus.
create or replace function financiar.elibereaza_alocari_datoriei(p_datorie_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plus numeric(12, 2);
  v_a record;
  v_x numeric(12, 2);
begin
  select -rest into v_plus from financiar.datorii_rest where id = p_datorie_id;
  if v_plus is null or v_plus <= 0 then
    return;
  end if;
  for v_a in
    select a.id, a.suma
      from financiar.alocari_plati a
      join financiar.plati p on p.id = a.plata_id
      where a.datorie_id = p_datorie_id
      order by p.confirmata_la desc, a.creat_la desc, a.id desc
      for update of a
  loop
    exit when v_plus <= 0;
    v_x := least(v_plus, v_a.suma);
    if v_x = v_a.suma then
      delete from financiar.alocari_plati where id = v_a.id;
    else
      update financiar.alocari_plati set suma = suma - v_x where id = v_a.id;
    end if;
    v_plus := v_plus - v_x;
  end loop;
end;
$$;

comment on function financiar.elibereaza_alocari_datoriei(uuid) is
  'Elibereaza alocarile care depasesc restul unei datorii (cele mai noi intai), ca aloca_avansuri sa le mute. Folosita de K1 si K7.';

revoke execute on function financiar.elibereaza_alocari_datoriei(uuid) from public, anon, authenticated;

-- K1 ramane cu aceeasi semnatura, dar trece prin functia generala.
create or replace function financiar.elibereaza_alocari_in_plus(p_apartament_id uuid, p_lista_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_datorie uuid;
begin
  select id into v_datorie
    from financiar.datorii
    where tip = 'intretinere' and lista_id = p_lista_id and apartament_id = p_apartament_id;
  if found then
    perform financiar.elibereaza_alocari_datoriei(v_datorie);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Anularea penalizarilor care nu mai au baza
-- -----------------------------------------------------------------------------
-- Pentru fiecare penalizare calculata pe datoria de intretinere a listei:
-- baza corectata = restul inghetat la calcul plus corectiile negative venite
-- dupa calcul (cele de dinainte erau deja in rest, H3), fara sa coboare sub 0;
-- penalizarea corecta = aceeasi formula, cu parametrii inghetati, niciodata
-- mai mare decat cea initiala. Se anuleaza diferenta fata de ce a ramas dupa
-- anularile anterioare, deci o a doua rulare nu mai anuleaza nimic.
create or replace function financiar.anuleaza_penalizari_in_plus(p_apartament_id uuid, p_lista_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sursa financiar.datorii;
  v_p record;
  v_baza numeric(12, 2);
  v_tinta numeric(12, 2);
  v_acum numeric(12, 2);
begin
  select * into v_sursa
    from financiar.datorii
    where tip = 'intretinere' and lista_id = p_lista_id and apartament_id = p_apartament_id;
  if not found then
    return;
  end if;

  for v_p in
    select p.*, d.luna as luna_penalizare
      from financiar.penalizari p
      join financiar.datorii d on d.id = p.datorie_id
      where p.datorie_sursa_id = v_sursa.id
      order by p.luna_calcul, p.id
  loop
    v_baza := greatest(v_p.rest_neachitat + coalesce((
      select sum(c.suma) from financiar.datorii c
      where c.tip = 'corectie' and c.suma < 0
        and c.lista_id = p_lista_id and c.apartament_id = p_apartament_id
        and c.creat_la > v_p.creat_la
    ), 0), 0);
    v_tinta := least(v_p.suma, v_baza, round(v_baza * v_p.procent_zi / 100 * v_p.zile_taxate, 2));
    v_acum := v_p.suma + coalesce((
      select sum(x.suma) from financiar.datorii x
      where x.tip = 'anulare_penalizare' and x.anuleaza_datorie_id = v_p.datorie_id
    ), 0);
    continue when v_tinta >= v_acum;

    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere, anuleaza_datorie_id)
    values (v_sursa.apartament_id, v_sursa.bloc_id, 'anulare_penalizare', v_p.luna_penalizare, v_tinta - v_acum,
            current_date, 'Penalizare anulata dupa recalcularea listei', v_p.datorie_id);
    perform financiar.elibereaza_alocari_datoriei(v_p.datorie_id);
  end loop;
end;
$$;

comment on function financiar.anuleaza_penalizari_in_plus(uuid, uuid) is
  'K7: dupa o corectie negativa, reduce penalizarile calculate pe datoria de intretinere a listei la cat ar fi fost pe datoria corectata.';

revoke execute on function financiar.anuleaza_penalizari_in_plus(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Recalcularea: dupa o corectie negativa, si penalizarile
-- -----------------------------------------------------------------------------
-- Definitia de baza este cea din 20260921122646_repara_k8_recalcularea_aplica_intai_publicarea.sql;
-- se adauga doar anularea penalizarilor.
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

  -- [K8] publicarea intai, daca evenimentul ei n-a fost inca procesat
  if not exists (select 1 from financiar.datorii where lista_id = v_lista.id and tip = 'intretinere') then
    perform financiar.la_lista_publicata(c.date)
      from evenimente.coada c
      where c.tip = 'ListaPublicata' and c.agregat_id = v_lista.id;
  end if;

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
      -- [K7] penalizarile calculate pe datoria care tocmai a scazut
      perform financiar.anuleaza_penalizari_in_plus(v_r.apartament_id, v_lista.id);
    end if;
    perform financiar.aloca_avansuri(v_r.apartament_id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Plafonul penalizarilor viitoare: penalizarile nete, dupa anulari
-- -----------------------------------------------------------------------------
-- Definitia de baza este cea din 20260920145414_h3_penalizari_folosesc_restul_corectat.sql;
-- se schimba doar calculul plafonului.
create or replace function financiar.calculeaza_penalizari(p_la date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d record;
  v_inceput date;
  v_ultim date;
  v_dela date;
  v_zile integer;
  v_baza numeric(12, 2);
  v_rest numeric(12, 2);
  v_plafon numeric(12, 2);
  v_suma numeric(12, 2);
  v_pen uuid;
  v_n integer := 0;
begin
  for v_d in
    select d.*, s.procent_penalizare_zi, s.zile_gratie
    from financiar.datorii d
    join organizare.blocuri b on b.id = d.bloc_id
    join financiar.setari_financiare s on s.asociatie_id = b.asociatie_id
    where d.tip <> 'penalizare' and d.suma > 0 and d.scadenta < p_la
    order by d.apartament_id, d.scadenta, d.creat_la
  loop
    continue when exists (select 1 from financiar.penalizari where datorie_sursa_id = v_d.id and luna_calcul = p_la);
    v_inceput := v_d.scadenta + v_d.zile_gratie;
    select max(luna_calcul) into v_ultim from financiar.penalizari where datorie_sursa_id = v_d.id;
    v_dela := greatest(v_inceput, coalesce(v_ultim, v_inceput));
    v_zile := p_la - v_dela;
    continue when v_zile <= 0;

    perform 1 from financiar.conturi where apartament_id = v_d.apartament_id for update;

    -- H1 pe bani: baza corectata, la fel ca in financiar.datorii_rest -
    -- o datorie de intretinere este redusa de corectiile negative de pe
    -- aceeasi lista si acelasi apartament.
    v_baza := v_d.suma + case when v_d.tip = 'intretinere' then
        coalesce((
          select sum(c.suma)
          from financiar.datorii c
          where c.tip = 'corectie' and c.suma < 0
            and c.lista_id = v_d.lista_id and c.apartament_id = v_d.apartament_id
        ), 0)
      else 0 end;

    v_rest := v_baza - coalesce((select sum(a.suma) from financiar.alocari_plati a where a.datorie_id = v_d.id), 0);
    continue when v_rest <= 0;
    -- [K7] penalizarile deja cerute pe aceasta datorie, nete de anulari
    v_plafon := v_baza
      - coalesce((select sum(p.suma) from financiar.penalizari p where p.datorie_sursa_id = v_d.id), 0)
      - coalesce((
          select sum(x.suma)
          from financiar.datorii x
          join financiar.penalizari p on p.datorie_id = x.anuleaza_datorie_id
          where x.tip = 'anulare_penalizare' and p.datorie_sursa_id = v_d.id
        ), 0);
    v_suma := least(v_rest, v_plafon, round(v_rest * v_d.procent_penalizare_zi / 100 * v_zile, 2));
    continue when v_suma <= 0;

    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere)
    values (v_d.apartament_id, v_d.bloc_id, 'penalizare', date_trunc('month', p_la)::date, v_suma, p_la,
            'Penalizare pentru ' || lower(v_d.descriere))
    returning id into v_pen;
    insert into financiar.penalizari (datorie_sursa_id, datorie_id, luna_calcul, rest_neachitat, zile_intarziere, zile_gratie, zile_taxate, procent_zi, suma)
    values (v_d.id, v_pen, p_la, v_rest, p_la - v_d.scadenta, v_d.zile_gratie, v_zile, v_d.procent_penalizare_zi, v_suma);
    perform financiar.aloca_avansuri(v_d.apartament_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
