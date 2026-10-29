import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { badRequest, conflict, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import type { TablesInsert } from "../../../types/database.js";
import { logAudit } from "../../audit/service.js";
import { findJudgment, getCase, listCases, summariesOf } from "../../catalogue/cases.service.js";
import { findLaw, getActText, getLaw } from "../../catalogue/laws.service.js";
import { slugParam } from "../../catalogue/schemas.js";
import { fetchAll, lawRecordOf, statusIn, text, type Text } from "../../catalogue/shared.js";
import { adminCasesQuery, adminLawsQuery, createCase, createLaw, linksPut, patchCase, patchLaw, sectionPatch, slugify, translationPut } from "./schemas.js";

// Team: the Laws & case laws pages. Every change is written to catalogue_revisions (the item's History tab) and
// to the audit log.

export const adminCatalogueRouter = Router();
adminCatalogueRouter.use(requireTeam, requirePermission("laws.view"));

type RevisionKind = "created" | "published" | "unpublished" | "info" | "section" | "translation" | "untranslated" | "linked" | "unlinked" | "text";

async function revision(req: { member?: { id: string } }, target: "law" | "judgment", slug: string, kind: RevisionKind, extra: { n?: string; law?: string } = {}) {
  await db.from("catalogue_revisions").insert({ target_type: target, target_slug: slug, kind, n: extra.n ?? null, law_slug: extra.law ?? null, actor_id: req.member?.id ?? null });
}

async function history(target: "law" | "judgment", slug: string) {
  const rows = unwrap(await db.from("catalogue_revisions").select("*").eq("target_type", target).eq("target_slug", slug).order("created_at", { ascending: false }).limit(200));
  const actors = [...new Set(rows.map((r) => r.actor_id).filter((a): a is string => !!a))];
  const members = actors.length ? unwrap(await db.from("team_members").select("id,public_id").in("id", actors)) : [];
  const byId = new Map(members.map((m) => [m.id, m.public_id]));
  return rows.map((r) => ({ at: r.created_at, kind: r.kind, n: r.n, law: r.law_slug, by: r.actor_id ? (byId.get(r.actor_id) ?? null) : null }));
}

const lawLabel = (l: { title: string; title_bn: string | null }): Text => text(l.title, l.title_bn);
const caseLabel = (c: { title: string; title_tr: string | null }): Text => text(c.title, c.title_tr);
const sectionParam = slugParam.extend({ n: z.string().trim().min(1).max(20) });

/* ------------------------------------------------------------------- laws */

adminCatalogueRouter.get("/laws", validate("query", adminLawsQuery), async (req, res) => {
  const q = parsed<z.infer<typeof adminLawsQuery>>(req, "query");
  let query = db.from("laws").select("*", { count: "exact" });
  if (q.status === "published") query = query.eq("published", true);
  if (q.status === "draft") query = query.eq("published", false);
  if (q.type) query = query.eq("type", q.type);
  if (q.subject) query = query.eq("subject", q.subject);
  if (q.language) query = query.eq("language", q.language);
  if (q.q) {
    const like = `%${q.q.replace(/[%_,()]/g, " ").trim()}%`;
    query = query.or(`title.ilike.${like},title_bn.ilike.${like},slug.ilike.${like},act_no.ilike.${like}`);
  }
  if (q.sort === "updated") query = query.order("updated_at", { ascending: false });
  else if (q.sort === "az") query = query.order("sort_title");
  else if (q.sort === "newest") query = query.order("year", { ascending: false });
  else query = query.order("views", { ascending: false });
  const from = (q.page - 1) * q.perPage;
  const { data, count, error } = await query.range(from, from + q.perPage - 1);
  if (error) throw new Error(`Database: ${error.message}`);
  const slugs = (data ?? []).map((l) => l.slug);
  const translated = slugs.length ? await fetchAll<{ law_slug: string }>((a, b) => db.from("law_sections").select("law_slug").in("law_slug", slugs).not("title_tr", "is", null).range(a, b)) : [];
  const counts = new Map<string, number>();
  for (const t of translated) counts.set(t.law_slug, (counts.get(t.law_slug) ?? 0) + 1);
  res.json({ laws: (data ?? []).map((l) => ({ ...lawRecordOf(l), translated: counts.get(l.slug) ?? 0 })), total: count ?? 0, page: q.page, perPage: q.perPage });
});

/** A whole law for editing: metadata, outline, the full text with translations, and its history. */
adminCatalogueRouter.get("/laws/:slug", validate("params", slugParam), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const [detail, actText, past] = await Promise.all([getLaw(slug, true), getActText(slug, true), history("law", slug)]);
  res.json({ ...detail, text: actText, history: past });
});

adminCatalogueRouter.get("/laws/:slug/history", validate("params", slugParam), async (req, res) => {
  res.json({ history: await history("law", parsed<{ slug: string }>(req, "params").slug) });
});

adminCatalogueRouter.post("/laws", requirePermission("laws.add"), validate("body", createLaw), async (req, res) => {
  const b = req.body as z.infer<typeof createLaw>;
  const slug = b.slug ?? slugify(b.title, b.year);
  if ((await db.from("laws").select("slug").eq("slug", slug).maybeSingle()).data) throw conflict("A law with that slug already exists.", { slug: "taken" });
  const sections = b.parts.flatMap((p) => p.sections);
  const law = unwrap(
    await db
      .from("laws")
      .insert({
        slug, bdlaws_id: b.bdlawsId ?? null, title: b.title, title_bn: b.titleBn ?? null, act_no: b.actNo, act_no_bn: b.actNoBn ?? null, year: b.year, type: b.type,
        status: statusIn(b.status), subject: b.subject, description: b.description, description_bn: b.descriptionBn ?? null, language: b.language, unit: b.unit,
        section_count: sections.length, long_title: b.longTitle, preamble: b.preamble, enacted_on: b.date, published: b.published,
      })
      .select("*")
      .single(),
  );
  let order = 0;
  for (const [pi, p] of b.parts.entries()) {
    const id = randomUUID();
    const { error } = await db.from("law_parts").insert({ id, law_slug: slug, part_id: p.id, title: p.title, title_tr: p.titleTr ?? null, range: p.range, banner: p.banner ?? null, sub: p.sub ?? null, sort_order: pi });
    if (error) throw new Error(`law_parts: ${error.message}`);
    const rows: TablesInsert<"law_sections">[] = p.sections.map((s) => {
      const tr = b.translations[s.n];
      return { law_slug: slug, part_id: id, n: s.n, title: s.title, title_tr: tr?.title ?? null, body: s.body as never, notes: s.notes as never, translation: tr ? ({ t: tr.title, b: tr.b, ...(tr.f ? { f: tr.f } : {}) } as never) : null, sort_order: order++ };
    });
    if (rows.length) {
      const { error: e } = await db.from("law_sections").insert(rows);
      if (e) throw new Error(`law_sections: ${e.message}`);
    }
  }
  await revision(req, "law", slug, "created");
  await logAudit(req, { action: "law.create", target: { type: "law", id: slug, label: lawLabel(law) } });
  res.status(201).json(await getLaw(slug, true));
});

adminCatalogueRouter.patch("/laws/:slug", requirePermission("laws.edit"), validate("params", slugParam), validate("body", patchLaw), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const b = req.body as z.infer<typeof patchLaw>;
  await findLaw(slug, true);
  const patch = {
    ...(b.title !== undefined && { title: b.title }),
    ...(b.titleBn !== undefined && { title_bn: b.titleBn }),
    ...(b.actNo !== undefined && { act_no: b.actNo }),
    ...(b.actNoBn !== undefined && { act_no_bn: b.actNoBn }),
    ...(b.year !== undefined && { year: b.year }),
    ...(b.type !== undefined && { type: b.type }),
    ...(b.status !== undefined && { status: statusIn(b.status) }),
    ...(b.subject !== undefined && { subject: b.subject }),
    ...(b.description !== undefined && { description: b.description }),
    ...(b.descriptionBn !== undefined && { description_bn: b.descriptionBn }),
    ...(b.language !== undefined && { language: b.language }),
    ...(b.unit !== undefined && { unit: b.unit }),
    ...(b.longTitle !== undefined && { long_title: b.longTitle }),
    ...(b.preamble !== undefined && { preamble: b.preamble }),
    ...(b.date !== undefined && { enacted_on: b.date }),
    ...(b.bdlawsId !== undefined && { bdlaws_id: b.bdlawsId }),
  };
  if (!Object.keys(patch).length) throw badRequest("Nothing to change.");
  const law = unwrap(await db.from("laws").update(patch).eq("slug", slug).select("*").single());
  await revision(req, "law", slug, "info");
  await logAudit(req, { action: "law.edit", target: { type: "law", id: slug, label: lawLabel(law) }, changes: Object.keys(patch).map((field) => ({ field })) });
  res.json({ law: lawRecordOf(law) });
});

adminCatalogueRouter.post("/laws/:slug/publish", requirePermission("laws.publish"), validate("params", slugParam), validate("body", z.object({ published: z.boolean() })), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const { published } = req.body as { published: boolean };
  const law = unwrap(await db.from("laws").update({ published }).eq("slug", slug).select("*").maybeSingle(), "That law");
  await revision(req, "law", slug, published ? "published" : "unpublished");
  await logAudit(req, { action: published ? "law.publish" : "law.unpublish", target: { type: "law", id: slug, label: lawLabel(law) } });
  res.json({ law: lawRecordOf(law) });
});

adminCatalogueRouter.put("/laws/:slug/sections/:n", requirePermission("laws.edit"), validate("params", sectionParam), validate("body", sectionPatch), async (req, res) => {
  const { slug, n } = parsed<{ slug: string; n: string }>(req, "params");
  const b = req.body as z.infer<typeof sectionPatch>;
  const law = await findLaw(slug, true);
  const patch = { title: b.title, body: b.body as never, ...(b.notes !== undefined && { notes: b.notes as never }) };
  const section = unwrap(await db.from("law_sections").update(patch).eq("law_slug", slug).eq("n", n).select("*").maybeSingle(), "That section");
  await revision(req, "law", slug, "section", { n });
  await logAudit(req, { action: "law.section", target: { type: "law", id: slug, label: lawLabel(law) }, changes: [{ field: "section", to: n }] });
  res.json({ section: { n: section.n, title: section.title, body: section.body, notes: section.notes } });
});

adminCatalogueRouter.put("/laws/:slug/sections/:n/translation", requirePermission("laws.translate"), validate("params", sectionParam), validate("body", translationPut), async (req, res) => {
  const { slug, n } = parsed<{ slug: string; n: string }>(req, "params");
  const b = req.body as z.infer<typeof translationPut>;
  const law = await findLaw(slug, true);
  const translation = { t: b.title, b: b.b, ...(b.f ? { f: b.f } : {}) };
  unwrap(await db.from("law_sections").update({ title_tr: b.title, translation: translation as never }).eq("law_slug", slug).eq("n", n).select("id").maybeSingle(), "That section");
  await revision(req, "law", slug, "translation", { n });
  await logAudit(req, { action: "law.translate", target: { type: "law", id: slug, label: lawLabel(law) }, changes: [{ field: "section", to: n }] });
  res.json({ translation: { title: b.title, body: b.b, footnotes: b.f ?? [] } });
});

adminCatalogueRouter.delete("/laws/:slug/sections/:n/translation", requirePermission("laws.translate"), validate("params", sectionParam), async (req, res) => {
  const { slug, n } = parsed<{ slug: string; n: string }>(req, "params");
  const law = await findLaw(slug, true);
  unwrap(await db.from("law_sections").update({ title_tr: null, translation: null }).eq("law_slug", slug).eq("n", n).select("id").maybeSingle(), "That section");
  await revision(req, "law", slug, "untranslated", { n });
  await logAudit(req, { action: "law.untranslate", target: { type: "law", id: slug, label: lawLabel(law) }, changes: [{ field: "section", to: n }] });
  res.status(204).end();
});

/* ------------------------------------------------------------------ cases */

adminCatalogueRouter.get("/cases", validate("query", adminCasesQuery), async (req, res) => {
  const q = parsed<z.infer<typeof adminCasesQuery>>(req, "query");
  if (q.sort !== "updated") {
    const result = await listCases({ query: q.q, courts: q.court ? [q.court] : [], types: q.type ? [q.type] : [], sort: q.sort === "latest" ? "latest" : q.sort === "oldest" ? "oldest" : "az", page: q.page, perPage: q.perPage, includeDrafts: true });
    res.json(result);
    return;
  }
  let query = db.from("judgments").select("slug,title,title_tr,citation,case_no,court,decided_on,date_known,judges,author,type,keywords,excerpt,language,published,paragraph_count,updated_at", { count: "exact" });
  if (q.status === "published") query = query.eq("published", true);
  if (q.status === "draft") query = query.eq("published", false);
  if (q.court) query = query.eq("court", q.court);
  if (q.type) query = query.eq("type", q.type);
  if (q.q) {
    const like = `%${q.q.replace(/[%_,()]/g, " ").trim()}%`;
    query = query.or(`title.ilike.${like},title_tr.ilike.${like},citation.ilike.${like},case_no.ilike.${like},slug.ilike.${like}`);
  }
  const from = (q.page - 1) * q.perPage;
  const { data, count, error } = await query.order("updated_at", { ascending: false }).range(from, from + q.perPage - 1);
  if (error) throw new Error(`Database: ${error.message}`);
  res.json({ cases: await summariesOf(data ?? []), total: count ?? 0, page: q.page, perPage: q.perPage });
});

adminCatalogueRouter.get("/cases/:slug", validate("params", slugParam), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const [detail, past] = await Promise.all([getCase(slug, true), history("judgment", slug)]);
  res.json({ case: detail, history: past });
});

adminCatalogueRouter.get("/cases/:slug/history", validate("params", slugParam), async (req, res) => {
  res.json({ history: await history("judgment", parsed<{ slug: string }>(req, "params").slug) });
});

const caseColumns = (b: Partial<z.infer<typeof caseInfoShape>>) => ({
  ...(b.title !== undefined && { title: b.title }),
  ...(b.titleTr !== undefined && { title_tr: b.titleTr }),
  ...(b.citation !== undefined && { citation: b.citation }),
  ...(b.caseNo !== undefined && { case_no: b.caseNo }),
  ...(b.origin !== undefined && { origin: b.origin }),
  ...(b.court !== undefined && { court: b.court }),
  ...(b.date !== undefined && { decided_on: b.date }),
  ...(b.dateKnown !== undefined && { date_known: b.dateKnown }),
  ...(b.hearing !== undefined && { hearing: b.hearing }),
  ...(b.judges !== undefined && { judges: b.judges }),
  ...(b.author !== undefined && { author: b.author }),
  ...(b.type !== undefined && { type: b.type }),
  ...(b.keywords !== undefined && { keywords: b.keywords }),
  ...(b.parties !== undefined && { parties: b.parties as never }),
  ...(b.petition !== undefined && { petition: b.petition }),
  ...(b.advocates !== undefined && { advocates: b.advocates as never }),
  ...(b.excerpt !== undefined && { excerpt: b.excerpt }),
  ...(b.citationsReferred !== undefined && { citations_referred: b.citationsReferred }),
  ...(b.related !== undefined && { related_slugs: b.related }),
  ...(b.source !== undefined && { source: b.source as never }),
  ...(b.language !== undefined && { language: b.language }),
});
const caseInfoShape = patchCase;

async function assertLawsExist(links: { law: string }[]) {
  const slugs = [...new Set(links.map((l) => l.law))];
  if (!slugs.length) return;
  const found = unwrap(await db.from("laws").select("slug").in("slug", slugs));
  const missing = slugs.filter((s) => !found.some((f) => f.slug === s));
  if (missing.length) throw badRequest(`Unknown law: ${missing.join(", ")}`, { laws: "unknown" });
}

adminCatalogueRouter.post("/cases", requirePermission("laws.cases"), validate("body", createCase), async (req, res) => {
  const b = req.body as z.infer<typeof createCase>;
  const slug = b.slug ?? slugify(b.citation.replace(/[[\]]/g, " "), Number(b.date?.slice(0, 4) ?? new Date().getFullYear()));
  if ((await db.from("judgments").select("slug").eq("slug", slug).maybeSingle()).data) throw conflict("A judgment with that slug already exists.", { slug: "taken" });
  await assertLawsExist(b.laws);
  const row = unwrap(
    await db
      .from("judgments")
      .insert({ slug, ...caseColumns(b), paragraphs: b.paragraphs as never, paragraphs_tr: (b.paragraphsTr ?? null) as never, paragraph_count: b.paragraphs.length, published: b.published } as never)
      .select("*")
      .single(),
  );
  if (b.laws.length) {
    const { error } = await db.from("judgment_laws").insert(b.laws.map((l, i) => ({ judgment_slug: slug, law_slug: l.law, kind: l.kind, n: l.n, rule: l.rule ?? null, sort_order: i })));
    if (error) throw new Error(`judgment_laws: ${error.message}`);
  }
  await revision(req, "judgment", slug, "created");
  await logAudit(req, { action: "case.create", target: { type: "case", id: slug, label: caseLabel(row) } });
  res.status(201).json({ case: await getCase(slug, true) });
});

adminCatalogueRouter.patch("/cases/:slug", requirePermission("laws.cases"), validate("params", slugParam), validate("body", patchCase), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const b = req.body as z.infer<typeof patchCase>;
  await findJudgment(slug, true);
  const patch = {
    ...caseColumns(b),
    ...(b.paragraphs !== undefined && { paragraphs: b.paragraphs as never, paragraph_count: b.paragraphs.length }),
    ...(b.paragraphsTr !== undefined && { paragraphs_tr: b.paragraphsTr as never }),
  };
  if (!Object.keys(patch).length) throw badRequest("Nothing to change.");
  const row = unwrap(await db.from("judgments").update(patch).eq("slug", slug).select("*").single());
  await revision(req, "judgment", slug, b.paragraphs !== undefined || b.paragraphsTr !== undefined ? "text" : "info");
  await logAudit(req, { action: "case.edit", target: { type: "case", id: slug, label: caseLabel(row) }, changes: Object.keys(patch).map((field) => ({ field })) });
  res.json({ case: await getCase(slug, true) });
});

adminCatalogueRouter.post("/cases/:slug/publish", requirePermission("laws.publish"), validate("params", slugParam), validate("body", z.object({ published: z.boolean() })), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const { published } = req.body as { published: boolean };
  const row = unwrap(await db.from("judgments").update({ published }).eq("slug", slug).select("*").maybeSingle(), "That judgment");
  await revision(req, "judgment", slug, published ? "published" : "unpublished");
  await logAudit(req, { action: published ? "law.publish" : "law.unpublish", target: { type: "case", id: slug, label: caseLabel(row) } });
  res.json({ case: await getCase(slug, true) });
});

/** Replaces the provisions a judgment cites; each link added or removed is a history entry. */
adminCatalogueRouter.put("/cases/:slug/links", requirePermission("laws.link"), validate("params", slugParam), validate("body", linksPut), async (req, res) => {
  const { slug } = parsed<{ slug: string }>(req, "params");
  const { links } = req.body as z.infer<typeof linksPut>;
  const row = await findJudgment(slug, true);
  await assertLawsExist(links);
  const key = (l: { law: string; kind: string; n: string; rule?: number | null }) => `${l.law}|${l.kind}|${l.n}|${l.rule ?? 0}`;
  const before = unwrap(await db.from("judgment_laws").select("law_slug,kind,n,rule").eq("judgment_slug", slug)).map((l) => ({ law: l.law_slug, kind: l.kind, n: l.n, rule: l.rule }));
  const was = new Set(before.map(key));
  const now = new Set(links.map(key));
  const { error: del } = await db.from("judgment_laws").delete().eq("judgment_slug", slug);
  if (del) throw new Error(`judgment_laws: ${del.message}`);
  if (links.length) {
    const { error } = await db.from("judgment_laws").insert(links.map((l, i) => ({ judgment_slug: slug, law_slug: l.law, kind: l.kind, n: l.n, rule: l.rule ?? null, sort_order: i })));
    if (error) throw new Error(`judgment_laws: ${error.message}`);
  }
  const lawNames = new Map((await db.from("laws").select("slug,title,title_bn").in("slug", [...new Set([...before, ...links].map((l) => l.law))])).data?.map((l) => [l.slug, lawLabel(l)]) ?? []);
  for (const l of links.filter((l) => !was.has(key(l)))) {
    await revision(req, "judgment", slug, "linked", { n: l.n, law: l.law });
    await logAudit(req, { action: "case.link", target: { type: "case", id: slug, label: caseLabel(row) }, changes: [{ field: "law", to: lawNames.get(l.law) ?? l.law }, { field: "section", to: l.n }] });
  }
  for (const l of before.filter((l) => !now.has(key(l)))) {
    await revision(req, "judgment", slug, "unlinked", { n: l.n, law: l.law });
    await logAudit(req, { action: "case.unlink", target: { type: "case", id: slug, label: caseLabel(row) }, changes: [{ field: "law", to: lawNames.get(l.law) ?? l.law }, { field: "section", to: l.n }] });
  }
  res.json({ case: await getCase(slug, true) });
});
