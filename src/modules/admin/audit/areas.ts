// The audit log's vocabulary, as the admin panel's lib/admin/audit.ts names it. Keep the two in step.

export const auditActions = {
  users: ["user.add", "user.deactivate", "user.activate", "user.export"],
  plans: ["plan.create", "plan.edit", "plan.activate", "plan.deactivate", "plan.default", "plan.duplicate", "plan.delete", "subscription.renewOn", "subscription.renewOff"],
  payments: ["payment.verify", "payment.reject", "payment.refund", "payment.export"],
  support: ["ticket.create", "ticket.assign", "ticket.unassign", "ticket.status", "ticket.priority", "ticket.category", "ticket.reply", "ticket.note"],
  content: ["article.create", "article.edit", "article.publish", "article.unpublish", "article.move", "article.delete", "faq.create", "faq.edit", "faq.publish", "faq.unpublish", "faq.move", "faq.delete", "page.edit"],
  laws: ["law.create", "law.edit", "law.section", "law.translate", "law.untranslate", "law.publish", "law.unpublish", "case.create", "case.edit", "case.link", "case.unlink"],
  assistant: ["assistant.limits", "assistant.flag", "assistant.unflag"],
  flags: ["flag.on", "flag.off", "flag.edit"],
  announcements: ["announcement.draft", "announcement.schedule", "announcement.send", "announcement.unschedule", "announcement.endBanner", "announcement.duplicate", "announcement.delete"],
  audit: ["audit.export"],
  settings: ["settings.accounts", "settings.contact", "team.invite", "team.reinvite", "team.edit", "team.role", "team.permissions", "team.activate", "team.deactivate", "account.profile", "account.password"],
} as const;

export type AuditArea = keyof typeof auditActions;
export const auditAreas = Object.keys(auditActions) as AuditArea[];
export const allAuditActions = auditAreas.flatMap((a) => auditActions[a] as readonly string[]);

const areaByAction = new Map<string, AuditArea>(auditAreas.flatMap((area) => auditActions[area].map((a) => [a, area] as const)));
/** The part of the panel an action belongs to; unknown actions fall under the prefix before the dot. */
export const areaOf = (action: string): AuditArea | string => areaByAction.get(action) ?? action.split(".")[0]!;
