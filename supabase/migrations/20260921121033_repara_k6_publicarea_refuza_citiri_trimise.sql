-- [K6] Lista unei luni nu se publica cat timp luna are citiri trimise, inca
-- neverificate.
--
-- Dupa publicare, o citire "trimisa" nu mai poate fi verificata, respinsa,
-- estimata sau retrimisa: toate comenzile refuza o luna publicata (J2, H4 si
-- valideaza_citire), fiindca banii ei sunt deja calculati. Citirea ramanea
-- blocata definitiv, iar "De verificat" nu mai ajungea la zero. Se ajungea
-- acolo pe o cale legitima: administratorul scoate apa de pe lista lunii
-- (se factureaza separat) si publica. Avertismentul din ecran depindea de
-- existenta apei pe lista, deci lipsea tocmai atunci.
--
-- Regula sta intr-un trigger pe trecerea din ciorna in publicata, nu in
-- intretinere.salveaza_lista_publicata: acopera orice cale de publicare si nu
-- rescrie functia, redefinita deja de trei migratii. Recalcularea unei liste
-- deja publicate nu schimba starea, deci nu este oprita.
create or replace function intretinere.refuza_publicarea_cu_citiri_trimise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trimise integer;
begin
  select count(*) into v_trimise
    from contorizare.citiri
    where bloc_id = new.bloc_id and luna = new.luna and stare = 'trimisa';
  if v_trimise = 1 then
    raise exception 'Pe % mai este o citire de verificat. Valideaza-o sau respinge-o, apoi publica lista.',
      comunicare.luna_text(new.luna);
  elsif v_trimise > 1 then
    -- "20 de citiri", nu "20 citiri" (aceeasi regula ca plural() din aplicatie)
    raise exception 'Pe % mai sunt % citiri de verificat. Valideaza-le sau respinge-le, apoi publica lista.',
      comunicare.luna_text(new.luna),
      v_trimise || case when v_trimise >= 20 and (v_trimise % 100 = 0 or v_trimise % 100 > 19) then ' de' else '' end;
  end if;
  return new;
end;
$$;

comment on function intretinere.refuza_publicarea_cu_citiri_trimise() is
  'Opreste publicarea unei liste cat timp luna ei are citiri trimise, neverificate: dupa publicare nu le-ar mai putea atinge nicio comanda. [K6]';

revoke execute on function intretinere.refuza_publicarea_cu_citiri_trimise() from public, anon, authenticated;

create trigger liste_lunare_refuza_publicarea_cu_citiri_trimise
  before update of stare on intretinere.liste_lunare
  for each row
  when (old.stare = 'ciorna' and new.stare = 'publicata')
  execute function intretinere.refuza_publicarea_cu_citiri_trimise();
