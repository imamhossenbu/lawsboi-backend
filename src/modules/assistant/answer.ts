import { z } from "zod";
import { aiConfigured, AiError, generate, generateJson, type AiUsage } from "../../lib/ai/gemini.js";
import { tracked, type Caller } from "../../lib/ai/usage.js";
import { db } from "../../lib/supabase.js";
import { latinDigits, type Text } from "../catalogue/shared.js";
import { retrieve, type Answer, type Lang, type Retrieved, type Scope, type SourceHit, type SourceRef } from "./service.js";

// Writes the assistant's answer from the sources the search found, and only from them. Each source goes to the
// model numbered, with its full text (not just the snippet); the model cites them as [1], [2]… and those markers
// become the answer's citations. Without the model, or when it fails, the reader still gets the sources.

export interface Citation {
  index: number;
  kind: "law" | "case";
  id: string;
  title: Text;
  label: Text;
  href: string;
}

export interface Written {
  /** The answer in the question's language, plain paragraphs, citing sources as [n]; null when it couldn't be written. */
  text: string | null;
  /** The sources the text cites, by their [n]. */
  citations: Citation[];
  lang: Lang;
  model: string | null;
  /** Why there is no text: "no_sources", "not_configured", "unavailable", "invalid", "blocked". */
  reason?: string;
  usage?: AiUsage;
}

/** Bangla script anywhere means the reader wrote in Bangla, whatever the site's language. */
export const languageOf = (question: string, fallback: Lang): Lang => (/[ঀ-৿]/.test(question) ? "bn" : fallback);

const MAX_SOURCE_CHARS = 1_800;

/* -------------------------------------------------------------- retrieval */

const termsSchema = z.object({ terms: z.string().max(300) });

/** English search words for a question, from the model: most of the catalogue (and every SCOB judgment) is in
 * English, so a Bangla question, or one in everyday words, finds nothing until it is put in the law's own terms. */
async function searchTerms(question: string, caller: Caller) {
  const out = await tracked("assistant.terms", caller, () =>
    generateJson(
      {
        purpose: "assistant.terms",
        system:
          "Turn the reader's question about Bangladeshi law into English full-text search terms: the legal concepts, the key words of the act's name, and synonyms the statute itself would use (e.g. dower, maintenance, bail, theft). Return 4 to 12 space-separated words. No numbers, no years, no punctuation.",
        input: question,
        maxOutputTokens: 1_000,
        thinking: "minimal",
        budgetMs: 12_000,
      },
      termsSchema,
    ),
  );
  // Numbers would match every "section 9" in the catalogue, so only words go to the search
  return out.value.terms.replace(/[\d০-৯]+/g, " ").replace(/\s+/g, " ").trim();
}

const hitCount = (r: Retrieved) => r.answer.laws.length + r.answer.cases.length;

/** Takes turns from two ranked lists (with their refs), skipping repeats, up to `max`. */
export function interleave<T extends { id: string }, R>(a: { hits: T[]; refs: R[] }, b: { hits: T[]; refs: R[] }, max: number) {
  const hits: T[] = [];
  const refs: R[] = [];
  for (let i = 0; hits.length < max && (i < a.hits.length || i < b.hits.length); i++) {
    for (const side of [a, b]) {
      const hit = side.hits[i];
      if (hit && hits.length < max && !hits.some((h) => h.id === hit.id)) {
        hits.push(hit);
        refs.push(side.refs[i]!);
      }
    }
  }
  return { hits, refs };
}

const split = (r: Retrieved) => ({ laws: { hits: r.answer.laws, refs: r.refs.slice(0, r.answer.laws.length) }, cases: { hits: r.answer.cases, refs: r.refs.slice(r.answer.laws.length) } });

/** The search, and a second one in the law's English terms when the question is in Bangla (most of the catalogue,
 * and every judgment, is English, but 750 laws are Bangla) or an English question found little. A Bangla question
 * gets both searches' sources, taking turns; otherwise the search that found more wins. The answer keeps the
 * reader's own question. */
export async function retrieveForAnswer(question: string, scope: Scope, lang: Lang, caller: Caller): Promise<Retrieved> {
  const first = await retrieve(question, scope);
  const bangla = languageOf(question, lang) === "bn";
  if (!aiConfigured() || (!bangla && hitCount(first) >= 3)) return first;
  try {
    const terms = await searchTerms(question, caller);
    if (!terms) return first;
    const second = await retrieve(terms, scope, { anyWords: true });
    if (bangla) {
      const [s, f] = [split(second), split(first)];
      const laws = interleave(s.laws, f.laws, 5);
      const cases = interleave(s.cases, f.cases, 3);
      return { answer: { query: question, scope, laws: laws.hits, cases: cases.hits }, refs: [...laws.refs, ...cases.refs] };
    }
    if (hitCount(second) <= hitCount(first)) return first;
    return { answer: { ...second.answer, query: question }, refs: second.refs };
  } catch {
    return first;
  }
}

export interface Grounding {
  hit: SourceHit;
  text: string;
}

export function systemInstruction(lang: Lang, short: boolean) {
  const language = lang === "bn" ? "Bangla (Bengali script), in a clear formal register" : "English";
  return [
    "You are Lawsboi's legal research assistant for the laws and court judgments of Bangladesh.",
    "Answer the reader's question using ONLY the numbered sources you are given. Do not use outside knowledge, and never invent sections, cases, dates or penalties.",
    "Cite the source behind every statement with its number in square brackets using Latin digits, like [1] or [2][3], right after the statement.",
    "If the sources don't answer the question, or only answer part of it, say so plainly and say what they do cover.",
    `Write in ${language}. Keep section numbers, case citations and the names of acts as they appear in the sources.`,
    short
      ? "Keep it to two or three sentences."
      : "Use two to five short paragraphs; a short list with lines starting \"- \" is fine for steps or elements. No headings, no bold, no markdown tables.",
    "End with one short sentence noting this is legal information, not legal advice, and a lawyer should be consulted on a real matter.",
  ].join("\n");
}

/** An earlier question in the same chat and what was answered, so a follow-up can lean on it. */
export interface Turn {
  question: string;
  answer: string | null;
}

/** The model's input: the chat so far (when there is one), the question, then each source numbered with where
 * it's from and its text. */
export function buildPrompt(question: string, sources: Grounding[], earlier: Turn[] = []) {
  const blocks = sources.map((s, i) => {
    const where = s.hit.kind === "law" ? `${s.hit.label.en}, ${s.hit.context.en}` : `${s.hit.title.en}, ${s.hit.label.en} (${s.hit.context.en})`;
    return `[${i + 1}] ${where}\n${s.text.slice(0, MAX_SOURCE_CHARS)}`;
  });
  const chat = earlier.length
    ? `Earlier in this conversation (for context only; cite only the numbered sources below):\n${earlier.map((t) => `Q: ${t.question}\nA: ${(t.answer ?? "(no answer)").slice(0, 1200)}`).join("\n\n")}\n\n`
    : "";
  return `${chat}Question: ${question}\n\nSources:\n\n${blocks.join("\n\n")}`;
}

/** The [n] markers in the text that point at real sources, in order of first use. Bangla digits count too. */
export function citedIndexes(text: string, count: number) {
  const seen: number[] = [];
  for (const m of latinDigits(text).matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= count && !seen.includes(n)) seen.push(n);
  }
  return seen;
}

/** Markers written with Bangla digits become Latin, so the reader site can link every [n] the same way. */
export const normaliseMarkers = (text: string) => text.replace(/\[([০-৯]{1,2})\]/g, (_, d: string) => `[${latinDigits(d)}]`);

const blocksText = (body: unknown) => (Array.isArray(body) ? (body as { mark?: string; text?: string }[]).map((b) => [b.mark, b.text].filter(Boolean).join(" ")).join("\n") : "");

/** Each source's full text: the whole section or rule (and its translation), or a judgment's opening paragraphs. */
export async function groundingOf(retrieved: Retrieved): Promise<Grounding[]> {
  const hits = [...retrieved.answer.laws, ...retrieved.answer.cases];
  const texts = await Promise.all(
    retrieved.refs.map(async (ref: SourceRef, i) => {
      const fallback = hits[i]!.snippet.en;
      if (ref.kind === "section") {
        const { data } = await db.from("law_sections").select("title,body,translation").eq("law_slug", ref.lawSlug).eq("n", ref.n).maybeSingle();
        if (!data) return fallback;
        const tr = (data.translation as { b?: string[] } | null)?.b?.join("\n");
        return [data.title, blocksText(data.body), tr ? `(Translation)\n${tr}` : ""].filter(Boolean).join("\n");
      }
      if (ref.kind === "rule") {
        const { data: order } = await db.from("law_orders").select("id").eq("law_slug", ref.lawSlug).eq("n", ref.orderN).maybeSingle();
        const { data } = order ? await db.from("law_rules").select("title,body,translation").eq("order_id", order.id).eq("n", ref.n).maybeSingle() : { data: null };
        if (!data) return fallback;
        const tr = (data.translation as { b?: string[] } | null)?.b?.join("\n");
        return [data.title, blocksText(data.body), tr ? `(Translation)\n${tr}` : ""].filter(Boolean).join("\n");
      }
      const { data } = await db.from("judgments").select("excerpt,paragraphs").eq("slug", ref.slug).maybeSingle();
      const paras = Array.isArray(data?.paragraphs) ? (data!.paragraphs as string[]).join("\n") : "";
      return [data?.excerpt, paras].filter(Boolean).join("\n") || fallback;
    }),
  );
  return hits.map((hit, i) => ({ hit, text: texts[i] ?? hit.snippet.en }));
}

const citationOf = (hit: SourceHit, index: number): Citation => ({ index, kind: hit.kind, id: hit.id, title: hit.title, label: hit.label, href: hit.href });

/** The written answer for a question and its sources. Never throws: a failure comes back as text: null + reason. */
export async function writeAnswer(question: string, siteLang: Lang, retrieved: Retrieved, options: { short?: boolean; caller: Caller; earlier?: Turn[] }): Promise<Written> {
  const lang = languageOf(question, siteLang);
  const sources = await groundingOf(retrieved).catch(() => [] as Grounding[]);
  if (!sources.length) return { text: null, citations: [], lang, model: null, reason: "no_sources" };
  if (!aiConfigured()) return { text: null, citations: [], lang, model: null, reason: "not_configured" };
  try {
    const out = await tracked(options.short ? "assistant.preview" : "assistant.answer", options.caller, () =>
      generate({
        purpose: options.short ? "assistant.preview" : "assistant.answer",
        system: systemInstruction(lang, !!options.short),
        input: buildPrompt(question, sources, options.earlier),
        // Thinking tokens count against the cap, so it is set well above the answer's own length
        maxOutputTokens: options.short ? 2_000 : 6_000,
        thinking: options.short ? "minimal" : "low",
        budgetMs: options.short ? 25_000 : 45_000,
      }),
    );
    const text = normaliseMarkers(out.text.trim());
    const citations = citedIndexes(text, sources.length).map((n) => citationOf(sources[n - 1]!.hit, n));
    return { text, citations, lang, model: out.model, usage: out.usage };
  } catch (err) {
    return { text: null, citations: [], lang, model: null, reason: err instanceof AiError ? err.code : "unavailable" };
  }
}

/** What the API answers with: the sources as before, plus the written answer. */
export type WrittenAnswer = Answer & Omit<Written, "usage">;

export const withWriting = (answer: Answer, written: Written): WrittenAnswer => {
  const { usage: _usage, ...rest } = written;
  return { ...answer, ...rest };
};
