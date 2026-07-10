-- S2: Shareable recommendation links with OG cards.
--
-- Stores a snapshot of a recommendation so a public /r/<id> page can render a
-- rich preview without exposing the author. Public SELECT is intentional: ids
-- are unguessable UUIDs and rows contain no PII (never expose user identity on
-- the page). Inserts are restricted to the authenticated owner.
create table if not exists public.shared_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  tmdb_movie_id integer not null,
  movie_title text not null,
  movie_year integer,
  poster_url text,
  reason text,
  created_at timestamptz not null default now(),
  constraint shared_rec_text_caps check (
    length(movie_title) <= 300
    and coalesce(length(reason), 0) <= 2000
    and coalesce(length(poster_url), 0) <= 600
  )
);

alter table public.shared_recommendations enable row level security;

drop policy if exists "Anyone can read a shared rec by id" on public.shared_recommendations;
create policy "Anyone can read a shared rec by id"
  on public.shared_recommendations for select
  using (true);

drop policy if exists "Users insert own shared recs" on public.shared_recommendations;
create policy "Users insert own shared recs"
  on public.shared_recommendations for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
