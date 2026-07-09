-- Fix: concurrent queue refills could collide on the partial unique index
-- (user_id, tmdb_movie_id) WHERE active, causing the entire batch insert to
-- fail. Move the rank-computation + insert into a security-definer RPC that
-- holds a per-user transactional advisory lock and tolerates duplicate
-- candidates with ON CONFLICT DO NOTHING.

create or replace function public.enqueue_user_movies(
  p_user_id uuid,
  p_movies jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_rank bigint;
  v_inserted integer := 0;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- Serialize concurrent refills for the same user. Released at end of txn.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select coalesce(max(queue_rank), 0) + 1
  into v_next_rank
  from public.user_movie_queue
  where user_id = p_user_id
    and consumed_at is null
    and discarded_at is null;

  with input as (
    select
      (item->>'tmdb_movie_id')::integer as tmdb_movie_id,
      item->>'source_tier' as source_tier,
      (row_number() over () - 1)::bigint as offset_idx
    from jsonb_array_elements(p_movies) as item
  ),
  inserted as (
    insert into public.user_movie_queue (
      user_id,
      tmdb_movie_id,
      queue_rank,
      source_tier
    )
    select
      p_user_id,
      input.tmdb_movie_id,
      v_next_rank + input.offset_idx,
      input.source_tier
    from input
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function public.enqueue_user_movies(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_user_movies(uuid, jsonb) to service_role;
