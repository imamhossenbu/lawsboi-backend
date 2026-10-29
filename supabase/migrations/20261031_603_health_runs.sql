-- Every health check the API runs (every five minutes, and whenever the System health page asks), so the page can
-- chart response times and list incidents instead of only showing this moment. Kept for thirty days.

create table if not exists public.health_runs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  -- up | degraded | down: the worst of the checks
  overall text not null check (overall in ('up', 'degraded', 'down')),
  -- { "database": { "status": "up", "ms": 120 }, "storage": {...}, "mail": {...}, "site": {...} }
  checks jsonb not null,
  -- "schedule" or "page"
  source text not null default 'schedule'
);
create index if not exists health_runs_at_idx on public.health_runs (at desc);

alter table public.health_runs enable row level security;
-- No policies: only the API reads or writes it.
