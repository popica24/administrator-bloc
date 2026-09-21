-- public.rls_auto_enable() se poate apela prin API de oricine, chiar si
-- neautentificat (advisorii Supabase "anon/authenticated security definer
-- function executable", pe productie, 21 septembrie).
--
-- Functia exista doar in productie, nu in vreo migratie: este functia
-- event trigger-ului ensure_rls (ddl_command_end), care activeaza RLS pe
-- orice tabela noua din public (vezi abilitatea adaugare-migratie, "Capcana
-- RLS"). Intoarce event_trigger, deci un apel direct cade oricum, dar nu are
-- ce cauta in API. Revocarea nu atinge trigger-ul: la declansarea unui
-- trigger, Postgres nu verifica dreptul EXECUTE pe functia lui.
--
-- Local functia nu exista, deci migratia nu face nimic acolo.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable' and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
