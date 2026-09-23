-- [A10] Adresa interna a conturilor trece pe un domeniu rezervat.
--
-- Contul se tine pe numarul de telefon, iar Supabase Auth are nevoie de o
-- adresa: o facem din numar, iar omul nu o vede si nu o scrie niciodata. Pana
-- acum domeniul era "telefon.adminbloc.ro", adica un domeniu real, pe care
-- oricine il putea inregistra. Nimic nu pleaca pe posta de la noi, dar un
-- domeniu strain in adresele de autentificare nu are ce cauta.
--
-- ".invalid" este rezervat prin RFC 2606 exact pentru asa ceva: nu se poate
-- inregistra si nu primeste posta.
--
-- Migratia muta si conturile deja facute, ca omul sa intre mai departe cu
-- acelasi numar si aceeasi parola.

update auth.users
   set email = replace(email, '@telefon.adminbloc.ro', '@telefon.adminbloc.invalid')
 where email like '%@telefon.adminbloc.ro';

update auth.identities
   set identity_data = identity_data || jsonb_build_object(
         'email', replace(identity_data ->> 'email', '@telefon.adminbloc.ro', '@telefon.adminbloc.invalid'))
 where identity_data ->> 'email' like '%@telefon.adminbloc.ro';
