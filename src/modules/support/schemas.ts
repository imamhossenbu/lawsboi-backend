import { z } from "zod";

export const categories = ["account", "billing", "content", "ai", "technical", "other"] as const;
export const priorities = ["low", "medium", "high", "urgent"] as const;
export const statuses = ["open", "progress", "waiting", "resolved", "closed"] as const;

export const ALLOWED_TYPES = ["image/png", "image/jpeg", "application/pdf"];
export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const ticketIdParam = z.object({ id: z.string().regex(/^TKT-\d{6}$/, "Not a ticket id.") });

/** The reader's new-ticket form (multipart: fields plus up to three files). */
export const newTicketSchema = z.object({
  subject: z.string().trim().min(3, "Say what it's about.").max(160),
  category: z.enum(categories),
  priority: z.enum(priorities).default("medium"),
  message: z.string().trim().min(1, "Describe the problem.").max(10_000),
  lang: z.enum(["en", "bn"]).optional(),
});

export const readerMessageSchema = z.object({ message: z.string().trim().min(1).max(10_000) });

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});
