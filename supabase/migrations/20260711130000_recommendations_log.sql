-- S12: recommendation ledger — prereq for quotas (S13), analytics, and the
-- S11 A/B engine comparison. One row per successful getMovieRecommendation
-- call. Inserts happen via the admin (service-role) client only, so there is
-- deliberately no insert policy — RLS grants users read of their own rows.
create table if not exists public.recommendations_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  tmdb_movie_id integer,
  movie_title text,
  reason text,
  engine text not null default 'freeform',
  prompt_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  constraint recommendations_log_text_caps check (
    coalesce(length(movie_title), 0) <= 300
    and coalesce(length(reason), 0) <= 2000
  )
);

alter table public.recommendations_log enable row level security;

drop policy if exists "Users read own recommendation log" on public.recommendations_log;
create policy "Users read own recommendation log"
  on public.recommendations_log for select
  to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists recommendations_log_user_created_idx
  on public.recommendations_log (user_id, created_at desc);
