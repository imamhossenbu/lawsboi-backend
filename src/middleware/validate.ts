import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { badRequest } from "../lib/errors.js";

// Checks a request part against a schema and keeps the parsed value, so handlers get typed, trimmed data.

type Part = "body" | "query" | "params";

type Parsed = Request & { parsed?: Partial<Record<Part, unknown>> };

export function validate<T>(part: Part, schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const details: Record<string, string> = {};
      for (const issue of result.error.issues) details[issue.path.join(".") || part] = issue.message;
      return next(badRequest("Check the highlighted fields.", details));
    }
    // Express 5 exposes req.query as a getter, so every part is kept in one place of our own
    ((req as Parsed).parsed ??= {})[part] = result.data;
    if (part === "body") req.body = result.data;
    next();
  };
}

/** The parsed value of a part, after `validate(part, …)` ran. */
export const parsed = <T>(req: Request, part: Part): T => (req as Parsed).parsed?.[part] as T;
