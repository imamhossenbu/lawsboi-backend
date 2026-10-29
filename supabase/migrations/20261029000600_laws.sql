-- The library: laws with their sections, judgments and the sections they cite, and the assistant's log.

create table public.laws (
  slug text primary key,
  -- Set on laws imported from bdlaws.minlaw.gov.bd: their page there is act-<id>.html
  bdlaws_id integer unique,
  title text not null,
  -- The Bangla title is the English one until someone adds a Bangla title
  title_bn text,
  act_no text not null default '',
  year integer not null,
  type text not null check (type in ('constitution', 'act', 'ordinance', 'po')),
  status text not null default 'in_force' check (status in ('in_force', 'repealed')),
  subject text not null default 'general',
  description text not null default '',
  -- The language the law was enacted in; its text is kept exactly in that language
  language public.lang not null default 'en',
  unit text not null default 'sections' check (unit in ('sections', 'articles')),
  section_count integer not null default 0,
  long_title text not null default '',
  preamble text not null default '',
  enacted_on text not null default '',
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index laws_subject_idx on public.laws (subject);
create index laws_year_idx on public.laws (year desc);
create trigger laws_updated_at before update on public.laws for each row execute function public.set_updated_at();

create table public.law_parts (
  id uuid primary key default gen_random_uuid(),
  law_slug text not null references public.laws (slug) on delete cascade,
  part_id text not null,
  title text not null,
  -- The title in the other language, when someone has added it
  title_tr text,
  range text not null default '',
  banner text,
  sub text,
  sort_order integer not null,
  unique (law_slug, part_id)
);

create table public.law_sections (
  id uuid primary key default gen_random_uuid(),
  law_slug text not null references public.laws (slug) on delete cascade,
  part_id uuid references public.law_parts (id) on delete cascade,
  -- "1", "1A", "144"
  n text not null,
  title text not null,
  -- [{ "kind": "para", "mark": "(1)", "text": "...", "notes": [0] }, ...], in the enacted language
  body jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  -- One string per block, in the other language, when translated
  translation jsonb,
  sort_order integer not null,
  updated_at timestamptz not null default now(),
  unique (law_slug, n)
);
create index law_sections_law_idx on public.law_sections (law_slug, sort_order);
create trigger law_sections_updated_at before update on public.law_sections for each row execute function public.set_updated_at();

create table public.judgments (
  slug text primary key,
  -- The parties, in the judgment's language, and in the other language when someone has added them
  title text not null,
  title_tr text,
  citation text not null,
  case_no text not null default '',
  origin text,
  court text not null check (court in ('AD', 'HCD')),
  decided_on date,
  judges text[] not null default '{}',
  author text,
  type text not null default 'others' check (type in ('writ', 'criminal', 'civil', 'tax', 'company', 'others')),
  keywords text[] not null default '{}',
  parties jsonb,
  excerpt text,
  -- The judgment's text as numbered paragraphs
  paragraphs jsonb not null default '[]'::jsonb,
  source jsonb,
  language public.lang not null default 'en',
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index judgments_court_idx on public.judgments (court, decided_on desc);
create trigger judgments_updated_at before update on public.judgments for each row execute function public.set_updated_at();

-- A section (or article, order, rule) a judgment cites
create table public.judgment_laws (
  judgment_slug text not null references public.judgments (slug) on delete cascade,
  law_slug text not null references public.laws (slug) on delete cascade,
  kind text not null default 'section' check (kind in ('section', 'article', 'order', 'rule')),
  n text not null,
  primary key (judgment_slug, law_slug, kind, n)
);
create index judgment_laws_law_idx on public.judgment_laws (law_slug);

-- Full-text search over titles and descriptions; section text comes later with its own index.
alter table public.laws add column search tsvector
  generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(title_bn, '') || ' ' || coalesce(act_no, '') || ' ' || coalesce(description, ''))) stored;
create index laws_search_idx on public.laws using gin (search);
alter table public.judgments add column search tsvector
  generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(citation, '') || ' ' || coalesce(excerpt, '') || ' ' || array_to_string(keywords, ' '))) stored;
create index judgments_search_idx on public.judgments using gin (search);

-- What readers asked the assistant, for their monthly allowance and the content team's review
create table public.assistant_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  question text not null,
  lang public.lang not null default 'en',
  -- { "laws": [...], "cases": [...] } as the assistant answered
  answer jsonb,
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);
create index assistant_questions_user_month_idx on public.assistant_questions (user_id, created_at desc);

alter table public.laws enable row level security;
alter table public.law_parts enable row level security;
alter table public.law_sections enable row level security;
alter table public.judgments enable row level security;
alter table public.judgment_laws enable row level security;
alter table public.assistant_questions enable row level security;

create policy "published laws are public" on public.laws for select using (published);
create policy "parts of published laws are public" on public.law_parts
  for select using (exists (select 1 from public.laws l where l.slug = law_slug and l.published));
create policy "sections of published laws are public" on public.law_sections
  for select using (exists (select 1 from public.laws l where l.slug = law_slug and l.published));
create policy "published judgments are public" on public.judgments for select using (published);
create policy "citations are public" on public.judgment_laws for select using (true);
create policy "readers see their own questions" on public.assistant_questions
  for select using (public.is_owner(user_id));
