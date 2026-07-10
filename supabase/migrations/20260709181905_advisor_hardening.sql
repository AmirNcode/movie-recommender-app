-- F11: Supabase advisor hardening (security + performance). Non-destructive.
--
-- (a) function_search_path_mutable: pin search_path on the SECURITY DEFINER
--     rate limiter. Its body schema-qualifies public.rate_limits everywhere and
--     only uses pg_catalog builtins (now/json_build_object/extract/ceil), which
--     resolve implicitly, so search_path = '' is safe.
alter function public.check_rate_limit(text, int, interval) set search_path = '';

-- (b) anon/authenticated_security_definer_function_executable (advisors 0028/0029):
--     revoke REST EXECUTE on the trigger/event functions. handle_new_user still
--     runs from the on_auth_user_created trigger and rls_auto_enable from its
--     event trigger (definer rights); revoking REST EXECUTE does not affect them.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- (c) Codify the (currently live-only) rls_auto_enable event trigger so repo ==
--     prod. Recreate the function defensively with a pinned search_path.
create or replace function public.rls_auto_enable() returns event_trigger
language plpgsql security definer set search_path = '' as $$
declare cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then null;
      end;
    end if;
  end loop;
end $$;

-- The live project already has this event trigger installed under the name
-- `ensure_rls` (verified). Only create one if NO event trigger already runs
-- rls_auto_enable, so live keeps `ensure_rls` (no duplicate) while a fresh
-- repo-built database still gets the trigger.
do $$ begin
  if not exists (
    select 1
    from pg_event_trigger e
    join pg_proc p on p.oid = e.evtfoid
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    create event trigger rls_auto_enable_trigger on ddl_command_end execute function public.rls_auto_enable();
  end if;
end $$;

-- (d) auth_rls_initplan: wrap auth.uid() in a scalar subselect on all user
--     policies so it is evaluated once per query instead of once per row.
--     Predicates, role targeting, and USING/WITH CHECK splits are preserved
--     exactly as they exist on the live DB.

-- profiles (column id; PUBLIC role)
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles for select
  using ((select auth.uid()) = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update
  using ((select auth.uid()) = id);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert
  with check ((select auth.uid()) = id);

-- swipe_events (PUBLIC role)
drop policy if exists "Users can read own swipe events" on public.swipe_events;
create policy "Users can read own swipe events" on public.swipe_events for select
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert own swipe events" on public.swipe_events;
create policy "Users can insert own swipe events" on public.swipe_events for insert
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own swipe events" on public.swipe_events;
create policy "Users can update own swipe events" on public.swipe_events for update
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own swipe events" on public.swipe_events;
create policy "Users can delete own swipe events" on public.swipe_events for delete
  using ((select auth.uid()) = user_id);

-- swipe_states (PUBLIC role)
drop policy if exists "Users can read own swipe states" on public.swipe_states;
create policy "Users can read own swipe states" on public.swipe_states for select
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert own swipe states" on public.swipe_states;
create policy "Users can insert own swipe states" on public.swipe_states for insert
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own swipe states" on public.swipe_states;
create policy "Users can update own swipe states" on public.swipe_states for update
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own swipe states" on public.swipe_states;
create policy "Users can delete own swipe states" on public.swipe_states for delete
  using ((select auth.uid()) = user_id);

-- watchlists (PUBLIC role)
drop policy if exists "Users can read own watchlist" on public.watchlists;
create policy "Users can read own watchlist" on public.watchlists for select
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert own watchlist items" on public.watchlists;
create policy "Users can insert own watchlist items" on public.watchlists for insert
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own watchlist items" on public.watchlists;
create policy "Users can update own watchlist items" on public.watchlists for update
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own watchlist items" on public.watchlists;
create policy "Users can delete own watchlist items" on public.watchlists for delete
  using ((select auth.uid()) = user_id);

-- user_movie_queue (authenticated role)
drop policy if exists "Users can read own queue" on public.user_movie_queue;
create policy "Users can read own queue" on public.user_movie_queue for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can update own queue" on public.user_movie_queue;
create policy "Users can update own queue" on public.user_movie_queue for update
  to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- (e) unindexed_foreign_keys: cover the movies_cache FK (join + ON DELETE CASCADE).
--     The existing (user_id, tmdb_movie_id) index does not lead with the FK column.
create index if not exists user_movie_queue_tmdb_idx on public.user_movie_queue (tmdb_movie_id);
