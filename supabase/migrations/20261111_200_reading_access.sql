-- What each viewer opened, for the free plan's monthly allowance (sections and judgments) and the paid plans'
-- daily ceiling. A row is kept per account, per device (the reader site's device cookie) and per address, so one
-- device can't read past the allowance by signing in with one free account after another, or by signing out.

create table public.reading_access (
  id bigint generated always as identity primary key,
  -- "section" (a section or an Order) or "judgment"; whole-act text is for paid plans and isn't counted
  kind text not null check (kind in ('section', 'judgment')),
  -- "<law slug>#<n>", "<law slug>#O<n>" or the judgment's slug
  item text not null,
  user_id uuid references public.accounts (id) on delete cascade,
  device text,
  ip text,
  at timestamptz not null default now()
);
create index reading_access_user_idx on public.reading_access (user_id, at desc) where user_id is not null;
create index reading_access_device_idx on public.reading_access (device, at desc) where device is not null;
create index reading_access_ip_idx on public.reading_access (ip, at desc) where ip is not null;

alter table public.reading_access enable row level security;
-- No policies: only the API reads or writes it.
