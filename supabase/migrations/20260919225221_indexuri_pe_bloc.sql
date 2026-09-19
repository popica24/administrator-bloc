-- Indexurile care lipseau pe bloc_id (audit 2: P2).
--
-- Fiecare incarcare a aplicatiei citeste repartizarile, citirile si sesizarile
-- unui singur bloc, dar niciuna dintre cele trei tabele nu avea un index care
-- sa inceapa cu bloc_id: planificatorul folosea indexul de pe apartament sau
-- de pe lista si arunca apoi majoritatea randurilor.
--
-- Masurat pe volum sintetic (101.136 de repartizari, 63.198 de citiri, 5.429
-- de sesizari, un bloc de 50 de apartamente si 60 de luni):
--   repartizari, filtrate pe bloc_id:        477 -> 104 buffere;
--   citiri, filtrate pe bloc_id si luna:     228 -> 52 buffere, 3.000 de
--                                            randuri citite -> 50;
--   sesizari, cele mai noi ale blocului:     42 -> 9 buffere.
--
-- P11: `create index` fara `concurrently` blocheaza scrierile pe tabela cat
-- dureaza constructia. La volumul de acum (o singura asociatie in productie)
-- este o chestiune de milisecunde, iar `concurrently` nu poate rula intr-o
-- migratie, care este o tranzactie. Inainte de zeci de asociatii, indexurile
-- noi se vor crea manual, in afara migratiei.

-- Repartizarile unui bloc, de obicei pentru o lista anume.
create index repartizari_bloc_lista_idx on intretinere.repartizari (bloc_id, lista_id);

-- Citirile unui bloc pe o luna (validarea indexurilor, motorul).
create index citiri_bloc_luna_idx on contorizare.citiri (bloc_id, luna);

-- Sesizarile unui bloc, cele mai noi intai.
create index sesizari_bloc_creat_la_idx on sesizari.sesizari (bloc_id, creat_la);
