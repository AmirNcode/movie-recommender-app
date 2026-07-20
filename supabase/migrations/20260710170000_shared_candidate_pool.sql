-- S10: Shared candidate pool + pool-based queue refill.
--
-- Moves TMDB fan-out out of the user request path. A nightly cron populates a
-- shared, ranked candidate pool on movies_cache (pool_rank); queue refills then
-- become a single pure-DB operation (fill_queue_from_pool). Non-destructive.

-- (1) Pool membership + curated ordering within tier. NULL pool_rank = not in
--     the current pool. Partial index supports the tier-scoped ordered scan.
alter table public.movies_cache
  add column if not exists pool_rank integer;

create index if not exists movies_cache_pool_idx
  on public.movies_cache (source_tier, pool_rank)
  where pool_rank is not null;

-- (2) Rebuild the pool from a set of tmdb ids (called by the nightly cron after
--     hydrating/upserting the collected candidates). Clears stale membership,
--     then assigns pool_rank by (tier priority, popularity desc). Returns the
--     resulting pool size. service_role only.
create or replace function public.rebuild_movie_pool(p_tmdb_ids integer[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_tmdb_ids is null then
    raise exception 'p_tmdb_ids is required';
  end if;

  -- Drop rows that are no longer part of the pool.
  update public.movies_cache
  set pool_rank = null
  where pool_rank is not null
    and not (tmdb_movie_id = any(p_tmdb_ids));

  -- (Re)assign contiguous ranks to the current pool. Lower rank = higher
  -- priority: mainstream before broader-mainstream before niche, then by
  -- popularity within each tier.
  with ranked as (
    select
      tmdb_movie_id,
      row_number() over (
        order by
          case source_tier
            when 'mainstream' then 1
            when 'broader-mainstream' then 2
            when 'niche' then 3
            else 4
          end,
          popularity desc nulls last,
          tmdb_movie_id
      ) as rn
    from public.movies_cache
    where tmdb_movie_id = any(p_tmdb_ids)
  )
  update public.movies_cache mc
  set pool_rank = ranked.rn
  from ranked
  where mc.tmdb_movie_id = ranked.tmdb_movie_id;

  select count(*) into v_count
  from public.movies_cache
  where pool_rank is not null;

  return v_count;
end;
$$;

revoke all on function public.rebuild_movie_pool(integer[]) from public, anon, authenticated;
grant execute on function public.rebuild_movie_pool(integer[]) to service_role;

-- (3) Fill a user's queue from the shared pool in one round-trip. Excludes the
--     user's swipe_states, active queue rows, and watchlist. Optional filter
--     args (forward-compat with S8 deck preferences) narrow the candidate set.
--     Ranks continue from the user's current max active queue_rank. Holds a
--     per-user advisory lock (same pattern as enqueue_user_movies) so
--     concurrent refills can't collide on the active partial unique index.
--     Returns the number of rows enqueued. service_role only.
create or replace function public.fill_queue_from_pool(
  p_user_id uuid,
  p_count integer,
  p_year_from integer default null,
  p_year_to integer default null,
  p_min_vote numeric default null,
  p_genres text[] default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_rank bigint;
  v_inserted integer := 0;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_count is null or p_count <= 0 then
    return 0;
  end if;

  -- Serialize concurrent refills for the same user. Released at end of txn.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select coalesce(max(queue_rank), 0)
  into v_next_rank
  from public.user_movie_queue
  where user_id = p_user_id
    and consumed_at is null
    and discarded_at is null;

  with candidates as (
    select
      mc.tmdb_movie_id,
      mc.source_tier,
      case mc.source_tier
        when 'mainstream' then 1
        when 'broader-mainstream' then 2
        when 'niche' then 3
        else 4
      end as tier_priority,
      mc.pool_rank
    from public.movies_cache mc
    where mc.pool_rank is not null
      and (p_year_from is null or mc.year >= p_year_from)
      and (p_year_to is null or mc.year <= p_year_to)
      and (p_min_vote is null or mc.vote_average >= p_min_vote)
      and (
        p_genres is null
        or exists (
          select 1 from unnest(p_genres) as g
          where mc.genre ilike '%' || g || '%'
        )
      )
      and not exists (
        select 1 from public.swipe_states s
        where s.user_id = p_user_id and s.tmdb_movie_id = mc.tmdb_movie_id
      )
      and not exists (
        select 1 from public.user_movie_queue q
        where q.user_id = p_user_id
          and q.tmdb_movie_id = mc.tmdb_movie_id
          and q.consumed_at is null
          and q.discarded_at is null
      )
      and not exists (
        select 1 from public.watchlists w
        where w.user_id = p_user_id and w.tmdb_movie_id = mc.tmdb_movie_id
      )
    order by tier_priority, mc.pool_rank
    limit p_count
  ),
  ranked as (
    select
      tmdb_movie_id,
      source_tier,
      row_number() over (order by tier_priority, pool_rank) as offset_idx
    from candidates
  ),
  inserted as (
    insert into public.user_movie_queue (user_id, tmdb_movie_id, queue_rank, source_tier)
    select p_user_id, tmdb_movie_id, v_next_rank + offset_idx, source_tier
    from ranked
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function public.fill_queue_from_pool(uuid, integer, integer, integer, numeric, text[]) from public, anon, authenticated;
grant execute on function public.fill_queue_from_pool(uuid, integer, integer, integer, numeric, text[]) to service_role;
