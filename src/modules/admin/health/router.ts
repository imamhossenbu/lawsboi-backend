import { Router } from "express";
import { env, isProduction } from "../../../config/env.js";
import { getTransport } from "../../../lib/mail/transport.js";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { db } from "../../../lib/supabase.js";

// System health: what the API can really check right now. No sample figures; what can't be known is null.

export const adminHealthRouter = Router();
adminHealthRouter.use(requireTeam, requirePermission("health.view"));

type Status = "up" | "degraded" | "down";
const SLOW_MS = { database: 500, storage: 1500, site: 1500 };
const startedAt = Date.now();

async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; result: T | null; error: string | null }> {
  const start = performance.now();
  try {
    const result = await run();
    return { ms: Math.round(performance.now() - start), result, error: null };
  } catch (e) {
    return { ms: Math.round(performance.now() - start), result: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const status = (ok: boolean, ms: number, slow: number): Status => (!ok ? "down" : ms > slow ? "degraded" : "up");

async function checkDatabase() {
  const probe = await timed(async () => {
    const { error } = await db.from("plans").select("id", { head: true, count: "exact" });
    if (error) throw new Error(error.message);
  });
  const stats = await db.rpc("database_stats").single();
  return {
    status: status(!probe.error, probe.ms, SLOW_MS.database),
    ms: probe.ms,
    error: probe.error,
    sizeBytes: stats.data ? Number(stats.data.size_bytes) : null,
    connections: stats.data ? { used: stats.data.connections, max: stats.data.max_connections } : null,
  };
}

async function checkStorage() {
  const probe = await timed(async () => {
    const { data, error } = await db.storage.listBuckets();
    if (error) throw new Error(error.message);
    return data.map((b) => b.name);
  });
  return { status: status(!probe.error, probe.ms, SLOW_MS.storage), ms: probe.ms, error: probe.error, buckets: probe.result ?? [] };
}

async function checkMail() {
  const transport = getTransport();
  if (!transport) return { status: (isProduction ? "down" : "degraded") as Status, configured: false, ms: null, error: null };
  const probe = await timed(() => transport.verify());
  return { status: status(!probe.error, probe.ms, 5000), configured: true, ms: probe.ms, error: probe.error };
}

/** The reader site answering, as a visitor would see it. */
async function checkSite(url: string) {
  const probe = await timed(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.status;
  });
  return { url, status: status(!probe.error, probe.ms, SLOW_MS.site), ms: probe.ms, code: probe.result, error: probe.error };
}

async function counts() {
  const count = (table: "laws" | "judgments" | "profiles" | "tickets" | "help_articles" | "faqs") => db.from(table).select("*", { count: "exact", head: true }).then((r) => r.count ?? 0);
  const [laws, judgments, readers, openTickets, articles, faqs, newestLaw, newestJudgment] = await Promise.all([
    count("laws"),
    count("judgments"),
    count("profiles"),
    db.from("tickets").select("*", { count: "exact", head: true }).in("status", ["open", "progress", "waiting"]).then((r) => r.count ?? 0),
    count("help_articles"),
    count("faqs"),
    db.from("laws").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("judgments").select("decided_on, updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { laws, judgments, readers, openTickets, articles, faqs, lawsUpdated: newestLaw.data?.updated_at ?? null, judgmentsUpdated: newestJudgment.data?.updated_at ?? null };
}

/** Which settings are in place. Only whether they are set, never their values. */
function config() {
  const set = (v: string | undefined) => (v ? "set" : "missing");
  return [
    { key: "supabaseUrl", env: "SUPABASE_URL", required: true, state: set(env.SUPABASE_URL) },
    { key: "supabaseSecret", env: "SUPABASE_SECRET_KEY", required: true, state: set(env.SUPABASE_SECRET_KEY) },
    { key: "smtp", env: "SMTP_HOST / SMTP_USER / SMTP_PASS", required: isProduction, state: env.smtp ? "set" : "missing" },
    { key: "emailFrom", env: "EMAIL_FROM", required: false, state: env.EMAIL_FROM ? "set" : "default" },
    { key: "supportInbox", env: "SUPPORT_INBOX", required: false, state: env.SUPPORT_INBOX ? "set" : "default" },
    { key: "otpSecret", env: "OTP_SECRET", required: false, state: env.OTP_SECRET ? "set" : "default" },
    { key: "readerUrl", env: "READER_URL", required: false, state: "set" },
    { key: "adminUrl", env: "ADMIN_URL", required: false, state: "set" },
  ];
}

adminHealthRouter.get("/", async (_req, res) => {
  const [database, storage, mail, site, data] = await Promise.all([checkDatabase(), checkStorage(), checkMail(), checkSite(env.READER_URL), counts()]);
  const rank: Record<Status, number> = { up: 0, degraded: 1, down: 2 };
  const overall = [database.status, storage.status, mail.status, site.status].reduce<Status>((a, b) => (rank[b] > rank[a] ? b : a), "up");
  res.json({
    checkedAt: new Date().toISOString(),
    overall,
    api: { version: process.env.npm_package_version ?? "0.1.0", node: process.version, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), production: isProduction },
    database,
    storage,
    mail,
    site,
    data,
    config: config(),
  });
});
