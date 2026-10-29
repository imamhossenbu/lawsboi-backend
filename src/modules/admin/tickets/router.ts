import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { badRequest, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import type { TeamMemberRow, TicketStatus } from "../../../types/database.js";
import { logAudit } from "../../audit/service.js";
import { categories, priorities, statuses, ticketIdParam } from "../../support/schemas.js";
import { addMessage, changeField, createTicket, fileUrl, loadTicket, type Actor, type Field, type TicketFull } from "../../support/service.js";
import { attachments } from "../../support/upload.js";
import { memberByPublicId } from "../team/service.js";
import { adminUserOf } from "../users/router.js";

// The team's side of support: every ticket, the conversation plus internal notes, assignment and workflow states.

export const adminTicketsRouter = Router();
adminTicketsRouter.use(requireTeam, requirePermission("support.view"));

/* ---------------------------------------------------------------- shapes */

async function teamDirectory() {
  const members = unwrap(await db.from("team_members").select("*"));
  return new Map(members.map((m) => [m.id, m]));
}

/** A ticket as the admin panel shows it. Authors and assignees are team public ids ("AGT-01") or "reader". */
export function adminTicketOf(full: TicketFull, team: Map<string, TeamMemberRow>) {
  const { ticket, user, messages, files, events } = full;
  const who = (kind: string, id: string | null) => (kind === "team" && id ? (team.get(id)?.public_id ?? id) : "reader");
  const agent = (id: string | null) => (id ? (team.get(id)?.public_id ?? id) : null);
  const filesByMessage = new Map<string, typeof files>();
  for (const f of files) filesByMessage.set(f.message_id, [...(filesByMessage.get(f.message_id) ?? []), f]);
  return {
    id: ticket.public_id,
    subject: ticket.subject,
    lang: ticket.lang,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    user: adminUserOf(user),
    assignee: agent(ticket.assignee_id),
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    resolvedAt: ticket.resolved_at,
    messages: messages.map((m) => ({
      id: m.id,
      at: m.created_at,
      author: who(m.author_kind, m.author_id),
      kind: m.kind,
      text: m.body,
      files: (filesByMessage.get(m.id) ?? []).map((f) => ({ id: f.id, name: f.name, size: f.size, type: f.mime })),
    })),
    activity: events.map((e) => ({
      id: e.id,
      at: e.created_at,
      kind: e.kind,
      by: who(e.actor_kind, e.actor_id),
      from: e.kind === "assigned" || e.kind === "unassigned" ? agent(e.from_value) : e.from_value,
      to: e.kind === "assigned" || e.kind === "unassigned" ? agent(e.to_value) : e.to_value,
    })),
  };
}

const actorOf = (req: { member?: TeamMemberRow }): Actor => ({ kind: "team", member: req.member! });
const label = (full: TicketFull) => ({ en: full.ticket.subject, bn: full.ticket.subject });

/** "me" is the signed-in member; otherwise a team public id or null. Returns the row's uuid. */
async function resolveAssignee(value: string | null, me: TeamMemberRow) {
  if (value === null) return null;
  if (value === "me") return me.id;
  return (await memberByPublicId(value))!.id;
}

/* ------------------------------------------------------------------ list */

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.string().optional(),
  priority: z.enum(priorities).optional(),
  category: z.enum(categories).optional(),
  // "me", "none", or a team id
  assignee: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

adminTicketsRouter.get("/", validate("query", listQuery), async (req, res) => {
  const q = parsed<z.infer<typeof listQuery>>(req, "query");
  let query = db.from("tickets").select("*", { count: "exact" }).order("updated_at", { ascending: false });
  if (q.q) query = query.or(`subject.ilike.%${q.q.replace(/[%_,]/g, " ")}%,public_id.ilike.%${q.q}%`);
  if (q.status) {
    const wanted = q.status.split(",").filter((s): s is TicketStatus => (statuses as readonly string[]).includes(s));
    if (wanted.length) query = query.in("status", wanted);
  }
  if (q.priority) query = query.eq("priority", q.priority);
  if (q.category) query = query.eq("category", q.category);
  if (q.assignee === "none") query = query.is("assignee_id", null);
  else if (q.assignee) {
    const assigneeId = await resolveAssignee(q.assignee, req.member!);
    query = assigneeId ? query.eq("assignee_id", assigneeId) : query.is("assignee_id", null);
  }
  const from = (q.page - 1) * q.perPage;
  const { data, count } = await query.range(from, from + q.perPage - 1);

  const team = await teamDirectory();
  const users = new Map((unwrap(await db.from("profiles").select("*").in("id", [...new Set((data ?? []).map((t) => t.user_id))]))).map((u) => [u.id, u]));
  const tickets = (data ?? []).map((t) => ({
    id: t.public_id,
    subject: t.subject,
    lang: t.lang,
    category: t.category,
    priority: t.priority,
    status: t.status,
    user: users.get(t.user_id) ? adminUserOf(users.get(t.user_id)!) : null,
    assignee: t.assignee_id ? (team.get(t.assignee_id)?.public_id ?? null) : null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    resolvedAt: t.resolved_at,
  }));
  res.json({ tickets, page: q.page, perPage: q.perPage, total: count ?? 0 });
});

/** Open, waiting and needs-attention counts for the stat cards. */
adminTicketsRouter.get("/stats", async (_req, res) => {
  const counting = () => db.from("tickets").select("id", { count: "exact", head: true });
  const live: TicketStatus[] = ["open", "progress", "waiting"];
  const [open, waiting, attention, resolved] = await Promise.all([
    counting().in("status", live),
    counting().eq("status", "waiting"),
    counting().in("status", live).in("priority", ["high", "urgent"]),
    counting().in("status", ["resolved", "closed"]),
  ]);
  res.json({ open: open.count ?? 0, waiting: waiting.count ?? 0, attention: attention.count ?? 0, resolved: resolved.count ?? 0 });
});

/* ---------------------------------------------------------------- create */

const createSchema = z.object({
  userId: z.string().regex(/^USR-\d+$/),
  subject: z.string().trim().min(3).max(160),
  category: z.enum(categories),
  priority: z.enum(priorities).default("medium"),
  status: z.enum(statuses).default("open"),
  assignee: z.string().nullable().default(null),
  description: z.string().trim().min(1).max(10_000),
  lang: z.enum(["en", "bn"]).optional(),
});

adminTicketsRouter.post("/", requirePermission("support.create"), attachments, validate("body", createSchema), async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  const user = unwrap(await db.from("profiles").select("*").eq("public_id", b.userId).maybeSingle(), "That reader");
  const full = await createTicket(
    {
      user,
      subject: b.subject,
      lang: b.lang ?? user.lang,
      category: b.category,
      priority: b.priority,
      status: b.status,
      assigneeId: await resolveAssignee(b.assignee, req.member!),
      message: b.description,
      files: (req.files as Express.Multer.File[] | undefined) ?? [],
    },
    actorOf(req),
  );
  await logAudit(req, { action: "ticket.create", target: { type: "ticket", id: full.ticket.public_id, label: label(full) }, changes: [{ field: "assignee", to: b.assignee }] });
  res.status(201).json({ ticket: adminTicketOf(full, await teamDirectory()) });
});

/* ------------------------------------------------------------------- one */

adminTicketsRouter.get("/:id", validate("params", ticketIdParam), async (req, res) => {
  res.json({ ticket: adminTicketOf(await loadTicket(parsed<{ id: string }>(req, "params").id), await teamDirectory()) });
});

const fieldPermissions: Record<Field, Parameters<typeof requirePermission>[0]> = {
  status: "support.status",
  priority: "support.status",
  category: "support.status",
  assignee: "support.assign",
};
const auditActions: Record<Field, string> = { status: "ticket.status", priority: "ticket.priority", category: "ticket.category", assignee: "ticket.assign" };

const changeSchema = z
  .object({
    status: z.enum(statuses),
    priority: z.enum(priorities),
    category: z.enum(categories),
    assignee: z.string().nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to change.");

async function applyChanges(req: Parameters<typeof actorOf>[0] & { member?: TeamMemberRow }, full: TicketFull, b: z.infer<typeof changeSchema>, audit: (action: string, full: TicketFull, from: unknown, to: unknown, field: string) => Promise<void>) {
  const me = req.member!;
  let next = full;
  for (const field of ["status", "priority", "category", "assignee"] as Field[]) {
    if (b[field] === undefined) continue;
    const value = field === "assignee" ? await resolveAssignee(b.assignee ?? null, me) : (b[field] as string);
    const before = field === "assignee" ? next.ticket.assignee_id : next.ticket[field];
    if (before === value) continue;
    next = await changeField(next, field, value, { kind: "team", member: me });
    await audit(field === "assignee" && value === null ? "ticket.unassign" : auditActions[field], next, before, value, field);
  }
  return next;
}

adminTicketsRouter.patch("/:id", validate("params", ticketIdParam), validate("body", changeSchema), async (req, res) => {
  const b = req.body as z.infer<typeof changeSchema>;
  for (const field of Object.keys(b) as Field[]) requirePermission(fieldPermissions[field])(req, res, (err?: unknown) => { if (err) throw err; });
  const team = await teamDirectory();
  const agent = (id: unknown) => (typeof id === "string" ? (team.get(id)?.public_id ?? id) : id);
  const next = await applyChanges(req, await loadTicket(parsed<{ id: string }>(req, "params").id), b, (action, full, from, to, field) =>
    logAudit(req, { action, target: { type: "ticket", id: full.ticket.public_id, label: label(full) }, changes: [{ field, from: field === "assignee" ? agent(from) : from, to: field === "assignee" ? agent(to) : to }] }),
  );
  res.json({ ticket: adminTicketOf(next, team) });
});

/** The same change on several tickets (the list's bulk bar). */
adminTicketsRouter.post("/bulk", validate("body", z.object({ ids: z.array(z.string().regex(/^TKT-\d{6}$/)).min(1).max(100), change: changeSchema })), async (req, res) => {
  const { ids, change } = req.body as { ids: string[]; change: z.infer<typeof changeSchema> };
  for (const field of Object.keys(change) as Field[]) requirePermission(fieldPermissions[field])(req, res, (err?: unknown) => { if (err) throw err; });
  const team = await teamDirectory();
  const agent = (id: unknown) => (typeof id === "string" ? (team.get(id)?.public_id ?? id) : id);
  const tickets = [];
  for (const id of ids) {
    const next = await applyChanges(req, await loadTicket(id), change, (action, full, from, to, field) =>
      logAudit(req, { action, target: { type: "ticket", id: full.ticket.public_id, label: label(full) }, changes: [{ field, from: field === "assignee" ? agent(from) : from, to: field === "assignee" ? agent(to) : to }] }),
    );
    tickets.push(adminTicketOf(next, team));
  }
  res.json({ tickets });
});

/* -------------------------------------------------------------- messages */

const messageSchema = z.object({
  kind: z.enum(["reply", "note"]),
  text: z.string().trim().min(1).max(10_000),
  /** For replies: the status the ticket moves to once sent (the composer's "then mark as") */
  then: z.enum(statuses).optional(),
});

adminTicketsRouter.post("/:id/messages", validate("params", ticketIdParam), attachments, validate("body", messageSchema), async (req, res) => {
  const b = req.body as z.infer<typeof messageSchema>;
  requirePermission(b.kind === "reply" ? "support.reply" : "support.note")(req, res, (err?: unknown) => { if (err) throw err; });
  let full = await loadTicket(parsed<{ id: string }>(req, "params").id);
  if (b.kind === "reply" && full.ticket.status === "closed") throw badRequest("Reopen the ticket to reply.");
  const me = req.member!;
  // Replies end with the member's sign-off, when they've set one
  const signOff = b.kind === "reply" ? ((full.ticket.lang === "bn" && me.signature_bn) || me.signature).trim() : "";
  const body = signOff ? `${b.text}\n\n${signOff}` : b.text;
  full = await addMessage(full, b.kind, body, (req.files as Express.Multer.File[] | undefined) ?? [], actorOf(req));
  await logAudit(req, { action: b.kind === "reply" ? "ticket.reply" : "ticket.note", target: { type: "ticket", id: full.ticket.public_id, label: label(full) } });
  if (b.kind === "reply" && b.then && b.then !== full.ticket.status) {
    const before = full.ticket.status;
    full = await changeField(full, "status", b.then, actorOf(req));
    await logAudit(req, { action: "ticket.status", target: { type: "ticket", id: full.ticket.public_id, label: label(full) }, changes: [{ field: "status", from: before, to: b.then }] });
  }
  res.status(201).json({ ticket: adminTicketOf(full, await teamDirectory()) });
});

adminTicketsRouter.get("/files/:fileId", validate("params", z.object({ fileId: z.uuid() })), async (req, res) => {
  const file = unwrap(await db.from("ticket_files").select("*").eq("id", parsed<{ fileId: string }>(req, "params").fileId).maybeSingle(), "That file");
  res.redirect(302, await fileUrl(file));
});
