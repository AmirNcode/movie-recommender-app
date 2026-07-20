-- S16: Cinema DNA (Pro taste report) cached on profiles, and share-kind
-- support on shared_recommendations so DNA cards reuse the public /r/<id>
-- page + OG image mechanism. DNA share rows use tmdb_movie_id = 0,
-- movie_title = archetype, reason = headline, dna = full payload.

alter table public.profiles
  add column if not exists cinema_dna jsonb,
  add column if not exists dna_generated_at timestamptz;

alter table public.shared_recommendations
  add column if not exists kind text not null default 'rec',
  add column if not exists dna jsonb;

alter table public.shared_recommendations
  drop constraint if exists shared_rec_kind_chk;
alter table public.shared_recommendations
  add constraint shared_rec_kind_chk check (kind in ('rec', 'dna'));
