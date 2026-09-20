-- [minor] contorizare.valideaza_citiri_apartament si
-- identitate.revoca_invitatie au revocat dreptul de executie de la PUBLIC,
-- ca toate comenzile, dar l-au re-acordat doar catre authenticated. Restul
-- comenzilor din aceste doua scheme au si un grant catre service_role
-- (contorizare: pe toata schema; identitate: pe toata schema, dintr-o
-- migratie anterioara ambelor comenzi, care nu le-a putut prinde pentru ca
-- inca nu existau). Fara el, un apel cu service_role (Edge Function,
-- recalculare, script de intretinere) nu poate chema aceste doua comenzi.

grant execute on function contorizare.valideaza_citiri_apartament(uuid, date, boolean, text) to service_role;
grant execute on function identitate.revoca_invitatie(uuid) to service_role;
