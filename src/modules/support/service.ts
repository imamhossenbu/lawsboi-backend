import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { badRequest, forbidden, notFound, unwrap } from "../../lib/errors.js";
import { sendMail } from "../../lib/mail/send.js";
import { ticketInboxMail, ticketReplyMail } from "../../lib/mail/templates/ticket.js";
import { deleteFile, putFile, signedFileUrl } from "../../lib/storage.js";
import { EDIT_WINDOW_MS, UNSEND_WINDOW_MS } from "./schemas.js";
import { db } from "../../lib/supabase.js";
import type { TablesUpdate } from "../../types/database.js";
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

/** A short-lived link to one attachment (shown in the page with `inline`: images in the chat). */
export async function fileUrl(file: TicketFileRow, inline = false) {
  try {
    return await signedFileUrl(file.storage_path, file.name, 60 * 10, inline);
  } catch {
    throw notFound("That file");
  }
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
    await putFile(path, file.buffer, file.mimetype);
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
export async function addMessage(full: TicketFull, kind: MessageKind, body: string, files: Upload[], actor: Actor, replyTo?: string): Promise<TicketFull> {
  const { ticket, user } = full;
  if (!body.trim() && !files.length) throw badRequest("Write a message or attach a file.", { message: "empty" });
  // A reply quotes a message of this ticket's conversation (a reader can't quote an internal note)
  const quoted = replyTo ? full.messages.find((m) => m.id === replyTo && !(actor.kind === "reader" && m.kind === "note")) : undefined;
  const message = unwrap(
    await db
      .from("ticket_messages")
      .insert({ ticket_id: ticket.id, kind, author_kind: actor.kind, author_id: actor.kind === "reader" ? actor.id : actor.member.id, body, reply_to: quoted?.id ?? null })
      .select("*")
      .single(),
  );
  await storeFiles(ticket, message.id, files);
  if (kind !== "reader") await addEvent(ticket, kind, actor);

  // Someone watching the chat sees the message at once; an email goes only to a side that isn't there
  if (kind === "reply" && actor.kind === "team") {
    if (!isActive(ticket.reader_seen_at)) void notifyReader(ticket, user, actor.member, body || "📎");
    void notifyReplyInApp(ticket, user, body);
  }
  if (kind === "reader" && !isActive(ticket.team_seen_at)) void notifyInbox(ticket, user, body || "📎", false);
  return loadTicket(ticket.public_id);
}

/** The message, when the actor wrote it. */
function ownMessage(full: TicketFull, messageId: string, actor: Actor) {
  const m = full.messages.find((x) => x.id === messageId);
  if (!m) throw notFound("That message");
  const mine = actor.kind === "reader" ? m.author_kind === "reader" && m.author_id === actor.id : m.author_kind === "team" && m.author_id === actor.member.id;
  if (!mine) throw forbidden("You can only change your own messages.");
  if (m.deleted_at) throw badRequest("That message was unsent.");
  return m;
}

/** Changes the text of one's own message, within a quarter of an hour of sending it. */
export async function editMessage(full: TicketFull, messageId: string, body: string, actor: Actor): Promise<TicketFull> {
  const m = ownMessage(full, messageId, actor);
  if (Date.now() - Date.parse(m.created_at) > EDIT_WINDOW_MS) throw badRequest("Messages can be edited for 15 minutes after sending.", { message: "late" });
  if (m.body === body) return full;
  await db.from("ticket_messages").update({ body, edited_at: new Date().toISOString() }).eq("id", m.id);
  return loadTicketRow(full.ticket);
}

/** Unsends one's own message (within two days): its text and files are removed for everyone; a placeholder stays. */
export async function unsendMessage(full: TicketFull, messageId: string, actor: Actor): Promise<TicketFull> {
  const m = ownMessage(full, messageId, actor);
  if (Date.now() - Date.parse(m.created_at) > UNSEND_WINDOW_MS) throw badRequest("Messages can be unsent for two days after sending.", { message: "late" });
  const files = full.files.filter((f) => f.message_id === m.id);
  await Promise.all(files.map((f) => deleteFile(f.storage_path).catch(() => undefined)));
  if (files.length) await db.from("ticket_files").delete().in("id", files.map((f) => f.id));
  await db.from("ticket_messages").update({ body: "", deleted_at: new Date().toISOString() }).eq("id", m.id);
  return loadTicketRow(full.ticket);
}

/** The reader or the team opened the conversation: what the other side wrote before now shows as seen. Written
 * only when there is something new, so polling an open ticket doesn't write every few seconds. */
export async function markSeen(full: TicketFull, side: "reader" | "team"): Promise<TicketFull> {
  const column = side === "reader" ? "reader_seen_at" : "team_seen_at";
  const seen = full.ticket[column];
  const theirs = full.messages.filter((m) => (side === "reader" ? m.kind === "reply" : m.kind === "reader"));
  const latest = theirs.at(-1)?.created_at;
  // Also refreshed once a minute while the chat is open, so the other side knows someone is there
  const fresh = !!seen && Date.now() - Date.parse(seen) < 60_000;
  if ((!latest || (seen && seen >= latest)) && fresh) return full;
  const at = new Date().toISOString();
  await db.from("tickets").update(side === "reader" ? { reader_seen_at: at } : { team_seen_at: at }).eq("id", full.ticket.id);
  return { ...full, ticket: { ...full.ticket, [column]: at } };
}

/** Opened the chat within the last minute and a half (its poll refreshes the mark once a minute). */
const isActive = (seenAt: string | null) => !!seenAt && Date.now() - Date.parse(seenAt) < 90_000;

export type Field = "status" | "priority" | "category" | "assignee";

/** One field on one ticket, with the change in its history. The same value again changes nothing. */
export async function changeField(full: TicketFull, field: Field, value: string | null, actor: Actor): Promise<TicketFull> {
  const { ticket } = full;
  const column = field === "assignee" ? "assignee_id" : field;
  const before = ticket[column];
  if (before === value) return full;

  const patch: TablesUpdate<"tickets"> = { [column]: value };
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

/** The reply in the reader's bell, beside the email. */
async function notifyReplyInApp(ticket: TicketRow, user: ProfileRow, body: string) {
  const text = body.replace(/\s+/g, " ").trim().slice(0, 160);
  await db.from("reader_notifications").insert({
    user_id: user.id,
    kind: "ticket_reply",
    title: `New reply on ${ticket.public_id}: ${ticket.subject}`.slice(0, 200),
    title_bn: `${ticket.public_id}-এ নতুন উত্তর: ${ticket.subject}`.slice(0, 200),
    body: text || "📎",
    body_bn: text || "📎",
    link: `/dashboard/help/tickets/${ticket.public_id}`,
  });
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
