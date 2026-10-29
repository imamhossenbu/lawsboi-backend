-- The vote recount's variable was named like the article's slug column, which Postgres rightly called ambiguous.

create or replace function public.recount_article_votes()
returns trigger
language plpgsql
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
