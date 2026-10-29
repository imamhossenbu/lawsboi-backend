import { notFound, unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import {
  blocksOf,
  fetchAll,
  lawRecordOf,
  statusIn,
  stringsOf,
  text,
  toTsQuery,
  translationOf,
  normalize,
  type Block,
  type LawRecord,
  type LawRowDb,
  type Text,
} from "./shared.js";

// Laws, their outline, one section, one Order and the whole text, shaped as the reader site renders them.

export const SUBJECTS: Record<string, Text> = {
  "civil-procedure": { en: "Civil Procedure", bn: "দেওয়ানী কার্যবিধি" },
  criminal: { en: "Criminal Law", bn: "ফৌজদারী আইন" },
  evidence: { en: "Evidence", bn: "সাক্ষ্য" },
  contract: { en: "Contract Law", bn: "চুক্তি আইন" },
  property: { en: "Property Law", bn: "সম্পত্তি আইন" },
  limitation: { en: "Limitation", bn: "তামাদি" },
  labour: { en: "Labour Law", bn: "শ্রম আইন" },
  family: { en: "Family Law", bn: "পারিবারিক আইন" },
  constitutional: { en: "Constitutional", bn: "সাংবিধানিক" },
  registration: { en: "Registration", bn: "নিবন্ধন" },
  cyber: { en: "Cyber Law", bn: "সাইবার আইন" },
  banking: { en: "Banking", bn: "ব্যাংকিং" },
  general: { en: "Other laws", bn: "অন্যান্য আইন" },
};

export const LAW_TYPES: Record<string, Text> = {
  constitution: { en: "Constitution", bn: "সংবিধান" },
  act: { en: "Acts", bn: "আইন" },
  ordinance: { en: "Ordinances", bn: "অধ্যাদেশ" },
  po: { en: "President's Orders", bn: "রাষ্ট্রপতির আদেশ" },
};

/* ------------------------------------------------------------------- list */

export interface LawFilters {
  query?: string;
  field?: "all" | "title" | "actNo" | "year";
  types?: string[];
  statuses?: string[];
  yearFrom?: number;
  yearTo?: number;
  subject?: string;
  /** First letter of the title (ignoring "The"), in either alphabet. */
  letter?: string;
  sort?: "popular" | "newest" | "oldest" | "az" | "za";
  page: number;
  perPage: number;
  /** Team members see drafts too. */
  includeDrafts?: boolean;
}

/** Laws that have Orders (the CPC): one small query, so lists can say so. */
async function orderCounts() {
  const { data } = await db.from("law_orders").select("law_slug");
  const counts = new Map<string, number>();
  for (const o of data ?? []) counts.set(o.law_slug, (counts.get(o.law_slug) ?? 0) + 1);
  return counts;
}

const escapeLike = (s: string) => s.replace(/[%_,()]/g, " ").trim();

export async function listLaws(f: LawFilters) {
  let q = db.from("laws").select("*", { count: "exact" });
  if (!f.includeDrafts) q = q.eq("published", true);
  if (f.types?.length) q = q.in("type", f.types);
  if (f.statuses?.length) q = q.in("status", f.statuses.map(statusIn));
  if (f.yearFrom) q = q.gte("year", f.yearFrom);
  if (f.yearTo) q = q.lte("year", f.yearTo);
  if (f.subject && f.subject !== "all") q = q.eq("subject", f.subject);
  if (f.letter && f.letter !== "all") {
    const letter = escapeLike(f.letter).slice(0, 2);
    q = /^[a-z]$/i.test(letter) ? q.ilike("sort_title", `${letter}%`) : q.ilike("title_bn", `${letter}%`);
  }
  const query = f.query ? normalize(f.query) : "";
  if (query) {
    const like = `%${escapeLike(query)}%`;
    const field = f.field ?? "all";
    if (field === "title") q = q.or(`title.ilike.${like},title_bn.ilike.${like},slug.ilike.${like}`);
    else if (field === "actNo") q = q.or(`act_no.ilike.${like},act_no_bn.ilike.${like}`);
    else if (field === "year") q = /^\d{4}$/.test(query) ? q.eq("year", Number(query)) : q.eq("year", -1);
    else {
      const tsq = toTsQuery(query.split(" "));
      // Short or symbol-only queries fall back to a plain substring match on the title
      q = tsq ? q.textSearch("search", tsq, { config: "simple" }) : q.or(`title.ilike.${like},title_bn.ilike.${like}`);
    }
  }
  const sort = f.sort ?? "popular";
  if (sort === "popular") q = q.order("views", { ascending: false }).order("sort_title");
  else if (sort === "newest") q = q.order("year", { ascending: false }).order("sort_title");
  else if (sort === "oldest") q = q.order("year", { ascending: true }).order("sort_title");
  else q = q.order("sort_title", { ascending: sort === "az" });

  const from = (f.page - 1) * f.perPage;
  // PostgREST answers 1,000 rows at most; "all" (the reader's search page) is fetched in pages
  const { data, count, error } = f.perPage > 1000 ? { data: await fetchAll<LawRowDb>((a, b) => q.range(a, b)), count: null, error: null } : await q.range(from, from + f.perPage - 1);
  if (error) throw new Error(`Database: ${error.message}`);
  const orders = await orderCounts();
  return { laws: (data ?? []).map((l) => lawRecordOf(l, orders.get(l.slug))), total: count ?? data?.length ?? 0, page: f.page, perPage: f.perPage };
}

/** Laws per type, and how many are amendments, for the category cards. */
export async function catalogueTotals() {
  const rows = await fetchAll<{ type: string; title: string }>((a, b) => db.from("laws").select("type,title").eq("published", true).range(a, b));
  const totals: Record<string, number> = { constitution: 0, act: 0, ordinance: 0, po: 0, amendments: 0 };
  for (const r of rows) {
    totals[r.type] = (totals[r.type] ?? 0) + 1;
    if (/\bamendment\b/i.test(r.title)) totals.amendments!++;
  }
  return totals;
}

/* ----------------------------------------------------------------- detail */

export async function findLaw(slug: string, includeDrafts = false): Promise<LawRowDb> {
  const law = unwrap(await db.from("laws").select("*").eq("slug", slug).maybeSingle(), "That law");
  if (!law.published && !includeDrafts) throw notFound("That law");
  return law;
}

type SectionHead = { id: string; part_id: string | null; n: string; title: string; title_tr: string | null; sort_order: number };

const sectionHeads = (slug: string) =>
  fetchAll<SectionHead>((a, b) => db.from("law_sections").select("id,part_id,n,title,title_tr,sort_order").eq("law_slug", slug).order("sort_order").range(a, b));

const partsOf = async (slug: string) => unwrap(await db.from("law_parts").select("*").eq("law_slug", slug).order("sort_order"));

async function ordersOf(slug: string) {
  const orders = unwrap(await db.from("law_orders").select("*").eq("law_slug", slug).order("sort_order"));
  if (!orders.length) return [];
  const rules = await fetchAll<{ order_id: string }>((a, b) => db.from("law_rules").select("order_id").eq("law_slug", slug).range(a, b));
  const counts = new Map<string, number>();
  for (const r of rules) counts.set(r.order_id, (counts.get(r.order_id) ?? 0) + 1);
  return orders.map((o) => ({ n: o.n, roman: o.roman, title: text(o.title, o.title_tr), ruleCount: counts.get(o.id) ?? 0 }));
}

export interface LawDetail {
  law: LawRecord;
  parts: { id: string; title: Text; range: string; banner: string | null; sub: string | null; sections: { n: string; title: Text }[] }[];
  orders: { n: string; roman: string; title: Text; ruleCount: number }[];
  /** How many sections have an unofficial translation. */
  translated: number;
}

/** A law with its outline: parts and section headings, and its Orders. */
export async function getLaw(slug: string, includeDrafts = false): Promise<LawDetail> {
  const law = await findLaw(slug, includeDrafts);
  const [parts, heads, orders] = await Promise.all([partsOf(slug), sectionHeads(slug), ordersOf(slug)]);
  const byPart = new Map<string | null, SectionHead[]>();
  for (const s of heads) byPart.set(s.part_id, [...(byPart.get(s.part_id) ?? []), s]);
  return {
    law: lawRecordOf(law, orders.length || undefined),
    parts: parts.map((p) => ({
      id: p.part_id,
      title: text(p.title, p.title_tr),
      range: p.range,
      banner: p.banner,
      sub: p.sub,
      sections: (byPart.get(p.id) ?? []).map((s) => ({ n: s.n, title: text(s.title, s.title_tr) })),
    })),
    orders,
    translated: heads.filter((s) => s.title_tr).length,
  };
}

export interface SectionView {
  n: string;
  title: Text;
  partTitle: Text;
  /** "bn" when the law's own text is Bangla. */
  language?: "bn";
  body: Block[];
  explanation: string | null;
  /** The unofficial translation of the body (one string per block), footnotes and explanation, when it exists. */
  translation: { title: string; body: string[]; footnotes: string[]; explanation?: string } | null;
  footnotes: { mark: number; text: Text }[];
  amendments: { year: number; text: Text }[];
  related: { n: string; title: Text }[];
  prev?: { n: string; title: Text };
  next?: { n: string; title: Text };
}

export async function getSection(slug: string, n: string, includeDrafts = false): Promise<SectionView> {
  const law = await findLaw(slug, includeDrafts);
  const heads = await sectionHeads(slug);
  const index = heads.findIndex((s) => s.n === n);
  if (index === -1) throw notFound("That section");
  const row = unwrap(await db.from("law_sections").select("*").eq("id", heads[index]!.id).single());
  const part = row.part_id ? unwrap(await db.from("law_parts").select("title,title_tr").eq("id", row.part_id).single()) : null;
  const link = (i: number) => (heads[i] ? { n: heads[i]!.n, title: text(heads[i]!.title, heads[i]!.title_tr) } : undefined);
  const byNumber = new Map(heads.map((s) => [s.n, text(s.title, s.title_tr)]));
  const tr = translationOf(row.translation);
  const notes = stringsOf(row.notes);
  const amendments = (Array.isArray(row.amendments) ? (row.amendments as { year: number; text: string; text_bn?: string }[]) : []);
  return {
    n: row.n,
    title: text(row.title, row.title_tr),
    partTitle: part ? text(part.title, part.title_tr) : { en: "", bn: "" },
    ...(law.language === "bn" ? { language: "bn" as const } : {}),
    body: blocksOf(row.body),
    explanation: row.explanation,
    translation: tr?.b ? { title: row.title_tr ?? tr.t ?? row.title, body: tr.b, footnotes: tr.f ?? [], ...(tr.explanation ? { explanation: tr.explanation } : {}) } : null,
    footnotes: notes.map((t, i) => ({ mark: i + 1, text: text(t, tr?.f?.[i]) })),
    amendments: amendments.map((a) => ({ year: a.year, text: text(a.text, a.text_bn) })),
    related: row.related.filter((r) => byNumber.has(r)).map((r) => ({ n: r, title: byNumber.get(r)! })),
    prev: link(index - 1),
    next: link(index + 1),
  };
}

export interface OrderView {
  n: string;
  roman: string;
  title: Text;
  rules: { n: string; title: Text; body: Block[]; translation: { title: string; body: string[] } | null }[];
  prev?: { n: string; roman: string };
  next?: { n: string; roman: string };
}

export async function getOrder(slug: string, n: string, includeDrafts = false): Promise<OrderView> {
  await findLaw(slug, includeDrafts);
  const orders = unwrap(await db.from("law_orders").select("*").eq("law_slug", slug).order("sort_order"));
  const index = orders.findIndex((o) => o.n.toLowerCase() === n.toLowerCase());
  if (index === -1) throw notFound("That Order");
  const o = orders[index]!;
  const rules = unwrap(await db.from("law_rules").select("*").eq("order_id", o.id).order("sort_order"));
  const near = (i: number) => (orders[i] ? { n: orders[i]!.n, roman: orders[i]!.roman } : undefined);
  return {
    n: o.n,
    roman: o.roman,
    title: text(o.title, o.title_tr),
    rules: rules.map((r) => {
      const tr = translationOf(r.translation);
      return { n: r.n, title: text(r.title, tr?.t), body: blocksOf(r.body), translation: tr?.b ? { title: tr.t ?? r.title, body: tr.b } : null };
    }),
    prev: near(index - 1),
    next: near(index + 1),
  };
}

export interface ActText {
  slug: string;
  language?: "bn";
  longTitle: string;
  preamble: string;
  date: string;
  /** Any section carries an unofficial translation. */
  translated: boolean;
  parts: {
    id: string;
    title: Text;
    banner: string | null;
    sub: string | null;
    sections: { n: string; title: Text; body: Block[]; translation: { title: string; body: string[] } | null; footnotes: { mark: number; text: Text }[] }[];
  }[];
}

/** The whole law in order, for the bare-act reading view. */
export async function getActText(slug: string, includeDrafts = false): Promise<ActText> {
  const law = await findLaw(slug, includeDrafts);
  const [parts, sections] = await Promise.all([
    partsOf(slug),
    fetchAll<{ part_id: string | null; n: string; title: string; title_tr: string | null; body: unknown; notes: unknown; translation: unknown }>((a, b) =>
      db.from("law_sections").select("part_id,n,title,title_tr,body,notes,translation").eq("law_slug", slug).order("sort_order").range(a, b),
    ),
  ]);
  const byPart = new Map<string | null, typeof sections>();
  for (const s of sections) byPart.set(s.part_id, [...(byPart.get(s.part_id) ?? []), s]);
  let translated = false;
  const out: ActText = {
    slug,
    ...(law.language === "bn" ? { language: "bn" as const } : {}),
    longTitle: law.long_title,
    preamble: law.preamble,
    date: law.enacted_on,
    translated: false,
    parts: parts.map((p) => ({
      id: p.part_id,
      title: text(p.title, p.title_tr),
      banner: p.banner,
      sub: p.sub,
      sections: (byPart.get(p.id) ?? []).map((s) => {
        const tr = translationOf(s.translation);
        if (tr?.b) translated = true;
        const notes = stringsOf(s.notes);
        return {
          n: s.n,
          title: text(s.title, s.title_tr),
          body: blocksOf(s.body),
          translation: tr?.b ? { title: s.title_tr ?? tr.t ?? s.title, body: tr.b } : null,
          footnotes: notes.map((t, i) => ({ mark: i + 1, text: text(t, tr?.f?.[i]) })),
        };
      }),
    })),
  };
  out.translated = translated;
  return out;
}

/* ------------------------------------------------------------- home page */

/** The hand-picked laws for the home page, most read first. */
export async function popularLaws(limit = 6) {
  const rows = unwrap(await db.from("laws").select("*").eq("published", true).eq("curated", true).order("views", { ascending: false }).limit(limit));
  const orders = await orderCounts();
  return rows.map((l) => lawRecordOf(l, orders.get(l.slug)));
}
