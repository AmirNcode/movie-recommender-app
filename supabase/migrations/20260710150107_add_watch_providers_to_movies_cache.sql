alter table public.movies_cache
  add column if not exists watch_providers jsonb,
  add column if not exists watch_providers_fetched_at timestamptz;

