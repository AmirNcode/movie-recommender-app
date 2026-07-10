-- Drop the orphaned 7-arg record_swipe_event left behind by an earlier migration.
-- The current 10-arg signature (returns boolean) is the only one called by the app.

drop function if exists public.record_swipe_event(
  integer,
  public.swipe_action,
  text,
  integer,
  text,
  text,
  text
);
