-- F16: rate_limits accumulates one row per user:action key forever. Schedule a
-- daily pg_cron purge of stale window rows (older than 2 days). Non-destructive:
-- only deletes rows whose rate-limit window is long expired. pg_cron is the
-- preferred approach (available on this project); cron.schedule upserts by job
-- name, so re-applying is safe.
create extension if not exists pg_cron;

select cron.schedule(
  'purge-stale-rate-limits',
  '17 3 * * *',
  $$delete from public.rate_limits where window_start < now() - interval '2 days'$$
);
