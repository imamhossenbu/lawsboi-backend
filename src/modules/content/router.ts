import { Router } from "express";
import { z } from "zod";
import { requireReader } from "../../middleware/auth.js";
import { parsed, validate } from "../../middleware/validate.js";
import { notFound, unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { sendDueAnnouncements } from "../admin/announcements/service.js";
import { announcementOf, articleOf, faqOf, faqPlaces, flagOf, pageOf, pageSlugs, text } from "./shared.js";

// Public and readers: the help centre, the FAQs, the legal and about pages, the feature flags the reader site
// gates on, and the signed-in reader's announcements (the bell and the dashboard banner).

export const contentRouter = Router();

/* ----------------------------------------------------------- help centre */

contentRouter.get("/articles", async (_req, res) => {
  const rows = unwrap(await db.from("help_articles").select("*").eq("status", "published").order("sort_order"));
  res.json({ articles: rows.map((a) => articleOf(a)) });
});

const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) });

/** The signed-in reader behind an optional token, or null; a bad token is just "signed out" here. */
async function optionalReaderId(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const { data } = await db.auth.getUser(authorization.slice(7));
  return data.user?.id ?? null;
}

/** One article; with a reader's token, `myVote` is their earlier answer to "Was this helpful?" (null when none). */
contentRouter.get("/articles/:slug", validate("params", slugParam), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const [a, readerId] = await Promise.all([db.from("help_articles").select("*").eq("slug", slug).eq("status", "published").maybeSingle(), optionalReaderId(req.headers.authorization)]);
  const article = unwrap(a, "That article");
  const vote = readerId ? (await db.from("help_article_votes").select("helpful").eq("article_slug", article.slug).eq("user_id", readerId).maybeSingle()).data : null;
  res.json({ article: articleOf(article), myVote: vote ? vote.helpful : null });
});

/** Counts an open; anonymous readers count too. */
contentRouter.post("/articles/:slug/read", validate("params", slugParam), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const a = unwrap(await db.from("help_articles").select("slug").eq("slug", slug).eq("status", "published").maybeSingle(), "That article");
  await db.from("help_article_reads").insert({ article_slug: a.slug, user_id: null });
  res.status(204).end();
});

contentRouter.post("/articles/:slug/helpful", requireReader, validate("params", slugParam), validate("body", z.object({ helpful: z.boolean() })), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  unwrap(await db.from("help_articles").select("slug").eq("slug", slug).eq("status", "published").maybeSingle(), "That article");
  unwrap(await db.from("help_article_votes").upsert({ article_slug: slug, user_id: req.reader!.id, helpful: req.body.helpful }).select("helpful").single());
  const a = unwrap(await db.from("help_articles").select("*").eq("slug", slug).single());
  res.json({ vote: req.body.helpful, helpful: articleOf(a).helpful });
});

/* ------------------------------------------------------------------- faqs */

contentRouter.get("/faqs", validate("query", z.object({ place: z.enum(faqPlaces).optional() })), async (req, res) => {
  const { place } = parsed<{ place?: string }>(req, "query");
  let q = db.from("faqs").select("*").eq("status", "published").order("sort_order");
  if (place) q = q.eq("place", place);
  res.json({ faqs: unwrap(await q).map(faqOf) });
});

/* ------------------------------------------------------------------ pages */

contentRouter.get("/pages/:slug", validate("params", z.object({ slug: z.enum(pageSlugs) })), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  res.json({ page: pageOf(unwrap(await db.from("site_pages").select("*").eq("slug", slug).maybeSingle(), "That page")) });
});

/** The contact page's details (Settings → Contact in the admin panel). */
contentRouter.get("/contact", async (_req, res) => {
  const row = await db.from("site_settings").select("value").eq("key", "contact").maybeSingle();
  res.json({ contact: row.data?.value ?? null });
});

/* ------------------------------------------------------------------ flags */

contentRouter.get("/flags", async (_req, res) => {
  const rows = unwrap(await db.from("feature_flags").select("*").order("id"));
  res.json({ flags: rows.map(flagOf) });
});

/* ---------------------------------------------------------- announcements */

const idParam = z.object({ id: z.string().regex(/^ANN-\d{4,}$/) });

async function announcementByPublicId(id: string) {
  return unwrap(await db.from("announcements").select("*").eq("public_id", id).eq("status", "sent").maybeSingle(), "That announcement");
}

/** The bell: what reached this reader in the app, newest first, with read state. */
const bellQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  // Paging: items delivered before this moment (the last item's `at`)
  before: z.iso.datetime({ offset: true }).optional(),
});

contentRouter.get("/announcements", requireReader, validate("query", bellQuery), async (req, res) => {
  const { limit, before } = parsed<z.infer<typeof bellQuery>>(req, "query");
  // Anything due goes out first, so a scheduled announcement never waits for the admin to open the panel
  await sendDueAnnouncements().catch(() => undefined);
  let page = db.from("announcement_deliveries").select("announcement_id, delivered_at, opened_at").eq("user_id", req.reader!.id).eq("channel", "in_app");
  if (before) page = page.lt("delivered_at", before);
  const [deliveriesResult, unreadResult] = await Promise.all([
    page.order("delivered_at", { ascending: false }).limit(limit + 1),
    db.from("announcement_deliveries").select("announcement_id", { count: "exact", head: true }).eq("user_id", req.reader!.id).eq("channel", "in_app").is("opened_at", null),
  ]);
  const fetched = unwrap(deliveriesResult);
  const more = fetched.length > limit;
  const deliveries = fetched.slice(0, limit);
  const ids = deliveries.map((d) => d.announcement_id);
  const rows = ids.length ? unwrap(await db.from("announcements").select("*").in("id", ids)) : [];
  const byId = new Map(rows.map((a) => [a.id, a]));
  const items = deliveries.flatMap((d) => {
    const a = byId.get(d.announcement_id);
    if (!a) return [];
    return [{ id: a.public_id, title: text(a.title, a.title_bn), body: text(a.body, a.body_bn), topic: a.topic, link: a.link, at: d.delivered_at, read: d.opened_at !== null }];
  });
  // unread counts the whole bell, not just this page; `next` is the `before` for the following page
  res.json({ announcements: items, unread: unreadResult.count ?? 0, next: more ? (deliveries.at(-1)?.delivered_at ?? null) : null });
});

contentRouter.post("/announcements/read-all", requireReader, async (req, res) => {
  await db.from("announcement_deliveries").update({ opened_at: new Date().toISOString() }).eq("user_id", req.reader!.id).eq("channel", "in_app").is("opened_at", null);
  res.status(204).end();
});

contentRouter.post("/announcements/:id/read", requireReader, validate("params", idParam), async (req, res) => {
  const a = await announcementByPublicId(parsed<{ id: string }>(req, "params").id);
  await db.from("announcement_deliveries").update({ opened_at: new Date().toISOString() }).eq("user_id", req.reader!.id).eq("announcement_id", a.id).eq("channel", "in_app").is("opened_at", null);
  res.status(204).end();
});

/** The strip across the reader's dashboard: the newest live banner for their plan, or none. */
contentRouter.get("/banner", requireReader, async (req, res) => {
  await sendDueAnnouncements().catch(() => undefined);
  const rows = unwrap(
    await db.from("announcements").select("*").eq("status", "sent").contains("channels", ["banner"]).eq("banner_ended", false).or(`banner_until.is.null,banner_until.gt.${new Date().toISOString()}`).order("sent_at", { ascending: false }).limit(20),
  );
  const mine = rows.find((a) => a.plan_ids.length === 0 || a.plan_ids.includes(req.reader!.plan_id));
  if (!mine) return res.json({ banner: null });
  // Seeing it counts as reached; clicking it (below) as opened
  await db.from("announcement_deliveries").upsert({ announcement_id: mine.id, user_id: req.reader!.id, channel: "banner" }, { onConflict: "announcement_id,user_id,channel", ignoreDuplicates: true });
  const a = announcementOf(mine);
  res.json({ banner: { id: a.id, title: a.title, body: a.body, link: a.link, until: a.bannerUntil } });
});

contentRouter.post("/announcements/:id/banner-click", requireReader, validate("params", idParam), async (req, res) => {
  const a = await announcementByPublicId(parsed<{ id: string }>(req, "params").id);
  if (!a.channels.includes("banner")) throw notFound("That banner");
  await db.from("announcement_deliveries").upsert({ announcement_id: a.id, user_id: req.reader!.id, channel: "banner", opened_at: new Date().toISOString() }, { onConflict: "announcement_id,user_id,channel" });
  res.status(204).end();
});
