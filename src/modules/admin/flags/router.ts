import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { badRequest, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import { logAudit } from "../../audit/service.js";
import { accessSchema, allowanceSchema, flagOf, type Access, type Allowance, type FlagEventRow, type FlagRow } from "../../content/shared.js";

// Team: the features the reader site sells by plan. A master switch, who gets it per plan, allowances for counted
// features, and a rollout share for ones still being built. Every change goes into the flag's history.

export const adminFlagsRouter = Router();
adminFlagsRouter.use(requireTeam, requirePermission("flags.view"));

type Change =
  | { kind: "created" }
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "plans"; access: Access }
  | { kind: "allowance"; allowance: Allowance }
  | { kind: "rollout"; percent: number };

function flagWithHistory(f: FlagRow, events: FlagEventRow[], agents: Map<string, string>) {
  return {
    ...flagOf(f),
    history: events.map((e) => ({ at: e.created_at, by: e.actor_id ? (agents.get(e.actor_id) ?? null) : null, change: e.change as Change })),
  };
}

async function agentIds() {
  const members = unwrap(await db.from("team_members").select("id, public_id"));
  return new Map(members.map((m) => [m.id, m.public_id]));
}

adminFlagsRouter.get("/", async (_req, res) => {
  const [flags, events, agents] = await Promise.all([
    unwrap(await db.from("feature_flags").select("*").order("id")),
    unwrap(await db.from("feature_flag_events").select("*").order("created_at")),
    agentIds(),
  ]);
  res.json({ flags: flags.map((f) => flagWithHistory(f, events.filter((e) => e.flag_id === f.id), agents)) });
});

const idParam = z.object({ id: z.string().regex(/^[a-zA-Z]{1,40}$/) });
const patchSchema = z
  .object({
    on: z.boolean(),
    access: accessSchema,
    allowance: allowanceSchema,
    rollout: z.number().int().min(0).max(100),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to change.");

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One save, any mix of switch, plans, allowance and rollout; each part that changed becomes a history event. */
adminFlagsRouter.patch("/:id", requirePermission("flags.manage"), validate("params", idParam), validate("body", patchSchema), async (req, res) => {
  const { id } = parsed<{ id: string }>(req, "params");
  const b = req.body as z.infer<typeof patchSchema>;
  const before = unwrap(await db.from("feature_flags").select("*").eq("id", id).maybeSingle(), "That flag");
  if (b.allowance && !before.allowance) throw badRequest("This feature isn't counted, so it has no allowance.", { allowance: "notCounted" });

  const changes: Change[] = [];
  if (b.on !== undefined && b.on !== before.enabled) changes.push({ kind: b.on ? "on" : "off" });
  if (b.access && !same(b.access, before.access)) changes.push({ kind: "plans", access: b.access });
  if (b.allowance && !same(b.allowance, before.allowance)) changes.push({ kind: "allowance", allowance: b.allowance });
  if (b.rollout !== undefined && b.rollout !== before.rollout) changes.push({ kind: "rollout", percent: b.rollout });

  let flag = before;
  if (changes.length) {
    flag = unwrap(
      await db
        .from("feature_flags")
        .update({
          ...(b.on !== undefined && { enabled: b.on }),
          ...(b.access && { access: b.access }),
          ...(b.allowance && { allowance: b.allowance }),
          ...(b.rollout !== undefined && { rollout: b.rollout }),
        })
        .eq("id", id)
        .select("*")
        .single(),
    );
    unwrap(await db.from("feature_flag_events").insert(changes.map((change) => ({ flag_id: id, actor_id: req.member!.id, change }))).select("id"));
    const kind = changes[0]!.kind;
    await logAudit(req, {
      action: kind === "on" ? "flag.on" : kind === "off" ? "flag.off" : "flag.edit",
      target: { type: "flag", id, label: { en: id, bn: id } },
      changes: changes.map((c) => ({ field: c.kind === "on" || c.kind === "off" ? "enabled" : c.kind, to: c.kind === "on" ? true : c.kind === "off" ? false : c.kind === "rollout" ? c.percent : c.kind === "plans" ? c.access : c.kind === "allowance" ? c.allowance : null })),
    });
  }
  const [events, agents] = await Promise.all([unwrap(await db.from("feature_flag_events").select("*").eq("flag_id", id).order("created_at")), agentIds()]);
  res.json({ flag: flagWithHistory(flag, events, agents) });
});
