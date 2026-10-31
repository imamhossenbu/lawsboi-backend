import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../../config/env.js";
import { accountByEmail, createAccount, startSession, updateAccount, type Tokens } from "../../lib/accounts.js";
import { badRequest, forbidden, HttpError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { db } from "../../lib/supabase.js";
import type { Lang } from "../../types/rows.js";

// "Continue with Google" for readers. The reader site sends the browser to Google; Google sends it back to the site
// with a one-time code, which the site passes here. This API trades the code for Google's ID token (with the client
// secret, which only it holds), checks the token, and signs the reader in — making the account on first use.

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const googleConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

interface GoogleIdentity {
  email: string;
  name: string;
}

/** Trades the code for an ID token and returns the verified Google identity. */
async function identityFromCode(code: string, redirectUri: string): Promise<GoogleIdentity> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.id_token) {
    logger.warn({ status: res.status, error: body.error }, "google code exchange failed");
    throw badRequest("Google sign-in didn't go through. Try again.", { google: "failed" });
  }
  const { payload } = await jwtVerify(body.id_token, googleKeys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: env.GOOGLE_CLIENT_ID!,
  }).catch(() => {
    throw badRequest("Google sign-in didn't go through. Try again.", { google: "failed" });
  });
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || payload.email_verified !== true) throw badRequest("Your Google account's email isn't verified.", { google: "unverified" });
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : email.split("@")[0]!;
  return { email, name };
}

/** Signs a reader in with Google: an existing reader by email, or a new account (confirmed, since Google verified
 * the email). Team accounts can't sign in this way. */
export async function signInWithGoogle(input: { code: string; redirectUri: string; lang: Lang }): Promise<{ tokens: Tokens; userId: string; created: boolean }> {
  if (!googleConfigured()) throw new HttpError("unavailable", "Google sign-in isn't set up.");
  // Only our own site may be the landing page; Google checks this too, against the console's list
  if (!env.READER_URL || !input.redirectUri.startsWith(`${env.READER_URL.replace(/\/$/, "")}/`)) throw badRequest("That return address isn't allowed.");
  const { email, name } = await identityFromCode(input.code, input.redirectUri);

  const existing = await accountByEmail(email);
  if (existing) {
    const { data: team } = await db.from("team_members").select("id").eq("id", existing.id).maybeSingle();
    if (team) throw forbidden("That email belongs to a team account. Sign in to the admin panel instead.", { google: "team" });
    if (existing.disabled) throw forbidden("This account has been deactivated.", { google: "deactivated" });
    // Google has proved the address, which finishes a sign-up that never got its code
    if (!existing.email_confirmed_at) await updateAccount(existing.id, { confirmed: true });
    return { tokens: await startSession(existing.id), userId: existing.id, created: false };
  }

  // A password nobody knows: they can set one later with "Forgot password"
  const account = await createAccount({ email, password: randomBytes(24).toString("base64url"), confirmed: true, meta: { kind: "reader", name, lang: input.lang } });
  return { tokens: await startSession(account.id), userId: account.id, created: true };
}
