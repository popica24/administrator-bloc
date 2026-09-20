-- L16: data intrarii in fondul de reparatii se calcula cu
-- v_lista.publicata_la::date, care foloseste fusul orar al SESIUNII curente,
-- nu neaparat ora Romaniei. Baza are Europe/Bucharest ca fus implicit pentru
-- sesiuni noi (audit X1, 20260919145633_fus_orar_romania.sql), dar o functie
-- SECURITY DEFINER nu ar trebui sa depinda de o setare de sesiune care poate
-- fi schimbata de conexiune (pooler, PostgREST cu alt search_path/GUC, un
-- job rulat manual): o lista publicata la 01:30 pe 1 septembrie ora
-- Romaniei (22:30 UTC pe 31 august) ajungea inregistrata in fond pe 31
-- august daca sesiunea era in UTC.
--
-- Reparatie: conversia explicita "at time zone 'Europe/Bucharest'", care nu
-- mai depinde de setarea sesiunii.

create or replace function financiar.la_lista_publicata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista intretinere.liste_lunare;
  v_versiune smallint := (p_date ->> 'versiune')::smallint;
  v_r record;
  v_fond uuid;
  v_suma_fond numeric(12, 2);
  v_luna_text text;
begin
  select * into v_lista from intretinere.liste_lunare where id = (p_date ->> 'lista_id')::uuid;
  v_luna_text := (array['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'])[extract(month from v_lista.luna)::int]
                 || ' ' || extract(year from v_lista.luna)::int;

  for v_r in
    select r.apartament_id, r.bloc_id, sum(r.suma) as total
    from intretinere.repartizari r
    where r.lista_id = v_lista.id and r.versiune = v_versiune
    group by r.apartament_id, r.bloc_id
    having sum(r.suma) > 0
  loop
    perform 1 from financiar.conturi where apartament_id = v_r.apartament_id for update;
    insert into financiar.datorii (apartament_id, bloc_id, tip, luna, lista_id, versiune, suma, scadenta, descriere)
    values (v_r.apartament_id, v_r.bloc_id, 'intretinere', v_lista.luna, v_lista.id, v_versiune, v_r.total, v_lista.scadenta,
            'Intretinere ' || v_luna_text)
    on conflict (lista_id, versiune, apartament_id, tip) do nothing;
    perform financiar.aloca_avansuri(v_r.apartament_id);
  end loop;

  select id into v_fond from financiar.fonduri where bloc_id = v_lista.bloc_id and tip = 'reparatii';
  select coalesce(sum(suma), 0) into v_suma_fond from intretinere.cheltuieli where lista_id = v_lista.id and tip = 'fond_reparatii';
  if v_fond is not null and v_suma_fond > 0 then
    insert into financiar.miscari_fond (fond_id, data, suma, descriere, lista_id)
    values (v_fond, (v_lista.publicata_la at time zone 'Europe/Bucharest')::date, v_suma_fond, 'Contributii fond reparatii, lista pe ' || v_luna_text, v_lista.id)
    on conflict do nothing;
  end if;
end;
$$;
