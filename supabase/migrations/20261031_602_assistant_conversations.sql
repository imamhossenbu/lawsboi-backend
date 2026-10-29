-- Assistant chats: a follow-up question belongs to the same conversation as the one before it, a reader can save
-- a chat, and deleting one erases what was asked and answered but keeps the row, because the month's allowance
-- counts every question asked (deleting history mustn't hand questions back).

alter table public.assistant_questions
  add column if not exists conversation_id uuid,
  add column if not exists saved boolean not null default false,
  add column if not exists deleted_at timestamptz;

-- Questions asked before conversations existed are each their own chat
update public.assistant_questions set conversation_id = id where conversation_id is null;
alter table public.assistant_questions alter column conversation_id set not null;
alter table public.assistant_questions alter column conversation_id set default gen_random_uuid();

create index if not exists assistant_questions_conversation_idx on public.assistant_questions (conversation_id, created_at);
create index if not exists assistant_questions_user_live_idx on public.assistant_questions (user_id, created_at desc) where deleted_at is null;
