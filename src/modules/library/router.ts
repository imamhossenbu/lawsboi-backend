import { Router } from "express";
import { z } from "zod";
import { requireReader } from "../../middleware/auth.js";
import { parsed, validate } from "../../middleware/validate.js";
import { badRequest, notFound, unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import type { Tables } from "../../types/database.js";

// The reader's library: saved items (within the plan's allowance), collections, and research history.

export const libraryRouter = Router();
libraryRouter.use(requireReader);

type SavedRow = Tables<"saved_items">;
type CollectionRow = Tables<"collections">;
type HistoryRow = Tables<"research_history">;

const savedKinds = ["law", "section", "order", "case"] as const;
const historyKinds = ["law", "section", "case", "search"] as const;
const icons = ["folder", "scale", "book", "file", "bookmark", "tag"] as const;
const colors = ["green", "blue", "violet", "pink", "orange", "gold", "teal", "gray"] as const;
const HISTORY_LIMIT = 300;
// Re-opening the same page (or repeating a search) within this window refreshes the entry instead of adding one
const REPEAT_MS = 30 * 60_000;

/** A dashboard path the item lives at: same-site, no query tricks. */
const href = z.string().regex(/^\/dashboard\/[\w\-/.%]+$/, "Not a dashboard path.").max(300);

const savedOf = (s: SavedRow) => ({ id: s.id, href: s.href, kind: s.kind, title: s.title, subtitle: s.subtitle, at: s.created_at });
const collectionOf = (c: CollectionRow, items: string[]) => ({ id: c.id, name: c.name, description: c.description, icon: c.icon, color: c.color, createdAt: c.created_at, items });
const historyOf = (h: HistoryRow) => ({
  id: h.id,
  kind: h.kind,
  title: { en: h.title, bn: h.title_bn },
  context: h.context ? { en: h.context, bn: h.context_bn ?? h.context } : undefined,
  scope: h.scope ?? undefined,
  href: h.href,
  at: h.created_at,
});

/** How many items the reader's plan lets them keep: the feature flag's allowance when the team set one, else the
 * pricing page's figures. Null is unlimited. */
export async function savedAllowance(planId: string): Promise<number | null> {
  const flag = await db.from("feature_flags").select("allowance, enabled").eq("id", "savedItems").maybeSingle();
  const allowance = flag.data?.allowance as Record<string, number | null> | null | undefined;
  if (flag.data?.enabled !== false && allowance && planId in allowance) return allowance[planId] ?? null;
  const defaults: Record<string, number | null> = { free: 5, researcher: 50, professional: null };
  return planId in defaults ? (defaults[planId] ?? null) : null;
}

/* ------------------------------------------------------------ saved items */

libraryRouter.get("/saved", async (req, res) => {
  const me = req.reader!;
  const [items, allowance] = await Promise.all([db.from("saved_items").select("*").eq("user_id", me.id).order("created_at", { ascending: false }), savedAllowance(me.plan_id)]);
  res.json({ items: unwrap(items).map(savedOf), allowance });
});

const saveSchema = z.object({ href, kind: z.enum(savedKinds), title: z.string().trim().min(1).max(300), subtitle: z.string().trim().max(300).default("") });

/** Saves the item, or removes it when already saved (the bookmark button). */
libraryRouter.post("/saved/toggle", validate("body", saveSchema), async (req, res) => {
  const me = req.reader!;
  const b = req.body as z.infer<typeof saveSchema>;
  const existing = await db.from("saved_items").select("id").eq("user_id", me.id).eq("href", b.href).maybeSingle();
  if (existing.data) {
    await db.from("saved_items").delete().eq("id", existing.data.id);
    res.json({ saved: false });
    return;
  }
  const [allowance, count] = await Promise.all([savedAllowance(me.plan_id), db.from("saved_items").select("id", { count: "exact", head: true }).eq("user_id", me.id)]);
  if (allowance !== null && (count.count ?? 0) >= allowance) throw badRequest(`Your plan keeps up to ${allowance} saved items.`, { saved: "allowance" });
  const item = unwrap(await db.from("saved_items").insert({ user_id: me.id, href: b.href, kind: b.kind, title: b.title, subtitle: b.subtitle }).select("*").single());
  res.status(201).json({ saved: true, item: savedOf(item) });
});

libraryRouter.delete("/saved/:id", validate("params", z.object({ id: z.uuid() })), async (req, res) => {
  await db.from("saved_items").delete().eq("user_id", req.reader!.id).eq("id", parsed<{ id: string }>(req, "params").id);
  res.status(204).end();
});

libraryRouter.delete("/saved", async (req, res) => {
  await db.from("saved_items").delete().eq("user_id", req.reader!.id);
  res.status(204).end();
});

/* ------------------------------------------------------------ collections */

async function collectionsOf(userId: string) {
  const list = unwrap(await db.from("collections").select("*").eq("user_id", userId).order("created_at"));
  const members = list.length ? unwrap(await db.from("collection_items").select("*").in("collection_id", list.map((c) => c.id)).order("added_at")) : [];
  return list.map((c) => collectionOf(c, members.filter((m) => m.collection_id === c.id).map((m) => m.item_key)));
}

libraryRouter.get("/collections", async (req, res) => {
  res.json({ collections: await collectionsOf(req.reader!.id) });
});

const collectionSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(300).default(""), icon: z.enum(icons).default("folder"), color: z.enum(colors).default("green") });

libraryRouter.post("/collections", validate("body", collectionSchema), async (req, res) => {
  const c = unwrap(await db.from("collections").insert({ user_id: req.reader!.id, ...(req.body as z.infer<typeof collectionSchema>) }).select("*").single());
  res.status(201).json({ collection: collectionOf(c, []) });
});

/** Takes every item out of every collection; the collections themselves stay. */
libraryRouter.delete("/collections/items", async (req, res) => {
  const list = unwrap(await db.from("collections").select("id").eq("user_id", req.reader!.id));
  if (list.length) await db.from("collection_items").delete().in("collection_id", list.map((c) => c.id));
  res.status(204).end();
});

// Declared after "/collections/items" so that path never reads as an id
const collectionParam = z.object({ id: z.uuid() });

async function ownCollection(userId: string, id: string) {
  const c = await db.from("collections").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
  if (!c.data) throw notFound("That collection");
  return c.data;
}

libraryRouter.patch("/collections/:id", validate("params", collectionParam), validate("body", collectionSchema.partial()), async (req, res) => {
  const c = await ownCollection(req.reader!.id, parsed<{ id: string }>(req, "params").id);
  const updated = unwrap(await db.from("collections").update(req.body as Partial<z.infer<typeof collectionSchema>>).eq("id", c.id).select("*").single());
  const items = unwrap(await db.from("collection_items").select("item_key").eq("collection_id", c.id));
  res.json({ collection: collectionOf(updated, items.map((i) => i.item_key)) });
});

libraryRouter.delete("/collections/:id", validate("params", collectionParam), async (req, res) => {
  const c = await ownCollection(req.reader!.id, parsed<{ id: string }>(req, "params").id);
  await db.from("collections").delete().eq("id", c.id);
  res.status(204).end();
});

/** Puts an item in the collection, or takes it out when it is already there. The key is a saved item's href or "chat:<id>". */
libraryRouter.post("/collections/:id/toggle", validate("params", collectionParam), validate("body", z.object({ key: z.string().min(1).max(300) })), async (req, res) => {
  const c = await ownCollection(req.reader!.id, parsed<{ id: string }>(req, "params").id);
  const key = req.body.key as string;
  const existing = await db.from("collection_items").select("item_key").eq("collection_id", c.id).eq("item_key", key).maybeSingle();
  if (existing.data) await db.from("collection_items").delete().eq("collection_id", c.id).eq("item_key", key);
  else await db.from("collection_items").insert({ collection_id: c.id, item_key: key });
  res.json({ inCollection: !existing.data });
});

/* ---------------------------------------------------------------- history */

const historyQuery = z.object({ kind: z.enum(["search", "reads"]).optional(), limit: z.coerce.number().int().min(1).max(HISTORY_LIMIT).default(HISTORY_LIMIT) });

libraryRouter.get("/history", validate("query", historyQuery), async (req, res) => {
  const q = parsed<z.infer<typeof historyQuery>>(req, "query");
  let query = db.from("research_history").select("*").eq("user_id", req.reader!.id).order("created_at", { ascending: false }).limit(q.limit);
  if (q.kind === "search") query = query.eq("kind", "search");
  if (q.kind === "reads") query = query.neq("kind", "search");
  res.json({ history: unwrap(await query).map(historyOf) });
});

const recordSchema = z.object({
  kind: z.enum(historyKinds),
  title: z.object({ en: z.string().trim().min(1).max(300), bn: z.string().trim().min(1).max(300) }),
  context: z.object({ en: z.string().trim().max(300), bn: z.string().trim().max(300) }).optional(),
  scope: z.enum(["laws", "cases"]).optional(),
  href: z.string().max(400).regex(/^\/dashboard\//, "Not a dashboard path."),
});

/** Records a page opened or a search made, honouring the reader's "record" settings; a repeat within half an hour
 * refreshes the last entry instead of adding one. */
libraryRouter.post("/history", validate("body", recordSchema), async (req, res) => {
  const me = req.reader!;
  const b = req.body as z.infer<typeof recordSchema>;
  const prefs = (me.preferences ?? {}) as { recordSearches?: boolean; recordReads?: boolean };
  const allowed = b.kind === "search" ? prefs.recordSearches !== false : prefs.recordReads !== false;
  if (!allowed) {
    res.json({ recorded: false });
    return;
  }
  const last = await db.from("research_history").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const row = { kind: b.kind, title: b.title.en, title_bn: b.title.bn, context: b.context?.en ?? null, context_bn: b.context?.bn ?? null, scope: b.scope ?? null, href: b.href };
  if (last.data && last.data.kind === b.kind && last.data.href === b.href && Date.now() - Date.parse(last.data.created_at) < REPEAT_MS) {
    const updated = unwrap(await db.from("research_history").update({ ...row, created_at: new Date().toISOString() }).eq("id", last.data.id).select("*").single());
    res.json({ recorded: true, entry: historyOf(updated) });
    return;
  }
  const entry = unwrap(await db.from("research_history").insert({ user_id: me.id, ...row }).select("*").single());
  // Keep the log to its size: drop whatever fell past the limit
  const overflow = await db.from("research_history").select("id").eq("user_id", me.id).order("created_at", { ascending: false }).range(HISTORY_LIMIT, HISTORY_LIMIT + 50);
  if (overflow.data?.length) await db.from("research_history").delete().in("id", overflow.data.map((o) => o.id));
  res.status(201).json({ recorded: true, entry: historyOf(entry) });
});

libraryRouter.delete("/history/:id", validate("params", z.object({ id: z.uuid() })), async (req, res) => {
  await db.from("research_history").delete().eq("user_id", req.reader!.id).eq("id", parsed<{ id: string }>(req, "params").id);
  res.status(204).end();
});

/** Empties the log, or only the searches / only the reads. */
libraryRouter.delete("/history", validate("query", z.object({ only: z.enum(["search", "reads"]).optional() })), async (req, res) => {
  const { only } = parsed<{ only?: string }>(req, "query");
  let query = db.from("research_history").delete().eq("user_id", req.reader!.id);
  if (only === "search") query = query.eq("kind", "search");
  if (only === "reads") query = query.neq("kind", "search");
  await query;
  res.status(204).end();
});
