alter table public.movies_cache
  add column if not exists trailer_key text;
