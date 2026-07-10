-- Fix: record_swipe_event lost the latest action on undo + re-rate.
--
-- The previous version (20260327000004) early-returned `false` when a row
-- already existed in swipe_states, never updating the action. That breaks the
-- legitimate flow where a user undoes a swipe locally and re-rates the same
-- card differently. The new version always inserts an event and upserts the
-- latest state; the queue-consume update is naturally idempotent because of
-- its WHERE clause.

drop function if exists public.record_swipe_event(
  integer,
  public.swipe_action,
  text,
  integer,
  text,
  text,
  text,
  text,
  text,
  text
);

create function public.record_swipe_event(
  p_tmdb_movie_id integer,
  p_action public.swipe_action,
  p_movie_title text default null,
  p_movie_year integer default null,
  p_movie_director text default null,
  p_movie_genre text default null,
  p_poster_url text default null,
  p_movie_synopsis text default null,
  p_recommendation_reason text default null,
  p_source text default null
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  insert into public.swipe_events (
    user_id,
    tmdb_movie_id,
    action,
    movie_title,
    movie_year,
    movie_director,
    movie_genre,
    poster_url,
    movie_synopsis,
    recommendation_reason,
    source
  )
  values (
    v_user_id,
    p_tmdb_movie_id,
    p_action,
    p_movie_title,
    p_movie_year,
    p_movie_director,
    p_movie_genre,
    p_poster_url,
    p_movie_synopsis,
    p_recommendation_reason,
    p_source
  );

  insert into public.swipe_states (
    user_id,
    tmdb_movie_id,
    latest_action
  )
  values (
    v_user_id,
    p_tmdb_movie_id,
    p_action
  )
  on conflict (user_id, tmdb_movie_id)
  do update set
    latest_action = excluded.latest_action,
    updated_at = now();

  update public.user_movie_queue
  set consumed_at = now()
  where user_id = v_user_id
    and tmdb_movie_id = p_tmdb_movie_id
    and consumed_at is null
    and discarded_at is null;

  return true;
end;
$$;

revoke all on function public.record_swipe_event(
  integer,
  public.swipe_action,
  text,
  integer,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon;

grant execute on function public.record_swipe_event(
  integer,
  public.swipe_action,
  text,
  integer,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;
