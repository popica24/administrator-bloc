-- O cheie unica pe un singur rand pentru comunicare.anunturi_citiri (audit 2: P3).
--
-- Paginarea aplicatiei nu mai merge pe OFFSET, ci pe cheie: fiecare pagina
-- cere randurile de dupa ultimul id primit. Asta cere o coloana unica pe care
-- se poate ordona. anunturi_citiri era singura tabela citita paginat fara asa
-- ceva: cheia ei primara este perechea (anunt_id, profil_id), iar o paginare pe
-- anunt_id ar sari randurile care cad exact pe granita paginii.
--
-- Coloana se adauga, nu se inlocuieste: cheia primara compusa ramane cea care
-- garanteaza ca un anunt se marcheaza citit o singura data de aceeasi persoana.

alter table comunicare.anunturi_citiri
  add column id uuid not null default gen_random_uuid();

create unique index anunturi_citiri_id_key on comunicare.anunturi_citiri (id);

comment on column comunicare.anunturi_citiri.id is
  'Cheie unica pe rand, folosita doar pentru paginarea pe cheie a citirilor din aplicatie.';
