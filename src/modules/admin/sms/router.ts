import { Router, type Request } from "express";
import { z } from "zod";
import { badRequest, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import { botInfo, newSecret, removeBotWebhook, saveSmsSettings, sendTelegram, setBotWebhook, smsSettings, type SmsSettings } from "../../../lib/telegram.js";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { logAudit } from "../../audit/service.js";
import { parseSms } from "../../sms/parse.js";
import { settle } from "../../sms/service.js";

// Settings → SMS verification: the forwarder's webhook address, auto-verify, the Telegram bot (token, chat, what it
// reports), a test of an SMS against the parser and the payments, and the inbox of SMS received with a manual match.

export const adminSmsRouter = Router();
adminSmsRouter.use(requireTeam, requirePermission("settings.view"));

/** The API's own address as the caller reached it (Vercel and Render put the scheme in X-Forwarded-Proto). */
const apiBase = (req: Request) => `${req.protocol}://${req.get("host")}`;

const mask = (token: string) => (token ? `${token.slice(0, 4)}…${token.slice(-4)}` : "");

function shape(s: SmsSettings, req: Request) {
  return {
    enabled: s.enabled,
    autoVerify: s.autoVerify,
    allowedSenders: s.allowedSenders,
    webhookUrl: `${apiBase(req)}/hooks/sms/${s.webhookSecret}`,
    telegram: {
      connected: !!s.telegram.botToken,
      token: mask(s.telegram.botToken),
      botName: s.telegram.botName,
      chatId: s.telegram.chatId,
      acceptSms: s.telegram.acceptSms,
      notify: s.telegram.notify,
    },
  };
}

const smsOf = (r: { id: string; source: string; sender: string; body: string; method: string | null; amount: number | null; trx_id: string | null; from_number: string | null; status: string; note: string | null; received_at: string }, payments: Map<string, { public_id: string; status: string }>, paymentId: string | null) => ({
  id: r.id,
  source: r.source,
  sender: r.sender,
  body: r.body,
  method: r.method,
  amount: r.amount === null ? null : Number(r.amount),
  trxId: r.trx_id,
  from: r.from_number,
  status: r.status,
  note: r.note,
  payment: paymentId ? (payments.get(paymentId) ?? null) : null,
  receivedAt: r.received_at,
});

adminSmsRouter.get("/", async (req, res) => {
  res.json({ settings: shape(await smsSettings(true), req) });
});

const inboxQuery = z.object({
  status: z.enum(["matched", "unmatched", "ignored", "duplicate", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

/** The SMS received, newest first, with the payment each matched. */
adminSmsRouter.get("/inbox", validate("query", inboxQuery), async (req, res) => {
  const q = parsed<z.infer<typeof inboxQuery>>(req, "query");
  let query = db.from("payment_sms").select("*", { count: "exact" }).order("received_at", { ascending: false });
  if (q.status !== "all") query = query.eq("status", q.status);
  const from = (q.page - 1) * q.perPage;
  const [{ data, count }, unmatched, matched] = await Promise.all([
    query.range(from, from + q.perPage - 1),
    db.from("payment_sms").select("id", { count: "exact", head: true }).eq("status", "unmatched"),
    db.from("payment_sms").select("id", { count: "exact", head: true }).eq("status", "matched"),
  ]);
  const rows = data ?? [];
  const ids = rows.map((r) => r.payment_id).filter((x): x is string => !!x);
  const payments = new Map(ids.length ? unwrap(await db.from("payments").select("id,public_id,status").in("id", ids)).map((p) => [p.id, { public_id: p.public_id, status: p.status }]) : []);
  res.json({ sms: rows.map((r) => smsOf(r, payments, r.payment_id)), total: count ?? 0, page: q.page, perPage: q.perPage, counts: { unmatched: unmatched.count ?? 0, matched: matched.count ?? 0 } });
});

const saveSchema = z.object({
  enabled: z.boolean(),
  autoVerify: z.boolean(),
  allowedSenders: z.array(z.string().trim().min(1).max(40)).max(20),
  telegram: z.object({
    // "" keeps the saved token, null removes the bot
    botToken: z.string().trim().regex(/^(\d{6,12}:[\w-]{30,60})?$/, "That doesn't look like a bot token from @BotFather.").nullable(),
    chatId: z.string().trim().regex(/^(-?\d{3,20}|@\w{4,40})?$/, "A chat id is a number (groups start with -100).").default(""),
    acceptSms: z.boolean(),
    notify: z.object({ payments: z.boolean(), messages: z.boolean(), tickets: z.boolean() }),
  }),
});

adminSmsRouter.put("/", requirePermission("settings.sms"), validate("body", saveSchema), async (req, res) => {
  const b = req.body as z.infer<typeof saveSchema>;
  const before = await smsSettings(true);
  const next: SmsSettings = {
    ...before,
    enabled: b.enabled,
    autoVerify: b.autoVerify,
    allowedSenders: b.allowedSenders,
    telegram: { ...before.telegram, chatId: b.telegram.chatId, acceptSms: b.telegram.acceptSms, notify: b.telegram.notify },
  };
  if (b.telegram.botToken === null && before.telegram.botToken) {
    await removeBotWebhook(before.telegram.botToken).catch(() => undefined);
    next.telegram = { ...next.telegram, botToken: "", botName: "" };
  } else if (b.telegram.botToken && b.telegram.botToken !== before.telegram.botToken) {
    // A new bot: check the token, then point its updates here under a fresh secret
    const info = await botInfo(b.telegram.botToken).catch((err: Error) => {
      throw badRequest(`Telegram didn't accept that token: ${err.message}`, { botToken: "invalid" });
    });
    const secret = newSecret();
    await setBotWebhook(b.telegram.botToken, `${apiBase(req)}/hooks/telegram/${secret}`, secret).catch((err: Error) => {
      throw badRequest(`Telegram couldn't reach the API: ${err.message}`, { botToken: "webhook" });
    });
    next.telegram = { ...next.telegram, botToken: b.telegram.botToken, botName: info.username, webhookSecret: secret };
  }
  await saveSmsSettings(next, req.member!.id);
  await logAudit(req, {
    action: "settings.sms",
    target: { type: "settings", id: "sms", label: { en: "SMS verification", bn: "এসএমএস যাচাই" } },
    changes: [
      { field: "enabled", from: before.enabled, to: next.enabled },
      { field: "autoVerify", from: before.autoVerify, to: next.autoVerify },
      { field: "telegram", from: !!before.telegram.botToken, to: !!next.telegram.botToken },
    ].filter((c) => c.from !== c.to),
  });
  res.json({ settings: shape(next, req) });
});

/** A new webhook secret: the old address stops working (the forwarder app needs the new one). */
adminSmsRouter.post("/rotate", requirePermission("settings.sms"), async (req, res) => {
  const s = await smsSettings(true);
  const next = { ...s, webhookSecret: newSecret() };
  await saveSmsSettings(next, req.member!.id);
  await logAudit(req, { action: "settings.sms", target: { type: "settings", id: "sms", label: { en: "SMS verification", bn: "এসএমএস যাচাই" } }, changes: [{ field: "webhookSecret", to: "rotated" }] });
  res.json({ settings: shape(next, req) });
});

/** A message to the team's chat, to see that the bot and the chat id work. */
adminSmsRouter.post("/telegram/test", requirePermission("settings.sms"), async (req, res) => {
  const t = (await smsSettings(true)).telegram;
  if (!t.botToken || !t.chatId) throw badRequest("Add the bot token and the chat id first.");
  await sendTelegram(t.botToken, t.chatId, `✅ Lawsboi test message from ${req.member!.name}. The bot can reach this chat.`).catch((err: Error) => {
    throw badRequest(`Telegram said: ${err.message}`);
  });
  res.json({ ok: true });
});

/** What the parser reads in an SMS, and the payment it would match (nothing is stored). */
adminSmsRouter.post("/test", validate("body", z.object({ text: z.string().trim().min(5).max(2000), sender: z.string().max(60).default("") })), async (req, res) => {
  const p = parseSms(req.body.text, req.body.sender);
  const payment = p.trxId ? (await db.from("payments").select("public_id,amount,method,status").eq("trx_id", p.trxId).maybeSingle()).data : null;
  res.json({ parsed: p, payment });
});

/** Links an SMS to a payment by hand (a typo in the transaction id) and verifies it. */
adminSmsRouter.post("/:id/match", requirePermission("payments.verify"), validate("params", z.object({ id: z.uuid() })), validate("body", z.object({ paymentId: z.string().regex(/^PAY-\d{6}$/) })), async (req, res) => {
  const sms = unwrap(await db.from("payment_sms").select("*").eq("id", parsed<{ id: string }>(req, "params").id).maybeSingle(), "That SMS");
  const payment = unwrap(await db.from("payments").select("*").eq("public_id", req.body.paymentId).maybeSingle(), "That payment");
  if (payment.status !== "awaiting") throw badRequest("That payment has already been reviewed.");
  const out = await settle(sms, payment, true, req.member!.id);
  await logAudit(req, { action: "sms.match", target: { type: "payment", id: payment.public_id, label: { en: payment.public_id, bn: payment.public_id } }, changes: [{ field: "trxId", to: sms.trx_id }] });
  res.json({ verified: out.verified, payment: out.payment.public_id, status: out.payment.status });
});
