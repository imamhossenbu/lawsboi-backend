import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireReader } from "../../middleware/auth.js";
import { parsed, validate } from "../../middleware/validate.js";
import { notFound, unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { fetchAll } from "../catalogue/shared.js";
import { emptyRetrieved, isAboutLawsboi, isSmallTalk, readImages, withImageTerms, retrieveForAnswer, retrieveForFollowUp, withWriting, writeAnswer, type Turn } from "./answer.js";
import { assertAllowance, pinnedSource, usage, withPinned, type AskContext } from "./service.js";

// Readers: ask the assistant (counted against the plan's monthly allowance), see the month's usage and their history.
// Visitors get a few rate-limited, unlogged previews from the landing page, with a short answer.
// An answer is the matching sources plus a text written from them (answer.ts); a failed write still returns 201
// with the sources, text: null and a reason, and still counts as a question.

export const assistantRouter = Router();

const askSchema = z.object({
  question: z.string().trim().min(2, "Ask a question.").max(500),
  scope: z.enum(["all", "laws", "cases"]).default("all"),
  lang: z.enum(["en", "bn"]).default("en"),
  // A follow-up in an existing chat; without it the question starts a new one
  conversationId: z.uuid().optional(),
  // The law, section or judgment the reader asked from ("Ask AI" on its page): it leads the sources
  context: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("law"), slug: z.string().regex(/^[a-z0-9-]{1,120}$/), n: z.string().regex(/^[0-9]+[a-z]?(?:-\d+)?$/i).optional() }),
      z.object({ kind: z.literal("case"), slug: z.string().regex(/^[a-z0-9-]{1,120}$/) }),
    ])
    .optional(),
  // Photos or screenshots the reader attached (signed-in readers): base64 JPEG/PNG/WebP, made small by the site
  images: z
    .array(z.object({ mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().max(1_400_000).regex(/^[A-Za-z0-9+/=]+$/) }))
    .max(3)
    .optional(),
});

/** The page asked from, as a pinned source and the line the model is told about it. */
async function pinnedFor(context: AskContext | undefined) {
  if (!context) return null;
  const p = await pinnedSource(context).catch(() => null);
  return p && { ...p, note: `${p.hit.label.en}, ${p.hit.context.en}` };
}

const EARLIER_TURNS = 3;

const previews = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

assistantRouter.post("/preview", previews, validate("body", askSchema), async (req, res) => {
  const b = req.body as z.infer<typeof askSchema>;
  const pinned = await pinnedFor(b.context);
  // "hi", "thanks": a friendly line, no search
  const found = isSmallTalk(b.question) || isAboutLawsboi(b.question) ? emptyRetrieved(b.question, b.scope) : withPinned(await retrieveForAnswer(b.question, b.scope, b.lang, {}), pinned);
  const written = await writeAnswer(b.question, b.lang, found, { short: true, caller: {}, ...(pinned && { pinned: pinned.note }) });
  res.json({ answer: withWriting(found.answer, written) });
});

/** The chat's last few questions and answers, oldest first; 404 when it isn't the reader's. */
async function earlierTurns(userId: string, conversationId: string): Promise<Turn[]> {
  const { data } = await db
    .from("assistant_questions")
    .select("question,answer")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(EARLIER_TURNS);
  if (!data?.length) throw notFound("That conversation");
  return data.reverse().map((r) => ({ question: r.question, answer: (r.answer as { text?: string | null } | null)?.text ?? null }));
}

assistantRouter.post("/ask", requireReader, validate("body", askSchema), async (req, res) => {
  const me = req.reader!;
  const b = req.body as z.infer<typeof askSchema>;
  const earlier = b.conversationId ? await earlierTurns(me.id, b.conversationId) : [];
  const before = await usage(me.id, me.plan_id);
  assertAllowance(before);
  // A follow-up ("and in a dwelling house?") is searched in the light of the chat's previous question
  const last = earlier.at(-1);
  const caller = { userId: me.id };
  const images = (b.images ?? []).map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType }));
  // An image's legal points join the question's words in the search
  const [pinned, seen] = await Promise.all([pinnedFor(b.context), readImages(images, b.question, caller)]);
  // "hi", "thanks" (with no image): a friendly line, no search
  const chatty = (isSmallTalk(b.question) || isAboutLawsboi(b.question)) && !images.length;
  const asked = chatty
    ? emptyRetrieved(b.question, b.scope)
    : last
      ? await retrieveForFollowUp(b.question, last.question, b.scope, b.lang, caller)
      : await retrieveForAnswer(b.question, b.scope, b.lang, caller);
  const found = chatty ? asked : withPinned(await withImageTerms(asked, seen?.terms, b.scope), pinned);
  const written = await writeAnswer(b.question, b.lang, found, { caller, earlier, ...(images.length && { images }), ...(pinned && { pinned: pinned.note }) });
  const result = withWriting(found.answer, written);
  const row = unwrap(
    await db
      .from("assistant_questions")
      .insert({
        user_id: me.id,
        ...(b.conversationId && { conversation_id: b.conversationId }),
        question: b.question,
        lang: written.lang,
        scope: b.scope,
        answer: {
          laws: result.laws,
          cases: result.cases,
          text: result.text,
          citations: result.citations,
          model: result.model,
          reason: result.reason ?? null,
          // The images themselves aren't kept: the chat shows how many there were and what they showed
          ...(images.length && { attachments: { images: images.length, gist: seen?.gist ?? null } }),
          ...(b.context && { context: b.context }),
        } as never,
      })
      .select("id,created_at,conversation_id")
      .single(),
  );
  res.status(201).json({
    id: row.id,
    conversationId: row.conversation_id,
    at: row.created_at,
    answer: { ...result, ...(images.length && { attachments: { images: images.length, gist: seen?.gist ?? null } }) },
    usage: { ...before, used: before.used + 1 },
  });
});

assistantRouter.get("/usage", requireReader, async (req, res) => {
  res.json({ usage: await usage(req.reader!.id, req.reader!.plan_id) });
});

const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), perPage: z.coerce.number().int().min(1).max(100).default(20) });

const historyQuery = pageQuery.extend({ conversationId: z.uuid().optional(), saved: z.enum(["true", "false"]).optional() });

/** The reader's questions with their answers, newest first; one chat's with `conversationId`. */
assistantRouter.get("/history", requireReader, validate("query", historyQuery), async (req, res) => {
  const { page, perPage, conversationId, saved } = parsed<z.infer<typeof historyQuery>>(req, "query");
  const from = (page - 1) * perPage;
  let query = db
    .from("assistant_questions")
    .select("id,conversation_id,question,lang,scope,answer,saved,created_at", { count: "exact" })
    .eq("user_id", req.reader!.id)
    .is("deleted_at", null);
  if (conversationId) query = query.eq("conversation_id", conversationId);
  if (saved) query = query.eq("saved", saved === "true");
  const { data, count } = await query.order("created_at", { ascending: false }).range(from, from + perPage - 1);
  res.json({
    questions: (data ?? []).map((q) => ({ id: q.id, conversationId: q.conversation_id, question: q.question, lang: q.lang, scope: q.scope, answer: q.answer, saved: q.saved, at: q.created_at })),
    page,
    perPage,
    total: count ?? 0,
  });
});

/** The reader's chats, latest activity first: the first question as its title, how many questions, saved or not. */
assistantRouter.get("/conversations", requireReader, validate("query", pageQuery), async (req, res) => {
  const { page, perPage } = parsed<z.infer<typeof pageQuery>>(req, "query");
  const rows = await fetchAll<{ conversation_id: string; question: string; lang: string; saved: boolean; created_at: string }>((a, z_) =>
    db.from("assistant_questions").select("conversation_id,question,lang,saved,created_at").eq("user_id", req.reader!.id).is("deleted_at", null).order("created_at").range(a, z_) as never,
  );
  const chats = new Map<string, { id: string; title: string; lang: string; count: number; saved: boolean; startedAt: string; lastAt: string }>();
  for (const r of rows) {
    const c = chats.get(r.conversation_id) ?? { id: r.conversation_id, title: r.question, lang: r.lang, count: 0, saved: false, startedAt: r.created_at, lastAt: r.created_at };
    c.count++;
    c.saved ||= r.saved;
    c.lastAt = r.created_at;
    chats.set(r.conversation_id, c);
  }
  const all = [...chats.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const from = (page - 1) * perPage;
  res.json({ conversations: all.slice(from, from + perPage), page, perPage, total: all.length });
});

/** Erases what was asked and answered but keeps the rows: the month's allowance counts every question asked. */
const erase = { question: "", answer: null, saved: false };

assistantRouter.delete("/history/:id", requireReader, validate("params", z.object({ id: z.uuid() })), async (req, res) => {
  const { id } = parsed<{ id: string }>(req, "params");
  const { data } = await db
    .from("assistant_questions")
    .update({ ...erase, deleted_at: new Date().toISOString() })
    .eq("user_id", req.reader!.id)
    .is("deleted_at", null)
    .or(`conversation_id.eq.${id},id.eq.${id}`)
    .select("id");
  if (!data?.length) throw notFound("That conversation");
  res.status(204).end();
});

assistantRouter.delete("/history", requireReader, async (req, res) => {
  await db.from("assistant_questions").update({ ...erase, deleted_at: new Date().toISOString() }).eq("user_id", req.reader!.id).is("deleted_at", null);
  res.status(204).end();
});

/** Saves (or un-saves) a whole chat, for the Library. */
assistantRouter.post("/history/:id/save", requireReader, validate("params", z.object({ id: z.uuid() })), validate("body", z.object({ saved: z.boolean().default(true) })), async (req, res) => {
  const { id } = parsed<{ id: string }>(req, "params");
  const { data } = await db
    .from("assistant_questions")
    .update({ saved: req.body.saved })
    .eq("user_id", req.reader!.id)
    .is("deleted_at", null)
    .or(`conversation_id.eq.${id},id.eq.${id}`)
    .select("id");
  if (!data?.length) throw notFound("That conversation");
  res.json({ conversationId: id, saved: req.body.saved });
});
