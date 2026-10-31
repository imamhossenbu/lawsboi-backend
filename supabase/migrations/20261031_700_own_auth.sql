-- Supabase is only the database from here on: sign-ins move from Supabase Auth to the API's own accounts and
-- sessions tables (bcrypt passwords, JWT access tokens, rotating refresh tokens), and files move to Cloudflare R2.
--
-- Everyone already in auth.users is copied over with their bcrypt hash, so existing passwords keep working.
-- auth.users itself is left alone; nothing reads it any more.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  -- bcrypt ($2a$/$2b$), the same format Supabase Auth used
  password_hash text not null,
  -- Null until the sign-up code is confirmed; an unconfirmed account can't sign in
  email_confirmed_at timestamptz,
  -- Set when a reader or team member is deactivated: no sign-in, no refresh
  disabled boolean not null default false,
  -- { "kind": "reader" | "team", "name": "...", "lang": "en" | "bn" }, as Supabase's user metadata was
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger accounts_updated_at before update on public.accounts for each row execute function public.set_updated_at();

-- One row per signed-in device. The refresh token is kept only as a SHA-256 hash and rotates on every use; the
-- access token carries the session id, so ending a session ends its access token too.
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  refresh_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index sessions_account_idx on public.sessions (account_id);
create index sessions_expires_idx on public.sessions (expires_at);

alter table public.accounts enable row level security;
alter table public.sessions enable row level security;
-- No policies: only the API (secret key) reads or writes these.

-- Everyone who can sign in today
insert into public.accounts (id, email, password_hash, email_confirmed_at, disabled, meta, created_at)
select
  u.id,
  u.email,
  coalesce(u.encrypted_password, ''),
  u.email_confirmed_at,
  coalesce(u.banned_until > now(), false),
  coalesce(u.raw_user_meta_data, '{}'::jsonb),
  u.created_at
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- Readers and the team now hang off accounts instead of auth.users
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles add constraint profiles_id_fkey foreign key (id) references public.accounts (id) on delete cascade;
alter table public.team_members drop constraint if exists team_members_id_fkey;
alter table public.team_members add constraint team_members_id_fkey foreign key (id) references public.accounts (id) on delete cascade;

-- The profile is made when the account is, as before
drop trigger if exists on_auth_user_created on auth.users;

create or replace function public.handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.meta, '{}'::jsonb);
begin
  if meta ->> 'kind' = 'team' then
    return new;
  end if;
  insert into public.profiles (id, name, email, lang, plan_id)
  values (
    new.id,
    coalesce(nullif(meta ->> 'name', ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce((meta ->> 'lang')::public.lang, 'en'),
    coalesce((select id from public.plans where is_default limit 1), 'free')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_account_created
  after insert on public.accounts
  for each row execute function public.handle_new_account();
