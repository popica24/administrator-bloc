-- [S3] Restul unei datorii nu depinde de cine vede platile.
--
-- financiar.datorii_rest este `security_invoker`, deci si citirea alocarilor
-- din interiorul ei trece prin RLS. Dupa ce platile au fost inchise pe
-- perioada locatarului (migratia dinainte), un chirias mutat azi nu mai vedea
-- alocarile facute de cel dinaintea lui: datoriile platite de acela ii apareau
-- ca neplatite, iar "Total de plata acum" sarea de la 718,09 la 2.004,93 lei.
--
-- Cat s-a alocat pe o datorie este o proprietate a datoriei, nu a platii: se
-- citeste cu o functie `security definer`, ca restul sa iasa la fel pentru
-- oricine are voie sa vada datoria. Ce a platit fiecare, si cu ce chitanta,
-- ramane inchis pe perioada lui.

create function financiar.alocat_pe_datorie(p_datorie_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(a.suma), 0) from financiar.alocari_plati a where a.datorie_id = p_datorie_id;
$$;

comment on function financiar.alocat_pe_datorie(uuid) is
  'Cat s-a alocat pe o datorie, indiferent cine vede platile: restul datoriei este al datoriei, nu al platitorului (S3).';

revoke execute on function financiar.alocat_pe_datorie(uuid) from public, anon;
grant execute on function financiar.alocat_pe_datorie(uuid) to authenticated, service_role;

create or replace view financiar.datorii_rest
with (security_invoker = true) as
with capacitate as (
  select d.id, d.lista_id, d.apartament_id, d.tip, d.creat_la,
         greatest(d.suma - financiar.alocat_pe_datorie(d.id), 0) as cap
  from financiar.datorii d
  where d.lista_id is not null
    and (d.tip = 'intretinere' or (d.tip = 'corectie' and d.suma > 0))
),
reducere as (
  select d.lista_id, d.apartament_id,
         -sum(d.suma - financiar.alocat_pe_datorie(d.id)) as de_scazut
  from financiar.datorii d
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
         when d.tip = 'penalizare' then d.suma - financiar.alocat_pe_datorie(d.id)
           + coalesce((
               select sum(x.suma) from financiar.datorii x
               where x.tip = 'anulare_penalizare' and x.anuleaza_datorie_id = d.id
             ), 0)
         else d.suma - financiar.alocat_pe_datorie(d.id)
           - coalesce((select i.scade + i.ramasita from impartire i where i.id = d.id), 0)
       end as rest,
       d.anuleaza_datorie_id
from financiar.datorii d;
