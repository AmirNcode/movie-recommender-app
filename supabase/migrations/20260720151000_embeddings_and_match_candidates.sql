-- S11: pgvector embeddings on the shared movie pool + taste-based candidate
-- retrieval. The nightly cron embeds pool rows (gemini-embedding-001, 768 dims,
-- L2-normalised client-side); match_candidates returns the closest unseen pool
-- movies to a user's taste vector for Gemini re-ranking.

create extension if not exists vector with schema extensions;

alter table public.movies_cache
  add column if not exists embedding extensions.vector(768);

create index if not exists movies_cache_embedding_hnsw_idx
  on public.movies_cache
  using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.match_candidates(
  p_user_id uuid,
  p_query extensions.vector(768),
  p_count integer default 30
) returns table (
  tmdb_movie_id integer,
  title text,
  year integer,
  director text,
  genre text,
  synopsis text,
  poster_url text,
  similarity double precision
)
language sql
security definer
set search_path = ''
as $$
  select
    mc.tmdb_movie_id,
    mc.title,
    mc.year,
    mc.director,
    mc.genre,
    mc.synopsis,
    mc.poster_url,
    1 - (mc.embedding operator(extensions.<=>) p_query) as similarity
  from public.movies_cache mc
  where mc.pool_rank is not null
    and mc.embedding is not null
    and not exists (
      select 1 from public.swipe_states ss
      where ss.user_id = p_user_id and ss.tmdb_movie_id = mc.tmdb_movie_id
    )
    and not exists (
      select 1 from public.watchlists w
      where w.user_id = p_user_id and w.tmdb_movie_id = mc.tmdb_movie_id
    )
  order by mc.embedding operator(extensions.<=>) p_query
  limit greatest(1, least(p_count, 100));
$$;

revoke all on function public.match_candidates(uuid, extensions.vector, integer)
  from public, anon, authenticated;
grant execute on function public.match_candidates(uuid, extensions.vector, integer)
  to service_role;
