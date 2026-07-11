-- S6: Movie Night (two-user match mode).
--
-- Two users swipe a shared, ranked deck; the first movie both mark
-- loved/watched-liked resolves the night to `matched`. Three tables, all
-- participant-only RLS. Match resolution runs in a security-definer RPC that
-- holds a per-night transactional advisory lock (same pattern as
-- enqueue_user_movies / fill_queue_from_pool) so concurrent mutual likes on
-- different movies can't both win. Cards are filled lazily at join time (both
-- users known only then) by a second security-definer RPC. The row is on the
-- supabase_realtime publication so both clients flip to the match screen the
-- moment status becomes `matched`.

-- ── Tables ───────────────────────────────────────────────────────────────────

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

-- FK-covering + hot-path indexes (leading pk columns are already covered).
create index movie_nights_host_created_idx on public.movie_nights (host_id, created_at desc);
create index movie_nights_guest_idx on public.movie_nights (guest_id);
create index movie_night_cards_tmdb_idx on public.movie_night_cards (tmdb_movie_id);
create index movie_night_votes_user_idx on public.movie_night_votes (user_id);
-- Match resolution filters votes by (night_id, tmdb_movie_id).
create index movie_night_votes_night_movie_idx on public.movie_night_votes (night_id, tmdb_movie_id);

-- ── RLS: participants only ───────────────────────────────────────────────────
-- A participant is the host or the (post-join) guest. All user-facing writes are
-- INSERTs (create night, cast vote); the privileged mutations — claiming the
-- guest slot + filling cards (join), resolving a match, expiring stale nights —
-- run through the admin client / security-definer RPCs below, so no direct user
-- UPDATE policy is granted (tighter than a blanket participant-update policy: a
-- participant can't hand-set status/matched_tmdb_id on their own night).

alter table public.movie_nights enable row level security;
alter table public.movie_night_cards enable row level security;
alter table public.movie_night_votes enable row level security;

create policy "Participants read their nights"
  on public.movie_nights for select to authenticated
  using ((select auth.uid()) = host_id or (select auth.uid()) = guest_id);

create policy "Host creates a night"
  on public.movie_nights for insert to authenticated
  with check ((select auth.uid()) = host_id);

create policy "Participants read night cards"
  on public.movie_night_cards for select to authenticated
  using (exists (
    select 1 from public.movie_nights n
    where n.id = night_id
      and ((select auth.uid()) = n.host_id or (select auth.uid()) = n.guest_id)
  ));

create policy "Participants read night votes"
  on public.movie_night_votes for select to authenticated
  using (exists (
    select 1 from public.movie_nights n
    where n.id = night_id
      and ((select auth.uid()) = n.host_id or (select auth.uid()) = n.guest_id)
  ));

create policy "Participants cast own votes"
  on public.movie_night_votes for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.movie_nights n
      where n.id = night_id
        and ((select auth.uid()) = n.host_id or (select auth.uid()) = n.guest_id)
    )
  );

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Clients subscribe to postgres_changes on their own night row (filter
-- id=eq.<nightId>); Realtime enforces the SELECT policy above, so only the two
-- participants receive the status transition. Default replica identity (pk) is
-- sufficient — subscribers only read NEW.status / NEW.matched_tmdb_id.
alter publication supabase_realtime add table public.movie_nights;

-- ── RPC: fill_movie_night_cards ──────────────────────────────────────────────
-- Called by joinMovieNight (admin client) once both participants are known.
-- Builds a shared 30-card deck from movies_cache, excluding either user's
-- swipe_states, ordered by popularity desc. Idempotent: a re-join finds cards
-- already present and returns the existing count. Holds a per-night advisory
-- lock so a double-join can't race two deck fills. service_role only.
create or replace function public.fill_movie_night_cards(
  p_night_id uuid,
  p_host uuid,
  p_guest uuid,
  p_count integer
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing integer;
  v_inserted integer := 0;
begin
  if p_night_id is null or p_host is null or p_guest is null then
    raise exception 'p_night_id, p_host and p_guest are required';
  end if;
  if p_count is null or p_count <= 0 then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_night_id::text, 0));

  select count(*) into v_existing
  from public.movie_night_cards
  where night_id = p_night_id;

  if v_existing > 0 then
    return v_existing;  -- already filled (idempotent re-join)
  end if;

  with candidates as (
    select
      mc.tmdb_movie_id,
      row_number() over (order by mc.popularity desc nulls last, mc.tmdb_movie_id) as rank
    from public.movies_cache mc
    where mc.poster_url is not null
      and not exists (
        select 1 from public.swipe_states s
        where s.user_id = p_host and s.tmdb_movie_id = mc.tmdb_movie_id
      )
      and not exists (
        select 1 from public.swipe_states s
        where s.user_id = p_guest and s.tmdb_movie_id = mc.tmdb_movie_id
      )
    order by mc.popularity desc nulls last, mc.tmdb_movie_id
    limit p_count
  ),
  inserted as (
    insert into public.movie_night_cards (night_id, tmdb_movie_id, rank)
    select p_night_id, tmdb_movie_id, rank from candidates
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function public.fill_movie_night_cards(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.fill_movie_night_cards(uuid, uuid, uuid, integer) to service_role;

-- ── RPC: resolve_movie_night ─────────────────────────────────────────────────
-- Called by voteMovieNight (admin client) after a `liked` vote. Under a
-- per-night advisory lock: if the night is still open and BOTH participants have
-- a liked vote for p_tmdb_id, flip it to matched and stamp matched_tmdb_id.
-- First mutual like wins; a later call on an already-matched night is a no-op
-- that returns the stored match. Returns the matched tmdb id, or null if no
-- match resolved. service_role only.
create or replace function public.resolve_movie_night(
  p_night_id uuid,
  p_tmdb_id integer
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
  v_guest uuid;
  v_status text;
  v_matched integer;
  v_both boolean;
begin
  if p_night_id is null or p_tmdb_id is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_night_id::text, 0));

  select host_id, guest_id, status, matched_tmdb_id
  into v_host, v_guest, v_status, v_matched
  from public.movie_nights
  where id = p_night_id;

  if not found then
    return null;
  end if;
  if v_status = 'matched' then
    return v_matched;  -- already resolved; first match stands
  end if;
  if v_guest is null then
    return null;       -- no partner yet
  end if;

  select
    count(*) filter (where user_id = v_host) > 0
    and count(*) filter (where user_id = v_guest) > 0
  into v_both
  from public.movie_night_votes
  where night_id = p_night_id
    and tmdb_movie_id = p_tmdb_id
    and liked = true;

  if coalesce(v_both, false) then
    update public.movie_nights
    set status = 'matched', matched_tmdb_id = p_tmdb_id
    where id = p_night_id and status <> 'matched';
    return p_tmdb_id;
  end if;

  return null;
end;
$$;

revoke all on function public.resolve_movie_night(uuid, integer) from public, anon, authenticated;
grant execute on function public.resolve_movie_night(uuid, integer) to service_role;
