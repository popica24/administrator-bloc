-- S16: politica "Administratorul modifica datele asociatiei" pe
-- organizare.asociatii exista din migratia initiala, dar tabelul nu a primit
-- niciodata grant-ul de update (grant-ul din 20260919120009_organizare.sql
-- acopera blocuri, apartamente, contacte, inrolare_apartamente — nu si
-- asociatii). Politica era moarta: administratorul nu-si putea schimba
-- contul bancar sau telefonul asociatiei prin nicio cale.
--
-- Coloanele identitare (denumire, cui) si arhivarea raman neschimbabile din
-- aplicatie, in acelasi spirit cu S1: doar contul bancar si datele de
-- contact se pot edita direct.
--
-- (Cealalta jumatate a constatarii S16, "insert pe blocuri fara politica",
-- a fost deja inchisa de 20260919145505_revoca_scrieri_directe_invarianti.sql,
-- care a retras si grant-ul de insert odata cu politica.)

grant update (iban, banca, adresa, telefon, email) on organizare.asociatii to authenticated;
