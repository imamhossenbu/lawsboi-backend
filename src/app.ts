import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { adminAiRouter } from "./modules/admin/ai/router.js";
import { adminAnnouncementsRouter } from "./modules/admin/announcements/router.js";
import { adminAssistantRouter } from "./modules/admin/assistant/router.js";
import { adminAuditRouter } from "./modules/admin/audit/router.js";
import { adminAuthRouter } from "./modules/admin/auth/router.js";
import { adminBillingRouter } from "./modules/admin/billing/router.js";
import { adminCatalogueRouter } from "./modules/admin/catalogue/router.js";
import { adminContentRouter } from "./modules/admin/content/router.js";
import { adminDashboardRouter } from "./modules/admin/dashboard/router.js";
import { adminFlagsRouter } from "./modules/admin/flags/router.js";
import { adminHealthRouter } from "./modules/admin/health/router.js";
import { adminSettingsRouter } from "./modules/admin/settings/router.js";
import { teamRouter } from "./modules/admin/team/router.js";
import { adminTicketsRouter } from "./modules/admin/tickets/router.js";
import { usersRouter } from "./modules/admin/users/router.js";
import { assistantRouter } from "./modules/assistant/router.js";
import { authRouter } from "./modules/auth/router.js";
import { billingRouter } from "./modules/billing/router.js";
import { catalogueRouter } from "./modules/catalogue/router.js";
import { contentRouter } from "./modules/content/router.js";
import { cronRouter } from "./modules/cron/router.js";
import { libraryRouter } from "./modules/library/router.js";
import { meRouter } from "./modules/me/router.js";
import { supportRouter } from "./modules/support/router.js";

/** The Express app, apart from listening, so tests can mount it. */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Behind Render, Vercel, Railway, Fly or nginx the client's address is in X-Forwarded-For
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/cron/tick" },
      // One line per request: method, path, status and time; headers and bodies stay out of the log
      serializers: { req: (r) => ({ method: r.method, url: r.url }), res: (r) => ({ status: r.statusCode }) },
    }),
  );

  app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // The external scheduler (cron-job.org): scheduled work, and keeping the server and the database awake
  app.use("/cron", cronRouter);

  // Public and readers
  app.use("/auth", authRouter);
  app.use("/me", meRouter);
  app.use("/support", supportRouter);
  app.use("/catalogue", catalogueRouter);
  app.use("/assistant", assistantRouter);
  app.use("/billing", billingRouter);
  app.use("/library", libraryRouter);
  app.use("/content", contentRouter);

  // The admin panel's team
  app.use("/admin/auth", adminAuthRouter);
  app.use("/admin/team", teamRouter);
  app.use("/admin/users", usersRouter);
  app.use("/admin/tickets", adminTicketsRouter);
  app.use("/admin/catalogue", adminCatalogueRouter);
  app.use("/admin/assistant", adminAssistantRouter);
  app.use("/admin/billing", adminBillingRouter);
  app.use("/admin/dashboard", adminDashboardRouter);
  app.use("/admin/audit", adminAuditRouter);
  app.use("/admin/settings", adminSettingsRouter);
  app.use("/admin/health", adminHealthRouter);
  app.use("/admin/content", adminContentRouter);
  app.use("/admin/announcements", adminAnnouncementsRouter);
  app.use("/admin/flags", adminFlagsRouter);
  app.use("/admin/ai", adminAiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
