import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { isProduction } from "../config/env.js";

/** Every error ends here: known ones answer with their status and code; the rest are logged and answered as 500. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // multer's limits land here with a code but no status
  if (typeof err === "object" && err && "code" in err && typeof (err as { code: unknown }).code === "string" && (err as { code: string }).code.startsWith("LIMIT_")) {
    res.status(400).json({ error: { code: "bad_request", message: "Up to 3 files of 2 MB each: PNG, JPEG or PDF." } });
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: { code: "bad_request", message: "The request body isn't valid JSON." } });
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, "unhandled error");
  res.status(500).json({
    error: { code: "internal", message: isProduction ? "Something went wrong on our side." : (err as Error)?.message ?? "Unknown error" },
  });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "not_found", message: "No such route." } });
}
