import type { Session, User } from "@supabase/supabase-js";
import { badRequest, conflict, HttpError, unauthorized } from "../../lib/errors.js";
import { sendMail, type MailResult } from "../../lib/mail/send.js";
import { otpMail } from "../../lib/mail/templates/otp.js";
import { codeMatches, hashCode, newCode, OTP_MAX_ATTEMPTS, OTP_RESEND_MS, OTP_TTL_MS } from "../../lib/otp.js";
import { authClient, db } from "../../lib/supabase.js";
import type { Lang, OtpPurpose } from "../../types/rows.js";

// Readers' accounts. Supabase Auth keeps the credentials; this API runs the email codes around them so that
// sign-up and password resets go through our own mailbox, in the reader's language.

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds since the epoch. */
  expiresAt: number;
}

export const tokensOf = (s: Session): Tokens => ({ accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at ?? 0 });

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

/** Checks a code and uses it up. Five wrong tries kill the code; an expired one needs a resend. */
export async function consumeCode(email: string, purpose: OtpPurpose, code: string) {
  const row = await latestCode(email, purpose);
  if (!row) throw badRequest("Ask for a new code first.", { code: "expired" });
  if (Date.parse(row.expires_at) < Date.now()) throw badRequest("That code has expired. Ask for a new one.", { code: "expired" });
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw badRequest("Too many wrong tries. Ask for a new code.", { code: "expired" });
  if (!codeMatches(email, purpose, code, row.code_hash)) {
    await db.from("email_otps").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    throw badRequest("That code isn't right.", { code: "wrong" });
  }
  await db.from("email_otps").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
}

/* --------------------------------------------------------------- accounts */

async function findAuthUser(email: string): Promise<User | null> {
  // Auth has no lookup by email in the admin API; the profile (or team row) carries the id
  const { data: profile } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  const id = profile?.id;
  if (!id) return null;
  const { data } = await db.auth.admin.getUserById(id);
  return data.user ?? null;
}

/** Creates the Auth user unconfirmed (the database trigger adds the profile) and emails the code. Someone who
 * signed up before but never verified gets a fresh code instead of an error. */
export async function signup(input: { name: string; email: string; password: string; lang: Lang }) {
  const existing = await findAuthUser(input.email);
  if (existing) {
    if (existing.email_confirmed_at) throw conflict("An account with this email already exists. Sign in instead.", { email: "taken" });
    // Keep what they typed this time, in case the first attempt had a typo in the name or password
    await db.auth.admin.updateUserById(existing.id, { password: input.password, user_metadata: { ...existing.user_metadata, name: input.name, lang: input.lang } });
    await db.from("profiles").update({ name: input.name, lang: input.lang }).eq("id", existing.id);
  } else {
    const { data: team } = await db.from("team_members").select("id").eq("email", input.email).maybeSingle();
    if (team) throw conflict("That email belongs to a team account.", { email: "taken" });
    const { error } = await db.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: false,
      user_metadata: { kind: "reader", name: input.name, lang: input.lang },
    });
    if (error) {
      if (error.code === "email_exists") throw conflict("An account with this email already exists. Sign in instead.", { email: "taken" });
      throw new Error(`Auth: ${error.message}`);
    }
  }
  const mail = await issueCode(input.email, "signup", input.lang);
  return { mail };
}

/** The code checks out: confirm the email so the password works. */
export async function verifySignup(email: string, code: string) {
  const user = await findAuthUser(email);
  if (!user) throw badRequest("Start again: that sign-up wasn't found.", { email: "unknown" });
  await consumeCode(email, "signup", code);
  const { error } = await db.auth.admin.updateUserById(user.id, { email_confirm: true });
  if (error) throw new Error(`Auth: ${error.message}`);
}

export async function login(email: string, password: string): Promise<{ tokens: Tokens; userId: string }> {
  const { data, error } = await authClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    if (error?.code === "email_not_confirmed") throw unauthorized("Verify your email first: we've sent you a code.");
    throw unauthorized("Wrong email or password.");
  }
  return { tokens: tokensOf(data.session), userId: data.user.id };
}

export async function refresh(refreshToken: string): Promise<Tokens> {
  const { data, error } = await authClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) throw unauthorized("Your session has expired. Sign in again.");
  return tokensOf(data.session);
}

/** Ends the session behind this token, on every device. */
export async function logout(accessToken: string) {
  const { error } = await db.auth.admin.signOut(accessToken, "global");
  if (error) throw unauthorized("Your session has already ended.");
}

/** Starts a reset. Answers the same whether or not the address exists, so the form can't be used to list accounts. */
export async function forgotPassword(email: string, lang: Lang): Promise<MailResult | "unknown"> {
  const user = await findAuthUser(email);
  if (!user) return "unknown";
  return issueCode(email, "reset", user.user_metadata?.lang === "bn" ? "bn" : lang);
}

export async function resetPassword(email: string, code: string, password: string) {
  const user = await findAuthUser(email);
  if (!user) throw badRequest("That code isn't right.", { code: "wrong" });
  await consumeCode(email, "reset", code);
  const { error } = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (error) throw new Error(`Auth: ${error.message}`);
}

/** Checks the current password by signing in with it, then sets the new one. */
export async function changePassword(email: string, userId: string, current: string, next: string) {
  const { error: wrong } = await authClient().auth.signInWithPassword({ email, password: current });
  if (wrong) throw badRequest("The current password isn't right.", { current: "wrong" });
  const { error } = await db.auth.admin.updateUserById(userId, { password: next });
  if (error) throw new Error(`Auth: ${error.message}`);
}
