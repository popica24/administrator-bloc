-- Scrierile directe care ocoleau invariantii agregatelor (audit S1, F4).
--
-- Blocul si apartamentele sale sunt un agregat: starea blocului trece in
-- 'activ' doar prin organizare.activeaza_bloc(), care verifica suma cotelor,
-- persoanele si indexurile de pornire. Apartamentele intra prin
-- organizare.confirma_inrolare(). Drepturile de insert/update direct pe
-- tabele lasau administratorul sa sara peste aceste verificari: cote de 145%
-- pe un bloc activ, bloc reactivat fara verificari, bloc arhivat sau mutat in
-- alta asociatie. Aplicatia nu le folosea; schimbarile legitime (proprietar
-- nou, suprafata) vor primi comenzi proprii, cu verificari.
--
-- Fondurile sunt bani: o miscare de fond fara document si cu orice semn si
-- data umfla soldul pe care il vad toti locatarii. Intrarile vin doar din
-- publicarea listei (financiar.la_lista_publicata); iesirile vor primi o
-- comanda cu document obligatoriu.
--
-- Raman neschimbate: organizare.contacte si organizare.inrolare_apartamente
-- (propunerile administratorului, confirmate apoi prin confirma_inrolare),
-- si insertul in organizare.apartamente_persoane (istoric, doar spre viitor).

drop policy "Administratorul modifica blocul" on organizare.blocuri;
drop policy "Administratorul adauga apartamente" on organizare.apartamente;
drop policy "Administratorul modifica fisa apartamentului" on organizare.apartamente;
revoke insert, update on organizare.blocuri, organizare.apartamente from authenticated;

drop policy "Administratorul inregistreaza iesiri din fond" on financiar.miscari_fond;
revoke insert on financiar.miscari_fond from authenticated;
