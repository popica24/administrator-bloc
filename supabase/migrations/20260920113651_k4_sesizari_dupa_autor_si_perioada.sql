-- [K4] Sesizarile se vedeau dupa apartament, nu dupa cine locuia acolo cand
-- au fost scrise: un chirias nou putea citi conversatia si pozele fostului
-- locatar, marcate in aplicatie "Mesajul tau" pentru oricine e legat azi de
-- apartament. Politica cere acum, pe langa legatura curenta cu apartamentul
-- (private.apartamentele_mele()), ca sesizarea sa fi fost creata dupa
-- activ_din al legaturii curente — adica in timp ce locatarul de azi chiar
-- locuia acolo. Mesajele si pozele mostenesc vizibilitatea prin exists() pe
-- sesizari, deci se corecteaza fara alta politica.

drop policy "Sesizarile proprii si cele din blocurile conduse" on sesizari.sesizari;

create policy "Sesizarile proprii si cele din blocurile conduse"
  on sesizari.sesizari for select to authenticated
  using (
    bloc_id in (select private.blocuri_conduse())
    or exists (
      select 1 from identitate.locatari l
      where l.profil_id = (select auth.uid())
        and l.apartament_id = sesizari.sesizari.apartament_id
        and l.activ_din <= current_date
        and (l.activ_pana is null or l.activ_pana > current_date)
        and sesizari.sesizari.creat_la >= l.activ_din
    )
  );
