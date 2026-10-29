import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { notFound, unwrap } from "../../lib/errors.js";
import { sendMail } from "../../lib/mail/send.js";
import { ticketInboxMail, ticketReplyMail } from "../../lib/mail/templates/ticket.js";
import { db } from "../../lib/supabase.js";
import type {
  Lang,
  MessageKind,
  ProfileRow,
  TeamMemberRow,
  TicketCategory,
  TicketEventKind,
  TicketEventRow,
  TicketFileRow,
  TicketMessageRow,
  TicketPriority,
  TicketRow,
  TicketStatus,
} from "../../types/rows.js";

// Everything that happens to a ticket, for both sides. The reader's router and the admin's router call these and
// shape the result for their own screens; the rules (who is told, what is logged) live here once.

export const BUCKET = "ticket-files";

export type Actor = { kind: "reader"; id: string } | { kind: "team"; member: TeamMemberRow };

export interface TicketFull {
  ticket: TicketRow;
  user: ProfileRow;
  messages: TicketMessageRow[];
  files: TicketFileRow[];
  events: TicketEventRow[];
}

export const isDone = (status: TicketStatus) => status === "resolved" || status === "closed";

/* ------------------------------------------------------------------ reads */

export async function loadTicket(publicId: string): Promise<TicketFull> {
  const ticket = unwrap(await db.from("tickets").select("*").eq("public_id", publicId).maybeSingle(), "That ticket");
  return loadTicketRow(ticket);
}

export async function loadTicketRow(ticket: TicketRow): Promise<TicketFull> {
  const [user, messages, files, events] = await Promise.all([
    db.from("profiles").select("*").eq("id", ticket.user_id).single(),
    db.from("ticket_messages").select("*").eq("ticket_id", ticket.id).order("created_at"),
    db.from("ticket_files").select("*").eq("ticket_id", ticket.id).order("created_at"),
    db.from("ticket_events").select("*").eq("ticket_id", ticket.id).order("created_at"),
  ]);
  return { ticket, user: unwrap(user, "The reader"), messages: unwrap(messages), files: unwrap(files), events: unwrap(events) };
}

/** A short-lived link to one attachment. */
export async function fileUrl(file: TicketFileRow) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(file.storage_path, 60 * 10, { download: file.name });
  if (error || !data) throw notFound("That file");
  return data.signedUrl;
}

/* ----------------------------------------------------------------- writes */

export interface Upload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_").slice(-100) || "file";

async function storeFiles(ticket: TicketRow, messageId: string, uploads: Upload[]) {
  const rows: TicketFileRow[] = [];
  for (const file of uploads) {
    const path = `${ticket.id}/${messageId}/${randomUUID()}-${safeName(file.originalname)}`;
    const { error } = await db.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) throw new Error(`Storage: ${error.message}`);
    rows.push(
      unwrap(
        await db
          .from("ticket_files")
          .insert({ ticket_id: ticket.id, message_id: messageId, name: file.originalname, size: file.size, mime: file.mimetype, storage_path: path })
          .select("*")
          .single(),
      ),
    );
  }
  return rows;
}

async function addEvent(ticket: TicketRow, kind: TicketEventKind, actor: Actor, from?: string | null, to?: string | null) {
  return unwrap(
    await db
      .from("ticket_events")
      .insert({
        ticket_id: ticket.id,
        kind,
        actor_kind: actor.kind,
        actor_id: actor.kind === "reader" ? actor.id : actor.member.id,
        from_value: from ?? null,
        to_value: to ?? null,
      })
      .select("*")
      .single(),
  );
}

export interface NewTicket {
  user: ProfileRow;
  subject: string;
  lang: Lang;
  category: TicketCategory;
  priority: TicketPriority;
  status?: TicketStatus;
  assigneeId?: string | null;
  message: string;
  files: Upload[];
}

/** Opens a ticket with the reader's first message. The team can open one for a reader too (a phone call). */
export async function createTicket(input: NewTicket, actor: Actor): Promise<TicketFull> {
  const ticket = unwrap(
    await db
      .from("tickets")
      .insert({
        user_id: input.user.id,
        subject: input.subject,
        lang: input.lang,
        category: input.category,
        priority: input.priority,
        status: input.status ?? "open",
        assignee_id: input.assigneeId ?? null,
      })
      .select("*")
      .single(),
  );
  const message = unwrap(
    await db
      .from("ticket_messages")
      .insert({ ticket_id: ticket.id, kind: "reader", author_kind: "reader", author_id: input.user.id, body: input.message })
      .select("*")
      .single(),
  );
  await storeFiles(ticket, message.id, input.files);
  await addEvent(ticket, "created", actor, null, "reader");
  if (input.assigneeId) await addEvent(ticket, "assigned", actor, null, input.assigneeId);
  if (input.status && input.status !== "open") await addEvent(ticket, "status", actor, "open", input.status);

  if (actor.kind === "reader") void notifyInbox(ticket, input.user, input.message, true);
  return loadTicketRow(ticket);
}

/** A reader's follow-up, a team reply (emailed to the reader) or an internal note. */
export async function addMessage(full: TicketFull, kind: MessageKind, body: string, files: Upload[], actor: Actor): Promise<TicketFull> {
  const { ticket, user } = full;
  const message = unwrap(
    await db
      .from("ticket_messages")
      .insert({ ticket_id: ticket.id, kind, author_kind: actor.kind, author_id: actor.kind === "reader" ? actor.id : actor.member.id, body })
      .select("*")
      .single(),
  );
  await storeFiles(ticket, message.id, files);
  if (kind !== "reader") await addEvent(ticket, kind, actor);

  if (kind === "reply" && actor.kind === "team") void notifyReader(ticket, user, actor.member, body);
  if (kind === "reader") void notifyInbox(ticket, user, body, false);
  return loadTicket(ticket.public_id);
}

export type Field = "status" | "priority" | "category" | "assignee";

/** One field on one ticket, with the change in its history. The same value again changes nothing. */
export async function changeField(full: TicketFull, field: Field, value: string | null, actor: Actor): Promise<TicketFull> {
  const { ticket } = full;
  const column = field === "assignee" ? "assignee_id" : field;
  const before = ticket[column];
  if (before === value) return full;

  const patch: Partial<TicketRow> = { [column]: value } as Partial<TicketRow>;
  if (field === "status") {
    const status = value as TicketStatus;
    patch.resolved_at = isDone(status) ? (isDone(ticket.status) ? ticket.resolved_at : new Date().toISOString()) : null;
  }
  const updated = unwrap(await db.from("tickets").update(patch).eq("id", ticket.id).select("*").single());
  const kind: TicketEventKind = field === "assignee" ? (value ? "assigned" : "unassigned") : field;
  await addEvent(updated, kind, actor, before, value);
  return loadTicketRow(updated);
}

/* ------------------------------------------------------------------ email */

const readerTicketUrl = (ticket: TicketRow, lang: Lang) => `${env.READER_URL}${lang === "bn" ? "/bn" : ""}/dashboard/help/tickets/${ticket.public_id}`;
const adminTicketUrl = (ticket: TicketRow) => `${env.ADMIN_URL}/support/${ticket.public_id}`;

async function notifyReader(ticket: TicketRow, user: ProfileRow, member: TeamMemberRow, body: string) {
  const lang = ticket.lang;
  const agent = (lang === "bn" && member.name_bn) || member.name;
  await sendMail({ to: user.email, ...ticketReplyMail({ id: ticket.public_id, subject: ticket.subject, agent, body, ticketUrl: readerTicketUrl(ticket, lang) }, lang) });
}

async function notifyInbox(ticket: TicketRow, user: ProfileRow, body: string, first: boolean) {
  const inbox = env.SUPPORT_INBOX || env.smtp?.user;
  if (!inbox) return;
  await sendMail({
    to: inbox,
    replyTo: user.email,
    ...ticketInboxMail(
      { id: ticket.public_id, subject: ticket.subject, name: user.name, email: user.email, category: ticket.category, priority: ticket.priority, body, adminUrl: adminTicketUrl(ticket), first },
      "en",
    ),
  });
}
