-- S14: Stripe subscriptions. One row per user, written ONLY by the Stripe
-- webhook via the service-role (admin) client — the webhook is the single
-- source of truth for entitlement, never the client-side success redirect.
-- RLS therefore grants users read of their own row and defines no insert/update
-- policy (service role bypasses RLS). `stripe_customer_id` is indexed because
-- subscription.* webhook events identify the row by customer, not user.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  status text not null default 'inactive',
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  constraint subscriptions_status_chk check (
    status in ('active', 'trialing', 'past_due', 'canceled', 'inactive')
  )
);

alter table public.subscriptions enable row level security;

drop policy if exists "Users read own subscription" on public.subscriptions;
create policy "Users read own subscription"
  on public.subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions (stripe_customer_id);
