-- J6: guvernanta.situatie_voturi() si situatie_adunari() calculau
-- "votulMeu"/"prezentaMea" cu
-- `... apartament_id in (select private.apartamentele_mele()) limit 1`,
-- adica orice apartament al chemarii curente, in ordinea arbitrara a
-- scanarii, nu apartamentul pe care omul l-a ales ca activ ([P5] in
-- src/sursa-supabase.js, deja folosit corect de sursa demonstrativa). Un
-- locatar cu doua apartamente in acelasi bloc (proprietar la unul, chirias
-- sau coproprietar la celalalt) nu putea niciodata sa vada sau sa foloseasca
-- votul/prezenta celui de-al doilea apartament daca primul, gasit oricum,
-- aparea deja ca "am votat"/"am fost prezent".
--
-- Reparatie: ambele functii primesc un parametru optional p_apartament_id.
-- Cand e dat si chiar apartine chemarii curente
-- (private.apartamentele_mele()), votulMeu/prezentaMea se calculeaza strict
-- pentru el. Fara el, sau daca nu e al meu, comportamentul vechi ramane
-- neschimbat (orice apartament al meu, primul gasit), compatibil cu
-- apelurile fara alegere explicita.

-- Semnatura noua (al doilea parametru, optional) ar coexista cu cea veche
-- ca o supraincarcare distincta, in loc sa o inlocuiasca: doua functii cu
-- acelasi nume, una din ele potrivindu-se ambiguu cand chemarea da doar
-- p_asociatie_id (cazul administratorului, fara alegere de apartament).
drop function if exists guvernanta.situatie_voturi(uuid);
drop function if exists guvernanta.situatie_adunari(uuid);

create function guvernanta.situatie_voturi(p_asociatie_id uuid, p_apartament_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conducere boolean;
  v_ap uuid;
begin
  if p_asociatie_id not in (select private.asociatii_vizibile()) then
    raise exception 'Nu ai acces la aceasta asociatie.';
  end if;
  v_conducere := p_asociatie_id in (select private.asociatii_administrate())
              or p_asociatie_id in (select private.asociatii_supravegheate());
  -- J6: p_apartament_id conteaza doar daca e chiar unul de-al meu.
  select p_apartament_id into v_ap where p_apartament_id in (select private.apartamentele_mele());
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id,
      'titlu', v.titlu,
      'descriere', v.descriere,
      'deschisLa', v.deschis_la,
      'inchideLa', v.inchide_la,
      'numarare', v.numarare,
      'optiuni', (
        select jsonb_agg(jsonb_build_object(
          'id', o.id, 'text', o.text,
          'voturi', (select count(*) from guvernanta.voturi_exprimate e where e.optiune_id = o.id),
          'cote', (select coalesce(sum(a.cota_indiviza), 0) from guvernanta.voturi_exprimate e join organizare.apartamente a on a.id = e.apartament_id where e.optiune_id = o.id)
        ) order by o.ordine)
        from guvernanta.voturi_optiuni o where o.vot_id = v.id
      ),
      'votanti', (select count(*) from guvernanta.voturi_exprimate e where e.vot_id = v.id),
      'totalApartamente', (select count(*) from organizare.apartamente a join organizare.blocuri b on b.id = a.bloc_id where b.asociatie_id = v.asociatie_id),
      'votulMeu', (
        select e.optiune_id from guvernanta.voturi_exprimate e
        where e.vot_id = v.id
          and e.apartament_id in (select private.apartamentele_mele())
          and (v_ap is null or e.apartament_id = v_ap)
        limit 1
      ),
      'nevotate', case when v_conducere then (
        select coalesce(jsonb_agg(a.numar order by nullif(regexp_replace(a.numar, '\D', '', 'g'), '')::int, a.numar), '[]'::jsonb)
        from organizare.apartamente a join organizare.blocuri b on b.id = a.bloc_id
        where b.asociatie_id = v.asociatie_id
          and not exists (select 1 from guvernanta.voturi_exprimate e where e.vot_id = v.id and e.apartament_id = a.id)
      ) end
    ) order by v.deschis_la desc)
    from guvernanta.voturi v
    where v.asociatie_id = p_asociatie_id
  ), '[]'::jsonb);
end;
$$;

create function guvernanta.situatie_adunari(p_asociatie_id uuid, p_apartament_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ap uuid;
begin
  if p_asociatie_id not in (select private.asociatii_vizibile()) then
    raise exception 'Nu ai acces la aceasta asociatie.';
  end if;
  select p_apartament_id into v_ap where p_apartament_id in (select private.apartamentele_mele());
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id,
      'dataOra', g.data_ora,
      'loc', g.loc,
      'ordineDeZi', g.ordine_de_zi,
      'convocataLa', g.creat_la,
      'documentId', g.document_id,
      'prezente', (select count(*) from guvernanta.adunari_prezente p where p.adunare_id = g.id),
      'totalApartamente', (select count(*) from organizare.apartamente a join organizare.blocuri b on b.id = a.bloc_id where b.asociatie_id = g.asociatie_id),
      'prezentaMea', exists (
        select 1 from guvernanta.adunari_prezente p
        where p.adunare_id = g.id
          and p.apartament_id in (select private.apartamentele_mele())
          and (v_ap is null or p.apartament_id = v_ap)
      )
    ) order by g.data_ora desc)
    from guvernanta.adunari_generale g
    where g.asociatie_id = p_asociatie_id
  ), '[]'::jsonb);
end;
$$;

revoke execute on function guvernanta.situatie_voturi(uuid, uuid), guvernanta.situatie_adunari(uuid, uuid) from public, anon;
grant execute on function guvernanta.situatie_voturi(uuid, uuid), guvernanta.situatie_adunari(uuid, uuid) to authenticated, service_role;
