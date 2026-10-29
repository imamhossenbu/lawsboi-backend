-- Support tickets: the conversation between a reader and the team, internal notes, attachments and history.

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  -- What everyone calls it: "TKT-001245"
  public_id text generated always as ('TKT-' || lpad(number::text, 6, '0')) stored unique,
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null,
  -- The language the reader wrote in, so replies and emails match
  lang public.lang not null default 'en',
  category public.ticket_category not null default 'other',
  priority public.ticket_priority not null default 'medium',
  status public.ticket_status not null default 'open',
  assignee_id uuid references public.team_members (id) on delete set null,
  -- Set when the ticket is resolved or closed; cleared when it is reopened
  resolved_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tickets_user_idx on public.tickets (user_id, created_at desc);
create index tickets_status_idx on public.tickets (status, updated_at desc);
create index tickets_assignee_idx on public.tickets (assignee_id) where assignee_id is not null;
create trigger tickets_updated_at before update on public.tickets for each row execute function public.set_updated_at();

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  kind public.message_kind not null,
  -- The reader (profiles.id) or the team member (team_members.id) who wrote it
  author_kind public.actor_kind not null,
  author_id uuid,
  body text not null,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

create table public.ticket_files (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  message_id uuid not null references public.ticket_messages (id) on delete cascade,
  name text not null,
  size integer not null check (size >= 0),
  mime text not null,
  -- Where it lives in the private "ticket-files" bucket
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index ticket_files_message_idx on public.ticket_files (message_id);

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  kind public.ticket_event_kind not null,
  actor_kind public.actor_kind not null,
  actor_id uuid,
  -- Before and after, for changes: status keys, team member ids…
  from_value text,
  to_value text,
  created_at timestamptz not null default now()
);
create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);

-- A new message bumps the ticket, so lists sort by activity without the API remembering to.
create or replace function public.touch_ticket_on_message()
returns trigger
language plpgsql
as $$
begin
  update public.tickets
  set last_message_at = new.created_at, updated_at = new.created_at
  where id = new.ticket_id;
  return new;
end;
$$;
create trigger ticket_messages_touch after insert on public.ticket_messages
  for each row execute function public.touch_ticket_on_message();

-- Attachments live in a private bucket; the API hands out short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-files', 'ticket-files', false, 2097152, array['image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do nothing;

alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_files enable row level security;
alter table public.ticket_events enable row level security;

-- Readers follow their own tickets live (Realtime honours these policies); internal notes never reach them.
create policy "readers see their own tickets" on public.tickets
  for select using (public.is_owner(user_id));
create policy "readers see their tickets' conversation" on public.ticket_messages
  for select using (
    kind <> 'note'
    and exists (select 1 from public.tickets t where t.id = ticket_id and public.is_owner(t.user_id))
  );
create policy "readers see their tickets' files" on public.ticket_files
  for select using (
    exists (
      select 1 from public.ticket_messages m
      join public.tickets t on t.id = m.ticket_id
      where m.id = message_id and m.kind <> 'note' and public.is_owner(t.user_id)
    )
  );
create policy "readers see their tickets' history" on public.ticket_events
  for select using (
    kind <> 'note'
    and exists (select 1 from public.tickets t where t.id = ticket_id and public.is_owner(t.user_id))
  );

alter publication supabase_realtime add table public.tickets;
alter publication supabase_realtime add table public.ticket_messages;
