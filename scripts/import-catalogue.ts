import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { db } from "../src/lib/supabase.js";
import { cpcGroupTitlesBn, cpcOrderTitles, cpcRelated, curatedLaws, orderIdOf } from "../src/modules/catalogue/editorial.js";
import type { TablesInsert } from "../src/types/database.js";

// Loads the reader site's catalogue into Supabase: every bdlaws act with its parts and sections, the CPC with its
// Orders and Rules and unofficial Bangla translations, and every SCOB judgment with the provisions it cites.
// Idempotent: laws and judgments are upserted by slug; their parts, sections, orders, rules and citations are
// replaced. The source files live in data/catalogue (bdlaws acts, the CPC, SCOB judgments), made by the parsers
// in scripts/sources; CATALOGUE_DIR points elsewhere if needed.

const SOURCE = path.resolve(process.env.CATALOGUE_DIR ?? new URL("../data/catalogue", import.meta.url).pathname);
const LAWS = path.join(SOURCE, "laws");
const CASES = path.join(SOURCE, "cases");
const BATCH = 400;

// Postgres jsonb can't hold U+0000, which a few scanned judgments carry; it is dropped on the way in.
const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8").replace(/\\u0000/g, "")) as T;
const exists = (file: string) => {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
};

type Block = { kind: string; mark?: string; text: string; notes?: number[] };
interface BdlawsRow {
  slug: string; bdlawsId: number; curated: boolean; language: "en" | "bn"; title: string; actNo: string; year: number;
  type: "constitution" | "act" | "ordinance" | "po"; status: "in-force" | "repealed"; subject: string; description: string;
  sections: number; unit: "sections" | "articles";
}
interface BdlawsAct {
  slug: string; longTitle: string; preamble: string; date: string;
  parts: { id: string; title: string; range: string; banner?: string; sub?: string; sections: { n: string; title: string; body?: Block[]; notes?: string[] }[] }[];
}
interface CpcGroup { id: string; title: string; part: string; range: string; sections: { n: string; title: string; body?: Block[]; notes?: string[] }[] }
interface Translation { t?: string; b?: string[]; f?: string[] }
interface CaseRecord {
  slug: string; title: string; citation: string; caseNo: string; origin: string; court: "AD" | "HCD"; date: string; dateKnown: boolean;
  hearing?: string; judges: string[]; author?: string; type: string; keywords: string[]; parties: { appellant: string; respondent: string };
  petition: boolean; advocates: { side: string; names: string }[]; laws: { law: string; kind?: string; n?: string; rule?: number }[];
  citationsReferred: string[]; excerpt: string; paragraphs: number; related: string[]; source: { volume: string; page: number; url: string };
}

const status = (s: string) => (s === "repealed" ? "repealed" : "in_force");

async function insertAll<T extends object>(table: "law_parts" | "law_sections" | "law_orders" | "law_rules" | "judgment_laws", rows: T[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from(table).insert(rows.slice(i, i + BATCH) as never);
    if (error) throw new Error(`${table}: ${error.message}`);
    process.stdout.write(`\r  ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}   `);
  }
  if (rows.length) console.log();
}

async function upsertAll<T extends object>(table: "laws" | "judgments", rows: T[], onConflict: string, batch = BATCH) {
  for (let i = 0; i < rows.length; i += batch) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + batch) as never, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    process.stdout.write(`\r  ${table}: ${Math.min(i + batch, rows.length)}/${rows.length}   `);
  }
  console.log();
}

async function deleteWhere(table: "law_parts" | "law_orders" | "judgment_laws", column: string, values: string[]) {
  for (let i = 0; i < values.length; i += 200) {
    const { error } = await db.from(table).delete().in(column, values.slice(i, i + 200));
    if (error) throw new Error(`${table} delete: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ laws */

async function importLaws() {
  const index = json<BdlawsRow[]>(path.join(LAWS, "bdlaws/index.json"));
  const curated = new Map(curatedLaws.map((c) => [c.slug, c]));
  const laws: TablesInsert<"laws">[] = [];
  const parts: TablesInsert<"law_parts">[] = [];
  const sections: TablesInsert<"law_sections">[] = [];

  for (const row of index) {
    const act = json<BdlawsAct>(path.join(LAWS, "bdlaws", `${row.slug}.json`));
    const c = curated.get(row.slug);
    laws.push({
      slug: row.slug,
      bdlaws_id: row.bdlawsId,
      title: c?.title.en ?? row.title,
      title_bn: c?.title.bn ?? null,
      act_no: c?.actNo.en ?? row.actNo,
      act_no_bn: c?.actNo.bn ?? null,
      year: row.year,
      type: row.type,
      status: status(row.status),
      subject: row.subject,
      description: c?.description.en ?? row.description,
      description_bn: c?.description.bn ?? null,
      language: row.language,
      unit: row.unit,
      section_count: row.sections,
      long_title: act.longTitle,
      preamble: act.preamble,
      enacted_on: act.date,
      curated: !!c,
      views: c?.views ?? 0,
      published: true,
    });
    let order = 0;
    for (const [pi, p] of act.parts.entries()) {
      const id = randomUUID();
      parts.push({ id, law_slug: row.slug, part_id: p.id, title: p.title, range: p.range, banner: p.banner ?? null, sub: p.sub ?? null, sort_order: pi });
      for (const s of p.sections) {
        sections.push({ law_slug: row.slug, part_id: id, n: s.n, title: s.title, body: (s.body ?? []) as never, notes: (s.notes ?? []) as never, sort_order: order++ });
      }
    }
  }

  // The curated laws whose text isn't imported: a catalogue row only
  for (const c of curatedLaws) {
    if (laws.some((l) => l.slug === c.slug)) continue;
    laws.push({
      slug: c.slug, bdlaws_id: null, title: c.title.en, title_bn: c.title.bn, act_no: c.actNo.en, act_no_bn: c.actNo.bn, year: c.year, type: c.type,
      status: status(c.status), subject: c.subject, description: c.description.en, description_bn: c.description.bn, language: "en",
      unit: c.unit, section_count: c.sections ?? 0, long_title: "", preamble: "", enacted_on: "", curated: true, views: c.views, published: true,
    });
  }

  console.log(`laws: ${laws.length} rows, ${parts.length} parts, ${sections.length} sections`);
  await upsertAll("laws", laws, "slug");
  const slugs = laws.map((l) => l.slug);
  await deleteWhere("law_parts", "law_slug", slugs);
  await insertAll("law_parts", parts);
  await insertAll("law_sections", sections);
  return { laws: laws.length, parts: parts.length, sections: sections.length };
}

/* ------------------------------------------------------------------- cpc */

async function importCpc() {
  const slug = "cpc-1908";
  const groups = json<CpcGroup[]>(path.join(LAWS, "cpc-sections.json"));
  const schedule = json<Record<string, { n: string; title: string; body?: Block[] }[]>>(path.join(LAWS, "cpc-first-schedule.json"));
  const bnPart = (id: string) => {
    const file = path.join(LAWS, "bn/cpc-sections", `${id.replace(/^(part-\d+).*$/, "$1")}.json`);
    return exists(file) ? json<Record<string, Translation>>(file) : {};
  };
  const bnOrder = (roman: string) => {
    const file = path.join(LAWS, "bn/cpc", `${roman}.json`);
    return exists(file) ? json<Record<string, Translation>>(file) : {};
  };

  const parts: TablesInsert<"law_parts">[] = [];
  const sections: TablesInsert<"law_sections">[] = [];
  let order = 0;
  for (const [gi, g] of groups.entries()) {
    const id = randomUUID();
    const [banner, ...rest] = g.title.split(" — ");
    parts.push({
      id, law_slug: slug, part_id: g.id, title: g.title, title_tr: cpcGroupTitlesBn[g.id] ?? null, range: g.range,
      banner: rest.length ? banner : null, sub: rest.length ? rest.join(" — ") : banner, sort_order: gi,
    });
    const tr = bnPart(g.id);
    for (const s of g.sections) {
      const t = tr[s.n];
      sections.push({
        law_slug: slug, part_id: id, n: s.n, title: s.title, title_tr: t?.t ?? null, body: (s.body ?? []) as never,
        notes: (s.notes ?? []) as never, translation: t?.b ? ({ b: t.b, ...(t.f ? { f: t.f } : {}) } as never) : null,
        related: cpcRelated[s.n] ?? [], sort_order: order++,
      });
    }
  }
  const orders: TablesInsert<"law_orders">[] = [];
  const rules: TablesInsert<"law_rules">[] = [];
  for (const [oi, [roman, en, bn]] of cpcOrderTitles.entries()) {
    const id = randomUUID();
    orders.push({ id, law_slug: slug, n: orderIdOf(roman), roman, title: en, title_tr: bn, sort_order: oi });
    const tr = bnOrder(roman);
    for (const [ri, r] of (schedule[roman] ?? []).entries()) {
      const t = tr[r.n];
      rules.push({ order_id: id, law_slug: slug, n: r.n, title: r.title, body: (r.body ?? []) as never, translation: t ? (t as never) : null, sort_order: ri });
    }
  }
  const c = curatedLaws.find((l) => l.slug === slug)!;
  await upsertAll(
    "laws",
    [{
      slug, bdlaws_id: null, title: c.title.en, title_bn: c.title.bn, act_no: c.actNo.en, act_no_bn: c.actNo.bn, year: c.year, type: "act", status: "in_force",
      subject: c.subject, description: c.description.en, description_bn: c.description.bn, language: "en", unit: "sections",
      section_count: sections.length, long_title: c.description.en, preamble: "", enacted_on: "21st March, 1908", curated: true, views: c.views, published: true,
    }],
    "slug",
  );
  await deleteWhere("law_parts", "law_slug", [slug]);
  await deleteWhere("law_orders", "law_slug", [slug]);
  await insertAll("law_parts", parts);
  await insertAll("law_sections", sections);
  await insertAll("law_orders", orders);
  await insertAll("law_rules", rules);
  return { sections: sections.length, orders: orders.length, rules: rules.length };
}

/* ------------------------------------------------------------- judgments */

async function importJudgments() {
  const index = json<CaseRecord[]>(path.join(CASES, "scob-index.json"));
  const rows: TablesInsert<"judgments">[] = [];
  const links: TablesInsert<"judgment_laws">[] = [];
  for (const c of index) {
    const file = path.join(CASES, "judgments", `${c.slug}.json`);
    const paragraphs = exists(file) ? json<string[]>(file) : [];
    rows.push({
      slug: c.slug, title: c.title, citation: c.citation, case_no: c.caseNo, origin: c.origin || null, court: c.court,
      decided_on: c.date || null, date_known: c.dateKnown, hearing: c.hearing ?? null, judges: c.judges, author: c.author ?? null,
      type: c.type, keywords: c.keywords, parties: c.parties as never, petition: c.petition, advocates: c.advocates as never,
      excerpt: c.excerpt, paragraphs: paragraphs as never, paragraph_count: paragraphs.length || c.paragraphs,
      citations_referred: c.citationsReferred, related_slugs: c.related, source: c.source as never, language: "en", published: true,
    });
    for (const [i, l] of c.laws.entries()) {
      links.push({ judgment_slug: c.slug, law_slug: l.law, kind: l.kind && l.n ? l.kind : "law", n: l.n ?? "", rule: l.rule ?? null, sort_order: i });
    }
  }
  console.log(`judgments: ${rows.length} rows, ${links.length} citations`);
  // Whole judgment texts: small batches keep each statement well inside the database's timeout
  await upsertAll("judgments", rows, "slug", 20);
  await deleteWhere("judgment_laws", "judgment_slug", rows.map((r) => r.slug));
  await insertAll("judgment_laws", links);
  return { judgments: rows.length, citations: links.length };
}

/* ------------------------------------------------------------------ main */

const started = Date.now();
if (!readdirSync(LAWS).includes("bdlaws")) throw new Error(`No catalogue data at ${LAWS}; set CATALOGUE_DIR.`);
// `--only=laws,cpc,judgments` limits a run (the bdlaws acts take a few minutes)
const only = new Set((process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "laws,cpc,judgments").split(","));
const laws = only.has("laws") ? await importLaws() : "skipped";
const cpc = only.has("cpc") ? await importCpc() : "skipped";
const judgments = only.has("judgments") ? await importJudgments() : "skipped";
const count = async (table: string) => (await db.from(table as "laws").select("*", { count: "exact", head: true })).count ?? 0;
console.log("\nImported", { laws, cpc, judgments }, `in ${Math.round((Date.now() - started) / 1000)}s`);
console.log("In the database:", {
  laws: await count("laws"), parts: await count("law_parts"), sections: await count("law_sections"),
  orders: await count("law_orders"), rules: await count("law_rules"), judgments: await count("judgments"), citations: await count("judgment_laws"),
});
