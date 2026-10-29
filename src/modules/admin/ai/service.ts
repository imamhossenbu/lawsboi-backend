import { generateJson, type AiPart, type AiResult } from "../../../lib/ai/gemini.js";
import { tracked, type Caller } from "../../../lib/ai/usage.js";
import { badRequest, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import type { PageSection } from "../../content/shared.js";
import * as prompts from "./prompts.js";
import {
  announcementReply,
  articleReply,
  caseReadReply,
  type CaseRead,
  lawReadReply,
  sectionsReply,
  stringsReply,
  type DraftMode,
  type LawRead,
  type Text,
} from "./schemas.js";

// The panel's AI help. Small jobs (one field) and whole drafts share three moves: translate the empty side of
// every two-language text, tidy every text, or write from a brief. Nothing here saves anything: the panel shows
// the result beside the form and the editor decides what goes in.

type Lang = prompts.Lang;
const other = (l: Lang): Lang => (l === "en" ? "bn" : "en");

/* ------------------------------------------------------------ batches */

// Long lists go to the model in pieces, so one reply never runs out of tokens and a slow piece can't sink the rest
const CHUNK_ITEMS = 40;
const CHUNK_CHARS = 12_000;

export function chunk(texts: string[]) {
  const out: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const t of texts) {
    if (current.length && (current.length >= CHUNK_ITEMS || size + t.length > CHUNK_CHARS)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(t);
    size += t.length;
  }
  if (current.length) out.push(current);
  return out;
}

/** Runs one list job and holds the model to "as many items back as went in". */
async function listJob(purpose: string, caller: Caller, system: string, items: string[]): Promise<string[]> {
  const out = await tracked(purpose, caller, () =>
    generateJson(
      {
        purpose,
        system: `${system}\nYou receive a JSON array of ${items.length} strings and return { "items": [...] } with exactly ${items.length} strings, item i answering input i.`,
        input: JSON.stringify(items),
        maxOutputTokens: 16_000,
        thinking: "minimal",
      },
      stringsReply,
    ),
  );
  if (out.value.items.length !== items.length) throw badRequest("The AI returned a different number of items; try again.", { ai: "invalid" });
  return out.value.items;
}

async function mapChunks(texts: string[], run: (part: string[]) => Promise<string[]>) {
  // Blank items aren't sent; they come back blank
  const wanted = texts.map((t, i) => ({ t, i })).filter((x) => x.t.trim());
  const results = new Array<string>(texts.length).fill("");
  const pieces = chunk(wanted.map((x) => x.t));
  let at = 0;
  const offsets = pieces.map((p) => {
    const start = at;
    at += p.length;
    return start;
  });
  const answers = await Promise.all(pieces.map((p) => run(p)));
  answers.forEach((ans, k) => ans.forEach((a, j) => (results[wanted[offsets[k]! + j]!.i] = a)));
  return results;
}

export const translateMany = (texts: string[], from: Lang, to: Lang, kind: "legal" | "content" | "ui", caller: Caller) =>
  mapChunks(texts, (part) => listJob("admin.translate", caller, prompts.translateInstruction(from, to, kind), part));

export const tidyMany = (texts: string[], lang: Lang, caller: Caller) => mapChunks(texts, (part) => listJob("admin.tidy", caller, prompts.tidyInstruction(lang), part));

/* -------------------------------------------------- two-language texts */

const isText = (v: unknown): v is Text => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 2 && typeof (v as Text).en === "string" && typeof (v as Text).bn === "string";

/** Every two-language text in a value, in document order. */
export function textsIn(value: unknown, into: Text[] = []): Text[] {
  if (isText(value)) into.push(value);
  else if (Array.isArray(value)) value.forEach((v) => textsIn(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => textsIn(v, into));
  return into;
}

/** A copy of `value` with each two-language text replaced, in the same order textsIn found them. */
export function replaceTexts<T>(value: T, next: Text[]): T {
  let i = 0;
  const walk = (v: unknown): unknown => {
    if (isText(v)) return next[i++];
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Fills the empty side of every text that has one side written. */
export async function fillGaps<T>(value: T, caller: Caller): Promise<T> {
  const texts = textsIn(value);
  const toBn = texts.map((t) => (t.en.trim() && !t.bn.trim() ? t.en : ""));
  const toEn = texts.map((t) => (t.bn.trim() && !t.en.trim() ? t.bn : ""));
  if (!toBn.some(Boolean) && !toEn.some(Boolean)) throw badRequest("Every text already has both languages.", { ai: "empty" });
  const [bn, en] = await Promise.all([translateMany(toBn, "en", "bn", "content", caller), translateMany(toEn, "bn", "en", "content", caller)]);
  return replaceTexts(value, texts.map((t, i) => ({ en: t.en.trim() ? t.en : en[i]!, bn: t.bn.trim() ? t.bn : bn[i]! })));
}

/** Tidies both sides of every text. */
export async function polishAll<T>(value: T, caller: Caller): Promise<T> {
  const texts = textsIn(value);
  if (!texts.some((t) => t.en.trim() || t.bn.trim())) throw badRequest("There's no text to tidy yet.", { ai: "empty" });
  const [en, bn] = await Promise.all([tidyMany(texts.map((t) => t.en), "en", caller), tidyMany(texts.map((t) => t.bn), "bn", caller)]);
  return replaceTexts(value, texts.map((_, i) => ({ en: en[i]!, bn: bn[i]! })));
}

/* -------------------------------------------------------------- one field */

export async function assist(task: "toBn" | "toEn" | "polish", text: Text, caller: Caller): Promise<Text> {
  if (task === "polish") return polishAll(text, caller);
  const from: Lang = task === "toBn" ? "en" : "bn";
  if (!text[from].trim()) throw badRequest("Write it in the other language first.", { ai: "empty" });
  const [done] = await translateMany([text[from]], from, other(from), "content", caller);
  return { ...text, [other(from)]: done! };
}

export async function tidy(text: string, lang: Lang, caller: Caller) {
  const [done] = await tidyMany([text], lang, caller);
  return done!;
}

/* ----------------------------------------------------------------- drafts */

const TRY_PAGES = ["/dashboard/laws", "/dashboard/acts", "/dashboard/cases", "/dashboard/assistant", "/dashboard/library", "/dashboard/history", "/dashboard/plan", "/dashboard/settings", "/dashboard/settings/password"];
const ICONS = ["search", "sparkles", "bookmark", "card", "crown", "download", "key", "file"];

export interface ArticleDraft {
  title: Text;
  summary: Text;
  steps: Text[];
  tryHref?: string;
  icon?: string;
}

function draftJob<T>(purpose: string, caller: Caller, system: string, input: string, schema: Parameters<typeof generateJson<T>>[1]) {
  return tracked(purpose, caller, () => generateJson({ purpose, system, input, maxOutputTokens: 12_000, thinking: "low" }, schema));
}

const needBrief = (brief: string) => {
  if (!brief.trim()) throw badRequest("Write a brief first: what should it say?", { ai: "empty" });
};

export async function draftArticle(mode: DraftMode, brief: string, current: ArticleDraft | undefined, caller: Caller): Promise<ArticleDraft> {
  const blank: ArticleDraft = { title: { en: "", bn: "" }, summary: { en: "", bn: "" }, steps: [] };
  const base = current ?? blank;
  if (mode === "translate") return fillGaps(base, caller);
  if (mode === "polish") return polishAll(base, caller);
  needBrief(brief);
  const input =
    mode === "add"
      ? `Brief for the steps to add:\n${brief}\n\nThe article so far (keep it; reply with the whole article including the new steps):\n${JSON.stringify(base)}`
      : `Brief:\n${brief}${current ? `\n\nThe current draft, to improve on:\n${JSON.stringify(current)}` : ""}`;
  const out = await draftJob("admin.draft.article", caller, prompts.articleInstruction(), input, articleReply);
  const v = out.value;
  return {
    title: v.title,
    summary: v.summary,
    steps: v.steps,
    tryHref: TRY_PAGES.includes(v.tryHref) ? v.tryHref : (current?.tryHref ?? "/dashboard/laws"),
    icon: ICONS.includes(v.icon) ? v.icon : (current?.icon ?? "file"),
  };
}

/** A fixed page (the about page) keeps exactly its sections: rewritten text goes back into them by id. */
export function keepFixedSections(current: PageSection[], written: PageSection[]): PageSection[] {
  const byId = new Map(written.map((s) => [s.id, s]));
  return current.map((s) => {
    const w = byId.get(s.id);
    if (!w) return s;
    // Only the fields the band already has
    return Object.fromEntries(Object.keys(s).map((k) => [k, k === "id" ? s.id : ((w as Record<string, unknown>)[k] ?? (s as Record<string, unknown>)[k])])) as PageSection;
  });
}

const uniqueId = (id: string, taken: Set<string>) => {
  let out = id || "section";
  for (let n = 2; taken.has(out); n++) out = `${id}-${n}`;
  return out;
};

export async function draftPage(slug: "privacy" | "disclaimer" | "about", mode: DraftMode, brief: string, sections: PageSection[], caller: Caller): Promise<PageSection[]> {
  const fixed = slug === "about";
  if (mode === "translate") return fillGaps(sections, caller);
  if (mode === "polish") return polishAll(sections, caller);
  needBrief(brief);
  if (mode === "add") {
    if (fixed) throw badRequest("The about page's bands are fixed by its layout.", { ai: "fixed" });
    const out = await draftJob("admin.draft.page", caller, prompts.pageInstruction(slug), `Write ONE new section for this brief:\n${brief}\n\nThe page's current section titles, so it doesn't repeat them: ${sections.map((s) => s.title.en).join(" | ")}`, sectionsReply);
    const added = out.value.sections[0];
    if (!added) throw badRequest("The AI didn't write a section; try a fuller brief.", { ai: "invalid" });
    return [...sections, { ...added, id: uniqueId(added.id, new Set(sections.map((s) => s.id))) }];
  }
  const input = `Brief:\n${brief}\n\nThe page now (${fixed ? "rewrite each of these sections, keeping every id and field" : "rewrite or replace these sections"}):\n${JSON.stringify(sections)}`;
  const out = await draftJob("admin.draft.page", caller, prompts.pageInstruction(slug), input, sectionsReply);
  if (fixed) return keepFixedSections(sections, out.value.sections);
  const taken = new Set<string>();
  return out.value.sections.map((s) => {
    const id = uniqueId(s.id, taken);
    taken.add(id);
    return { ...s, id };
  });
}

export interface AnnouncementDraft {
  title: Text;
  body: Text;
}

export async function draftAnnouncement(mode: DraftMode, brief: string, topic: string, current: AnnouncementDraft | undefined, caller: Caller): Promise<AnnouncementDraft> {
  const base = current ?? { title: { en: "", bn: "" }, body: { en: "", bn: "" } };
  if (mode === "translate") return fillGaps(base, caller);
  if (mode === "polish") return polishAll(base, caller);
  needBrief(brief);
  const out = await draftJob("admin.draft.announcement", caller, prompts.announcementInstruction(topic), `Brief:\n${brief}`, announcementReply);
  return out.value;
}

/* -------------------------------------------------------------------- laws */

export interface Upload {
  mimetype: string;
  buffer: Buffer;
}

/** Reads a law from photos or a PDF into the shape the import page checks section by section. */
export async function readLaw(files: Upload[], caller: Caller, options: { language?: Lang; onlyStatute?: boolean } = {}) {
  const parts: AiPart[] = [
    ...files.map((f): AiPart => ({ type: f.mimetype === "application/pdf" ? "document" : "image", data: f.buffer.toString("base64"), mimeType: f.mimetype })),
    { type: "text", text: `Read these ${files.length} file(s) in order as consecutive pages of one law.` },
  ];
  const out: AiResult & { value: LawRead } = await tracked("admin.laws.read", caller, () =>
    generateJson({ purpose: "admin.laws.read", system: prompts.lawReadInstruction(options), input: parts, maxOutputTokens: 32_000, thinking: "low" }, lawReadReply),
  );
  const { law, parts: read } = out.value;
  if (!read.some((p) => p.sections.length)) throw badRequest("No sections could be read from these pages. Check they're a law and clearly photographed.", { ai: "unreadable" });
  return {
    law,
    act: {
      longTitle: law.longTitle,
      preamble: law.preamble,
      date: law.date,
      parts: read.map((p, i) => ({
        id: `p${i + 1}`,
        title: p.title,
        range: p.sections.length ? `${p.sections[0]!.n}–${p.sections.at(-1)!.n}` : "",
        sections: p.sections.map((s) => ({
          n: s.n,
          title: s.title,
          body: s.blocks.map((b) => (b.kind === "tail" ? { kind: b.kind, text: b.text } : { kind: b.kind, ...(b.mark ? { mark: b.mark } : {}), text: b.text })),
          unsure: s.unsure,
          page: s.page,
        })),
      })),
    },
    model: out.model,
  };
}

/** A section's translation into the other language, ready for PUT /admin/catalogue/laws/:slug/sections/:n/translation. */
export async function translateSection(slug: string, n: string, to: Lang | undefined, caller: Caller) {
  const law = unwrap(await db.from("laws").select("language").eq("slug", slug).maybeSingle(), "That law");
  const section = unwrap(await db.from("law_sections").select("title,body,notes").eq("law_slug", slug).eq("n", n).maybeSingle(), "That section");
  const from = law.language as Lang;
  const target = to ?? other(from);
  if (target === from) throw badRequest("The section is already in that language.", { to: "same" });
  const blocks = Array.isArray(section.body) ? (section.body as { text?: string }[]).map((b) => b.text ?? "") : [];
  const notes = Array.isArray(section.notes) ? (section.notes as unknown[]).map((x) => String(x)) : [];
  const done = await translateMany([section.title, ...blocks, ...notes], from, target, "legal", caller);
  return { title: done[0]!, b: done.slice(1, 1 + blocks.length), f: done.slice(1 + blocks.length), from, to: target };
}

/** Finds the catalogue's law for an act's name as a judgment writes it ("Code of Civil Procedure, 1908", "CrPC"). */
async function lawSlugFor(act: string): Promise<string | null> {
  const known: Record<string, string> = { cpc: "cpc-1908", crpc: "crpc-1898", "penal code": "penal-code-1860", constitution: "constitution-1972", "evidence act": "evidence-act-1872" };
  const key = act.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  for (const [name, slug] of Object.entries(known)) if (key === name || key.startsWith(`${name} `) || key.includes(`the ${name}`)) return slug;
  const year = key.match(/\b(1[89]\d\d|20\d\d)\b/)?.[1];
  const words = key.replace(/\b(the|of|and|act|ordinance|\d+)\b/g, " ").trim().split(" ").filter((w) => w.length > 2);
  if (!words.length) return null;
  let q = db.from("laws").select("slug,title").ilike("title", `%${words.join("%")}%`).limit(5);
  if (year) q = q.eq("year", Number(year));
  const { data } = await q;
  return data?.[0]?.slug ?? null;
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
export const fromRoman = (r: string) => {
  let total = 0;
  const s = r.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]!] ?? 0;
    const next = ROMAN[s[i + 1] ?? ""] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
};

/** A provision as the catalogue stores citations: an Order's rule is kind "order" with the Order's number and
 * `rule` ("XXXIX rule 1" → n "39", rule 1); other numbers are kept as written. */
export function provisionRef(kind: "section" | "article" | "order" | "rule", n: string): { kind: "section" | "article" | "order" | "rule"; n: string; rule: number | null } {
  const m = n.trim().match(/^(?:o(?:rder)?\.?\s*)?([ivxlc]+|\d+)\s*(?:,\s*)?(?:r(?:ule)?\.?\s*(\d+))?$/i);
  if ((kind === "order" || kind === "rule") && m) {
    const order = /^\d+$/.test(m[1]!) ? m[1]! : String(fromRoman(m[1]!));
    return { kind: "order", n: order, rule: m[2] ? Number(m[2]) : null };
  }
  return { kind, n: n.trim(), rule: null };
}

/** Reads a judgment PDF into the "Add judgment" form's fields; laws are matched to the catalogue where possible
 * (`law: null` when no law matched, for the editor to pick). */
export async function readCase(file: Upload, caller: Caller) {
  const out: AiResult & { value: CaseRead } = await tracked("admin.cases.read", caller, () =>
    generateJson(
      {
        purpose: "admin.cases.read",
        system: prompts.caseReadInstruction(),
        input: [{ type: "document", data: file.buffer.toString("base64"), mimeType: file.mimetype }, { type: "text", text: "Read this judgment." }],
        maxOutputTokens: 32_000,
        thinking: "low",
      },
      caseReadReply,
    ),
  );
  const v = out.value;
  if (!v.paragraphs.length && !v.citation) throw badRequest("No judgment could be read from this file.", { ai: "unreadable" });
  const laws = await Promise.all(v.laws.map(async (l) => ({ act: l.act, law: await lawSlugFor(l.act), ...provisionRef(l.kind, l.n) })));
  return {
    case: {
      title: v.title,
      citation: v.citation,
      caseNo: v.caseNo,
      court: v.court,
      date: /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null,
      dateKnown: /^\d{4}-\d{2}-\d{2}$/.test(v.date),
      judges: v.judges,
      author: v.author || null,
      type: v.type,
      keywords: v.keywords,
      parties: v.parties.appellant || v.parties.respondent ? v.parties : null,
      advocates: v.advocates,
      excerpt: v.excerpt,
      citationsReferred: v.citationsReferred,
      language: v.language,
      paragraphs: v.paragraphs,
    },
    laws,
    model: out.model,
  };
}
