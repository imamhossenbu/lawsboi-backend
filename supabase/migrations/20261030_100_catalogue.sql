-- The catalogue as the reader site holds it: bilingual metadata for the hand-curated laws, the CPC's Orders and
-- Rules, section translations and cross-references, judgment details, read counts, a revision history for the
-- admin panel, and Postgres full-text search over every provision so searching never loads the texts into Node.

/* ------------------------------------------------------------------ laws */

alter table public.laws
  add column description_bn text,
  add column act_no_bn text,
  -- Hand-written on the reader site: featured on the home page, with Bangla titles
  add column curated boolean not null default false,
  -- Total reads, for the "most viewed" sort; seeded from the reader's figures, then counted by catalogue_reads
  add column views bigint not null default 0;

alter table public.law_parts
  add column updated_at timestamptz not null default now();
create trigger law_parts_updated_at before update on public.law_parts for each row execute function public.set_updated_at();

alter table public.law_sections
  -- The heading in the other language, when translated (the translation's "t")
  add column title_tr text,
  add column explanation text,
  -- Editorial cross-references, shown in the "Related sections" rail: section numbers of the same law
  add column related text[] not null default '{}',
  -- [{ "year": 2012, "text": "...", "text_bn": "..." }]
  add column amendments jsonb not null default '[]'::jsonb;

-- The CPC's First Schedule: Orders, each a list of Rules. URL ids are "39" or "27A" (Order XXVIIA).
create table public.law_orders (
  id uuid primary key default gen_random_uuid(),
  law_slug text not null references public.laws (slug) on delete cascade,
  n text not null,
  roman text not null,
  title text not null,
  title_tr text,
  sort_order integer not null,
  updated_at timestamptz not null default now(),
  unique (law_slug, n)
);
create trigger law_orders_updated_at before update on public.law_orders for each row execute function public.set_updated_at();

create table public.law_rules (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.law_orders (id) on delete cascade,
  law_slug text not null references public.laws (slug) on delete cascade,
  n text not null,
  title text not null,
  body jsonb not null default '[]'::jsonb,
  -- { "t": title, "b": [one string per block] } in the other language
  translation jsonb,
  sort_order integer not null,
  updated_at timestamptz not null default now(),
  unique (order_id, n)
);
create index law_rules_law_idx on public.law_rules (law_slug, sort_order);
create trigger law_rules_updated_at before update on public.law_rules for each row execute function public.set_updated_at();

/* ------------------------------------------------------------- judgments */

alter table public.judgments drop constraint judgments_type_check;
alter table public.judgments add constraint judgments_type_check
  check (type in ('writ', 'criminal', 'civil', 'tax', 'company', 'labour', 'family', 'others'));

alter table public.judgments
  -- When the report prints no day, only the year of decided_on is reliable
  add column date_known boolean not null default true,
  add column hearing text,
  -- Petitions, writs and revisions name a petitioner rather than an appellant
  add column petition boolean not null default false,
  -- [{ "side": "Appellants", "names": "..." }]
  add column advocates jsonb not null default '[]'::jsonb,
  add column citations_referred text[] not null default '{}',
  add column related_slugs text[] not null default '{}',
  -- The paragraphs in the other language, once translated in the admin panel
  add column paragraphs_tr jsonb,
  add column paragraph_count integer not null default 0;

-- A citation may name a Rule of an Order, or the law as a whole (kind "law").
alter table public.judgment_laws drop constraint judgment_laws_pkey;
alter table public.judgment_laws drop constraint judgment_laws_kind_check;
alter table public.judgment_laws
  add column id uuid primary key default gen_random_uuid(),
  add column rule integer,
  add column sort_order integer not null default 0,
  add constraint judgment_laws_kind_check check (kind in ('law', 'section', 'article', 'order', 'rule'));
create unique index judgment_laws_unique on public.judgment_laws (judgment_slug, law_slug, kind, n, coalesce(rule, 0));

/* --------------------------------------------------------- reads & views */

-- What readers open: laws, provisions and judgments, for "most viewed" and the home page's trends.
create table public.catalogue_reads (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('law', 'section', 'order', 'judgment')),
  slug text not null,
  -- Section or Order number, for provisions
  n text,
  user_id uuid references public.profiles (id) on delete set null,
  read_at timestamptz not null default now()
);
create index catalogue_reads_recent_idx on public.catalogue_reads (read_at desc);
create index catalogue_reads_item_idx on public.catalogue_reads (kind, slug, n, read_at desc);

-- Keeps laws.views in step, so the catalogue list sorts without counting reads each time.
create or replace function public.count_law_read()
returns trigger
language plpgsql
as $$
begin
  if new.kind in ('law', 'section', 'order') then
    update public.laws set views = views + 1 where slug = new.slug;
  end if;
  return new;
end;
$$;
create trigger catalogue_reads_count after insert on public.catalogue_reads for each row execute function public.count_law_read();

/* ---------------------------------------------------------------- history */

-- What the content team changed, per law or judgment: the admin panel's "History" tab.
create table public.catalogue_revisions (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('law', 'judgment')),
  target_slug text not null,
  kind text not null check (kind in ('created', 'published', 'unpublished', 'info', 'section', 'translation', 'untranslated', 'linked', 'unlinked', 'text')),
  -- The section number, or the cited law and provision for links
  n text,
  law_slug text,
  actor_id uuid references public.team_members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index catalogue_revisions_target_idx on public.catalogue_revisions (target_type, target_slug, created_at desc);

/* -------------------------------------------------------------- assistant */

alter table public.assistant_questions
  add column scope text not null default 'all' check (scope in ('all', 'laws', 'cases'));
create index assistant_questions_flagged_idx on public.assistant_questions (flagged) where flagged;
create index assistant_questions_recent_idx on public.assistant_questions (created_at desc);

/* ----------------------------------------------------------------- search */

-- The words of a body: [{ "text": "..." }, ...] → one string. Immutable so generated columns can use it.
create or replace function public.blocks_text(blocks jsonb)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(b ->> 'text', ' '), '') from jsonb_array_elements(coalesce(blocks, '[]'::jsonb)) b;
$$;

-- The strings of a translation's "b": one string per block.
create or replace function public.strings_text(strings jsonb)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(s, ' '), '') from jsonb_array_elements_text(coalesce(strings, '[]'::jsonb)) s;
$$;

-- Digits as readers type them: Bangla numerals become ASCII, so "১৫১" finds section 151.
create or replace function public.latin_digits(value text)
returns text
language sql
immutable
as $$
  select translate(value, '০১২৩৪৫৬৭৮৯', '0123456789');
$$;

alter table public.law_sections add column search tsvector
  generated always as (
    to_tsvector('simple', public.latin_digits(
      coalesce(title, '') || ' ' || coalesce(title_tr, '') || ' ' ||
      public.blocks_text(body) || ' ' || public.strings_text(translation -> 'b')
    ))
  ) stored;
create index law_sections_search_idx on public.law_sections using gin (search);

alter table public.law_rules add column search tsvector
  generated always as (
    to_tsvector('simple', public.latin_digits(
      coalesce(title, '') || ' ' || coalesce(translation ->> 't', '') || ' ' ||
      public.blocks_text(body) || ' ' || public.strings_text(translation -> 'b')
    ))
  ) stored;
create index law_rules_search_idx on public.law_rules using gin (search);

-- Judgments search their opening paragraphs too (the whole text would make the index huge for little gain).
alter table public.judgments drop column search;
alter table public.judgments add column search tsvector
  generated always as (
    to_tsvector('simple', public.latin_digits(
      coalesce(title, '') || ' ' || coalesce(citation, '') || ' ' || coalesce(case_no, '') || ' ' ||
      coalesce(excerpt, '') || ' ' || public.join_words(keywords) || ' ' || public.join_words(judges) || ' ' ||
      left(public.strings_text(paragraphs), 4000)
    ))
  ) stored;
create index judgments_search_idx on public.judgments using gin (search);

alter table public.laws drop column search;
alter table public.laws add column search tsvector
  generated always as (
    to_tsvector('simple', public.latin_digits(
      coalesce(title, '') || ' ' || coalesce(title_bn, '') || ' ' || coalesce(act_no, '') || ' ' ||
      coalesce(act_no_bn, '') || ' ' || coalesce(description, '') || ' ' || coalesce(description_bn, '') || ' ' || slug
    ))
  ) stored;
create index laws_search_idx on public.laws using gin (search);

-- Every provision with text, ranked for a query. `tsq` is a tsquery the API builds from the reader's words
-- (prefix matches, ANDed); the API adds the "named provision" boost itself from the numbers it parsed.
create or replace function public.search_provisions(tsq tsquery, max_rows integer default 300)
returns table (
  kind text,
  law_slug text,
  n text,
  order_n text,
  roman text,
  title text,
  title_tr text,
  snippet text,
  snippet_tr text,
  rank real,
  sort_order integer
)
language sql
stable
as $$
  select 'section', s.law_slug, s.n, null::text, null::text, s.title, s.title_tr,
         left(public.blocks_text(s.body), 400), left(public.strings_text(s.translation -> 'b'), 400),
         ts_rank(s.search, tsq), s.sort_order
  from public.law_sections s
  join public.laws l on l.slug = s.law_slug and l.published
  where s.search @@ tsq
  union all
  select 'rule', r.law_slug, r.n, o.n, o.roman, r.title, r.translation ->> 't',
         left(public.blocks_text(r.body), 400), left(public.strings_text(r.translation -> 'b'), 400),
         ts_rank(r.search, tsq), r.sort_order
  from public.law_rules r
  join public.law_orders o on o.id = r.order_id
  join public.laws l on l.slug = r.law_slug and l.published
  where r.search @@ tsq
  order by 10 desc
  limit max_rows;
$$;

create or replace function public.search_judgments(tsq tsquery, max_rows integer default 100)
returns table (slug text, rank real)
language sql
stable
as $$
  select j.slug, ts_rank(j.search, tsq)
  from public.judgments j
  where j.published and j.search @@ tsq
  order by 2 desc
  limit max_rows;
$$;

create or replace function public.search_laws(tsq tsquery, max_rows integer default 100)
returns table (slug text, rank real)
language sql
stable
as $$
  select l.slug, ts_rank(l.search, tsq)
  from public.laws l
  where l.published and l.search @@ tsq
  order by 2 desc
  limit max_rows;
$$;

/* --------------------------------------------------------------- policies */

alter table public.law_orders enable row level security;
alter table public.law_rules enable row level security;
alter table public.catalogue_reads enable row level security;
alter table public.catalogue_revisions enable row level security;

create policy "orders of published laws are public" on public.law_orders
  for select using (exists (select 1 from public.laws l where l.slug = law_slug and l.published));
create policy "rules of published laws are public" on public.law_rules
  for select using (exists (select 1 from public.laws l where l.slug = law_slug and l.published));
