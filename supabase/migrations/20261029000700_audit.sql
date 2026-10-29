-- Who on the team did what, and when. Written by the API as each action happens; never edited.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id uuid references public.team_members (id) on delete set null,
  -- "ticket.reply", "payment.refund"… as the admin panel names them
  action text not null,
  target_type text not null,
  target_id text not null,
  -- How the item reads in each language: { "en": "...", "bn": "..." }
  target_label jsonb not null default '{}'::jsonb,
  -- [{ "field": "status", "from": "open", "to": "progress" }, ...]
  changes jsonb not null default '[]'::jsonb,
  -- Money, access and data leaving the panel
  sensitive boolean not null default false,
  ip inet,
  user_agent text
);
create index audit_logs_at_idx on public.audit_logs (at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, at desc);
create index audit_logs_target_idx on public.audit_logs (target_type, target_id);

alter table public.audit_logs enable row level security;
-- No policies: only the API's service role reads or writes the log.
