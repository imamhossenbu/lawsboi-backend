import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

// One-time codes for verifying an email (sign-up) or proving it before a password reset. The database keeps only
// an HMAC of the code, keyed with a server secret, so a leaked table can't be brute-forced offline.

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

const secret = () => env.OTP_SECRET ?? env.SUPABASE_SECRET_KEY;

export const newCode = () => String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

export const hashCode = (email: string, purpose: string, code: string) =>
  createHmac("sha256", secret()).update(`${email.toLowerCase()}\n${purpose}\n${code}`).digest("hex");

export function codeMatches(email: string, purpose: string, code: string, hash: string) {
  const a = Buffer.from(hashCode(email, purpose, code));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const isCodeShaped = (code: string) => new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
