import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../../config/env.js";
import { verifyAccessToken } from "../../lib/accounts.js";
import { unwrap } from "../../lib/errors.js";
import { sendMail } from "../../lib/mail/send.js";
import { escape, layout, paragraphs, row } from "../../lib/mail/templates/layout.js";
import { db } from "../../lib/supabase.js";
import { notifyTeam } from "../../lib/telegram.js";
import { validate } from "../../middleware/validate.js";

// The contact page's form: the message is kept for the team (admin → Contact messages), copied to the support
// inbox and, when the Telegram bot is set up, to the team's chat. A signed-in reader's message is linked to them.

export const contactRouter = Router();

export const contactTopics = ["general", "billing", "technical", "partnership", "content", "other"] as const;

const messageSchema = z.object({
  name: z.string().trim().min(1, "Write your name.").max(120),
  email: z.email("Enter a valid email address.").max(200),
  phone: z.string().trim().max(30).default(""),
  topic: z.enum(contactTopics).default("general"),
  subject: z.string().trim().max(200).default(""),
  message: z.string().trim().min(10, "Write a few more words.").max(5_000),
  lang: z.enum(["en", "bn"]).default("en"),
  // Left empty by people; bots fill every field
  website: z.string().max(0).optional(),
});

const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 6, standardHeaders: "draft-8", legacyHeaders: false, message: { error: { code: "too_many_requests", message: "Too many messages from here. Try again in an hour." } } });

async function readerId(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const user = await verifyAccessToken(authorization.slice(7)).catch(() => null);
  return user?.id ?? null;
}

contactRouter.post("/messages", limiter, validate("body", messageSchema), async (req, res) => {
  const b = req.body as z.infer<typeof messageSchema>;
  const userId = await readerId(req.headers.authorization);
  const profile = userId ? (await db.from("profiles").select("id").eq("id", userId).maybeSingle()).data : null;
  const row_ = unwrap(
    await db
      .from("contact_messages")
      .insert({ name: b.name, email: b.email.toLowerCase(), phone: b.phone, topic: b.topic, subject: b.subject, message: b.message, lang: b.lang, user_id: profile?.id ?? null, ip: req.ip ?? null })
      .select("*")
      .single(),
  );

  const inbox = env.SUPPORT_INBOX || env.smtp?.user;
  const title = `[Contact ${row_.public_id}] ${b.subject || b.topic} — ${b.name}`;
  const body = `${b.message}\n\n— ${b.name} <${b.email}>${b.phone ? ` · ${b.phone}` : ""}\n${env.ADMIN_URL}/messages?open=${row_.public_id}`;
  if (inbox) void sendMail({ to: inbox, replyTo: b.email, subject: title, text: body, html: layout("en", row(`<strong>${escape(title)}</strong>`) + row(paragraphs(body))) });
  void notifyTeam(`✉️ New contact message ${row_.public_id}\nFrom: ${b.name} <${b.email}>${b.phone ? `\nPhone: ${b.phone}` : ""}\nTopic: ${b.topic}${b.subject ? `\nSubject: ${b.subject}` : ""}\n\n${b.message.slice(0, 1200)}`);

  res.status(201).json({ id: row_.public_id });
});
