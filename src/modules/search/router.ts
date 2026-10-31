import { Router } from "express";
import { z } from "zod";
import { parsed, validate } from "../../middleware/validate.js";
import { globalSearch } from "./service.js";

// GET /search?q=&limit= — the reader site's top-bar search across laws, provisions, judgments and help articles.
export const searchRouter = Router();

const query = z.object({ q: z.string().max(200).default(""), limit: z.coerce.number().int().min(1).max(10).default(5) });

searchRouter.get("/", validate("query", query), async (req, res) => {
  const { q, limit } = parsed<z.infer<typeof query>>(req, "query");
  res.set("cache-control", "public, max-age=60");
  res.json(await globalSearch(q, limit));
});
