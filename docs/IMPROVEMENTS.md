# Filmmoo Improvements & Growth Roadmap — Implementation Specification

Machine-oriented implementation list for an agent. Companion to `docs/PRODUCTION_AUDIT.md` (defect fixes). This doc covers NEW features, architecture upgrades, and monetization.

## CONTEXT (read first)

- Read the CONTEXT block of `docs/PRODUCTION_AUDIT.md` for stack, env vars, Supabase project ref (`bhtkujcfvknxphatejbu`), migration workflow, and verification gates. Everything there applies here.
- **Hard prerequisite: PRODUCTION_AUDIT.md items F1–F10 must be implemented first.** Several items below build on them — S-items assume the `ActionResult` union error model (F2), server-side taste profile (F5), input validation (F6), and rate-limit coverage (F7) exist. Do not start this doc until `npx tsc --noEmit && npm run lint && npm run build` pass on a tree containing those fixes.
- Work in phases, in order. Within a phase, items are independent unless a `Prereq:` says otherwise. Each item ends with ACCEPTANCE — verify before moving on.
- Conventions to follow: server actions in `actions/*.ts` returning `ActionResult<T>`; per-user RLS on every new user-owned table; new RPCs `security definer` + `set search_path = ''` + execute revoked from `public, anon` (grant minimum needed role); all client-controlled strings validated/truncated server-side (reuse `lib/validate-movie.ts` patterns from F6); every migration committed to `supabase/migrations/` AND applied to the live project.
- New env vars introduced in this doc (add to `.env.example` with placeholder values as each item lands, and to Vercel): `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` (S4), `RESEND_API_KEY` (S9), `CRON_SECRET` (S10, S9), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_YEARLY` (S14).

## DECISIONS REQUIRED FROM THE OWNER (do not guess these)

Blockers are marked on the items they block. Where a default is stated, use it if no answer is available, and flag it in the final summary.

| ID | Decision | Blocks | Default if unanswered |
|----|----------|--------|----------------------|
| D1 | Product name: "Filmmoo" (current code) vs "SceneIt" (old PRD) + production domain | S2 (share URLs/OG), S9 (email sender), S14 (Stripe product names) | Keep "Filmmoo" |
| D2 | Pro price point | S14 | $2.5/mo, $25/yr |
| D3 | Free-tier daily recommendation quota | S13 | 3/day |
| D4 | TMDB commercial license: purchased before or after paywall launch? (free TMDB API tier is non-commercial; charging without it violates ToS) | S14 go-live (not its implementation) | Implement S14 behind a disabled flag; do not enable billing until license confirmed |
| D5 | Transactional email provider | S9 | Resend |

---

## PHASE 1 — PRE-LAUNCH (high leverage, small scope)

### S1. Streaming availability on movie detail / recommendation cards
- Goal: answer "where can I watch it" — the #1 drop-off after a recommendation lands.
- API: TMDB `GET /movie/{id}/watch/providers` (same `api_key` auth as existing calls). Response is per-country: `results.US.flatrate|rent|buy`, each entry `{provider_id, provider_name, logo_path}`, plus a `link` URL (a TMDB/JustWatch landing page).
- Implementation:
  1. Migration: add to `movies_cache`: `watch_providers jsonb`, `watch_providers_fetched_at timestamptz`. No RLS change (table already read-only for authenticated).
  2. `lib/tmdb.ts`: add `fetchWatchProviders(apiKey, tmdbId): Promise<Json | null>` — fetch, extract only the viewer-relevant subset (store the full `results` object; it's small), return null on !ok.
  3. New server action `getWatchProviders(tmdbId: number): Promise<ActionResult<WatchProviderData | null>>` in `actions/movies.ts`: auth-gate → read from `movies_cache`; if `watch_providers_fetched_at` older than 7 days or null, fetch from TMDB via admin client and upsert. Add to `ACTION_LIMITS` (30/min). Country: parse `Accept-Language`/default `US`; return that country's entry plus the `link`.
  4. UI: in `components/movie-detail-card.tsx`, below the synopsis block, render a "Where to watch" row — provider logos (`https://image.tmdb.org/t/p/w45${logo_path}` — extend the trusted-URL check to allow `/t/p/` logo paths, they're same-host), grouped Stream/Rent/Buy, the whole row linking to the TMDB `link` URL (`target="_blank" rel="noopener noreferrer"`). Empty state: "Not streaming in your region". Fetch lazily on card open, not in the queue payload.
  5. **Attribution (required by TMDB terms for watch-provider data): render "Streaming data by JustWatch" next to the row.** Also add the general TMDB attribution ("This product uses the TMDB API but is not endorsed or certified by TMDB") + TMDB logo in a small app footer if not already present (see audit OPS-6).
- ACCEPTANCE: open a recommendation for a mainstream movie → provider logos render; second open within 7 days does not hit TMDB (verify via log or network); JustWatch attribution visible.

### S2. Shareable recommendation links with OG cards (the viral loop)
- Goal: a user can share "Filmmoo told me to watch X because Y" — link renders a rich preview and lands visitors on a signup CTA.
- Implementation:
  1. Migration — new table:
     ```sql
     create table public.shared_recommendations (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null references auth.users on delete cascade,
       tmdb_movie_id integer not null,
       movie_title text not null,
       movie_year integer,
       poster_url text,
       reason text,
       created_at timestamptz not null default now(),
       constraint shared_rec_text_caps check (length(movie_title) <= 300 and coalesce(length(reason),0) <= 2000 and coalesce(length(poster_url),0) <= 600)
     );
     alter table public.shared_recommendations enable row level security;
     create policy "Anyone can read a shared rec by id" on public.shared_recommendations for select using (true);
     create policy "Users insert own shared recs" on public.shared_recommendations for insert to authenticated with check ((select auth.uid()) = user_id);
     ```
     (Public SELECT is intentional — ids are unguessable UUIDs; rows contain no PII. Do NOT expose user identity on the page.)
  2. Server action `shareRecommendation(rec: {...}): Promise<ActionResult<{ url: string }>>`: auth → validate/truncate fields (F6 helper) → require `posterUrl` matches the TMDB pattern or null → insert → return `/r/${id}`. Rate limit 10/min.
  3. Route `app/r/[id]/page.tsx` — **server component, public** (add `/r` prefix to the proxy's non-protected paths — currently only `/` is protected, so no proxy change needed; verify). Fetch row via admin client. Render: poster, title/year, the "why you'll love it" reason, and a "Get your own recommendation → Sign up" CTA to `/signup`. `notFound()` for missing ids.
  4. `generateMetadata` on that route: OG title `"Watch ${title} (${year})"`, description = reason truncated 160 chars, `openGraph.images` → `/r/${id}/opengraph-image`.
  5. `app/r/[id]/opengraph-image.tsx` using `ImageResponse` from `next/og`: dark card, poster left (fetch allowed — OG image generation is server-side, CSP does not apply), title + reason right, small Filmmoo wordmark. Keep it simple; no custom fonts beyond system to avoid font-fetch flakiness.
  6. UI: share button (lucide `Share2`) on `MovieDetailCard` when `recommendationReason` present → calls action → `navigator.share` if available else copy-to-clipboard + existing toast pattern.
- ACCEPTANCE: share a rec → visiting `/r/<id>` logged-out shows the page; `curl -s https://<host>/r/<id> | grep og:image` returns the OG tag; the OG image endpoint returns a PNG; bogus id → 404.

### S3. Cold-start onboarding: rate 12 famous movies
- Goal: new user gets a usable taste profile in <60 seconds instead of an empty prompt (post-F5, the server profile is empty until they swipe).
- Implementation:
  1. Hardcode `lib/onboarding-titles.ts`: ~24 curated TMDB ids spanning genre/era (mainstream, high recognition — e.g. Shawshank, Dark Knight, Spirited Away, Pulp Fiction, Titanic, Get Out, Interstellar, Amélie, Mad Max Fury Road, The Godfather, Parasite, Barbie, etc. — pick 24, store as `{ tmdbId, title }[]`; ids must be verified against TMDB during implementation, not guessed).
  2. Server action `getOnboardingMovies(): ActionResult<MovieCandidate[]>`: hydrate those ids through the existing cache-first path (`getCachedMoviesByIds` + `hydrateMovie` + `upsertMoviesCache`), return random 12 of 24 excluding any already in the user's `swipe_states`.
  3. Route `app/onboarding/page.tsx` (client): poster grid; tap cycles none → loved → watched → disliked → none (badge overlay reusing swipe-label colors); "Skip" and "Done" buttons. Done → `saveSwipe` per rated movie (source `'swipe'`), then `router.push('/')`.
  4. Redirect logic: after signup success (`app/(auth)/signup/page.tsx` and Google OAuth callback `next`), send to `/onboarding` when the user has zero `swipe_states` rows (check via a tiny server action); `/onboarding` self-redirects to `/` when the user already has ratings. Add `/onboarding` to protected paths in `lib/supabase/proxy.ts` (`isProtectedPath`).
- ACCEPTANCE: fresh signup lands on onboarding; rating 5 movies then Done → `swipe_states` has 5 rows; immediate "Recommend" produces a rec referencing them; revisiting `/onboarding` redirects home.

### S4. Observability: Sentry + Vercel Analytics
- Implementation:
  1. `npm i @sentry/nextjs` → run its wizard-equivalent manual setup for App Router: `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts`, client init in `instrumentation-client.ts`, wrap `next.config.ts` with `withSentryConfig`. DSN via env; `tracesSampleRate: 0.1`; enable `beforeSend` scrubbing of query strings.
  2. Route all `logger.error/warn` calls to also `Sentry.captureMessage` in production (extend `lib/logger.ts`; keep the F18 redaction rules).
  3. `npm i @vercel/analytics @vercel/speed-insights` → `<Analytics/>` + `<SpeedInsights/>` in `app/layout.tsx`.
- ACCEPTANCE: build passes; a thrown test error appears in Sentry (verify with a temporary `/api/sentry-test` route, then delete it); analytics beacon visible in network tab on prod build.

### S5. Test foundation (currently zero tests)
- Implementation:
  1. `npm i -D vitest @vitest/coverage-v8` + `"test": "vitest run"` script. Unit tests: `lib/tmdb.ts` (`pickBestTmdbMatch` exact/fuzzy/reject cases, `buildPosterUrl`), `lib/sanitise.ts` (control chars, length cap, unicode preserved), `lib/validate-movie.ts` (F6 — caps, posterUrl whitelist, source enum), rate-limit result parsing.
  2. `npm i -D @playwright/test`. One smoke spec (chromium only) against `npm run start` with a seeded test user (create via Supabase admin in global-setup, delete in teardown): login → deck renders ≥1 card → button-swipe 3 cards → open watchlist panel → logout. Skip the Gemini rec in smoke (cost); assert the Recommend button enables.
  3. CI: `.github/workflows/ci.yml` — install, `tsc --noEmit`, `lint`, `vitest run`, `next build` (no env secrets needed if F10's build guard works; do NOT run Playwright in CI yet — needs env secrets; leave a commented job).
- ACCEPTANCE: `npm test` green locally; CI workflow passes on push.

---

## PHASE 2 — RETENTION & GROWTH FEATURES

### S6. Movie Night (two-user match mode) — the flagship differentiator
- Goal: two users swipe the same deck; first mutual "loved/watched-liked" wins → "You both want to watch X tonight."
- Data model (one migration):
  ```sql
  create table public.movie_nights (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,                    -- 6-char A-Z2-9 join code
    host_id uuid not null references auth.users on delete cascade,
    guest_id uuid references auth.users on delete set null,
    status text not null default 'waiting',       -- waiting|active|matched|expired
    matched_tmdb_id integer,
    created_at timestamptz not null default now(),
    constraint movie_nights_status_chk check (status in ('waiting','active','matched','expired'))
  );
  create table public.movie_night_cards (
    night_id uuid not null references public.movie_nights on delete cascade,
    tmdb_movie_id integer not null references public.movies_cache on delete cascade,
    rank integer not null,
    primary key (night_id, tmdb_movie_id)
  );
  create table public.movie_night_votes (
    night_id uuid not null references public.movie_nights on delete cascade,
    user_id uuid not null references auth.users on delete cascade,
    tmdb_movie_id integer not null,
    liked boolean not null,
    created_at timestamptz not null default now(),
    primary key (night_id, user_id, tmdb_movie_id)
  );
  -- RLS: participants only (host_id or guest_id = (select auth.uid())) for select on all three;
  -- votes insert: participant AND user_id = (select auth.uid());
  -- movie_nights insert: host_id = (select auth.uid()); update: participants (for join/status).
  ```
- Flow (server actions `actions/movie-night.ts`, all rate-limited):
  1. `createMovieNight()` → generate unique code, build 30 shared candidates: movies in `movies_cache` excluded for NEITHER user is impossible pre-join — so fill cards lazily at `joinMovieNight` time: exclude union of both users' `swipe_states`, order by popularity desc, insert 30 rows. Status → `active`.
  2. `voteMovieNight(nightId, tmdbId, liked)` → insert vote; then check partner's vote for same movie: both liked → RPC `resolve_movie_night` (security definer) sets `status='matched', matched_tmdb_id=...` atomically (advisory lock on night id, same pattern as `enqueue_user_movies`).
  3. Realtime: enable Supabase Realtime on `movie_nights` (`alter publication supabase_realtime add table public.movie_nights;`); client subscribes to the row (`postgres_changes`, filter `id=eq.<nightId>`) and flips to the match screen when status becomes `matched`.
  4. UI: `app/night/page.tsx` (protected): create (shows code big) / join (code input) → reuses `SwipeCard` with a binary left-no/right-yes gesture (map unwatched/disliked→no, watched/loved→yes) → match screen with poster + providers row (S1) + "Add to both watchlists" button.
  5. Expire nights older than 24h in the S10 cron (update status where created_at < now()-'24 hours' and status != 'matched').
- Free tier: 1 night/week per host (count `movie_nights` where host and created_at > now()-'7 days'); Pro unlimited (S14 gate).
- ACCEPTANCE: two browsers/accounts: create + join via code → both see same card order → both swipe yes on the same movie → both screens flip to match within ~2s; RLS verified (third account cannot select the night by id).

### S7. Trailers
- `hydrateMovie` (actions/queue.ts): change `append_to_response: 'credits'` → `'credits,videos'`; extract first `type==='Trailer' && site==='YouTube'` key → new `movies_cache.trailer_key text` column (migration). Surface on `MovieDetailCard`: "Watch trailer" button → modal/inline `<iframe src="https://www.youtube-nocookie.com/embed/${key}">` (lazy-mounted on click only). Extend `next.config.ts` CSP-free approach stands (no CSP header per audit F12); no image domain change needed.
- Backfill: S10's nightly cron re-hydrates rows where `trailer_key is null and cached_at < <deploy date>` at low volume (100/night).
- ACCEPTANCE: new queue movies carry trailer_key; button plays trailer; movies without trailers hide the button.

### S8. Deck filters (genre / decade / min rating)
- Migration: `create table public.user_preferences (user_id uuid primary key references auth.users on delete cascade, genres integer[] not null default '{}', year_from integer, year_to integer, min_vote numeric, updated_at timestamptz not null default now());` + RLS select/insert/update own (wrapped `(select auth.uid())`).
- Server actions `getPreferences`/`setPreferences` (validate: genres ⊆ TMDB genre-id list, years in [1900, current+1]).
- Apply in `getDiscoveryPlan()` (post-F4): merge `with_genres` (comma list), `primary_release_date.gte/lte`, `vote_average.gte` overrides into every tier. On preference change: mark the user's active queue rows `discarded_at = now()` (admin update) so the deck rebuilds filtered.
- UI: filter sheet from `AppHeader` (funnel icon): genre chips (hardcode the 19 TMDB movie genres id+name), decade range select, min-rating slider. Free tier: genre only; decade+rating Pro-gated (S14).
- ACCEPTANCE: set "Horror only" → discard+refill → next 20 cards all include Horror in genre string; clearing filters restores mixed deck.

### S9. Weekly digest email (re-engagement) — Prereq: S10 (cron infra), D1, D5
- `npm i resend`. `lib/email.ts` with a single `sendDigest(to, payload)` using a React Email-less plain HTML template (inline styles, poster grid of 3 picks + CTA link).
- Picks: for each opted-in user, top 3 unconsumed queue movies by rank (no Gemini call — zero marginal AI cost).
- Migration: `alter table public.profiles add column if not exists digest_opt_in boolean not null default false;` (opt-IN at launch — safer legally). Toggle in `ProfilePanel` via `updateProfileName`-style action. Unsubscribe: signed one-click link `/api/unsubscribe?token=` (HMAC of user id with `CRON_SECRET`) setting the flag false — required header `List-Unsubscribe` in the email.
- Cron route `app/api/cron/weekly-digest/route.ts`: verify `Authorization: Bearer ${CRON_SECRET}`; batch 50 users/run. Schedule Monday 16:00 UTC.
- ACCEPTANCE: test user with opt-in receives email (Resend dashboard); unsubscribe link flips the flag; route returns 401 without the bearer.

---

## PHASE 3 — ARCHITECTURE FOR SCALE

### S10. Shared candidate pool + nightly cron (kills per-user TMDB fan-out)
- Goal: TMDB is called by a nightly job, not by user requests. Queue refill becomes a pure-DB operation (fast, cheap, no 429 risk). Supersedes the remaining runtime TMDB discovery from F8 (hydration stays for onboarding/one-offs).
- Implementation:
  1. Migration: `alter table public.movies_cache add column if not exists pool_rank integer;` + partial index `on movies_cache (source_tier, pool_rank) where pool_rank is not null`. `pool_rank` = curated ordering within tier.
  2. Cron route `app/api/cron/refresh-pool/route.ts` (bearer-gated like S9): for each tier in the F4-fixed discovery plan, walk pages until ~800 total pool movies collected; hydrate uncached ids (concurrency 8, reuse F8 helper); upsert; assign `pool_rank` by (tier priority, popularity). Also: S7 trailer backfill batch + S6 night expiry + delete `rate_limits` stale rows if F16 chose the non-pg_cron path.
  3. Schedule via `vercel.ts` (install `@vercel/config`) — `crons: [{ path: '/api/cron/refresh-pool', schedule: '0 9 * * *' }, { path: '/api/cron/weekly-digest', schedule: '0 16 * * 1' }]`. If `vercel.ts`/`@vercel/config` is unavailable in the project's Vercel setup, fall back to `vercel.json` `{"crons":[...]}` — one mechanism only.
  4. Rewrite `fillQueueForUser`: single SQL via new RPC `fill_queue_from_pool(p_user_id, p_count)` (security definer, service_role-only, advisory lock; INSERT INTO user_movie_queue SELECT from movies_cache pool rows WHERE tmdb_movie_id NOT IN (user's swipe_states ∪ active queue ∪ watchlists), honoring S8 preference filters passed as args, ORDER BY tier priority + pool_rank, LIMIT p_count, ranks continuing from max). Runtime TMDB calls in the queue path drop to zero; keep the old discovery function as fallback ONLY when the pool yields < requested count (log `POOL_EXHAUSTED`).
- ACCEPTANCE: manual cron invocation fills pool (≥600 rows with pool_rank); new user's first deck load completes < 1.5s with zero TMDB requests (verify via logging); `POOL_EXHAUSTED` absent in normal operation.

### S11. Embedding-based retrieval + Gemini re-rank (cheaper, better recs) — Prereq: S10, S12
- Goal: candidate selection by taste vector; Gemini only re-ranks 30 candidates and writes the reason → smaller prompts, less hallucination (recommends only real, in-catalog movies), enables "because you loved X" rows later.
- Implementation:
  1. Migration: `create extension if not exists vector;` + `alter table public.movies_cache add column if not exists embedding vector(768);` + HNSW index `using hnsw (embedding vector_cosine_ops)`.
  2. `lib/embeddings.ts`: `embedMovie(movie)` → `@google/genai` `ai.models.embedContent({ model: 'gemini-embedding-001', contents: <"${title} (${year}) — ${genre}. ${synopsis}">, config: { outputDimensionality: 768 } })`. (Verify exact SDK call shape against the installed `@google/genai` version's docs before writing.) Cron (S10) embeds new/null-embedding pool rows.
  3. RPC `match_candidates(p_user_id, p_query vector(768), p_count int)`: cosine top-N from pool excluding user's seen/queued/watchlisted.
  4. In `getMovieRecommendation` (post-F5): compute user vector server-side = normalized weighted mean of embeddings of state movies (loved 1.0, watched 0.4, disliked −0.7; skip unwatched), fetch top 30 candidates, then Gemini prompt becomes: taste summary lists (as today) + "Choose the best fit FROM THIS CANDIDATE LIST ONLY" + candidate list with ids + same JSON schema plus `tmdbId` required. Validate returned id ∈ candidate set (reject + retry once, else fall back to top cosine candidate with a templated reason). Poster/tmdbId now come from cache — delete the TMDB search-match step for this path.
  5. Keep the old free-form path behind `RECS_ENGINE=freeform` env flag for A/B.
- ACCEPTANCE: rec returns a movie present in `movies_cache` with instant poster; token usage per rec drops (log Gemini usage before/after via S12 ledger); disliked-genre movies stop appearing (manual probe: dislike 5 horror → next 10 recs contain no horror).

### S12. Recommendation ledger (prereq for quotas, analytics, and S11 A/B)
- Migration:
  ```sql
  create table public.recommendations_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users on delete cascade,
    tmdb_movie_id integer,
    movie_title text,
    reason text,
    engine text not null default 'freeform',
    prompt_tokens integer, output_tokens integer,
    created_at timestamptz not null default now()
  );
  -- RLS: select own; inserts via service role only (no insert policy).
  create index on public.recommendations_log (user_id, created_at desc);
  ```
- Write one row per successful `getMovieRecommendation` (admin client; capture `response.usageMetadata` token counts from the Gemini SDK response if present).
- ACCEPTANCE: each rec inserts a row with token counts; user can't insert/see others' rows via REST.

---

## PHASE 4 — MONETIZATION

### S13. Free-tier quota on recommendations — Prereq: S12; D3
- In `getMovieRecommendation`, after auth: count today's `recommendations_log` rows (UTC day) for user; if ≥ quota (D3 default 3) and user not Pro (S14 `isPro()` — until S14 lands, treat everyone as free) → return `{ ok:false, code:'quota_exceeded', message:'Daily limit reached — upgrade for unlimited recommendations.' }` (extend the F2 code union).
- UI: on `quota_exceeded`, show upgrade modal (new `components/upgrade-modal.tsx`): quota explanation, Pro feature list, CTA → S14 checkout (or waitlist mailto until S14 ships).
- ACCEPTANCE: 4th rec of the day returns quota_exceeded for a free user; modal renders; counter resets next UTC day.

### S14. Stripe subscriptions (Pro) — Prereqs: S13; D1, D2, D4 gates go-live
- Implementation:
  1. `npm i stripe`. Migration:
     ```sql
     create table public.subscriptions (
       user_id uuid primary key references auth.users on delete cascade,
       stripe_customer_id text not null,
       stripe_subscription_id text,
       status text not null default 'inactive',   -- active|trialing|past_due|canceled|inactive
       current_period_end timestamptz,
       updated_at timestamptz not null default now()
     );
     -- RLS: select own; all writes via service role (no insert/update policies).
     ```
  2. `lib/billing.ts`: `isPro(userId): Promise<boolean>` — admin read: status in ('active','trialing') AND current_period_end > now(). Cache per-request only.
  3. Server action `createCheckoutSession(plan: 'monthly'|'yearly')`: find-or-create Stripe customer (store mapping immediately), `stripe.checkout.sessions.create` mode `subscription`, price from env, `success_url: <origin>/?upgraded=1`, `cancel_url: <origin>/`, `client_reference_id: user.id`, `customer_update.address: 'auto'`, `automatic_tax.enabled: true`. Return `{ url }`; client `window.location.assign`.
  4. Webhook `app/api/stripe/webhook/route.ts`: `stripe.webhooks.constructEvent(await req.text(), sig, STRIPE_WEBHOOK_SECRET)`. Handle `checkout.session.completed`, `customer.subscription.updated|deleted` → upsert `subscriptions` via admin client (map by customer id; on completed, also by `client_reference_id`). Return 200 fast; log unhandled types. **Never trust client-side success redirect for entitlement — webhook is the source of truth.**
  5. Server action `createPortalSession()` → `stripe.billingPortal.sessions.create` → manage/cancel; button in `ProfilePanel` shown when subscribed.
  6. Gates: S13 quota bypass, S6 unlimited nights, S8 full filters — all check `isPro()` server-side (client hints only cosmetic).
  7. Feature flag `BILLING_ENABLED` env (default false): checkout action returns `{ok:false, code:'validation', message:'Billing not yet available'}` when off (D4 — TMDB commercial license must be confirmed before flipping on).
- ACCEPTANCE (Stripe test mode): checkout with `4242…` card → webhook fires (use `stripe listen --forward-to localhost:3000/api/stripe/webhook` locally) → `subscriptions.status='active'` → 4th rec succeeds → portal cancel → status flips → quota re-enforced. Webhook with bad signature → 400.

### S15. Affiliate groundwork on watch providers — Prereq: S1
- Phase-1 scope only (no partner contracts yet): append UTM params to the S1 `link` URL (`utm_source=filmmoo&utm_medium=app`); structure the provider row component so each provider chip can later take a per-provider deep link (JustWatch partner / Amazon Associates when approved — leave `// AFFILIATE:` marker + a `lib/affiliate.ts` mapping stub returning the plain link today).
- ACCEPTANCE: provider links carry UTM; `lib/affiliate.ts` unit test passes.

### S16. "Cinema DNA" taste report (Pro perk, shareable) — Prereqs: S12, S14; nice-to-have, do last
- Server action `getCinemaDna()`: Pro-gated; input = server-side taste profile (F5 loader); Gemini (`gemini-2.5-flash`, JSON schema) returns `{ archetype: string, headline: string, traits: string[3], guilty_pleasure: string, blind_spot: string }`; cache result in a `cinema_dna` jsonb column on `profiles` with `dna_generated_at` (regenerate at most weekly). Rate limit 2/day.
- UI: card in ProfilePanel + share via the S2 mechanism (new `kind` column on `shared_recommendations`: `'rec' | 'dna'`, OG image variant).
- ACCEPTANCE: Pro user generates DNA; free user gets upgrade prompt; regeneration within a week serves cache.

---

## LEGAL / CONTENT (do with Phase 1)

- L1. Footer component (all pages): TMDB attribution + logo, JustWatch attribution (with S1), links to `/privacy` and `/terms`.
- L2. Static `app/privacy/page.tsx` + `app/terms/page.tsx` (public routes): plain-language policy — data stored (email, name, swipe history, watchlist), processors (Supabase, Vercel, Google Gemini, TMDB, Sentry when S4 lands, Stripe when S14 lands), deletion rights, contact email. Mark clearly as template requiring owner review — not legal advice.
- L3. Account deletion: "Delete account" (danger zone) in ProfilePanel → confirm dialog typing DELETE → server action using admin client `auth.admin.deleteUser(user.id)` (FK cascades wipe all rows) → sign out → redirect `/signup`. Rate limit 2/hour.
- ACCEPTANCE: deletion removes auth user + all owned rows (verify counts); footer/policy pages render logged-out.

## STALE-DOCS CLEANUP (last commit of the effort)

- Update `README.md` (features/stack now inaccurate — no more "AI generates the feed"), rewrite `docs/queue-cache-spec.md` queue section to reflect S10 pool architecture, and either update or delete `.agents/rules/prd.md` (names "SceneIt", describes the pre-auth architecture; per D1).

## EXECUTION ORDER & SIZING

| Order | Items | Size |
|---|---|---|
| 1 | S4, S5, L1, L2 | S — half-day each |
| 2 | S1, S3 | S/M |
| 3 | S2, L3 | M |
| 4 | S10 (cron infra first — S9 depends on it) | M/L |
| 5 | S7, S8, S9 | S/M each |
| 6 | S12, S13 | S |
| 7 | S6 | L — do in its own branch/PR |
| 8 | S14, S15 | M/L |
| 9 | S11 | L — own branch, A/B against freeform |
| 10 | S16, stale-docs cleanup | S |

Full gate after each phase: `npx tsc --noEmit && npm run lint && npm test && npm run build`, plus each item's ACCEPTANCE. Re-run Supabase advisors after every migration batch.
