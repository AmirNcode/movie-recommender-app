# Filmmoo Production Audit — Fix Specification

Machine-oriented fix list for an implementing agent. Findings verified against the live system on 2026-07-09. Apply in the order given in EXECUTION ORDER (bottom). Every fix has a VERIFY step — run it.

## CONTEXT (read first)

- Stack: Next.js 16.2.10 (App Router, Turbopack, `proxy.ts` middleware convention), React 19.2, TypeScript 5.9 (strict), Tailwind 4, `@supabase/ssr` 0.9 (cookie-based auth), `@supabase/supabase-js` 2.99, `@google/genai` 1.42 (model `gemini-2.5-flash`), TMDB API v3 (api_key query param auth).
- Deploy target: **Vercel** (serverless/Fluid). Assume multiple concurrent instances; no reliable in-memory state.
- Stage: launching publicly soon. Security, abuse-resistance, and third-party API cost control are launch blockers.
- Supabase project ref: `bhtkujcfvknxphatejbu` (name "Filmmoo", ACTIVE_HEALTHY). Live data exists: 5 users, 342 swipe_events, 601 movies_cache, 265 queue rows. **Migrations must be non-destructive to existing data.**
- The live DB already has ALL local migrations applied, including three that are NOT tracked in git (see F1). Schema on disk (all 8 files in `supabase/migrations/`) == live schema, except live also contains: function `rls_auto_enable()` + its event trigger, and a duplicate-applied `drop_orphaned_record_swipe_event` (harmless, `drop if exists`).
- Auth: Supabase email/password + Google OAuth. Server actions in `actions/*.ts` (`'use server'`). Per-user RLS on all user tables. Service-role client (`lib/supabase/admin.ts`) used for queue/cache/rate-limit paths; returns `null` when env missing.
- Env vars (names only; values live in `.env` locally and Vercel env in prod — NEVER print or commit values): `GEMINI_API_KEY`, `TMDB_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (code also accepts `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `SUPABASE_SECRET_KEY`, `APP_URL` (unused — removed in F19).
- Migration workflow: add new SQL files as `supabase/migrations/<UTC timestamp>_<name>.sql`. They must be BOTH committed to git AND applied to the live project (`supabase db push`, or Supabase MCP `apply_migration` if available). Use `create or replace` / `if exists` guards; live DB is the source of truth for current state.
- Verification commands (all currently pass; keep them passing): `npx tsc --noEmit`, `npm run build`, `npm run lint`.
- Baseline confirmed clean: no secrets in git history; no XSS sinks (`dangerouslySetInnerHTML` absent; poster URLs gated by `isTrustedPosterUrl` requiring `https://image.tmdb.org/` prefix); OAuth callback `next` param sanitized; open-redirect checks present.

---

## P0 — SHIP BLOCKERS

### F1. Three applied migrations are untracked — repo cannot reproduce the production schema
- Files: `.gitignore:12`, `supabase/migrations/20260429035511_fix_record_swipe_event_idempotency.sql`, `supabase/migrations/20260429035543_enqueue_user_movies_atomic.sql`, `supabase/migrations/20260429041405_drop_orphaned_record_swipe_event.sql`
- Problem: `.gitignore` contains a bare `supabase/` line, so every migration created after 2026-03-27 is ignored (`git status --ignored` shows all three as `!!`). The GitHub repo's newest migration is `20260327000004`, whose `record_swipe_event` has an early-return bug (never updates `swipe_states.latest_action` on re-rate, and skips marking `user_movie_queue.consumed_at` → a queue card that was already rated via the recommendation flow gets re-delivered forever). It also lacks `enqueue_user_movies` entirely — `actions/queue.ts:238` calls it, so a fresh environment built from the repo has a dead queue (every refill fails with "function not found").
- Fix:
  1. In `.gitignore`, replace the `supabase/` line with `supabase/.temp/` (a `supabase/.gitignore` already exists for CLI artifacts — verify it covers `.temp/`; if it does, just delete the `supabase/` line from the root `.gitignore`).
  2. `git add supabase/migrations/*.sql supabase/config.toml supabase/.gitignore` and commit. All three untracked files must end up tracked.
- Verify: `git ls-files supabase/migrations | wc -l` returns 8. `git status --ignored --short supabase/` shows no `!!` entries for `.sql` files.

### F2. Server actions throw `Error` — Next.js masks the messages in production, breaking all error UX and the rate-limit stop condition
- Files: `actions/movies.ts` (59, 77, 94, 100), `actions/queue.ts` (26, 55), `actions/library.ts` (33-34, 43, 55-56), `actions/watchlist.ts` (39, 42, 47, 85, 97, 112, 124, 137, 146), consumed in `app/page.tsx` (176, 196-201, 268-270, 319-320, 366-370, 380-382, 391-415)
- Problem: in production builds, Next.js replaces the message of any `Error` thrown from a server action with a generic "An error occurred in the Server Components render…" digest string. Consequences: (a) users never see "Rate limit exceeded. Please try again in N seconds", 'Unauthorized', or any real message; (b) `app/page.tsx:198` — `message.includes('Rate limit exceeded')` — never matches, so `exhaustedDeckRef` is not set and the prefetch effect keeps re-firing a rate-limited `getQueuedMovies` every 15s cooldown window indefinitely.
- Fix: convert every data server action to return a discriminated union instead of throwing (this codebase already uses that pattern in `actions/auth.ts` and the profile actions in `actions/library.ts` — extend it everywhere).
  1. Add to `types/` (new file `types/actions.ts`):
     ```ts
     export type ActionFailure = {
       ok: false;
       code: 'unauthorized' | 'rate_limited' | 'validation' | 'save_failed' | 'load_failed' | 'no_taste_profile';
       message: string;      // safe, user-displayable
       retryAfter?: number;  // seconds, only for rate_limited
     };
     export type ActionResult<T> = { ok: true; data: T } | ActionFailure;
     ```
  2. Migrate signatures (no thrown errors escape; wrap bodies in try/catch → `{ ok: false, code: 'load_failed'|'save_failed', message: <generic user-safe text> }`):
     - `saveSwipe` → `Promise<ActionResult<null>>`
     - `getMovieRecommendation` → `Promise<ActionResult<Recommendation | null>>` (null = model produced nothing usable)
     - `getQueuedMovies`, `refillQueuedMovies` → `Promise<ActionResult<MovieCandidate[]>>`
     - `getSwipeHistory` → `Promise<ActionResult<HistoryItem[]>>`
     - `getCurrentUserProfile` → `Promise<ActionResult<ProfileDetails>>`
     - `setWatchlistItem` → `Promise<ActionResult<{ inWatchlist: boolean }>>`
     - `isMovieInWatchlist` → `Promise<ActionResult<boolean>>`
     - `getWatchlistItems` → `Promise<ActionResult<WatchlistItem[]>>`
     - Rate-limit denials return `{ ok: false, code: 'rate_limited', message: ..., retryAfter }`. Auth failures return `code: 'unauthorized'`.
  3. Update all call sites in `app/page.tsx` accordingly. Replace the string sniff at line 198 with `result.ok === false && result.code === 'rate_limited'` → set `exhaustedDeckRef.current = true`. On `code === 'unauthorized'`, `router.push('/login')` (import `useRouter` from `next/navigation`). Show `result.message` in the existing `showError` banner; use `retryAfter` in the message when present.
  4. Leave `actions/auth.ts` and the three profile actions (`updateProfileName`, `updateEmail`, `updatePassword`) as-is (already union-returning), except align their shapes if trivial.
- Verify: `npx tsc --noEmit` passes; `grep -rn "throw new Error" actions/` returns nothing; `npm run build` passes. Manual: with dev server, exhaust `getQueuedMovies` limit (>30 calls/min) and confirm the banner shows the retryAfter message and prefetching stops.

### F3. "Save name" is broken for every user — `profiles` has no INSERT RLS policy (empirically confirmed on live DB)
- Files: `supabase/migrations/20260316000001_auth_and_profiles.sql` (policies), `actions/library.ts:81` (`.upsert({ id, name })`)
- Problem: Postgres evaluates INSERT policies' WITH CHECK on `INSERT ... ON CONFLICT DO UPDATE` even when the row exists and only the update path runs. `profiles` has only SELECT and UPDATE policies. Confirmed live: an upsert as role `authenticated` on an EXISTING profile row fails with `new row violates row-level security policy for table "profiles"`. Additionally the live DB has 5 auth users but only 4 profile rows (one predates the trigger), so an update-only rewrite would still break for that user.
- Fix: new migration `supabase/migrations/<ts>_profiles_insert_policy_and_backfill.sql`:
  ```sql
  drop policy if exists "Users can insert own profile" on public.profiles;
  create policy "Users can insert own profile"
    on public.profiles for insert
    with check (auth.uid() = id);

  -- Backfill users created before/despite the signup trigger
  insert into public.profiles (id, name)
  select u.id, u.raw_user_meta_data->>'name'
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
  on conflict (id) do nothing;
  ```
  Apply to live project. No code change needed (`upsert` becomes valid).
- Verify: on live DB, `select (select count(*) from auth.users) = (select count(*) from public.profiles);` returns true. Re-run the RLS simulation: as `authenticated` with `request.jwt.claims.sub = <existing profile id>`, the upsert succeeds (wrap in a transaction and roll back).

---

## P1 — HIGH (fix before launch)

### F4. TMDB discover uses invalid `vote_count` parameter — filter silently ignored, niche tier serves 1-vote junk
- File: `actions/queue.ts:91, 106, 119` (`getDiscoveryPlan`)
- Problem: TMDB `/discover/movie` has no `vote_count` filter; the correct parameter is `vote_count.gte` (verified against current TMDB API reference). All three tiers send `vote_count: 'N'`, which TMDB ignores. The `niche` tier sorts by `vote_average.desc` with no vote floor → returns obscure titles with a single 10/10 vote.
- Fix: rename the key in all three tier configs to `'vote_count.gte'` with the same values (`'1000'`, `'300'`, `'50'`).
- Verify: `grep -n "vote_count" actions/queue.ts` shows only `'vote_count.gte'`. Manual: call the discover URL for the niche tier with and without the param; result sets must differ.

### F5. Recommendations ignore persisted history — after a page reload the Gemini prompt is empty
- Files: `actions/movies.ts:84-214` (`getMovieRecommendation`), `app/page.tsx:294-325, 461`
- Problem: the taste profile sent to Gemini is the client-supplied `swipedMovies` array, which is session-local React state. `canRecommend` (page.tsx:461) enables the button when `historyItems.length > 0`, but after reload `swipedMovies` is `[]`, so the model gets four "None yet" lists and returns a generic pick. The client-supplied array is also an abuse vector (arbitrary content and unbounded size directly interpolated into the paid Gemini prompt).
- Fix: build the taste profile server-side; stop trusting the client array.
  1. Change `getMovieRecommendation()` to take NO arguments. Inside, after auth + rate limit, load with the user-scoped client (RLS applies):
     ```ts
     const { data: states } = await supabase
       .from('swipe_states')
       .select('tmdb_movie_id, latest_action, updated_at')
       .eq('user_id', user.id)
       .order('updated_at', { ascending: false })
       .limit(300);
     ```
     Hydrate titles/metadata for those ids from `movies_cache` (`in('tmdb_movie_id', ids)`; admin client, or grant is already SELECT-for-authenticated so user client works). For ids missing from cache, fall back to the most recent `swipe_events` row for that movie (`movie_title`, `movie_year`, `movie_director`, `movie_genre`), which covers recommendation-sourced swipes.
  2. Partition by `latest_action` into loved/watched/disliked/unwatched, cap each list at 60 most-recent, and reuse the existing `movieLabel`-style formatting (keep `sanitiseForPrompt` on every DB-sourced string — synopsis/titles originated from client or TMDB). Exclusion list = all state ids' titles (most recent 60) as today.
  3. If loved+watched+disliked is empty → return `{ ok: false, code: 'no_taste_profile', message: 'Rate at least one movie first.' }`.
  4. Client (`app/page.tsx`): `requestRecommendation` no longer builds/sends a payload; delete `payloadOverride` plumbing; keep the local pre-check but base it on `swipedMovies`/`historyItems` merely as a UX shortcut.
- Verify: `tsc` + build pass. Manual: rate 3+ movies, reload the page, hit Recommend → recommendation references your rated movies in `reason`. Second run within a minute still works (rate limit is 10/min).

### F6. Client-controlled writes are unvalidated and unbounded (DB bloat / cost abuse)
- Files: `actions/movies.ts:47-79` (`saveSwipe`), `actions/watchlist.ts:28-100` (`setWatchlistItem`); DB tables `swipe_events`, `watchlists` (direct PostgREST INSERT also allowed by RLS)
- Problem: an authenticated user can persist arbitrary strings of any length (title/synopsis/reason/posterUrl/source), via the actions or directly via the REST API with the publishable key. No length caps anywhere; `poster_url` accepts any string (only render-time is gated); `source` is an unchecked free-text column.
- Fix (both layers):
  1. Server validation helper (new `lib/validate-movie.ts`), applied at the top of `saveSwipe` and `setWatchlistItem` — returns `{ ok:false, code:'validation' }` on breach: `tmdbId` positive integer ≤ 2_000_000_000; `title` ≤ 300 chars; `director`, `genre` ≤ 300; `synopsis`, `recommendationReason` ≤ 2000; `year` integer in [1870, current year + 2] or null; `posterUrl` must match `^https://image\.tmdb\.org/t/p/[\w/.\-]+$` or be dropped (set null, don't reject); `source` must be one of `'swipe' | 'recommendation' | 'watchlist' | 'manual'` else `'manual'`. Truncate rather than reject for length overruns on text fields.
  2. Defense-in-depth migration `supabase/migrations/<ts>_text_length_constraints.sql` (NOT VALID + validate, to avoid failing on any oversized legacy rows):
     ```sql
     alter table public.swipe_events
       add constraint swipe_events_text_caps check (
         coalesce(length(movie_title),0) <= 300 and coalesce(length(movie_director),0) <= 300 and
         coalesce(length(movie_genre),0) <= 300 and coalesce(length(poster_url),0) <= 600 and
         coalesce(length(movie_synopsis),0) <= 2000 and coalesce(length(recommendation_reason),0) <= 2000 and
         coalesce(length(source),0) <= 40
       ) not valid;
     alter table public.swipe_events validate constraint swipe_events_text_caps;
     alter table public.watchlists
       add constraint watchlists_text_caps check (
         coalesce(length(movie_title),0) <= 300 and coalesce(length(movie_director),0) <= 300 and
         coalesce(length(movie_genre),0) <= 300 and coalesce(length(poster_url),0) <= 600 and
         coalesce(length(movie_synopsis),0) <= 2000 and coalesce(length(recommendation_reason),0) <= 2000 and
         coalesce(length(source),0) <= 40
       ) not valid;
     alter table public.watchlists validate constraint watchlists_text_caps;
     ```
     If `validate constraint` fails, first truncate offending rows with an UPDATE, then re-validate.
- Verify: unit-ish check — call `saveSwipe` with a 10k-char synopsis: row stored truncated to 2000. Direct REST insert with 10k-char synopsis is rejected by the CHECK constraint.

### F7. `saveSwipe` and `setWatchlistItem` have no rate limit; unknown actions fail open silently
- Files: `lib/rate-limit.ts:28-54`, `actions/movies.ts:47`, `actions/watchlist.ts:28`
- Problem: only 3 actions are configured in `ACTION_LIMITS`; `checkRateLimit` allows any unconfigured action name. Authenticated users can hammer swipe/watchlist writes without bound (each is also a DB round-trip on the service-role path).
- Fix:
  1. Add to `ACTION_LIMITS`: `saveSwipe: { maxRequests: 120, windowMs: 60_000 }` (fast swiping is legitimate; 2/sec sustained is not), `setWatchlistItem: { maxRequests: 30, windowMs: 60_000 }`.
  2. Call `checkRateLimit(ip, 'saveSwipe', user.id)` in `saveSwipe` and `checkRateLimit(ip, 'setWatchlistItem', user.id)` in `setWatchlistItem` after auth; on deny return `{ ok:false, code:'rate_limited', retryAfter }` (post-F2 shapes).
  3. In `checkRateLimit`, replace the silent allow for unknown actions with `logger.error('RATE_LIMIT_UNCONFIGURED_ACTION', { action })` + allow (fail-open but observable), so a typo can't silently disable limiting.
- Verify: 121 rapid `saveSwipe` calls in a minute → the 121st returns `rate_limited`. `grep -n "checkRateLimit" actions/` shows all five write/read actions covered.

### F8. Queue refill fan-out: up to ~200 TMDB requests inside one user-facing request
- Files: `actions/queue.ts:128-159` (`discoverCandidateIds`), `205-246` (`fillQueueForUser`), `248-274` (`getQueuedMovies`)
- Problem: first load for a new user: `fillQueueForUser(userId, 60)` → discover walks up to 23 pages sequentially (23 HTTP calls) collecting `60 * 3 = 180` ids, then `Promise.all` hydrates up to 180 movies in parallel (180 HTTP calls). TMDB throttles (~50 rps) → 429s silently drop movies (`hydrateMovie` returns null on !ok); user waits many seconds; Vercel bills the whole time; and `getQueuedMovies` runs the refill inline even when it already has cards to return.
- Fix (keep it simple, no new deps):
  1. In `fillQueueForUser`, change discovery target from `minimumToAdd * 3` to `Math.ceil(minimumToAdd * 1.5)`.
  2. Replace the unbounded `Promise.all(missing.map(hydrateMovie))` with a concurrency-limited loop (inline helper, chunk size 8): process `missing` in slices of 8 with `Promise.all` per slice.
  3. In `getQueuedMovies`: if `queued.length > 0`, return the cards immediately and DO NOT block on refill — run the below-watermark refill after the response via `waitUntil`:
     ```ts
     import { after } from 'next/server';
     // inside getQueuedMovies, replacing the blocking call:
     if (queueState.activeCount < queueConfig.lowWatermark) {
       after(() => fillQueueForUser(userId, queueConfig.targetSize - queueState.activeCount));
     }
     ```
     Keep the existing synchronous fill only for the empty-queue path (first load), but with `minimumToAdd = queueConfig.deliverBatchSize` (20) instead of 60 so the first response is fast; `after()` a top-up to `targetSize` in the same request.
  4. `refillQueuedMovies` (manual "Reload movies" button): synchronous fill of `deliverBatchSize`, then `after()` top-up, same pattern.
- Verify: build passes (`next/server`'s `after` is available in Next 16). Manual: brand-new user's first `getQueuedMovies` returns 20 cards in a few seconds; `user_movie_queue` count grows toward 60 shortly after without further client calls; no TMDB 429 storm in logs.

### F9. Gemini action fails open when the rate-limit RPC errors — unmetered paid API
- File: `lib/rate-limit.ts:59-79`
- Problem: missing env or RPC error → `allowed: true`. For cheap DB reads that's a fine availability tradeoff; for `getMovieRecommendation` (paid Gemini call) it means a DB hiccup disables the only cost control.
- Fix: add per-action `failMode`: extend `RateLimitConfig` with `failMode?: 'open' | 'closed'` (default `'open'`); set `failMode: 'closed'` for `getMovieRecommendation`. In the two failure branches (missing admin client, RPC error), return `{ allowed: config.failMode !== 'closed' }` and log `RATE_LIMIT_BACKEND_DOWN` with the action name.
- Verify: temporarily point `SUPABASE_SECRET_KEY` to garbage in `.env.local`, call `getMovieRecommendation` → `rate_limited`-style failure (closed), while `getQueuedMovies` still works (open). Restore env.

### F10. Silent boot with missing env — app "works" but every feature is dead
- Files: `lib/supabase/admin.ts:8-10` (returns null), `actions/queue.ts:207-208` (returns silently), `actions/movies.ts:181` (TMDB skip), `lib/supabase/proxy.ts:25-27` (auth middleware no-ops without env)
- Problem: a misconfigured Vercel project deploys green, then: queue never fills (empty deck), posters missing, rate limiting bypassed, `/` unprotected. Nothing logs at startup.
- Fix: new `lib/env.ts`, imported by `actions/queue.ts`, `actions/movies.ts`, `lib/supabase/admin.ts`:
  ```ts
  const REQUIRED_SERVER_ENV = ['GEMINI_API_KEY', 'TMDB_API_KEY', 'SUPABASE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL'] as const;
  export function assertServerEnv(): void {
    if (process.env.NEXT_PHASE === 'phase-production-build') return; // don't fail builds without secrets
    const missing = REQUIRED_SERVER_ENV.filter((k) => !process.env[k]);
    const hasPublishable = ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY'].some((k) => process.env[k]);
    if (!hasPublishable) missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
  ```
  Call `assertServerEnv()` at the top of each server action module (module scope, so it throws on first import at runtime, not during build). Keep `createAdminClient`'s null-return as a type-level fallback but it should now be unreachable.
- Verify: delete `TMDB_API_KEY` from `.env.local`, `npm run dev`, load `/` → server error names the missing key (instead of an empty deck). Restore. `npm run build` still passes WITHOUT env vars present (build guard works).

---

## P2 — MEDIUM (production quality; advisor-confirmed)

### F11. Supabase advisor batch (one migration `<ts>_advisor_hardening.sql`)
Live security advisors flagged (a)-(c); performance advisors flagged (d)-(e). Single migration:
```sql
-- (a) Pin search_path on SECURITY DEFINER rate limiter (advisor: function_search_path_mutable)
alter function public.check_rate_limit(text, int, interval) set search_path = '';
-- its body references public.rate_limits with schema qualification already; json/interval builtins resolve via pg_catalog.

-- (b) Trigger/event functions callable via REST by anon+authenticated (advisors 0028/0029)
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- (c) Codify the live-only rls_auto_enable event trigger so repo == prod (currently drift).
--     Recreate defensively; skip if this exact definition already matches live.
create or replace function public.rls_auto_enable() returns event_trigger
language plpgsql security definer set search_path = '' as $$
declare cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then null;
      end;
    end if;
  end loop;
end $$;
do $$ begin
  if not exists (select 1 from pg_event_trigger where evtname = 'rls_auto_enable_trigger') then
    create event trigger rls_auto_enable_trigger on ddl_command_end execute function public.rls_auto_enable();
  end if;
end $$;

-- (d) auth_rls_initplan: wrap auth.uid() in scalar subselect on ALL 16 user policies (per-row re-eval).
-- Recreate each policy; identical predicate wrapped as (select auth.uid()). Tables/policies:
--   profiles: "Users can read own profile"(select), "Users can update own profile"(update), "Users can insert own profile"(insert, from F3)
--   swipe_events: read/insert/update/delete own
--   swipe_states: read/insert/update/delete own
--   watchlists: read/insert own/update own/delete own
--   user_movie_queue: "Users can read own queue", "Users can update own queue"
-- Pattern:
--   drop policy if exists "<name>" on public.<table>;
--   create policy "<name>" on public.<table> for <cmd> [to authenticated]
--     using ((select auth.uid()) = user_id) [with check ((select auth.uid()) = user_id)];
-- (profiles uses column id instead of user_id; keep each policy's original USING/WITH CHECK split and role targeting.)

-- (e) unindexed FK (join + ON DELETE CASCADE from movies_cache)
create index if not exists user_movie_queue_tmdb_idx on public.user_movie_queue (tmdb_movie_id);
```
Note for (b): `handle_new_user` runs from the `on_auth_user_created` trigger with definer rights — revoking REST EXECUTE does not affect the trigger.
- Verify: re-run both advisor sets on the live project → the six security WARNs and the `auth_rls_initplan`/`unindexed_foreign_keys` items are gone. App still signs up a fresh user (trigger works) and all panels load (policies intact).

### F12. Security headers absent
- File: `next.config.ts`
- Fix: add
  ```ts
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  }
  ```
  (Full CSP intentionally deferred: Next inline runtime + Tailwind make a strict CSP its own project. Do not add a `Content-Security-Policy` header here.)
- Verify: `curl -sI localhost:3000 | grep -iE 'strict-transport|nosniff|referrer|frame'` after `npm run build && npm run start` shows all four.

### F13. Password policy weaker than intended for launch
- Files: `actions/library.ts:100` (min 6), `app/(auth)/signup/page.tsx:151` (`minLength={6}`), `components/profile-panel.tsx:84-85`
- Fix: raise to 8 in all three places (validation message text too). Note in PR description that Supabase dashboard must also be set to min 8 + leaked-password protection (see OPS).
- Verify: signup with 7-char password rejected client- and server-side.

### F14. Signup `name` unbounded → stored raw by DB trigger
- Files: `actions/auth.ts:41-49`, `app/(auth)/signup/page.tsx:126-131`, `actions/library.ts:70-85`
- Fix: in `signup`, `const name = String(formData.get('name') ?? '').trim().slice(0, 100) || undefined;` (replace the `as string` cast). Add `maxLength={100}` to the signup name input. In `updateProfileName`, cap `name` at 100 chars server-side too.
- Verify: signup with 500-char name → profile row's name is ≤100 chars.

### F15. `getClientIp` duplicated; coerce FormData safely
- Files: `actions/movies.ts:22-27`, `actions/queue.ts:12-17`, `actions/auth.ts:8-9, 31-33`
- Fix: extract one `getClientIp` into `lib/request-ip.ts` and import in both action modules (identical current behavior: prefer `x-vercel-forwarded-for`, first hop, fallback `127.0.0.1`). In `actions/auth.ts`, replace `formData.get('email') as string` casts with `String(formData.get('email') ?? '')` (a File in FormData would otherwise flow through with type lies).
- Verify: `grep -rn "x-vercel-forwarded-for" actions/ lib/` → single definition in `lib/request-ip.ts`. tsc passes.

### F16. `rate_limits` table grows forever (stale window rows never deleted)
- Files: `supabase/migrations/20260316000000_init_tables.sql` (table), `lib/rate-limit.ts`
- Problem: one row per `user:<id>:<action>` key persists indefinitely (21 rows now; grows with users × actions; IP-keyed rows possible for future anonymous actions).
- Fix: migration `<ts>_rate_limits_cleanup.sql`:
  ```sql
  create extension if not exists pg_cron;
  select cron.schedule('purge-stale-rate-limits', '17 3 * * *',
    $$delete from public.rate_limits where window_start < now() - interval '2 days'$$);
  ```
  If `pg_cron` is unavailable on the plan, instead add opportunistic cleanup to `check_rate_limit` (inside the function, before upsert): `delete from public.rate_limits where window_start < now_tz - interval '2 days' and random() < 0.01;` — pick ONE approach, prefer pg_cron.
- Verify: `select * from cron.job;` shows the job (or function body contains the delete).

### F17. Regenerate DB types; remove `as any` casts in rate limiter
- Files: `types/supabase.ts`, `lib/rate-limit.ts:68-85`
- Fix: regenerate types from the live project (`supabase gen types typescript --project-id bhtkujcfvknxphatejbu --schema public > types/supabase.ts`; via MCP `generate_typescript_types` if available). Then type the RPC call: `supabase.rpc('check_rate_limit', {...})` without `as any`, and parse the JSON result with an explicit local type `{ allowed: boolean; retryAfter?: number }` instead of the string-fallback `JSON.parse` branch (keep the branch only if the generated type says `Json`).
- Verify: `grep -n "as any" lib/ actions/` → none. tsc passes.

### F18. Production logger drops all string context — errors become uninvestigable
- File: `lib/logger.ts:30-43, 56-67`
- Fix: in production, pass through string values truncated to 200 chars AFTER redacting anything matching `/(key|token|secret|password|authorization)/i` in the KEY name (drop those entirely). Keep numbers as today. Never log objects (`JSON.stringify` of unknown values stays out).
- Verify: `logger.error('X', { error: 'boom', apiKey: 'zz', status: 500 })` in prod mode logs `{"level":"error","code":"X","error":"boom","status":500}` — no `apiKey`.

---

## P3 — LOW / CLEANUP

### F19. Dead code & leftovers (single commit)
- Delete `components/recommendation-view.tsx` (unused — page.tsx renders recommendations via `MovieDetailCard`; also contains a styling bug: "disliked" button uses green classes).
- Delete `hooks/use-mobile.ts` (unused).
- Remove `APP_URL` from `.env.example` (unused in code; AI Studio leftover). Do not touch local `.env`.
- `next.config.ts`: remove the `picsum.photos` remotePattern (no code references picsum); remove `output: 'standalone'` and the `webpack`/`DISABLE_HMR` block and the stale AI-Studio comments (Vercel ignores standalone; the webpack block only mattered in AI Studio; keep `turbopack` and `transpilePackages`).
- `.gitignore`: add `tsconfig.tsbuildinfo` and `git rm --cached tsconfig.tsbuildinfo` (build artifact currently tracked).
- `metadata.json`: AI-Studio applet manifest, harmless — delete unless AI Studio hosting is still desired.
- Verify: `npm run build` + `npm run lint` pass; `git ls-files | grep tsbuildinfo` empty.

### F20. Vendored postcss advisory in Next (GHSA-qx2v-qp2m-jg93, moderate)
- Problem: `next@16.2.10` vendors `postcss@8.4.31` (< 8.5.10). Root postcss is already 8.5.16. Build-time exposure only; negligible runtime risk.
- Fix: prefer bumping Next when a release clears `npm audit`. If audit-clean is required now, add to `package.json`: `"overrides": { "next": { "postcss": "^8.5.16" } }`, then `npm install` and fully re-verify `npm run build` + `npm run dev` HMR (overriding a framework-pinned dep can break; if anything misbehaves, drop the override and accept the advisory).
- Verify: `npm audit` reports 0 vulnerabilities (or documented acceptance).

### F21. Duplicate live migration entry (informational — no action)
- Live `supabase_migrations.schema_migrations` contains `20260429041348` AND `20260429041405`, both named `drop_orphaned_record_swipe_event` (applied twice; function drop is `if exists`, harmless). Repo keeps only `20260429041405`. Do not try to reconcile; noting so nobody "fixes" it into an outage.

---

## OPS CHECKLIST (dashboard/config actions — cannot be done in code; do at deploy time)

1. Vercel project env vars (Production + Preview): `GEMINI_API_KEY`, `TMDB_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `_DEFAULT_KEY` — code accepts both), `SUPABASE_SECRET_KEY`.
2. Supabase Auth → URL Configuration: set production Site URL and add `https://<prod-domain>/auth/callback` to Redirect URLs (Google OAuth breaks without this; config.toml only covers localhost).
3. Google Cloud OAuth client: add production origin + Supabase callback (`https://bhtkujcfvknxphatejbu.supabase.co/auth/v1/callback`) to authorized origins/redirects.
4. Supabase Auth settings: enable leaked-password protection (open advisor WARN), min password length 8 (match F13), enable email confirmations, enable CAPTCHA (Turnstile) on sign-up/sign-in.
5. Custom SMTP (Resend/Postmark/SendGrid) in Supabase Auth — built-in sender is rate-limited to a handful of emails/hour; signup confirmations will silently throttle at launch without it.
6. TMDB terms: display attribution ("This product uses the TMDB API but is not endorsed or certified by TMDB") + logo in the app footer. The free TMDB API license is non-commercial — before monetizing, obtain a commercial license.
7. Gemini API: set a billing budget alert; confirm `gemini-2.5-flash` quota fits 10 recs/min/user ceiling.
8. Supabase: enable Point-in-Time Recovery / verify backup schedule before public traffic.

## EXECUTION ORDER

1. F1 (unblock schema reproducibility — everything else assumes migrations are tracked)
2. Migrations batch: F3, F6(2), F11, F16 — write files, apply each to live project `bhtkujcfvknxphatejbu`, verify per-finding
3. F2 (error model refactor — touches most files; do before other TS changes to avoid double-editing)
4. F5 (server-side taste profile; builds on F2 shapes)
5. F4, F6(1), F7, F8, F9, F10 (actions/lib changes; small, independent)
6. F12–F18 (independent, any order)
7. F19–F20 (cleanup last)
8. Full gate: `npx tsc --noEmit && npm run lint && npm run build`, re-run Supabase advisors (expect: no security WARNs except auth-dashboard items handled in OPS), manual smoke: signup → swipe 5 → recommend → add to watchlist → rate from watchlist → history shows entries → save profile name.
