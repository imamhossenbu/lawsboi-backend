import { z } from "zod";
import type { Tables } from "../../types/database.js";

// Shapes and mappers the public content routes and the admin's content, announcement and flag routes share.
// Editorial text is stored once per language and travels as { en, bn }.

export type Text = { en: string; bn: string };
export const text = (en: string, bn: string | null | undefined): Text => ({ en, bn: bn ?? en });
export const textSchema = z.object({ en: z.string().max(5000), bn: z.string().max(5000) });
export const langs = ["en", "bn"] as const;
export type Lang = (typeof langs)[number];

/** Languages some text is still empty in. Readers see one language at a time, so publishing needs both. */
export const gaps = (texts: (Text | undefined)[]): Lang[] => langs.filter((l) => texts.some((t) => t && !t[l].trim()));

/** "How to search for a law" → "how-to-search-for-a-law", unique among `taken`. */
export function slugify(value: string, taken: Set<string>, fallback = "item") {
  const base = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || fallback;
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

/* --------------------------------------------------------------- articles */

export const articleIcons = ["search", "sparkles", "bookmark", "card", "crown", "download", "key", "file"] as const;
export const tryPages = [
  "/dashboard/laws", "/dashboard/acts", "/dashboard/cases", "/dashboard/assistant", "/dashboard/library",
  "/dashboard/history", "/dashboard/plan", "/dashboard/settings", "/dashboard/settings/password",
] as const;
export const contentStatuses = ["draft", "published"] as const;

export type ArticleRow = Tables<"help_articles">;

export function articleOf(a: ArticleRow, reads30d = 0) {
  const votes = a.helpful_yes + a.helpful_no;
  return {
    slug: a.slug,
    title: text(a.title, a.title_bn),
    summary: text(a.summary, a.summary_bn),
    steps: (a.steps as Text[]) ?? [],
    tryHref: a.try_href,
    icon: a.icon,
    status: a.status,
    updated: a.updated_at,
    reads: reads30d,
    /** The share of "Was this helpful?" votes that said yes, as a whole percentage; 0 without votes. */
    helpful: votes ? Math.round((a.helpful_yes / votes) * 100) : 0,
    votes,
  };
}

export const articleGaps = (a: { title: Text; summary: Text; steps: Text[] }) => gaps([a.title, a.summary, ...a.steps]);

/* ------------------------------------------------------------------- faqs */

export const faqPlaces = ["help", "pricing", "contact"] as const;
export const faqTopics = ["account", "billing", "content", "ai", "saved"] as const;
export type FaqRow = Tables<"faqs">;

export function faqOf(f: FaqRow) {
  return {
    id: f.id,
    place: f.place as (typeof faqPlaces)[number],
    topic: (f.topic ?? undefined) as (typeof faqTopics)[number] | undefined,
    q: text(f.question, f.question_bn),
    a: text(f.answer, f.answer_bn),
    status: f.status,
    updated: f.updated_at,
  };
}

export const faqGaps = (f: { q: Text; a: Text }) => gaps([f.q, f.a]);

/* ------------------------------------------------------------------ pages */

/** One block of a page; which fields it has depends on the page (legal sections vs the about page's bands). */
export const sectionSchema = z.object({
  id: z.string().min(1).max(60),
  eyebrow: textSchema.optional(),
  title: textSchema,
  accent: textSchema.optional(),
  body: z.array(textSchema),
  list: z.array(textSchema).optional(),
  after: z.array(textSchema).optional(),
  items: z.array(z.object({ title: textSchema, text: textSchema })).optional(),
  quote: textSchema.optional(),
});
export type PageSection = z.infer<typeof sectionSchema>;
export const pageSlugs = ["privacy", "disclaimer", "about"] as const;
export type PageRow = Tables<"site_pages">;

export const sectionTexts = (s: PageSection): Text[] =>
  [s.eyebrow, s.title, s.accent, ...s.body, ...(s.list ?? []), ...(s.after ?? []), ...(s.items ?? []).flatMap((x) => [x.title, x.text]), s.quote].filter((x): x is Text => !!x);
export const pageGaps = (sections: PageSection[]) => gaps(sections.flatMap(sectionTexts));

export function pageOf(p: PageRow) {
  return { slug: p.slug as (typeof pageSlugs)[number], path: p.path, fixed: p.fixed, sections: (p.sections as PageSection[]) ?? [], updated: p.updated_at };
}

/* ------------------------------------------------------------------ flags */

export const flagPlans = ["free", "researcher", "professional"] as const;
export const accessLevels = ["full", "limited", "none"] as const;
export type FlagRow = Tables<"feature_flags">;
export type FlagEventRow = Tables<"feature_flag_events">;
export type Access = Record<(typeof flagPlans)[number], (typeof accessLevels)[number]>;
export type Allowance = Record<(typeof flagPlans)[number], number | null>;

export const accessSchema = z.object({ free: z.enum(accessLevels), researcher: z.enum(accessLevels), professional: z.enum(accessLevels) });
export const allowanceSchema = z.object({ free: z.number().int().min(0).nullable(), researcher: z.number().int().min(0).nullable(), professional: z.number().int().min(0).nullable() });

/** What the reader site needs to gate a feature. */
export function flagOf(f: FlagRow) {
  return {
    id: f.id,
    group: f.group,
    on: f.enabled,
    access: f.access as Access,
    allowance: (f.allowance as Allowance | null) ?? undefined,
    per: (f.per as "month" | "total" | null) ?? undefined,
    rollout: f.rollout ?? undefined,
    pages: f.pages,
    reader: f.reader_today,
    updated: f.updated_at,
  };
}

/* ---------------------------------------------------------- announcements */

export const topics = ["legal", "cases", "saved", "ai", "billing", "product"] as const;
/** The API speaks the reader's names (inApp); the database stores in_app. */
export const channels = ["inApp", "email", "banner"] as const;
export type Channel = (typeof channels)[number];
export type DbChannel = "in_app" | "email" | "banner";
export const toDbChannel = (c: Channel): DbChannel => (c === "inApp" ? "in_app" : c);
export const fromDbChannel = (c: DbChannel): Channel => (c === "in_app" ? "inApp" : c);
export const linkPages = [
  "/dashboard", "/dashboard/laws", "/dashboard/acts", "/dashboard/cases", "/dashboard/assistant", "/dashboard/library",
  "/dashboard/plan", "/dashboard/settings/notifications", "/dashboard/help", "/pricing",
] as const;

export type AnnouncementRow = Tables<"announcements">;
export type Delivery = { reached: Partial<Record<Channel, number>>; opened: Partial<Record<Channel, number>> };

/** "live" while a sent banner is up, "ended" once it's down, "waiting" before sending; null without a banner. */
export function bannerState(a: Pick<AnnouncementRow, "channels" | "status" | "banner_ended" | "banner_until">, now = Date.now()) {
  if (!a.channels.includes("banner")) return null;
  if (a.status !== "sent") return "waiting" as const;
  if (a.banner_ended || (a.banner_until && Date.parse(a.banner_until) <= now)) return "ended" as const;
  return "live" as const;
}

export function announcementOf(a: AnnouncementRow, delivery?: Delivery) {
  return {
    id: a.public_id,
    title: text(a.title, a.title_bn),
    body: text(a.body, a.body_bn),
    topic: a.topic,
    plans: a.plan_ids,
    channels: a.channels.map(fromDbChannel),
    link: a.link,
    status: a.status,
    at: a.at,
    sentAt: a.sent_at,
    bannerUntil: a.banner_until,
    bannerEnded: a.banner_ended,
    banner: bannerState(a),
    delivery: a.status === "sent" ? (delivery ?? { reached: {}, opened: {} }) : undefined,
  };
}
