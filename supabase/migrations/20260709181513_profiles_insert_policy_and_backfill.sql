-- F3: profiles has no INSERT RLS policy, so `upsert` (INSERT ... ON CONFLICT DO
-- UPDATE) fails WITH CHECK even on the update path. Add the INSERT policy and
-- backfill any auth users missing a profile row (e.g. users created before the
-- signup trigger existed). Non-destructive.

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Backfill users created before/despite the signup trigger
insert into public.profiles (id, name)
select u.id, u.raw_user_meta_data->>'name'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
