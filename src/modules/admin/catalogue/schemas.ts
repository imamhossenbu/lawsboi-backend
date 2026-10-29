import { z } from "zod";
import { CASE_TYPES, COURTS, LAW_STATUSES, LAW_TYPES, SUBJECT_KEYS } from "../../catalogue/schemas.js";

// Bodies the admin panel sends when the content team adds or edits laws and judgments.

export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,120}$/, "Lower-case letters, digits and dashes.");
export const lang = z.enum(["en", "bn"]);

export const block = z.object({
  kind: z.enum(["para", "clause", "tail"]),
  mark: z.string().max(40).optional(),
  text: z.string().max(20_000),
  notes: z.array(z.number().int().min(1)).optional(),
});

export const sectionInput = z.object({
  n: z.string().trim().min(1).max(20),
  title: z.string().trim().max(500).default(""),
  body: z.array(block).default([]),
  notes: z.array(z.string().max(5000)).default([]),
});

export const partInput = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().max(300).default(""),
  titleTr: z.string().trim().max(300).optional(),
  range: z.string().trim().max(40).default(""),
  banner: z.string().trim().max(300).optional(),
  sub: z.string().trim().max(300).optional(),
  sections: z.array(sectionInput).default([]),
});

export const lawInfo = z.object({
  title: z.string().trim().min(1).max(300),
  titleBn: z.string().trim().max(300).nullable().optional(),
  actNo: z.string().trim().max(120).default(""),
  actNoBn: z.string().trim().max(120).nullable().optional(),
  year: z.number().int().min(1700).max(2100),
  type: z.enum(LAW_TYPES),
  status: z.enum(LAW_STATUSES).default("in-force"),
  subject: z.enum(SUBJECT_KEYS).default("general"),
  description: z.string().trim().max(2000).default(""),
  descriptionBn: z.string().trim().max(2000).nullable().optional(),
  language: lang.default("en"),
  unit: z.enum(["sections", "articles"]).default("sections"),
  longTitle: z.string().trim().max(5000).default(""),
  preamble: z.string().trim().max(20_000).default(""),
  date: z.string().trim().max(80).default(""),
  bdlawsId: z.number().int().positive().nullable().optional(),
});

export const createLaw = lawInfo.extend({
  slug: slug.optional(),
  parts: z.array(partInput).default([]),
  /** Section number → its translation. */
  translations: z.record(z.string(), z.object({ title: z.string().max(500), b: z.array(z.string().max(20_000)), f: z.array(z.string().max(5000)).optional() })).default({}),
  published: z.boolean().default(false),
});

export const patchLaw = lawInfo.partial();

export const sectionPatch = z.object({
  title: z.string().trim().max(500),
  body: z.array(block),
  notes: z.array(z.string().max(5000)).optional(),
});

export const translationPut = z.object({
  title: z.string().trim().max(500),
  b: z.array(z.string().max(20_000)),
  f: z.array(z.string().max(5000)).optional(),
});

export const lawRef = z.object({
  law: slug,
  kind: z.enum(["law", "section", "article", "order", "rule"]).default("section"),
  n: z.string().trim().max(20).default(""),
  rule: z.number().int().positive().nullable().optional(),
});

export const caseInfo = z.object({
  title: z.string().trim().min(1).max(500),
  titleTr: z.string().trim().max(500).nullable().optional(),
  citation: z.string().trim().min(1).max(120),
  caseNo: z.string().trim().max(200).default(""),
  origin: z.string().trim().max(2000).nullable().optional(),
  court: z.enum(COURTS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").nullable().optional(),
  dateKnown: z.boolean().default(true),
  hearing: z.string().trim().max(80).nullable().optional(),
  judges: z.array(z.string().trim().max(200)).default([]),
  author: z.string().trim().max(200).nullable().optional(),
  type: z.enum(CASE_TYPES).default("others"),
  keywords: z.array(z.string().trim().max(120)).default([]),
  parties: z.object({ appellant: z.string().max(500), respondent: z.string().max(500) }).nullable().optional(),
  petition: z.boolean().default(false),
  advocates: z.array(z.object({ side: z.string().max(120), names: z.string().max(2000) })).default([]),
  excerpt: z.string().trim().max(5000).default(""),
  citationsReferred: z.array(z.string().trim().max(200)).default([]),
  related: z.array(slug).default([]),
  source: z.object({ volume: z.string().max(40), page: z.number().int(), url: z.string().max(500) }).nullable().optional(),
  language: lang.default("en"),
});

export const createCase = caseInfo.extend({
  slug: slug.optional(),
  paragraphs: z.array(z.string().max(50_000)).default([]),
  paragraphsTr: z.array(z.string().max(50_000)).nullable().optional(),
  laws: z.array(lawRef).default([]),
  published: z.boolean().default(false),
});

export const patchCase = caseInfo.partial().extend({
  paragraphs: z.array(z.string().max(50_000)).optional(),
  paragraphsTr: z.array(z.string().max(50_000)).nullable().optional(),
});

export const linksPut = z.object({ links: z.array(lawRef).max(200) });

export const adminLawsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["all", "published", "draft"]).default("all"),
  type: z.enum(LAW_TYPES).optional(),
  subject: z.enum(SUBJECT_KEYS).optional(),
  language: lang.optional(),
  // Share of sections translated: none, some, all
  translation: z.enum(["none", "partial", "full"]).optional(),
  sort: z.enum(["updated", "az", "newest", "popular"]).default("updated"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(25),
});

export const adminCasesQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["all", "published", "draft"]).default("all"),
  court: z.enum(COURTS).optional(),
  type: z.enum(CASE_TYPES).optional(),
  sort: z.enum(["updated", "latest", "oldest", "az"]).default("updated"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(25),
});

/** "The Evidence Act, 1872" → "evidence-act-1872". */
export function slugify(title: string, year: number) {
  const base = title
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/,?\s*\d{4}\s*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "law"}-${year}`;
}
