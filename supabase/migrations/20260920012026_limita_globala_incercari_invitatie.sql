-- A doua limita la codul de invitatie, care nu depinde de cont (audit 2: C16).
--
-- Limita de 5 incercari pe cont (migratia limita_incercari_invitatie) opreste
-- un cont care ghiceste coduri, dar spatiul codurilor este global si contul e
-- gratuit: cine ruleaza un script care isi creeaza mereu conturi noi cumpara
-- mereu 5 incercari noi, deci limita pe cont nu reduce viteza reala a unui
-- atac distribuit pe multe conturi.
--
-- Aici este a doua limita, independenta de cont: un plafon de 20 de incercari
-- gresite in ultimul sfert de ora, numarate pe toate conturile la un loc, in
-- acelasi tabel identitate.incercari_invitatii (randurile ei sunt oricum
-- doar incercari gresite, cate una pe rand, indiferent de cont). Peste
-- plafon, orice cont este oprit, chiar daca incearca pentru prima oara si
-- chiar daca codul lui e bun, altfel plafonul global s-ar ocoli creand inca
-- un cont curat. Sub plafon, un cont curat cu un cod bun trece neatins:
-- calea omului cinstit nu se schimba.
--
-- Curatarea randurilor vechi devine globala (nu doar pentru contul curent),
-- ca numaratoarea globala sa nu creasca la nesfarsit.

create or replace function identitate.foloseste_invitatie(p_cod text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv identitate.invitatii;
  v_ap organizare.apartamente;
  v_gresite integer;
  v_gresite_global integer;
begin
  if v_uid is null then
    raise exception 'Nu esti autentificat.';
  end if;

  delete from identitate.incercari_invitatii where creat_la < now() - interval '15 minutes';

  select count(*) into v_gresite_global from identitate.incercari_invitatii;
  if v_gresite_global >= 20 then
    return jsonb_build_object('eroare',
      'Ai incercat de prea multe ori cu un cod gresit. Mai asteapta un sfert de ora si incearca din nou.');
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
    insert into identitate.incercari_invitatii (profil_id) values (v_uid);
    return jsonb_build_object('eroare', 'Codul nu este valabil. Cere administratorului un cod nou.');
  end if;

  select * into v_ap from organizare.apartamente where id = v_inv.apartament_id;
  insert into identitate.locatari (apartament_id, bloc_id, profil_id, calitate, activ_din)
  values (v_ap.id, v_ap.bloc_id, v_uid, v_inv.calitate, current_date)
  on conflict do nothing;
  update identitate.invitatii set folosita_la = now(), folosita_de = v_uid where id = v_inv.id;
  delete from identitate.incercari_invitatii where profil_id = v_uid;
  return jsonb_build_object('apartament_id', v_ap.id, 'apartament_numar', v_ap.numar);
end;
$$;

comment on function identitate.foloseste_invitatie(text) is
  'Leaga contul de apartamentul din cod. Intoarce {"eroare": "..."} cand codul nu e bun, cand contul a depasit limita lui de incercari sau cand s-a depasit plafonul global de incercari gresite (indiferent de cont).';
