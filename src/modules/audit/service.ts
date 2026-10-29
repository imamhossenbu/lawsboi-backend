import type { Request } from "express";
import { db } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";

// Writes one audit entry per team action. Never pass secrets: a password change records only that it happened.

export type Text = { en: string; bn: string };

export interface AuditInput {
  action: string;
  target: { type: string; id: string; label: Text };
  changes?: { field: string; of?: string; from?: unknown; to?: unknown }[];
}

/** Money, access and data leaving the panel: marked so the audit page can count them on their own. */
const sensitive = new Set([
  "payment.refund", "payment.export", "user.export", "user.deactivate", "plan.delete", "flag.off", "assistant.limits",
  "settings.accounts", "team.role", "team.permissions", "team.deactivate", "account.password", "audit.export",
]);

export async function logAudit(req: Request, input: AuditInput) {
  const { error } = await db.from("audit_logs").insert({
    actor_id: req.member?.id ?? null,
    action: input.action,
    target_type: input.target.type,
    target_id: input.target.id,
    target_label: input.target.label,
    changes: (input.changes ?? []) as never,
    sensitive: sensitive.has(input.action),
    ip: req.ip ?? null,
    user_agent: req.get("user-agent") ?? null,
  });
  // The action already happened; a failed log line is worth a warning, not a failed request
  if (error) logger.warn({ error, action: input.action }, "audit entry not written");
}
