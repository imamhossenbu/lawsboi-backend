import { badRequest, conflict, HttpError, unauthorized } from "../../lib/errors.js";
import { sendMail, type MailResult } from "../../lib/mail/send.js";
import { otpMail } from "../../lib/mail/templates/otp.js";
import { codeMatches, hashCode, newCode, OTP_MAX_ATTEMPTS, OTP_RESEND_MS, OTP_TTL_MS } from "../../lib/otp.js";
import { accountByEmail, checkPassword, createAccount, deleteAccountRow, endAllSessions, rotateSession, startSession, updateAccount, type AccountMeta, type Tokens } from "../../lib/accounts.js";
import { db } from "../../lib/supabase.js";
import type { Lang, OtpPurpose } from "../../types/rows.js";

// Readers' accounts. The `accounts` table keeps the credentials (lib/accounts.ts); this module runs the email codes
// around them so that sign-up and password resets go through our own mailbox, in the reader's language.

export type { Tokens };

/* ------------------------------------------------------------------ codes */

async function latestCode(email: string, purpose: OtpPurpose) {
  const { data } = await db
    .from("email_otps")
    .select("*")
    .eq("email", email)
    .eq("purpose", purpose)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Makes a fresh code, stores its hash and emails it. One a minute per address and purpose. */
export async function issueCode(email: string, purpose: OtpPurpose, lang: Lang): Promise<MailResult> {
  const last = await latestCode(email, purpose);
  if (last && Date.now() - Date.parse(last.created_at) < OTP_RESEND_MS) {
    throw new HttpError("too_many_requests", "A code was just sent. Wait a minute before asking for another.");
  }
  const code = newCode();
  await db.from("email_otps").insert({
    email,
    purpose,
    code_hash: hashCode(email, purpose, code),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });
  return sendMail({ to: email, ...otpMail(code, purpose, lang) });
}

/** Finds the live code for this address and checks what was typed. Five wrong tries kill the code; an expired
 * one needs a resend. Returns the row so the caller can consume it. */
async function checkCode(email: string, purpose: OtpPurpose, code: string) {
  const row = await latestCode(email, purpose);
  if (!row) throw badRequest("Ask for a new code first.", { code: "expired" });
  if (Date.parse(row.expires_at) < Date.now()) throw badRequest("That code has expired. Ask for a new one.", { code: "expired" });
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw badRequest("Too many wrong tries. Ask for a new code.", { code: "expired" });
  if (!codeMatches(email, purpose, code, row.code_hash)) {
    await db.from("email_otps").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    throw badRequest("That code isn't right.", { code: "wrong" });
  }
  return row;
}

/** Checks a code without using it up: the reset form confirms the code on one screen and sets the password on
 * the next, and the second step checks it again. */
export async function peekCode(email: string, purpose: OtpPurpose, code: string) {
  await checkCode(email, purpose, code);
}

/** Checks a code and uses it up. */
export async function consumeCode(email: string, purpose: OtpPurpose, code: string) {
  const row = await checkCode(email, purpose, code);
  await db.from("email_otps").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
}

/* --------------------------------------------------------------- accounts */

/** A reader's account by email. Team accounts aren't found here, so readers' forms can't touch them. */
async function findReaderAccount(email: string) {
  const account = await accountByEmail(email);
  if (!account) return null;
  const { data: profile } = await db.from("profiles").select("id").eq("id", account.id).maybeSingle();
  return profile ? account : null;
}

const metaOf = (a: { meta: unknown }) => (a.meta ?? {}) as AccountMeta;

/** Creates the account unconfirmed (the database trigger adds the profile) and emails the code. Someone who
 * signed up before but never verified gets a fresh code instead of an error. */
export async function signup(input: { name: string; email: string; password: string; lang: Lang }) {
  const existing = await accountByEmail(input.email);
  if (existing) {
    const { data: team } = await db.from("team_members").select("id").eq("id", existing.id).maybeSingle();
    if (team) throw conflict("That email belongs to a team account.", { email: "taken" });
    if (existing.email_confirmed_at) throw conflict("An account with this email already exists. Sign in instead.", { email: "taken" });
    // Keep what they typed this time, in case the first attempt had a typo in the name or password
    await updateAccount(existing.id, { password: input.password, meta: { ...metaOf(existing), name: input.name, lang: input.lang } });
    await db.from("profiles").update({ name: input.name, lang: input.lang }).eq("id", existing.id);
  } else {
    await createAccount({ email: input.email, password: input.password, confirmed: false, meta: { kind: "reader", name: input.name, lang: input.lang } }).catch((e: unknown) => {
      if (e instanceof HttpError) throw conflict("An account with this email already exists. Sign in instead.", { email: "taken" });
      throw e;
    });
  }
  const mail = await issueCode(input.email, "signup", input.lang);
  return { mail };
}

/** The code checks out: confirm the email so the password works. */
export async function verifySignup(email: string, code: string) {
  const account = await findReaderAccount(email);
  if (!account) throw badRequest("Start again: that sign-up wasn't found.", { email: "unknown" });
  await consumeCode(email, "signup", code);
  await updateAccount(account.id, { confirmed: true });
}

/** Checks a reader's password and opens a session. Team accounts sign in through /admin/auth instead. */
export async function login(email: string, password: string): Promise<{ tokens: Tokens; userId: string }> {
  const checked = await checkPassword(email, password);
  const { data: profile } = checked ? await db.from("profiles").select("id").eq("id", checked.id).maybeSingle() : { data: null };
  const account = profile ? checked : null;
  if (!account) throw new HttpError("unauthorized", "Wrong email or password.", { password: "wrong" });
  if (!account.email_confirmed_at) throw new HttpError("unauthorized", "Verify your email first: we've sent you a code.", { email: "unverified" });
  if (account.disabled) throw new HttpError("unauthorized", "This account has been deactivated.");
  return { tokens: await startSession(account.id), userId: account.id };
}

export async function refresh(refreshToken: string): Promise<Tokens> {
  const tokens = await rotateSession(refreshToken);
  if (!tokens) throw unauthorized("Your session has expired. Sign in again.");
  return tokens;
}

/** Ends every session of this account, on every device. */
export async function logout(accountId: string) {
  await endAllSessions(accountId);
}

/** Starts a reset. Answers the same whether or not the address exists, so the form can't be used to list accounts. */
export async function forgotPassword(email: string, lang: Lang): Promise<MailResult | "unknown"> {
  const account = await findReaderAccount(email);
  if (!account) return "unknown";
  return issueCode(email, "reset", metaOf(account).lang === "bn" ? "bn" : lang);
}

export async function resetPassword(email: string, code: string, password: string) {
  const account = await findReaderAccount(email);
  if (!account) throw badRequest("That code isn't right.", { code: "wrong" });
  await consumeCode(email, "reset", code);
  // Proving the email by code also confirms it
  await updateAccount(account.id, { password, confirmed: true });
  // Whoever might have had the old password is signed out
  await endAllSessions(account.id);
}

/** Deletes the account for good: the profile, tickets and saved items cascade with it. */
export async function deleteAccount(email: string, userId: string, password: string) {
  const account = await checkPassword(email, password);
  if (!account || account.id !== userId) throw badRequest("The password isn't right.", { password: "wrong" });
  await deleteAccountRow(userId);
}

/** Checks the current password, then sets the new one. Other devices are signed out; this one stays in. */
export async function changePassword(email: string, userId: string, current: string, next: string, sessionId?: string) {
  const account = await checkPassword(email, current);
  if (!account || account.id !== userId) throw badRequest("The current password isn't right.", { current: "wrong" });
  await updateAccount(userId, { password: next });
  await endAllSessions(userId, sessionId);
}
