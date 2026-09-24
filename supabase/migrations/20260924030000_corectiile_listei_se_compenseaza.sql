-- [B1] Corectiile unei liste se compenseaza intre ele inainte de a atinge
-- randul de intretinere.
--
-- Pana acum, financiar.datorii_rest scadea din randul de intretinere TOATE
-- corectiile negative ale listei, fara sa le compenseze cu cele pozitive.
-- O lista urcata la 700 (corectie +400) si coborata apoi la 100 (corectie
-- -600) lasa registrul asa:
--
--   intretinere  300   rest -300
--   corectie    +400   rest  400
--   corectie    -600   rest    0
--
-- Suma resturilor ramanea 100, adica soldul corect, dar repartizarea pe randuri
-- era gresita si consecintele reale:
--   * aloca_plata sare peste randurile cu rest <= 0, deci cei -300 nu se mai
--     puteau consuma niciodata: plata de 100 (soldul real) se ducea pe corectia
--     de +400, care ramanea pe ecran cu 300 de plata, desi omul nu mai datora
--     nimic;
--   * elibereaza_alocari_in_plus elibera pana la 300 de lei de alocari reale
--     pentru o "supraplata" care nu exista;
--   * calculeaza_penalizari penaliza corectia pozitiva pe toata suma ei: 400 in
--     loc de 100, luna de luna.
--
-- Acum reducerea se imparte in ordine (intai intretinerea, apoi corectiile
-- pozitive, dupa data lor), fiecare rand pana la epuizarea lui. Ce ramane dupa
-- ce toate randurile listei au ajuns la zero cade tot pe intretinere, ca rest
-- negativ: acolo il asteapta elibereaza_alocari_in_plus, care il transforma in
-- avans (K1). Suma resturilor ramane soldul din registru, in orice ordine.

create or replace view financiar.datorii_rest
with (security_invoker = true) as
with alocat as (
  select datorie_id, sum(suma) as suma from financiar.alocari_plati group by datorie_id
),
-- randurile unei liste care pot primi bani: intretinerea si corectiile pozitive
capacitate as (
  select d.id, d.lista_id, d.apartament_id, d.tip, d.creat_la,
         greatest(d.suma - coalesce(a.suma, 0), 0) as cap
  from financiar.datorii d
  left join alocat a on a.datorie_id = d.id
  where d.lista_id is not null
    and (d.tip = 'intretinere' or (d.tip = 'corectie' and d.suma > 0))
),
-- cat trebuie scazut din fiecare pachet (lista, apartament)
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
         -- ordinea: intretinerea intai, apoi corectiile pozitive, dupa data
         greatest(least(
           c.cap,
           coalesce(r.de_scazut, 0) - coalesce(sum(c.cap) over (
             partition by c.lista_id, c.apartament_id
             order by (c.tip <> 'intretinere'), c.creat_la, c.id
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
