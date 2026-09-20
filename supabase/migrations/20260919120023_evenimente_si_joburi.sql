-- Legaturile dintre contexte si joburile programate (docs/schema-propunere.md
-- §2.5, §2.6, §5, §11.4):
--   1. inrolarea unui bloc de pe hartie: verificari_bloc, confirma_inrolare,
--      activeaza_bloc si handlerele ApartamentCreat;
--   2. dispecerul evenimentelor: evenimente.proceseaza ruleaza handlerele
--      contextelor consumatoare pentru un eveniment;
--   3. Database Webhook: fiecare eveniment nou anunta Edge Function-ul
--      proceseaza-eveniment prin pg_net, dupa commit;
--   4. pg_cron: penalizarile lunare, reminderele zilnice si reluarea
--      evenimentelor ramase neprocesate.

-- =============================================================================
-- 1. Inrolarea unui bloc
-- =============================================================================

-- Ce mai lipseste pana cand blocul poate fi activat (§11.4). Administratorul il
-- vede tot timpul: "ati introdus 87,4 din 100".
create view organizare.verificari_bloc
with (security_invoker = true)
as
select b.id as bloc_id,
       b.stare,
       (select count(*) from organizare.apartamente a where a.bloc_id = b.id) as apartamente,
       (select coalesce(sum(a.cota_indiviza), 0) from organizare.apartamente a where a.bloc_id = b.id) as suma_cote,
       (select count(*) from organizare.apartamente a
         where a.bloc_id = b.id
           and not exists (select 1 from organizare.apartamente_persoane p where p.apartament_id = a.id)) as apartamente_fara_persoane,
       (select count(*) from contorizare.contoare c
         where c.bloc_id = b.id and c.scos_la is null
           and not exists (select 1 from contorizare.citiri x where x.contor_id = c.id and x.stare = 'validata')) as contoare_fara_index,
       (select count(*) from organizare.inrolare_apartamente i where i.bloc_id = b.id and i.stare = 'propus') as randuri_propuse
from organizare.blocuri b;

comment on view organizare.verificari_bloc is
  'Blocul se poate activa cand cotele insumeaza 100, fiecare apartament are persoane, fiecare contor are index de pornire si nu mai sunt randuri propuse.';

grant select on organizare.verificari_bloc to authenticated, service_role;

-- Transforma un rand propus, verificat cu foaia de hartie, in apartament.
-- Indexurile de pornire si restanta ajung in Contorizare si Financiar prin
-- evenimentul ApartamentCreat.
create function organizare.confirma_inrolare(p_inrolare_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r organizare.inrolare_apartamente;
  v_ap uuid;
  v_luna date;
begin
  select * into v_r from organizare.inrolare_apartamente where id = p_inrolare_id for update;
  if not found or v_r.stare <> 'propus' then
    raise exception 'Randul nu exista sau a fost deja confirmat.';
  end if;
  if v_r.bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul blocului confirma randurile.';
  end if;
  v_luna := coalesce((v_r.date ->> 'luna_start')::date, date_trunc('month', current_date)::date);

  insert into organizare.apartamente (bloc_id, numar, etaj, scutit_lift, proprietar_nume, cota_indiviza, suprafata_mp)
  values (
    v_r.bloc_id, v_r.numar,
    coalesce((v_r.date ->> 'etaj')::smallint, 0),
    coalesce((v_r.date ->> 'scutit_lift')::boolean, coalesce((v_r.date ->> 'etaj')::smallint, 0) = 0),
    v_r.date ->> 'proprietar',
    (v_r.date ->> 'cota')::numeric,
    (v_r.date ->> 'suprafata')::numeric
  )
  returning id into v_ap;

  insert into organizare.apartamente_persoane (apartament_id, valabil_din, numar_persoane, motiv, modificat_de)
  values (v_ap, v_luna, coalesce((v_r.date ->> 'persoane')::smallint, 0), 'Preluat de pe lista de hartie', auth.uid());

  update organizare.inrolare_apartamente
     set stare = 'confirmat', confirmat_de = auth.uid(), confirmat_la = now(), apartament_id = v_ap
   where id = p_inrolare_id;

  perform evenimente.inregistreaza('ApartamentCreat', 'organizare', v_ap, jsonb_build_object(
    'apartament_id', v_ap, 'bloc_id', v_r.bloc_id, 'luna', v_luna, 'document_id', v_r.document_id,
    'restanta', coalesce((v_r.date ->> 'restanta')::numeric, 0),
    'restanta_scadenta', v_r.date ->> 'restanta_scadenta',
    'restanta_descriere', v_r.date ->> 'restanta_descriere',
    'serie_rece', v_r.date ->> 'serie_rece', 'serie_calda', v_r.date ->> 'serie_calda',
    'index_rece', v_r.date -> 'index_rece', 'index_calda', v_r.date -> 'index_calda'));
  return v_ap;
end;
$$;

create function organizare.activeaza_bloc(p_bloc_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v organizare.verificari_bloc;
begin
  if p_bloc_id not in (select private.blocuri_administrate()) and not private.este_serviciu() then
    raise exception 'Doar administratorul blocului il poate activa.';
  end if;
  select * into v from organizare.verificari_bloc where bloc_id = p_bloc_id;
  if v.apartamente = 0 or abs(v.suma_cote - 100) > 0.01 or v.apartamente_fara_persoane > 0
     or v.contoare_fara_index > 0 or v.randuri_propuse > 0 then
    raise exception 'Blocul nu este complet: % apartamente, cote % din 100, % fara persoane, % contoare fara index, % randuri neconfirmate.',
      v.apartamente, v.suma_cote, v.apartamente_fara_persoane, v.contoare_fara_index, v.randuri_propuse;
  end if;
  update organizare.blocuri set stare = 'activ', activat_la = now() where id = p_bloc_id and stare <> 'activ';
end;
$$;

-- "Pe cine suni": contactele asociatiei cu numarul apartamentului lor. Locatarul
-- nu poate citi alte apartamente, dar numarul apartamentului presedintelui sau
-- al cenzorului face parte din contact.
create function organizare.contacte_asociatie(p_asociatie_id uuid)
returns table (id uuid, rol text, nume text, telefon text, program text, apartament_numar text, ordine smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_asociatie_id not in (select private.asociatii_vizibile()) then
    raise exception 'Nu ai acces la aceasta asociatie.';
  end if;
  return query
  select c.id, c.rol, c.nume, c.telefon, c.program, a.numar, c.ordine
  from organizare.contacte c
  left join organizare.apartamente a on a.id = c.apartament_id
  where c.asociatie_id = p_asociatie_id
    and (c.bloc_id is null or c.bloc_id in (select private.blocuri_vizibile()))
  order by c.ordine, c.nume;
end;
$$;

revoke execute on function organizare.contacte_asociatie(uuid) from public, anon;
grant execute on function organizare.contacte_asociatie(uuid) to authenticated, service_role;

-- ApartamentCreat in Contorizare: contoarele si indexurile de pornire, citite
-- in luna de start (luna zero, §11.5); consumul se factureaza de luna urmatoare.
create function contorizare.la_apartament_creat(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tip text;
  v_index numeric;
  v_contor uuid;
begin
  foreach v_tip in array array['rece', 'calda'] loop
    v_index := (p_date ->> ('index_' || v_tip))::numeric;
    continue when v_index is null;
    select id into v_contor from contorizare.contoare
      where apartament_id = (p_date ->> 'apartament_id')::uuid and tip = v_tip and scos_la is null;
    if v_contor is null then
      insert into contorizare.contoare (bloc_id, apartament_id, tip, serie, amplasare)
      values ((p_date ->> 'bloc_id')::uuid, (p_date ->> 'apartament_id')::uuid, v_tip, p_date ->> ('serie_' || v_tip), 'baie')
      returning id into v_contor;
    end if;
    insert into contorizare.citiri (contor_id, tip, bloc_id, apartament_id, luna, index_anterior, index_curent, sursa, stare, document_id)
    values (v_contor, v_tip, (p_date ->> 'bloc_id')::uuid, (p_date ->> 'apartament_id')::uuid,
            (p_date ->> 'luna')::date, v_index, v_index, 'pornire', 'validata', (p_date ->> 'document_id')::uuid)
    on conflict do nothing;
    v_contor := null;
  end loop;
end;
$$;

-- ApartamentCreat in Financiar: restanta de pe hartie, cu documentul ei.
create function financiar.la_apartament_creat(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into financiar.conturi (apartament_id, bloc_id)
  values ((p_date ->> 'apartament_id')::uuid, (p_date ->> 'bloc_id')::uuid)
  on conflict (apartament_id) do nothing;
  if coalesce((p_date ->> 'restanta')::numeric, 0) > 0
     and not exists (select 1 from financiar.datorii where apartament_id = (p_date ->> 'apartament_id')::uuid and tip = 'sold_initial') then
    insert into financiar.datorii (apartament_id, bloc_id, tip, suma, scadenta, descriere, document_id)
    values ((p_date ->> 'apartament_id')::uuid, (p_date ->> 'bloc_id')::uuid, 'sold_initial', (p_date ->> 'restanta')::numeric,
            coalesce((p_date ->> 'restanta_scadenta')::date, current_date),
            coalesce(p_date ->> 'restanta_descriere', 'Restanta preluata de pe lista de plata pe hartie'),
            (p_date ->> 'document_id')::uuid);
  end if;
end;
$$;

revoke execute on function organizare.confirma_inrolare(uuid), organizare.activeaza_bloc(uuid) from public, anon;
grant execute on function organizare.confirma_inrolare(uuid), organizare.activeaza_bloc(uuid) to authenticated, service_role;
revoke execute on function contorizare.la_apartament_creat(jsonb), financiar.la_apartament_creat(jsonb) from public, anon, authenticated;
grant execute on function contorizare.la_apartament_creat(jsonb), financiar.la_apartament_creat(jsonb) to service_role;

-- O asociatie noua, intr-o singura tranzactie: asociatia, regulile de bani,
-- cele cinci remindere, blocul in configurare, setarile de citire si cele doua
-- fonduri. O apeleaza Edge Function-ul creeaza-asociatie (§11.2), doar cu
-- service_role. Idempotenta: o asociatie cu acelasi CUI este refolosita.
create function organizare.creeaza_asociatie(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asociatie uuid;
  v_bloc uuid;
  v_uat uuid;
begin
  if not private.este_serviciu() then
    raise exception 'Doar dezvoltatorul creeaza asociatii.';
  end if;
  select id into v_asociatie from organizare.asociatii where cui = p #>> '{asociatie,cui}';
  if v_asociatie is null then
    insert into organizare.asociatii (denumire, cui, iban, banca, adresa, telefon, email)
    values (p #>> '{asociatie,denumire}', p #>> '{asociatie,cui}', p #>> '{asociatie,iban}', p #>> '{asociatie,banca}',
            p #>> '{asociatie,adresa}', p #>> '{asociatie,telefon}', p #>> '{asociatie,email}')
    returning id into v_asociatie;
  end if;

  insert into financiar.setari_financiare (asociatie_id, procent_penalizare_zi, zile_gratie, zi_scadenta, chitanta_serie, chitanta_ultimul_numar)
  values (v_asociatie,
          coalesce((p #>> '{setari,procentPenalizareZi}')::numeric, 0.02),
          coalesce((p #>> '{setari,zileGratie}')::smallint, 30),
          coalesce((p #>> '{setari,ziScadenta}')::smallint, 25),
          coalesce(p #>> '{setari,chitantaSerie}', 'AP'),
          coalesce((p #>> '{setari,chitantaUltimulNumar}')::integer, 0))
  on conflict (asociatie_id) do nothing;

  insert into comunicare.remindere_setari (asociatie_id, tip, activ, zile)
  values (v_asociatie, 'lista_publicata', true, 0), (v_asociatie, 'citire_contoare', true, 5), (v_asociatie, 'plata', true, 3),
         (v_asociatie, 'restanta', true, 30), (v_asociatie, 'adunare_generala', false, 10)
  on conflict do nothing;

  if p ? 'bloc' then
    if p #>> '{bloc,uat_siruta}' is not null then
      select id into v_uat from nomenclator.administratii_locale where siruta = p #>> '{bloc,uat_siruta}';
    end if;
    select id into v_bloc from organizare.blocuri where asociatie_id = v_asociatie and denumire = p #>> '{bloc,denumire}';
    if v_bloc is null then
      insert into organizare.blocuri (asociatie_id, uat_id, denumire, adresa, etaje)
      values (v_asociatie, v_uat, p #>> '{bloc,denumire}', p #>> '{bloc,adresa}', coalesce((p #>> '{bloc,etaje}')::smallint, 0))
      returning id into v_bloc;
      insert into contorizare.setari_contorizare (bloc_id, zi_limita_citire)
      values (v_bloc, coalesce((p #>> '{bloc,ziLimitaCitire}')::smallint, 25));
      insert into financiar.fonduri (bloc_id, tip, denumire, suma_per_apartament)
      values (v_bloc, 'reparatii', 'Fond de reparatii', null),
             (v_bloc, 'rulment', 'Fond de rulment', (p #>> '{bloc,rulmentPerApartament}')::numeric);
    end if;
  end if;
  return jsonb_build_object('asociatie_id', v_asociatie, 'bloc_id', v_bloc);
end;
$$;

-- Primul administrator al asociatiei, deja verificat de dezvoltator.
create function identitate.numeste_administrator(p_profil_id uuid, p_asociatie_id uuid, p_numar_atestat text, p_activ_din date default current_date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.este_serviciu() then
    raise exception 'Doar dezvoltatorul numeste administratori.';
  end if;
  insert into identitate.administratori (profil_id, numar_atestat, stare, verificat_la)
  values (p_profil_id, p_numar_atestat, 'aprobat', now())
  on conflict (profil_id) do update set stare = 'aprobat', numar_atestat = coalesce(excluded.numar_atestat, identitate.administratori.numar_atestat);
  insert into identitate.membri_asociatie (asociatie_id, profil_id, rol, activ_din)
  values (p_asociatie_id, p_profil_id, 'administrator', p_activ_din)
  on conflict (asociatie_id, profil_id, rol) do nothing;
end;
$$;

revoke execute on function organizare.creeaza_asociatie(jsonb), identitate.numeste_administrator(uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function organizare.creeaza_asociatie(jsonb), identitate.numeste_administrator(uuid, uuid, text, date) to service_role;

-- =============================================================================
-- 2. Dispecerul
-- Un eveniment, toate handlerele lui, intr-un bloc cu exceptie: daca un
-- handler esueaza, efectele se anuleaza, randul ramane neprocesat cu eroarea
-- lui, iar jobul il reia. Handlerele sunt idempotente (§2.5).
-- =============================================================================

create function evenimente.proceseaza(p_id bigint)
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

-- Plasa de siguranta: tot ce a ramas neprocesat, in ordine.
create function evenimente.proceseaza_restante(p_limita integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_n integer := 0;
begin
  for v_id in
    select id from evenimente.coada
    where procesat_la is null and incercari < 10
    order by id
    limit p_limita
  loop
    if evenimente.proceseaza(v_id) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke execute on function evenimente.proceseaza(bigint), evenimente.proceseaza_restante(integer) from public, anon, authenticated;
grant execute on function evenimente.proceseaza(bigint), evenimente.proceseaza_restante(integer) to service_role;

-- Dispecerul este apelat de Edge Function-ul proceseaza-eveniment prin RPC.
-- Schema evenimente nu este expusa prin Data API, deci expunem doar aceste
-- doua functii, in public, tot numai pentru service_role.
create function public.proceseaza_eveniment(p_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select evenimente.proceseaza(p_id);
$$;

create function public.proceseaza_evenimente_restante()
returns integer
language sql
security definer
set search_path = ''
as $$
  select evenimente.proceseaza_restante(200);
$$;

revoke execute on function public.proceseaza_eveniment(bigint), public.proceseaza_evenimente_restante() from public, anon, authenticated;
grant execute on function public.proceseaza_eveniment(bigint), public.proceseaza_evenimente_restante() to service_role;

-- =============================================================================
-- 3. Database Webhook: evenimentul nou anunta Edge Function-ul
-- pg_net trimite cererea doar dupa commit. URL-ul si cheia stau in Vault
-- (seed-ul local le scrie); fara ele trigger-ul nu face nimic, iar jobul de
-- mai jos preia evenimentul.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

create function evenimente.anunta_functia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_cheie text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'url_proceseaza_eveniment';
  select decrypted_secret into v_cheie from vault.decrypted_secrets where name = 'cheie_serviciu';
  if v_url is null or v_cheie is null then
    return null;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('id', new.id, 'tip', new.tip),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_cheie),
    timeout_milliseconds := 5000
  );
  return null;
end;
$$;

revoke execute on function evenimente.anunta_functia() from public, anon, authenticated;

create trigger coada_anunta_functia
  after insert on evenimente.coada
  for each row execute function evenimente.anunta_functia();

-- =============================================================================
-- 4. pg_cron
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;

-- Penalizarile: pe 1 ale fiecarei luni, la 00:05.
select cron.schedule('calculeaza-penalizari', '5 0 1 * *', $$select financiar.calculeaza_penalizari(current_date)$$);

-- Reminderele automate: zilnic la 09:00.
select cron.schedule('trimite-remindere', '0 9 * * *', $$select comunicare.trimite_remindere_zilnice()$$);

-- Evenimentele ramase neprocesate: in fiecare minut.
select cron.schedule('proceseaza-evenimente', '* * * * *', $$select evenimente.proceseaza_restante(200)$$);

-- Evenimentele procesate se sterg dupa 30 de zile (§10.4).
select cron.schedule('curata-evenimente', '30 3 * * *', $$delete from evenimente.coada where procesat_la < now() - interval '30 days'$$);
