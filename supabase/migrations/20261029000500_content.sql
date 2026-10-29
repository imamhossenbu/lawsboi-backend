-- What the content team edits: announcements, the help centre, FAQs, site pages, feature flags and site settings.

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  public_id text generated always as ('ANN-' || lpad(number::text, 4, '0')) stored unique,
  title text not null,
  title_bn text not null,
  body text not null,
  body_bn text not null,
  topic public.notification_topic not null,
  -- Plans it goes to; empty means every reader
  plan_ids text[] not null default '{}',
  channels public.announcement_channel[] not null default '{in_app}',
  -- A reader page its "Open" button goes to
  link text,
  status public.announcement_status not null default 'draft',
  -- When it went or goes out (scheduled), or when it was last saved (draft)
  at timestamptz not null default now(),
  -- The banner comes down at this time; without it, it stays until ended by hand
  banner_until timestamptz,
  banner_ended boolean not null default false,
  -- { "reached": { "in_app": 120 }, "opened": { "in_app": 40 } }
  delivery jsonb,
  created_by uuid references public.team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index announcements_status_idx on public.announcements (status, at desc);
create trigger announcements_updated_at before update on public.announcements for each row execute function public.set_updated_at();

-- What each reader has seen in their bell
create table public.announcement_reads (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create table public.help_articles (
  slug text primary key,
  title text not null,
  title_bn text not null,
  summary text not null default '',
  summary_bn text not null default '',
  -- [{ "en": "...", "bn": "..." }, ...]
  steps jsonb not null default '[]'::jsonb,
  -- The reader dashboard page its "Try it" button opens
  try_href text not null default '/dashboard',
  icon text not null default 'file',
  status public.content_status not null default 'draft',
  sort_order integer not null default 0,
  reads integer not null default 0,
  helpful_yes integer not null default 0,
  helpful_no integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger help_articles_updated_at before update on public.help_articles for each row execute function public.set_updated_at();

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  -- Where it shows on the reader site: the help centre, the pricing page or the contact page
  place text not null check (place in ('help', 'pricing', 'contact')),
  -- Only the help centre groups its questions by topic
  topic text check (topic is null or topic in ('account', 'billing', 'content', 'ai', 'saved')),
  question text not null,
  question_bn text not null,
  answer text not null,
  answer_bn text not null,
  status public.content_status not null default 'draft',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index faqs_place_idx on public.faqs (place, sort_order);
create trigger faqs_updated_at before update on public.faqs for each row execute function public.set_updated_at();

create table public.site_pages (
  slug text primary key check (slug in ('privacy', 'disclaimer', 'about')),
  path text not null,
  -- The about page's bands are fixed by its layout: editable, but not added, moved or removed
  fixed boolean not null default false,
  -- The page's sections as the admin panel shapes them, each field in both languages
  sections jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create trigger site_pages_updated_at before update on public.site_pages for each row execute function public.set_updated_at();

create table public.feature_flags (
  id text primary key,
  "group" text not null check ("group" in ('research', 'ai', 'library', 'account')),
  -- The master switch: off means nobody gets it, whatever the plans say
  enabled boolean not null default true,
  -- { "free": "none" | "limited" | "full", "researcher": ..., "professional": ... }
  access jsonb not null default '{}'::jsonb,
  -- For counted features: how many a "limited" plan gets; null is unlimited
  allowance jsonb,
  per text check (per is null or per in ('month', 'total')),
  -- Still being built: shown to this share of the readers whose plan includes it
  rollout integer check (rollout is null or (rollout between 0 and 100)),
  pages text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create trigger feature_flags_updated_at before update on public.feature_flags for each row execute function public.set_updated_at();

create table public.feature_flag_events (
  id uuid primary key default gen_random_uuid(),
  flag_id text not null references public.feature_flags (id) on delete cascade,
  actor_id uuid references public.team_members (id) on delete set null,
  -- { "kind": "on" } | { "kind": "plans", "access": {...} } | ...
  change jsonb not null,
  created_at timestamptz not null default now()
);
create index feature_flag_events_flag_idx on public.feature_flag_events (flag_id, created_at);

-- Odds and ends the panel edits as one object each: contact details, the assistant's limits…
create table public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.team_members (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger site_settings_updated_at before update on public.site_settings for each row execute function public.set_updated_at();

alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.help_articles enable row level security;
alter table public.faqs enable row level security;
alter table public.site_pages enable row level security;
alter table public.feature_flags enable row level security;
alter table public.feature_flag_events enable row level security;
alter table public.site_settings enable row level security;

create policy "sent announcements are readable" on public.announcements
  for select using (status = 'sent');
create policy "readers mark their own reads" on public.announcement_reads
  for all using (public.is_owner(user_id)) with check (public.is_owner(user_id));
create policy "published articles are public" on public.help_articles
  for select using (status = 'published');
create policy "published faqs are public" on public.faqs
  for select using (status = 'published');
create policy "site pages are public" on public.site_pages
  for select using (true);
create policy "flags are public" on public.feature_flags
  for select using (true);
create policy "public settings are readable" on public.site_settings
  for select using (key in ('contact'));
