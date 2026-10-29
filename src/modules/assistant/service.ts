import { HttpError, unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { summariesOf } from "../catalogue/cases.service.js";
import { searchLaws } from "../catalogue/search.service.js";
import { clip, courtLabel, latinDigits, normalize, orderLabel, parseQuery, ruleLabel, sectionLabel, text, toTsQuery, type Text } from "../catalogue/shared.js";

// The assistant's retrieval: the provisions and judgments that best match the question, found by Postgres full-text
// search over everything the catalogue holds. answer.ts turns them into a written answer with the language model.

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

/** Where a source's full text lives, so the answer can be written from more than its snippet. */
export type SourceRef =
  | { kind: "section"; lawSlug: string; n: string }
  | { kind: "rule"; lawSlug: string; orderN: string; n: string }
  | { kind: "case"; slug: string };

export interface Retrieved {
  answer: Answer;
  /** One per hit, laws first then cases, in the same order. */
  refs: SourceRef[];
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

/** The matching sources only, as the assistant answered before it could write. */
export async function answer(question: string, scope: Scope): Promise<Answer> {
  return (await retrieve(question, scope)).answer;
}

/** Any of the words, for a model-written list of search terms where no source holds them all; ranking still puts
 * the sources holding the most of them first. */
export const anyWordsQuery = (words: string[]) => toTsQuery(words)?.replace(/ & /g, " | ") ?? null;

export async function retrieve(question: string, scope: Scope, options: { anyWords?: boolean } = {}): Promise<Retrieved> {
  const words = questionWords(question);
  // Section numbers only count when the reader typed them, not in a model's list of terms
  const numbers = options.anyWords ? [] : parseQuery(question).numbers;
  const tsq = options.anyWords ? anyWordsQuery(words) : toTsQuery(words);
  const out: Answer = { query: question, scope, laws: [], cases: [] };
  const lawRefs: SourceRef[] = [];
  const caseRefs: SourceRef[] = [];
  if (!tsq && !numbers.length) return { answer: out, refs: [] };

  if (scope !== "cases") {
    // The same search and ranking as the dashboard's law search, so the assistant cites what a reader would find
    const isProvision = (h: { kind: string }) => h.kind === "section" || h.kind === "rule";
    let hits = await searchLaws(question, 40, { anyWords: options.anyWords, words });
    // A question carries words the statute doesn't ("inherent powers of a *civil* court"). When no provision holds
    // them all, search again leaving out one word at a time and keep what most of those searches agree on; only
    // then any of the words (Postgres ranks those without regard to how rare a word is, so that comes last)
    if (!options.anyWords && words.length > 2 && !hits.some(isProvision)) hits = await leaveOneOut(question, words.slice(0, 6));
    if (!options.anyWords && words.length > 1 && !hits.some(isProvision)) hits = await searchLaws(question, 40, { anyWords: true, words });
    out.laws = hits
      .filter((h) => h.kind === "section" || h.kind === "rule")
      .slice(0, 4)
      .map((h) => {
        lawRefs.push(h.kind === "rule" ? { kind: "rule", lawSlug: h.slug, orderN: h.orderN!, n: h.n! } : { kind: "section", lawSlug: h.slug, n: h.n! });
        const unit = h.heading.en.startsWith("Article") ? "articles" : "sections";
        const label = h.kind === "rule" ? joinLabel(orderLabel(h.roman!, h.orderN!), ruleLabel(h.n!)) : sectionLabel(h.n!, unit);
        return {
          kind: "law" as const,
          id: h.kind === "rule" ? `${h.slug}-o-${h.orderN}-${h.n}` : `${h.slug}-s-${h.n}`,
          title: h.title,
          label,
          context: h.lawTitle,
          snippet: { en: bestSentence(h.snippet.en, words), bn: bestSentence(h.snippet.bn, words) },
          href: h.kind === "rule" ? `/bd/laws/${h.slug}/order-${h.orderN}#rule-${h.n}` : `/bd/laws/${h.slug}/section-${h.n}`,
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
          caseRefs.push({ kind: "case", slug: j.slug });
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
  return { answer: out, refs: [...lawRefs, ...caseRefs] };
}

/** Provisions found by the most leave-one-word-out searches, best first; ties keep the better search position. */
async function leaveOneOut(question: string, words: string[]) {
  const runs = await Promise.all(words.map((_, i) => searchLaws(question, 20, { words: words.filter((__, j) => j !== i) })));
  const tally = new Map<string, { hit: Awaited<ReturnType<typeof searchLaws>>[number]; votes: number; best: number }>();
  for (const run of runs) {
    run.filter((h) => h.kind === "section" || h.kind === "rule").forEach((hit, position) => {
      const t = tally.get(hit.id) ?? { hit, votes: 0, best: position };
      t.votes++;
      t.best = Math.min(t.best, position);
      tally.set(hit.id, t);
    });
  }
  return [...tally.values()].sort((a, b) => b.votes - a.votes || a.best - b.best).map((t) => t.hit);
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
