import type { Tables } from "../../types/database.js";

// Pieces every catalogue route shares: the bilingual shapes the reader site renders, the mapping from database
// rows to those shapes, query helpers the Postgres-side search needs, and labels for provisions.

export type Text = { en: string; bn: string };
export type Lang = "en" | "bn";
export type Block = { kind: "para" | "clause" | "tail"; mark?: string; text: string; notes?: number[] };

export type LawRowDb = Tables<"laws">;
export type LawPartDb = Tables<"law_parts">;
export type LawSectionDb = Tables<"law_sections">;
export type LawOrderDb = Tables<"law_orders">;
export type LawRuleDb = Tables<"law_rules">;
export type JudgmentDb = Tables<"judgments">;
export type JudgmentLawDb = Tables<"judgment_laws">;

/** Both languages of an editorial string; the enacted language stands in where no translation exists. */
export const text = (en: string, bn: string | null | undefined): Text => ({ en, bn: bn ?? en });

/** The database keeps `in_force`; the apps say `in-force`. */
export const statusOut = (s: string) => (s === "repealed" ? "repealed" : "in-force");
export const statusIn = (s: string) => (s === "repealed" ? "repealed" : "in_force");

export type LawType = "constitution" | "act" | "ordinance" | "po";
export type LawStatus = "in-force" | "repealed";

/** A law as the catalogue lists it: the reader's LawRecord, with both languages. */
export interface LawRecord {
  slug: string;
  bdlawsId: number | null;
  title: Text;
  description: Text;
  actNo: Text;
  year: number;
  type: LawType;
  status: LawStatus;
  subject: string;
  /** Number of sections (or articles); 0 when the text isn't imported. */
  sections: number;
  unit: "sections" | "articles";
  /** Orders in its First Schedule (the CPC); absent otherwise. */
  orders?: number;
  /** Enacted in Bangla: its text is the Bangla as published. */
  language?: "bn";
  /** Hand-written on the reader site: featured, with Bangla titles. */
  curated: boolean;
  views: number;
  published: boolean;
  longTitle: string;
  preamble: string;
  date: string;
  updatedAt: string;
}

export function lawRecordOf(l: LawRowDb, orders?: number): LawRecord {
  return {
    slug: l.slug,
    bdlawsId: l.bdlaws_id,
    title: text(l.title, l.title_bn),
    description: text(l.description, l.description_bn),
    actNo: text(l.act_no, l.act_no_bn),
    year: l.year,
    type: l.type as LawType,
    status: statusOut(l.status),
    subject: l.subject,
    sections: l.section_count,
    unit: l.unit as "sections" | "articles",
    ...(orders ? { orders } : {}),
    ...(l.language === "bn" ? { language: "bn" as const } : {}),
    curated: l.curated,
    views: Number(l.views),
    published: l.published,
    longTitle: l.long_title,
    preamble: l.preamble,
    date: l.enacted_on,
    updatedAt: l.updated_at,
  };
}

export const blocksOf = (value: unknown): Block[] => (Array.isArray(value) ? (value as Block[]) : []);
export const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

/** A section's translation as stored: { t?, b?, f? } — heading, one string per block, one per footnote. */
export interface StoredTranslation {
  t?: string;
  b?: string[];
  f?: string[];
  explanation?: string;
}
export const translationOf = (value: unknown): StoredTranslation | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as StoredTranslation) : null;

/* ----------------------------------------------------------------- search */

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
/** Bangla numerals become ASCII so "ধারা ১৫১" and "section 151" meet. */
export const latinDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

/** Lower-case, ASCII digits, collapsed spaces. */
export const normalize = (s: string) => latinDigits(s).toLowerCase().replace(/\s+/g, " ").trim();

const SECTION = /(?:section|sec\.?|s\.|ধারা|article|art\.|অনুচ্ছেদ)\s*(\d+[a-z]?)/i;
const ORDER_RULE = /(?:order|o\.|আদেশ)\s*([ivxl]+a?|\d+a?)\s*,?\s*(?:rule|r\.|বিধি)\s*(\d+[a-z]?)/i;
const ORDER = /(?:order|o\.|আদেশ)\s*([ivxl]+a?|\d+a?)\b/i;
const BARE_NUMBER = /^\d+[a-z]?$/i;

export interface NamedProvisions {
  /** "151", "39.1" (order.rule), "39" — lower-case, as hits list their numbers. */
  numbers: string[];
  /** The query with the provision phrases taken out: what's left to match as words. */
  words: string[];
}

/** Which provisions a query names ("section 151", "o.39 r.1", a bare "420") and the words around them. */
export function parseQuery(query: string): NamedProvisions {
  const q = normalize(query);
  const numbers: string[] = [];
  const rule = q.match(ORDER_RULE);
  if (rule) numbers.push(`${rule[1]}.${rule[2]}`.toLowerCase());
  else {
    const order = q.match(ORDER);
    if (order) numbers.push(order[1]!.toLowerCase());
  }
  const section = q.match(SECTION);
  if (section) numbers.push(section[1]!.toLowerCase());
  // A bare number names a provision; it isn't a word to search texts for
  if (BARE_NUMBER.test(q)) return { numbers: [q], words: [] };
  const words = q
    .replace(ORDER_RULE, " ")
    .replace(ORDER, " ")
    .replace(SECTION, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  return { numbers, words };
}

/** Words → a tsquery for the 'simple' configuration: every word must appear, longer ones as prefixes. */
export function toTsQuery(words: string[]) {
  const terms = words
    .map((w) => w.replace(/[^\p{L}\p{M}\p{N}]/gu, ""))
    .filter((w) => w.length > 1)
    .map((w) => (w.length >= 4 ? `${w}:*` : w));
  return terms.length ? terms.join(" & ") : null;
}

/* ----------------------------------------------------------------- labels */

const bnDigits = (s: string) => s.replace(/\d/g, (d) => BN_DIGITS[Number(d)]!);

/** "Section 151" / "ধারা ১৫১", as the reader's dictionary words them. */
export const sectionLabel = (n: string, unit: "sections" | "articles" = "sections"): Text =>
  unit === "articles" ? { en: `Article ${n}`, bn: `অনুচ্ছেদ ${bnDigits(n)}` } : { en: `Section ${n}`, bn: `ধারা ${bnDigits(n)}` };
export const orderLabel = (roman: string, n: string): Text => ({ en: `Order ${roman}`, bn: `আদেশ ${bnDigits(n)}` });
export const ruleLabel = (n: string): Text => ({ en: `Rule ${n}`, bn: `বিধি ${bnDigits(n)}` });
export const courtLabel = (court: string): Text =>
  court === "AD" ? { en: "Appellate Division", bn: "আপিল বিভাগ" } : { en: "High Court Division", bn: "হাইকোর্ট বিভাগ" };

/** The first SNIPPET characters on a word boundary. */
export function clip(value: string, max = 220) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).replace(/\s+\S*$/, "")}…` : flat;
}

export const blockText = (blocks: Block[]) => blocks.map((b) => b.text).join(" ");

/* ------------------------------------------------------------------ pages */

/** PostgREST answers at most 1,000 rows per request; long laws need several. */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const size = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(`Database: ${error.message}`);
    all.push(...(data ?? []));
    if (!data || data.length < size) return all;
  }
}
