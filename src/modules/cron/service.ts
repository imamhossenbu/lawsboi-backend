import { deleteExpiredSessions } from "../../lib/accounts.js";
import { logger } from "../../lib/logger.js";
import { db } from "../../lib/supabase.js";
import { sendDueAnnouncements } from "../admin/announcements/service.js";
import { scheduledHealthRun } from "../admin/health/router.js";

// The API's scheduled work, run by one call: an external scheduler (cron-job.org) hits /cron/tick every few
// minutes. The call itself keeps a free Render instance from sleeping, and the queries keep a free Supabase project
// from being paused for inactivity. In development, without CRON_SECRET, index.ts runs the same tick on a timer.

export interface TickResult {
  at: string;
  ms: number;
  database: boolean;
  announcements: number;
  health: boolean;
  sessionsDeleted: number;
  codesDeleted: number;
  errors: string[];
}

let running: Promise<TickResult> | null = null;

/** One tick. Calls that arrive while one is running share its result instead of doubling the work. */
export function tick(): Promise<TickResult> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

async function step<T>(name: string, errors: string[], fallback: T, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    logger.warn({ err, step: name }, "cron step failed");
    errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

async function run(): Promise<TickResult> {
  const start = Date.now();
  const errors: string[] = [];
  const database = await step("database", errors, false, async () => {
    const { error } = await db.from("plans").select("id", { head: true, count: "exact" });
    if (error) throw new Error(error.message);
    return true;
  });
  const announcements = await step("announcements", errors, 0, sendDueAnnouncements);
  const health = await step("health", errors, false, scheduledHealthRun);
  const sessionsDeleted = await step("sessions", errors, 0, deleteExpiredSessions);
  // Codes live ten minutes; a day's grace keeps the resend limit's history
  const codesDeleted = await step("codes", errors, 0, async () => {
    const { count } = await db.from("email_otps").delete({ count: "exact" }).lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());
    return count ?? 0;
  });
  const result = { at: new Date(start).toISOString(), ms: Date.now() - start, database, announcements, health, sessionsDeleted, codesDeleted, errors };
  logger.info(result, "cron tick");
  return result;
}
