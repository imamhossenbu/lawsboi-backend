import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { conflict, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import type { Tables } from "../../../types/database.js";
import { logAudit } from "../../audit/service.js";
import { paymentOf, subscriptionOf } from "../../billing/shared.js";
import { csvHeaders, toCsv } from "../billing/csv.js";

// Readers, as the admin panel's Users page and the support screens see them.

export const usersRouter = Router();
usersRouter.use(requireTeam, requirePermission("users.view"));

type ProfileRow = Tables<"profiles">;

/** The reader as the panel lists them. */
export function adminUserOf(p: ProfileRow) {
  return {
    id: p.public_id,
    name: { en: p.name, bn: p.name_bn ?? p.name },
    email: p.email,
    plan: p.plan_id,
    cycle: p.cycle ?? "monthly",
    role: "reader" as const,
    active: p.active,
    joined: p.joined_at,
    lastActive: p.last_active_at,
  };
}

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  plan: z.string().max(40).optional(),
  active: z.enum(["true", "false"]).optional(),
  // Only readers who joined in the last N days
  joinedWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(500).default(20),
});

async function queryUsers(q: z.infer<typeof listQuery>) {
  let query = db.from("profiles").select("*", { count: "exact" }).order("joined_at", { ascending: false });
  if (q.q) {
    const term = q.q.replace(/[%_,]/g, " ");
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,public_id.ilike.%${term}%`);
  }
  if (q.plan) query = query.eq("plan_id", q.plan);
  if (q.active) query = query.eq("active", q.active === "true");
  if (q.joinedWithinDays) query = query.gte("joined_at", new Date(Date.now() - q.joinedWithinDays * 86_400_000).toISOString());
  const from = (q.page - 1) * q.perPage;
  const { data, count } = await query.range(from, from + q.perPage - 1);
  return { rows: (data ?? []).map(adminUserOf), total: count ?? 0 };
}

usersRouter.get("/", validate("query", listQuery), async (req, res) => {
  const q = parsed<z.infer<typeof listQuery>>(req, "query");
  const { rows, total } = await queryUsers(q);
  res.json({ users: rows, page: q.page, perPage: q.perPage, total });
});

/** The stat tiles: total, active (seen in the last 30 days), new this month, inactive — each against last month. */
usersRouter.get("/stats", async (_req, res) => {
  const f = unwrap(await db.rpc("user_figures").single());
  const total = { current: Number(f.total), previous: Number(f.prev_total) };
  const active = { current: Number(f.active), previous: Number(f.prev_active) };
  res.json({
    total,
    active,
    new: { current: Number(f.joined_this_month), previous: Number(f.joined_last_month) },
    inactive: { current: total.current - active.current, previous: total.previous - active.previous },
  });
});

usersRouter.get("/export", requirePermission("users.export"), validate("query", listQuery), async (req, res) => {
  const q = parsed<z.infer<typeof listQuery>>(req, "query");
  const { rows } = await queryUsers({ ...q, page: 1, perPage: 500 });
  const csv = toCsv(["User", "Name", "Email", "Plan", "Cycle", "Active", "Joined", "Last active"], rows.map((u) => [u.id, u.name.en, u.email, u.plan, u.cycle, u.active ? "yes" : "no", u.joined, u.lastActive]));
  await logAudit(req, { action: "user.export", target: { type: "list", id: "users", label: { en: "Users", bn: "ব্যবহারকারী" } }, changes: [{ field: "rows", to: rows.length }] });
  res.set(csvHeaders("lawsboi-users.csv")).send(csv);
});

const addSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameBn: z.string().trim().max(120).optional(),
  email: z.email().transform((v) => v.trim().toLowerCase()),
  plan: z.string().max(40).default("free"),
  cycle: z.enum(["monthly", "yearly"]).optional(),
  lang: z.enum(["en", "bn"]).default("en"),
});

/** A reader added by the team (over the phone, a chamber's seats…). They set their own password with "Forgot
 * password" on the reader site, so none is kept here. */
usersRouter.post("/", requirePermission("users.add"), validate("body", addSchema), async (req, res) => {
  const b = req.body as z.infer<typeof addSchema>;
  const plan = unwrap(await db.from("plans").select("*").eq("id", b.plan).maybeSingle(), "That plan");
  const taken = await Promise.all([db.from("profiles").select("id").eq("email", b.email).maybeSingle(), db.from("team_members").select("id").eq("email", b.email).maybeSingle()]);
  if (taken.some((t) => t.data)) throw conflict("An account with that email already exists.", { email: "taken" });
  const { data, error } = await db.auth.admin.createUser({
    email: b.email,
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
    user_metadata: { kind: "reader", name: b.name, lang: b.lang },
  });
  if (error || !data.user) {
    if (error?.code === "email_exists") throw conflict("An account with that email already exists.", { email: "taken" });
    throw new Error(`Auth: ${error?.message}`);
  }
  // The database trigger made the profile; set what the form chose
  const cycle = plan.price_monthly === 0 && !plan.price_yearly ? null : (b.cycle ?? "monthly");
  const user = unwrap(await db.from("profiles").update({ name: b.name, name_bn: b.nameBn ?? null, lang: b.lang, plan_id: plan.id, cycle }).eq("id", data.user.id).select("*").single());
  await logAudit(req, { action: "user.add", target: { type: "user", id: user.public_id, label: { en: user.name, bn: user.name_bn ?? user.name } }, changes: [{ field: "email", to: user.email }, { field: "plan", to: user.plan_id }] });
  res.status(201).json({ user: adminUserOf(user) });
});

const idParam = z.object({ id: z.string().regex(/^USR-\d+$/) });

async function findUser(publicId: string) {
  return unwrap(await db.from("profiles").select("*").eq("public_id", publicId).maybeSingle(), "That reader");
}

/** One reader with their subscriptions, payments and how many tickets they've opened. */
usersRouter.get("/:id", validate("params", idParam), async (req, res) => {
  const user = await findUser(parsed<{ id: string }>(req, "params").id);
  const [subscriptions, payments, tickets] = await Promise.all([
    db.from("subscriptions").select("*").eq("user_id", user.id).order("started_at", { ascending: false }),
    db.from("payments").select("*").eq("user_id", user.id).order("submitted_at", { ascending: false }),
    db.from("tickets").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);
  res.json({
    user: {
      ...adminUserOf(user),
      lang: user.lang,
      profile: { phone: user.phone, profession: user.profession, organization: user.organization, location: user.location, photo: user.photo_url },
      subscriptions: unwrap(subscriptions).map(subscriptionOf),
      payments: unwrap(payments).map(paymentOf),
      tickets: tickets.count ?? 0,
    },
  });
});

usersRouter.patch("/:id", requirePermission("users.deactivate"), validate("params", idParam), validate("body", z.object({ active: z.boolean() })), async (req, res) => {
  const before = await findUser(parsed<{ id: string }>(req, "params").id);
  const user = unwrap(await db.from("profiles").update({ active: req.body.active }).eq("id", before.id).select("*").single());
  await db.auth.admin.updateUserById(user.id, { ban_duration: req.body.active ? "none" : "876000h" });
  await logAudit(req, {
    action: req.body.active ? "user.activate" : "user.deactivate",
    target: { type: "user", id: user.public_id, label: { en: user.name, bn: user.name_bn ?? user.name } },
    changes: [{ field: "active", from: before.active, to: user.active }],
  });
  res.json({ user: adminUserOf(user) });
});
