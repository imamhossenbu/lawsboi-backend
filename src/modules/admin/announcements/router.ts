import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { badRequest, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import { logAudit } from "../../audit/service.js";
import { announcementOf, bannerState, channels, flagPlans, gaps, linkPages, textSchema, toDbChannel, topics, type AnnouncementRow } from "../../content/shared.js";
import { deliveries, reach, send, sendDueAnnouncements, startAnnouncementScheduler } from "./service.js";

// Team: announcements to readers. A note in the bell, an email and/or a banner across the reader's dashboard,
// written now, scheduled, or sent at once. A sent announcement can't be edited, only duplicated.

export const adminAnnouncementsRouter = Router();
adminAnnouncementsRouter.use(requireTeam, requirePermission("announcements.view"));
startAnnouncementScheduler();

const idParam = z.object({ id: z.string().regex(/^ANN-\d{4,}$/) });
const label = (a: AnnouncementRow) => ({ en: a.title, bn: a.title_bn || a.title });
const target = (a: AnnouncementRow) => ({ type: "announcement", id: a.public_id, label: label(a) });

async function load(id: string) {
  return unwrap(await db.from("announcements").select("*").eq("public_id", id).maybeSingle(), "That announcement");
}

async function withDelivery(rows: AnnouncementRow[]) {
  const stats = await deliveries(rows.filter((a) => a.status === "sent").map((a) => a.id));
  return rows.map((a) => announcementOf(a, stats.get(a.id)));
}

adminAnnouncementsRouter.get("/", async (_req, res) => {
  await sendDueAnnouncements().catch(() => undefined);
  const rows = unwrap(await db.from("announcements").select("*").order("at", { ascending: false }));
  res.json({ announcements: await withDelivery(rows), topics, channels, plans: flagPlans, linkPages });
});

/** How many readers the chosen plans, topic and channels would reach right now. */
adminAnnouncementsRouter.get(
  "/reach",
  validate("query", z.object({ plans: z.string().default(""), topic: z.enum(topics), channels: z.string().default("inApp") })),
  async (req, res) => {
    const q = parsed<{ plans: string; topic: (typeof topics)[number]; channels: string }>(req, "query");
    const planIds = q.plans.split(",").filter((p): p is (typeof flagPlans)[number] => (flagPlans as readonly string[]).includes(p));
    const chosen = q.channels.split(",").filter((c): c is (typeof channels)[number] => (channels as readonly string[]).includes(c));
    res.json({ reach: await reach({ planIds, topic: q.topic, channels: chosen.map(toDbChannel) }) });
  },
);

const bodySchema = z.object({
  title: textSchema,
  body: textSchema,
  topic: z.enum(topics),
  plans: z.array(z.enum(flagPlans)).default([]),
  channels: z.array(z.enum(channels)).min(1, "Pick at least one channel."),
  link: z.enum(linkPages).nullable().default(null),
  bannerUntil: z.string().datetime({ offset: true }).nullable().default(null),
});
const saveSchema = bodySchema.extend({
  mode: z.enum(["draft", "schedule", "send"]).default("draft"),
  /** For "schedule": when it goes out */
  at: z.string().datetime({ offset: true }).optional(),
});
type SaveInput = z.infer<typeof saveSchema>;

/** Sending needs both languages; a draft may still have gaps. */
function checkReady(b: Pick<SaveInput, "title" | "body" | "mode" | "at">) {
  if (b.mode === "draft") return;
  const missing = gaps([b.title, b.body]);
  if (missing.length) throw badRequest(`Write it in ${missing.join(" and ")} before sending.`, { languages: missing.join(",") });
  if (b.mode === "schedule" && (!b.at || Date.parse(b.at) <= Date.now())) throw badRequest("Pick a time in the future.", { at: "past" });
}

const toRow = (b: SaveInput, memberId: string) => ({
  title: b.title.en,
  title_bn: b.title.bn,
  body: b.body.en,
  body_bn: b.body.bn,
  topic: b.topic,
  plan_ids: b.plans,
  channels: b.channels.map(toDbChannel),
  link: b.link,
  banner_until: b.bannerUntil,
  created_by: memberId,
});

const sendAudit = (b: Pick<SaveInput, "mode" | "at" | "channels">) => ({
  action: b.mode === "send" ? "announcement.send" : b.mode === "schedule" ? "announcement.schedule" : "announcement.draft",
  changes: [{ field: "channels", to: b.channels }, ...(b.mode === "schedule" ? [{ field: "when", to: b.at }] : [])],
});

adminAnnouncementsRouter.post("/", requirePermission("announcements.write"), validate("body", saveSchema), async (req, res) => {
  const b = req.body as SaveInput;
  checkReady(b);
  if (b.mode === "send") requirePermission("announcements.send")(req, res, (err?: unknown) => { if (err) throw err; });
  const status = b.mode === "schedule" ? "scheduled" : "draft";
  let row = unwrap(await db.from("announcements").insert({ ...toRow(b, req.member!.id), status, at: b.mode === "schedule" ? b.at! : new Date().toISOString() }).select("*").single());
  if (b.mode === "send") row = await send(row);
  await logAudit(req, { ...sendAudit(b), target: target(row) });
  res.status(201).json({ announcement: (await withDelivery([row]))[0] });
});

adminAnnouncementsRouter.get("/:id", validate("params", idParam), async (req, res) => {
  const row = await load(parsed<{ id: string }>(req, "params").id);
  res.json({ announcement: (await withDelivery([row]))[0] });
});

/** Edits a draft or scheduled announcement; can also schedule or send it in the same save. */
adminAnnouncementsRouter.patch("/:id", requirePermission("announcements.write"), validate("params", idParam), validate("body", saveSchema), async (req, res) => {
  const before = await load(parsed<{ id: string }>(req, "params").id);
  if (before.status === "sent") throw badRequest("A sent announcement can't be edited. Duplicate it instead.");
  const b = req.body as SaveInput;
  checkReady(b);
  if (b.mode === "send") requirePermission("announcements.send")(req, res, (err?: unknown) => { if (err) throw err; });
  const status = b.mode === "schedule" ? "scheduled" : "draft";
  let row = unwrap(
    await db.from("announcements").update({ ...toRow(b, before.created_by ?? req.member!.id), status, at: b.mode === "schedule" ? b.at! : new Date().toISOString() }).eq("id", before.id).select("*").single(),
  );
  if (b.mode === "send") row = await send(row);
  await logAudit(req, { ...sendAudit(b), target: target(row) });
  res.json({ announcement: (await withDelivery([row]))[0] });
});

adminAnnouncementsRouter.post("/:id/send", requirePermission("announcements.send"), validate("params", idParam), async (req, res) => {
  const before = await load(parsed<{ id: string }>(req, "params").id);
  if (before.status === "sent") throw badRequest("It has already been sent.");
  const missing = gaps([{ en: before.title, bn: before.title_bn }, { en: before.body, bn: before.body_bn }]);
  if (missing.length) throw badRequest(`Write it in ${missing.join(" and ")} before sending.`, { languages: missing.join(",") });
  const row = await send(before);
  await logAudit(req, { action: "announcement.send", target: target(row), changes: [{ field: "channels", to: row.channels.map((c) => (c === "in_app" ? "inApp" : c)) }] });
  res.json({ announcement: (await withDelivery([row]))[0] });
});

/** A scheduled announcement back to a draft. */
adminAnnouncementsRouter.post("/:id/unschedule", requirePermission("announcements.write"), validate("params", idParam), async (req, res) => {
  const before = await load(parsed<{ id: string }>(req, "params").id);
  if (before.status !== "scheduled") throw badRequest("Only a scheduled announcement can be unscheduled.");
  const row = unwrap(await db.from("announcements").update({ status: "draft", at: new Date().toISOString() }).eq("id", before.id).select("*").single());
  await logAudit(req, { action: "announcement.unschedule", target: target(row) });
  res.json({ announcement: announcementOf(row) });
});

adminAnnouncementsRouter.post("/:id/end-banner", requirePermission("announcements.endBanner"), validate("params", idParam), async (req, res) => {
  const before = await load(parsed<{ id: string }>(req, "params").id);
  if (bannerState(before) !== "live") throw badRequest("That banner isn't up.");
  const row = unwrap(await db.from("announcements").update({ banner_ended: true }).eq("id", before.id).select("*").single());
  await logAudit(req, { action: "announcement.endBanner", target: target(row) });
  res.json({ announcement: (await withDelivery([row]))[0] });
});

/** A fresh draft with the same text and settings; the title gets the suffix the panel passes ("(copy)"). */
adminAnnouncementsRouter.post("/:id/duplicate", requirePermission("announcements.write"), validate("params", idParam), validate("body", z.object({ suffix: textSchema.default({ en: " (copy)", bn: " (কপি)" }) })), async (req, res) => {
  const a = await load(parsed<{ id: string }>(req, "params").id);
  const { suffix } = req.body as { suffix: { en: string; bn: string } };
  const row = unwrap(
    await db
      .from("announcements")
      .insert({
        title: a.title + suffix.en,
        title_bn: a.title_bn + suffix.bn,
        body: a.body,
        body_bn: a.body_bn,
        topic: a.topic,
        plan_ids: a.plan_ids,
        channels: a.channels,
        link: a.link,
        banner_until: a.banner_until,
        status: "draft",
        at: new Date().toISOString(),
        created_by: req.member!.id,
      })
      .select("*")
      .single(),
  );
  await logAudit(req, { action: "announcement.duplicate", target: target(a) });
  res.status(201).json({ announcement: announcementOf(row) });
});

adminAnnouncementsRouter.delete("/:id", requirePermission("announcements.delete"), validate("params", idParam), async (req, res) => {
  const a = await load(parsed<{ id: string }>(req, "params").id);
  await logAudit(req, { action: "announcement.delete", target: target(a) });
  unwrap(await db.from("announcements").delete().eq("id", a.id).select("id").single());
  res.status(204).end();
});

/** Sends whatever is due right now (the scheduler does this every minute). */
adminAnnouncementsRouter.post("/send-due", requirePermission("announcements.send"), async (_req, res) => {
  res.json({ sent: await sendDueAnnouncements() });
});
