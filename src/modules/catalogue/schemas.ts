import { z } from "zod";

// Query shapes for the public catalogue routes. Lists accept the reader's filters as query strings; comma-separated
// values become arrays.

export const LAW_TYPES = ["constitution", "act", "ordinance", "po"] as const;
export const LAW_STATUSES = ["in-force", "repealed"] as const;
export const SUBJECT_KEYS = ["civil-procedure", "criminal", "evidence", "contract", "property", "limitation", "labour", "family", "constitutional", "registration", "cyber", "banking", "general"] as const;
export const COURTS = ["AD", "HCD"] as const;
export const CASE_TYPES = ["civil", "criminal", "writ", "company", "tax", "labour", "family", "others"] as const;

const csv = <T extends string>(allowed: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter((s): s is T => (allowed as readonly string[]).includes(s)) : []));

const year = z.coerce.number().int().min(1700).max(2100).optional();

export const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,120}$/i, "Not a slug.") });
export const provisionParam = slugParam.extend({ n: z.string().regex(/^[0-9]+[a-z]?(?:-\d+)?$/i, "Not a provision number.") });

export const lawsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  field: z.enum(["all", "title", "actNo", "year"]).default("all"),
  types: csv(LAW_TYPES),
  statuses: csv(LAW_STATUSES),
  yearFrom: year,
  yearTo: year,
  subject: z.enum([...SUBJECT_KEYS, "all"]).default("all"),
  letter: z.string().trim().max(2).default("all"),
  sort: z.enum(["popular", "newest", "oldest", "az", "za"]).default("popular"),
  page: z.coerce.number().int().min(1).default(1),
  // "all" (up to 2,000) lets the reader's search page start from the whole catalogue
  perPage: z.union([z.literal("all"), z.coerce.number().int().min(1).max(200)]).default(24),
});

export const casesQuery = z.object({
  q: z.string().trim().max(200).optional(),
  field: z.enum(["all", "title", "citation", "judge", "law"]).default("all"),
  courts: csv(COURTS),
  types: csv(CASE_TYPES),
  yearFrom: year,
  yearTo: year,
  law: z.string().trim().max(200).optional(),
  sort: z.enum(["latest", "oldest", "az", "za"]).default("latest"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(24),
});

export const searchQuery = z.object({
  q: z.string().trim().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

export const readSchema = z.object({
  kind: z.enum(["law", "section", "order", "judgment"]),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,120}$/i),
  n: z.string().max(20).optional(),
});

export const latestQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(5) });
