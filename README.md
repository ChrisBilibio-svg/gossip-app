# Viddi (gossip-app)

Brazil's gossip-prediction game. Curated rumors → the crowd predicts **tea 🍵 / cap 🧢** →
a credible source resolves it → callers score and climb the leaderboard.

Native mobile (Expo / React Native + TypeScript) + Supabase (Postgres) backend.
Planning docs live in the Obsidian vault (`Brainstorm Abs/04 Ideas/Gossip App *`).

## Story 1.1 — what's here

- Expo + TypeScript app scaffold.
- Design-token theme from the UX spine → `src/theme/tokens.ts`.
- Branded shell screen (Nunito Sans, professional feed-first UI) → `App.tsx`.
- Supabase client (env-based keys) → `src/lib/supabase.ts`.
- Connection health check (shown on the shell) → `src/lib/healthcheck.ts`.
- Database-as-code migrations → `supabase/migrations/`.

## Setup

1. Install deps: `npm install`
2. Create a Supabase project (Settings → API gives you the URL + anon key).
3. Copy env: `cp .env.example .env` and fill in:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
4. Run: `npm run android` (Android-first), `npm run ios`, or `npm run web`.

The shell shows a connection status pill: 🟡 not configured · 🟢 connected · 🔴 error.

## Project layout

```
App.tsx                 branded shell + health status
src/theme/tokens.ts     design tokens (colors, fonts, spacing, radius)
src/lib/supabase.ts     Supabase client
src/lib/healthcheck.ts  connection check
supabase/migrations/    schema as ordered SQL
.env.example            template for your keys (.env is gitignored)
```

## Conventions (for Claude Code / contributors)

- Build one **story** at a time from `epics.md`; tables/RLS/functions added by the story that needs them.
- Correctness lives in Postgres (constraints, RLS, SECURITY DEFINER functions), not the client.
- Tokens come from `src/theme/tokens.ts` — never hard-code colors/fonts.
