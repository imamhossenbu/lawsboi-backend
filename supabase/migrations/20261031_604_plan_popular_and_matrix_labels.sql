-- The pricing page's "Most popular" mark becomes the team's choice (one plan at most), and each row of the
-- comparison matrix carries its own label in both languages, so the site no longer matches rows by position.

alter table public.plans add column if not exists popular boolean not null default false;
create unique index if not exists plans_one_popular on public.plans (popular) where popular;
-- The site marked the cheapest paid plan until now
update public.plans set popular = true where id = 'researcher' and not exists (select 1 from public.plans where popular);

update public.site_settings
set value = (
  select jsonb_agg(row || jsonb_build_object('label', labels.label) order by ord)
  from jsonb_array_elements(value) with ordinality as m(row, ord)
  left join (values
    ('laws', '{"en": "Access to laws (bare acts, rules, orders)", "bn": "আইনে প্রবেশাধিকার (মূল আইন, বিধি, আদেশ)"}'::jsonb),
    ('judgments', '{"en": "Access to case judgments", "bn": "মামলার রায়ে প্রবেশাধিকার"}'),
    ('basicSearch', '{"en": "Basic search", "bn": "সাধারণ সার্চ"}'),
    ('advancedSearch', '{"en": "Advanced search & filters", "bn": "উন্নত সার্চ ও ফিল্টার"}'),
    ('aiQuestions', '{"en": "AI questions per month", "bn": "মাসিক এআই প্রশ্ন"}'),
    ('savedItems', '{"en": "Saved items", "bn": "সংরক্ষিত আইটেম"}'),
    ('pdfDownload', '{"en": "Download PDF (laws & judgments)", "bn": "পিডিএফ ডাউনলোড (আইন ও রায়)"}'),
    ('relatedCases', '{"en": "Related cases & citations", "bn": "সম্পর্কিত মামলা ও উদ্ধৃতি"}'),
    ('caseAnalysis', '{"en": "Case analysis (AI)", "bn": "মামলা বিশ্লেষণ (এআই)"}'),
    ('caseComparison', '{"en": "Case comparison", "bn": "মামলা তুলনা"}'),
    ('citationExport', '{"en": "Export citations (PDF, DOC)", "bn": "উদ্ধৃতি এক্সপোর্ট (PDF, DOC)"}'),
    ('prioritySupport', '{"en": "Priority support", "bn": "অগ্রাধিকার সাপোর্ট"}')
  ) as labels(key, label) on labels.key = m.row ->> 'key'
)
where key = 'feature_matrix' and jsonb_typeof(value) = 'array' and not (value -> 0 ? 'label');
