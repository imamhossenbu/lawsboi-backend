import { readFileSync } from "node:fs";
import { db } from "../src/lib/supabase.js";

// Loads the reader site's words into the database: help articles, FAQs, the legal and about pages (from the admin
// panel's data/content.json, itself copied from lawsboi), the feature flags (the admin panel's flags.ts, written
// out here) and the contact details. Upserts, so it can be run again after the text changes.
//
//   npx tsx --env-file=.env scripts/import-content.ts [path/to/content.json]

type Text = { en: string; bn: string };
interface ContentJson {
  articles: { slug: string; title: Text; summary: Text; steps: Text[]; tryHref: string }[];
  faqs: { place: string; topic?: string; q: Text; a: Text }[];
  pages: { slug: string; path: string; fixed?: boolean; sections: unknown[] }[];
}

const source = process.argv[2] ?? new URL("../../lawsboi-admin/src/lib/admin/data/content.json", import.meta.url).pathname;
const data = JSON.parse(readFileSync(source, "utf8")) as ContentJson;

const icons: Record<string, string> = { "search-laws": "search", "ai-assistant": "sparkles", "save-items": "bookmark", payment: "card", "change-plan": "crown", "download-pdf": "download", password: "key" };

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

/* --------------------------------------------------------------- articles */
{
  const rows = data.articles.map((a, i) => ({
    slug: a.slug,
    title: a.title.en,
    title_bn: a.title.bn,
    summary: a.summary.en,
    summary_bn: a.summary.bn,
    steps: a.steps,
    try_href: a.tryHref,
    icon: icons[a.slug] ?? "file",
    status: "published" as const,
    sort_order: i + 1,
  }));
  fail("help_articles", (await db.from("help_articles").upsert(rows, { onConflict: "slug" })).error);
  console.log(`help articles: ${rows.length}`);
}

/* ------------------------------------------------------------------- faqs */
{
  // FAQs have no natural key; the question text in English is the one we match on, so re-running updates in place
  const existing = (await db.from("faqs").select("id, question")).data ?? [];
  const byQuestion = new Map(existing.map((f) => [f.question, f.id]));
  const rows = data.faqs.map((f, i) => ({
    ...(byQuestion.has(f.q.en) ? { id: byQuestion.get(f.q.en)! } : {}),
    place: f.place,
    topic: f.place === "help" ? (f.topic ?? "account") : null,
    question: f.q.en,
    question_bn: f.q.bn,
    answer: f.a.en,
    answer_bn: f.a.bn,
    status: "published" as const,
    sort_order: i + 1,
  }));
  fail("faqs", (await db.from("faqs").upsert(rows, { onConflict: "id" })).error);
  console.log(`faqs: ${rows.length} (help ${rows.filter((r) => r.place === "help").length}, pricing ${rows.filter((r) => r.place === "pricing").length}, contact ${rows.filter((r) => r.place === "contact").length})`);
}

/* ------------------------------------------------------------------ pages */
{
  const rows = data.pages.map((p) => ({ slug: p.slug, path: p.path, fixed: p.fixed ?? false, sections: p.sections as never }));
  fail("site_pages", (await db.from("site_pages").upsert(rows, { onConflict: "slug" })).error);
  console.log(`site pages: ${rows.map((p) => `${p.slug} (${(p.sections as unknown[]).length} sections)`).join(", ")}`);
}

/* ------------------------------------------------------------------ flags */
{
  const all = { free: "full", researcher: "full", professional: "full" };
  const paid = { free: "none", researcher: "full", professional: "full" };
  const pro = { free: "none", researcher: "none", professional: "full" };
  const flags = [
    { id: "laws", group: "research", enabled: true, access: all, pages: ["/bd/laws", "/dashboard/laws", "/dashboard/acts"], reader_today: "open" },
    { id: "judgments", group: "research", enabled: true, access: { free: "limited", researcher: "full", professional: "full" }, pages: ["/bd/cases", "/dashboard/cases"], reader_today: "open" },
    { id: "advancedSearch", group: "research", enabled: true, access: paid, pages: ["/dashboard/laws", "/dashboard/cases"], reader_today: "open" },
    { id: "relatedCases", group: "research", enabled: true, access: paid, pages: ["/dashboard/cases/[slug]", "/bd/laws/[slug]/cases"], reader_today: "open" },
    { id: "caseComparison", group: "research", enabled: false, access: pro, rollout: 0, pages: ["/dashboard/cases/[slug]"], reader_today: "notBuilt" },
    { id: "aiQuestions", group: "ai", enabled: true, access: { free: "limited", researcher: "limited", professional: "full" }, allowance: { free: 5, researcher: 30, professional: null }, per: "month", pages: ["/assistant", "/dashboard/assistant"], reader_today: "enforced" },
    { id: "caseAnalysis", group: "ai", enabled: true, access: pro, rollout: 25, pages: ["/dashboard/cases/[slug]"], reader_today: "notBuilt" },
    { id: "savedItems", group: "library", enabled: true, access: { free: "limited", researcher: "limited", professional: "full" }, allowance: { free: 5, researcher: 50, professional: null }, per: "total", pages: ["/dashboard/library", "/dashboard/plan"], reader_today: "shown" },
    { id: "pdfDownload", group: "library", enabled: true, access: paid, pages: ["/dashboard/laws/[slug]", "/dashboard/cases/[slug]"], reader_today: "open" },
    { id: "citationExport", group: "library", enabled: true, access: pro, pages: ["/dashboard/cases/[slug]"], reader_today: "notBuilt" },
    { id: "prioritySupport", group: "account", enabled: true, access: pro, pages: ["/dashboard/help"], reader_today: "notBuilt" },
  ];
  const existing = new Set(((await db.from("feature_flags").select("id")).data ?? []).map((f) => f.id));
  // Existing flags keep what the team set; only the documentation fields follow the code
  for (const f of flags) {
    const row = existing.has(f.id) ? { id: f.id, group: f.group, pages: f.pages, reader_today: f.reader_today } : { ...f, allowance: f.allowance ?? null, per: f.per ?? null, rollout: f.rollout ?? null };
    fail(`feature_flags ${f.id}`, (await db.from("feature_flags").upsert(row as never, { onConflict: "id" })).error);
    if (!existing.has(f.id)) fail("feature_flag_events", (await db.from("feature_flag_events").insert({ flag_id: f.id, change: { kind: "created" } })).error);
  }
  console.log(`feature flags: ${flags.length} (${flags.length - existing.size} new)`);
}

/* ---------------------------------------------------------------- contact */
{
  const contact = {
    email: "support@lawsboi.com",
    phone: "+880 1700 000000",
    whatsapp: "+880 1700 000000",
    replyTime: { en: "We usually reply within 24 hours.", bn: "সাধারণত ২৪ ঘণ্টার মধ্যে উত্তর দিই।" },
    hours: { en: "Sun – Thu, 10:00 AM – 6:00 PM (BST)", bn: "রবি – বৃহস্পতি, সকাল ১০টা – সন্ধ্যা ৬টা" },
    office: { en: "Dhaka, Bangladesh", bn: "ঢাকা, বাংলাদেশ" },
    officeNote: { en: "Full address available on request", bn: "পূর্ণ ঠিকানা অনুরোধে জানানো হয়" },
  };
  const has = await db.from("site_settings").select("key").eq("key", "contact").maybeSingle();
  // The team's edits win over the import once they've saved the page
  if (!has.data) fail("site_settings", (await db.from("site_settings").insert({ key: "contact", value: contact })).error);
  console.log(`contact details: ${has.data ? "kept" : "added"}`);
}
