# Filmmoo

Filmmoo is a Tinder-style movie recommendation app. Swipe on movie cards to build a taste profile; an AI engine recommends films you're likely to love, with a personalized "Why you'll love it" explanation. Auth and persistence are powered by Supabase; recommendations by Gemini; movie data by TMDB.

## Features

- **Swipe deck** — swipe left (Unwatched), right (Watched), up (Loved), down (Disliked), with button controls and undo. Cards are served from a per-user queue filled from a shared, nightly-refreshed candidate pool (zero TMDB calls in the user path).
- **AI recommendations** — taste profile is built server-side from your persisted swipe history. Default engine: pgvector similarity retrieval over embedded pool movies + Gemini re-rank (guaranteed real, in-catalog picks). Legacy free-form engine available via `RECS_ENGINE=freeform`.
- **Cold-start onboarding** — rate 12 well-known movies at signup for instant personalization.
- **Watchlist & history** — save recommendations, rate them later, browse everything you've swiped.
- **Where to watch** — streaming/rent/buy providers per movie (TMDB watch providers; streaming data by JustWatch), plus trailers.
- **Deck filters** — genre for everyone; decade and minimum-rating with Pro.
- **Movie Night** — two users join by code, swipe the same deck in realtime, and get matched on the first mutual yes.
- **Shareable cards** — public `/r/<id>` pages with OG images for recommendations and Cinema DNA reports.
- **Weekly digest** — opt-in Monday email with your top three unseen picks.
- **Filmmoo Pro** — Stripe-billed subscription: unlimited recommendations (free tier: 3/day), unlimited Movie Nights, full filters, and Cinema DNA (an AI-written taste persona).

## Tech stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript (strict)
- **Styling:** Tailwind CSS 4 · **Animations:** Motion · **Icons:** Lucide
- **Data/Auth:** Supabase (Postgres + RLS, pgvector, pg_cron, Realtime, Auth with Google OAuth)
- **AI:** `@google/genai` — `gemini-2.5-flash` (recommendations, Cinema DNA), `gemini-embedding-001` (768-dim movie embeddings)
- **Billing:** Stripe subscriptions (webhook-driven entitlements)
- **Email:** Resend · **Observability:** Sentry + Vercel Analytics
- **Deploy:** Vercel (crons in `vercel.json`)

## Local development

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (Supabase URL/keys, `GEMINI_API_KEY`, `TMDB_API_KEY`, `CRON_SECRET`, Stripe + Resend keys as needed).
3. Apply migrations to your Supabase project: `npx supabase db push` (migrations live in `supabase/migrations/` and are the schema source of truth).
4. `npm run dev`

### Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint` — ESLint · `npm test` — Vitest unit tests
- `npx playwright test` — smoke E2E (needs env + a reachable Supabase project)
- `node --env-file=.env scripts/backfill-embeddings.mjs` — embed pool movies missing vectors (the nightly cron keeps new rows embedded)

### Cron routes (bearer-gated by `CRON_SECRET`)

- `GET /api/cron/refresh-pool` — nightly: refresh the shared candidate pool from TMDB, hydrate + embed new movies, backfill trailers, expire stale Movie Nights
- `GET /api/cron/weekly-digest` — Mondays: send digest emails to opted-in users

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability data by JustWatch.
