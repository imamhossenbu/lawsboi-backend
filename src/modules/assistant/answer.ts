import { z } from "zod";
import { aiConfigured, AiError, generate, generateJson, type AiPart, type AiUsage } from "../../lib/ai/gemini.js";
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

/** A follow-up ("and in a dwelling house?") means little on its own words, which often match something unrelated.
 * The model turns it into search terms with the earlier question as context, and those hits come first, taking
 * turns with what the follow-up's own words found. Without a model, the two questions are searched together. */
export async function retrieveForFollowUp(question: string, previous: string, scope: Scope, lang: Lang, caller: Caller): Promise<Retrieved> {
  const own = await retrieveForAnswer(question, scope, lang, caller);
  try {
    const terms = aiConfigured() ? await searchTerms(`Earlier question: ${previous}\nFollow-up question: ${question}`, caller) : `${previous} ${question}`;
    if (!terms) return own;
    const context = await retrieve(terms, scope, { anyWords: !aiConfigured() });
    if (hitCount(context) === 0) return own;
    const [c, o] = [split(context), split(own)];
    const laws = interleave(c.laws, o.laws, 5);
    const cases = interleave(c.cases, o.cases, 3);
    return { answer: { query: question, scope, laws: laws.hits, cases: cases.hits }, refs: [...laws.refs, ...cases.refs] };
  } catch {
    return own;
  }
}

/** Adds what an image's own search terms find, taking turns with the question's sources (image first). */
export async function withImageTerms(found: Retrieved, terms: string | undefined, scope: Scope): Promise<Retrieved> {
  if (!terms) return found;
  try {
    const seen = await retrieve(terms, scope, { anyWords: true });
    if (hitCount(seen) === 0) return found;
    const [s, f] = [split(seen), split(found)];
    const laws = interleave(s.laws, f.laws, 5);
    const cases = interleave(s.cases, f.cases, 3);
    return { answer: { ...found.answer, laws: laws.hits, cases: cases.hits }, refs: [...laws.refs, ...cases.refs] };
  } catch {
    return found;
  }
}

export interface Grounding {
  hit: SourceHit;
  text: string;
}

export function systemInstruction(lang: Lang, short: boolean) {
  const language = lang === "bn" ? "Bangla (Bengali script), in a clear, natural register" : "English";
  return [
    "You are Lawsboi's assistant for the laws and court judgments of Bangladesh. Talk like a helpful, friendly expert, not a form.",
    "Read what the reader actually asked and answer that. Fit the length to the question: a simple or narrow question gets a short, direct answer (one to three sentences); only go into detail when the question needs it.",
    "For anything about the law, use ONLY the numbered sources you are given. Do not use outside knowledge for legal rules, and never invent sections, cases, dates or penalties.",
    "Cite the source behind every legal statement with its number in square brackets using Latin digits, like [1] or [2][3], right after the statement.",
    "If the sources don't answer the question, or only part of it, say so in a sentence and say what they do cover. If the message isn't really a legal question, reply naturally and briefly without forcing the sources in.",
    `Write in ${language}. Keep section numbers, case citations and the names of acts as they appear in the sources.`,
    short
      ? "Keep it to two or three sentences."
      : "Use short paragraphs; a short list with lines starting \"- \" is fine for steps or elements. No headings, no bold, no markdown tables.",
    "Only when the reader seems to face a real legal matter, add one short line that this is legal information, not legal advice. Don't add it to simple or general questions.",
  ].join("\n");
}

/* ------------------------------------------------------------- small talk */

// Greetings, thanks and questions about the assistant itself need a friendly line, not a search of the statute book
const SMALL_TALK =
  /^(?:hi+|hey+|hello+|hola|yo|salam|salaam|assalamu?\s*alaikum|as-?salamu?\s*alaikum|good\s*(?:morning|afternoon|evening|night)|thanks?(?:\s*you)?|thank\s*you(?:\s*so\s*much)?|thx|ty|ok(?:ay)?|cool|nice|great|bye|goodbye|see\s*you|how\s*are\s*you|who\s*are\s*you|what\s*(?:can|do)\s*you\s*do|what\s*is\s*your\s*name|হাই|হ্যালো|হেলো|সালাম|আসসালামু\s*আলাইকুম|আস্সালামু\s*আলাইকুম|ধন্যবাদ|শুভ\s*(?:সকাল|সন্ধ্যা|রাত্রি)|কেমন\s*আছ(?:েন|ো)?|তুমি\s*কে|আপনি\s*কে|বিদায়|ঠিক\s*আছে|আচ্ছা)$/i;

/** A message that is only a greeting, thanks or a question about the assistant ("hi", "thanks!", "কেমন আছেন?"). */
export function isSmallTalk(question: string) {
  const bare = question
    .trim()
    .toLowerCase()
    .replace(/[!?.,।🙂😊👋🙏\s]+$/u, "")
    .replace(/^[!?.,\s]+/, "");
  return bare.length > 0 && bare.length <= 40 && SMALL_TALK.test(bare);
}

// Questions about Lawsboi itself (its plans, prices, paying): answered from the plans, not the statute book
const ABOUT_LAWSBOI =
  /\b(?:price|prices|pricing|plan|plans|subscription|subscribe|premium|cost|costs|fee|fees|pay|payment|bkash|nagad|researcher\s+plan|professional\s+plan|free\s+plan|upgrade|refund)\b|দাম|মূল্য|প্ল্যান|সাবস্ক্রিপশন|খরচ|ফি\b|পেমেন্ট|বিকাশ|নগদ|আপগ্রেড|রিসার্চার|প্রফেশনাল/i;
const LAW_WORDS = /\b(?:section|act|ordinance|order|rule|article|court|judgment|case|law|penal|crpc|cpc|bail|suit|evidence)\b|ধারা|আইন|আদেশ|বিধি|অনুচ্ছেদ|আদালত|রায়|মামলা|জামিন/i;

/** A question about Lawsboi's plans or prices rather than the law ("What plans does Lawsboi offer?"). A question
 * that also names the law ("court fees under the Court-fees Act") stays a legal one. */
export function isAboutLawsboi(question: string) {
  return ABOUT_LAWSBOI.test(question) && (!LAW_WORDS.test(question) || /lawsboi|plan|প্ল্যান/i.test(question));
}

/** The plans as the model is told them: name, price per month and year, and what each includes. */
async function plansNote(lang: Lang) {
  const { listPlans } = await import("../billing/service.js");
  const plans = await listPlans(true).catch(() => []);
  return plans
    .map((p) => {
      const name = p.name[lang] || p.name.en;
      const price = p.price.monthly ? `৳${p.price.monthly} a month${p.price.yearly ? `, or ৳${p.price.yearly} a year` : ""}` : "free";
      return `- ${name}: ${price}. Includes: ${p.features.map((f) => f[lang] || f.en).join("; ")}.`;
    })
    .join("\n");
}

/** What retrieval would answer when nothing is searched (small talk). */
export const emptyRetrieved = (question: string, scope: Scope): Retrieved => ({ answer: { query: question, scope, laws: [], cases: [] }, refs: [] });

const chatInstruction = (lang: Lang) =>
  [
    "You are Lawsboi's friendly assistant. Lawsboi is a research site for the laws, sections and Supreme Court judgments of Bangladesh.",
    "The reader sent a short message rather than a legal question (a greeting, thanks, or asking who you are). Reply naturally and warmly in one or two short sentences, the way a person would, and if it fits, offer to help with a question about Bangladesh law.",
    "If they asked a legal question that you have no sources for, say you couldn't find the matching provision on Lawsboi and suggest naming the Act or section; don't state any legal rule yourself.",
    `Write in ${lang === "bn" ? "Bangla (Bengali script)" : "English"}. No citations, no disclaimers, no lists.`,
  ].join("\n");

/** A short, natural reply with no sources: small talk, a question about Lawsboi's plans, or a question the catalogue
 * had nothing for. */
async function chatReply(question: string, lang: Lang, caller: Caller, earlier: Turn[] = []): Promise<Written> {
  const plans = isAboutLawsboi(question) ? await plansNote(lang) : "";
  const canned =
    lang === "bn"
      ? "হ্যালো! আমি Lawsboi-এর সহকারী। বাংলাদেশের কোনো আইন, ধারা বা রায় নিয়ে প্রশ্ন থাকলে জিজ্ঞাসা করুন।"
      : "Hi! I'm Lawsboi's assistant. Ask me anything about the laws, sections or court judgments of Bangladesh.";
  if (!aiConfigured()) return { text: canned, citations: [], lang, model: null };
  try {
    const chat = earlier.length ? `Earlier in this conversation:\n${earlier.map((t) => `Q: ${t.question}\nA: ${(t.answer ?? "").slice(0, 600)}`).join("\n\n")}\n\n` : "";
    const out = await tracked("assistant.chat", caller, () =>
      generate({
        purpose: "assistant.chat",
        system: plans
          ? `${chatInstruction(lang)}\nThe reader is asking about Lawsboi's plans. Answer from these plans only (prices in Bangladeshi taka), briefly and plainly; mention the pricing page for details. Don't mention how many AI questions a plan allows.\nPlans:\n${plans}`
          : chatInstruction(lang),
        input: `${chat}Message: ${question}`,
        maxOutputTokens: 800,
        thinking: "minimal",
        budgetMs: 15_000,
      }),
    );
    return { text: out.text.trim() || canned, citations: [], lang, model: out.model, usage: out.usage };
  } catch {
    return { text: canned, citations: [], lang, model: null };
  }
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

/** Markers become plain [n] with Latin digits, so the reader site can link every one the same way: Bangla digits,
 * and lists like [1, 3] or [১, ৩], are written as [1][3]. */
export const normaliseMarkers = (text: string) =>
  text.replace(/\[((?:[0-9০-৯]{1,2})(?:\s*[,،]\s*[0-9০-৯]{1,2})+|[০-৯]{1,2})\]/g, (_, list: string) =>
    list
      .split(/\s*[,،]\s*/)
      .map((d) => `[${latinDigits(d)}]`)
      .join(""),
  );

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
export async function writeAnswer(
  question: string,
  siteLang: Lang,
  retrieved: Retrieved,
  options: { short?: boolean; caller: Caller; earlier?: Turn[]; images?: AiPart[]; pinned?: string },
): Promise<Written> {
  const lang = languageOf(question, siteLang);
  // Small talk, or nothing in the catalogue for it: a short natural reply instead of an empty answer
  if (!retrieved.refs.length) return chatReply(question, lang, options.caller, options.earlier);
  const sources = await groundingOf(retrieved).catch(() => [] as Grounding[]);
  if (!sources.length) return chatReply(question, lang, options.caller, options.earlier);
  if (!aiConfigured()) return { text: null, citations: [], lang, model: null, reason: "not_configured" };
  try {
    const out = await tracked(options.short ? "assistant.preview" : "assistant.answer", options.caller, () =>
      generate({
        purpose: options.short ? "assistant.preview" : "assistant.answer",
        system: systemInstruction(lang, !!options.short),
        input: options.images?.length
          ? [{ type: "text", text: `${buildPrompt(question, sources, options.earlier)}\n\n${IMAGE_NOTE}${pinnedNote(options.pinned)}` }, ...options.images]
          : `${buildPrompt(question, sources, options.earlier)}${pinnedNote(options.pinned)}`,
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

const IMAGE_NOTE =
  "The reader attached the image(s) below (a document, notice, photo or screenshot). Read them and use what they show to understand the question; you may describe or quote them, but every statement about the law must still cite the numbered sources.";
const pinnedNote = (pinned?: string) => (pinned ? `\n\nThe reader asked this while reading source [1] (${pinned}); answer with that source in mind first.` : "");

const imageReadSchema = z.object({ gist: z.string().max(1500), terms: z.string().max(300) });

/** What the reader's images show, in a few lines, and English search terms for the legal points they raise, so the
 * search can find the provisions an image is about even when the question is only "what does this mean?". */
export async function readImages(images: AiPart[], question: string, caller: Caller) {
  if (!aiConfigured() || !images.length) return null;
  try {
    const out = await tracked("assistant.image", caller, () =>
      generateJson(
        {
          purpose: "assistant.image",
          system:
            "The reader of a Bangladeshi law library attached image(s) to a question. Return `gist`: two to five plain sentences on what the image shows and any legal points it raises (quote key lines, names of acts, section numbers). Return `terms`: 4 to 12 English full-text search words for those legal points (no numbers).",
          input: [{ type: "text", text: `Question: ${question}` }, ...images],
          maxOutputTokens: 2_000,
          thinking: "minimal",
          budgetMs: 20_000,
        },
        imageReadSchema,
      ),
    );
    return { gist: out.value.gist, terms: out.value.terms.replace(/[\d০-৯]+/g, " ").replace(/\s+/g, " ").trim() };
  } catch {
    return null;
  }
}

/** What the API answers with: the sources as before, plus the written answer. */
export type WrittenAnswer = Answer & Omit<Written, "usage">;

export const withWriting = (answer: Answer, written: Written): WrittenAnswer => {
  const { usage: _usage, ...rest } = written;
  return { ...answer, ...rest };
};
