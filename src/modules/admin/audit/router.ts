import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import type { Tables } from "../../../types/database.js";
import { logAudit } from "../../audit/service.js";
import { csvHeaders, toCsv } from "../billing/csv.js";
import { allAuditActions, areaOf, auditActions, auditAreas, type AuditArea } from "./areas.js";

// Reading the audit log: who on the team did what. Writing happens in modules/audit/service.ts as actions happen.

export const adminAuditRouter = Router();
adminAuditRouter.use(requireTeam, requirePermission("audit.view"));

type AuditRow = Tables<"audit_logs">;
const DAY = 86_400_000;

async function teamIndex() {
  const members = unwrap(await db.from("team_members").select("id, public_id, name, name_bn"));
  return new Map(members.map((m) => [m.id, m]));
}

function entryOf(e: AuditRow, team: Map<string, { public_id: string }>) {
  return {
    id: e.id,
    at: e.at,
    actor: e.actor_id ? (team.get(e.actor_id)?.public_id ?? null) : null,
    action: e.action,
    area: areaOf(e.action),
    target: { type: e.target_type, id: e.target_id, label: e.target_label },
    changes: e.changes,
    sensitive: e.sensitive,
  };
}

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  area: z.enum(auditAreas as [AuditArea, ...AuditArea[]]).optional(),
  action: z.string().optional(),
  /** A team id ("AGT-02") */
  actor: z.string().regex(/^AGT-\d+$/).optional(),
  sensitive: z.enum(["true"]).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(500).default(25),
});

async function queryEntries(q: z.infer<typeof listQuery>, team: Map<string, { id: string; public_id: string }>) {
  let query = db.from("audit_logs").select("*", { count: "exact" }).order("at", { ascending: false });
  if (q.area) query = query.in("action", [...auditActions[q.area]]);
  if (q.action && q.action !== "sensitive") query = query.eq("action", q.action);
  if (q.action === "sensitive" || q.sensitive) query = query.eq("sensitive", true);
  if (q.actor) {
    const member = [...team.values()].find((m) => m.public_id === q.actor);
    query = member ? query.eq("actor_id", member.id) : query.eq("actor_id", "00000000-0000-0000-0000-000000000000");
  }
  if (q.from) query = query.gte("at", q.from);
  if (q.to) query = query.lt("at", q.to);
  if (q.q) {
    const term = q.q.replace(/[%_,()]/g, " ");
    // The search also finds what a team member did, by their name in either language or their email
    const { data: people } = await db.from("team_members").select("id").or(`name.ilike.%${term}%,name_bn.ilike.%${term}%,email.ilike.%${term}%`).limit(50);
    const byActor = (people ?? []).length ? `,actor_id.in.(${people!.map((p) => p.id).join(",")})` : "";
    query = query.or(`target_id.ilike.%${term}%,target_label->>en.ilike.%${term}%,target_label->>bn.ilike.%${term}%,action.ilike.%${term}%${byActor}`);
  }
  const from = (q.page - 1) * q.perPage;
  const { data, count } = await query.range(from, from + q.perPage - 1);
  return { rows: (data ?? []).map((e) => entryOf(e, team)), total: count ?? 0 };
}

adminAuditRouter.get("/", validate("query", listQuery), async (req, res) => {
  const q = parsed<z.infer<typeof listQuery>>(req, "query");
  const team = await teamIndex();
  const { rows, total } = await queryEntries(q, team);
  res.json({ entries: rows, page: q.page, perPage: q.perPage, total, actions: allAuditActions });
});

/** The stat tiles: today, this week (and month), the busiest member this week, sensitive actions this week, and
 * each member's count this month for the bars. */
adminAuditRouter.get("/stats", async (_req, res) => {
  const now = Date.now();
  const dhakaMidnight = new Date(Math.floor((now + 6 * 3_600_000) / DAY) * DAY - 6 * 3_600_000).toISOString();
  const week = new Date(now - 7 * DAY).toISOString();
  const month = new Date(now - 30 * DAY).toISOString();
  const counting = () => db.from("audit_logs").select("id", { count: "exact", head: true });
  const n = (r: { count: number | null }) => r.count ?? 0;
  const [today, thisWeek, thisMonth, sensitiveWeek, weekActors, monthActors, team] = await Promise.all([
    counting().gte("at", dhakaMidnight).then(n),
    counting().gte("at", week).then(n),
    counting().gte("at", month).then(n),
    counting().gte("at", week).eq("sensitive", true).then(n),
    db.rpc("audit_actor_counts", { since: week }),
    db.rpc("audit_actor_counts", { since: month }),
    teamIndex(),
  ]);
  const actor = (id: string | null) => (id ? (team.get(id)?.public_id ?? null) : null);
  const busiest = weekActors.data?.[0];
  res.json({
    today,
    week: thisWeek,
    month: thisMonth,
    sensitiveWeek,
    busiest: busiest ? { actor: actor(busiest.actor_id), count: Number(busiest.count) } : null,
    byMember: (monthActors.data ?? []).map((m) => ({ actor: actor(m.actor_id), count: Number(m.count) })),
  });
});

adminAuditRouter.get("/export", requirePermission("audit.export"), validate("query", listQuery), async (req, res) => {
  const q = parsed<z.infer<typeof listQuery>>(req, "query");
  const team = await teamIndex();
  const { rows } = await queryEntries({ ...q, page: 1, perPage: 500 }, team);
  const csv = toCsv(
    ["Time", "Member", "Action", "Area", "Target type", "Target", "Label", "Changes", "Sensitive"],
    rows.map((e) => [e.at, e.actor, e.action, e.area, e.target.type, e.target.id, (e.target.label as { en?: string })?.en, JSON.stringify(e.changes), e.sensitive ? "yes" : "no"]),
  );
  await logAudit(req, { action: "audit.export", target: { type: "list", id: "audit", label: { en: "Audit log", bn: "অডিট লগ" } }, changes: [{ field: "rows", to: rows.length }] });
  res.set(csvHeaders("lawsboi-audit-log.csv")).send(csv);
});
