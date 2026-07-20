# Filmmoo swipe queue + TMDB cache spec

> Updated for the S10 shared candidate pool and S11 embeddings (2026-07). The
> original per-user TMDB discovery design this doc described was replaced: TMDB
> is now only called by the nightly cron, and runtime queue refills are pure DB.

## Goal
Make swipe cards reliably available while eliminating TMDB calls from the user
path, preventing duplicate cards/ratings, and reusing one shared metadata cache.

## Architecture
1. `movies_cache` — shared TMDB metadata cache; one row per movie. Pool members
   carry `pool_rank` (curated ordering) and a 768-dim `embedding` (pgvector).
2. `user_movie_queue` — per-user ready-to-swipe queue referencing `movies_cache`.
3. `swipe_states` — authoritative latest action per `(user_id, tmdb_movie_id)`;
   the duplicate guard for both queueing and recommendations.

## Nightly pool refresh (`/api/cron/refresh-pool`, bearer-gated)
- Walks the tiered TMDB discovery plan (mainstream → broader → niche, all with
  `vote_count.gte` floors) to ~800 candidates.
- Hydrates uncached movies (details + credits + videos) with bounded concurrency,
  upserts into `movies_cache`, then `rebuild_movie_pool` reassigns `pool_rank`.
- Embeds pool rows missing `embedding` (gemini-embedding-001, 768 dims,
  L2-normalised). `scripts/backfill-embeddings.mjs` clears large backlogs.
- Also: trailer-key backfill and Movie Night expiry.

## Queue lifecycle
- Delivery: `getQueuedMovies` returns up to 20 active queue rows (rank order).
- Refill: `fill_queue_from_pool` RPC (security definer, service-role only,
  per-user advisory lock) inserts unseen pool movies — excluding the user's
  `swipe_states`, active queue, and watchlist, honoring S8 preference filters —
  with ranks continuing from the user's max. Runtime TMDB fallback exists only
  for pool exhaustion (logged as `POOL_EXHAUSTED`).
- Blocking refill only when the queue is empty; below-watermark top-ups run
  after the response via `next/server` `after()`.
- Consumption: `record_swipe_event` marks the queue row consumed, appends the
  immutable `swipe_events` row, and upserts `swipe_states`.
- Preference changes discard active queue rows so the deck rebuilds filtered.

## Recommendations (S11)
- Taste vector = weighted mean of the user's rated movies' embeddings
  (loved 1.0, watched 0.4, disliked −0.7), L2-normalised.
- `match_candidates` RPC returns the ~30 closest unseen pool movies by cosine
  distance; Gemini re-ranks and writes the reason (retry once on an
  out-of-list id, then top-similarity fallback with a templated reason).
- `RECS_ENGINE=freeform` forces the legacy free-form engine, which is also the
  automatic fallback when embeddings/candidates are unavailable.

## Duplicate prevention
- At queue-fill time: exclusion inside `fill_queue_from_pool` (states ∪ active
  queue ∪ watchlist) plus the partial unique index on active
  `(user_id, tmdb_movie_id)` rows.
- At swipe-save time: `record_swipe_event` always upserts the latest action
  (undo + re-rate is supported); the queue-consume update is idempotent.

## Constants
- Queue target size 60 · low watermark 15 · delivery batch 20 · pool ~800
  (634 embedded at ship time) · candidate retrieval 30.
