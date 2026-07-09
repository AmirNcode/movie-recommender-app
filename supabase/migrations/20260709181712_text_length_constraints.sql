-- F6 (part 2): defense-in-depth text-length caps on client-writable tables.
-- Blocks unbounded strings written directly via PostgREST with the publishable
-- key (the server-side validation helper is the first layer). Added NOT VALID
-- then validated separately so the ADD holds a lighter lock and cannot fail on
-- any oversized legacy row (verified none exist at apply time). Non-destructive.

alter table public.swipe_events
  add constraint swipe_events_text_caps check (
    coalesce(length(movie_title),0) <= 300 and coalesce(length(movie_director),0) <= 300 and
    coalesce(length(movie_genre),0) <= 300 and coalesce(length(poster_url),0) <= 600 and
    coalesce(length(movie_synopsis),0) <= 2000 and coalesce(length(recommendation_reason),0) <= 2000 and
    coalesce(length(source),0) <= 40
  ) not valid;
alter table public.swipe_events validate constraint swipe_events_text_caps;

alter table public.watchlists
  add constraint watchlists_text_caps check (
    coalesce(length(movie_title),0) <= 300 and coalesce(length(movie_director),0) <= 300 and
    coalesce(length(movie_genre),0) <= 300 and coalesce(length(poster_url),0) <= 600 and
    coalesce(length(movie_synopsis),0) <= 2000 and coalesce(length(recommendation_reason),0) <= 2000 and
    coalesce(length(source),0) <= 40
  ) not valid;
alter table public.watchlists validate constraint watchlists_text_caps;
