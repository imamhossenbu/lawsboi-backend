import { Router } from "express";
import { z } from "zod";
import { requireReader } from "../../middleware/auth.js";
import { parsed, validate } from "../../middleware/validate.js";
import { forbidden, notFound, unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import type { TicketRow } from "../../types/database.js";
import { newTicketSchema, pageQuery, readerMessageSchema, ticketIdParam } from "./schemas.js";
import { addMessage, changeField, createTicket, fileUrl, isDone, loadTicket, type TicketFull } from "./service.js";
import { attachments } from "./upload.js";

// The reader's side of support: their own tickets, what the team replied, and their attachments. Internal notes
// and the team's workflow states never appear here: a ticket is open or closed.

export const supportRouter = Router();
supportRouter.use(requireReader);

const readerStatus = (t: TicketRow) => (isDone(t.status) ? "closed" : "open");

function readerTicketOf(full: TicketFull) {
  const { ticket, messages, files, events } = full;
  const filesByMessage = new Map<string, typeof files>();
  for (const f of files) filesByMessage.set(f.message_id, [...(filesByMessage.get(f.message_id) ?? []), f]);
  const thread = messages
    .filter((m) => m.kind !== "note")
    .map((m) => ({
      id: m.id,
      at: m.created_at,
      author: m.kind === "reader" ? ("you" as const) : ("team" as const),
      text: m.body,
      files: (filesByMessage.get(m.id) ?? []).map((f) => ({ id: f.id, name: f.name, size: f.size, type: f.mime })),
    }));
  // Closings and reopenings show in the thread, as the reader site draws them
  const changes = events
    .filter((e) => e.kind === "status" && (isDone(e.to_value as never) !== isDone(e.from_value as never)))
    .map((e) => ({ id: e.id, at: e.created_at, event: isDone(e.to_value as never) ? ("closed" as const) : ("reopened" as const) }));
  return {
    id: ticket.public_id,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: readerStatus(ticket),
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    messages: [...thread, ...changes].sort((a, b) => a.at.localeCompare(b.at)),
  };
}

async function ownTicket(req: { reader?: { id: string } }, id: string) {
  const full = await loadTicket(id);
  if (full.ticket.user_id !== req.reader!.id) throw notFound("That ticket");
  return full;
}

supportRouter.get("/tickets", validate("query", pageQuery), async (req, res) => {
  const { page, perPage } = parsed<z.infer<typeof pageQuery>>(req, "query");
  const from = (page - 1) * perPage;
  const { data, count } = await db
    .from("tickets")
    .select("*", { count: "exact" })
    .eq("user_id", req.reader!.id)
    .order("updated_at", { ascending: false })
    .range(from, from + perPage - 1);
  res.json({
    tickets: (data ?? []).map((t) => ({ id: t.public_id, subject: t.subject, category: t.category, priority: t.priority, status: readerStatus(t), createdAt: t.created_at, updatedAt: t.updated_at })),
    page,
    perPage,
    total: count ?? 0,
  });
});

supportRouter.post("/tickets", attachments, validate("body", newTicketSchema), async (req, res) => {
  const me = req.reader!;
  const b = req.body as z.infer<typeof newTicketSchema>;
  const full = await createTicket(
    { user: me, subject: b.subject, lang: b.lang ?? me.lang, category: b.category, priority: b.priority, message: b.message, files: (req.files as Express.Multer.File[] | undefined) ?? [] },
    { kind: "reader", id: me.id },
  );
  res.status(201).json({ ticket: readerTicketOf(full) });
});

supportRouter.get("/tickets/:id", validate("params", ticketIdParam), async (req, res) => {
  res.json({ ticket: readerTicketOf(await ownTicket(req, parsed<{ id: string }>(req, "params").id)) });
});

supportRouter.post("/tickets/:id/messages", validate("params", ticketIdParam), attachments, validate("body", readerMessageSchema), async (req, res) => {
  const full = await ownTicket(req, parsed<{ id: string }>(req, "params").id);
  // Writing on a closed ticket reopens it, as the reader site does
  const reopened = isDone(full.ticket.status) ? await changeField(full, "status", "open", { kind: "reader", id: req.reader!.id }) : full;
  const next = await addMessage(reopened, "reader", req.body.message, (req.files as Express.Multer.File[] | undefined) ?? [], { kind: "reader", id: req.reader!.id });
  res.status(201).json({ ticket: readerTicketOf(next) });
});

supportRouter.post("/tickets/:id/close", validate("params", ticketIdParam), async (req, res) => {
  const full = await ownTicket(req, parsed<{ id: string }>(req, "params").id);
  const next = isDone(full.ticket.status) ? full : await changeField(full, "status", "closed", { kind: "reader", id: req.reader!.id });
  res.json({ ticket: readerTicketOf(next) });
});

supportRouter.post("/tickets/:id/reopen", validate("params", ticketIdParam), async (req, res) => {
  const full = await ownTicket(req, parsed<{ id: string }>(req, "params").id);
  const next = isDone(full.ticket.status) ? await changeField(full, "status", "open", { kind: "reader", id: req.reader!.id }) : full;
  res.json({ ticket: readerTicketOf(next) });
});

supportRouter.get("/files/:fileId", validate("params", z.object({ fileId: z.uuid() })), async (req, res) => {
  const file = unwrap(await db.from("ticket_files").select("*").eq("id", parsed<{ fileId: string }>(req, "params").fileId).maybeSingle(), "That file");
  const ticket = unwrap(await db.from("tickets").select("*").eq("id", file.ticket_id).single());
  if (ticket.user_id !== req.reader!.id) throw forbidden();
  const message = unwrap(await db.from("ticket_messages").select("kind").eq("id", file.message_id).single());
  if (message.kind === "note") throw forbidden();
  res.redirect(302, await fileUrl(file));
});
