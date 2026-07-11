-- S8: deck filters (genre / decade / min rating).
create table public.user_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  genres integer[] not null default '{}',
  year_from integer,
  year_to integer,
  min_vote numeric,
  updated_at timestamptz not null default now(),
  constraint user_preferences_genres_cap check (array_length(genres, 1) is null or array_length(genres, 1) <= 19),
  constraint user_preferences_year_chk check (
    (year_from is null or (year_from >= 1900 and year_from <= 2100)) and
    (year_to is null or (year_to >= 1900 and year_to <= 2100)) and
    (year_from is null or year_to is null or year_from <= year_to)
  ),
  constraint user_preferences_min_vote_chk check (min_vote is null or (min_vote >= 0 and min_vote <= 10))
);

alter table public.user_preferences enable row level security;

create policy "Users select own preferences"
  on public.user_preferences for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users insert own preferences"
  on public.user_preferences for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update own preferences"
  on public.user_preferences for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
