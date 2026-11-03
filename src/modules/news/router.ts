import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { parsed, validate } from "../../middleware/validate.js";
import { newsCategories, newsOf } from "./shared.js";

// Public: the published news, newest first (pinned posts lead the first page), one post, and counting a read.

export const newsRouter = Router();

const listQuery = z.object({
  category: z.enum([...newsCategories, "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(12),
});

newsRouter.get("/", validate("query", listQuery), async (req, res) => {
  const q = parsed<z.infer<typeof listQuery>>(req, "query");
  let query = db.from("news_posts").select("*", { count: "exact" }).eq("status", "published").lte("published_at", new Date().toISOString());
  if (q.category !== "all") query = query.eq("category", q.category);
  const from = (q.page - 1) * q.perPage;
  const { data, count } = await query.order("pinned", { ascending: false }).order("published_at", { ascending: false }).range(from, from + q.perPage - 1);
  res.json({ news: (data ?? []).map((n) => newsOf(n)), total: count ?? 0, page: q.page, perPage: q.perPage });
});

newsRouter.get("/:slug", validate("params", z.object({ slug: z.string().min(1).max(120) })), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const n = unwrap(await db.from("news_posts").select("*").eq("slug", slug).eq("status", "published").maybeSingle(), "That news post");
  const { data: more } = await db.from("news_posts").select("*").eq("status", "published").neq("id", n.id).order("published_at", { ascending: false }).limit(4);
  res.json({ post: newsOf(n, true), more: (more ?? []).map((m) => newsOf(m)) });
});

const reads = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });

newsRouter.post("/:slug/read", reads, validate("params", z.object({ slug: z.string().min(1).max(120) })), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const { data } = await db.from("news_posts").select("id,views").eq("slug", slug).eq("status", "published").maybeSingle();
  if (data) await db.from("news_posts").update({ views: data.views + 1 }).eq("id", data.id);
  res.status(204).end();
});
