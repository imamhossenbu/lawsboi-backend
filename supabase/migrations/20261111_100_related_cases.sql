-- Related cases the team writes in by hand (admin → Laws & case laws), beside the judgments that cite a provision.
-- Each entry is either a judgment picked from the catalogue (case_slug) or a case typed in by name and number, with
-- an optional link; title and citation are kept either way, so an entry still reads well if its judgment goes.

create table public.law_section_related_cases (
  id uuid primary key default gen_random_uuid(),
  law_slug text not null references public.laws (slug) on delete cascade on update cascade,
  -- The section (or article) number, as law_sections.n
  n text not null,
  case_slug text references public.judgments (slug) on delete set null on update cascade,
  title text not null,
  citation text not null default '',
  url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index law_section_related_cases_section_idx on public.law_section_related_cases (law_slug, n, sort_order);
alter table public.law_section_related_cases enable row level security;

-- A judgment's own hand-written lists: other cases ({ title, citation, url? }) and laws or provisions
-- ({ title, url? }, e.g. "Section 21A, Specific Relief Act, 1877") that aren't (or can't be) linked to the catalogue.
alter table public.judgments
  add column related_manual jsonb not null default '[]'::jsonb,
  add column laws_manual jsonb not null default '[]'::jsonb;
