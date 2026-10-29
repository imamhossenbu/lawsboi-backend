-- Deleting an account runs as Supabase Auth's own role, which cascades through profiles into
-- help_article_votes. That role may not update help_articles, so the recount trigger failed and the deletion
-- with it. The trigger now runs as its owner, with a fixed search path.

create or replace function public.recount_article_votes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  the_slug text := coalesce(new.article_slug, old.article_slug);
begin
  update public.help_articles a
  set helpful_yes = (select count(*) from public.help_article_votes v where v.article_slug = the_slug and v.helpful),
      helpful_no = (select count(*) from public.help_article_votes v where v.article_slug = the_slug and not v.helpful)
  where a.slug = the_slug;
  return null;
end;
$$;

revoke execute on function public.recount_article_votes() from public, anon, authenticated;
