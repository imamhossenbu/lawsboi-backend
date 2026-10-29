-- Shared pieces every later migration relies on: extensions, enums and the updated_at trigger.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- Languages the product speaks. Text readers see is stored once per language where it is editorial
-- (plans, help articles…) and in the language it was written where it is a person's own words (tickets).
create type public.lang as enum ('en', 'bn');

create type public.billing_cycle as enum ('monthly', 'yearly');
create type public.subscription_status as enum ('active', 'past_due', 'canceled');
create type public.payment_method as enum ('bkash', 'nagad');
create type public.payment_status as enum ('verified', 'awaiting', 'rejected', 'refunded');
create type public.reject_reason as enum ('not_found', 'amount', 'duplicate');

create type public.team_role as enum ('admin', 'editor', 'support');

create type public.ticket_category as enum ('account', 'billing', 'content', 'ai', 'technical', 'other');
create type public.ticket_priority as enum ('low', 'medium', 'high', 'urgent');
-- The reader only ever sees open or closed; resolved and closed both read as closed on their side.
create type public.ticket_status as enum ('open', 'progress', 'waiting', 'resolved', 'closed');
-- Who wrote a message: the reader, a team reply (emailed to the reader) or an internal note (team only).
create type public.message_kind as enum ('reader', 'reply', 'note');
create type public.actor_kind as enum ('reader', 'team', 'system');
create type public.ticket_event_kind as enum ('created', 'assigned', 'unassigned', 'status', 'priority', 'category', 'reply', 'note');

create type public.otp_purpose as enum ('signup', 'reset');

create type public.content_status as enum ('draft', 'published');
create type public.announcement_status as enum ('draft', 'scheduled', 'sent');
create type public.announcement_channel as enum ('in_app', 'email', 'banner');
create type public.notification_topic as enum ('legal', 'cases', 'saved', 'ai', 'billing', 'product');

-- Keeps updated_at honest on every table that has one.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- True for the signed-in reader's own row. Team members and the API's service role never go through RLS.
create or replace function public.is_owner(owner uuid)
returns boolean
language sql
stable
as $$
  select auth.uid() = owner;
$$;
