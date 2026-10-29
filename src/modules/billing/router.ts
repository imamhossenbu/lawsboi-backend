import { Router } from "express";
import { z } from "zod";
import { requireReader } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { currentSubscription, featureMatrix, listPlans, setAutoRenew, submitPayment } from "./service.js";
import { cycles, methods, paymentOf, subscriptionOf, walletOf } from "./shared.js";

// Readers: the plans on sale, where to send money, and their own subscription and payments.

export const billingRouter = Router();

/** The pricing page: active plans with prices, features and the comparison matrix. Public. */
billingRouter.get("/plans", async (_req, res) => {
  const [plans, matrix] = await Promise.all([listPlans(true), featureMatrix()]);
  // What each plan leaves out: the matrix rows that are false for it, for the plan cards' "not included" lines
  const rows = matrix as { key: string; label?: { en: string; bn: string }; [plan: string]: unknown }[];
  res.json({
    plans: plans.map(({ subscribers: _s, yearlySubscribers: _y, ...p }) => ({ ...p, excluded: rows.filter((r) => r[p.id] === false).map((r) => ({ key: r.key, label: r.label ?? null })) })),
    matrix,
  });
});

/** The wallets offered at checkout. Public. */
billingRouter.get("/accounts", async (_req, res) => {
  const wallets = unwrap(await db.from("wallet_accounts").select("*").eq("enabled", true).order("method"));
  res.json({ accounts: wallets.map(walletOf) });
});

const checkoutSchema = z.object({
  plan: z.string().min(1),
  cycle: z.enum(cycles),
  method: z.enum(methods),
  trxId: z.string().trim().min(1, "Enter the transaction id.").max(20),
});

billingRouter.post("/checkout", requireReader, validate("body", checkoutSchema), async (req, res) => {
  const payment = await submitPayment(req.reader!, req.body);
  res.status(201).json({ payment: paymentOf(payment) });
});

/** The reader's plan page: the current subscription and every payment, newest first. */
billingRouter.get("/subscription", requireReader, async (req, res) => {
  const me = req.reader!;
  const [subscription, payments] = await Promise.all([
    currentSubscription(me.id),
    db.from("payments").select("*").eq("user_id", me.id).order("submitted_at", { ascending: false }).limit(50),
  ]);
  res.json({
    plan: me.plan_id,
    cycle: me.cycle,
    subscription: subscription ? subscriptionOf(subscription) : null,
    payments: unwrap(payments).map(paymentOf),
  });
});

billingRouter.post("/subscription/auto-renew", requireReader, validate("body", z.object({ autoRenew: z.boolean() })), async (req, res) => {
  const current = await currentSubscription(req.reader!.id);
  if (!current) {
    res.status(404).json({ error: { code: "not_found", message: "You don't have an active subscription." } });
    return;
  }
  res.json({ subscription: subscriptionOf(await setAutoRenew(current, req.body.autoRenew)) });
});
