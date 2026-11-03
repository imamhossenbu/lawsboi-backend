import { randomBytes } from "node:crypto";
import { db } from "./supabase.js";
import { logger } from "./logger.js";

// The team's Telegram bot and the SMS verification set-up, kept in site_settings under "sms_verification" (admin →
// Settings → SMS verification). The bot tells the team's chat about new payments, auto-verifications, contact
// messages and tickets, and can take forwarded bKash/Nagad SMS. Secrets (the bot token, the webhook secrets) never
// leave the API; the panel sees only whether they are set.

export interface SmsSettings {
  /** Accept SMS from the forwarder app (and from the bot's chat). */
  enabled: boolean;
  /** Verify an awaiting payment by itself when an SMS with its transaction id and enough money arrives. */
  autoVerify: boolean;
  /** The secret in the forwarder's webhook address: /hooks/sms/<secret>. */
  webhookSecret: string;
  /** Senders whose SMS count ("bKash", "NAGAD", a phone number); empty takes any sender that parses. */
  allowedSenders: string[];
  telegram: {
    botToken: string;
    botName: string;
    /** The team's chat (a group or a person); the bot answers /start there with its id. */
    chatId: string;
    webhookSecret: string;
    /** Treat a bKash/Nagad SMS pasted or forwarded into the chat as one from the forwarder. */
    acceptSms: boolean;
    notify: { payments: boolean; messages: boolean; tickets: boolean };
  };
}

const KEY = "sms_verification";
const secret = () => randomBytes(18).toString("base64url");

export const defaultSmsSettings = (): SmsSettings => ({
  enabled: false,
  autoVerify: true,
  webhookSecret: secret(),
  allowedSenders: [],
  telegram: { botToken: "", botName: "", chatId: "", webhookSecret: secret(), acceptSms: true, notify: { payments: true, messages: true, tickets: true } },
});

let cached: { at: number; value: SmsSettings } | null = null;

/** The set-up, made (with fresh secrets) the first time it is read. Cached for half a minute. */
export async function smsSettings(fresh = false): Promise<SmsSettings> {
  if (!fresh && cached && Date.now() - cached.at < 30_000) return cached.value;
  const { data } = await db.from("site_settings").select("value").eq("key", KEY).maybeSingle();
  const base = defaultSmsSettings();
  const stored = (data?.value ?? null) as Partial<SmsSettings> | null;
  const value: SmsSettings = stored
    ? { ...base, ...stored, telegram: { ...base.telegram, ...(stored.telegram ?? {}), notify: { ...base.telegram.notify, ...(stored.telegram?.notify ?? {}) } } }
    : base;
  if (!stored) await db.from("site_settings").upsert({ key: KEY, value: value as never });
  cached = { at: Date.now(), value };
  return value;
}

export async function saveSmsSettings(value: SmsSettings, memberId: string | null) {
  await db.from("site_settings").upsert({ key: KEY, value: value as never, updated_by: memberId });
  cached = { at: Date.now(), value };
}

export const newSecret = secret;

/* ----------------------------------------------------------- the bot API */

async function bot<T>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!json?.ok) throw new Error(json?.description ?? `Telegram answered ${res.status}`);
  return json.result as T;
}

/** The bot behind a token ("@LawsboiBot"); throws when the token is wrong. */
export const botInfo = (token: string) => bot<{ id: number; username: string; first_name: string }>(token, "getMe");

/** Points the bot's updates at the API. */
export const setBotWebhook = (token: string, url: string, secretToken: string) =>
  bot<boolean>(token, "setWebhook", { url, secret_token: secretToken, allowed_updates: ["message", "channel_post"], drop_pending_updates: true });

export const removeBotWebhook = (token: string) => bot<boolean>(token, "deleteWebhook", { drop_pending_updates: true });

export async function sendTelegram(token: string, chatId: string | number, text: string) {
  return bot(token, "sendMessage", { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true });
}

/** Tells the team's chat, when the bot is set up and this kind of news is on. Never throws. */
export async function notifyTeam(text: string, kind: keyof SmsSettings["telegram"]["notify"] = "messages") {
  try {
    const s = await smsSettings();
    const t = s.telegram;
    if (!t.botToken || !t.chatId || !t.notify[kind]) return;
    await sendTelegram(t.botToken, t.chatId, text);
  } catch (err) {
    logger.warn({ err }, "telegram notify failed");
  }
}
