import { Router } from "express";
import { z } from "zod";
import { env, isProduction } from "../../../config/env.js";
import { logger } from "../../../lib/logger.js";
import { parsed, validate } from "../../../middleware/validate.js";
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

const rank: Record<Status, number> = { up: 0, degraded: 1, down: 2 };
const worst = (statuses: Status[]) => statuses.reduce<Status>((a, b) => (rank[b] > rank[a] ? b : a), "up");

type CheckName = "database" | "storage" | "mail" | "site";
type Checks = Record<CheckName, { status: Status; ms: number | null }>;

/* ---------------------------------------------------------------- history */

const KEEP_DAYS = 30;
const PAGE_RUN_GAP_MS = 60_000;
let lastRecorded = 0;

/** Stores one run. Runs the page asks for are kept at most one a minute, so a refresh doesn't flood the table. */
async function record(overall: Status, checks: Checks, source: "schedule" | "page") {
  if (source === "page" && Date.now() - lastRecorded < PAGE_RUN_GAP_MS) return;
  lastRecorded = Date.now();
  const { error } = await db.from("health_runs").insert({ overall, checks: checks as never, source });
  if (error) logger.warn({ error: error.message }, "health run not recorded");
}

async function scheduledRun() {
  const [database, storage, mail, site] = await Promise.all([checkDatabase(), checkStorage(), checkMail(), checkSite(env.READER_URL)]);
  const checks: Checks = { database: { status: database.status, ms: database.ms }, storage: { status: storage.status, ms: storage.ms }, mail: { status: mail.status, ms: mail.ms }, site: { status: site.status, ms: site.ms } };
  await record(worst(Object.values(checks).map((c) => c.status)), checks, "schedule");
  await db.from("health_runs").delete().lt("at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString());
}

// Every five minutes while the API runs (not under test), so the history fills whether or not anyone is looking
if (env.NODE_ENV !== "test") {
  setInterval(() => void scheduledRun().catch((err) => logger.warn({ err }, "scheduled health run failed")), 5 * 60_000).unref();
}

export interface Incident {
  from: string;
  to: string;
  worst: Status;
  /** The checks that weren't up during it. */
  checks: CheckName[];
  runs: number;
}

/** Consecutive runs that weren't all up, as incidents, newest first. Runs come oldest first. */
export function incidentsOf(runs: { at: string; overall: Status; checks: Checks }[]): Incident[] {
  const out: Incident[] = [];
  let open: Incident | null = null;
  for (const r of runs) {
    if (r.overall === "up") {
      open = null;
      continue;
    }
    const failing = (Object.keys(r.checks) as CheckName[]).filter((k) => r.checks[k]?.status !== "up");
    if (!open) {
      open = { from: r.at, to: r.at, worst: r.overall, checks: failing, runs: 1 };
      out.push(open);
    } else {
      open.to = r.at;
      open.runs++;
      open.worst = worst([open.worst, r.overall]);
      open.checks = [...new Set([...open.checks, ...failing])];
    }
  }
  return out.reverse();
}

/** The last `hours` of runs (oldest first) for the response chart, and the incidents among them. */
adminHealthRouter.get("/history", validate("query", z.object({ hours: z.coerce.number().int().min(1).max(KEEP_DAYS * 24).default(24) })), async (req, res) => {
  const { hours } = parsed<{ hours: number }>(req, "query");
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data, error } = await db.from("health_runs").select("at,overall,checks,source").gte("at", since).order("at").limit(10_000);
  if (error) throw new Error(`Database: ${error.message}`);
  const runs = (data ?? []).map((r) => ({ at: r.at, overall: r.overall as Status, checks: r.checks as unknown as Checks, source: r.source }));
  res.json({ since, runs, incidents: incidentsOf(runs) });
});

adminHealthRouter.get("/", async (_req, res) => {
  const [database, storage, mail, site, data] = await Promise.all([checkDatabase(), checkStorage(), checkMail(), checkSite(env.READER_URL), counts()]);
  const overall = worst([database.status, storage.status, mail.status, site.status]);
  void record(overall, { database: { status: database.status, ms: database.ms }, storage: { status: storage.status, ms: storage.ms }, mail: { status: mail.status, ms: mail.ms }, site: { status: site.status, ms: site.ms } }, "page");
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
