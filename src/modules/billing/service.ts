import { badRequest, conflict, notFound, unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import type { Tables } from "../../types/database.js";
import {
  assertSellable,
  isTrxId,
  normalizeTrxId,
  planOf,
  priceOf,
  renewalAfter,
  type ApiPlan,
  type Cycle,
  type Method,
  type PaymentRow,
  type PlanRow,
  type SubscriptionRow,
} from "./shared.js";

// What happens to money: a reader submits a wallet transaction id, the team verifies it and the plan switches on.
// Both routers call these so the rules live once.

type ProfileRow = Tables<"profiles">;

/* ------------------------------------------------------------------ plans */

export async function listPlans(onlyActive: boolean): Promise<ApiPlan[]> {
  let query = db.from("plans").select("*").order("sort_order").order("created_at");
  if (onlyActive) query = query.eq("active", true);
  const [plans, counts] = await Promise.all([query, db.rpc("plan_subscriber_counts")]);
  const byPlan = new Map((counts.data ?? []).map((c) => [c.plan_id, { subscribers: Number(c.subscribers), yearlySubscribers: Number(c.yearly_subscribers) }]));
  return unwrap(plans).map((p) => planOf(p, byPlan.get(p.id)));
}

export async function findPlan(id: string): Promise<PlanRow> {
  return unwrap(await db.from("plans").select("*").eq("id", id).maybeSingle(), "That plan");
}

/** The pricing page's comparison matrix, kept in site_settings so the team can change it. */
export async function featureMatrix() {
  const { data } = await db.from("site_settings").select("value").eq("key", "feature_matrix").maybeSingle();
  return Array.isArray(data?.value) ? data.value : [];
}

/* --------------------------------------------------------------- checkout */

export interface CheckoutInput {
  plan: string;
  cycle: Cycle;
  method: Method;
  trxId: string;
}

/** The reader paid into a wallet and typed the transaction id: an awaiting payment for the team to verify. */
export async function submitPayment(user: ProfileRow, input: CheckoutInput): Promise<PaymentRow> {
  const plan = assertSellable(await db.from("plans").select("*").eq("id", input.plan).maybeSingle().then((r) => r.data), input.cycle);
  const wallet = await db.from("wallet_accounts").select("*").eq("method", input.method).maybeSingle();
  if (!wallet.data?.enabled) throw badRequest("That payment method isn't available right now.", { method: "unavailable" });
  if (!isTrxId(input.method, input.trxId)) throw badRequest("That doesn't look like a transaction id from that wallet.", { trxId: "shape" });
  const trxId = normalizeTrxId(input.trxId);

  const duplicate = await db.from("payments").select("id").eq("method", input.method).eq("trx_id", trxId).maybeSingle();
  if (duplicate.data) throw conflict("That transaction id has already been submitted.", { trxId: "duplicate" });
  const pending = await db.from("payments").select("id").eq("user_id", user.id).eq("status", "awaiting").maybeSingle();
  if (pending.data) throw conflict("A payment of yours is still being checked. Wait for it before sending another.", { trxId: "pending" });

  return unwrap(
    await db
      .from("payments")
      .insert({ user_id: user.id, plan_id: plan.id, cycle: input.cycle, amount: priceOf(plan, input.cycle), method: input.method, trx_id: trxId })
      .select("*")
      .single(),
  );
}

/* ------------------------------------------------------------ verification */

export async function findPayment(publicId: string): Promise<PaymentRow> {
  return unwrap(await db.from("payments").select("*").eq("public_id", publicId).maybeSingle(), "That payment");
}

export async function currentSubscription(userId: string): Promise<SubscriptionRow | null> {
  const { data } = await db.from("subscriptions").select("*").eq("user_id", userId).eq("status", "active").order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

/** The money is there: the subscription starts (or, on the same plan, runs on from its renewal date), and the
 * reader's plan switches at once. */
export async function verifyPayment(payment: PaymentRow, reviewerId: string): Promise<PaymentRow> {
  if (payment.status !== "awaiting") throw conflict("That payment has already been reviewed.");
  const now = new Date();
  const current = await currentSubscription(payment.user_id);
  let subscription: SubscriptionRow;
  if (current && current.plan_id === payment.plan_id && current.cycle === payment.cycle) {
    // A renewal: run on from the later of now and the old renewal date
    const from = current.renews_at && Date.parse(current.renews_at) > now.getTime() ? new Date(current.renews_at) : now;
    subscription = unwrap(await db.from("subscriptions").update({ renews_at: renewalAfter(from, payment.cycle).toISOString(), amount: payment.amount }).eq("id", current.id).select("*").single());
  } else {
    if (current) await db.from("subscriptions").update({ status: "canceled", canceled_at: now.toISOString(), renews_at: null }).eq("id", current.id);
    subscription = unwrap(
      await db
        .from("subscriptions")
        .insert({ user_id: payment.user_id, plan_id: payment.plan_id, cycle: payment.cycle, amount: payment.amount, started_at: now.toISOString(), renews_at: renewalAfter(now, payment.cycle).toISOString() })
        .select("*")
        .single(),
    );
  }
  await db.from("profiles").update({ plan_id: payment.plan_id, cycle: payment.cycle }).eq("id", payment.user_id);
  return unwrap(
    await db
      .from("payments")
      .update({ status: "verified", reviewed_at: now.toISOString(), reviewed_by: reviewerId, subscription_id: subscription.id })
      .eq("id", payment.id)
      .select("*")
      .single(),
  );
}

export async function rejectPayment(payment: PaymentRow, reviewerId: string, reason: PaymentRow["reason"]): Promise<PaymentRow> {
  if (payment.status !== "awaiting") throw conflict("That payment has already been reviewed.");
  return unwrap(
    await db.from("payments").update({ status: "rejected", reason, reviewed_at: new Date().toISOString(), reviewed_by: reviewerId }).eq("id", payment.id).select("*").single(),
  );
}

/** Money back: the subscription it paid for ends, and a reader left without one goes back to the default plan. */
export async function refundPayment(payment: PaymentRow): Promise<PaymentRow> {
  if (payment.status !== "verified") throw conflict("Only verified payments can be refunded.");
  const now = new Date().toISOString();
  if (payment.subscription_id) {
    await db.from("subscriptions").update({ status: "canceled", canceled_at: now, renews_at: null }).eq("id", payment.subscription_id).eq("status", "active");
    const remaining = await currentSubscription(payment.user_id);
    if (!remaining) {
      const fallback = await db.from("plans").select("id").eq("is_default", true).maybeSingle();
      await db.from("profiles").update({ plan_id: fallback.data?.id ?? "free", cycle: null }).eq("id", payment.user_id);
    }
  }
  return unwrap(await db.from("payments").update({ status: "refunded", refunded_at: now }).eq("id", payment.id).select("*").single());
}

export async function findSubscription(publicId: string): Promise<SubscriptionRow> {
  return unwrap(await db.from("subscriptions").select("*").eq("public_id", publicId).maybeSingle(), "That subscription");
}

export async function setAutoRenew(subscription: SubscriptionRow, autoRenew: boolean): Promise<SubscriptionRow> {
  if (subscription.status === "canceled") throw notFound("An active subscription");
  return unwrap(await db.from("subscriptions").update({ auto_renew: autoRenew }).eq("id", subscription.id).select("*").single());
}
