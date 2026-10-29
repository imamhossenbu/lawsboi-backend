import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { getTransport } from "./transport.js";

export type MailResult = "sent" | "logged" | "failed";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

/** Sends one email. Without SMTP, development writes it to the log and reports "logged"; sending never throws,
 * so a mail failure can't undo the action that caused it — callers tell the person what happened instead. */
export async function sendMail(mail: Mail): Promise<MailResult> {
  const transport = getTransport();
  if (!transport || !env.smtp) {
    logger.info({ to: mail.to, subject: mail.subject }, `email (not sent)\n${mail.text}`);
    return "logged";
  }
  try {
    const info = await transport.sendMail({ from: env.smtp.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, replyTo: mail.replyTo });
    logger.info({ to: mail.to, subject: mail.subject, id: info.messageId }, "email sent");
    return "sent";
  } catch (err) {
    logger.error({ err, to: mail.to, subject: mail.subject }, "email failed");
    return "failed";
  }
}
