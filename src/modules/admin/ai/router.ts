import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { AiError } from "../../../lib/ai/gemini.js";
import { aiConfigured } from "../../../lib/ai/gemini.js";
import { badRequest, forbidden, HttpError } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import { requireTeam } from "../../../middleware/auth.js";
import { validate } from "../../../middleware/validate.js";
import { can, type Action } from "../team/permissions.js";
import { announcementBody, articleBody, assistBody, pageBody, sectionBody, tidyBody, translateBody } from "./schemas.js";
import * as ai from "./service.js";

// Team: AI help in the panel. Every call is recorded in ai_usage (who, what for, tokens, ok); nothing is saved
// to the content itself — the panel shows the result for the editor to accept. Errors carry details.ai:
// "notConnected" (no key), "unavailable" (slow or down), "invalid" (a reply that didn't fit), "blocked", "empty".

export const adminAiRouter = Router();
adminAiRouter.use(requireTeam);

/** Any one of these actions is enough (a translator in the laws team or a content editor). */
const requireAny =
  (...actions: Action[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!actions.some((a) => can(req.member!, a))) return next(forbidden(`You need one of: ${actions.join(", ")}.`));
    next();
  };

const caller = (req: Request) => ({ memberId: req.member!.id });

/** A model failure as an answer the panel can show. */
function aiFailure(err: AiError) {
  const ai = err.code === "not_configured" ? "notConnected" : err.code;
  if (err.code === "blocked") return badRequest(err.message, { ai });
  return new HttpError("unavailable", err.message, { ai });
}

/** Wraps a handler so model errors become 503/400 with details.ai instead of 500s. */
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err instanceof AiError ? aiFailure(err) : err);
    }
  };

adminAiRouter.get("/status", (_req, res) => {
  res.json({ connected: aiConfigured() });
});

/** The month's AI use for the panel's health page: calls, failures and tokens by purpose. */
adminAiRouter.get("/usage", requireAny("health.view", "assistant.view"), async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await db.from("ai_usage").select("purpose,ok,total_tokens,ms").gte("at", since).limit(20_000);
  const by: Record<string, { calls: number; failed: number; tokens: number; avgMs: number }> = {};
  for (const r of data ?? []) {
    const b = (by[r.purpose] ??= { calls: 0, failed: 0, tokens: 0, avgMs: 0 });
    b.calls++;
    if (!r.ok) b.failed++;
    b.tokens += r.total_tokens;
    b.avgMs += r.ms;
  }
  for (const b of Object.values(by)) b.avgMs = Math.round(b.avgMs / Math.max(1, b.calls - b.failed));
  res.json({ since, connected: aiConfigured(), purposes: by });
});

/* -------------------------------------------------------------- fields */

adminAiRouter.post("/translate", requireAny("content.edit", "laws.translate", "announcements.write"), validate("body", translateBody), handle(async (req, res) => {
  const b = req.body as z.infer<typeof translateBody>;
  const texts = await ai.translateMany(b.texts ?? [b.text!], b.from, b.to, b.kind, caller(req));
  res.json(b.texts ? { texts } : { text: texts[0] });
}));

adminAiRouter.post("/tidy", requireAny("content.edit", "laws.edit", "announcements.write"), validate("body", tidyBody), handle(async (req, res) => {
  const b = req.body as z.infer<typeof tidyBody>;
  res.json({ text: await ai.tidy(b.text, b.lang, caller(req)) });
}));

/** The one-field AI menu: { task: toBn | toEn | polish, text: { en, bn } } → { text: { en, bn } }. */
adminAiRouter.post("/assist", requireAny("content.edit", "announcements.write"), validate("body", assistBody), handle(async (req, res) => {
  const b = req.body as z.infer<typeof assistBody>;
  res.json({ text: await ai.assist(b.task, b.text, caller(req)) });
}));

/* -------------------------------------------------------------- drafts */

adminAiRouter.post("/draft/article", requireAny("content.edit"), validate("body", articleBody), handle(async (req, res) => {
  const b = req.body as z.infer<typeof articleBody>;
  res.json({ draft: await ai.draftArticle(b.mode, b.brief, b.current, caller(req)) });
}));

adminAiRouter.post("/draft/page", requireAny("content.edit"), validate("body", pageBody), handle(async (req, res) => {
  const b = req.body as z.infer<typeof pageBody>;
  res.json({ sections: await ai.draftPage(b.slug, b.mode, b.brief, b.sections, caller(req)) });
}));

adminAiRouter.post("/draft/announcement", requireAny("announcements.write"), validate("body", announcementBody), handle(async (req, res) => {
  const b = req.body as z.infer<typeof announcementBody>;
  res.json({ draft: await ai.draftAnnouncement(b.mode, b.brief, b.topic, b.current, caller(req)) });
}));

/* ---------------------------------------------------------------- laws */

const MAX_BYTES = 10 * 1024 * 1024;
const pages = multer({
  storage: multer.memoryStorage(),
  limits: { files: 20, fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.mimetype)) cb(null, true);
    else cb(badRequest("Photos (PNG, JPEG, WebP) or one PDF only.", { files: "type" }));
  },
}).array("files", 20);

adminAiRouter.post("/laws/read", requireAny("laws.add"), pages, handle(async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest("Add the photos or the PDF of the law.", { files: "required" });
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_BYTES) throw badRequest("The files come to more than 10 MB together.", { files: "size" });
  if (files.some((f) => f.mimetype === "application/pdf") && files.length > 1) throw badRequest("Send one PDF, or photos — not both.", { files: "mixed" });
  res.json(await ai.readLaw(files, caller(req)));
}));

adminAiRouter.post("/laws/translate-section", requireAny("laws.translate"), validate("body", sectionBody), handle(async (req, res) => {
  const b = req.body as z.infer<typeof sectionBody>;
  res.json({ translation: await ai.translateSection(b.slug, b.n, b.to, caller(req)) });
}));
