import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { badRequest, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import { logAudit } from "../../audit/service.js";
import {
  articleGaps,
  articleIcons,
  articleOf,
  contentStatuses,
  faqGaps,
  faqOf,
  faqPlaces,
  faqTopics,
  pageGaps,
  pageOf,
  pageSlugs,
  sectionSchema,
  slugify,
  textSchema,
  tryPages,
  type ArticleRow,
  type FaqRow,
  type PageSection,
} from "../../content/shared.js";

// Team: the reader site's own words. Help articles, the FAQs on the help centre, pricing and contact pages, and
// the privacy, disclaimer and about pages. Everything is written in both languages; publishing needs both.

export const adminContentRouter = Router();
adminContentRouter.use(requireTeam, requirePermission("content.view"));

const pageNames: Record<string, { en: string; bn: string }> = {
  privacy: { en: "Privacy policy", bn: "গোপনীয়তা নীতি" },
  disclaimer: { en: "Disclaimer", bn: "দাবিত্যাগ" },
  about: { en: "About", bn: "আমাদের সম্পর্কে" },
};

/* --------------------------------------------------------------- articles */

/** Opens in the last 30 days, per article. */
async function reads30d() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = unwrap(await db.from("help_article_reads").select("article_slug").gte("read_at", since));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.article_slug, (counts.get(r.article_slug) ?? 0) + 1);
  return counts;
}

const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) });
const articleLabel = (a: ArticleRow) => ({ en: a.title, bn: a.title_bn || a.title });

async function loadArticle(slug: string) {
  return unwrap(await db.from("help_articles").select("*").eq("slug", slug).maybeSingle(), "That article");
}

adminContentRouter.get("/articles", async (_req, res) => {
  const [rows, reads] = await Promise.all([unwrap(await db.from("help_articles").select("*").order("sort_order")), reads30d()]);
  res.json({ articles: rows.map((a) => articleOf(a, reads.get(a.slug) ?? 0)), icons: articleIcons, tryPages });
});

const articleBody = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
  title: textSchema,
  summary: textSchema,
  steps: z.array(textSchema).min(1, "Add at least one step."),
  tryHref: z.enum(tryPages),
  icon: z.enum(articleIcons),
  status: z.enum(contentStatuses).default("draft"),
});
type ArticleInput = z.infer<typeof articleBody>;

function checkPublishable(status: string, missing: string[]) {
  if (status === "published" && missing.length) throw badRequest(`Write it in ${missing.join(" and ")} before publishing.`, { languages: missing.join(",") });
}

const articleRow = (b: ArticleInput) => ({
  title: b.title.en,
  title_bn: b.title.bn,
  summary: b.summary.en,
  summary_bn: b.summary.bn,
  steps: b.steps,
  try_href: b.tryHref,
  icon: b.icon,
  status: b.status,
});

adminContentRouter.post("/articles", requirePermission("content.edit"), validate("body", articleBody), async (req, res) => {
  const b = req.body as ArticleInput;
  checkPublishable(b.status, articleGaps(b));
  if (b.status === "published") requirePermission("content.publish")(req, res, (err?: unknown) => { if (err) throw err; });
  const existing = unwrap(await db.from("help_articles").select("slug, sort_order"));
  const taken = new Set(existing.map((a) => a.slug));
  const slug = b.slug && !taken.has(b.slug) ? b.slug : slugify(b.title.en, taken, "article");
  const sort_order = Math.max(0, ...existing.map((a) => a.sort_order)) + 1;
  const row = unwrap(await db.from("help_articles").insert({ slug, sort_order, ...articleRow(b) }).select("*").single());
  await logAudit(req, { action: "article.create", target: { type: "article", id: row.slug, label: articleLabel(row) }, changes: [{ field: "contentStatus", to: row.status }] });
  res.status(201).json({ article: articleOf(row) });
});

adminContentRouter.patch("/articles/:slug", requirePermission("content.edit"), validate("params", slugParam), validate("body", articleBody), async (req, res) => {
  const before = await loadArticle(parsed<{ slug: string }>(req, "params").slug);
  const b = req.body as ArticleInput;
  checkPublishable(b.status, articleGaps(b));
  if (b.status !== before.status) requirePermission("content.publish")(req, res, (err?: unknown) => { if (err) throw err; });
  // Renaming the slug moves its reads and votes with it (the foreign keys cascade on update? no: they don't), so
  // the slug is kept unless it's free and explicitly asked for
  const patch = { ...articleRow(b), ...(b.slug && b.slug !== before.slug ? { slug: b.slug } : {}) };
  if (patch.slug) {
    const clash = await db.from("help_articles").select("slug").eq("slug", patch.slug).maybeSingle();
    if (clash.data) throw badRequest("Another article already uses that address.", { slug: "taken" });
  }
  const row = unwrap(await db.from("help_articles").update(patch).eq("slug", before.slug).select("*").single());
  await logAudit(req, {
    action: "article.edit",
    target: { type: "article", id: row.slug, label: articleLabel(row) },
    changes: [
      ...(before.title !== row.title ? [{ field: "title", from: articleLabel(before), to: articleLabel(row) }] : []),
      ...(before.status !== row.status ? [{ field: "contentStatus", from: before.status, to: row.status }] : []),
    ],
  });
  res.json({ article: articleOf(row) });
});

for (const status of contentStatuses) {
  const verb = status === "published" ? "publish" : "unpublish";
  adminContentRouter.post(`/articles/:slug/${verb}`, requirePermission("content.publish"), validate("params", slugParam), async (req, res) => {
    const before = await loadArticle(parsed<{ slug: string }>(req, "params").slug);
    checkPublishable(status, articleGaps({ title: { en: before.title, bn: before.title_bn }, summary: { en: before.summary, bn: before.summary_bn }, steps: before.steps as never }));
    const row = unwrap(await db.from("help_articles").update({ status }).eq("slug", before.slug).select("*").single());
    await logAudit(req, { action: `article.${verb}`, target: { type: "article", id: row.slug, label: articleLabel(row) } });
    res.json({ article: articleOf(row) });
  });
}

/** Swaps the article with its neighbour in the help centre's order. */
adminContentRouter.post("/articles/:slug/move", requirePermission("content.edit"), validate("params", slugParam), validate("body", z.object({ dir: z.union([z.literal(-1), z.literal(1)]) })), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const rows = unwrap(await db.from("help_articles").select("*").order("sort_order"));
  const i = rows.findIndex((a) => a.slug === slug);
  if (i < 0) throw badRequest("That article wasn't found.");
  const j = i + (req.body as { dir: -1 | 1 }).dir;
  if (j < 0 || j >= rows.length) return res.json({ articles: rows.map((a) => articleOf(a)) });
  await reorder("help_articles", rows[i]!.slug, rows[j]!.slug, rows[i]!.sort_order, rows[j]!.sort_order);
  await logAudit(req, { action: "article.move", target: { type: "article", id: slug, label: articleLabel(rows[i]!) } });
  res.json({ articles: unwrap(await db.from("help_articles").select("*").order("sort_order")).map((a) => articleOf(a)) });
});

adminContentRouter.delete("/articles/:slug", requirePermission("content.delete"), validate("params", slugParam), async (req, res) => {
  const a = await loadArticle(parsed<{ slug: string }>(req, "params").slug);
  await logAudit(req, { action: "article.delete", target: { type: "article", id: a.slug, label: articleLabel(a) } });
  unwrap(await db.from("help_articles").delete().eq("slug", a.slug).select("slug").single());
  res.status(204).end();
});

/** Two rows trade sort positions. */
async function reorder(table: "help_articles" | "faqs", a: string, b: string, orderA: number, orderB: number) {
  // Equal positions (imported rows) still need to swap: nudge one so the order is strict
  const [oa, ob] = orderA === orderB ? [orderA, orderB + 1] : [orderA, orderB];
  const set = async (id: string, sort_order: number) => {
    const { error } = table === "faqs" ? await db.from("faqs").update({ sort_order }).eq("id", id) : await db.from("help_articles").update({ sort_order }).eq("slug", id);
    if (error) throw new Error(`Database: ${error.message}`);
  };
  await set(a, ob);
  await set(b, oa);
}

/* ------------------------------------------------------------------- faqs */

const faqIdParam = z.object({ id: z.uuid() });
const faqLabel = (f: FaqRow) => ({ en: f.question, bn: f.question_bn || f.question });
const sameList = (a: FaqRow, b: FaqRow) => a.place === b.place && (a.topic ?? null) === (b.topic ?? null);

async function loadFaq(id: string) {
  return unwrap(await db.from("faqs").select("*").eq("id", id).maybeSingle(), "That question");
}

adminContentRouter.get("/faqs", async (_req, res) => {
  const rows = unwrap(await db.from("faqs").select("*").order("sort_order"));
  res.json({ faqs: rows.map(faqOf), places: faqPlaces, topics: faqTopics });
});

const faqBody = z
  .object({
    place: z.enum(faqPlaces),
    topic: z.enum(faqTopics).optional(),
    q: textSchema,
    a: textSchema,
    status: z.enum(contentStatuses).default("draft"),
  })
  .refine((f) => f.place !== "help" || f.topic, { message: "Help-centre questions need a topic.", path: ["topic"] });
type FaqInput = z.infer<typeof faqBody>;

const faqRow = (b: FaqInput) => ({
  place: b.place,
  topic: b.place === "help" ? b.topic! : null,
  question: b.q.en,
  question_bn: b.q.bn,
  answer: b.a.en,
  answer_bn: b.a.bn,
  status: b.status,
});

adminContentRouter.post("/faqs", requirePermission("content.edit"), validate("body", faqBody), async (req, res) => {
  const b = req.body as FaqInput;
  checkPublishable(b.status, faqGaps(b));
  if (b.status === "published") requirePermission("content.publish")(req, res, (err?: unknown) => { if (err) throw err; });
  const last = await db.from("faqs").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const row = unwrap(await db.from("faqs").insert({ ...faqRow(b), sort_order: (last.data?.sort_order ?? 0) + 1 }).select("*").single());
  await logAudit(req, { action: "faq.create", target: { type: "faq", id: row.id, label: faqLabel(row) }, changes: [{ field: "contentStatus", to: row.status }] });
  res.status(201).json({ faq: faqOf(row) });
});

adminContentRouter.patch("/faqs/:id", requirePermission("content.edit"), validate("params", faqIdParam), validate("body", faqBody), async (req, res) => {
  const before = await loadFaq(parsed<{ id: string }>(req, "params").id);
  const b = req.body as FaqInput;
  checkPublishable(b.status, faqGaps(b));
  if (b.status !== before.status) requirePermission("content.publish")(req, res, (err?: unknown) => { if (err) throw err; });
  // A question moved to another list goes to the end of that list
  const moved = before.place !== b.place || (before.topic ?? null) !== (b.place === "help" ? b.topic! : null);
  const last = moved ? await db.from("faqs").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle() : null;
  const row = unwrap(await db.from("faqs").update({ ...faqRow(b), ...(last && { sort_order: (last.data?.sort_order ?? 0) + 1 }) }).eq("id", before.id).select("*").single());
  await logAudit(req, {
    action: "faq.edit",
    target: { type: "faq", id: row.id, label: faqLabel(row) },
    changes: before.status !== row.status ? [{ field: "contentStatus", from: before.status, to: row.status }] : [],
  });
  res.json({ faq: faqOf(row) });
});

for (const status of contentStatuses) {
  const verb = status === "published" ? "publish" : "unpublish";
  adminContentRouter.post(`/faqs/:id/${verb}`, requirePermission("content.publish"), validate("params", faqIdParam), async (req, res) => {
    const before = await loadFaq(parsed<{ id: string }>(req, "params").id);
    checkPublishable(status, faqGaps({ q: { en: before.question, bn: before.question_bn }, a: { en: before.answer, bn: before.answer_bn } }));
    const row = unwrap(await db.from("faqs").update({ status }).eq("id", before.id).select("*").single());
    await logAudit(req, { action: `faq.${verb}`, target: { type: "faq", id: row.id, label: faqLabel(row) } });
    res.json({ faq: faqOf(row) });
  });
}

/** Moves a question within its own list (same place and topic). */
adminContentRouter.post("/faqs/:id/move", requirePermission("content.edit"), validate("params", faqIdParam), validate("body", z.object({ dir: z.union([z.literal(-1), z.literal(1)]) })), async (req, res) => {
  const { id } = parsed<{ id: string }>(req, "params");
  const rows = unwrap(await db.from("faqs").select("*").order("sort_order"));
  const me = rows.find((f) => f.id === id);
  if (!me) throw badRequest("That question wasn't found.");
  const list = rows.filter((f) => sameList(f, me));
  const i = list.indexOf(me);
  const j = i + (req.body as { dir: -1 | 1 }).dir;
  if (j >= 0 && j < list.length) {
    await reorder("faqs", me.id, list[j]!.id, me.sort_order, list[j]!.sort_order);
    await logAudit(req, { action: "faq.move", target: { type: "faq", id, label: faqLabel(me) } });
  }
  res.json({ faqs: unwrap(await db.from("faqs").select("*").order("sort_order")).map(faqOf) });
});

adminContentRouter.delete("/faqs/:id", requirePermission("content.delete"), validate("params", faqIdParam), async (req, res) => {
  const f = await loadFaq(parsed<{ id: string }>(req, "params").id);
  await logAudit(req, { action: "faq.delete", target: { type: "faq", id: f.id, label: faqLabel(f) } });
  unwrap(await db.from("faqs").delete().eq("id", f.id).select("id").single());
  res.status(204).end();
});

/* ------------------------------------------------------------------ pages */

const pageParam = z.object({ slug: z.enum(pageSlugs) });

adminContentRouter.get("/pages", async (_req, res) => {
  res.json({ pages: unwrap(await db.from("site_pages").select("*").order("slug")).map(pageOf) });
});

adminContentRouter.get("/pages/:slug", validate("params", pageParam), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  res.json({ page: pageOf(unwrap(await db.from("site_pages").select("*").eq("slug", slug).maybeSingle(), "That page")) });
});

/** Saves a live page, so every text needs both languages. The about page's bands can't be added or removed. */
adminContentRouter.put("/pages/:slug", requirePermission("content.edit"), validate("params", pageParam), validate("body", z.object({ sections: z.array(sectionSchema).min(1) })), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const { sections } = req.body as { sections: PageSection[] };
  const before = unwrap(await db.from("site_pages").select("*").eq("slug", slug).maybeSingle(), "That page");
  const missing = pageGaps(sections);
  if (missing.length) throw badRequest(`Write every part in ${missing.join(" and ")} before saving a live page.`, { languages: missing.join(",") });
  if (before.fixed) {
    const was = ((before.sections as PageSection[]) ?? []).map((s) => s.id);
    if (was.length && JSON.stringify(was) !== JSON.stringify(sections.map((s) => s.id))) throw badRequest("This page's sections are fixed by its layout.", { sections: "fixed" });
  }
  const row = unwrap(await db.from("site_pages").update({ sections }).eq("slug", slug).select("*").single());
  await logAudit(req, { action: "page.edit", target: { type: "page", id: slug, label: pageNames[slug] ?? { en: slug, bn: slug } } });
  res.json({ page: pageOf(row) });
});
