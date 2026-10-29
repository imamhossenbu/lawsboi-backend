-- Subscriptions and the bKash/Nagad payments readers submit for them.

create table public.wallet_accounts (
  method public.payment_method primary key,
  number text not null,
  type text not null default 'personal' check (type in ('personal', 'merchant')),
  name text not null default 'Lawsboi',
  -- Offered at checkout
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger wallet_accounts_updated_at before update on public.wallet_accounts for each row execute function public.set_updated_at();

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  public_id text generated always as ('SUB-' || lpad(number::text, 6, '0')) stored unique,
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id text not null references public.plans (id),
  cycle public.billing_cycle not null,
  -- Taka per cycle at the time it started
  amount integer not null check (amount >= 0),
  status public.subscription_status not null default 'active',
  auto_renew boolean not null default true,
  started_at timestamptz not null default now(),
  -- Null once canceled
  renews_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_idx on public.subscriptions (user_id);
create index subscriptions_status_idx on public.subscriptions (status);
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  public_id text generated always as ('PAY-' || lpad(number::text, 6, '0')) stored unique,
  user_id uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  plan_id text not null references public.plans (id),
  cycle public.billing_cycle not null,
  amount integer not null check (amount >= 0),
  method public.payment_method not null,
  -- What the reader typed at checkout: 10 characters for bKash, 8 for Nagad
  trx_id text not null,
  status public.payment_status not null default 'awaiting',
  reason public.reject_reason,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.team_members (id) on delete set null,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payments_trx_per_method on public.payments (method, upper(trx_id));
create index payments_user_idx on public.payments (user_id);
create index payments_status_idx on public.payments (status, submitted_at desc);
create trigger payments_updated_at before update on public.payments for each row execute function public.set_updated_at();

alter table public.wallet_accounts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;

create policy "enabled wallets show at checkout" on public.wallet_accounts
  for select using (enabled);
create policy "readers see their own subscriptions" on public.subscriptions
  for select using (public.is_owner(user_id));
create policy "readers see their own payments" on public.payments
  for select using (public.is_owner(user_id));
