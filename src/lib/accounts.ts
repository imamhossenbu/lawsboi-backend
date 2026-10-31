import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { env } from "../config/env.js";
import type { Json } from "../types/database.js";
import type { AccountRow } from "../types/rows.js";
import { conflict } from "./errors.js";
import { db } from "./supabase.js";

// The API's own sign-ins, now that Supabase is only the database. Passwords are bcrypt hashes in `accounts`
// (the format Supabase Auth used, so accounts copied from it keep their passwords). A sign-in opens a row in
// `sessions`; the short-lived access token is a JWT naming that session, and the refresh token is a random
// secret whose hash the row keeps and which changes on every refresh.

export type AccountMeta = { kind?: "reader" | "team"; name?: string; lang?: "en" | "bn" };

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds since the epoch. */
  expiresAt: number;
}

const BCRYPT_ROUNDS = 10;
const ISSUER = "lawsboi-api";
const key = new TextEncoder().encode(env.JWT_SECRET);
const DUMMY_HASH = bcrypt.hashSync("not-a-password", BCRYPT_ROUNDS);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/* --------------------------------------------------------------- accounts */

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);

export async function accountById(id: string) {
  const { data } = await db.from("accounts").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function accountByEmail(email: string) {
  const { data } = await db.from("accounts").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
  return data;
}

/** Creates an account; for a reader the database trigger makes the profile from `meta`. 409 when the email is taken. */
export async function createAccount(input: { email: string; password: string; confirmed: boolean; meta: AccountMeta }): Promise<AccountRow> {
  const { data, error } = await db
    .from("accounts")
    .insert({
      email: input.email.trim().toLowerCase(),
      password_hash: await hashPassword(input.password),
      email_confirmed_at: input.confirmed ? new Date().toISOString() : null,
      meta: input.meta as NonNullable<Json>,
    })
    .select("*")
    .single();
  if (error?.code === "23505") throw conflict("An account with this email already exists.", { email: "taken" });
  if (error || !data) throw new Error(`Accounts: ${error?.message}`);
  return data;
}

export async function updateAccount(id: string, patch: { password?: string; confirmed?: boolean; disabled?: boolean; meta?: AccountMeta }) {
  const { error } = await db
    .from("accounts")
    .update({
      ...(patch.password !== undefined && { password_hash: await hashPassword(patch.password) }),
      ...(patch.confirmed && { email_confirmed_at: new Date().toISOString() }),
      ...(patch.disabled !== undefined && { disabled: patch.disabled }),
      ...(patch.meta !== undefined && { meta: patch.meta as NonNullable<Json> }),
    })
    .eq("id", id);
  if (error) throw new Error(`Accounts: ${error.message}`);
  // A deactivated account's tokens stop working at once
  if (patch.disabled) await endAllSessions(id);
}

/** Deletes the account; the profile or team row and everything hanging off it cascade. */
export async function deleteAccountRow(id: string) {
  const { error } = await db.from("accounts").delete().eq("id", id);
  if (error) throw new Error(`Accounts: ${error.message}`);
}

/** The account behind this email and password, or null. Doesn't look at confirmation or deactivation. */
export async function checkPassword(email: string, password: string): Promise<AccountRow | null> {
  const account = await accountByEmail(email);
  // Compare against a dummy hash when there's no account, so timing doesn't reveal which emails exist
  const ok = await bcrypt.compare(password, account?.password_hash || DUMMY_HASH);
  return ok && account ? account : null;
}

/* --------------------------------------------------------------- sessions */

async function accessToken(accountId: string, sessionId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + env.ACCESS_TOKEN_MINUTES * 60;
  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(accountId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key);
  return { token, expiresAt };
}

const newRefresh = () => randomBytes(32).toString("base64url");
const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000).toISOString();

/** Opens a session for this account and returns its tokens. */
export async function startSession(accountId: string): Promise<Tokens> {
  const refreshToken = newRefresh();
  const { data, error } = await db.from("sessions").insert({ account_id: accountId, refresh_hash: sha256(refreshToken), expires_at: refreshExpiry() }).select("id").single();
  if (error || !data) throw new Error(`Sessions: ${error?.message}`);
  const access = await accessToken(accountId, data.id);
  return { accessToken: access.token, refreshToken, expiresAt: access.expiresAt };
}

/** Trades a refresh token for new tokens; the old refresh token stops working. Null when it isn't valid. */
export async function rotateSession(refreshToken: string): Promise<Tokens | null> {
  const { data: session } = await db.from("sessions").select("*").eq("refresh_hash", sha256(refreshToken)).maybeSingle();
  if (!session || Date.parse(session.expires_at) < Date.now()) return null;
  const account = await accountById(session.account_id);
  if (!account || account.disabled) return null;
  const next = newRefresh();
  // Only the caller holding the current hash wins; a replayed token finds nothing to update
  const { data: updated } = await db
    .from("sessions")
    .update({ refresh_hash: sha256(next), expires_at: refreshExpiry(), last_used_at: new Date().toISOString() })
    .eq("id", session.id)
    .eq("refresh_hash", session.refresh_hash)
    .select("id")
    .maybeSingle();
  if (!updated) return null;
  const access = await accessToken(account.id, session.id);
  return { accessToken: access.token, refreshToken: next, expiresAt: access.expiresAt };
}

/** Who an access token belongs to, or null when it is forged, expired, or its session has ended. */
export async function verifyAccessToken(token: string): Promise<{ id: string; email: string; sessionId: string } | null> {
  let sub: string | undefined;
  let sid: unknown;
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, algorithms: ["HS256"] });
    sub = payload.sub;
    sid = payload.sid;
  } catch {
    return null;
  }
  if (!sub || typeof sid !== "string") return null;
  const { data } = await db.from("sessions").select("id, accounts!inner(id, email, disabled)").eq("id", sid).eq("account_id", sub).maybeSingle();
  const account = data?.accounts as unknown as Pick<AccountRow, "id" | "email" | "disabled"> | undefined;
  if (!data || !account || account.disabled) return null;
  return { id: account.id, email: account.email, sessionId: data.id };
}

export async function endSession(sessionId: string) {
  await db.from("sessions").delete().eq("id", sessionId);
}

/** Ends every session of the account, except `keep` when given (the device that just changed the password). */
export async function endAllSessions(accountId: string, keep?: string) {
  let q = db.from("sessions").delete().eq("account_id", accountId);
  if (keep) q = q.neq("id", keep);
  await q;
}

/** Housekeeping for the scheduler: sessions past their refresh expiry. */
export async function deleteExpiredSessions() {
  const { count } = await db.from("sessions").delete({ count: "exact" }).lt("expires_at", new Date().toISOString());
  return count ?? 0;
}
