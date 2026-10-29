import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import { logAudit } from "../../audit/service.js";
import { fetchAll } from "../../catalogue/shared.js";
import { DEFAULT_LIMITS, limits, monthStart, type Limits } from "../../assistant/service.js";

// Team: what readers asked the assistant, each plan's monthly allowance, and the questions flagged for the
// content team.

export const adminAssistantRouter = Router();
adminAssistantRouter.use(requireTeam, requirePermission("assistant.view"));

type Coverage = "both" | "laws" | "cases" | "none";
const coverageOf = (answer: unknown): Coverage => {
  const a = (answer ?? {}) as { laws?: unknown[]; cases?: unknown[] };
  const laws = a.laws?.length ?? 0;
  const cases = a.cases?.length ?? 0;
  return laws && cases ? "both" : laws ? "laws" : cases ? "cases" : "none";
};

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  plan: z.enum(["free", "researcher", "professional"]).optional(),
  lang: z.enum(["en", "bn"]).optional(),
  coverage: z.enum(["both", "laws", "cases", "none"]).optional(),
  flagged: z.enum(["true", "false"]).optional(),
  /** "2026-10": Bangladesh-time month. */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  user: z.string().regex(/^USR-\d+$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1) - 6 * 3_600_000);
  const end = new Date(Date.UTC(y, m, 1) - 6 * 3_600_000);
  return { start: start.toISOString(), end: end.toISOString() };
};

const QUESTION = "id,question,lang,scope,answer,flagged,created_at,user_id,profiles!inner(public_id,name,name_bn,email,plan_id)";

function questionOf(q: { id: string; question: string; lang: string; scope: string; answer: unknown; flagged: boolean; created_at: string; profiles: { public_id: string; name: string; name_bn: string | null; email: string; plan_id: string } | null }) {
  const a = (q.answer ?? {}) as { laws?: unknown[]; cases?: unknown[]; text?: string | null; citations?: unknown[]; model?: string | null; reason?: string | null };
  return {
    id: q.id,
    question: q.question,
    lang: q.lang,
    scope: q.scope,
    coverage: coverageOf(q.answer),
    laws: a.laws ?? [],
    cases: a.cases ?? [],
    // The written answer (null on questions asked before the model was connected, or when writing failed)
    text: a.text ?? null,
    citations: a.citations ?? [],
    model: a.model ?? null,
    reason: a.reason ?? null,
    flagged: q.flagged,
    at: q.created_at,
    user: q.profiles ? { id: q.profiles.public_id, name: { en: q.profiles.name, bn: q.profiles.name_bn ?? q.profiles.name }, email: q.profiles.email, plan: q.profiles.plan_id } : null,
  };
}

adminAssistantRouter.get("/questions", validate("query", listQuery), async (req, res) => {
  const q = parsed<z.infer<typeof listQuery>>(req, "query");
  let query = db.from("assistant_questions").select(QUESTION, { count: "exact" }).order("created_at", { ascending: false });
  if (q.plan) query = query.eq("profiles.plan_id", q.plan);
  if (q.user) query = query.eq("profiles.public_id", q.user);
  if (q.lang) query = query.eq("lang", q.lang);
  if (q.flagged) query = query.eq("flagged", q.flagged === "true");
  if (q.month) {
    const { start, end } = monthRange(q.month);
    query = query.gte("created_at", start).lt("created_at", end);
  }
  if (q.q) query = query.ilike("question", `%${q.q.replace(/[%_,()]/g, " ").trim()}%`);
  // Coverage lives inside the answer, so it is filtered after the fetch (over the latest 1,000 at most)
  if (q.coverage) {
    const { data, error } = await query.limit(1000);
    if (error) throw new Error(`Database: ${error.message}`);
    const all = (data ?? []).map(questionOf).filter((x) => x.coverage === q.coverage);
    const from = (q.page - 1) * q.perPage;
    res.json({ questions: all.slice(from, from + q.perPage), total: all.length, page: q.page, perPage: q.perPage });
    return;
  }
  const from = (q.page - 1) * q.perPage;
  const { data, count, error } = await query.range(from, from + q.perPage - 1);
  if (error) throw new Error(`Database: ${error.message}`);
  res.json({ questions: (data ?? []).map(questionOf), total: count ?? 0, page: q.page, perPage: q.perPage });
});

/** Questions per month for the last twelve months, by plan, plus this month's readers and the top questions. */
adminAssistantRouter.get("/stats", async (_req, res) => {
  const start = monthStart();
  start.setUTCMonth(start.getUTCMonth() - 11);
  const rows = await fetchAll<{ created_at: string; question: string; lang: string; user_id: string | null; profiles: { plan_id: string } | null }>((a, b) =>
    db.from("assistant_questions").select("created_at,question,lang,user_id,profiles(plan_id)").gte("created_at", start.toISOString()).order("created_at").range(a, b),
  );
  const monthOf = (iso: string) => new Date(Date.parse(iso) + 6 * 3_600_000).toISOString().slice(0, 7);
  const months = new Map<string, { month: string; total: number; byPlan: Record<string, number> }>();
  const thisMonth = monthOf(new Date().toISOString());
  const [y0, m0] = thisMonth.split("-").map(Number) as [number, number];
  for (let i = 11; i >= 0; i--) {
    const index = y0 * 12 + (m0 - 1) - i;
    const key = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    months.set(key, { month: key, total: 0, byPlan: { free: 0, researcher: 0, professional: 0 } });
  }
  const readers = new Set<string>();
  const top = new Map<string, { question: string; lang: string; count: number }>();
  for (const r of rows) {
    const m = months.get(monthOf(r.created_at));
    const plan = r.profiles?.plan_id ?? "free";
    if (m) {
      m.total++;
      m.byPlan[plan] = (m.byPlan[plan] ?? 0) + 1;
    }
    if (monthOf(r.created_at) === thisMonth) {
      if (r.user_id) readers.add(r.user_id);
      const key = r.question.trim().toLowerCase();
      const t = top.get(key) ?? { question: r.question, lang: r.lang, count: 0 };
      t.count++;
      top.set(key, t);
    }
  }
  res.json({
    months: [...months.values()],
    thisMonth: { month: thisMonth, questions: months.get(thisMonth)?.total ?? 0, readers: readers.size },
    topQuestions: [...top.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    limits: await limits(),
  });
});

adminAssistantRouter.get("/limits", async (_req, res) => {
  res.json({ limits: await limits() });
});

const limitsSchema = z.object({ free: z.number().int().min(0).nullable(), researcher: z.number().int().min(0).nullable(), professional: z.number().int().min(0).nullable() });

adminAssistantRouter.put("/limits", requirePermission("assistant.manage"), validate("body", limitsSchema), async (req, res) => {
  const next = req.body as Limits;
  const before = await limits();
  const { error } = await db.from("site_settings").upsert({ key: "assistant_limits", value: next as never, updated_by: req.member!.id }, { onConflict: "key" });
  if (error) throw new Error(`site_settings: ${error.message}`);
  const changes = Object.keys(DEFAULT_LIMITS).filter((p) => before[p] !== next[p]).map((p) => ({ field: "limit", of: p, from: before[p], to: next[p] }));
  if (changes.length) await logAudit(req, { action: "assistant.limits", target: { type: "settings", id: "assistant", label: { en: "AI Assistant limits", bn: "এআই সহকারীর সীমা" } }, changes });
  res.json({ limits: next });
});

adminAssistantRouter.post("/questions/:id/flag", requirePermission("assistant.manage"), validate("params", z.object({ id: z.uuid() })), validate("body", z.object({ flagged: z.boolean() })), async (req, res) => {
  const { id } = parsed<{ id: string }>(req, "params");
  const { flagged } = req.body as { flagged: boolean };
  const row = unwrap(await db.from("assistant_questions").update({ flagged }).eq("id", id).select(QUESTION).maybeSingle(), "That question");
  await logAudit(req, { action: flagged ? "assistant.flag" : "assistant.unflag", target: { type: "question", id, label: { en: row.question, bn: row.question } } });
  res.json({ question: questionOf(row as never) });
});
