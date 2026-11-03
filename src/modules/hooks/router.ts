import express, { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { db } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { sendTelegram, smsSettings } from "../../lib/telegram.js";
import { parseSms } from "../sms/parse.js";
import { ingestSms } from "../sms/service.js";

// Calls from outside, each behind a secret in its address (admin → Settings → SMS verification shows them):
//   POST /hooks/sms/<secret>       an SMS forwarder app on the merchant phone, for every bKash/Nagad SMS
//   POST /hooks/telegram/<secret>  the team's Telegram bot (Telegram also sends the secret in a header)
// Forwarder apps differ in what they send, so the SMS hook takes JSON or a form, with the text and the sender under
// any of the usual names.

export const hooksRouter = Router();
hooksRouter.use(express.urlencoded({ extended: false, limit: "64kb" }));
hooksRouter.use(express.text({ type: "text/*", limit: "64kb" }));

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const pick = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
};

const TEXT_KEYS = ["text", "message", "body", "msg", "content", "sms", "smsText", "message_body"];
const SENDER_KEYS = ["from", "sender", "phone", "number", "address", "originatingAddress", "title"];

hooksRouter.all("/sms/:secret", async (req, res) => {
  const settings = await smsSettings();
  if (!same(String(req.params.secret ?? ""), settings.webhookSecret)) return void res.status(404).json({ error: { code: "not_found", message: "Not found." } });
  if (!settings.enabled) return void res.status(202).json({ ok: true, ignored: "SMS verification is off" });
  // A GET with ?text= helps when testing the address from a browser or a simple forwarder
  const raw = typeof req.body === "string" ? { text: req.body } : ((req.body ?? {}) as Record<string, unknown>);
  const source = { ...(req.query as Record<string, unknown>), ...raw };
  const body = pick(source, TEXT_KEYS);
  if (!body) return void res.status(400).json({ error: { code: "bad_request", message: "No SMS text in the request (send it as text, message or body)." } });
  const row = await ingestSms({ source: "webhook", sender: pick(source, SENDER_KEYS), body });
  res.json({ ok: true, status: row.status, trxId: row.trx_id });
});

interface TelegramUpdate {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}
interface TelegramMessage {
  chat: { id: number; title?: string; type: string };
  text?: string;
  caption?: string;
  forward_origin?: unknown;
}

hooksRouter.post("/telegram/:secret", express.json({ limit: "256kb" }), async (req, res) => {
  const settings = await smsSettings();
  const t = settings.telegram;
  const header = req.get("x-telegram-bot-api-secret-token") ?? "";
  if (!t.botToken || !same(String(req.params.secret ?? ""), t.webhookSecret) || !same(header, t.webhookSecret)) return void res.status(404).end();
  // Telegram retries anything but 200, so the answer is always 200 and the work is best-effort
  res.json({ ok: true });

  const update = req.body as TelegramUpdate;
  const msg = update.message ?? update.channel_post;
  if (!msg) return;
  const text = (msg.text ?? msg.caption ?? "").trim();
  const chatId = String(msg.chat.id);
  const reply = (s: string) => sendTelegram(t.botToken, chatId, s).catch((err) => logger.warn({ err }, "telegram reply failed"));

  try {
    if (/^\/(start|id)\b/.test(text)) {
      const known = t.chatId === chatId;
      return void (await reply(
        known
          ? "✅ Lawsboi is connected to this chat. You'll get payments, contact messages and tickets here.\nPaste or forward a bKash/Nagad SMS to verify a payment.\n/pending — payments waiting for verification"
          : `👋 This chat's id is ${chatId}\nPaste it into the Lawsboi admin panel → Settings → SMS verification → Telegram chat id, then send /start again.`,
      ));
    }
    // Only the team's own chat may talk to the bot beyond telling its id
    if (t.chatId !== chatId) return;
    if (/^\/pending\b/.test(text)) {
      const { data } = await db.from("payments").select("public_id,amount,method,trx_id,submitted_at").eq("status", "awaiting").order("submitted_at").limit(15);
      return void (await reply(
        data?.length
          ? `⏳ ${data.length} payment(s) waiting:\n${data.map((p) => `• ${p.public_id} · ৳${p.amount} · ${p.method} · ${p.trx_id}`).join("\n")}`
          : "Nothing waiting — every payment is verified.",
      ));
    }
    if (!t.acceptSms || !settings.enabled) return;
    const parsed = parseSms(text);
    if (!parsed.trxId) return;
    const row = await ingestSms({ source: "telegram", sender: parsed.method ?? "telegram", body: text });
    if (row.status === "duplicate") await reply(`ℹ️ ${row.trx_id} was already received.`);
    else if (row.status === "ignored") await reply(`ℹ️ Not counted: ${row.note ?? "not a received payment"}.`);
    else if (row.status === "unmatched") await reply(`📥 Saved ${row.trx_id} (৳${row.amount ?? "?"}). It will be matched when the reader submits it.`);
  } catch (err) {
    logger.warn({ err }, "telegram update failed");
  }
});
