# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Effect |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 (opens the browser automatically) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint over the whole project |
| `supabase start` | Local Supabase stack in Docker (API :54321, Postgres :54322, Studio :54323) |
| `supabase db reset` | Drop the local DB, replay every migration, run `supabase/seed.sql` |
| `npm run seed` | Load the demo building (D14) into the local DB through the real backend commands; run after `db reset` |
| `npm test` | Unit tests (vitest, jsdom): engine, PDF, demo source, every UI screen. No server needed |
| `npm run test:integrare` | `src/sursa-supabase.js` against the local stack (needs `supabase start` + seed) |
| `npm run test:acoperire` | Both vitest projects with v8 coverage; fails below 100% |
| `npm run test:functii` | Edge Functions with `deno test`; fails below 100% (`scripts/acoperire-deno.mjs`) |
| `npm run test:db` / `npm run acoperire:sql` | pgTAP tests in `supabase/tests/`; every function, error and RLS policy must be cited by a test |

Coverage is 100% on every layer and the thresholds are enforced: new code needs tests. Known bugs
(`docs/audit-2026-09-19.md`) have tests for the correct behaviour marked `it.fails` / Deno `ignore`
/ pgTAP `todo` with the bug ID; after fixing one, remove its marker. UI tests use
`tests/unit/ajutor.jsx` (demo source, Date frozen at 2026-09-19). pgTAP files build their own
fixtures inside a rolled-back transaction and override `private.este_serviciu()` locally, because
under psql `session_user` is `postgres`. Verification is also `npm run lint` and
`supabase db lint --local`. Test accounts are in `conturi-test.txt` (password `Bloc-D14-2026`).

## What this is

AdminBloc is a Romanian apartment-building administration app (maintenance charge list, meter
readings, complaints, admin↔tenant communication) whose product promise is transparency: every
amount opens into the formula, invoice and document behind it.

The app has two data sources with the same interface (`src/sursa.js` picks one):
- **Supabase** when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set (`.env.local`,
  see `.env.example`). Local development uses the Docker stack; production is not wired yet.
- **Demo mode** otherwise: `src/sursa-mock.js`, in memory, reset on reload. It replays
  `src/date-demo.js` with the same rules as the database, so both sources show the same numbers.

Login decides the role: **Locatar** (Acasa, Plata, Contoare, Sesizari, Bloc) or
**Administrator** (Sumar, Apartamente, Facturi, Sesizari, Comunicare). An unverified
administrator or an account without an apartment gets a waiting / invitation-code screen.

## Architecture

### Frontend
- `src/AdminBloc.jsx` — the whole UI in one file (do not split it without being asked), in
  numbered sections: 1 TOKENS, 2 HELPERS, 3 CONSTANTE (labels), 4 DERIVARI (pure functions that
  read the loaded data), 5 PRIMITIVE (the only place touching the DOM), 6 STARE (`AppCtx`),
  7 `RandLista`, 8 locatar screens, 9 admin screens, 10 shell + auth screens, 11 the app.
- `src/sursa-supabase.js` / `src/sursa-mock.js` — `incarca()` returns one `date` object for the
  signed-in user; every command (`platesteCard`, `publicaLista`, …) is a method. The app wraps
  each command in `cmd()` (call, reload, toast) and screens get `{ ok, rezultat }` back.
- `src/pdf.js` — tiny PDF writer (receipts, the list for the notice board). No libraries.
- `supabase/functions/_shared/motor.js` — **the allocation engine**, pure JS, imported unchanged
  by the app (invoice preview) and by the `publica-lista` Edge Function (Deno).

### The engine is the invariant
Amounts are computed **once**, when a list is published: `publica-lista` runs `motor.js` and
`intretinere.salveaza_lista_publicata()` stores the result in `intretinere.repartizari` in one
transaction. Screens only read stored rows and the financial ledger; they never compute a charge.
Never reimplement allocation in SQL or in a screen — that is the "tenant list and admin report
contradict each other" bug the app exists to prevent. Methods: `consum`, `persoane`,
`persoane_fara_lift` (uses `scutit_lift`), `apartamente`, `cota` (divides by the sum of shares;
the DB refuses to activate a block whose shares do not sum to 100).

`RandLista` is the signature element: the row that expands into the full derivation.

### Backend (DDD, `docs/schema-propunere.md`)
One Postgres schema per bounded context: `organizare`, `identitate`, `intretinere` (core),
`contorizare`, `financiar`, `sesizari`, `guvernanta`, `comunicare`, `nomenclator`; unexposed:
`private` (RLS helpers), `evenimente` (domain event queue), `audit` (change log). Migrations are in
`supabase/migrations/` in the order of §9; use the `adaugare-migratie` skill for any DDL.

- Reads go through RLS (`private.blocuri_administrate()`, `private.apartamentele_mele()`, …).
  Writes go through `security definer` command functions, one aggregate each.
- Money is an append-only ledger: `datorii`, `plati`, `alocari_plati` (oldest debt first),
  `chitante` (gapless numbering via `setari_financiare`), `penalizari` (frozen parameters, monthly
  pg_cron job). Balance is always computed (`financiar.datorii_rest`, `financiar.solduri`).
- Cross-context effects are events in `evenimente.coada`, processed by `evenimente.proceseaza`
  (called by the `proceseaza-eveniment` Edge Function via a pg_net webhook, and by pg_cron).
- Edge Functions: `publica-lista`, `plata-card` + `procesator-simulat` + `plata-card-webhook`
  (HMAC, simulated card processor), `proceseaza-eveniment`, `creeaza-asociatie`, `exporta-bloc`.
- Storage buckets (private): `documente`, `poze` (1 MB, JPEG/WebP; the app shrinks photos),
  `atestate`.

## Conventions

**React Native portability is a hard constraint for the UI.** Flexbox only, no grid, no
pseudo-selectors, px only; screens use only section-5 primitives; web-only CSS lives in
`BASE_CSS`. Only `react`, `react-dom` and `@supabase/supabase-js` (which also runs on RN).

**Language:** identifiers, comments, UI strings and SQL are Romanian without diacritics.

**Users are 50+ and non-technical:** large touch targets, plain wording, one primary action per
screen, derivations behind the expandable row.

**Layout:** a fixed-width phone column (`maxWidth: 520`), not a desktop layout.
