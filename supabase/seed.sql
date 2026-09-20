-- Seed local: doar ce nu se poate scrie prin API.
-- Webhook-ul bazei de date (evenimente.anunta_functia) are nevoie de adresa
-- Edge Function-ului proceseaza-eveniment si de o cheie de serviciu. Valorile de
-- mai jos sunt cele ale stack-ului local Docker (cheia demo publica a CLI-ului
-- Supabase); in productie se scriu separat, in Vault, niciodata in git.
-- Datele demo ale blocului se incarca apoi cu: npm run seed

select vault.create_secret(
  'http://supabase_kong_AdministratorBloc:8000/functions/v1/proceseaza-eveniment',
  'url_proceseaza_eveniment',
  'Adresa Edge Function-ului care proceseaza evenimentele de domeniu'
);

select vault.create_secret(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  'cheie_serviciu',
  'Cheia service_role a stack-ului local, folosita de webhook'
);
