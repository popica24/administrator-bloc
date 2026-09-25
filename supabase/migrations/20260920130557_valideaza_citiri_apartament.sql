-- [A5-backend] Ecranul Citiri contoare (AdminBloc.jsx:3396, :3416) cheama
-- sursa.valideazaCitiriApartament(apartamentId, luna, accepta, motiv): un
-- singur buton "Valideaza" sau "Respinge" pentru toate contoarele unui
-- apartament, pe o luna, intr-o singura schimbare. Comanda a fost adaugata
-- in src/sursa-mock.js, dar nu si in backend-ul real: pe stack-ul Supabase
-- ambele butoane arunca "sursa.valideazaCitiriApartament is not a function".
--
-- Inainte de reparatia asta, ecranul apela contorizare.valideaza_citire() o
-- data pe contor. Un apartament cu doua contoare (rece si calda) putea
-- ramane pe jumatate validat daca al doilea apel esua (retea, sesiune
-- expirata): exact bug-ul pe care il repara faptul ca totul se intampla
-- intr-o singura functie, deci intr-o singura tranzactie, daca o citire nu
-- se poate schimba, niciuna nu se schimba.
--
-- Regulile sunt cele din contorizare.valideaza_citire(): doar administratorul
-- blocului, motiv obligatoriu la respingere, refuza o luna a carei lista e
-- deja publicata. In plus, "nimic de validat" (nicio citire "trimisa" pentru
-- acel apartament si acea luna) este el insusi un refuz, cu mesajul din
-- sursa-mock.js, valideaza_citire nu are un echivalent, pentru ca acolo
-- citirea fie exista, fie nu.

create function contorizare.valideaza_citiri_apartament(
  p_apartament_id uuid,
  p_luna date,
  p_accepta boolean,
  p_motiv text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_apartament organizare.apartamente;
  v_citire contorizare.citiri;
  v_numar integer := 0;
begin
  select * into v_apartament from organizare.apartamente where id = p_apartament_id;
  if not found or v_apartament.bloc_id not in (select private.blocuri_administrate()) then
    raise exception 'Apartamentul nu exista sau nu este din blocul tau.';
  end if;

  if exists (
    select 1 from intretinere.liste_lunare
    where bloc_id = v_apartament.bloc_id and luna = p_luna and stare = 'publicata'
  ) then
    raise exception 'Lista lunii % este deja publicata; citirile nu se mai pot verifica.', p_luna;
  end if;

  if not p_accepta and coalesce(btrim(p_motiv), '') = '' then
    raise exception 'Scrie motivul, ca locatarul sa stie ce sa corecteze.';
  end if;

  for v_citire in
    select * from contorizare.citiri
    where apartament_id = p_apartament_id and luna = p_luna and stare = 'trimisa'
    order by id
    for update
  loop
    update contorizare.citiri
       set stare = case when p_accepta then 'validata' else 'respinsa' end,
           motiv_respingere = case when p_accepta then null else btrim(p_motiv) end,
           verificata_de = auth.uid(),
           verificata_la = now()
     where id = v_citire.id;
    if not p_accepta then
      perform evenimente.inregistreaza('CitireRespinsa', 'contorizare', v_citire.contor_id,
        jsonb_build_object('citire_id', v_citire.id, 'apartament_id', v_citire.apartament_id, 'bloc_id', v_citire.bloc_id,
                           'luna', v_citire.luna, 'motiv', btrim(p_motiv)));
    end if;
    v_numar := v_numar + 1;
  end loop;

  if v_numar = 0 then
    raise exception 'Nu mai sunt citiri de verificat pentru acest apartament si aceasta luna.';
  end if;

  return jsonb_build_object('validate', v_numar);
end;
$$;

revoke execute on function contorizare.valideaza_citiri_apartament(uuid, date, boolean, text) from public, anon;
grant execute on function contorizare.valideaza_citiri_apartament(uuid, date, boolean, text) to authenticated;
