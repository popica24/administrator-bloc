-- [NOU-1] comunicare.la_plata_confirmata formata suma cu to_char(...,
-- 'FM999G990D00'): G si D sunt sensibile la lc_numeric al serverului, care e
-- en_US.UTF-8, deci notificarea scria "Am primit 1,234.50 lei" desi
-- aplicatia foloseste formatul romanesc peste tot. '.' si ',' folosite ca
-- literali in sablon (nu G/D) sunt independente de locale, deci formatam cu
-- ele si apoi inversam cele doua caractere.

create or replace function comunicare.la_plata_confirmata(p_date jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ch financiar.chitante;
  v_profil uuid;
  v_ap uuid := (p_date ->> 'apartament_id')::uuid;
begin
  select * into v_ch from financiar.chitante where plata_id = (p_date ->> 'plata_id')::uuid;
  for v_profil in select * from comunicare.locatari_apartamente(array[v_ap]) loop
    perform comunicare.notifica(v_profil, v_ch.asociatie_id, 'plata', 'Plata a fost inregistrata',
      'Am primit ' || translate(to_char((p_date ->> 'suma')::numeric, 'FM999G999G999G990D00'), '.,', ',.')
        || ' lei. Chitanta ' || v_ch.serie || ' nr. ' || lpad(v_ch.numar::text, 6, '0') || ' este in aplicatie, la Platile mele.',
      jsonb_build_object('plata_id', p_date ->> 'plata_id'));
  end loop;
end;
$$;
