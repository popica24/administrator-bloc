-- H11: private.blocuri_conduse() = private.blocuri_administrate() UNION
-- private.blocuri_supravegheate() (presedinte/cenzor), si sesizari.sesizari
-- foloseste blocuri_conduse() pentru citire. Efect: oricine are un mandat de
-- presedinte sau cenzor (identitate.membri_asociatie.rol) primeste, prin
-- API, toate sesizarile blocului, descrierea, pozele si autorul fiecarei
-- reclamatii, desi identitate.eu() nu stie inca de rolul de presedinte sau
-- cenzor (docs/harta-functii.md §9: "eu() nu are rol de presedinte sau
-- cenzor"), deci aplicatia nu arata acestui cont nimic. Ramane doar o cale
-- ocolita, prin API direct, spre date personale ale locatarilor, fara nicio
-- urma in interfata.
--
-- Decizia (varianta mai mica si mai sigura, in loc de a modela rolurile de
-- presedinte/cenzor cap-coada, ceea ce ar cere ecrane noi in AdminBloc.jsx,
-- in afara fisierelor acestei reparatii): restrange RLS la ce chiar
-- folosesc aceste roluri, in loc sa construiasca interfata lipsa.
--
-- Nu ating financiar.* (datorii, plati), intretinere.* (cheltuieli, liste)
-- sau identitate.locatari/membri_asociatie, unde vederea intregului bloc
-- pentru presedinte/cenzor este documentata explicit ca intentie de design
-- (docs/harta-functii.md §10: "Conducerea (administrator, presedinte,
-- cenzor) vede tot blocul") si corespunde rolului lor real: cenzorul
-- verifica banii, presedintele are nevoie de contactele locatarilor pentru
-- adunarea generala. comunicare.documente si guvernanta.* deja verifica
-- asociatii_supravegheate() direct, fara sa treaca prin blocuri_conduse(),
-- deci nu sunt afectate aici.
--
-- Sesizarile sunt diferite: nicio comanda de scriere (scrie_mesaj,
-- preia_sesizare, rezolva_sesizare) nu verifica blocuri_conduse(), toate
-- verifica blocuri_administrate(), adica sesizarile sunt deja, peste tot in
-- afara de aceasta politica de citire, un flux exclusiv al
-- administratorului (§4.4 din harta functiilor: tabul Sesizari exista doar
-- la Administrator, niciodata la guvernanta). Politica de citire ramasese
-- singura care mai lasa presedintele/cenzorul inauntru, fara niciun motiv
-- de produs. sesizari.sesizari_mesaje si sesizari.sesizari_poze mostenesc
-- vizibilitatea din sesizari.sesizari prin exists(), deci se corecteaza
-- fara alta politica.

drop policy "Sesizarile proprii si cele din blocurile conduse" on sesizari.sesizari;

create policy "Sesizarile proprii si cele din blocurile conduse"
  on sesizari.sesizari for select to authenticated
  using (
    bloc_id in (select private.blocuri_administrate())
    or exists (
      select 1 from identitate.locatari l
      where l.profil_id = (select auth.uid())
        and l.apartament_id = sesizari.sesizari.apartament_id
        and l.activ_din <= current_date
        and (l.activ_pana is null or l.activ_pana > current_date)
        and sesizari.sesizari.creat_la >= l.activ_din
    )
  );
