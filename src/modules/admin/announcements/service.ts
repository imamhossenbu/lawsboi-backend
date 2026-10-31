import { env } from "../../../config/env.js";
import { logger } from "../../../lib/logger.js";
import { sendMail } from "../../../lib/mail/send.js";
import { db } from "../../../lib/supabase.js";
import { unwrap } from "../../../lib/errors.js";
import { announcementMail } from "./mail.js";
import { fromDbChannel, type AnnouncementRow, type Channel, type DbChannel, type Delivery } from "../../content/shared.js";

// Sending: who an announcement reaches on each channel, writing the deliveries, emailing in the background, and
// the scheduler that sends what's due.

/** Readers the announcement would reach on one channel. */
export async function recipients(planIds: string[], topic: string, channel: DbChannel) {
  return unwrap(await db.rpc("announcement_recipients", { plan_ids: planIds, topic, channel }));
}

/** How many readers each chosen channel would reach right now. */
export async function reach(a: { planIds: string[]; topic: string; channels: DbChannel[] }): Promise<Partial<Record<Channel, number>>> {
  const counts = await Promise.all(
    a.channels.map(async (c) => {
      const { count } = await db.rpc("announcement_recipients", { plan_ids: a.planIds, topic: a.topic, channel: c }, { count: "exact", head: true });
      return [fromDbChannel(c), count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts);
}

/** Delivered and opened per channel, for a set of announcements. */
export async function deliveries(ids: string[]): Promise<Map<string, Delivery>> {
  const out = new Map<string, Delivery>();
  if (!ids.length) return out;
  const rows = unwrap(await db.from("announcement_delivery_stats").select("*").in("announcement_id", ids));
  for (const r of rows) {
    if (!r.announcement_id || !r.channel) continue;
    const d = out.get(r.announcement_id) ?? { reached: {}, opened: {} };
    const c = fromDbChannel(r.channel);
    d.reached[c] = r.reached ?? 0;
    d.opened[c] = r.opened ?? 0;
    out.set(r.announcement_id, d);
  }
  return out;
}

/** Marks the announcement sent and delivers it: bell rows now, emails in the background. A banner needs no rows,
 * readers are counted as they see it. Safe to call twice: the second call finds it already sent. */
export async function send(a: AnnouncementRow): Promise<AnnouncementRow> {
  const now = new Date().toISOString();
  const claimed = await db
    .from("announcements")
    .update({ status: "sent", sent_at: now, at: now, sending_started_at: now })
    .eq("id", a.id)
    .neq("status", "sent")
    .select("*")
    .maybeSingle();
  if (!claimed.data) return unwrap(await db.from("announcements").select("*").eq("id", a.id).single());
  const sent = claimed.data;

  if (sent.channels.includes("in_app")) {
    const readers = await recipients(sent.plan_ids, sent.topic, "in_app");
    for (let i = 0; i < readers.length; i += 500) {
      const batch = readers.slice(i, i + 500).map((r) => ({ announcement_id: sent.id, user_id: r.id, channel: "in_app" as const, delivered_at: now }));
      const { error } = await db.from("announcement_deliveries").upsert(batch, { onConflict: "announcement_id,user_id,channel", ignoreDuplicates: true });
      if (error) logger.error({ error, id: sent.public_id }, "bell deliveries not written");
    }
  }
  if (sent.channels.includes("email")) void emailEveryone(sent);
  return sent;
}

async function emailEveryone(a: AnnouncementRow) {
  const readers = await recipients(a.plan_ids, a.topic, "email").catch((err: unknown) => {
    logger.error({ err, id: a.public_id }, "email recipients not loaded");
    return [];
  });
  let delivered = 0;
  // A few at a time keeps the SMTP pool happy; one failure doesn't stop the rest
  for (let i = 0; i < readers.length; i += 3) {
    await Promise.all(
      readers.slice(i, i + 3).map(async (r) => {
        const lang = r.lang === "bn" ? "bn" : "en";
        const mail = announcementMail({ title: lang === "bn" ? a.title_bn : a.title, body: lang === "bn" ? a.body_bn : a.body, link: a.link }, lang, env.READER_URL);
        const result = await sendMail({ to: r.email, ...mail });
        if (result === "failed") return;
        delivered++;
        await db.from("announcement_deliveries").upsert({ announcement_id: a.id, user_id: r.id, channel: "email" }, { onConflict: "announcement_id,user_id,channel", ignoreDuplicates: true });
      }),
    );
  }
  logger.info({ id: a.public_id, delivered, of: readers.length }, "announcement emailed");
}

/** Sends every scheduled announcement whose time has come. Called by the scheduler and before readers' bells. */
export async function sendDueAnnouncements() {
  const due = unwrap(await db.from("announcements").select("*").eq("status", "scheduled").lte("at", new Date().toISOString()).is("sending_started_at", null).limit(20));
  for (const a of due) await send(a);
  return due.length;
}
