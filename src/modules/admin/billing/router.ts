import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { badRequest, conflict, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import type { Tables } from "../../../types/database.js";
import { logAudit } from "../../audit/service.js";
import { findPayment, findPlan, findSubscription, listPlans, refundPayment, rejectPayment, setAutoRenew, verifyPayment } from "../../billing/service.js";
import {
  cycles,
  methods,
  paymentOf,
  paymentStatuses,
  planIcons,
  planOf,
  recurringRevenue,
  rejectReasonFrom,
  subscriptionOf,
  text,
  type ApiPlan,
} from "../../billing/shared.js";
import { adminUserOf } from "../users/router.js";
import { notifyPayment } from "./mail.js";
import { csvHeaders, toCsv } from "./csv.js";

// The team's Plans & subscriptions and Payments pages.

export const adminBillingRouter = Router();
adminBillingRouter.use(requireTeam);

type ProfileRow = Tables<"profiles">;

const planLabel = (p: ApiPlan) => ({ type: "plan", id: p.id, label: p.name });
const planIdParam = z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/) });

async function usersById(ids: string[]) {
  if (!ids.length) return new Map<string, ProfileRow>();
  const rows = unwrap(await db.from("profiles").select("*").in("id", [...new Set(ids)]));
  return new Map(rows.map((u) => [u.id, u]));
}

/* ----------------------------------------------------------------- plans */

/** Monthly recurring revenue at the end of last month: the subscriptions running then, at what they paid
 * (yearly ones as a twelfth), for the Recurring revenue card's trend. Months are Bangladesh time. */
async function recurringRevenueLastMonth() {
  const now = new Date(Date.now() + 6 * 3_600_000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 6 * 3_600_000).toISOString();
  const { data, error } = await db.from("subscriptions").select("amount,cycle,canceled_at").lt("started_at", monthStart).or(`canceled_at.is.null,canceled_at.gte.${monthStart}`).limit(50_000);
  if (error) throw new Error(`Database: ${error.message}`);
  return Math.round((data ?? []).reduce((sum, s) => sum + (s.cycle === "yearly" ? s.amount / 12 : s.amount), 0));
}

adminBillingRouter.get("/plans", requirePermission("plans.view"), async (_req, res) => {
  const [plans, figures, previousRecurringRevenue] = await Promise.all([listPlans(false), db.rpc("subscription_figures").single(), recurringRevenueLastMonth()]);
  const f = figures.data;
  res.json({
    plans,
    recurringRevenue: recurringRevenue(plans.map((p) => ({ price_monthly: p.price.monthly, price_yearly: p.price.yearly, subscribers: p.subscribers, yearlySubscribers: p.yearlySubscribers }))),
    previousRecurringRevenue,
    stats: {
      paidSubscribers: plans.filter((p) => p.price.monthly > 0 || p.price.yearly).reduce((n, p) => n + p.subscribers, 0),
      previousActive: Number(f?.prev_active ?? 0),
      renewals: { current: Number(f?.renewals ?? 0), previous: Number(f?.prev_renewals ?? 0) },
    },
  });
});

const planBody = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/, "Lowercase letters, digits and dashes.").optional(),
  name: text,
  description: text,
  price: z.object({ monthly: z.number().int().min(0), yearly: z.number().int().min(0).nullable() }),
  features: z.array(text).max(20),
  icon: z.enum(planIcons).default("layers"),
  active: z.boolean().default(true),
});

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "plan";

const toRow = (b: z.infer<typeof planBody>) => ({
  name: b.name.en,
  name_bn: b.name.bn || b.name.en,
  description: b.description.en,
  description_bn: b.description.bn || b.description.en,
  price_monthly: b.price.monthly,
  price_yearly: b.price.yearly,
  features: b.features,
  icon: b.icon,
  active: b.active,
});

adminBillingRouter.post("/plans", requirePermission("plans.create"), validate("body", planBody), async (req, res) => {
  const b = req.body as z.infer<typeof planBody>;
  const id = b.id ?? slugOf(b.name.en);
  const taken = await db.from("plans").select("id").eq("id", id).maybeSingle();
  if (taken.data) throw conflict("A plan with that id already exists.", { id: "taken" });
  const max = await db.from("plans").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const plan = planOf(unwrap(await db.from("plans").insert({ id, ...toRow(b), sort_order: (max.data?.sort_order ?? 0) + 1 }).select("*").single()));
  await logAudit(req, { action: "plan.create", target: planLabel(plan), changes: [{ field: "price", to: plan.price.monthly }, { field: "yearlyPrice", to: plan.price.yearly }] });
  res.status(201).json({ plan });
});

adminBillingRouter.patch("/plans/:id", requirePermission("plans.edit"), validate("params", planIdParam), validate("body", planBody.partial()), async (req, res) => {
  const before = await findPlan(parsed<{ id: string }>(req, "params").id);
  const b = req.body as Partial<z.infer<typeof planBody>>;
  const patch = {
    ...(b.name && { name: b.name.en, name_bn: b.name.bn || b.name.en }),
    ...(b.description && { description: b.description.en, description_bn: b.description.bn || b.description.en }),
    ...(b.price && { price_monthly: b.price.monthly, price_yearly: b.price.yearly }),
    ...(b.features && { features: b.features }),
    ...(b.icon && { icon: b.icon }),
  };
  const row = unwrap(await db.from("plans").update(patch).eq("id", before.id).select("*").single());
  const plan = planOf(row);
  const changes = [
    ...(b.name && (b.name.en !== before.name || b.name.bn !== before.name_bn) ? [{ field: "name", from: { en: before.name, bn: before.name_bn }, to: plan.name }] : []),
    ...(b.price && b.price.monthly !== before.price_monthly ? [{ field: "price", from: before.price_monthly, to: b.price.monthly }] : []),
    ...(b.price && b.price.yearly !== before.price_yearly ? [{ field: "yearlyPrice", from: before.price_yearly, to: b.price.yearly }] : []),
  ];
  await logAudit(req, { action: "plan.edit", target: planLabel(plan), changes });
  res.json({ plan });
});

/** The pricing page's "Most popular" mark: one plan at most; `popular: false` takes it off. */
adminBillingRouter.put("/plans/:id/popular", requirePermission("plans.edit"), validate("params", planIdParam), validate("body", z.object({ popular: z.boolean() })), async (req, res) => {
  const { id } = parsed<{ id: string }>(req, "params");
  const before = await findPlan(id);
  const popular = (req.body as { popular: boolean }).popular;
  if (popular && !before.active) throw badRequest("Activate the plan before marking it popular.", { plan: "inactive" });
  if (popular) await db.from("plans").update({ popular: false }).eq("popular", true).neq("id", before.id);
  const plan = planOf(unwrap(await db.from("plans").update({ popular }).eq("id", before.id).select("*").single()));
  if (before.popular !== popular) await logAudit(req, { action: "plan.edit", target: planLabel(plan), changes: [{ field: "popular", from: before.popular, to: popular }] });
  res.json({ plan });
});

/** Activate, deactivate or make default. The default plan can't be deactivated; another must be made default first. */
adminBillingRouter.post("/plans/:id/:action", requirePermission("plans.activate"), validate("params", planIdParam.extend({ action: z.enum(["activate", "deactivate", "default", "duplicate"]) })), async (req, res) => {
  const { id, action } = parsed<{ id: string; action: string }>(req, "params");
  const before = await findPlan(id);
  if (action === "deactivate" && before.is_default) throw badRequest("Make another plan the default first.", { plan: "default" });
  // A hidden plan can't stay the pricing page's "Most popular"
  if (action === "deactivate" && before.popular) await db.from("plans").update({ popular: false }).eq("id", before.id);
  if (action === "duplicate") {
    const copy = unwrap(
      await db
        .from("plans")
        .insert({
          id: `${before.id}-copy-${Date.now().toString(36)}`,
          name: `${before.name} (copy)`,
          name_bn: `${before.name_bn} (কপি)`,
          description: before.description,
          description_bn: before.description_bn,
          price_monthly: before.price_monthly,
          price_yearly: before.price_yearly,
          features: before.features,
          icon: before.icon,
          active: false,
          sort_order: before.sort_order + 1,
        })
        .select("*")
        .single(),
    );
    const plan = planOf(copy);
    await logAudit(req, { action: "plan.duplicate", target: planLabel(plan), changes: [{ field: "name", from: before.name, to: copy.name }] });
    res.status(201).json({ plan });
    return;
  }
  if (action === "default") {
    if (!before.active) throw badRequest("Activate the plan before making it the default.", { plan: "inactive" });
    await db.from("plans").update({ is_default: false }).eq("is_default", true);
  }
  const patch = action === "default" ? { is_default: true } : { active: action === "activate" };
  const plan = planOf(unwrap(await db.from("plans").update(patch).eq("id", before.id).select("*").single()));
  await logAudit(req, {
    action: action === "default" ? "plan.default" : action === "activate" ? "plan.activate" : "plan.deactivate",
    target: planLabel(plan),
    changes: action === "default" ? [{ field: "default", to: true }] : [{ field: "active", from: before.active, to: plan.active }],
  });
  res.json({ plan });
});

/** Only a plan nobody is on, and that isn't the default, can be deleted. */
adminBillingRouter.delete("/plans/:id", requirePermission("plans.delete"), validate("params", planIdParam), async (req, res) => {
  const before = await findPlan(parsed<{ id: string }>(req, "params").id);
  const onIt = await db.from("profiles").select("id", { count: "exact", head: true }).eq("plan_id", before.id);
  if (before.is_default || (onIt.count ?? 0) > 0) throw badRequest("Plans with subscribers, and the default plan, can't be deleted.", { plan: "inUse" });
  await db.from("plans").delete().eq("id", before.id);
  await logAudit(req, { action: "plan.delete", target: planLabel(planOf(before)) });
  res.status(204).end();
});

/* ---------------------------------------------------------- subscriptions */

const subsQuery = z.object({
  q: z.string().trim().max(120).optional(),
  plan: z.string().optional(),
  status: z.enum(["active", "pastDue", "canceled"]).optional(),
  cycle: z.enum(cycles).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

adminBillingRouter.get("/subscriptions", requirePermission("plans.view"), validate("query", subsQuery), async (req, res) => {
  const q = parsed<z.infer<typeof subsQuery>>(req, "query");
  let query = db.from("subscriptions").select("*", { count: "exact" }).order("started_at", { ascending: false });
  if (q.plan) query = query.eq("plan_id", q.plan);
  if (q.status) query = query.eq("status", q.status === "pastDue" ? "past_due" : q.status);
  if (q.cycle) query = query.eq("cycle", q.cycle);
  if (q.q) {
    const term = q.q.replace(/[%_,]/g, " ");
    const matches = await db.from("profiles").select("id").or(`name.ilike.%${term}%,email.ilike.%${term}%,public_id.ilike.%${term}%`).limit(200);
    query = query.or(`public_id.ilike.%${term}%,user_id.in.(${(matches.data ?? []).map((u) => u.id).join(",") || "00000000-0000-0000-0000-000000000000"})`);
  }
  const from = (q.page - 1) * q.perPage;
  const { data, count } = await query.range(from, from + q.perPage - 1);
  const users = await usersById((data ?? []).map((s) => s.user_id));
  res.json({
    subscriptions: (data ?? []).map((s) => ({ ...subscriptionOf(s), user: users.get(s.user_id) ? adminUserOf(users.get(s.user_id)!) : null })),
    page: q.page,
    perPage: q.perPage,
    total: count ?? 0,
  });
});

adminBillingRouter.get("/subscriptions/:id", requirePermission("plans.view"), validate("params", z.object({ id: z.string().regex(/^SUB-\d{6}$/) })), async (req, res) => {
  const s = await findSubscription(parsed<{ id: string }>(req, "params").id);
  const [user, payments] = await Promise.all([db.from("profiles").select("*").eq("id", s.user_id).single(), db.from("payments").select("*").eq("subscription_id", s.id).order("submitted_at", { ascending: false })]);
  res.json({ subscription: { ...subscriptionOf(s), user: adminUserOf(unwrap(user)), payments: unwrap(payments).map(paymentOf) } });
});

adminBillingRouter.patch("/subscriptions/:id", requirePermission("plans.renewals"), validate("params", z.object({ id: z.string().regex(/^SUB-\d{6}$/) })), validate("body", z.object({ autoRenew: z.boolean() })), async (req, res) => {
  const before = await findSubscription(parsed<{ id: string }>(req, "params").id);
  const s = await setAutoRenew(before, req.body.autoRenew);
  const user = unwrap(await db.from("profiles").select("*").eq("id", s.user_id).single());
  await logAudit(req, {
    action: s.auto_renew ? "subscription.renewOn" : "subscription.renewOff",
    target: { type: "subscription", id: s.public_id, label: { en: user.name, bn: user.name_bn ?? user.name } },
    changes: [{ field: "autoRenew", from: before.auto_renew, to: s.auto_renew }],
  });
  res.json({ subscription: { ...subscriptionOf(s), user: adminUserOf(user) } });
});

/* --------------------------------------------------------------- payments */

const paymentsQuery = z.object({
  q: z.string().trim().max(120).optional(),
  plan: z.string().optional(),
  method: z.enum(methods).optional(),
  status: z.enum(paymentStatuses).optional(),
  /** "YYYY-MM" in Bangladesh time; omitted means every month */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  /** A range of months, both ends included ("2026-05" to "2026-10"), for the page's 3/6/12-month menu */
  from: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(500).default(20),
});

const DHAKA = "+06:00";
const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = new Date(`${month}-01T00:00:00${DHAKA}`);
  const end = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00${DHAKA}`);
  return { start: start.toISOString(), end: end.toISOString() };
};

async function queryPayments(q: z.infer<typeof paymentsQuery>) {
  let query = db.from("payments").select("*", { count: "exact" }).order("submitted_at", { ascending: false });
  if (q.plan) query = query.eq("plan_id", q.plan);
  if (q.method) query = query.eq("method", q.method);
  if (q.status) query = query.eq("status", q.status);
  if (q.month) {
    const { start, end } = monthRange(q.month);
    query = query.gte("submitted_at", start).lt("submitted_at", end);
  }
  if (q.from) query = query.gte("submitted_at", monthRange(q.from).start);
  if (q.to) query = query.lt("submitted_at", monthRange(q.to).end);
  if (q.q) {
    const term = q.q.replace(/[%_,]/g, " ");
    const matches = await db.from("profiles").select("id").or(`name.ilike.%${term}%,email.ilike.%${term}%`).limit(200);
    const ids = (matches.data ?? []).map((u) => u.id).join(",") || "00000000-0000-0000-0000-000000000000";
    query = query.or(`public_id.ilike.%${term}%,trx_id.ilike.%${term}%,user_id.in.(${ids})`);
  }
  const from = (q.page - 1) * q.perPage;
  const { data, count } = await query.range(from, from + q.perPage - 1);
  const users = await usersById((data ?? []).map((p) => p.user_id));
  return { rows: (data ?? []).map((p) => ({ ...paymentOf(p), user: users.get(p.user_id) ? adminUserOf(users.get(p.user_id)!) : null })), total: count ?? 0 };
}

adminBillingRouter.get("/payments", requirePermission("payments.view"), validate("query", paymentsQuery), async (req, res) => {
  const q = parsed<z.infer<typeof paymentsQuery>>(req, "query");
  const { rows, total } = await queryPayments(q);
  res.json({ payments: rows, page: q.page, perPage: q.perPage, total });
});

/** The stat tiles and charts: this month's tallies by status and method, and twelve months of revenue by plan. */
adminBillingRouter.get("/payments/figures", requirePermission("payments.view"), validate("query", z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() })), async (req, res) => {
  const { month } = parsed<{ month?: string }>(req, "query");
  const [tallies, series, lastMonth] = await Promise.all([
    db.rpc("payments_month_figures", { month: month ?? undefined }),
    db.rpc("dashboard_series", { months_back: 12 }),
    db.rpc("payments_month_figures", { month: previousMonth(month) }),
  ]);
  const empty = () => ({ count: 0, amount: 0 });
  const status = { verified: empty(), awaiting: empty(), rejected: empty(), refunded: empty() };
  const byMethod: Record<string, Record<string, { count: number; amount: number }>> = { bkash: {}, nagad: {} };
  for (const t of tallies.data ?? []) {
    status[t.status].count += Number(t.count);
    status[t.status].amount += Number(t.amount);
    if (t.status === "verified") {
      byMethod[t.method] ??= {};
      byMethod[t.method]![t.plan_id] = { count: Number(t.count), amount: Number(t.amount) };
    }
  }
  const prev = { verified: 0, refunds: 0 };
  for (const t of lastMonth.data ?? []) {
    if (t.status === "verified") prev.verified += Number(t.count);
    if (t.status === "refunded") prev.refunds += Number(t.amount);
  }
  const months = series.data ?? [];
  res.json({
    month: month ?? months.at(-1)?.month ?? null,
    status,
    byMethod,
    lastMonth: prev,
    chart: {
      months: months.map((m) => m.month),
      byPlan: Object.fromEntries(
        [...new Set(months.flatMap((m) => Object.keys((m.revenue_by_plan as Record<string, number>) ?? {})))].map((plan) => [plan, months.map((m) => Number(((m.revenue_by_plan as Record<string, number>) ?? {})[plan] ?? 0))]),
      ),
      refunds: months.map((m) => Number(m.refunds)),
    },
  });
});

function previousMonth(month?: string) {
  const base = month ? new Date(`${month}-01T00:00:00Z`) : new Date(Date.now() + 6 * 3_600_000);
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() - 1);
  return base.toISOString().slice(0, 7);
}

adminBillingRouter.get("/payments/export", requirePermission("payments.export"), validate("query", paymentsQuery), async (req, res) => {
  const q = parsed<z.infer<typeof paymentsQuery>>(req, "query");
  const { rows } = await queryPayments({ ...q, page: 1, perPage: 500 });
  const csv = toCsv(
    ["Payment", "User", "Email", "Plan", "Cycle", "Amount", "Method", "Transaction id", "Status", "Submitted"],
    rows.map((p) => [p.id, p.user?.name.en, p.user?.email, p.plan, p.cycle, p.amount, p.method, p.trxId, p.status, p.submitted]),
  );
  await logAudit(req, { action: "payment.export", target: { type: "list", id: "payments", label: { en: "Payments", bn: "পেমেন্ট" } }, changes: [{ field: "rows", to: rows.length }] });
  res.set(csvHeaders("lawsboi-payments.csv")).send(csv);
});

const paymentIdParam = z.object({ id: z.string().regex(/^PAY-\d{6}$/) });

adminBillingRouter.get("/payments/:id", requirePermission("payments.view"), validate("params", paymentIdParam), async (req, res) => {
  const p = await findPayment(parsed<{ id: string }>(req, "params").id);
  const user = unwrap(await db.from("profiles").select("*").eq("id", p.user_id).single());
  res.json({ payment: { ...paymentOf(p), user: adminUserOf(user) } });
});

async function reviewed(req: Parameters<typeof logAudit>[0], action: "payment.verify" | "payment.reject" | "payment.refund", before: Tables<"payments">, after: Tables<"payments">, extra: { field: string; to: unknown }[] = []) {
  const user = unwrap(await db.from("profiles").select("*").eq("id", after.user_id).single());
  await logAudit(req, {
    action,
    target: { type: "payment", id: after.public_id, label: { en: user.name, bn: user.name_bn ?? user.name } },
    changes: [{ field: "paymentStatus", from: before.status, to: after.status }, { field: "amount", to: after.amount }, ...extra],
  });
  return { ...paymentOf(after), user: adminUserOf(user) };
}

/** The reader hears what happened to their payment (sent in the background). */
async function emailOutcome(payment: Tables<"payments">, outcome: "verified" | "rejected") {
  const [reader, plan] = await Promise.all([db.from("profiles").select("*").eq("id", payment.user_id).single(), db.from("plans").select("*").eq("id", payment.plan_id).maybeSingle()]);
  if (reader.data) notifyPayment(payment, reader.data, plan.data, outcome);
}

adminBillingRouter.post("/payments/:id/verify", requirePermission("payments.verify"), validate("params", paymentIdParam), async (req, res) => {
  const before = await findPayment(parsed<{ id: string }>(req, "params").id);
  const after = await verifyPayment(before, req.member!.id);
  const payment = await reviewed(req, "payment.verify", before, after, [{ field: "plan", to: after.plan_id }]);
  await emailOutcome(after, "verified");
  res.json({ payment });
});

adminBillingRouter.post("/payments/:id/reject", requirePermission("payments.reject"), validate("params", paymentIdParam), validate("body", z.object({ reason: z.enum(["notFound", "amount", "duplicate"]) })), async (req, res) => {
  const before = await findPayment(parsed<{ id: string }>(req, "params").id);
  const after = await rejectPayment(before, req.member!.id, rejectReasonFrom(req.body.reason));
  const payment = await reviewed(req, "payment.reject", before, after, [{ field: "reason", to: req.body.reason }]);
  await emailOutcome(after, "rejected");
  res.json({ payment });
});

adminBillingRouter.post("/payments/:id/refund", requirePermission("payments.refund"), validate("params", paymentIdParam), async (req, res) => {
  const before = await findPayment(parsed<{ id: string }>(req, "params").id);
  const after = await refundPayment(before);
  res.json({ payment: await reviewed(req, "payment.refund", before, after) });
});
