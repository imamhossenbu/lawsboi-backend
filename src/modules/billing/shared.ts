import { z } from "zod";
import { badRequest } from "../../lib/errors.js";
import type { Json, Tables } from "../../types/database.js";

// Plans and the rules of paying for them, shared by the reader's checkout and the team's payments page.

export type PlanRow = Tables<"plans">;
export type SubscriptionRow = Tables<"subscriptions">;
export type PaymentRow = Tables<"payments">;
export type WalletRow = Tables<"wallet_accounts">;
export type Cycle = "monthly" | "yearly";
export type Method = "bkash" | "nagad";
export type Text = { en: string; bn: string };

export const cycles = ["monthly", "yearly"] as const;
export const methods = ["bkash", "nagad"] as const;
export const paymentStatuses = ["verified", "awaiting", "rejected", "refunded"] as const;
export const rejectReasons = ["not_found", "amount", "duplicate"] as const;
export const planIcons = ["gift", "cap", "crown", "layers"] as const;

export const text = z.object({ en: z.string().trim().max(500), bn: z.string().trim().max(500) });

/** Free means nothing to pay on any cycle. */
export const isFree = (plan: Pick<PlanRow, "price_monthly" | "price_yearly">) => plan.price_monthly === 0 && !plan.price_yearly;

/** Every cycle a plan is sold on: none for a free plan, yearly only when it has a yearly price. */
export const cyclesOf = (plan: Pick<PlanRow, "price_monthly" | "price_yearly">): Cycle[] =>
  isFree(plan) ? [] : plan.price_yearly ? ["monthly", "yearly"] : ["monthly"];

export const priceOf = (plan: Pick<PlanRow, "price_monthly" | "price_yearly">, cycle: Cycle) =>
  cycle === "yearly" ? (plan.price_yearly ?? 0) : plan.price_monthly;

/** A wallet's own transaction id: bKash prints 10 characters, Nagad 8. Case doesn't matter. */
export const TRX_SHAPE: Record<Method, RegExp> = { bkash: /^[A-Z0-9]{10}$/, nagad: /^[A-Z0-9]{8}$/ };
export const normalizeTrxId = (value: string) => value.trim().toUpperCase();
export const isTrxId = (method: Method, value: string) => TRX_SHAPE[method].test(normalizeTrxId(value));

/** The renewal one month or one year after `from`, as a calendar step (31 Jan → 28 Feb, not 2 Mar). */
export function renewalAfter(from: Date, cycle: Cycle) {
  const d = new Date(from);
  if (cycle === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}

/** Monthly recurring revenue in taka: monthly payers at the monthly price, yearly payers at a twelfth of theirs. */
export function recurringRevenue(plans: { price_monthly: number; price_yearly: number | null; subscribers: number; yearlySubscribers: number }[]) {
  return Math.round(plans.reduce((sum, p) => sum + (p.subscribers - p.yearlySubscribers) * p.price_monthly + (p.yearlySubscribers * (p.price_yearly ?? 0)) / 12, 0));
}

/** The plan's feature lines as stored: [{ en, bn }], tolerant of anything older. */
export function featuresOf(value: Json): Text[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((f) => (f && typeof f === "object" && !Array.isArray(f) && typeof f.en === "string" ? [{ en: f.en, bn: typeof f.bn === "string" ? f.bn : f.en }] : []));
}

/** A plan as both sites read it. */
export function planOf(p: PlanRow, counts?: { subscribers: number; yearlySubscribers: number }) {
  return {
    id: p.id,
    name: { en: p.name, bn: p.name_bn },
    description: { en: p.description, bn: p.description_bn },
    price: { monthly: p.price_monthly, yearly: p.price_yearly },
    cycles: cyclesOf(p),
    features: featuresOf(p.features),
    active: p.active,
    isDefault: p.is_default,
    // The pricing page's "Most popular" mark; one plan at most, chosen on the admin's Plans page
    popular: p.popular,
    icon: p.icon,
    subscribers: counts?.subscribers ?? 0,
    yearlySubscribers: counts?.yearlySubscribers ?? 0,
    created: p.created_at,
  };
}

export type ApiPlan = ReturnType<typeof planOf>;

/** camelCase for the apps; the database keeps snake_case enums. */
export const subscriptionStatusOf = (s: SubscriptionRow["status"]) => (s === "past_due" ? "pastDue" : s);
export const rejectReasonOf = (r: PaymentRow["reason"]) => (r === "not_found" ? "notFound" : r);
export const rejectReasonFrom = (r: string): PaymentRow["reason"] => (r === "notFound" ? "not_found" : (r as PaymentRow["reason"]));

export function subscriptionOf(s: SubscriptionRow) {
  return {
    id: s.public_id,
    plan: s.plan_id,
    cycle: s.cycle,
    amount: s.amount,
    status: subscriptionStatusOf(s.status),
    started: s.started_at,
    renews: s.renews_at,
    autoRenew: s.auto_renew,
    canceledAt: s.canceled_at,
  };
}

export function paymentOf(p: PaymentRow) {
  return {
    id: p.public_id,
    subscriptionId: p.subscription_id,
    plan: p.plan_id,
    cycle: p.cycle,
    amount: p.amount,
    method: p.method,
    trxId: p.trx_id,
    status: p.status,
    reason: rejectReasonOf(p.reason),
    submitted: p.submitted_at,
    reviewed: p.reviewed_at,
    refunded: p.refunded_at,
  };
}

export function walletOf(w: WalletRow) {
  return { method: w.method, number: w.number, type: w.type, name: w.name, enabled: w.enabled };
}

/** The checkout's own rule: a paid, active plan sold on that cycle. */
export function assertSellable(plan: PlanRow | null, cycle: Cycle) {
  if (!plan || !plan.active || isFree(plan)) throw badRequest("That plan isn't for sale.", { plan: "unavailable" });
  if (!cyclesOf(plan).includes(cycle)) throw badRequest("That plan isn't sold on that cycle.", { cycle: "unavailable" });
  return plan;
}
