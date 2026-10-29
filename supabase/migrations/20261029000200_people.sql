-- Readers (profiles) and the admin panel's team. Both sign in through Supabase Auth; which table a user lands in
-- is decided by the "kind" the API puts in their metadata when it creates them.

create table public.plans (
  id text primary key,
  name text not null,
  name_bn text not null,
  description text not null default '',
  description_bn text not null default '',
  -- Taka per cycle; price_yearly is null when the plan is only sold monthly. Both 0 for a free plan.
  price_monthly integer not null default 0 check (price_monthly >= 0),
  price_yearly integer check (price_yearly is null or price_yearly >= 0),
  -- [{ "en": "...", "bn": "..." }, ...], in display order
  features jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  -- New readers start on the default plan
  is_default boolean not null default false,
  icon text not null default 'layers',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index plans_one_default on public.plans (is_default) where is_default;
create trigger plans_updated_at before update on public.plans for each row execute function public.set_updated_at();

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- The number readers and the team see: "USR-10047"
  reader_no bigint generated always as identity (start with 10047) unique,
  public_id text generated always as ('USR-' || reader_no::text) stored unique,
  name text not null,
  name_bn text,
  email citext not null unique,
  lang public.lang not null default 'en',
  phone text not null default '',
  profession text not null default 'researcher',
  organization text not null default '',
  location text not null default '',
  photo_url text,
  plan_id text not null default 'free' references public.plans (id),
  -- How a paid plan is billed; null on the free plan
  cycle public.billing_cycle,
  active boolean not null default true,
  -- The reader's own settings from the settings pages, kept as the site shapes them
  preferences jsonb not null default '{}'::jsonb,
  notifications jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_plan_idx on public.profiles (plan_id);
create index profiles_joined_idx on public.profiles (joined_at desc);
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create table public.team_members (
  id uuid primary key references auth.users (id) on delete cascade,
  member_no bigint generated always as identity unique,
  public_id text generated always as ('AGT-' || lpad(member_no::text, 2, '0')) stored unique,
  name text not null,
  name_bn text,
  email citext not null unique,
  role public.team_role not null default 'support',
  -- "payments.refund", "support.reply"…: the role's preset, then changed per person by an admin
  permissions text[] not null default '{}',
  active boolean not null default true,
  phone text not null default '',
  photo_url text,
  -- The sign-off under their support replies, per language
  signature text not null default '',
  signature_bn text not null default '',
  invited_by uuid references public.team_members (id) on delete set null,
  -- Set while their invitation stands; cleared on their first sign-in
  invited_at timestamptz,
  accepted_at timestamptz,
  -- Signed in with the temporary password from the invitation; the panel asks for a new one
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger team_members_updated_at before update on public.team_members for each row execute function public.set_updated_at();

-- A new Auth user becomes a reader profile unless the API marked them as team (it inserts the team row itself).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- One-time codes the API emails for sign-up and password resets. Only a hash is kept.
create table public.email_otps (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  purpose public.otp_purpose not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_otps_lookup on public.email_otps (email, purpose, created_at desc);

-- Row level security: readers reach their own profile with their own token; everything else is the API's.
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.team_members enable row level security;
alter table public.email_otps enable row level security;

create policy "plans are public while on sale" on public.plans
  for select using (active);
create policy "readers see their own profile" on public.profiles
  for select using (public.is_owner(id));
create policy "readers edit their own profile" on public.profiles
  for update using (public.is_owner(id)) with check (public.is_owner(id));
