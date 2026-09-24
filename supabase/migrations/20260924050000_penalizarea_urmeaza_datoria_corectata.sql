-- [B1, B3] Penalizarea urmeaza datoria asa cum a ramas ea dupa corectii.
--
-- Doua lucruri, legate intre ele:
--
-- 1. Ordinea in care o corectie negativa se scade din randurile listei
--    (financiar.datorii_rest, adusa de migratia dinainte) devine cea fireasca:
--    intai corectiile pozitive, de la cea mai noua spre cea mai veche, si abia
--    la urma randul de intretinere. O corectie negativa anuleaza, de obicei,
--    corectia pozitiva de dinaintea ei; datoria de baza, cu scadenta ei
--    initiala, ramane unde era.
--
-- 2. K7 (anuleaza_penalizari_in_plus) se uita acum la toate penalizarile
--    listei, nu doar la cele calculate pe randul de intretinere, iar baza
--    fiecareia este cat a ramas din randul ei dupa corectii (restul din
--    registru plus ce s-a alocat deja pe el), fara sa creasca vreodata peste
--    ce s-a inghetat la calcul: "doar in jos".
--
-- Scenariul care nu mergea (auditul 4): intretinere 1000 cu penalizari de
-- 13,80 lei, corectie +500 care primeste si ea penalizare (1,60), apoi
-- corectie -500 care aduce lista inapoi la 1000. Datoria reala a fost 1000 tot
-- timpul, dar codul taia din penalizarile intretinerii ca si cum datoria ar fi
-- scazut la 500 (8,50 in loc de 13,80) si nu atingea deloc penalizarea
-- corectiei anulate. Acum penalizarea corectiei se anuleaza, iar cele ale
-- intretinerii raman intregi.

create or replace view financiar.datorii_rest
with (security_invoker = true) as
with alocat as (
  select datorie_id, sum(suma) as suma from financiar.alocari_plati group by datorie_id
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
)
select d.id, d.apartament_id, d.bloc_id, d.tip, d.luna, d.lista_id, d.versiune, d.suma, d.scadenta,
       d.descriere, d.document_id, d.creat_la, d.actualizat_la,
       case
         when d.tip = 'corectie' and d.suma < 0 and exists (
           select 1 from financiar.datorii s
           where s.tip = 'intretinere' and s.lista_id = d.lista_id and s.apartament_id = d.apartament_id
         ) then 0::numeric
         when d.tip = 'anulare_penalizare' then 0::numeric
         when d.tip = 'penalizare' then d.suma - coalesce((select a.suma from alocat a where a.datorie_id = d.id), 0)
           + coalesce((
               select sum(x.suma) from financiar.datorii x
               where x.tip = 'anulare_penalizare' and x.anuleaza_datorie_id = d.id
             ), 0)
         else d.suma - coalesce((select a.suma from alocat a where a.datorie_id = d.id), 0)
           - coalesce((select i.scade + i.ramasita from impartire i where i.id = d.id), 0)
       end as rest,
       d.anuleaza_datorie_id
from financiar.datorii d;

-- Cat a mai ramas dintr-o datorie dupa corectiile listei, fara sa tina cont de
-- ce s-a platit pe ea: baza pe care se calculeaza penalizarea.
create function financiar.baza_dupa_corectii(p_datorie_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    d.rest + coalesce((select sum(a.suma) from financiar.alocari_plati a where a.datorie_id = d.id), 0),
    0)
  from financiar.datorii_rest d
  where d.id = p_datorie_id;
$$;

comment on function financiar.baza_dupa_corectii(uuid) is
  'Cat a ramas dintr-o datorie dupa corectiile listei, fara scaderea platilor: baza penalizarii (B3).';

revoke execute on function financiar.baza_dupa_corectii(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- K7: toate penalizarile listei, fiecare pe baza randului ei
-- -----------------------------------------------------------------------------
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
      join financiar.datorii s on s.id = p.datorie_sursa_id
      where s.lista_id = p_lista_id and s.apartament_id = p_apartament_id
        and s.tip in ('intretinere', 'corectie')
      order by p.luna_calcul, p.id
  loop
    -- doar in jos: baza nu creste peste cea inghetata la calcul
    v_baza := greatest(least(v_p.rest_neachitat, financiar.baza_dupa_corectii(v_p.datorie_sursa_id)), 0);
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
  'K7: dupa o recalculare, reduce penalizarile listei la cat ar fi fost pe datoriile corectate. Doar in jos.';

-- -----------------------------------------------------------------------------
-- Penalizarile viitoare pornesc de la aceeasi baza
-- -----------------------------------------------------------------------------
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

    -- [B3] baza este cat a ramas din datorie dupa corectiile listei, indiferent
    -- daca randul este intretinerea sau o corectie a ei
    v_baza := financiar.baza_dupa_corectii(v_d.id);

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
