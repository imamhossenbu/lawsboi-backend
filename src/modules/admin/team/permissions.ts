import type { TeamMemberRow, TeamRole } from "../../../types/database.js";

// The same catalogue as the admin panel's lib/admin/permissions.ts: what a team member may do, action by action.
// "view" opens a part of the panel; every other action in that part needs it. Keep the two files in step.

export const actionCatalogue = {
  dashboard: ["view", "revenue"],
  users: ["view", "add", "deactivate", "export"],
  plans: ["view", "create", "edit", "activate", "delete", "renewals"],
  payments: ["view", "verify", "reject", "refund", "export"],
  support: ["view", "reply", "note", "assign", "status", "create"],
  content: ["view", "edit", "publish", "delete"],
  laws: ["view", "add", "edit", "translate", "publish", "cases", "link"],
  assistant: ["view", "manage"],
  announcements: ["view", "write", "send", "endBanner", "delete"],
  flags: ["view", "manage"],
  audit: ["view", "export"],
  health: ["view", "manage"],
  settings: ["view", "payments", "contact", "team"],
} as const;

type Catalogue = typeof actionCatalogue;
export type Section = keyof Catalogue;
/** "payments.refund" */
export type Action = { [K in Section]: `${K}.${Catalogue[K][number]}` }[Section];

export const sections = Object.keys(actionCatalogue) as Section[];
export const allActions: Action[] = sections.flatMap((s) => actionCatalogue[s].map((a) => `${s}.${a}` as Action));
const known = new Set<string>(allActions);

export const isAction = (value: string): value is Action => known.has(value);

/** What each role starts with; an admin can then grant or take away any action per person. */
export const presets: Record<TeamRole, Action[]> = {
  admin: allActions,
  editor: [
    "dashboard.view",
    "content.view",
    "content.edit",
    "content.publish",
    "laws.view",
    "laws.add",
    "laws.edit",
    "laws.translate",
    "laws.cases",
    "laws.link",
    "assistant.view",
    "announcements.view",
    "announcements.write",
  ],
  support: [
    "dashboard.view",
    "users.view",
    "plans.view",
    "payments.view",
    "payments.verify",
    "payments.reject",
    "support.view",
    "support.reply",
    "support.note",
    "support.assign",
    "support.status",
    "support.create",
  ],
};

/** Admins have everything; others need the action and the part's "view". */
export function can(member: Pick<TeamMemberRow, "role" | "permissions">, action: Action) {
  if (member.role === "admin") return true;
  const section = action.split(".")[0] as Section;
  const has = new Set(member.permissions);
  return has.has(action) && has.has(`${section}.view`);
}

/** Drops unknown keys and actions whose part the member can't view, so a stored set is always usable. */
export function normalizePermissions(values: string[]): Action[] {
  const has = new Set(values.filter(isAction));
  return allActions.filter((a) => has.has(a) && has.has(`${a.split(".")[0]}.view` as Action));
}
