-- Every call the API makes to the language model: who asked, for what, which model answered, the tokens it cost
-- and whether it worked. The team's AI use is audited here rather than in audit_logs, which records changes.

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  -- "assistant.answer", "assistant.preview", "admin.translate", "admin.laws.read"…
  purpose text not null,
  -- A reader for the assistant, a team member for the panel; both null for signed-out previews
  user_id uuid references public.profiles (id) on delete set null,
  member_id uuid references public.team_members (id) on delete set null,
  model text,
  ok boolean not null,
  -- not_configured | unavailable | invalid | blocked, when it didn't work
  error text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  ms integer not null default 0
);
create index if not exists ai_usage_at_idx on public.ai_usage (at desc);
create index if not exists ai_usage_purpose_idx on public.ai_usage (purpose, at desc);
create index if not exists ai_usage_member_idx on public.ai_usage (member_id, at desc) where member_id is not null;

alter table public.ai_usage enable row level security;
-- No policies: only the API reads or writes it.
