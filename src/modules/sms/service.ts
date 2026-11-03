import { unwrap } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { notifyPaymentOutcome } from "../../lib/notify.js";
import { db } from "../../lib/supabase.js";
import { notifyTeam, smsSettings } from "../../lib/telegram.js";
import type { Tables } from "../../types/database.js";
import { notifyPayment } from "../admin/billing/mail.js";
import { verifyPayment } from "../billing/service.js";
import { normalizeTrxId } from "../billing/shared.js";
import { parseSms } from "./parse.js";

// bKash/Nagad SMS from the merchant phone (an SMS forwarder app, or forwarded into the team's Telegram chat) are
// kept in payment_sms and matched to payments by transaction id. With auto-verify on, an awaiting payment whose SMS
// arrives with at least the plan's price is verified at once (reviewed_by stays empty: the SMS did it), the reader
// is told, and the team's chat hears about it. A payment submitted after its SMS is matched at checkout instead.

type SmsRow = Tables<"payment_sms">;
type PaymentRow = Tables<"payments">;

const taka = (n: number) => `৳${n.toLocaleString("en-IN")}`;

export interface IncomingSms {
  source: "webhook" | "telegram";
  sender: string;
  body: string;
}

/** Keeps the SMS and tries to match it; answers the stored row. */
export async function ingestSms(sms: IncomingSms): Promise<SmsRow> {
  const settings = await smsSettings();
  const parsed = parseSms(sms.body, sms.sender);
  const allowed = !settings.allowedSenders.length || settings.allowedSenders.some((s) => sms.sender.toLowerCase().includes(s.toLowerCase()));
  let status: SmsRow["status"] = "unmatched";
  let note: string | null = null;
  if (!parsed.trxId || !parsed.incoming) [status, note] = ["ignored", parsed.trxId ? "not a received payment" : "no transaction id"];
  else if (!allowed) [status, note] = ["ignored", "sender not allowed"];
  else {
    const seen = await db.from("payment_sms").select("id").eq("trx_id", parsed.trxId).neq("status", "ignored").limit(1).maybeSingle();
    if (seen.data) [status, note] = ["duplicate", "already received"];
  }
  const row = unwrap(
    await db
      .from("payment_sms")
      .insert({ source: sms.source, sender: sms.sender.slice(0, 60), body: sms.body.slice(0, 2000), method: parsed.method, amount: parsed.amount, trx_id: parsed.trxId, from_number: parsed.from, status, note })
      .select("*")
      .single(),
  );
  if (status !== "unmatched") return row;
  const payment = await db.from("payments").select("*").eq("trx_id", normalizeTrxId(parsed.trxId!)).eq("status", "awaiting").maybeSingle();
  if (payment.data) return (await settle(row, payment.data, settings.autoVerify)).sms;
  void notifyTeam(`📩 ${parsed.method === "nagad" ? "Nagad" : "bKash"} SMS ${taka(parsed.amount ?? 0)} · ${parsed.trxId}${parsed.from ? ` · from ${parsed.from}` : ""}\nNo payment with this transaction id yet — it will be matched when the reader submits it.`, "payments");
  return row;
}

/** A payment the reader just submitted: an SMS that came first settles it. */
export async function matchWaitingSms(payment: PaymentRow) {
  try {
    const settings = await smsSettings();
    if (!settings.enabled) return payment;
    const { data: sms } = await db.from("payment_sms").select("*").eq("trx_id", payment.trx_id).eq("status", "unmatched").order("received_at").limit(1).maybeSingle();
    if (!sms) return payment;
    return (await settle(sms, payment, settings.autoVerify)).payment;
  } catch (err) {
    logger.warn({ err }, "sms match at checkout failed");
    return payment;
  }
}

/** Links an SMS and a payment; verifies the payment when allowed and the money is enough. */
export async function settle(sms: SmsRow, payment: PaymentRow, autoVerify: boolean, reviewerId: string | null = null): Promise<{ sms: SmsRow; payment: PaymentRow; verified: boolean }> {
  const short = sms.amount !== null && Number(sms.amount) + 0.01 < payment.amount;
  const wrongWallet = !!sms.method && sms.method !== payment.method;
  const reason = short ? `amount ${taka(Number(sms.amount))} is less than ${taka(payment.amount)}` : wrongWallet ? `SMS is ${sms.method}, payment is ${payment.method}` : null;
  const linked = unwrap(
    await db.from("payment_sms").update({ status: "matched", payment_id: payment.id, note: reason }).eq("id", sms.id).select("*").single(),
  );
  const [reader, plan] = await Promise.all([
    db.from("profiles").select("*").eq("id", payment.user_id).single(),
    db.from("plans").select("*").eq("id", payment.plan_id).maybeSingle(),
  ]);
  const name = reader.data?.name ?? "a reader";
  if (reason || !autoVerify || payment.status !== "awaiting") {
    void notifyTeam(`⚠️ SMS matched ${payment.public_id} (${name}) but it needs a look: ${reason ?? (payment.status !== "awaiting" ? `payment is ${payment.status}` : "auto-verify is off")}.\n${taka(payment.amount)} · ${payment.trx_id}`, "payments");
    return { sms: linked, payment, verified: false };
  }
  const verified = await verifyPayment(payment, reviewerId);
  const planName = { en: plan.data?.name ?? payment.plan_id, bn: plan.data?.name_bn || plan.data?.name || payment.plan_id };
  if (reader.data) notifyPayment(verified, reader.data, plan.data, "verified");
  void notifyPaymentOutcome(verified, "verified", planName);
  void notifyTeam(`✅ Auto-verified ${verified.public_id}: ${name} · ${planName.en} (${verified.cycle}) · ${taka(verified.amount)} by ${verified.method === "nagad" ? "Nagad" : "bKash"} · ${verified.trx_id}`, "payments");
  return { sms: linked, payment: verified, verified: true };
}
