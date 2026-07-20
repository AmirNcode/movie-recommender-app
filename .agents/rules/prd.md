---
trigger: always_on
---

# Product Requirements Document (PRD): Filmmoo

> Updated 2026-07 to match the shipped product. The original "SceneIt" PRD
> (anonymous, session-only, AI-generated feed) is obsolete — see git history.

## 1. Overview
**Product Name:** Filmmoo
**Platform:** Responsive web app (mobile-first), deployed on Vercel.
**Description:** Tinder-style movie recommendation app. Users swipe on movie
cards to build a persisted taste profile; an AI engine recommends films with a
personalized "Why you'll love it" reason. Accounts are required (Supabase auth:
email/password + Google OAuth); onboarding takes under a minute.

## 2. Core product
- **Swipe deck:** left = Unwatched, right = Watched, up = Loved, down =
  Disliked; button controls + undo. Cards come from a per-user queue filled
  from a shared, nightly-refreshed TMDB candidate pool (no TMDB calls in the
  user path).
- **Recommendations:** taste profile built server-side from persisted swipe
  state. Default engine: pgvector retrieval over embedded pool movies + Gemini
  re-rank (`gemini-2.5-flash`); free-form legacy engine behind
  `RECS_ENGINE=freeform`. Free tier: 3 recommendations/day.
- **Onboarding:** rate 12 well-known movies at signup (cold-start fix).
- **Library:** watchlist (save/rate later) + full swipe history.
- **Movie detail:** poster, synopsis, trailer, where-to-watch providers
  (JustWatch-attributed), share button.
- **Movie Night:** two users join by code, swipe the same deck via Supabase
  Realtime, match on first mutual yes. Free: 1 night/week per host.
- **Sharing:** public `/r/<id>` pages with OG images for recommendations and
  Cinema DNA; signup CTA on every public page.
- **Weekly digest:** opt-in Monday email (Resend) with top 3 unseen picks.
- **Pro (Stripe):** unlimited recommendations and Movie Nights, decade/rating
  filters, Cinema DNA taste report. Billing gated behind `BILLING_ENABLED`
  until the TMDB commercial license is confirmed (decision D4).

## 3. Technical
- Next.js 16 App Router + React 19 + TS strict; Tailwind 4; Motion; Lucide.
- Supabase: Postgres + RLS everywhere, pgvector, pg_cron, Realtime;
  migrations in `supabase/migrations/` are the schema source of truth.
- Server actions return `ActionResult` unions (never throw for expected
  failures); all client payloads validated server-side; per-action DB-backed
  rate limits.
- Observability: Sentry + Vercel Analytics. Tests: Vitest units + Playwright
  smoke; CI runs tsc/lint/test/build.

## 4. Working agreements for agents
- Read `docs/PRODUCTION_AUDIT.md` CONTEXT before structural changes.
- New tables get RLS; new RPCs are `security definer`, pinned `search_path`,
  minimum-role execute grants.
- Apply every migration to the live Supabase project (`bhtkujcfvknxphatejbu`)
  as well as committing the file.
- Gates before claiming done: `npx tsc --noEmit && npm run lint && npm test
  && npm run build`.
