import { unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { listCases } from "../catalogue/cases.service.js";
import { searchLaws } from "../catalogue/search.service.js";
import { normalize, type Text } from "../catalogue/shared.js";

// The reader site's global search: one query, the best few of each kind — laws, provisions (sections, Orders,
// Rules), judgments and help articles — for the dropdown under the top bar. Each kind is searched the way its own
// page searches it, so a hit here is also a hit there.

export interface SearchHit {
  id: string;
  /** Language-neutral dashboard path. */
  href: string;
  title: Text;
  meta: Text;
}

export interface GlobalSearch {
  q: string;
  laws: SearchHit[];
  provisions: SearchHit[];
  cases: SearchHit[];
  articles: SearchHit[];
}

const same = (s: string): Text => ({ en: s, bn: s });

/** Strips what PostgREST's or() filter can't take inside a value. */
const safeLike = (q: string) => `%${q.replace(/[,()%*\\]/g, " ").trim()}%`;

async function articles(q: string, limit: number): Promise<SearchHit[]> {
  const like = safeLike(q);
  const rows = unwrap(
    await db
      .from("help_articles")
      .select("slug,title,title_bn,summary,summary_bn")
      .eq("status", "published")
      .or(`title.ilike.${like},title_bn.ilike.${like},summary.ilike.${like},summary_bn.ilike.${like}`)
      .order("reads", { ascending: false })
      .limit(limit),
  );
  return rows.map((a) => ({
    id: `article-${a.slug}`,
    href: `/dashboard/help/articles/${a.slug}`,
    title: { en: a.title, bn: a.title_bn || a.title },
    meta: { en: a.summary, bn: a.summary_bn || a.summary },
  }));
}

async function cases(q: string, limit: number): Promise<SearchHit[]> {
  const { cases } = await listCases({ query: q, page: 1, perPage: limit });
  return cases.map((c) => ({
    id: `case-${c.slug}`,
    href: `/dashboard/cases/${c.slug}`,
    title: { en: c.title, bn: c.titleTr || c.title },
    meta: same([c.citation, c.year].filter(Boolean).join(" · ")),
  }));
}

export async function globalSearch(query: string, limit = 5): Promise<GlobalSearch> {
  const q = normalize(query);
  if (q.length < 2) return { q, laws: [], provisions: [], cases: [], articles: [] };
  const [lawHits, caseHits, articleHits] = await Promise.all([searchLaws(q, limit * 4, { candidates: 40 }), cases(q, limit), articles(q, limit)]);
  const toHit = (h: (typeof lawHits)[number]): SearchHit => ({
    id: h.id,
    href: h.href,
    title: h.kind === "act" ? h.lawTitle : h.heading,
    meta: h.kind === "act" ? h.heading : h.lawTitle,
  });
  return {
    q,
    laws: lawHits.filter((h) => h.kind === "act").slice(0, limit).map(toHit),
    provisions: lawHits.filter((h) => h.kind !== "act").slice(0, limit).map(toHit),
    cases: caseHits,
    articles: articleHits,
  };
}
