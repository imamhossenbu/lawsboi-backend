import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../../lib/supabase.js";
import { parsed, validate } from "../../middleware/validate.js";
import { casesCitingLaw, courtTotals, getCase, latestCases, listCases, mostCitedSections } from "./cases.service.js";
import { catalogueTotals, getActText, getLaw, getOrder, getSection, LAW_TYPES, listLaws, popularLaws, SUBJECTS } from "./laws.service.js";
import { casesQuery, latestQuery, lawsQuery, provisionParam, readSchema, searchQuery, slugParam } from "./schemas.js";
import { searchLaws } from "./search.service.js";
import { sectionLabel, text } from "./shared.js";

// Public: laws, sections, judgments and search, as the reader site reads them. No sign-in; only published rows.

export const catalogueRouter = Router();

/* -------------------------------------------------------------- reference */

catalogueRouter.get("/subjects", (_req, res) => {
  res.json({ subjects: Object.entries(SUBJECTS).map(([key, label]) => ({ key, label })), types: Object.entries(LAW_TYPES).map(([key, label]) => ({ key, label })) });
});

catalogueRouter.get("/totals", async (_req, res) => {
  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: n, error } = await q;
    if (error) throw new Error(`Database: ${error.message}`);
    return n ?? 0;
  };
  const head = { count: "exact", head: true } as const;
  const [laws, courts, sections, rules, judgments] = await Promise.all([
    catalogueTotals(),
    courtTotals(),
    count(db.from("law_sections").select("id", head)),
    count(db.from("law_rules").select("id", head)),
    count(db.from("judgments").select("slug", head).eq("published", true)),
  ]);
  // sections, rules and judgments are what the About page counts
  res.json({ laws, courts, sections, rules, judgments });
});

/* ------------------------------------------------------------------- laws */

catalogueRouter.get("/laws", validate("query", lawsQuery), async (req, res) => {
  const q = parsed<z.infer<typeof lawsQuery>>(req, "query");
  const result = await listLaws({
    query: q.q,
    field: q.field,
    types: q.types,
    statuses: q.statuses,
    yearFrom: q.yearFrom,
    yearTo: q.yearTo,
    subject: q.subject,
    letter: q.letter,
    sort: q.sort,
    page: q.perPage === "all" ? 1 : q.page,
    perPage: q.perPage === "all" ? 2000 : q.perPage,
  });
  if (q.fields === "summary") {
    res.json({ ...result, laws: result.laws.map(({ longTitle: _l, preamble: _p, date: _d, updatedAt: _u, ...rest }) => rest) });
    return;
  }
  res.json(result);
});

catalogueRouter.get("/laws/search", validate("query", searchQuery), async (req, res) => {
  const { q, limit } = parsed<z.infer<typeof searchQuery>>(req, "query");
  res.json({ hits: await searchLaws(q, limit) });
});

catalogueRouter.get("/laws/:slug", validate("params", slugParam), async (req, res) => {
  res.json(await getLaw(parsed<{ slug: string }>(req, "params").slug));
});

catalogueRouter.get("/laws/:slug/text", validate("params", slugParam), async (req, res) => {
  res.json({ text: await getActText(parsed<{ slug: string }>(req, "params").slug) });
});

catalogueRouter.get("/laws/:slug/cases", validate("params", slugParam), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  await getLaw(slug);
  res.json({ cases: await casesCitingLaw(slug) });
});

catalogueRouter.get("/laws/:slug/sections/:n", validate("params", provisionParam), async (req, res) => {
  const { slug, n } = parsed<{ slug: string; n: string }>(req, "params");
  res.json({ section: await getSection(slug, n) });
});

catalogueRouter.get("/laws/:slug/orders/:n", validate("params", provisionParam), async (req, res) => {
  const { slug, n } = parsed<{ slug: string; n: string }>(req, "params");
  res.json({ order: await getOrder(slug, n) });
});

/* ------------------------------------------------------------------ cases */

catalogueRouter.get("/cases", validate("query", casesQuery), async (req, res) => {
  const q = parsed<z.infer<typeof casesQuery>>(req, "query");
  res.json(await listCases({ query: q.q, field: q.field, courts: q.courts, types: q.types, yearFrom: q.yearFrom, yearTo: q.yearTo, law: q.law, sort: q.sort, page: q.perPage === "all" ? 1 : q.page, perPage: q.perPage === "all" ? 1000 : q.perPage }));
});

catalogueRouter.get("/cases/latest", validate("query", latestQuery), async (req, res) => {
  res.json({ cases: await latestCases(parsed<{ limit: number }>(req, "query").limit) });
});

catalogueRouter.get("/cases/:slug", validate("params", slugParam), async (req, res) => {
  res.json({ case: await getCase(parsed<{ slug: string }>(req, "params").slug) });
});

/* ------------------------------------------------------------------- home */

/** Everything the landing page shows: popular laws, the newest judgments, and the sections readers open most. */
catalogueRouter.get("/home", async (_req, res) => {
  const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const [laws, cases, month, week] = await Promise.all([
    popularLaws(6),
    latestCases(5),
    db.from("catalogue_reads").select("slug,n").eq("kind", "section").gte("read_at", since(30)).limit(5000),
    db.from("catalogue_reads").select("slug,n").eq("kind", "section").gte("read_at", since(7)).limit(5000),
  ]);
  const tally = (rows: { slug: string; n: string | null }[] | null) => {
    const counts = new Map<string, number>();
    for (const r of rows ?? []) if (r.n) counts.set(`${r.slug}\n${r.n}`, (counts.get(`${r.slug}\n${r.n}`) ?? 0) + 1);
    return counts;
  };
  const monthly = tally(month.data);
  const weekly = tally(week.data);
  // Until readers have opened enough sections, the most-cited ones stand in
  let top = [...monthly.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, views]) => {
    const [law, n] = key.split("\n") as [string, string];
    return { law, n, views };
  });
  if (top.length < 5) top = [...top, ...(await mostCitedSections(5)).filter((c) => !top.some((t) => t.law === c.law && t.n === c.n))].slice(0, 5);
  const lawSlugs = [...new Set(top.map((t) => t.law))];
  const [lawRows, sectionRows] = await Promise.all([
    lawSlugs.length ? db.from("laws").select("slug,title,title_bn,unit").in("slug", lawSlugs) : { data: [] },
    lawSlugs.length ? db.from("law_sections").select("law_slug,n,title,title_tr").in("law_slug", lawSlugs).in("n", top.map((t) => t.n)) : { data: [] },
  ]);
  const lawBy = new Map((lawRows.data ?? []).map((l) => [l.slug, l]));
  const sections = top.flatMap((t) => {
    const law = lawBy.get(t.law);
    const s = (sectionRows.data ?? []).find((x) => x.law_slug === t.law && x.n === t.n);
    if (!law || !s) return [];
    const unit = law.unit as "sections" | "articles";
    return [{
      href: `/bd/laws/${t.law}/section-${t.n}`,
      law: t.law,
      n: t.n,
      label: sectionLabel(t.n, unit),
      title: text(s.title, s.title_tr),
      lawTitle: text(law.title, law.title_bn),
      views: { month: monthly.get(`${t.law}\n${t.n}`) ?? t.views, week: weekly.get(`${t.law}\n${t.n}`) ?? 0 },
    }];
  });
  res.json({ laws, cases, sections });
});

/* ------------------------------------------------------------------ reads */

const reads = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });

// One read per viewer and page every half hour, so reloads don't move "most viewed" or the week's figures.
// Kept in this process's memory: a restart or a second instance may count one extra read, which is harmless.
const READ_WINDOW_MS = 30 * 60 * 1000;
const recentReads = new Map<string, number>();

/** Whether this viewer already read this page in the window; records it when not. */
export function seenRecently(key: string, now = Date.now()) {
  const last = recentReads.get(key);
  if (last !== undefined && now - last < READ_WINDOW_MS) return true;
  recentReads.set(key, now);
  // Forget old entries now and then so the map stays small
  if (recentReads.size > 50_000) for (const [k, t] of recentReads) if (now - t >= READ_WINDOW_MS) recentReads.delete(k);
  return false;
}

/** A reader opened a law, section, Order or judgment. Counts towards "most viewed"; who read it is kept only when
 * the request carries a token. Repeats within half an hour from the same reader (or address) aren't counted. */
catalogueRouter.post("/reads", reads, validate("body", readSchema), async (req, res) => {
  const b = req.body as z.infer<typeof readSchema>;
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  const user = token ? (await db.auth.getUser(token)).data.user?.id ?? null : null;
  const viewer = user ?? `ip:${req.ip ?? "unknown"}`;
  if (seenRecently(`${viewer}|${b.kind}|${b.slug}|${b.n ?? ""}`)) {
    res.status(202).json({ ok: true, counted: false });
    return;
  }
  await db.from("catalogue_reads").insert({ kind: b.kind, slug: b.slug, n: b.n ?? null, user_id: user });
  res.status(202).json({ ok: true, counted: true });
});
