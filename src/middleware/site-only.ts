import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { forbidden } from "../lib/errors.js";

// The catalogue's full text (sections, Orders, whole acts, judgments, PDFs, search snippets) is served only to the
// reader site's server, which sends SITE_KEY in X-Site-Key: browsers never see the API's answers in their network
// tab and nobody can copy the catalogue by calling the API directly. Off while SITE_KEY is unset (and in tests).

const key = env.SITE_KEY ? Buffer.from(env.SITE_KEY) : null;

export function fromSite(req: Request) {
  if (!key || env.NODE_ENV === "test") return true;
  const sent = Buffer.from(String(req.headers["x-site-key"] ?? ""));
  return sent.length === key.length && timingSafeEqual(sent, key);
}

export function siteOnly(req: Request, _res: Response, next: NextFunction) {
  if (fromSite(req)) return next();
  next(forbidden("This is served to the Lawsboi site only."));
}
