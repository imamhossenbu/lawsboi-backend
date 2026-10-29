-- Alphabetical listing ignores a leading "The", as the reader's A–Z index does.
alter table public.laws add column sort_title text
  generated always as (lower(regexp_replace(title, '^\s*the\s+', '', 'i'))) stored;
create index laws_sort_title_idx on public.laws (sort_title);
create index laws_views_idx on public.laws (views desc);
create index laws_published_idx on public.laws (published);
create index judgments_decided_idx on public.judgments (decided_on desc, slug);
create index judgment_laws_law_kind_idx on public.judgment_laws (law_slug, kind, n);
