import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import type { ProfileRow } from "../../../types/database.js";
import { logAudit } from "../../audit/service.js";

// Readers, as the admin panel's Users page and the support screens see them.

export const usersRouter = Router();
usersRouter.use(requireTeam, requirePermission("users.view"));

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
  plan: z.enum(["free", "researcher", "professional"]).optional(),
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

usersRouter.get("/", validate("query", listQuery), async (req, res) => {
  const q = parsed<z.infer<typeof listQuery>>(req, "query");
  let query = db.from("profiles").select("*", { count: "exact" }).order("joined_at", { ascending: false });
  if (q.q) {
    const term = q.q.replace(/[%_,]/g, " ");
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,public_id.ilike.%${term}%`);
  }
  if (q.plan) query = query.eq("plan_id", q.plan);
  if (q.active) query = query.eq("active", q.active === "true");
  const from = (q.page - 1) * q.perPage;
  const { data, count } = await query.range(from, from + q.perPage - 1);
  res.json({ users: (data ?? []).map(adminUserOf), page: q.page, perPage: q.perPage, total: count ?? 0 });
});

const idParam = z.object({ id: z.string().regex(/^USR-\d+$/) });

usersRouter.get("/:id", validate("params", idParam), async (req, res) => {
  const user = unwrap(await db.from("profiles").select("*").eq("public_id", parsed<{ id: string }>(req, "params").id).maybeSingle(), "That reader");
  res.json({ user: adminUserOf(user) });
});

usersRouter.patch("/:id", requirePermission("users.deactivate"), validate("params", idParam), validate("body", z.object({ active: z.boolean() })), async (req, res) => {
  const before = unwrap(await db.from("profiles").select("*").eq("public_id", parsed<{ id: string }>(req, "params").id).maybeSingle(), "That reader");
  const user = unwrap(await db.from("profiles").update({ active: req.body.active }).eq("id", before.id).select("*").single());
  await db.auth.admin.updateUserById(user.id, { ban_duration: req.body.active ? "none" : "876000h" });
  await logAudit(req, {
    action: req.body.active ? "user.activate" : "user.deactivate",
    target: { type: "user", id: user.public_id, label: { en: user.name, bn: user.name_bn ?? user.name } },
    changes: [{ field: "active", from: before.active, to: user.active }],
  });
  res.json({ user: adminUserOf(user) });
});
