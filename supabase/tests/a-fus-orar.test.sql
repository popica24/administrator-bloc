-- Fusul orar al bazei de date [X1]: zilele si lunile se decid in ora Romaniei,
-- ca in aplicatie. Inainte, baza rula in UTC si pe 1 ale lunii, intre 00:00 si
-- 03:00, "luna curenta" era inca luna trecuta.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select is(current_setting('TimeZone'), 'Europe/Bucharest',
  '[X1] sesiunile noi pornesc cu fusul orar Europe/Bucharest');
select is(current_date, (now() at time zone 'Europe/Bucharest')::date,
  '[X1] current_date este ziua din Romania');
select is(date_trunc('month', '2026-09-30 22:30:00+00'::timestamptz)::date, '2026-10-01'::date,
  '[X1] 1 octombrie, ora 01:30 in Romania, este deja luna octombrie (in UTC era inca 30 septembrie)');
select is('2026-01-31 23:30:00+00'::timestamptz::date, '2026-02-01'::date,
  '[X1] iarna (UTC+2): 01:30 pe 1 februarie in Romania este 1 februarie');

select * from finish();
rollback;
