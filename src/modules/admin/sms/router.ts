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
// The set-up is Settings (settings.view, and settings.sms to change it); the SMS log is Payments' (payments.view to
// read it, payments.verify to match), so whoever verifies payments can work it without the settings
adminSmsRouter.use(requireTeam);
const settingsView = requirePermission("settings.view");

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

adminSmsRouter.get("/", settingsView, async (req, res) => {
  res.json({ settings: shape(await smsSettings(true), req) });
});

// What happened to an SMS, in the words the team's Telegram chat used: verified by itself, verified by a member,
// matched but held for a look (short amount, other wallet, auto-verify off), no payment with its transaction id yet,
// the payment was rejected, or the SMS was set aside (not a received payment, a sender not allowed, a repeat).
type Outcome = "auto_verified" | "verified" | "needs_review" | "waiting" | "rejected" | "ignored" | "duplicate";
const VIEWS = ["review", "waiting", "verified", "other", "all"] as const;

const inboxQuery = z.object({
  // review: matched, payment still awaiting · waiting: no payment yet · verified · other: rejected, ignored, repeats
  view: z.enum(VIEWS).default("all"),
  // Older panels ask by the stored status
  status: z.enum(["matched", "unmatched", "ignored", "duplicate", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

type PaymentInfo = {
  id: string;
  public_id: string;
  status: string;
  amount: number;
  method: string;
  cycle: string;
  plan_id: string;
  trx_id: string;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  user_id: string;
};

function outcomeOf(status: string, pay: PaymentInfo | undefined): Outcome {
  if (status === "ignored") return "ignored";
  if (status === "duplicate") return "duplicate";
  if (status === "unmatched" || !pay) return "waiting";
  if (pay.status === "verified" || pay.status === "refunded") return pay.reviewed_by ? "verified" : "auto_verified";
  if (pay.status === "rejected") return "rejected";
  return "needs_review";
}

/** The SMS received, newest first, each with the payment it matched (the reader, the plan, who verified it) and
 * what happened to it; `view` narrows to what needs the team. */
adminSmsRouter.get("/inbox", requirePermission("payments.view"), validate("query", inboxQuery), async (req, res) => {
  const q = parsed<z.infer<typeof inboxQuery>>(req, "query");
  // Every SMS of the last while, so each view can be counted (the inbox is small: a few a day)
  const all = unwrap(await db.from("payment_sms").select("*").order("received_at", { ascending: false }).limit(1000));
  const payIds = [...new Set(all.map((r) => r.payment_id).filter((x): x is string => !!x))];
  const pays = payIds.length
    ? unwrap(await db.from("payments").select("id,public_id,status,amount,method,cycle,plan_id,trx_id,submitted_at,reviewed_at,reviewed_by,user_id").in("id", payIds))
    : [];
  const payBy = new Map(pays.map((p) => [p.id, p as PaymentInfo]));
  const rows = all.map((r) => ({ r, pay: r.payment_id ? payBy.get(r.payment_id) : undefined, outcome: outcomeOf(r.status, r.payment_id ? payBy.get(r.payment_id) : undefined) }));
  const inView = (o: Outcome, v: (typeof VIEWS)[number]) =>
    v === "all" || (v === "review" && o === "needs_review") || (v === "waiting" && o === "waiting") || (v === "verified" && (o === "verified" || o === "auto_verified")) || (v === "other" && (o === "rejected" || o === "ignored" || o === "duplicate"));
  const picked = rows.filter((x) => inView(x.outcome, q.view) && (q.status === "all" || x.r.status === q.status));
  const from = (q.page - 1) * q.perPage;
  const page = picked.slice(from, from + q.perPage);

  // Readers, plans and the members who verified, for the rows on this page
  const userIds = [...new Set(page.map((x) => x.pay?.user_id).filter((x): x is string => !!x))];
  const planIds = [...new Set(page.map((x) => x.pay?.plan_id).filter((x): x is string => !!x))];
  const memberIds = [...new Set(page.map((x) => x.pay?.reviewed_by).filter((x): x is string => !!x))];
  const [users, plans, members] = await Promise.all([
    userIds.length ? db.from("profiles").select("id,name,email").in("id", userIds) : { data: [] },
    planIds.length ? db.from("plans").select("id,name,name_bn").in("id", planIds) : { data: [] },
    memberIds.length ? db.from("team_members").select("id,public_id,name").in("id", memberIds) : { data: [] },
  ]);
  const userBy = new Map((users.data ?? []).map((u) => [u.id, u]));
  const planBy = new Map((plans.data ?? []).map((p) => [p.id, p]));
  const memberBy = new Map((members.data ?? []).map((m) => [m.id, m]));

  const count = (v: (typeof VIEWS)[number]) => rows.filter((x) => inView(x.outcome, v)).length;
  res.json({
    sms: page.map(({ r, pay, outcome }) => ({
      ...smsOf(r, new Map(pay ? [[pay.id, { public_id: pay.public_id, status: pay.status }]] : []), r.payment_id),
      outcome,
      details: pay
        ? {
            id: pay.public_id,
            status: pay.status,
            amount: Number(pay.amount),
            method: pay.method,
            cycle: pay.cycle,
            trxId: pay.trx_id,
            submittedAt: pay.submitted_at,
            reviewedAt: pay.reviewed_at,
            plan: planBy.get(pay.plan_id) ? { id: pay.plan_id, name: { en: planBy.get(pay.plan_id)!.name, bn: planBy.get(pay.plan_id)!.name_bn || planBy.get(pay.plan_id)!.name } } : { id: pay.plan_id, name: { en: pay.plan_id, bn: pay.plan_id } },
            reader: userBy.get(pay.user_id) ? { name: userBy.get(pay.user_id)!.name, email: userBy.get(pay.user_id)!.email } : null,
            verifiedBy: pay.reviewed_by ? (memberBy.get(pay.reviewed_by) ? { id: memberBy.get(pay.reviewed_by)!.public_id, name: memberBy.get(pay.reviewed_by)!.name } : null) : null,
          }
        : null,
    })),
    total: picked.length,
    page: q.page,
    perPage: q.perPage,
    counts: { unmatched: count("waiting"), matched: rows.filter((x) => x.r.status === "matched").length, review: count("review"), waiting: count("waiting"), verified: count("verified"), other: count("other"), all: rows.length },
  });
});

/** Payments still awaiting review that an SMS could belong to: the same wallet and amount first, then the closest
 * in time to when it arrived (a reader who mistyped the transaction id). */
adminSmsRouter.get("/:id/candidates", requirePermission("payments.verify"), validate("params", z.object({ id: z.uuid() })), async (req, res) => {
  const sms = unwrap(await db.from("payment_sms").select("*").eq("id", parsed<{ id: string }>(req, "params").id).maybeSingle(), "That SMS");
  const awaiting = unwrap(
    await db.from("payments").select("id,public_id,amount,method,cycle,plan_id,trx_id,submitted_at,user_id").eq("status", "awaiting").order("submitted_at", { ascending: false }).limit(200),
  );
  const at = new Date(sms.received_at).getTime();
  const score = (p: (typeof awaiting)[number]) =>
    (sms.method && p.method === sms.method ? 0 : 1) * 4 +
    (sms.amount !== null && Math.abs(Number(sms.amount) - Number(p.amount)) < 0.5 ? 0 : 1) * 2 +
    Math.min(1, Math.abs(new Date(p.submitted_at).getTime() - at) / (7 * 86_400_000));
  const best = [...awaiting].sort((a, b) => score(a) - score(b)).slice(0, 8);
  const userIds = [...new Set(best.map((p) => p.user_id))];
  const users = userIds.length ? unwrap(await db.from("profiles").select("id,name,email").in("id", userIds)) : [];
  const userBy = new Map(users.map((u) => [u.id, u]));
  res.json({
    payments: best.map((p) => ({
      id: p.public_id,
      amount: Number(p.amount),
      method: p.method,
      cycle: p.cycle,
      plan: p.plan_id,
      trxId: p.trx_id,
      submittedAt: p.submitted_at,
      reader: userBy.get(p.user_id) ? { name: userBy.get(p.user_id)!.name, email: userBy.get(p.user_id)!.email } : null,
    })),
  });
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

adminSmsRouter.put("/", settingsView, requirePermission("settings.sms"), validate("body", saveSchema), async (req, res) => {
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
adminSmsRouter.post("/rotate", settingsView, requirePermission("settings.sms"), async (req, res) => {
  const s = await smsSettings(true);
  const next = { ...s, webhookSecret: newSecret() };
  await saveSmsSettings(next, req.member!.id);
  await logAudit(req, { action: "settings.sms", target: { type: "settings", id: "sms", label: { en: "SMS verification", bn: "এসএমএস যাচাই" } }, changes: [{ field: "webhookSecret", to: "rotated" }] });
  res.json({ settings: shape(next, req) });
});

/** A message to the team's chat, to see that the bot and the chat id work. */
adminSmsRouter.post("/telegram/test", settingsView, requirePermission("settings.sms"), async (req, res) => {
  const t = (await smsSettings(true)).telegram;
  if (!t.botToken || !t.chatId) throw badRequest("Add the bot token and the chat id first.");
  await sendTelegram(t.botToken, t.chatId, `✅ Lawsboi test message from ${req.member!.name}. The bot can reach this chat.`).catch((err: Error) => {
    throw badRequest(`Telegram said: ${err.message}`);
  });
  res.json({ ok: true });
});

/** What the parser reads in an SMS, and the payment it would match (nothing is stored). */
adminSmsRouter.post("/test", settingsView, validate("body", z.object({ text: z.string().trim().min(5).max(2000), sender: z.string().max(60).default("") })), async (req, res) => {
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
