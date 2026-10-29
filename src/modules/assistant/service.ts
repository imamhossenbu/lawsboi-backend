import { HttpError, unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { summariesOf } from "../catalogue/cases.service.js";
import { clip, courtLabel, latinDigits, normalize, orderLabel, parseQuery, ruleLabel, sectionLabel, text, toTsQuery, type Text } from "../catalogue/shared.js";

// The assistant: no language model yet, so an answer is the provisions and judgments that best match the
// question, quoted, found by Postgres full-text search over everything the catalogue holds.

export type Scope = "all" | "laws" | "cases";
export type Lang = "en" | "bn";

export interface SourceHit {
  kind: "law" | "case";
  id: string;
  title: Text;
  /** "Section 151" / "Order XXXIX, Rule 1" / "19 SCOB [2024] AD 1". */
  label: Text;
  /** The law's title / the court. */
  context: Text;
  snippet: Text;
  /** A language-neutral site path. */
  href: string;
}

export interface Answer {
  query: string;
  scope: Scope;
  laws: SourceHit[];
  cases: SourceHit[];
}

const STOP = new Set(
  (
    "a an the of in on to for and or is are was be by with what which who how when where why does do can under " +
    "about any as at from it its this that there their my me i please explain law laws bangladesh case cases get " +
    "must should may shall into than then them they he she his her has have had not no yes also been being such " +
    "কি কী কে কোন কিভাবে কীভাবে কেন এবং বা ও এর এই সে যে হয় হবে আছে করে করা জন্য সম্পর্কে বাংলাদেশে বাংলাদেশের আইন আইনে " +
    "করতে পেতে যায় যাবে"
  ).split(" "),
);

/** The words worth searching for: no stop words, no single letters. */
export function questionWords(question: string) {
  const { words } = parseQuery(question);
  return [...new Set(words.filter((w) => !STOP.has(w)))];
}

/** The sentence sharing the most words with the question, trimmed. */
export function bestSentence(source: string, words: string[]) {
  const sentences = source.split(/(?<=[.।;:])\s+/);
  let best = sentences[0] ?? "";
  let bestHits = -1;
  for (const s of sentences) {
    const lower = normalize(s);
    const hits = words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
    if (hits > bestHits) {
      best = s;
      bestHits = hits;
    }
  }
  return clip(best, 240);
}

export async function answer(question: string, scope: Scope): Promise<Answer> {
  const words = questionWords(question);
  const { numbers } = parseQuery(question);
  const tsq = toTsQuery(words);
  const out: Answer = { query: question, scope, laws: [], cases: [] };
  if (!tsq && !numbers.length) return out;

  if (scope !== "cases") {
    const rows = tsq ? unwrap(await db.rpc("search_provisions", { tsq, max_rows: 30 })) : [];
    const numbered = numbers.length ? unwrap(await db.from("law_sections").select("law_slug,n,title,title_tr,body,translation,sort_order").in("n", numbers.filter((n) => !n.includes("."))).limit(20)) : [];
    const slugs = [...new Set([...rows.map((r) => r.law_slug), ...numbered.map((r) => r.law_slug)])];
    const laws = slugs.length ? unwrap(await db.from("laws").select("slug,title,title_bn,unit,views").in("slug", slugs).eq("published", true)) : [];
    const lawBy = new Map(laws.map((l) => [l.slug, l]));
    const scored = [
      ...numbered.map((s) => {
        const body = Array.isArray(s.body) ? (s.body as { text: string }[]).map((b) => b.text).join(" ") : "";
        const tr = (s.translation as { b?: string[] } | null)?.b?.join(" ") ?? null;
        return { kind: "section", law_slug: s.law_slug, n: s.n, order_n: null as string | null, roman: null as string | null, title: s.title, title_tr: s.title_tr, snippet: body, snippet_tr: tr, score: 25 + Number(lawBy.get(s.law_slug)?.views ?? 0) / 1e6 };
      }),
      ...rows.map((r) => ({ ...r, score: r.rank * 10 + (numbers.includes(r.n.toLowerCase()) ? 25 : 0) })),
    ].sort((a, b) => b.score - a.score);
    const top = scored[0]?.score ?? 0;
    out.laws = scored
      .filter((r) => r.score >= Math.max(0.3, top * 0.35) && lawBy.has(r.law_slug))
      .slice(0, 4)
      .map((r) => {
        const law = lawBy.get(r.law_slug)!;
        const unit = law.unit as "sections" | "articles";
        const label = r.kind === "rule" ? joinLabel(orderLabel(r.roman!, r.order_n!), ruleLabel(r.n)) : sectionLabel(r.n, unit);
        return {
          kind: "law" as const,
          id: r.kind === "rule" ? `${r.law_slug}-o-${r.order_n}-${r.n}` : `${r.law_slug}-s-${r.n}`,
          title: text(r.title, r.title_tr),
          label,
          context: text(law.title, law.title_bn),
          snippet: { en: bestSentence(r.snippet, words), bn: bestSentence(r.snippet_tr || r.snippet, words) },
          href: r.kind === "rule" ? `/bd/laws/${r.law_slug}/order-${r.order_n}#rule-${r.n}` : `/bd/laws/${r.law_slug}/section-${r.n}`,
        };
      });
  }

  if (scope !== "laws" && tsq) {
    const found = unwrap(await db.rpc("search_judgments", { tsq, max_rows: 8 }));
    if (found.length) {
      const rows = unwrap(await db.from("judgments").select("slug,title,title_tr,citation,case_no,court,decided_on,date_known,judges,author,type,keywords,excerpt,language,published,paragraph_count,updated_at,paragraphs").in("slug", found.map((f) => f.slug)));
      const rank = new Map(found.map((f) => [f.slug, f.rank]));
      const top = Math.max(...found.map((f) => f.rank));
      const summaries = await summariesOf(rows);
      out.cases = rows
        .filter((j) => (rank.get(j.slug) ?? 0) >= top * 0.35)
        .sort((a, b) => (rank.get(b.slug) ?? 0) - (rank.get(a.slug) ?? 0))
        .slice(0, 4)
        .map((j) => {
          const s = summaries.find((x) => x.slug === j.slug)!;
          const opening = (Array.isArray(j.paragraphs) ? (j.paragraphs as string[]).join(" ") : "").slice(0, 3500) || s.excerpt;
          return {
            kind: "case" as const,
            id: j.slug,
            title: text(j.title || j.case_no || j.citation, j.title_tr),
            label: { en: j.citation, bn: latinDigits(j.citation) },
            context: courtLabel(j.court),
            snippet: { en: bestSentence(opening, words), bn: bestSentence(opening, words) },
            href: `/bd/cases/${j.slug}`,
          };
        });
    }
  }
  return out;
}

const joinLabel = (a: Text, b: Text): Text => ({ en: `${a.en}, ${b.en}`, bn: `${a.bn}, ${b.bn}` });

/* -------------------------------------------------------------- allowance */

export type Limits = Record<string, number | null>;
export const DEFAULT_LIMITS: Limits = { free: 5, researcher: 30, professional: null };

export async function limits(): Promise<Limits> {
  const { data } = await db.from("site_settings").select("value").eq("key", "assistant_limits").maybeSingle();
  return data && typeof data.value === "object" && data.value ? { ...DEFAULT_LIMITS, ...(data.value as Limits) } : DEFAULT_LIMITS;
}

/** Months run on Bangladesh time (UTC+6, no daylight saving). */
export function monthStart(now = new Date()) {
  const dhaka = new Date(now.getTime() + 6 * 3_600_000);
  return new Date(Date.UTC(dhaka.getUTCFullYear(), dhaka.getUTCMonth(), 1) - 6 * 3_600_000);
}

export async function usage(userId: string, plan: string) {
  const [all, used] = await Promise.all([
    limits(),
    db.from("assistant_questions").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", monthStart().toISOString()),
  ]);
  const limit = all[plan] === undefined ? DEFAULT_LIMITS[plan] ?? null : all[plan]!;
  const next = monthStart();
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { used: used.count ?? 0, limit, resetsAt: next.toISOString() };
}

/** Throws when the reader's plan has no questions left this month. */
export function assertAllowance(u: { used: number; limit: number | null }) {
  if (u.limit !== null && u.used >= u.limit) {
    throw new HttpError("forbidden", "You've used this month's questions. Upgrade your plan or wait for the month to end.", { allowance: "exhausted" });
  }
}
