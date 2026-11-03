import { Router } from "express";
import { z } from "zod";
import { env } from "../../../config/env.js";
import { unwrap } from "../../../lib/errors.js";
import { sendMail } from "../../../lib/mail/send.js";
import { button, escape, footnote, layout, paragraphs, row } from "../../../lib/mail/templates/layout.js";
import { db } from "../../../lib/supabase.js";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import type { Tables } from "../../../types/database.js";
import { logAudit } from "../../audit/service.js";

// The contact page's messages for the team: the inbox (new, read, replied, archived), one message (opening it marks
// it read), a reply emailed to the sender, and marking or archiving.

export const adminMessagesRouter = Router();
adminMessagesRouter.use(requireTeam, requirePermission("messages.view"));

type MessageRow = Tables<"contact_messages">;
const statuses = ["new", "read", "replied", "archived"] as const;

async function teamNames(ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map<string, string>();
  const { data } = await db.from("team_members").select("id,public_id").in("id", wanted);
  return new Map((data ?? []).map((m) => [m.id, m.public_id]));
}

const messageOf = (m: MessageRow, team: Map<string, string>, reader?: { public_id: string; name: string } | null) => ({
  id: m.public_id,
  name: m.name,
  email: m.email,
  phone: m.phone,
  topic: m.topic,
  subject: m.subject,
  message: m.message,
  lang: m.lang,
  status: m.status,
  reader: reader ? { id: reader.public_id, name: reader.name } : null,
  reply: m.reply,
  repliedAt: m.replied_at,
  repliedBy: m.replied_by ? (team.get(m.replied_by) ?? null) : null,
  readAt: m.read_at,
  createdAt: m.created_at,
});

const listQuery = z.object({
  status: z.enum([...statuses, "all", "open"]).default("open"),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

/** The inbox, newest first: "open" is everything not archived. Counts per status come with it. */
adminMessagesRouter.get("/", validate("query", listQuery), async (req, res) => {
  const q = parsed<z.infer<typeof listQuery>>(req, "query");
  let query = db.from("contact_messages").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (q.status === "open") query = query.neq("status", "archived");
  else if (q.status !== "all") query = query.eq("status", q.status);
  if (q.q) {
    const term = q.q.replace(/[%_,()]/g, " ");
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,subject.ilike.%${term}%,message.ilike.%${term}%,public_id.ilike.%${term}%`);
  }
  const from = (q.page - 1) * q.perPage;
  const [{ data, count }, ...counts] = await Promise.all([
    query.range(from, from + q.perPage - 1),
    ...statuses.map((s) => db.from("contact_messages").select("id", { count: "exact", head: true }).eq("status", s)),
  ]);
  const rows = data ?? [];
  const team = await teamNames(rows.map((r) => r.replied_by));
  const readers = rows.some((r) => r.user_id) ? unwrap(await db.from("profiles").select("id,public_id,name").in("id", rows.map((r) => r.user_id).filter((x): x is string => !!x))) : [];
  const byReader = new Map(readers.map((r) => [r.id, r]));
  res.json({
    messages: rows.map((m) => messageOf(m, team, m.user_id ? byReader.get(m.user_id) : null)),
    total: count ?? 0,
    page: q.page,
    perPage: q.perPage,
    counts: Object.fromEntries(statuses.map((s, i) => [s, counts[i]!.count ?? 0])),
  });
});

const idParam = z.object({ id: z.string().regex(/^MSG-\d{6}$/) });

async function findMessage(id: string) {
  return unwrap(await db.from("contact_messages").select("*").eq("public_id", id).maybeSingle(), "That message");
}

async function shaped(m: MessageRow) {
  const reader = m.user_id ? (await db.from("profiles").select("public_id,name").eq("id", m.user_id).maybeSingle()).data : null;
  return messageOf(m, await teamNames([m.replied_by]), reader);
}

/** One message; opening a new one marks it read. */
adminMessagesRouter.get("/:id", validate("params", idParam), async (req, res) => {
  let m = await findMessage(parsed<{ id: string }>(req, "params").id);
  if (m.status === "new") m = unwrap(await db.from("contact_messages").update({ status: "read", read_at: new Date().toISOString() }).eq("id", m.id).select("*").single());
  res.json({ message: await shaped(m) });
});

adminMessagesRouter.patch("/:id", requirePermission("messages.manage"), validate("params", idParam), validate("body", z.object({ status: z.enum(statuses) })), async (req, res) => {
  const before = await findMessage(parsed<{ id: string }>(req, "params").id);
  const status = req.body.status as MessageRow["status"];
  const m = unwrap(await db.from("contact_messages").update({ status, ...(status === "new" ? { read_at: null } : {}) }).eq("id", before.id).select("*").single());
  await logAudit(req, { action: "contact.status", target: { type: "message", id: m.public_id, label: { en: m.name, bn: m.name } }, changes: [{ field: "status", from: before.status, to: status }] });
  res.json({ message: await shaped(m) });
});

const copy = {
  en: { subject: "Re: {subject}", hello: "Hello {name},", yours: "You wrote:", sign: "— The Lawsboi team", more: "Visit Lawsboi" },
  bn: { subject: "উত্তর: {subject}", hello: "প্রিয় {name},", yours: "আপনি লিখেছিলেন:", sign: "— Lawsboi টিম", more: "Lawsboi-তে যান" },
} as const;

/** Emails the reply to the sender (their original quoted under it) and marks the message replied. */
adminMessagesRouter.post("/:id/reply", requirePermission("messages.reply"), validate("params", idParam), validate("body", z.object({ text: z.string().trim().min(2).max(10_000) })), async (req, res) => {
  const m = await findMessage(parsed<{ id: string }>(req, "params").id);
  const c = copy[m.lang];
  const text = req.body.text as string;
  const subject = c.subject.replace("{subject}", m.subject || m.topic);
  const site = `${env.READER_URL}${m.lang === "bn" ? "/bn" : ""}`;
  const plain = `${c.hello.replace("{name}", m.name)}\n\n${text}\n\n${c.sign}\n\n${c.yours}\n> ${m.message.replace(/\n/g, "\n> ")}`;
  const html = layout(
    m.lang,
    row(escape(c.hello.replace("{name}", m.name))) + row(paragraphs(text)) + row(escape(c.sign)) + button(site, c.more) + footnote(`${c.yours}\n${m.message}`),
  );
  const sent = await sendMail({ to: m.email, subject, text: plain, html, replyTo: env.SUPPORT_INBOX || undefined });
  const updated = unwrap(
    await db.from("contact_messages").update({ status: "replied", reply: text, replied_at: new Date().toISOString(), replied_by: req.member!.id }).eq("id", m.id).select("*").single(),
  );
  await logAudit(req, { action: "contact.reply", target: { type: "message", id: m.public_id, label: { en: m.name, bn: m.name } } });
  res.json({ message: await shaped(updated), mail: sent });
});
