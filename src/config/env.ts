import { z } from "zod";

// Every setting the API needs, checked once at start-up so a missing key fails loudly instead of at 3 a.m.

const list = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001").transform(list),
  READER_URL: z.url().default("http://localhost:3000"),
  ADMIN_URL: z.url().default("http://localhost:3001"),

  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SUPPORT_INBOX: z.string().optional(),
  // Signs the one-time codes' hashes; falls back to the Supabase secret so there is always one
  OTP_SECRET: z.string().optional(),

  // Google Gemini. Without a key the assistant answers with its sources only and the panel's AI menu says so
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.5-flash-lite"),
});

export type Env = z.infer<typeof schema> & { smtp: { host: string; port: number; user: string; pass: string; from: string } | null };

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${missing}\nCopy .env.example to .env and fill it in.`);
  }
  const e = parsed.data;
  // Without a mailbox, development prints emails to the console; production refuses to start without one
  const smtp =
    e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS
      ? { host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, pass: e.SMTP_PASS, from: e.EMAIL_FROM ?? `Lawsboi <${e.SMTP_USER}>` }
      : null;
  if (!smtp && e.NODE_ENV === "production") throw new Error("SMTP_HOST, SMTP_USER and SMTP_PASS are required in production.");
  return { ...e, smtp };
}

export const env = load();
export const isProduction = env.NODE_ENV === "production";
