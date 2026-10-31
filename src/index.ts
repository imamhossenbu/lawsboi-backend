import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { verifyTransport } from "./lib/mail/transport.js";
import { tick } from "./modules/cron/service.js";

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "Lawsboi API listening");
  void verifyTransport();
});

// In production cron-job.org calls /cron/tick. Without CRON_SECRET (development) the API ticks itself, so
// scheduled announcements and health runs still happen locally.
if (!env.CRON_SECRET && env.NODE_ENV === "development") {
  setInterval(() => void tick().catch(() => undefined), 60_000).unref();
  logger.info("CRON_SECRET not set: running the scheduled tick in-process every minute");
}

// Finish in-flight requests on a deploy's SIGTERM instead of dropping them
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
