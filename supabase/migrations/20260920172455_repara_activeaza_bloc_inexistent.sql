-- organizare.activeaza_bloc(): pentru un p_bloc_id care nu exista,
-- "select * into v from organizare.verificari_bloc where bloc_id = p_bloc_id"
-- nu gaseste niciun rand, deci v ramane cu toate coloanele null. Verificarile
-- de completitudine compara acele coloane null cu numere (v.apartamente = 0,
-- v.suma_cote - 100 etc.), iar "null = 0" e null, nu true, asa ca "or"-ul lor
-- ramane null si nu declanseaza exceptia. Update-ul final nu gaseste randul
-- de actualizat si tace. Rezultat: activarea unui bloc inexistent reuseste
-- in liniste ([NOU-2] din a-organizare.test.sql).
--
-- Fix: verificam explicit "found" dupa select into si respingem clar un bloc
-- care nu exista, inainte de verificarile de completitudine.

create or replace function organizare.activeaza_bloc(p_bloc_id uuid)
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
  if not found then
    raise exception 'Blocul nu exista.';
  end if;
  if v.apartamente = 0 or abs(v.suma_cote - 100) > 0.01 or v.apartamente_fara_persoane > 0
     or v.contoare_fara_index > 0 or v.randuri_propuse > 0 then
    raise exception 'Blocul nu este complet: % apartamente, cote % din 100, % fara persoane, % contoare fara index, % randuri neconfirmate.',
      v.apartamente, v.suma_cote, v.apartamente_fara_persoane, v.contoare_fara_index, v.randuri_propuse;
  end if;
  update organizare.blocuri set stare = 'activ', activat_la = now() where id = p_bloc_id and stare <> 'activ';
end;
$$;
