-- nomenclator.administratii_locale a fost cindva public.administratii_locale,
-- unde privilegiile implicite ale schemei public dau ALL (insert, update,
-- delete, truncate) catre anon si authenticated. Mutarea in schema
-- nomenclator (20260919120008_fundatia.sql) a adaugat un grant select
-- explicit, dar nu a retras si privilegiile mostenite: anon si authenticated
-- puteau in continuare sa insereze, modifice, stearga sau goleasca tabelul de
-- referinta, desi singura politica RLS existenta e "pot fi citite de oricine"
-- (audit S15).
--
-- Tabelul de referinta se schimba doar prin migratii (seed-ul localitatilor),
-- niciodata prin aplicatie: singurul acces legitim pentru anon/authenticated
-- este select.

revoke insert, update, delete, truncate, references, trigger, maintain
  on nomenclator.administratii_locale from anon, authenticated;
