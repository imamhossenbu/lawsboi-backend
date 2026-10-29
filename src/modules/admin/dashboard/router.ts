import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import { paymentOf } from "../../billing/shared.js";
import { adminUserOf } from "../users/router.js";

// The dashboard's figures, every one of them counted from the database: no sample numbers anywhere.

export const adminDashboardRouter = Router();
adminDashboardRouter.use(requireTeam, requirePermission("dashboard.view"));

const RECENT = 5;

adminDashboardRouter.get("/", validate("query", z.object({ months: z.coerce.number().int().min(3).max(24).default(12) })), async (req, res) => {
  const { months } = parsed<{ months: number }>(req, "query");
  const showRevenue = req.member!.role === "admin" || req.member!.permissions.includes("dashboard.revenue");
  const [series, subs, tickets, lastMonthTickets, users, payments, recentTickets] = await Promise.all([
    db.rpc("dashboard_series", { months_back: months }),
    db.rpc("subscription_figures").single(),
    db.from("tickets").select("priority").in("status", ["open", "progress", "waiting"]),
    db.rpc("tickets_open_last_month").single(),
    db.from("profiles").select("*").order("joined_at", { ascending: false }).limit(RECENT),
    db.from("payments").select("*").order("submitted_at", { ascending: false }).limit(RECENT),
    db.from("tickets").select("*").order("updated_at", { ascending: false }).limit(RECENT),
  ]);
  const rows = unwrap(series);
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const open = tickets.data ?? [];
  const payerIds = [...new Set([...(payments.data ?? []).map((p) => p.user_id), ...(recentTickets.data ?? []).map((t) => t.user_id)])];
  const payers = payerIds.length ? new Map(unwrap(await db.from("profiles").select("*").in("id", payerIds)).map((u) => [u.id, u])) : new Map();
  const team = new Map(unwrap(await db.from("team_members").select("id, public_id")).map((m) => [m.id, m.public_id]));

  res.json({
    months: rows.map((m) => m.month),
    series: {
      revenue: showRevenue ? rows.map((m) => Number(m.revenue)) : null,
      newSubscriptions: rows.map((m) => Number(m.new_subscriptions)),
      totalUsers: rows.map((m) => Number(m.total_users)),
      activeUsers: rows.map((m) => Number(m.active_users)),
    },
    kpis: {
      users: { current: Number(last?.total_users ?? 0), previous: Number(prev?.total_users ?? 0) },
      subscriptions: { current: Number(subs.data?.active ?? 0), previous: Number(subs.data?.prev_active ?? 0) },
      revenue: showRevenue ? { current: Number(last?.revenue ?? 0), previous: Number(prev?.revenue ?? 0) } : null,
      tickets: {
        current: open.length,
        previous: Number(lastMonthTickets.data?.open ?? 0),
        attention: open.filter((t) => t.priority === "high" || t.priority === "urgent").length,
        previousAttention: Number(lastMonthTickets.data?.attention ?? 0),
      },
    },
    recent: {
      users: unwrap(users).map(adminUserOf),
      payments: unwrap(payments).map((p) => ({ ...paymentOf(p), user: payers.get(p.user_id) ? adminUserOf(payers.get(p.user_id)!) : null })),
      tickets: unwrap(recentTickets).map((t) => ({
        id: t.public_id,
        subject: t.subject,
        category: t.category,
        priority: t.priority,
        status: t.status,
        assignee: t.assignee_id ? (team.get(t.assignee_id) ?? null) : null,
        user: payers.get(t.user_id) ? adminUserOf(payers.get(t.user_id)!) : null,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    },
  });
});
