-- J12: reparatia [minor] (20260920151015) a facut ca o corectie negativa
-- fara datorie de intretinere sora (aceeasi lista_id, acelasi apartament)
-- sa isi pastreze propriul rest, vizibil, in loc sa dispara tacut din
-- Sigma(rest) — corect pentru reconciliere cu financiar.solduri, dar cu un
-- pret: o data creata, o asemenea corectie orfana nu mai poate fi niciodata
-- inchisa. financiar.aloca_plata sare peste orice rand cu rest negativ (nu
-- e nimic de "platit" pe el), asa ca ramane deschisa la nesfarsit, cu un
-- rest fantoma pe care nimeni nu-l poate reduce. Azi singura cale de a crea
-- una e directa, prin service role — nicio comanda din aplicatie n-o
-- produce — dar registrul financiar, append-only, nu ar trebui sa permita
-- starea asta indiferent de cine incearca sa o scrie (§1.2: banii sunt un
-- invariant central, nu doar o conventie de aplicatie).
--
-- Reparatie: financiar.datorii refuza la INSERT/UPDATE o corectie negativa
-- fara datoria de intretinere sora. Verificarea foloseste exact aceeasi
-- conditie ca financiar.datorii_rest / aloca_plata / calculeaza_penalizari
-- (aceeasi lista_id, acelasi apartament, tip = 'intretinere'), ca "are
-- sora" sa insemne acelasi lucru peste tot.

create function financiar.verifica_corectie_are_sora()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tip = 'corectie' and new.suma < 0 and not exists (
    select 1 from financiar.datorii s
    where s.tip = 'intretinere' and s.lista_id = new.lista_id and s.apartament_id = new.apartament_id
  ) then
    raise exception 'O corectie negativa are nevoie de o datorie de intretinere sora, pe aceeasi lista si acelasi apartament.';
  end if;
  return new;
end;
$$;

comment on function financiar.verifica_corectie_are_sora() is
  'J12: o corectie negativa fara datorie de intretinere sora (aceeasi lista, acelasi apartament) ramane deschisa pentru totdeauna — aloca_plata nu ii poate reduce niciodata restul negativ. Registrul nu o mai lasa sa intre, indiferent de cine scrie (inclusiv service role).';

create trigger datorii_corectie_are_sora
  before insert or update of tip, suma, lista_id, apartament_id on financiar.datorii
  for each row
  when (new.tip = 'corectie' and new.suma < 0)
  execute function financiar.verifica_corectie_are_sora();
