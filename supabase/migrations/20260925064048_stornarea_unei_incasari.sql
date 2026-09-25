-- [T1] Stornarea unei incasari gresite.
--
-- Pana acum, o incasare scrisa gresit ramanea definitiva: suma gresita,
-- apartamentul gresit, un transfer confirmat care nu intrase niciodata in cont
-- sau bani inapoiati omului nu se puteau indrepta din aplicatie.
-- `financiar.plati.stare` permitea `rambursata`, dar nicio comanda nu o
-- producea (auditul 4, B2).
--
-- Cum se face: incasarea nu se sterge si nu se scrie in oglinda. Trece in
-- starea `rambursata`, cu motivul, cu cine a stornat-o si cand, iar de acolo
-- inainte nu se mai socoteste nicaieri: `financiar.solduri` aduna doar platile
-- confirmate, alocarile ei se elibereaza (deci datoriile se redeschid), iar
-- anularile de penalizare pe care le-a provocat nu se mai scad din penalizare.
-- Chitanta ramane cu numarul ei, marcata anulata: numerele nu au voie sa aiba
-- goluri, iar un document emis nu se rupe din carnet.
--
-- Se storneaza numai incasarile **scrise in luna curenta**, dupa ziua
-- inregistrarii, nu dupa data din extras: greseala se face cand scrii, deci se
-- repara in luna in care ai scris-o. Asa nu se clintesc lunile inchise.

-- -----------------------------------------------------------------------------
-- Tabelele: ce stie o plata stornata si ce anulare de penalizare stie plata ei
-- -----------------------------------------------------------------------------

alter table financiar.plati
  add column stornata_la timestamptz,
  add column stornata_de uuid references identitate.profiluri (id) on delete restrict,
  add column motiv_stornare text,
  -- o stornare este intreaga sau nu exista: data, motivul si starea merg impreuna
  add constraint plati_stornare_check
    check ((stornata_la is null) = (motiv_stornare is null)
           and (stornata_la is null or stare = 'rambursata')
           and (motiv_stornare is null or length(btrim(motiv_stornare)) > 0));

comment on column financiar.plati.stornata_la is
  'Cand a fost stornata incasarea. O plata stornata are stare = rambursata si nu se mai socoteste nicaieri (T1).';
comment on column financiar.plati.motiv_stornare is
  'De ce a fost stornata: administratorul il scrie, iar locatarul il vede la Platile mele (T1).';

alter table financiar.datorii
  add column provocata_de_plata_id uuid references financiar.plati (id) on delete restrict,
  add constraint datorii_provocata_check
    check (provocata_de_plata_id is null or tip = 'anulare_penalizare');

comment on column financiar.datorii.provocata_de_plata_id is
  'Plata care a provocat aceasta anulare de penalizare (B5). Daca plata se storneaza, anularea nu se mai socoteste (T1).';

create index datorii_provocata_de_plata_id_idx on financiar.datorii (provocata_de_plata_id)
  where provocata_de_plata_id is not null;

-- -----------------------------------------------------------------------------
-- Platile stornate, citite o data si fara RLS
-- -----------------------------------------------------------------------------
-- financiar.datorii_rest este `security_invoker`, deci nu are voie sa intrebe
-- direct tabela plati: un locatar nu vede platile celui dinaintea lui (S3) si
-- ar socoti altfel anularile. Restul unei datorii este al datoriei, nu al
-- platitorului.
create function financiar.plati_stornate()
returns table (plata_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from financiar.plati p where p.stare = 'rambursata';
$$;

comment on function financiar.plati_stornate() is
  'Platile stornate, pentru calculul restului: o anulare de penalizare provocata de o plata stornata nu se mai socoteste (T1).';

revoke execute on function financiar.plati_stornate() from public, anon;
grant execute on function financiar.plati_stornate() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Restul datoriilor: anularile platilor stornate nu se mai scad
-- -----------------------------------------------------------------------------
create or replace view financiar.datorii_rest
with (security_invoker = true) as
with alocat as (
  select datorie_id, suma from financiar.alocari_pe_datorii()
),
stornate as (
  select plata_id from financiar.plati_stornate()
),
capacitate as (
  select d.id, d.lista_id, d.apartament_id, d.tip, d.creat_la,
         greatest(d.suma - coalesce(a.suma, 0), 0) as cap
  from financiar.datorii d
  left join alocat a on a.datorie_id = d.id
  where d.lista_id is not null
    and (d.tip = 'intretinere' or (d.tip = 'corectie' and d.suma > 0))
),
reducere as (
  select d.lista_id, d.apartament_id,
         -sum(d.suma - coalesce(a.suma, 0)) as de_scazut
  from financiar.datorii d
  left join alocat a on a.datorie_id = d.id
  where d.tip = 'corectie' and d.suma < 0 and d.lista_id is not null
    and exists (
      select 1 from financiar.datorii s
      where s.tip = 'intretinere' and s.lista_id = d.lista_id and s.apartament_id = d.apartament_id
    )
  group by d.lista_id, d.apartament_id
),
impartire as (
  select c.id,
         -- intai corectiile pozitive, de la cea mai noua, apoi intretinerea
         greatest(least(
           c.cap,
           coalesce(r.de_scazut, 0) - coalesce(sum(c.cap) over (
             partition by c.lista_id, c.apartament_id
             order by (c.tip = 'intretinere'), c.creat_la desc, c.id desc
             rows between unbounded preceding and 1 preceding), 0)
         ), 0) as scade,
         case when c.tip = 'intretinere' then greatest(
           coalesce(r.de_scazut, 0) - coalesce(sum(c.cap) over (
             partition by c.lista_id, c.apartament_id), 0), 0)
         else 0 end as ramasita
  from capacitate c
  left join reducere r on r.lista_id = c.lista_id and r.apartament_id = c.apartament_id
),
anulat as (
  select x.anuleaza_datorie_id as datorie_id, sum(x.suma) as suma
  from financiar.datorii x
  where x.tip = 'anulare_penalizare'
    -- [T1] anularea provocata de o plata stornata nu se mai socoteste
    and (x.provocata_de_plata_id is null
         or x.provocata_de_plata_id not in (select plata_id from stornate))
  group by x.anuleaza_datorie_id
)
select d.id, d.apartament_id, d.bloc_id, d.tip, d.luna, d.lista_id, d.versiune, d.suma, d.scadenta,
       d.descriere, d.document_id, d.creat_la, d.actualizat_la,
       case
         when d.tip = 'corectie' and d.suma < 0 and exists (
           select 1 from financiar.datorii s
           where s.tip = 'intretinere' and s.lista_id = d.lista_id and s.apartament_id = d.apartament_id
         ) then 0::numeric
         when d.tip = 'anulare_penalizare' then 0::numeric
         when d.tip = 'penalizare' then d.suma - coalesce(al.suma, 0) + coalesce(an.suma, 0)
         else d.suma - coalesce(al.suma, 0) - coalesce(i.scade + i.ramasita, 0)
       end as rest,
       d.anuleaza_datorie_id
from financiar.datorii d
left join alocat al on al.datorie_id = d.id
left join anulat an on an.datorie_id = d.id
left join impartire i on i.id = d.id;

-- -----------------------------------------------------------------------------
-- Soldul socoteste aceleasi randuri ca restul datoriilor
-- -----------------------------------------------------------------------------
-- Altfel `datorii_rest` ar ignora anularea platii stornate, iar `solduri` ar
-- aduna-o mai departe: doua cifre diferite pentru aceiasi bani, exact ce nu
-- are voie sa se intample.
create or replace view financiar.solduri
with (security_invoker = true)
as
select c.apartament_id,
       c.bloc_id,
       coalesce((select sum(d.suma) from financiar.datorii d
                  where d.apartament_id = c.apartament_id
                    and (d.provocata_de_plata_id is null
                         or d.provocata_de_plata_id not in (select plata_id from financiar.plati_stornate()))), 0)
       - coalesce((select sum(p.suma) from financiar.plati p
                    where p.apartament_id = c.apartament_id and p.stare = 'confirmata'), 0) as sold
from financiar.conturi c;

-- -----------------------------------------------------------------------------
-- B5 scrie de acum si plata care a provocat anularea
-- -----------------------------------------------------------------------------
create or replace function financiar.anuleaza_penalizari_dupa_plata(p_plata_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plata financiar.plati;
  v_data date;
  v_azi date := (now() at time zone 'Europe/Bucharest')::date;
  v_p record;
  v_start date;
  v_zile_dupa integer;
  v_zile_inainte integer;
  v_baza_dupa numeric(12, 2);
  v_tinta numeric(12, 2);
  v_acum numeric(12, 2);
begin
  select * into v_plata from financiar.plati where id = p_plata_id;
  if not found or v_plata.stare <> 'confirmata' then
    return;
  end if;
  v_data := (v_plata.confirmata_la at time zone 'Europe/Bucharest')::date;
  -- o plata de azi nu are ce indrepta: banii chiar au lipsit pana azi
  if v_data >= v_azi then
    return;
  end if;

  for v_p in
    -- materialized: bucla schimba alocarile, iar randurile alese trebuie sa
    -- ramana cele de la inceput
    with alese as materialized (
      select p.id, p.datorie_id, p.datorie_sursa_id, p.luna_calcul, p.rest_neachitat,
             p.zile_taxate, p.procent_zi, p.suma, d.luna as luna_penalizare, a.suma as acoperit
        from financiar.penalizari p
        join financiar.datorii d on d.id = p.datorie_id
        join financiar.alocari_plati a on a.plata_id = p_plata_id and a.datorie_id = p.datorie_sursa_id
       where p.luna_calcul > v_data
    )
    select * from alese order by luna_calcul, id
  loop
    v_start := v_p.luna_calcul - v_p.zile_taxate;
    v_zile_dupa := greatest(v_p.luna_calcul - greatest(v_data, v_start), 0);
    v_zile_inainte := v_p.zile_taxate - v_zile_dupa;
    v_baza_dupa := greatest(v_p.rest_neachitat - v_p.acoperit, 0);
    v_tinta := least(
      v_p.suma,
      round(v_p.rest_neachitat * v_p.procent_zi / 100 * v_zile_inainte, 2)
        + round(v_baza_dupa * v_p.procent_zi / 100 * v_zile_dupa, 2));
    v_acum := v_p.suma + coalesce((
      select sum(x.suma) from financiar.datorii x
      where x.tip = 'anulare_penalizare' and x.anuleaza_datorie_id = v_p.datorie_id
    ), 0);
    continue when v_tinta >= v_acum;

    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, suma, scadenta, descriere,
                                   anuleaza_datorie_id, provocata_de_plata_id)
    values (v_plata.apartament_id, v_plata.bloc_id, 'anulare_penalizare', v_p.luna_penalizare, v_tinta - v_acum,
            current_date, 'Penalizare anulata: banii intrasera deja in cont', v_p.datorie_id, p_plata_id);
    perform financiar.elibereaza_alocari_datoriei(v_p.datorie_id);
  end loop;

  perform financiar.aloca_avansuri(v_plata.apartament_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Plata poarta ziua in care a fost scrisa in aplicatie
-- -----------------------------------------------------------------------------
-- creat_la era pus pe data din extras, la fel ca `confirmata_la`, deci o
-- incasare scrisa azi cu data de luna trecuta parea scrisa luna trecuta -- si
-- nu s-ar mai fi putut storna in ziua in care a fost gresita.
create or replace function financiar.inregistreaza_plata(
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
  insert into financiar.plati (apartament_id, bloc_id, suma, metoda, stare, platita_de, inregistrata_de, confirmata_la, cheie_client)
  values (p_apartament_id, v_cont.bloc_id, round(p_suma, 2), p_metoda, 'confirmata', p_platita_de, p_inregistrata_de, p_la, p_cheie_client)
  returning id into v_id;
  perform financiar.aloca_plata(v_id);
  -- [B5] plata cu data din trecut: penalizarile zilelor in care banii erau
  -- deja la asociatie se anuleaza inainte de emiterea chitantei
  perform financiar.anuleaza_penalizari_dupa_plata(v_id);
  perform financiar.emite_chitanta(v_id);
  perform evenimente.inregistreaza('PlataConfirmata', 'financiar', p_apartament_id,
    jsonb_build_object('plata_id', v_id, 'apartament_id', p_apartament_id, 'bloc_id', v_cont.bloc_id, 'suma', round(p_suma, 2), 'metoda', p_metoda));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Comanda: administratorul storneaza o incasare scrisa in luna curenta
-- -----------------------------------------------------------------------------
create function financiar.storneaza_incasare(p_plata_id uuid, p_motiv text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plata financiar.plati;
  v_motiv text := btrim(coalesce(p_motiv, ''));
begin
  select * into v_plata from financiar.plati where id = p_plata_id;
  if not found then
    raise exception 'Incasarea nu exista sau nu este in blocul tau.';
  end if;
  if v_plata.apartament_id not in (select private.apartamente_administrate()) then
    raise exception 'Doar administratorul blocului storneaza incasari.';
  end if;
  if v_motiv = '' then
    raise exception 'Scrie de ce stornezi incasarea.';
  end if;
  if v_plata.stare <> 'confirmata' then
    raise exception 'Incasarea a fost deja stornata.';
  end if;
  if date_trunc('month', v_plata.creat_la at time zone 'Europe/Bucharest')
     <> date_trunc('month', now() at time zone 'Europe/Bucharest') then
    raise exception 'Se storneaza doar incasarile inregistrate in luna aceasta.';
  end if;

  -- banii ies din socoteala: datoriile pe care le acoperea se redeschid
  delete from financiar.alocari_plati where plata_id = p_plata_id;
  update financiar.plati
     set stare = 'rambursata', stornata_la = now(), stornata_de = auth.uid(), motiv_stornare = v_motiv
   where id = p_plata_id;
  -- avansurile celorlalte plati se reaseaza pe datoriile redeschise
  perform financiar.aloca_avansuri(v_plata.apartament_id);

  perform evenimente.inregistreaza('PlataStornata', 'financiar', v_plata.apartament_id,
    jsonb_build_object('plata_id', p_plata_id, 'apartament_id', v_plata.apartament_id,
                       'bloc_id', v_plata.bloc_id, 'suma', v_plata.suma, 'motiv', v_motiv));
end;
$$;

comment on function financiar.storneaza_incasare(uuid, text) is
  'Administratorul anuleaza o incasare scrisa gresit in luna curenta: plata ramane in registru, dar nu se mai socoteste, alocarile ei se elibereaza si chitanta apare anulata (T1).';

revoke all on function financiar.storneaza_incasare(uuid, text) from public, anon;
grant execute on function financiar.storneaza_incasare(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Locatarul afla ca incasarea lui a fost anulata
-- -----------------------------------------------------------------------------
create function comunicare.la_plata_stornata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ch financiar.chitante;
  v_profil uuid;
  v_ap uuid := (p_date ->> 'apartament_id')::uuid;
begin
  select * into v_ch from financiar.chitante where plata_id = (p_date ->> 'plata_id')::uuid;
  for v_profil in select * from comunicare.locatari_apartamente(array[v_ap]) loop
    perform comunicare.notifica(v_profil, v_ch.asociatie_id, 'plata', 'O incasare a fost anulata',
      -- [NOU-1] G si D urmeaza lc_numeric al serverului (en_US), deci formatam
      -- cu '.' si ',' ca literali si le inversam, ca la la_plata_confirmata
      'Incasarea de ' || translate(to_char((p_date ->> 'suma')::numeric, 'FM999G999G999G990D00'), '.,', ',.') || ' lei, cu chitanta '
        || v_ch.serie || ' nr. ' || lpad(v_ch.numar::text, 6, '0') || ', a fost anulata de administrator: '
        || (p_date ->> 'motiv') || '. Suma a intrat la loc in ce ai de plata.',
      jsonb_build_object('plata_id', p_date ->> 'plata_id'));
  end loop;
end;
$$;

comment on function comunicare.la_plata_stornata(jsonb) is
  'Instiintarea locatarului dupa stornarea unei incasari: ce suma, care chitanta si de ce (T1).';

revoke execute on function comunicare.la_plata_stornata(jsonb) from public, anon, authenticated;

-- dispecerul: evenimentul nou isi are handlerul lui
create or replace function evenimente.proceseaza(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e evenimente.coada;
begin
  select * into v_e from evenimente.coada where id = p_id for update skip locked;
  if not found or v_e.procesat_la is not null then
    return false;
  end if;
  begin
    case v_e.tip
      when 'ListaPublicata' then
        perform financiar.la_lista_publicata(v_e.date);
        perform comunicare.la_lista_publicata(v_e.date);
      when 'ListaRecalculata' then
        perform financiar.la_lista_recalculata(v_e.date);
        perform comunicare.la_lista_recalculata(v_e.date);
      when 'ApartamentCreat' then
        perform contorizare.la_apartament_creat(v_e.date);
        perform financiar.la_apartament_creat(v_e.date);
      when 'CitireRespinsa' then
        perform comunicare.la_citire_respinsa(v_e.date);
      when 'SesizareRaspuns', 'SesizareRezolvata' then
        perform comunicare.la_sesizare(v_e.tip, v_e.date);
      when 'PlataConfirmata' then
        perform comunicare.la_plata_confirmata(v_e.date);
      when 'PlataStornata' then
        perform comunicare.la_plata_stornata(v_e.date);
      when 'VotDeschis', 'VotReamintit', 'AdunareConvocata' then
        perform comunicare.la_vot(v_e.tip, v_e.date);
      when 'AdministratorAprobat' then
        perform comunicare.la_administrator_aprobat(v_e.date);
      else
        -- CitireTransmisa, SesizareDeschisa: administratorul le vede direct in
        -- aplicatie; nu au inca un consumator.
        null;
    end case;
    update evenimente.coada
       set procesat_la = now(), incercari = incercari + 1, ultima_eroare = null
     where id = p_id;
    return true;
  exception when others then
    update evenimente.coada
       set incercari = incercari + 1, ultima_eroare = sqlerrm
     where id = p_id;
    return false;
  end;
end;
$$;
