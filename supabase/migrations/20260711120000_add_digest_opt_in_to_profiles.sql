-- S9: weekly digest opt-in (opt-IN at launch, per the roadmap's legal default).
alter table public.profiles
  add column if not exists digest_opt_in boolean not null default false;
