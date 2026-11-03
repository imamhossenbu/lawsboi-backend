import type { Tables } from "../../types/database.js";

// Legal news: what the team posts each day (new Acts and Ordinances, Gazette notices, notable judgments, court
// notices), shown on the reader site's /news, its home page and the dashboard, in both languages.

export type NewsRow = Tables<"news_posts">;
export const newsCategories = ["legislation", "judgment", "gazette", "court", "notice", "other"] as const;

const text = (en: string, bn: string) => ({ en, bn: bn || en });

/** A post as the reader site shows it; `full` adds the body. */
export function newsOf(n: NewsRow, full = false) {
  return {
    id: n.public_id,
    slug: n.slug,
    title: text(n.title, n.title_bn),
    summary: text(n.summary, n.summary_bn),
    ...(full ? { body: text(n.body, n.body_bn) } : {}),
    category: n.category,
    cover: n.cover_url,
    source: n.source_url ? { name: n.source_name ?? "", url: n.source_url } : null,
    pinned: n.pinned,
    publishedAt: n.published_at,
    views: n.views,
  };
}

/** "Supreme Court stays …" → "supreme-court-stays-…-k3x9" (Bangla titles keep their letters). */
export function slugFor(title: string) {
  const base = title
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return `${base || "news"}-${Math.random().toString(36).slice(2, 6)}`;
}
