import { db } from "../../lib/supabase.js";

// Related cases the team writes in by hand: per section of a law (law_section_related_cases), and on a judgment
// (judgments.related_manual, judgments.laws_manual). An entry is a judgment picked from the catalogue or a case
// typed in by name and number, with an optional link.
//
// Reads are forgiving: until the migration that adds these is applied, they answer empty instead of failing the
// page they sit on.

export interface RelatedEntry {
  /** The judgment on Lawsboi, when one was picked (and is published, for readers). */
  slug: string | null;
  title: string;
  citation: string;
  url: string | null;
  court: "AD" | "HCD" | null;
  date: string | null;
}

export interface ManualLaw {
  title: string;
  url: string | null;
}

export interface RelatedInput {
  case?: string | null;
  title: string;
  citation?: string;
  url?: string | null;
}

type Row = { n: string; case_slug: string | null; title: string; citation: string; url: string | null };

/** Fills in picked judgments from the catalogue (their current title, citation, court and date). A picked judgment
 * that is a draft (and drafts aren't wanted) keeps its written title but loses its link. */
async function entriesOf(rows: Row[], includeDrafts: boolean): Promise<(RelatedEntry & { n: string })[]> {
  const slugs = [...new Set(rows.map((r) => r.case_slug).filter((s): s is string => !!s))];
  const { data: found } = slugs.length
    ? await db.from("judgments").select("slug,title,citation,court,decided_on,date_known,published").in("slug", slugs)
    : { data: [] };
  const bySlug = new Map((found ?? []).filter((j) => includeDrafts || j.published).map((j) => [j.slug, j]));
  return rows.map((r) => {
    const j = r.case_slug ? bySlug.get(r.case_slug) : undefined;
    return {
      n: r.n,
      slug: j ? j.slug : null,
      title: j?.title ?? r.title,
      citation: j?.citation ?? r.citation,
      url: r.url || null,
      court: j ? (j.court as "AD" | "HCD") : null,
      date: j && j.date_known ? j.decided_on : null,
    };
  });
}

/** The cases written in for one section. */
export async function sectionRelatedCases(lawSlug: string, n: string, includeDrafts = false): Promise<RelatedEntry[]> {
  const { data, error } = await db.from("law_section_related_cases").select("n,case_slug,title,citation,url").eq("law_slug", lawSlug).eq("n", n).order("sort_order");
  if (error || !data) return [];
  return (await entriesOf(data, includeDrafts)).map(({ n: _, ...e }) => e);
}

/** Every section's written-in cases, by section number (the admin's law page). */
export async function lawRelatedCases(lawSlug: string): Promise<Record<string, RelatedEntry[]>> {
  const { data, error } = await db.from("law_section_related_cases").select("n,case_slug,title,citation,url").eq("law_slug", lawSlug).order("sort_order");
  if (error || !data) return {};
  const out: Record<string, RelatedEntry[]> = {};
  for (const { n, ...e } of await entriesOf(data, true)) (out[n] ??= []).push(e);
  return out;
}

/** Replaces a section's written-in cases. */
export async function replaceSectionRelated(lawSlug: string, n: string, cases: RelatedInput[]) {
  const { error: del } = await db.from("law_section_related_cases").delete().eq("law_slug", lawSlug).eq("n", n);
  if (del) throw new Error(`law_section_related_cases: ${del.message}`);
  if (!cases.length) return;
  const { error } = await db.from("law_section_related_cases").insert(
    cases.map((c, i) => ({ law_slug: lawSlug, n, case_slug: c.case ?? null, title: c.title, citation: c.citation ?? "", url: c.url || null, sort_order: i })),
  );
  if (error) throw new Error(`law_section_related_cases: ${error.message}`);
}

/** A judgment's written-in lists, read from its row (empty when the columns aren't there yet). */
export function manualListsOf(row: { related_manual?: unknown; laws_manual?: unknown }) {
  const cases = Array.isArray(row.related_manual) ? (row.related_manual as { title?: unknown; citation?: unknown; url?: unknown }[]) : [];
  const laws = Array.isArray(row.laws_manual) ? (row.laws_manual as { title?: unknown; url?: unknown }[]) : [];
  return {
    relatedManual: cases
      .filter((c) => typeof c.title === "string" && c.title)
      .map((c) => ({ title: String(c.title), citation: typeof c.citation === "string" ? c.citation : "", url: typeof c.url === "string" && c.url ? c.url : null })),
    lawsManual: laws.filter((l) => typeof l.title === "string" && l.title).map((l) => ({ title: String(l.title), url: typeof l.url === "string" && l.url ? l.url : null })),
  };
}
