-- November 2026: support tickets become a chat (replies, edits, unsending, seen marks); messages from the contact
-- page reach the team; daily legal news; bKash/Nagad SMS forwarded to verify payments; personal notifications for
-- readers (ticket replies, payments, news) beside the announcements in the bell.

/* ------------------------------------------------------------ ticket chat */

alter table public.ticket_messages
  add column reply_to uuid references public.ticket_messages (id) on delete set null,
  add column edited_at timestamptz,
  -- Unsent: the text and files are gone, the row stays so the thread keeps its shape
  add column deleted_at timestamptz;

alter table public.tickets
  -- When each side last opened the conversation: what came before it shows as seen
  add column reader_seen_at timestamptz,
  add column team_seen_at timestamptz;

/* -------------------------------------------------------- contact messages */

create type public.contact_status as enum ('new', 'read', 'replied', 'archived');

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  public_id text generated always as ('MSG-' || lpad(number::text, 6, '0')) stored unique,
  name text not null,
  email text not null,
  phone text not null default '',
  topic text not null default 'general',
  subject text not null default '',
  message text not null,
  lang public.lang not null default 'en',
  -- The reader, when they were signed in
  user_id uuid references public.profiles (id) on delete set null,
  status public.contact_status not null default 'new',
  reply text,
  replied_at timestamptz,
  replied_by uuid references public.team_members (id) on delete set null,
  read_at timestamptz,
  ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contact_messages_status_idx on public.contact_messages (status, created_at desc);
create trigger contact_messages_updated_at before update on public.contact_messages for each row execute function public.set_updated_at();
alter table public.contact_messages enable row level security;

/* -------------------------------------------------------------------- news */

create table public.news_posts (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  public_id text generated always as ('NWS-' || lpad(number::text, 5, '0')) stored unique,
  slug text not null unique,
  title text not null,
  title_bn text not null default '',
  summary text not null default '',
  summary_bn text not null default '',
  body text not null default '',
  body_bn text not null default '',
  -- legislation, judgment, gazette, court, notice, other
  category text not null default 'legislation',
  cover_url text,
  source_name text,
  source_url text,
  -- Kept at the top of the news page and the home strip
  pinned boolean not null default false,
  status public.content_status not null default 'draft',
  published_at timestamptz,
  author_id uuid references public.team_members (id) on delete set null,
  views integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index news_posts_published_idx on public.news_posts (status, published_at desc);
create trigger news_posts_updated_at before update on public.news_posts for each row execute function public.set_updated_at();
alter table public.news_posts enable row level security;

/* ------------------------------------------------------- payment SMS inbox */

create type public.sms_status as enum ('matched', 'unmatched', 'ignored', 'duplicate');

create table public.payment_sms (
  id uuid primary key default gen_random_uuid(),
  -- "webhook" (an SMS forwarder app) or "telegram" (forwarded into the bot's chat)
  source text not null,
  sender text not null default '',
  body text not null,
  method public.payment_method,
  amount numeric(12, 2),
  trx_id text,
  from_number text,
  status public.sms_status not null default 'unmatched',
  payment_id uuid references public.payments (id) on delete set null,
  note text,
  received_at timestamptz not null default now()
);
create index payment_sms_trx_idx on public.payment_sms (trx_id);
create index payment_sms_received_idx on public.payment_sms (received_at desc);
alter table public.payment_sms enable row level security;

/* ---------------------------------------------------- reader notifications */

create table public.reader_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- ticket_reply, payment_verified, payment_rejected, news
  kind text not null,
  title text not null,
  title_bn text not null,
  body text not null default '',
  body_bn text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index reader_notifications_user_idx on public.reader_notifications (user_id, created_at desc);
alter table public.reader_notifications enable row level security;
