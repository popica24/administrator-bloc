-- Fusul orar al bazei de date: ora Romaniei (audit X1).
--
-- Postgres rula in UTC, iar aplicatia in ora Romaniei. Tot ce tine de
-- calendar in baza (current_date, ::date, "luna curenta", scadente,
-- remindere, data intrarii in fond) se decidea cu 2-3 ore in urma: pe 1 ale
-- lunii intre 00:00 si 03:00, transmiterea indexului era refuzata ("doar luna
-- curenta"), iar restantele difereau intre ecran si baza. Cu fusul orar al
-- bazei setat, fiecare sesiune noua (PostgREST, Edge Functions, pg_cron)
-- calculeaza datele calendaristice in Europe/Bucharest, cu ora de vara
-- inclusa. Momentele (timestamptz) raman aceleasi; se schimba doar felul in
-- care devin zile.
--
-- Programul joburilor pg_cron ramane in GMT (cron.timezone); in interiorul
-- lor, current_date este acum ziua din Romania.

alter database postgres set timezone to 'Europe/Bucharest';
