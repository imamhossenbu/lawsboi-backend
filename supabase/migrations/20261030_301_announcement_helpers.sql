-- The readers an announcement goes to, and what its deliveries add up to. Used by the sender, the reach estimate
-- on the compose page and the delivery figures on the list.

-- Active readers on the plans (all plans when the list is empty) whose settings let the topic through on the
-- channel. The banner shows to everyone on the plans.
create or replace function public.announcement_recipients(plan_ids text[], topic text, channel text)
returns table (id uuid, email citext, name text, lang public.lang, plan_id text)
language sql
stable
as $$
  select p.id, p.email, p.name, p.lang, p.plan_id
  from public.profiles p
  where p.active
    and (cardinality(plan_ids) = 0 or p.plan_id = any (plan_ids))
    and (channel = 'banner' or public.notification_on(p.notifications, topic, channel));
$$;

create or replace view public.announcement_delivery_stats
with (security_invoker = true)
as
  select announcement_id, channel, count(*)::integer as reached, count(opened_at)::integer as opened
  from public.announcement_deliveries
  group by announcement_id, channel;
