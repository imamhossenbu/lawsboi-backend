import { notFound, unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { fetchAll, normalize, statusOut, stringsOf, text, toTsQuery, type JudgmentDb, type Text } from "./shared.js";

// Judgments (SCOB), the provisions they cite, and the judgments citing a law, as the reader's case pages show them.

export type Court = "AD" | "HCD";

/** A provision a judgment relies on. `kind: "law"` cites the law as a whole. */
export interface LawRef {
  law: string;
  lawTitle: Text;
  /** Whether the law's text is imported, so the link can open the section itself. */
  readable: boolean;
  kind: "law" | "section" | "article" | "order" | "rule";
  n: string;
  rule: number | null;
}

export interface CaseSummary {
  slug: string;
  title: string;
  titleTr: string | null;
  citation: string;
  caseNo: string;
  court: Court;
  date: string | null;
  dateKnown: boolean;
  year: number | null;
  judges: string[];
  author: string | null;
  type: string;
  keywords: string[];
  excerpt: string;
  language: "en" | "bn";
  published: boolean;
  laws: LawRef[];
  paragraphs: number;
  updatedAt: string;
}

export interface CaseDetail extends CaseSummary {
  origin: string | null;
  hearing: string | null;
  parties: { appellant: string; respondent: string } | null;
  petition: boolean;
  advocates: { side: string; names: string }[];
  citationsReferred: string[];
  related: CaseSummary[];
  /** The judgment, one string per paragraph, in the language of the report; and its translation when it exists. */
  text: string[];
  textTr: string[] | null;
  source: { volume: string; page: number; url: string } | null;
  prev: string | null;
  next: string | null;
}

/* ------------------------------------------------------------- citations */

type LawHead = { slug: string; title: string; title_bn: string | null; section_count: number };

/** The citations of several judgments, with the cited laws' titles, in one round trip each. */
async function citationsFor(slugs: string[]) {
  const refs = new Map<string, LawRef[]>();
  if (!slugs.length) return refs;
  const links = await fetchAll<{ judgment_slug: string; law_slug: string; kind: string; n: string; rule: number | null; sort_order: number }>((a, b) =>
    db.from("judgment_laws").select("judgment_slug,law_slug,kind,n,rule,sort_order").in("judgment_slug", slugs).order("sort_order").range(a, b),
  );
  const lawSlugs = [...new Set(links.map((l) => l.law_slug))];
  const laws = lawSlugs.length ? unwrap(await db.from("laws").select("slug,title,title_bn,section_count").in("slug", lawSlugs)) : [];
  const byLaw = new Map<string, LawHead>(laws.map((l) => [l.slug, l]));
  for (const l of links) {
    const law = byLaw.get(l.law_slug);
    refs.set(l.judgment_slug, [
      ...(refs.get(l.judgment_slug) ?? []),
      {
        law: l.law_slug,
        lawTitle: law ? text(law.title, law.title_bn) : { en: l.law_slug, bn: l.law_slug },
        readable: !!law && law.section_count > 0,
        kind: l.kind as LawRef["kind"],
        n: l.n,
        rule: l.rule,
      },
    ]);
  }
  return refs;
}

const SUMMARY = "slug,title,title_tr,citation,case_no,court,decided_on,date_known,judges,author,type,keywords,excerpt,language,published,paragraph_count,updated_at";
type SummaryRow = Pick<JudgmentDb, "slug" | "title" | "title_tr" | "citation" | "case_no" | "court" | "decided_on" | "date_known" | "judges" | "author" | "type" | "keywords" | "excerpt" | "language" | "published" | "paragraph_count" | "updated_at">;

function summaryOf(j: SummaryRow, laws: LawRef[]): CaseSummary {
  return {
    slug: j.slug,
    title: j.title,
    titleTr: j.title_tr,
    citation: j.citation,
    caseNo: j.case_no,
    court: j.court as Court,
    date: j.decided_on,
    dateKnown: j.date_known,
    year: j.decided_on ? Number(j.decided_on.slice(0, 4)) : null,
    judges: j.judges,
    author: j.author,
    type: j.type,
    keywords: j.keywords,
    excerpt: j.excerpt ?? "",
    language: j.language,
    published: j.published,
    laws,
    paragraphs: j.paragraph_count,
    updatedAt: j.updated_at,
  };
}

export async function summariesOf(rows: SummaryRow[]) {
  const refs = await citationsFor(rows.map((r) => r.slug));
  return rows.map((r) => summaryOf(r, refs.get(r.slug) ?? []));
}

/* ------------------------------------------------------------------- list */

export interface CaseFilters {
  query?: string;
  field?: "all" | "title" | "citation" | "judge" | "law";
  courts?: string[];
  types?: string[];
  yearFrom?: number;
  yearTo?: number;
  /** A law's slug, or words of its title: judgments citing it. */
  law?: string;
  sort?: "latest" | "oldest" | "az" | "za";
  page: number;
  perPage: number;
  includeDrafts?: boolean;
}

const escapeLike = (s: string) => s.replace(/[%_,()]/g, " ").trim();

/** Slugs of judgments citing a law named by slug or by words of its title; null when nothing matches. */
async function slugsCiting(law: string): Promise<string[]> {
  const q = normalize(law);
  const exact = await db.from("laws").select("slug").eq("slug", q).maybeSingle();
  let lawSlugs = exact.data ? [exact.data.slug] : [];
  if (!lawSlugs.length) {
    const tsq = toTsQuery(q.split(" "));
    const found = tsq ? unwrap(await db.from("laws").select("slug").textSearch("search", tsq, { config: "simple" }).limit(50)) : [];
    lawSlugs = found.map((l) => l.slug);
  }
  if (!lawSlugs.length) return [];
  const links = unwrap(await db.from("judgment_laws").select("judgment_slug").in("law_slug", lawSlugs).limit(1000));
  return [...new Set(links.map((l) => l.judgment_slug))];
}

export async function listCases(f: CaseFilters) {
  let q = db.from("judgments").select(SUMMARY, { count: "exact" });
  if (!f.includeDrafts) q = q.eq("published", true);
  if (f.courts?.length) q = q.in("court", f.courts);
  if (f.types?.length) q = q.in("type", f.types);
  if (f.yearFrom) q = q.gte("decided_on", `${f.yearFrom}-01-01`);
  if (f.yearTo) q = q.lte("decided_on", `${f.yearTo}-12-31`);
  if (f.law?.trim()) {
    const slugs = await slugsCiting(f.law);
    if (!slugs.length) return { cases: [] as CaseSummary[], total: 0, page: f.page, perPage: f.perPage };
    q = q.in("slug", slugs);
  }
  const query = f.query ? normalize(f.query) : "";
  if (query) {
    const like = `%${escapeLike(query)}%`;
    const field = f.field ?? "all";
    if (field === "title") q = q.or(`title.ilike.${like},title_tr.ilike.${like}`);
    else if (field === "citation") q = q.or(`citation.ilike.${like},case_no.ilike.${like}`);
    else if (field === "law") {
      const slugs = await slugsCiting(query);
      q = q.in("slug", slugs.length ? slugs : ["-"]);
    } else {
      // "all" and "judge" go through the index: words, judges and the opening paragraphs. "cpc" is how
      // readers write the Code of Civil Procedure.
      const words = query.split(" ").flatMap((w) => (w === "cpc" ? ["civil", "procedure"] : [w]));
      const tsq = toTsQuery(words);
      q = tsq ? q.textSearch("search", tsq, { config: "simple" }) : q.or(`title.ilike.${like},citation.ilike.${like}`);
    }
  }
  const sort = f.sort ?? "latest";
  if (sort === "latest") q = q.order("decided_on", { ascending: false, nullsFirst: false }).order("slug");
  else if (sort === "oldest") q = q.order("decided_on", { ascending: true }).order("slug");
  else q = q.order("title", { ascending: sort === "az" });
  const from = (f.page - 1) * f.perPage;
  const { data, count, error } = await q.range(from, from + f.perPage - 1);
  if (error) throw new Error(`Database: ${error.message}`);
  return { cases: await summariesOf(data ?? []), total: count ?? 0, page: f.page, perPage: f.perPage };
}

/** Judgments per court, for the court cards. Lower courts and tribunals aren't reported in SCOB. */
export async function courtTotals() {
  const count = (court?: Court) => {
    let q = db.from("judgments").select("slug", { count: "exact", head: true }).eq("published", true);
    if (court) q = q.eq("court", court);
    return q.then((r) => r.count ?? 0);
  };
  const [supreme, ad, hcd] = await Promise.all([count(), count("AD"), count("HCD")]);
  return { supreme, AD: ad, HCD: hcd, district: 0, tribunal: 0 };
}

/** The newest judgments with a known date, for the home page. */
export async function latestCases(limit = 5) {
  const rows = unwrap(await db.from("judgments").select(SUMMARY).eq("published", true).eq("date_known", true).order("decided_on", { ascending: false }).limit(limit));
  return summariesOf(rows);
}

/* ----------------------------------------------------------------- detail */

export async function findJudgment(slug: string, includeDrafts = false) {
  const j = unwrap(await db.from("judgments").select("*").eq("slug", slug).maybeSingle(), "That judgment");
  if (!j.published && !includeDrafts) throw notFound("That judgment");
  return j;
}

export async function getCase(slug: string, includeDrafts = false): Promise<CaseDetail> {
  const j = await findJudgment(slug, includeDrafts);
  const [summary] = await summariesOf([j]);
  const related = j.related_slugs.length ? await summariesOf(unwrap(await db.from("judgments").select(SUMMARY).in("slug", j.related_slugs).eq("published", true))) : [];
  // Neighbours in the list readers browse: newest first
  const [after, before] = await Promise.all([
    j.decided_on ? db.from("judgments").select("slug").eq("published", true).gt("decided_on", j.decided_on).order("decided_on").limit(1).maybeSingle() : null,
    j.decided_on ? db.from("judgments").select("slug").eq("published", true).lt("decided_on", j.decided_on).order("decided_on", { ascending: false }).limit(1).maybeSingle() : null,
  ]);
  return {
    ...summary!,
    origin: j.origin,
    hearing: j.hearing,
    parties: (j.parties as CaseDetail["parties"]) ?? null,
    petition: j.petition,
    advocates: (Array.isArray(j.advocates) ? (j.advocates as CaseDetail["advocates"]) : []),
    citationsReferred: j.citations_referred,
    related,
    text: stringsOf(j.paragraphs),
    textTr: j.paragraphs_tr ? stringsOf(j.paragraphs_tr) : null,
    source: (j.source as CaseDetail["source"]) ?? null,
    prev: after?.data?.slug ?? null,
    next: before?.data?.slug ?? null,
  };
}

/** A judgment that cites a provision of a law, for that law's pages. */
export interface RelatedCase {
  slug: string;
  title: string;
  citation: string;
  court: Court;
  date: string | null;
  dateKnown: boolean;
  /** The provision of this law the judgment cites most (its first citation). */
  provision: { kind: string; n: string; rule: number | null };
  /** Every provision of this law it cites, for matching a section page. */
  refs: { kind: string; n: string; rule: number | null }[];
  summary: string;
  keywords: string[];
}

/** SCOB judgments citing a provision of the law, newest first. */
export async function casesCitingLaw(lawSlug: string): Promise<RelatedCase[]> {
  const links = unwrap(await db.from("judgment_laws").select("judgment_slug,kind,n,rule,sort_order").eq("law_slug", lawSlug).neq("kind", "law").order("sort_order").limit(1000));
  const slugs = [...new Set(links.map((l) => l.judgment_slug))];
  if (!slugs.length) return [];
  const rows = unwrap(await db.from("judgments").select(SUMMARY).in("slug", slugs).eq("published", true).order("decided_on", { ascending: false, nullsFirst: false }));
  return rows.map((j) => {
    const refs = links.filter((l) => l.judgment_slug === j.slug).map((l) => ({ kind: l.kind, n: l.n, rule: l.rule }));
    return {
      slug: j.slug,
      title: j.title,
      citation: j.citation,
      court: j.court as Court,
      date: j.decided_on,
      dateKnown: j.date_known,
      provision: refs[0]!,
      refs,
      summary: j.excerpt ?? "",
      keywords: j.keywords,
    };
  });
}

/** The provisions cited most across every judgment, for the home page when nobody has read anything yet. */
export async function mostCitedSections(limit = 5) {
  const links = await fetchAll<{ law_slug: string; kind: string; n: string }>((a, b) => db.from("judgment_laws").select("law_slug,kind,n").eq("kind", "section").range(a, b));
  const counts = new Map<string, number>();
  for (const l of links) counts.set(`${l.law_slug}\n${l.n}`, (counts.get(`${l.law_slug}\n${l.n}`) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, views]) => {
      const [law, n] = key.split("\n") as [string, string];
      return { law, n, views };
    });
}

export { statusOut };
