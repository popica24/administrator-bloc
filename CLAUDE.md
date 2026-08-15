# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Effect |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 (opens the browser automatically) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint over the whole project |

There is no test setup — no test runner, no test files, no test script. Verification is `npm run lint` plus running the app.

## What this is

AdminBloc is a functional mockup of a Romanian apartment-building administration app (maintenance charge list, meter readings, complaints, admin↔tenant communication). It runs entirely in the browser on mock data: **no backend, no `fetch`, no persistence**. Reloading resets all state.

Two roles are switchable from the top bar (`BaraSus`), each with its own bottom tab bar:
- **Locatar** (tenant) — Acasa, Plata, Contoare, Sesizari, Bloc
- **Administrator** — Sumar, Apartamente, Facturi, Sesizari, Comunicare

## Architecture

Essentially the whole app lives in one file: `src/AdminBloc.jsx` (~2500 lines). `src/main.jsx` only mounts it; `src/index.css` is a document-level reset. This is deliberate — do not split it into modules without being asked.

The file is divided into numbered sections, in reading order:

1. **TOKENS** — `C` (colors), `S` (spacing), `R` (radii), `F` (fonts). No hardcoded colors or spacing anywhere else.
2. **HELPERS** — pure JS: `round2`, `lei()` (Romanian `1.234,56 lei` formatting, hand-written to avoid `Intl`), `num()`, month labels, date helpers.
3. **MOCK DATA** — `BLOC`, `APARTAMENTE`, `FACTURI` (keyed by month), `CONSUM`, `CONTOR_GENERAL`, `SOLDURI_INITIALE`, `SESIZARI_INITIALE`, etc. `LUNA_CURENTA = "2026-07"`; `LUNI_DISPONIBILE` holds the three months with data.
4. **ENGINE** — the allocation logic. **This is the single source of truth for every number displayed.**
5. **PRIMITIVE** — `Box`, `Txt`, `Btn`, `Press`, `Card`, `Field`, `Sheet`, etc. The only place that touches the DOM.
6. **STARE PARTAJATA** — one `AppCtx` React Context holding all mutable state.
7. **ELEMENTUL SEMNATURA** — `RandLista`, the expandable charge row.
8. **ECRANE LOCATAR** / 9. **ECRANE ADMINISTRATOR** / 10. **NAVIGATIE SI SHELL** / 11. **APLICATIA**.

### The engine is the invariant

`calculeazaLuna(luna)` runs once per month in `LUNI_DISPONIBILE` at module load and fills `LISTE`. Every screen — tenant list and admin report alike — reads from `LISTE`, `deIncasat()`, `penalizare()`, `STATISTICI`. **Screens must never contain hand-written numbers.** That is what keeps the tenant's charge list and the administrator's report from contradicting each other; breaking it is the main correctness risk in this codebase.

Allocation methods (`METODE`): `consum`, `persoane`, `persoaneFaraParter` (ground floor pays no lift), `apartamente`, `cota` (share of common property). Two notable rules:
- `repartizeazaApa` splits water by individual meter consumption, then distributes the gap between the building's main meter and the sum of individual meters across people.
- `corecteazaRotunjirea` pushes the rounding remainder onto the largest share so the allocated total matches the invoice to the ban.

### The signature element

`RandLista` is the row in the charge list that expands to show the full derivation of the amount — invoice total, allocation basis, the arithmetic, the supporting document. The rest of the app is built around it; treat it as the feature, not decoration.

### State

All mutable state is `useState` in the `AdminBloc()` root component, exposed through `AppCtx` as an `api` object (`adaugaSesizare`, `schimbaStare`, `raspunde`, `adaugaAnunt`, `voteaza`, `plateste`, `transmiteIndex`, `incaseaza`, `comutaReminder`, `toastMsg`). Screens read it via `useApp()`. When a real backend arrives, only these functions become network calls.

## Conventions

**React Native portability is a hard constraint.** The file is written to port with minimal rewriting (`Box`→`View`, `Txt`→`Text`, `Btn`→`Pressable`, `.map()`→`FlatList`, `style={{}}`→`StyleSheet.create`). Therefore:
- Flexbox only — no CSS grid, no pseudo-selectors, no CSS units other than px.
- No external libraries, no icon packs (tab labels are plain text). Only `react` / `react-dom`.
- Screens use only the primitives from section 5; raw DOM elements belong in section 5 alone.
- Web-only CSS lives in the `BASE_CSS` template string (fade + slide animations, focus rings) — it is expected to disappear on port.
- Sections 2, 3 and 4 must stay pure JavaScript so they copy over unchanged.

**Language:** identifiers, comments, and UI strings are Romanian without diacritics (`sesizari`, `intretinere`, `factura`). Follow that; do not introduce diacritics or mix in English names.

**Layout:** the app shell is a fixed-width column (`maxWidth: 520`, full viewport height) centered on the page — it is designed as a phone screen, not a desktop layout.
