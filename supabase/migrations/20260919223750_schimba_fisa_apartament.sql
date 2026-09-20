-- Comanda care lipsea dupa revocarea scrierilor directe (audit 2: X06, D1).
--
-- De ieri, nimic nu mai poate scrie proprietar_nume, cota_indiviza,
-- suprafata_mp, scutit_lift sau etaj: revocarea a fost corecta (cotele nu mai
-- pot fi stricate printr-un update direct), dar a lasat aplicatia fara nicio
-- cale de a corecta fisa unui apartament. Numele fostului proprietar ramanea
-- pe lista de plata pentru totdeauna.
--
-- Aici este inlocuitorul, cu verificarile pe care update-ul direct nu le avea:
--   - doar administratorul blocului (sau serviciul);
--   - cat timp blocul este 'activ', suma cotelor ramane 100 (+/- 0,01), adica
--     exact conditia pe care organizare.activeaza_bloc() a cerut-o la
--     activare. Pe un bloc 'in_configurare' cotele se corecteaza liber, pana
--     la activare;
--   - numele, cota, suprafata si etajul sunt verificate inainte de scriere,
--     ca mesajul sa fie pe intelesul administratorului, nu textul unei
--     constrangeri.
-- Modificarea intra in audit.jurnal prin trigger-ul apartamente_audit, care
-- exista din migratia organizare.

create function organizare.schimba_fisa_apartament(
  p_apartament_id uuid,
  p_proprietar_nume text,
  p_cota_indiviza numeric,
  p_suprafata_mp numeric,
  p_scutit_lift boolean,
  p_etaj smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ap organizare.apartamente;
  v_stare text;
  v_suma numeric(9, 4);
begin
  select * into v_ap from organizare.apartamente
   where id = p_apartament_id
     and (bloc_id in (select private.blocuri_administrate()) or private.este_serviciu())
   for update;
  if not found then
    raise exception 'Apartamentul nu exista sau nu este in blocul tau.';
  end if;

  if coalesce(btrim(p_proprietar_nume), '') = '' then
    raise exception 'Scrie numele proprietarului.';
  end if;
  if p_cota_indiviza is null or p_cota_indiviza <= 0 or p_cota_indiviza > 100 then
    raise exception 'Cota indiviza trebuie sa fie un numar intre 0 si 100.';
  end if;
  if p_suprafata_mp is not null and p_suprafata_mp <= 0 then
    raise exception 'Suprafata trebuie sa fie mai mare decat zero.';
  end if;
  if p_etaj is null then
    raise exception 'Scrie etajul apartamentului.';
  end if;

  select stare into v_stare from organizare.blocuri where id = v_ap.bloc_id;
  if v_stare = 'activ' and round(p_cota_indiviza, 4) <> v_ap.cota_indiviza then
    select coalesce(sum(cota_indiviza), 0) - v_ap.cota_indiviza + round(p_cota_indiviza, 4)
      into v_suma
      from organizare.apartamente where bloc_id = v_ap.bloc_id;
    if abs(v_suma - 100) > 0.01 then
      raise exception 'Cotele blocului ar ajunge la % din 100. Schimba si celelalte apartamente, altfel lista nu se mai imparte corect.', v_suma;
    end if;
  end if;

  update organizare.apartamente
     set proprietar_nume = btrim(p_proprietar_nume),
         cota_indiviza = p_cota_indiviza,
         suprafata_mp = p_suprafata_mp,
         scutit_lift = p_scutit_lift,
         etaj = p_etaj
   where id = p_apartament_id;
end;
$$;

comment on function organizare.schimba_fisa_apartament(uuid, text, numeric, numeric, boolean, smallint) is
  'Singura cale de a schimba fisa unui apartament. Pe un bloc activ, cotele trebuie sa ramana 100.';

revoke execute on function organizare.schimba_fisa_apartament(uuid, text, numeric, numeric, boolean, smallint) from public, anon;
grant execute on function organizare.schimba_fisa_apartament(uuid, text, numeric, numeric, boolean, smallint) to authenticated, service_role;
