import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";

// One SMTP connection pool for the process. With Gmail: host smtp.gmail.com, port 465 and an app password.

let transporter: Transporter | null = null;

export function getTransport(): Transporter | null {
  if (!env.smtp) return null;
  transporter ??= nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
    pool: true,
    maxConnections: 3,
  });
  return transporter;
}

/** Checks the mailbox credentials at start-up so a wrong app password shows up in the log, not in a lost email. */
export async function verifyTransport() {
  const t = getTransport();
  if (!t) {
    logger.warn("SMTP isn't set: emails are written to the console instead of being sent");
    return;
  }
  try {
    await t.verify();
    logger.info({ host: env.smtp?.host, user: env.smtp?.user }, "SMTP ready");
  } catch (err) {
    logger.error({ err }, "SMTP sign-in failed: check SMTP_USER and SMTP_PASS (Gmail needs an app password)");
  }
}
