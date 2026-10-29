-- The reader's library (saved items, collections, research history), the pricing page's comparison matrix, and
-- the SQL that aggregates the dashboard's and the payments page's figures.

/* ---------------------------------------------------------------- library */

create table public.saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Language-neutral dashboard path, also the item's identity: "/dashboard/laws/penal-code-1860/section-9"
  href text not null,
  kind text not null check (kind in ('law', 'section', 'order', 'case')),
  title text not null,
  subtitle text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, href)
);
create index saved_items_user_idx on public.saved_items (user_id, created_at desc);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  description text not null default '',
  icon text not null default 'folder' check (icon in ('folder', 'scale', 'book', 'file', 'bookmark', 'tag')),
  color text not null default 'green' check (color in ('green', 'blue', 'violet', 'pink', 'orange', 'gold', 'teal', 'gray')),
  created_at timestamptz not null default now()
);
create index collections_user_idx on public.collections (user_id, created_at);

-- What sits in each collection: a saved item's href, or "chat:<id>" for a saved assistant chat
create table public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  item_key text not null,
  added_at timestamptz not null default now(),
  primary key (collection_id, item_key)
);

create table public.research_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('law', 'section', 'case', 'search')),
  title text not null,
  title_bn text not null,
  -- The law a section belongs to
  context text,
  context_bn text,
  -- For searches: which search
  scope text check (scope is null or scope in ('laws', 'cases')),
  href text not null,
  created_at timestamptz not null default now()
);
create index research_history_user_idx on public.research_history (user_id, created_at desc);

alter table public.saved_items enable row level security;
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
alter table public.research_history enable row level security;

create policy "readers own their saved items" on public.saved_items
  for all using (public.is_owner(user_id)) with check (public.is_owner(user_id));
create policy "readers own their collections" on public.collections
  for all using (public.is_owner(user_id)) with check (public.is_owner(user_id));
create policy "readers own their collection items" on public.collection_items
  for all using (exists (select 1 from public.collections c where c.id = collection_id and public.is_owner(c.user_id)))
  with check (exists (select 1 from public.collections c where c.id = collection_id and public.is_owner(c.user_id)));
create policy "readers own their history" on public.research_history
  for all using (public.is_owner(user_id)) with check (public.is_owner(user_id));

/* ---------------------------------------------------------------- pricing */

-- The pricing page's comparison table, one row per feature in display order. Values per plan: true/false,
-- "limited", "unlimited" or a number (a monthly allowance or a cap).
insert into public.site_settings (key, value)
values ('feature_matrix', '[
  {"key": "laws", "free": true, "researcher": true, "professional": true},
  {"key": "judgments", "free": "limited", "researcher": true, "professional": true},
  {"key": "basicSearch", "free": true, "researcher": true, "professional": true},
  {"key": "advancedSearch", "free": false, "researcher": true, "professional": true},
  {"key": "aiQuestions", "free": 5, "researcher": 30, "professional": "unlimited"},
  {"key": "savedItems", "free": 5, "researcher": 50, "professional": "unlimited"},
  {"key": "pdfDownload", "free": false, "researcher": true, "professional": true},
  {"key": "relatedCases", "free": false, "researcher": true, "professional": true},
  {"key": "caseAnalysis", "free": false, "researcher": false, "professional": true},
  {"key": "caseComparison", "free": false, "researcher": false, "professional": true},
  {"key": "citationExport", "free": false, "researcher": false, "professional": true},
  {"key": "prioritySupport", "free": false, "researcher": false, "professional": true}
]'::jsonb)
on conflict (key) do nothing;

/* ------------------------------------------------------------- aggregates */

-- Month boundaries in Bangladesh time (no daylight saving, so a fixed offset is exact).
create or replace function public.dhaka_month(ts timestamptz)
returns text
language sql
immutable
as $$
  select to_char(ts at time zone 'Asia/Dhaka', 'YYYY-MM');
$$;

-- One row per month, oldest first, ending with the current month: verified revenue, refunds, revenue by plan,
-- new paid subscriptions, readers in total and readers seen that month.
create or replace function public.dashboard_series(months_back integer default 12)
returns table (
  month text,
  revenue bigint,
  refunds bigint,
  revenue_by_plan jsonb,
  new_subscriptions bigint,
  total_users bigint,
  active_users bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with months as (
    select
      to_char(m, 'YYYY-MM') as month,
      (m at time zone 'Asia/Dhaka') as starts,
      ((m + interval '1 month') at time zone 'Asia/Dhaka') as ends
    from generate_series(
      date_trunc('month', (now() at time zone 'Asia/Dhaka')) - make_interval(months => months_back - 1),
      date_trunc('month', (now() at time zone 'Asia/Dhaka')),
      interval '1 month'
    ) as m
  )
  select
    mo.month,
    coalesce((select sum(p.amount) from payments p where p.status in ('verified', 'refunded') and p.reviewed_at >= mo.starts and p.reviewed_at < mo.ends), 0)::bigint as revenue,
    coalesce((select sum(p.amount) from payments p where p.status = 'refunded' and p.refunded_at >= mo.starts and p.refunded_at < mo.ends), 0)::bigint as refunds,
    coalesce((
      select jsonb_object_agg(x.plan_id, x.amount)
      from (select p.plan_id, sum(p.amount) as amount from payments p where p.status in ('verified', 'refunded') and p.reviewed_at >= mo.starts and p.reviewed_at < mo.ends group by p.plan_id) x
    ), '{}'::jsonb) as revenue_by_plan,
    (select count(*) from subscriptions s where s.started_at >= mo.starts and s.started_at < mo.ends)::bigint as new_subscriptions,
    (select count(*) from profiles u where u.joined_at < mo.ends)::bigint as total_users,
    (select count(*) from profiles u where u.joined_at < mo.ends and u.last_active_at >= mo.starts)::bigint as active_users
  from months mo
  order by mo.month;
$$;

-- Payments submitted in one month (default: this one), tallied by status, and verified taka by method and plan.
create or replace function public.payments_month_figures(month text default null)
returns table (
  status public.payment_status,
  method public.payment_method,
  plan_id text,
  count bigint,
  amount bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.status, p.method, p.plan_id, count(*)::bigint, coalesce(sum(p.amount), 0)::bigint
  from payments p
  where public.dhaka_month(p.submitted_at) = coalesce(month, public.dhaka_month(now()))
  group by p.status, p.method, p.plan_id;
$$;

-- Readers on each plan right now, and how many of them pay yearly.
create or replace function public.plan_subscriber_counts()
returns table (plan_id text, subscribers bigint, yearly_subscribers bigint)
language sql
stable
security definer
set search_path = public
as $$
  select u.plan_id, count(*)::bigint, count(*) filter (where u.cycle = 'yearly')::bigint
  from profiles u
  where u.active
  group by u.plan_id;
$$;

-- Readers at the end of last month, for the Users page's trends: total, active (seen in the last 30 days), new.
create or replace function public.user_figures()
returns table (
  total bigint,
  active bigint,
  joined_this_month bigint,
  prev_total bigint,
  prev_active bigint,
  joined_last_month bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select
      (date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka') as this_start,
      ((date_trunc('month', now() at time zone 'Asia/Dhaka') - interval '1 month') at time zone 'Asia/Dhaka') as last_start
  )
  select
    (select count(*) from profiles)::bigint,
    (select count(*) from profiles where active and last_active_at >= now() - interval '30 days')::bigint,
    (select count(*) from profiles, b where joined_at >= b.this_start)::bigint,
    (select count(*) from profiles, b where joined_at < b.this_start)::bigint,
    (select count(*) from profiles, b where joined_at < b.this_start and last_active_at >= b.this_start - interval '30 days' and last_active_at < b.this_start)::bigint,
    (select count(*) from profiles, b where joined_at >= b.last_start and joined_at < b.this_start)::bigint;
$$;

-- Active paid subscriptions now and at the end of last month, plus automatic renewals due this month and last.
create or replace function public.subscription_figures()
returns table (active bigint, prev_active bigint, renewals bigint, prev_renewals bigint)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select
      (date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka') as this_start,
      ((date_trunc('month', now() at time zone 'Asia/Dhaka') - interval '1 month') at time zone 'Asia/Dhaka') as last_start,
      ((date_trunc('month', now() at time zone 'Asia/Dhaka') + interval '1 month') at time zone 'Asia/Dhaka') as next_start
  )
  select
    (select count(*) from subscriptions where status = 'active')::bigint,
    (select count(*) from subscriptions, b where started_at < b.this_start and (canceled_at is null or canceled_at >= b.this_start))::bigint,
    (select count(*) from subscriptions, b where auto_renew and status = 'active' and renews_at >= b.this_start and renews_at < b.next_start)::bigint,
    (select count(*) from subscriptions, b where auto_renew and renews_at >= b.last_start and renews_at < b.this_start)::bigint;
$$;

-- Open tickets at the end of last month, for the dashboard's trend.
create or replace function public.tickets_open_last_month()
returns table (open bigint, attention bigint)
language sql
stable
security definer
set search_path = public
as $$
  with b as (select (date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka') as this_start)
  select
    (select count(*) from tickets t, b where t.created_at < b.this_start and (t.resolved_at is null or t.resolved_at >= b.this_start))::bigint,
    (select count(*) from tickets t, b where t.created_at < b.this_start and (t.resolved_at is null or t.resolved_at >= b.this_start) and t.priority in ('high', 'urgent'))::bigint;
$$;

-- Who did how much in the audit log since a moment, for the page's "busiest this week" and per-member bars.
create or replace function public.audit_actor_counts(since timestamptz)
returns table (actor_id uuid, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select a.actor_id, count(*)::bigint from audit_logs a where a.at >= since group by a.actor_id order by count(*) desc;
$$;

-- Database size and the connection pool, for System health.
create or replace function public.database_stats()
returns table (size_bytes bigint, connections integer, max_connections integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    pg_database_size(current_database())::bigint,
    (select count(*) from pg_stat_activity)::integer,
    (select setting::integer from pg_settings where name = 'max_connections');
$$;

revoke all on function public.dashboard_series(integer) from public, anon, authenticated;
revoke all on function public.payments_month_figures(text) from public, anon, authenticated;
revoke all on function public.plan_subscriber_counts() from public, anon, authenticated;
revoke all on function public.user_figures() from public, anon, authenticated;
revoke all on function public.subscription_figures() from public, anon, authenticated;
revoke all on function public.tickets_open_last_month() from public, anon, authenticated;
revoke all on function public.audit_actor_counts(timestamptz) from public, anon, authenticated;
revoke all on function public.database_stats() from public, anon, authenticated;
