import { z } from "zod";
import { sectionSchema, textSchema } from "../../content/shared.js";

// Request bodies and the shapes the model must reply in. Reply schemas are also what the model is held to
// (structured output), and every reply is validated against them before it reaches the panel.

export const lang = z.enum(["en", "bn"]);
export const draftMode = z.enum(["write", "translate", "polish", "add"]);
export type DraftMode = z.infer<typeof draftMode>;
export type Text = z.infer<typeof textSchema>;

const brief = z.string().trim().max(4_000).default("");

/* --------------------------------------------------------------- requests */

export const translateBody = z
  .object({
    text: z.string().max(20_000).optional(),
    texts: z.array(z.string().max(20_000)).max(200).optional(),
    from: lang,
    to: lang,
    kind: z.enum(["legal", "content", "ui"]).default("content"),
  })
  .refine((b) => b.text !== undefined || b.texts !== undefined, "Send text or texts.")
  .refine((b) => b.from !== b.to, "Pick two different languages.");

export const tidyBody = z.object({ text: z.string().trim().min(1).max(20_000), lang });

/** The panel's one-field AI menu: translate an empty side, or tidy both. */
export const assistBody = z.object({ task: z.enum(["toBn", "toEn", "polish"]), text: textSchema });

export const articleDraft = z.object({ title: textSchema, summary: textSchema, steps: z.array(textSchema) });
export const articleBody = z.object({ mode: draftMode.default("write"), brief, current: articleDraft.optional() });

export const pageBody = z.object({
  slug: z.enum(["privacy", "disclaimer", "about"]),
  mode: draftMode.default("write"),
  brief,
  sections: z.array(sectionSchema).max(60).default([]),
});

export const announcementDraft = z.object({ title: textSchema, body: textSchema });
export const announcementBody = z.object({
  mode: draftMode.default("write"),
  brief,
  topic: z.enum(["legal", "cases", "saved", "ai", "billing", "product"]).default("product"),
  current: announcementDraft.optional(),
});

export const sectionBody = z.object({ slug: z.string().min(1).max(200), n: z.string().min(1).max(20), to: lang.optional() });

/* ---------------------------------------------------------------- replies */

export const stringsReply = z.object({ items: z.array(z.string()) });

const step = z.object({ en: z.string().min(1), bn: z.string().min(1) });
export const articleReply = z.object({
  title: step,
  summary: step,
  steps: z.array(step).min(1).max(12),
  tryHref: z.string(),
  icon: z.string(),
});

export const sectionsReply = z.object({ sections: z.array(sectionSchema).max(60) });
export const announcementReply = z.object({ title: step, body: step });

const block = z.object({ kind: z.enum(["para", "clause", "tail"]), mark: z.string().optional(), text: z.string() });
export const lawReadReply = z.object({
  law: z.object({
    title: z.string(),
    actNo: z.string(),
    year: z.number().int().nullable(),
    type: z.enum(["act", "ordinance", "po", "constitution"]),
    language: lang,
    date: z.string(),
    longTitle: z.string(),
    preamble: z.string(),
  }),
  parts: z.array(
    z.object({
      title: z.string(),
      sections: z.array(z.object({ n: z.string(), title: z.string(), blocks: z.array(block), unsure: z.array(z.string()), page: z.number().int().nullable() })),
    }),
  ),
});
export type LawRead = z.infer<typeof lawReadReply>;
