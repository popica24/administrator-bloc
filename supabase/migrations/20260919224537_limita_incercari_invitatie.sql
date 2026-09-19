-- Limita de incercari la codul de invitatie (audit 2: X07).
--
-- Codul are 8 caractere dintr-un alfabet de 32, adica 32^8 combinatii, dar
-- spatiul este global (orice cod valabil leaga contul de apartamentul lui) si
-- nu exista nicio limita: masurat, un cont putea incerca 150 de coduri pe
-- secunda. Acum fiecare cont are dreptul la 5 incercari gresite intr-un sfert
-- de ora; a sasea este refuzata, indiferent de cod.
--
-- De ce nu mai ridica exceptie codul gresit: intr-o exceptie se anuleaza toata
-- tranzactia, deci si randul care tocmai a numarat incercarea, iar limita nu ar
-- retine niciodata nimic. Asa ca un cod gresit intoarce
-- {"eroare": "..."} si comanda se incheie cu succes, dupa ce a numarat
-- incercarea. Aplicatia ridica eroarea mai departe, deci utilizatorul vede
-- acelasi mesaj ca inainte.

create table identitate.incercari_invitatii (
  id bigint generated always as identity primary key,

  profil_id uuid not null
    references identitate.profiluri (id) on delete cascade,

  creat_la timestamptz not null default now()
);

comment on table identitate.incercari_invitatii is
  'Incercarile cu cod gresit, pe cont. Randurile mai vechi decat fereastra se sterg singure la urmatoarea incercare a aceluiasi cont, deci tabela nu creste.';
comment on column identitate.incercari_invitatii.profil_id is
  'on delete cascade: sunt doar contoare de protectie, nu au valoare dupa stergerea contului.';

-- Numaratoarea citeste ultimele incercari ale unui singur cont.
create index incercari_invitatii_profil_creat_idx
  on identitate.incercari_invitatii (profil_id, creat_la);

alter table identitate.incercari_invitatii enable row level security;
-- Fara politici, intentionat: tabela se scrie si se citeste doar din
-- identitate.foloseste_invitatie, care este security definer.

grant all on identitate.incercari_invitatii to service_role;

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
begin
  if v_uid is null then
    raise exception 'Nu esti autentificat.';
  end if;

  delete from identitate.incercari_invitatii
   where profil_id = v_uid and creat_la < now() - interval '15 minutes';
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
  'Leaga contul de apartamentul din cod. Intoarce {"eroare": "..."} cand codul nu e bun sau cand contul a depasit limita de incercari.';
