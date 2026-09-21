-- [K23] O factura cu un furnizor nou se salveaza intr-un singur apel, deci
-- intr-o singura tranzactie.
--
-- Sursa Supabase facea doi pasi separati: insera furnizorul, apoi factura.
-- Verificarea codului dublat (L11) se facea inainte, tot din client, deci doi
-- administratori care salvau in aceeasi clipa acelasi cod treceau amandoi de
-- ea, amandoi creau furnizorul, iar baza refuza factura celui de-al doilea
-- (cheia unica lista_id + cod): furnizorul lui ramanea in lista, fara nicio
-- factura. Vazut pe CI, in testul e2e de concurenta.
--
-- Functia este security invoker: ruleaza cu drepturile celui care o cheama,
-- deci politicile RLS de insert pe furnizori si pe cheltuieli se aplica exact
-- ca la scrierile directe de pana acum. Daca factura e refuzata, se anuleaza
-- si furnizorul.
create or replace function intretinere.adauga_factura_cu_furnizor_nou(
  p_lista_id uuid,
  p_denumire text,
  p_categorie text,
  p_cod text,
  p_suma numeric,
  p_metoda text,
  p_tip_apa text,
  p_serie text,
  p_emisa date,
  p_scadenta date,
  p_document_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_asociatie uuid;
  v_furnizor uuid;
  v_cheltuiala uuid;
begin
  select b.asociatie_id into v_asociatie
    from intretinere.liste_lunare l
    join organizare.blocuri b on b.id = l.bloc_id
    where l.id = p_lista_id;
  if v_asociatie is null then
    raise exception 'Lista nu exista sau nu este din blocul tau.';
  end if;

  insert into intretinere.furnizori (asociatie_id, denumire, categorie_implicita, metoda_implicita, tip_apa_implicit, cod_implicit)
  values (v_asociatie, btrim(p_denumire), p_categorie, p_metoda, p_tip_apa, p_cod)
  returning id into v_furnizor;

  insert into intretinere.cheltuieli (lista_id, tip, cod, categorie, furnizor_id, serie_numar, suma, metoda, tip_apa, data_emitere, scadenta_furnizor, document_id)
  values (p_lista_id, 'factura', p_cod, p_categorie, v_furnizor, p_serie, p_suma, p_metoda,
          case when p_metoda = 'consum' then p_tip_apa end, p_emisa, p_scadenta, p_document_id)
  returning id into v_cheltuiala;

  return v_cheltuiala;
end;
$$;

comment on function intretinere.adauga_factura_cu_furnizor_nou(uuid, text, text, text, numeric, text, text, text, date, date, uuid) is
  'Adauga o factura impreuna cu furnizorul ei nou, intr-o singura tranzactie: daca factura e refuzata (de exemplu cod dublat), nu ramane un furnizor orfan. Security invoker, deci RLS se aplica. [K23]';

revoke execute on function intretinere.adauga_factura_cu_furnizor_nou(uuid, text, text, text, numeric, text, text, text, date, date, uuid) from public, anon;
grant execute on function intretinere.adauga_factura_cu_furnizor_nou(uuid, text, text, text, numeric, text, text, text, date, date, uuid) to authenticated, service_role;
