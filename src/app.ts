import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { adminAuthRouter } from "./modules/admin/auth/router.js";
import { teamRouter } from "./modules/admin/team/router.js";
import { adminTicketsRouter } from "./modules/admin/tickets/router.js";
import { usersRouter } from "./modules/admin/users/router.js";
import { authRouter } from "./modules/auth/router.js";
import { meRouter } from "./modules/me/router.js";
import { supportRouter } from "./modules/support/router.js";

/** The Express app, apart from listening, so tests can mount it. */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Behind Vercel, Railway, Fly or nginx the client's address is in X-Forwarded-For
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/health" },
      // One line per request: method, path, status and time; headers and bodies stay out of the log
      serializers: { req: (r) => ({ method: r.method, url: r.url }), res: (r) => ({ status: r.statusCode }) },
    }),
  );

  app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Readers
  app.use("/auth", authRouter);
  app.use("/me", meRouter);
  app.use("/support", supportRouter);

  // The admin panel's team
  app.use("/admin/auth", adminAuthRouter);
  app.use("/admin/team", teamRouter);
  app.use("/admin/users", usersRouter);
  app.use("/admin/tickets", adminTicketsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
