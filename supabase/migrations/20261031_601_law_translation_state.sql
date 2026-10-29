-- How much of each law is translated, kept on the law itself so the panel can filter and count without reading
-- every section: sections_total, sections_translated and translation_state (none | partial | full).

alter table public.laws
  add column if not exists sections_total integer not null default 0,
  add column if not exists sections_translated integer not null default 0,
  add column if not exists translation_state text not null default 'none' check (translation_state in ('none', 'partial', 'full'));

create or replace function public.refresh_law_translation(target text)
returns void
language sql
as $$
  update public.laws l
  set sections_total = c.total,
      sections_translated = c.translated,
      translation_state = case when c.translated = 0 then 'none' when c.translated >= c.total then 'full' else 'partial' end
  from (
    select count(*)::int as total, count(*) filter (where s.translation is not null)::int as translated
    from public.law_sections s
    where s.law_slug = target
  ) c
  where l.slug = target;
$$;

create or replace function public.law_sections_translation_changed()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_law_translation(new.law_slug);
  end if;
  if tg_op in ('DELETE', 'UPDATE') and (tg_op = 'DELETE' or old.law_slug <> new.law_slug) then
    perform public.refresh_law_translation(old.law_slug);
  end if;
  return null;
end;
$$;

drop trigger if exists law_sections_translation on public.law_sections;
create trigger law_sections_translation
  after insert or delete or update of translation, law_slug on public.law_sections
  for each row execute function public.law_sections_translation_changed();

-- Fill it once for what's already there
update public.laws l
set sections_total = c.total,
    sections_translated = c.translated,
    translation_state = case when c.translated = 0 then 'none' when c.translated >= c.total then 'full' else 'partial' end
from (
  select law_slug, count(*)::int as total, count(*) filter (where translation is not null)::int as translated
  from public.law_sections
  group by law_slug
) c
where l.slug = c.law_slug;

create index if not exists laws_translation_state_idx on public.laws (translation_state);

-- The Laws page's cards in one round trip
create or replace function public.catalogue_admin_stats()
returns table (laws bigint, bangla bigint, drafts bigint, sections bigint, translated bigint, cases bigint, cases_draft bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.laws),
    (select count(*) from public.laws where language = 'bn'),
    (select count(*) from public.laws where not published),
    (select coalesce(sum(sections_total), 0) from public.laws),
    (select coalesce(sum(sections_translated), 0) from public.laws),
    (select count(*) from public.judgments),
    (select count(*) from public.judgments where not published);
$$;
revoke all on function public.catalogue_admin_stats() from public, anon, authenticated;
