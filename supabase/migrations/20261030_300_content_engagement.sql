-- What readers do with content: help-article reads and votes, and announcement deliveries per reader (so "reached"
-- and "opened" are counts, not estimates). Also the reader-settings helper the sender and the reach estimate share.

-- Reads of a help article, signed in or not; the admin page counts the last 30 days
create table public.help_article_reads (
  id uuid primary key default gen_random_uuid(),
  article_slug text not null references public.help_articles (slug) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  read_at timestamptz not null default now()
);
create index help_article_reads_slug_idx on public.help_article_reads (article_slug, read_at desc);

-- "Was this helpful?": one vote per reader per article, changeable
create table public.help_article_votes (
  article_slug text not null references public.help_articles (slug) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (article_slug, user_id)
);
create trigger help_article_votes_updated_at before update on public.help_article_votes for each row execute function public.set_updated_at();

-- The counters on the article stay in step with the votes
create or replace function public.recount_article_votes()
returns trigger
language plpgsql
as $$
declare
  slug text := coalesce(new.article_slug, old.article_slug);
begin
  update public.help_articles a
  set helpful_yes = (select count(*) from public.help_article_votes v where v.article_slug = slug and v.helpful),
      helpful_no = (select count(*) from public.help_article_votes v where v.article_slug = slug and not v.helpful)
  where a.slug = slug;
  return null;
end;
$$;
create trigger help_article_votes_recount after insert or update or delete on public.help_article_votes
  for each row execute function public.recount_article_votes();

-- One row per reader per channel an announcement went out on. opened_at: the bell item was opened, the email's
-- link was followed, or the banner was clicked.
drop table if exists public.announcement_reads;
create table public.announcement_deliveries (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel public.announcement_channel not null,
  delivered_at timestamptz not null default now(),
  opened_at timestamptz,
  primary key (announcement_id, user_id, channel)
);
create index announcement_deliveries_user_idx on public.announcement_deliveries (user_id, channel, delivered_at desc);

alter table public.announcements
  add column sent_at timestamptz,
  -- Set while the scheduler is sending, so two API instances don't send twice
  add column sending_started_at timestamptz;

-- What the reader site does with a flagged feature today, read from its code (the admin page shows it)
alter table public.feature_flags add column reader_today text not null default 'notBuilt'
  check (reader_today in ('enforced', 'shown', 'open', 'notBuilt'));

-- Whether a reader's settings let a topic through on a channel. Mirrors the reader site's defaults: everything on
-- in the app; email on for legal, cases and billing (billing email can't be turned off).
create or replace function public.notification_on(settings jsonb, topic text, channel text)
returns boolean
language sql
immutable
as $$
  select
    case
      when channel = 'email' and topic = 'billing' then true
      when coalesce((settings -> 'channels' ->> (case channel when 'in_app' then 'inApp' else channel end))::boolean, true) = false then false
      else coalesce(
        (settings -> 'topics' -> topic ->> (case channel when 'in_app' then 'inApp' else channel end))::boolean,
        channel = 'in_app' or topic in ('legal', 'cases', 'billing')
      )
    end;
$$;

alter table public.help_article_reads enable row level security;
alter table public.help_article_votes enable row level security;
alter table public.announcement_deliveries enable row level security;

create policy "readers see their own votes" on public.help_article_votes
  for select using (public.is_owner(user_id));
create policy "readers see their own deliveries" on public.announcement_deliveries
  for select using (public.is_owner(user_id));
-- The sent announcement itself is readable through the existing "sent announcements are readable" policy.
