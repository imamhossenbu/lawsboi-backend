import { unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { clip, orderLabel, parseQuery, ruleLabel, sectionLabel, text, toTsQuery, type Text } from "./shared.js";

// The dashboard's law search: every section, Order and Rule we hold text for, ranked in Postgres, with a query
// that names a provision ("section 151", "o.39 r.1", "১৪৪") going straight to it.

export type HitKind = "act" | "section" | "order" | "rule";

export interface LawHit {
  id: string;
  kind: HitKind;
  slug: string;
  lawTitle: Text;
  /** "Section 151 — Saving of inherent powers of Court"; for a law, its Act number. */
  heading: Text;
  title: Text;
  n: string | null;
  orderN: string | null;
  roman: string | null;
  snippet: Text;
  /** Section / Order / Rule numbers a query can name directly ("151", "39", "39.1"). */
  numbers: string[];
  year: number;
  status: string;
  lawType: string;
  subject: string;
  /** Language-neutral dashboard path. */
  href: string;
  views: number;
}

type LawHead = { slug: string; title: string; title_bn: string | null; year: number; status: string; type: string; subject: string; unit: string; views: number; act_no: string; act_no_bn: string | null; description: string; description_bn: string | null };

const HEAD = "slug,title,title_bn,year,status,type,subject,unit,views,act_no,act_no_bn,description,description_bn";

async function lawHeads(slugs: string[]) {
  if (!slugs.length) return new Map<string, LawHead>();
  const rows = unwrap(await db.from("laws").select(HEAD).in("slug", slugs).eq("published", true));
  return new Map(rows.map((l) => [l.slug, l as LawHead]));
}

const joinHeading = (label: Text, title: Text): Text => ({ en: `${label.en} — ${title.en}`, bn: `${label.bn} — ${title.bn}` });

type ProvisionRow = { kind: string; law_slug: string; n: string; order_n: string | null; roman: string | null; title: string; title_tr: string | null; snippet: string; snippet_tr: string | null; rank: number; sort_order: number };

function hitOf(r: ProvisionRow, law: LawHead): LawHit {
  const unit = law.unit as "sections" | "articles";
  const title = text(r.title, r.title_tr);
  const snippet: Text = { en: clip(r.snippet), bn: clip(r.snippet_tr || r.snippet) };
  const base = { slug: law.slug, lawTitle: text(law.title, law.title_bn), title, snippet, year: law.year, status: law.status === "repealed" ? "repealed" : "in-force", lawType: law.type, subject: law.subject };
  if (r.kind === "rule") {
    const order = orderLabel(r.roman!, r.order_n!);
    const rule = ruleLabel(r.n);
    return {
      ...base,
      id: `rule-${law.slug}-${r.order_n}-${r.n}`,
      kind: "rule",
      heading: joinHeading({ en: `${order.en}, ${rule.en}`, bn: `${order.bn}, ${rule.bn}` }, title),
      n: r.n,
      orderN: r.order_n,
      roman: r.roman,
      numbers: [`${r.order_n}.${r.n}`.toLowerCase(), `${r.roman}.${r.n}`.toLowerCase()],
      href: `/dashboard/laws/${law.slug}/order-${r.order_n}#rule-${r.n}`,
      views: Number(law.views) + 1000 - r.sort_order,
    };
  }
  return {
    ...base,
    id: `section-${law.slug}-${r.n}`,
    kind: "section",
    heading: joinHeading(sectionLabel(r.n, unit), title),
    n: r.n,
    orderN: null,
    roman: null,
    numbers: [r.n.toLowerCase()],
    href: `/dashboard/laws/${law.slug}/section-${r.n}`,
    views: Number(law.views) + 5000 - r.sort_order,
  };
}

/** Sections (and Rules) carrying exactly a named number, across every law — "151" on its own. */
async function provisionsNumbered(numbers: string[], limit: number): Promise<ProvisionRow[]> {
  const plain = numbers.filter((n) => !n.includes("."));
  const rows: ProvisionRow[] = [];
  if (plain.length) {
    const sections = unwrap(await db.from("law_sections").select("law_slug,n,title,title_tr,body,translation,sort_order").in("n", plain).limit(limit));
    for (const s of sections) {
      const body = Array.isArray(s.body) ? (s.body as { text: string }[]).map((b) => b.text).join(" ") : "";
      const tr = s.translation && typeof s.translation === "object" && Array.isArray((s.translation as { b?: string[] }).b) ? (s.translation as { b: string[] }).b.join(" ") : null;
      rows.push({ kind: "section", law_slug: s.law_slug, n: s.n, order_n: null, roman: null, title: s.title, title_tr: s.title_tr, snippet: body.slice(0, 400), snippet_tr: tr?.slice(0, 400) ?? null, rank: 0, sort_order: s.sort_order });
    }
  }
  const dotted = numbers.filter((n) => n.includes("."));
  for (const d of dotted) {
    const [order, rule] = d.split(".") as [string, string];
    const orders = unwrap(await db.from("law_orders").select("id,n,roman,law_slug").or(`n.ilike.${order},roman.ilike.${order}`));
    for (const o of orders) {
      const rules = unwrap(await db.from("law_rules").select("n,title,translation,body,sort_order").eq("order_id", o.id).ilike("n", rule));
      for (const r of rules) {
        const tr = r.translation as { t?: string; b?: string[] } | null;
        const body = Array.isArray(r.body) ? (r.body as { text: string }[]).map((b) => b.text).join(" ") : "";
        rows.push({ kind: "rule", law_slug: o.law_slug, n: r.n, order_n: o.n, roman: o.roman, title: r.title, title_tr: tr?.t ?? null, snippet: body.slice(0, 400), snippet_tr: tr?.b?.join(" ").slice(0, 400) ?? null, rank: 0, sort_order: r.sort_order });
      }
    }
  }
  return rows;
}

/** Laws whose title matches the words, as "act" hits at the top of the list. */
async function actHits(tsq: string, limit: number): Promise<LawHit[]> {
  const found = unwrap(await db.rpc("search_laws", { tsq, max_rows: limit }));
  if (!found.length) return [];
  const heads = await lawHeads(found.map((f) => f.slug));
  return found.flatMap((f) => {
    const law = heads.get(f.slug);
    if (!law) return [];
    const title = text(law.title, law.title_bn);
    return [{
      id: `act-${law.slug}`,
      kind: "act" as const,
      slug: law.slug,
      lawTitle: title,
      heading: text(law.act_no, law.act_no_bn),
      title,
      n: null,
      orderN: null,
      roman: null,
      snippet: text(law.description, law.description_bn),
      numbers: [],
      year: law.year,
      status: law.status === "repealed" ? "repealed" : "in-force",
      lawType: law.type,
      subject: law.subject,
      href: `/dashboard/laws/${law.slug}`,
      views: Number(law.views),
    }];
  });
}

// Words that only say what kind of provision a number is ("section 144"): searching for them as text would match
// nearly every section and push the numbered ones out
const PROVISION_WORDS = new Set(["section", "sections", "sec", "s", "article", "art", "order", "rule", "o", "r", "ধারা", "অনুচ্ছেদ", "আদেশ", "বিধি"]);

// The text search fetches at least this many rows before the final sort, so a short `limit` can't drop the best
// match before the number boost and popularity have been applied
const MIN_CANDIDATES = 200;

/** The best-matching laws and provisions for one query, best first. `anyWords` matches any of the words (for a
 * model-written list of search terms) instead of all of them, and ignores numbers; `words` replaces the query's
 * own words (the assistant passes a question's words without "what", "how"…). */
export async function searchLaws(query: string, limit = 300, options: { anyWords?: boolean; words?: string[]; candidates?: number } = {}): Promise<LawHit[]> {
  if (query.trim().length < 2) return [];
  const parsedQuery = parseQuery(query);
  const numbers = options.anyWords ? [] : parsedQuery.numbers;
  const queryWords = options.words ?? parsedQuery.words;
  const words = numbers.length ? queryWords.filter((w) => !PROVISION_WORDS.has(w)) : queryWords;
  const all_ = toTsQuery(words);
  const tsq = options.anyWords ? (all_?.replace(/ & /g, " | ") ?? null) : all_;
  // The global search's dropdown asks for fewer candidates: it shows a handful and has to answer while typing
  const candidates = Math.max(limit, options.candidates ?? MIN_CANDIDATES);
  // The text search, the numbered provisions and the matching laws don't depend on each other: one round trip
  const [rows, numbered, acts] = await Promise.all([
    tsq ? db.rpc("search_provisions", { tsq, max_rows: candidates }).then((r) => unwrap(r) as ProvisionRow[]) : Promise.resolve([] as ProvisionRow[]),
    // A named number: the provisions carrying that number, not every text mentioning it
    numbers.length ? provisionsNumbered(numbers, candidates) : Promise.resolve([] as ProvisionRow[]),
    tsq ? actHits(tsq, 10) : Promise.resolve([] as LawHit[]),
  ]);
  const all = [...numbered, ...rows];
  const heads = await lawHeads([...new Set(all.map((r) => r.law_slug))]);
  const hits = all.flatMap((r) => {
    const law = heads.get(r.law_slug);
    return law ? [{ hit: hitOf(r, law), rank: r.rank }] : [];
  });
  const scored = hits.map(({ hit, rank }) => ({ hit, score: (numbers.some((n) => hit.numbers.includes(n)) ? 100 : 0) + rank * 10 }));
  scored.sort((a, b) => b.score - a.score || b.hit.views - a.hit.views);
  const seen = new Set<string>();
  return [...acts, ...scored.map((s) => s.hit)].filter((h) => !seen.has(h.id) && seen.add(h.id)).slice(0, limit);
}
