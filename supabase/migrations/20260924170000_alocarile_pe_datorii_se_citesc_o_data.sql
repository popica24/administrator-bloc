-- Restul datoriilor se calculeaza din nou dintr-o singura citire a alocarilor.
--
-- Migratia S3 a inlocuit citirea alocarilor din financiar.datorii_rest cu
-- financiar.alocat_pe_datorie(), ca restul unei datorii sa nu depinda de cine
-- vede platile. Functia se cheama insa o data pentru fiecare rand si de trei
-- ori in interiorul view-ului, adica zeci de interogari pentru o singura
-- citire a registrului: view-ul a ajuns de la sub o milisecunda la peste 45,
-- iar suita end-to-end de la 14 la 25 de minute.
--
-- Aceeasi regula, o singura citire: o functie care intoarce tabelul alocarilor
-- insumate pe datorie, chemata o data si legata prin join.

create function financiar.alocari_pe_datorii()
returns table (datorie_id uuid, suma numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select a.datorie_id, sum(a.suma) from financiar.alocari_plati a group by a.datorie_id;
$$;

comment on function financiar.alocari_pe_datorii() is
  'Cat s-a alocat pe fiecare datorie, indiferent cine vede platile (S3), intr-o singura citire.';

revoke execute on function financiar.alocari_pe_datorii() from public, anon;
grant execute on function financiar.alocari_pe_datorii() to authenticated, service_role;

create or replace view financiar.datorii_rest
with (security_invoker = true) as
with alocat as (
  select datorie_id, suma from financiar.alocari_pe_datorii()
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

-- functia pe o singura datorie ramane pentru locurile care au nevoie de ea
comment on function financiar.alocat_pe_datorie(uuid) is
  'Cat s-a alocat pe o datorie, indiferent cine vede platile (S3). Pentru un tabel intreg, financiar.alocari_pe_datorii().';
