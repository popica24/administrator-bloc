---
name: adaugare-migratie
description: Use when adding or changing anything in the AdminBloc database - a new table, column, constraint, index, trigger, RLS policy, or any DDL. Triggers include "adauga o migratie", "migratie noua", "tabela noua", "schema change", "add a table", or any request that ends in SQL reaching this project's Postgres.
---

# Adaugare migratie (AdminBloc)

Every schema change is a file in `supabase/migrations/`, tried on the local stack first and
pushed to production only when it works. The file is the source of truth; the database is
downstream of it.

## Cele doua baze de date

| | Local | Productie |
|---|---|---|
| Ce este | Docker, `supabase start` | proiectul `hqadxjmuajbzfsafvzhd` |
| Cum ajungi la ea | CLI `supabase`, psql pe `127.0.0.1:54322`, Studio pe `:54323` | uneltele MCP `mcp__supabase__*` |
| Ce ai voie | orice; `supabase db reset` sterge tot si rejoaca migratiile | citiri libere; scrieri doar prin `supabase db push` |

**You develop against local. You never iterate against production.** Use the global
`supabase` CLI (it is installed — do not write `npx supabase`).

If `supabase status` reports no containers, start them: `supabase start`. First start pulls
images and takes minutes.

## Bucla

1. **Create the file — never hand-name it:**
   `supabase migration new <nume_snake_case_in_romana>`
2. **Write the SQL** in that file. Style: copy
   `supabase/migrations/20260907115303_administratii_locale.sql`, the reference implementation.
   Checklist below.
3. **Try it locally:** `supabase db reset`. This drops the local database and replays every
   migration in order, so it proves the file works from scratch, not just against your current
   state. Broken SQL fails here, for free. Iterate until it passes — edit the file and reset
   again, as many times as needed.
4. **Verify locally** — see the verification block below.
5. **Push to production:** `supabase db push --dry-run` first, read what it says it will do,
   then `supabase db push`. **Anything destructive — `drop`, `alter ... type`, `delete`,
   `truncate`, a `not null` on an existing column — is confirmed with the user before the push,
   not before the local reset.** Local is free; production has no undo.
6. **Confirm production took it:** `supabase migration list --linked` (local and remote columns
   must match) and `mcp__supabase__get_advisors` for both `security` and `performance`. Report
   what the advisors say instead of silencing it; `rls_enabled_no_policy` is a legitimate answer
   when deny-all is the intent.
7. **Commit only if asked.** The one file under `supabase/migrations/`, nothing else.
   `src/AdminBloc.jsx` still runs on mock data — a migration never touches it.

**Do not use `mcp__supabase__apply_migration` in this loop.** It writes straight to production,
skips the local test, and stamps its own timestamp — which is exactly how the file on disk came
to disagree with the recorded version once already. If you ever must use it, read the version
back with `list_migrations` and `git mv` the file to match.

## Verificare locala

```sh
supabase db reset                      # trebuie sa aplice migratia fara eroare
docker exec -i supabase_db_AdministratorBloc psql -U postgres -d postgres -c "\d public.<tabela>"
```

Then check the things `\d` does not show: that RLS is on and the policies are the ones you
intended (`select * from pg_policies where schemaname='public';`), and that the `actualizat_la`
trigger is attached. Insert a couple of rows locally to prove the constraints bite — locally
this costs nothing, and `db reset` wipes it.

## Checklist pentru SQL

- Identifiers, comments and policy names in **Romanian without diacritics**, like the rest of
  the repo. A header comment explains the domain concept, not the syntax.
- `id uuid primary key default gen_random_uuid()`.
- `creat_la` / `actualizat_la timestamptz not null default now()`, plus
  `create trigger <tabela>_actualizat_la before update ... execute function public.seteaza_actualizat_la();`
  That function already exists — reuse it, never define a second one.
- Named constraints: `<tabela>_<coloana>_check`, `<tabela>_<coloana>_key`. Text columns that
  must not be blank get `check (length(btrim(<coloana>)) > 0)`.
- Foreign keys: `references public.<tabela> (id) on delete restrict`, **and an index on the
  referencing column** unless a unique constraint already leads with it — the advisors flag it
  otherwise.
- `comment on table` / `comment on column` for anything a reader would have to guess.
- Indexes only for queries that exist, with a comment saying which query.
- **`alter table ... enable row level security` written explicitly, then the policies.**

## Capcana RLS

Production has an enabled event trigger `ensure_rls` (function `public.rls_auto_enable()`) that
turns RLS on for every new table in `public`. **It exists only in production** — it is in no
migration file, so the local stack does not have it.

That asymmetry is the trap: a table created without an explicit `enable row level security` is
RLS-off locally and RLS-on in production, and you will test the permissive one and ship the
restrictive one. Write the line explicitly, every time.

The second half: a table that is RLS-on with **zero policies** returns zero rows through the
API and looks like a broken app. Deny-all is a fine choice — make it deliberately and say so in
a comment.

## Greseli frecvente

| Greseala | Ce se intampla |
|---|---|
| `apply_migration` sau `execute_sql` pentru DDL | Schimbare netestata direct in productie, plus versiuni divergente |
| Nume de fisier scris de mana | Format gresit sau ordine gresita a migratiilor |
| `npx supabase` | CLI-ul e instalat global; `npx` descarca alta versiune |
| Ai sarit peste `db reset` | SQL-ul merge pe starea ta curenta, dar nu de la zero |
| Tabela noua fara RLS explicit | Local si prod se comporta diferit |
| Tabela noua fara politici | Zero randuri prin API, si pare bug de aplicatie |
| Commit nesolicitat | Vezi pasul 7 |
