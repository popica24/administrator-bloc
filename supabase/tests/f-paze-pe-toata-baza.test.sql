-- Reguli care privesc toata baza, nu o singura functie. Aici intra ce a
-- scapat o data printre migratii si a fost prins abia de advisorii Supabase,
-- pe productie; un test il prinde acum la prima migratie care il incalca.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

-- O functie fara search_path fixat cauta tabelele si functiile dupa calea
-- celui care o apeleaza: un obiect cu acelasi nume, pus inaintea celui real,
-- ar fi folosit in locul lui (advisorul "function_search_path_mutable", gasit
-- pe productie la public.numar_ro, 21 septembrie). Extensiile nu sunt ale noastre.
select is_empty(
  $$select n.nspname || '.' || p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'organizare', 'identitate', 'intretinere', 'contorizare', 'financiar',
                        'sesizari', 'guvernanta', 'comunicare', 'nomenclator', 'private', 'evenimente', 'audit')
      and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not coalesce(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'), false)$$,
  'fiecare functie a aplicatiei are search_path fixat (ultima prinsa: public.numar_ro)');

-- Schema public este expusa prin API: o functie security definer de acolo,
-- apelabila de anon sau authenticated, ruleaza cu drepturile proprietarului
-- pentru oricine o cheama (advisorii "security_definer_function_executable",
-- gasiti pe productie la public.rls_auto_enable, 21 septembrie).
select is_empty(
  $$select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))$$,
  'nicio functie security definer din public nu e apelabila prin API (ultima prinsa: public.rls_auto_enable)');

select * from finish();
rollback;
