import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.NODE_ENV === "production" ? "info" : "debug",
  // Readable lines while developing; JSON for log collectors in production
  ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
  redact: ["req.headers.authorization", "req.headers.cookie"],
});
