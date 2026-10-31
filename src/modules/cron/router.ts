import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { env } from "../../config/env.js";
import { unauthorized } from "../../lib/errors.js";
import { tick } from "./service.js";

// The scheduler's door: GET or POST /cron/tick with "Authorization: Bearer <CRON_SECRET>". The secret goes in a
// header, never the URL, so it stays out of request logs.

export const cronRouter = Router();

const digest = (s: string) => createHash("sha256").update(s).digest();

const requireCronSecret: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!env.CRON_SECRET || !given || !timingSafeEqual(digest(given), digest(env.CRON_SECRET))) throw unauthorized("Wrong cron secret.");
  next();
};

cronRouter.all("/tick", requireCronSecret, async (_req, res) => {
  const result = await tick();
  res.status(result.errors.length ? 500 : 200).json(result);
});
