-- [S3] Chiriasul mutat azi nu mai vede platile si chitantele celui dinaintea lui.
--
-- Migratia K4 a scos conversatiile fostului locatar din ochii celui nou, cu
-- argumentul ca un chirias nou nu are ce citi din viata celui dinainte. Banii
-- au ramas nefiltrati: financiar.plati (si, prin ea, alocari_plati si
-- chitante) se vedeau dupa private.apartamentele_mele(), fara nicio conditie
-- de perioada. Un chirias mutat azi deschidea "Platile mele" si vedea fiecare
-- plata a fostului locatar, cu suma, data si numarul chitantei, si putea
-- descarca chitantele lui in PDF (auditul 3, S3).
--
-- Datoriile raman nefiltrate, si asa trebuie: ele stau pe apartament, iar
-- soldul se preia cu apartament cu tot. Ce a platit un om din buzunarul lui
-- este insa al lui.

drop policy "Platile proprii si cele din blocurile conduse" on financiar.plati;

create policy "Platile din perioada mea si cele din blocurile conduse"
  on financiar.plati for select to authenticated
  using (
    bloc_id in (select private.blocuri_conduse())
    or exists (
      select 1 from identitate.locatari l
      where l.profil_id = (select auth.uid())
        and l.apartament_id = financiar.plati.apartament_id
        and l.activ_din <= current_date
        and (l.activ_pana is null or l.activ_pana > current_date)
        and (financiar.plati.confirmata_la at time zone 'Europe/Bucharest')::date >= l.activ_din
    )
  );
