import { z } from "zod";

// Every setting the API needs, checked once at start-up so a missing key fails loudly instead of at 3 a.m.

const list = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001").transform(list),
  READER_URL: z.url().default("http://localhost:3000"),
  ADMIN_URL: z.url().default("http://localhost:3001"),

  // Supabase is only the database: the API reaches Postgres through it with the secret key
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),

  // Sign-ins: the API signs its own access tokens (HS256) with this. `openssl rand -base64 48`
  JWT_SECRET: z.string().min(32, "JWT_SECRET needs at least 32 characters"),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().positive().default(60),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),

  // Ticket attachments on any S3-compatible storage: Backblaze B2 today (Cloudflare R2, AWS S3 work the same)
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),

  // "Continue with Google" for readers (Google Cloud → APIs & Services → Credentials → OAuth client ID, type Web
  // application, with <READER_URL>/api/auth/google/callback as an authorised redirect URI). Off when either is missing
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // The external scheduler (cron-job.org) calls /cron/tick with this as a Bearer token
  CRON_SECRET: z.string().optional(),

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

export type Env = z.infer<typeof schema> & {
  smtp: { host: string; port: number; user: string; pass: string; from: string } | null;
  s3: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string; bucket: string } | null;
};

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
  const s3 =
    e.S3_ENDPOINT && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY && e.S3_BUCKET
      ? { endpoint: e.S3_ENDPOINT, region: e.S3_REGION, accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY, bucket: e.S3_BUCKET }
      : null;
  if (!s3 && e.NODE_ENV === "production") throw new Error("S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_BUCKET are required in production.");
  if (!e.CRON_SECRET && e.NODE_ENV === "production") throw new Error("CRON_SECRET is required in production: the scheduler calls /cron/tick with it.");
  return { ...e, smtp, s3 };
}

export const env = load();
export const isProduction = env.NODE_ENV === "production";
