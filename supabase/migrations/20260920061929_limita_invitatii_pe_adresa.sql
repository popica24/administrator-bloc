-- A doua limita la codul de invitatie se muta de pe "toata lumea" pe adresa
-- de la care vine cererea.
--
-- Migratia limita_globala_incercari_invitatie a pus un plafon de 20 de
-- incercari gresite in ultimul sfert de ora, numarate peste toate conturile
-- la un loc, si refuza peste plafon orice cont, chiar cu un cod bun. Asta
-- este, de fapt, o cale ieftina de a bloca platforma: 20 de incercari gresite
-- opresc pentru un sfert de ora fiecare locatar din fiecare asociatie care
-- vrea sa-si foloseasca codul. S-a si intamplat, in timpul testelor.
--
-- Limita ramane, dar se numara pe adresa de la care vine cererea: atacatorul
-- isi blocheaza propria conexiune, iar ceilalti nu simt nimic. Adresa vine
-- din antetul x-forwarded-for, pe care PostgREST il pune in request.headers;
-- primul element este clientul, restul sunt proxy-urile. Cand adresa nu se
-- cunoaste (apeluri din server, fara antet), ramane doar limita pe cont.
--
-- Limita pe cont (5 incercari gresite la un sfert de ora) nu se schimba.

alter table identitate.incercari_invitatii
  add column ip text
    constraint incercari_invitatii_ip_check
    check (ip is null or length(btrim(ip)) > 0);

comment on column identitate.incercari_invitatii.ip is
  'Adresa clientului (primul element din x-forwarded-for), pentru limita care nu depinde de cont. Null cand cererea nu vine prin PostgREST.';

-- Numaratoarea pe adresa, in fereastra de un sfert de ora.
create index incercari_invitatii_ip_creat_la_idx
  on identitate.incercari_invitatii (ip, creat_la)
  where ip is not null;

create or replace function identitate.adresa_cererii()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(split_part(
    coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
      ''), ',', 1)), '');
$$;

comment on function identitate.adresa_cererii() is
  'Adresa clientului din antetele cererii, sau null cand nu se cunoaste.';

create or replace function identitate.foloseste_invitatie(p_cod text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ip text := identitate.adresa_cererii();
  v_inv identitate.invitatii;
  v_ap organizare.apartamente;
  v_gresite integer;
  v_gresite_adresa integer;
begin
  if v_uid is null then
    raise exception 'Nu esti autentificat.';
  end if;

  delete from identitate.incercari_invitatii where creat_la < now() - interval '15 minutes';

  if v_ip is not null then
    select count(*) into v_gresite_adresa from identitate.incercari_invitatii where ip = v_ip;
    if v_gresite_adresa >= 20 then
      return jsonb_build_object('eroare',
        'S-au incercat prea multe coduri gresite de la aceasta conexiune. Mai asteapta un sfert de ora si incearca din nou.');
    end if;
  end if;

  select count(*) into v_gresite from identitate.incercari_invitatii where profil_id = v_uid;
  if v_gresite >= 5 then
    return jsonb_build_object('eroare',
      'Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.');
  end if;

  select * into v_inv from identitate.invitatii
    where cod = upper(btrim(p_cod))
    for update;
  if not found or v_inv.revocata_la is not null or v_inv.folosita_la is not null or v_inv.expira_la < now() then
    insert into identitate.incercari_invitatii (profil_id, ip) values (v_uid, v_ip);
    return jsonb_build_object('eroare', 'Codul nu este valabil. Cere administratorului un cod nou.');
  end if;

  select * into v_ap from organizare.apartamente where id = v_inv.apartament_id;

  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (v_inv.apartament_id, v_ap.bloc_id, v_uid, v_inv.calitate, current_date)
  on conflict do nothing;

  update identitate.invitatii
    set folosita_la = now(), folosita_de = v_uid
    where id = v_inv.id;

  delete from identitate.incercari_invitatii where profil_id = v_uid;

  return jsonb_build_object('apartament_id', v_ap.id, 'apartament_numar', v_ap.numar);
end;
$$;
