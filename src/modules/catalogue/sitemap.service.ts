import { db } from "../../lib/supabase.js";
import { fetchAll } from "./shared.js";

// What the reader site's sitemap lists: every published law (with whether it has a full text and which Orders it
// holds), every published judgment, and the sections, which are many (tens of thousands) and so read in ranges.

export interface SitemapIndex {
  laws: { slug: string; updatedAt: string; text: boolean; orders: string[] }[];
  cases: { slug: string; updatedAt: string }[];
  /** Sections in all: read them in ranges with sitemapSections(from, to). */
  sections: number;
}

export async function sitemapIndex(): Promise<SitemapIndex> {
  const [laws, parts, orders, cases, sections] = await Promise.all([
    fetchAll<{ slug: string; updated_at: string }>((from, to) => db.from("laws").select("slug,updated_at").eq("published", true).order("slug").range(from, to)),
    fetchAll<{ law_slug: string }>((from, to) => db.from("law_parts").select("law_slug").order("law_slug").range(from, to)),
    fetchAll<{ law_slug: string; n: string }>((from, to) => db.from("law_orders").select("law_slug,n").order("law_slug").order("sort_order").range(from, to)),
    fetchAll<{ slug: string; updated_at: string }>((from, to) => db.from("judgments").select("slug,updated_at").eq("published", true).order("slug").range(from, to)),
    countPublishedSections(),
  ]);
  const withText = new Set(parts.map((p) => p.law_slug));
  const ordersOf = new Map<string, string[]>();
  for (const o of orders) ordersOf.set(o.law_slug, [...(ordersOf.get(o.law_slug) ?? []), o.n]);
  return {
    laws: laws.map((l) => ({ slug: l.slug, updatedAt: l.updated_at, text: withText.has(l.slug), orders: ordersOf.get(l.slug) ?? [] })),
    cases: cases.map((c) => ({ slug: c.slug, updatedAt: c.updated_at })),
    sections,
  };
}

async function countPublishedSections() {
  const { count, error } = await db.from("law_sections").select("id", { count: "exact", head: true });
  if (error) throw new Error(`Database: ${error.message}`);
  return count ?? 0;
}

/** Sections `from`..`to` (inclusive, at most 20,000) in a stable order. The range runs over every section along the
 * (law_slug, sort_order) index, which stays fast at any offset; sections of unpublished laws are then dropped, so a
 * range may hold a few fewer. */
export async function sitemapSections(from: number, to: number) {
  const size = 1000;
  const pages: Promise<{ law_slug: string; n: string; updated_at: string }[]>[] = [];
  for (let start = from; start <= to; start += size) {
    const end = Math.min(start + size - 1, to);
    pages.push(
      Promise.resolve(db.from("law_sections").select("law_slug,n,updated_at").order("law_slug").order("sort_order").range(start, end)).then(({ data, error }) => {
        if (error) throw new Error(`Database: ${error.message}`);
        return data ?? [];
      }),
    );
  }
  const [rows, hidden] = await Promise.all([Promise.all(pages).then((p) => p.flat()), unpublishedLaws()]);
  return rows.filter((s) => !hidden.has(s.law_slug)).map((s) => ({ slug: s.law_slug, n: s.n, updatedAt: s.updated_at }));
}

async function unpublishedLaws() {
  const { data, error } = await db.from("laws").select("slug").eq("published", false);
  if (error) throw new Error(`Database: ${error.message}`);
  return new Set((data ?? []).map((l) => l.slug));
}
