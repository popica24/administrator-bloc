-- audit.inregistreaza() lua rand_id din ->>'id', presupunand ca fiecare tabel
-- auditat are coloana `id`. identitate.administratori are cheia primara
-- `profil_id`, deci fiecare rand din audit.jurnal pentru acest tabel avea
-- rand_id null: istoricul unui administrator nu se putea gasi dupa cheia lui
-- (audit S14).
--
-- Solutia ramane generica (nu speciala pentru administratori): incearca
-- 'id', apoi 'profil_id', pentru orice alt tabel auditat cu aceeasi forma de
-- cheie.

create or replace function audit.inregistreaza()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vechi jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_nou jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_rand jsonb := coalesce(v_nou, v_vechi);
begin
  insert into audit.jurnal (tabela, rand_id, operatie, vechi, nou, autor_id)
  values (
    tg_table_schema || '.' || tg_table_name,
    nullif(coalesce(v_rand ->> 'id', v_rand ->> 'profil_id'), '')::uuid,
    tg_op,
    v_vechi,
    v_nou,
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;

revoke execute on function audit.inregistreaza() from public, anon, authenticated;
