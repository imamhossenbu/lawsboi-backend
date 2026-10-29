import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireReader } from "../../middleware/auth.js";
import { parsed, validate } from "../../middleware/validate.js";
import { unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { answer, assertAllowance, usage } from "./service.js";

// Readers: ask the assistant (counted against the plan's monthly allowance), see the month's usage and their history.
// Visitors get a few rate-limited, unlogged previews from the landing page.

export const assistantRouter = Router();

const askSchema = z.object({
  question: z.string().trim().min(2, "Ask a question.").max(500),
  scope: z.enum(["all", "laws", "cases"]).default("all"),
  lang: z.enum(["en", "bn"]).default("en"),
});

const previews = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

assistantRouter.post("/preview", previews, validate("body", askSchema), async (req, res) => {
  const b = req.body as z.infer<typeof askSchema>;
  res.json({ answer: await answer(b.question, b.scope) });
});

assistantRouter.post("/ask", requireReader, validate("body", askSchema), async (req, res) => {
  const me = req.reader!;
  const b = req.body as z.infer<typeof askSchema>;
  const before = await usage(me.id, me.plan_id);
  assertAllowance(before);
  const result = await answer(b.question, b.scope);
  const row = unwrap(
    await db
      .from("assistant_questions")
      .insert({ user_id: me.id, question: b.question, lang: b.lang, scope: b.scope, answer: { laws: result.laws, cases: result.cases } as never })
      .select("id,created_at")
      .single(),
  );
  res.status(201).json({ id: row.id, at: row.created_at, answer: result, usage: { ...before, used: before.used + 1 } });
});

assistantRouter.get("/usage", requireReader, async (req, res) => {
  res.json({ usage: await usage(req.reader!.id, req.reader!.plan_id) });
});

const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), perPage: z.coerce.number().int().min(1).max(100).default(20) });

assistantRouter.get("/history", requireReader, validate("query", pageQuery), async (req, res) => {
  const { page, perPage } = parsed<z.infer<typeof pageQuery>>(req, "query");
  const from = (page - 1) * perPage;
  const { data, count } = await db
    .from("assistant_questions")
    .select("id,question,lang,scope,answer,created_at", { count: "exact" })
    .eq("user_id", req.reader!.id)
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1);
  res.json({ questions: (data ?? []).map((q) => ({ id: q.id, question: q.question, lang: q.lang, scope: q.scope, answer: q.answer, at: q.created_at })), page, perPage, total: count ?? 0 });
});
