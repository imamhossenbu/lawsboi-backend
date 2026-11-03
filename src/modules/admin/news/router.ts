import { Router } from "express";
import { z } from "zod";
import { badRequest, unwrap } from "../../../lib/errors.js";
import { notifyReader } from "../../../lib/notify.js";
import { db } from "../../../lib/supabase.js";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { logAudit } from "../../audit/service.js";
import { recipients } from "../announcements/service.js";
import { newsCategories, newsOf, slugFor, type NewsRow } from "../../news/shared.js";

// The team's side of legal news: every post with drafts, writing, publishing (the first time a post goes out, readers
// who take "legal updates" in the app get it in their bell) and deleting. The list says when the last post went out,
// so the page can remind the team to post today's update.

export const adminNewsRouter = Router();
adminNewsRouter.use(requireTeam, requirePermission("news.view"));

const adminNewsOf = (n: NewsRow) => ({ ...newsOf(n, true), status: n.status, createdAt: n.created_at, updatedAt: n.updated_at, author: n.author_id });

const listQuery = z.object({
  status: z.enum(["all", "published", "draft"]).default("all"),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

adminNewsRouter.get("/", validate("query", listQuery), async (req, res) => {
  const q = parsed<z.infer<typeof listQuery>>(req, "query");
  let query = db.from("news_posts").select("*", { count: "exact" });
  if (q.status !== "all") query = query.eq("status", q.status);
  if (q.q) {
    const term = q.q.replace(/[%_,()]/g, " ");
    query = query.or(`title.ilike.%${term}%,title_bn.ilike.%${term}%,summary.ilike.%${term}%`);
  }
  const from = (q.page - 1) * q.perPage;
  const [{ data, count }, last, published, drafts, views] = await Promise.all([
    query.order("updated_at", { ascending: false }).range(from, from + q.perPage - 1),
    db.from("news_posts").select("published_at").eq("status", "published").order("published_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("news_posts").select("id", { count: "exact", head: true }).eq("status", "published"),
    db.from("news_posts").select("id", { count: "exact", head: true }).eq("status", "draft"),
    db.from("news_posts").select("views").eq("status", "published"),
  ]);
  res.json({
    news: (data ?? []).map(adminNewsOf),
    total: count ?? 0,
    page: q.page,
    perPage: q.perPage,
    stats: { published: published.count ?? 0, drafts: drafts.count ?? 0, views: (views.data ?? []).reduce((s, r) => s + r.views, 0), lastPublishedAt: last.data?.published_at ?? null },
  });
});

const idParam = z.object({ id: z.string().regex(/^NWS-\d{5,}$/) });
const find = async (id: string) => unwrap(await db.from("news_posts").select("*").eq("public_id", id).maybeSingle(), "That news post");

adminNewsRouter.get("/:id", validate("params", idParam), async (req, res) => {
  res.json({ post: adminNewsOf(await find(parsed<{ id: string }>(req, "params").id)) });
});

const postSchema = z.object({
  title: z.string().trim().min(3).max(240),
  titleBn: z.string().trim().max(240).default(""),
  summary: z.string().trim().max(600).default(""),
  summaryBn: z.string().trim().max(600).default(""),
  body: z.string().trim().max(30_000).default(""),
  bodyBn: z.string().trim().max(30_000).default(""),
  category: z.enum(newsCategories).default("legislation"),
  cover: z.url().max(1000).nullable().default(null),
  source: z.object({ name: z.string().trim().max(120), url: z.url().max(1000) }).nullable().default(null),
  pinned: z.boolean().default(false),
});

const rowOf = (b: z.infer<typeof postSchema>) => ({
  title: b.title,
  title_bn: b.titleBn,
  summary: b.summary,
  summary_bn: b.summaryBn,
  body: b.body,
  body_bn: b.bodyBn,
  category: b.category,
  cover_url: b.cover,
  source_name: b.source?.name ?? null,
  source_url: b.source?.url ?? null,
  pinned: b.pinned,
});

const label = (n: NewsRow) => ({ en: n.title, bn: n.title_bn || n.title });

adminNewsRouter.post("/", requirePermission("news.write"), validate("body", postSchema), async (req, res) => {
  const b = req.body as z.infer<typeof postSchema>;
  const n = unwrap(await db.from("news_posts").insert({ ...rowOf(b), slug: slugFor(b.title), author_id: req.member!.id }).select("*").single());
  await logAudit(req, { action: "news.create", target: { type: "news", id: n.public_id, label: label(n) } });
  res.status(201).json({ post: adminNewsOf(n) });
});

adminNewsRouter.patch("/:id", requirePermission("news.write"), validate("params", idParam), validate("body", postSchema), async (req, res) => {
  const before = await find(parsed<{ id: string }>(req, "params").id);
  const n = unwrap(await db.from("news_posts").update(rowOf(req.body)).eq("id", before.id).select("*").single());
  await logAudit(req, { action: "news.edit", target: { type: "news", id: n.public_id, label: label(n) } });
  res.json({ post: adminNewsOf(n) });
});

/** Publishes (now) or takes a post down. Going out for the first time puts it in readers' bells. */
adminNewsRouter.post("/:id/publish", requirePermission("news.publish"), validate("params", idParam), validate("body", z.object({ published: z.boolean() })), async (req, res) => {
  const before = await find(parsed<{ id: string }>(req, "params").id);
  const published = req.body.published as boolean;
  if (published && !before.summary && !before.body) throw badRequest("Write a summary or the story before publishing.", { summary: "required" });
  const first = published && !before.published_at;
  const n = unwrap(
    await db
      .from("news_posts")
      .update({ status: published ? "published" : "draft", ...(first ? { published_at: new Date().toISOString() } : {}) })
      .eq("id", before.id)
      .select("*")
      .single(),
  );
  await logAudit(req, { action: published ? "news.publish" : "news.unpublish", target: { type: "news", id: n.public_id, label: label(n) } });
  if (first) {
    void (async () => {
      const plans = unwrap(await db.from("plans").select("id"));
      const readers = await recipients(plans.map((p) => p.id), "legal", "in_app");
      await notifyReader(
        readers.map((r: { id: string }) => r.id),
        { kind: "news", title: { en: n.title, bn: n.title_bn || n.title }, body: { en: n.summary, bn: n.summary_bn || n.summary }, link: `/news/${n.slug}` },
      );
    })().catch(() => undefined);
  }
  res.json({ post: adminNewsOf(n) });
});

adminNewsRouter.delete("/:id", requirePermission("news.delete"), validate("params", idParam), async (req, res) => {
  const n = await find(parsed<{ id: string }>(req, "params").id);
  await db.from("news_posts").delete().eq("id", n.id);
  await logAudit(req, { action: "news.delete", target: { type: "news", id: n.public_id, label: label(n) } });
  res.status(204).end();
});
