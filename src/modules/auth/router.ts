import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { profileOf } from "../me/service.js";
import { unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import * as auth from "./service.js";
import { forgotSchema, loginSchema, refreshSchema, resendSchema, resetSchema, signupSchema, verifySchema } from "./schemas.js";

export const authRouter = Router();

// Codes and passwords are guessable only slowly
const strict = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
authRouter.use(strict);

authRouter.post("/signup", validate("body", signupSchema), async (req, res) => {
  const { mail } = await auth.signup(req.body);
  res.status(202).json({ next: "verify", mail });
});

authRouter.post("/verify", validate("body", verifySchema), async (req, res) => {
  const { email, code, purpose } = req.body;
  if (purpose === "signup") await auth.verifySignup(email, code);
  // A reset code is checked together with the new password, in /reset
  else await auth.consumeCode(email, "reset", code).then(() => undefined);
  res.json({ ok: true });
});

authRouter.post("/resend", validate("body", resendSchema), async (req, res) => {
  const { email, purpose, lang } = req.body;
  const mail = purpose === "signup" ? await auth.issueCode(email, "signup", lang) : await auth.forgotPassword(email, lang);
  res.json({ mail: mail === "unknown" ? "sent" : mail });
});

authRouter.post("/login", validate("body", loginSchema), async (req, res) => {
  const { tokens, userId } = await auth.login(req.body.email, req.body.password);
  const profile = unwrap(await db.from("profiles").select("*").eq("id", userId).single(), "Your profile");
  res.json({ tokens, user: profileOf(profile) });
});

authRouter.post("/refresh", validate("body", refreshSchema), async (req, res) => {
  res.json({ tokens: await auth.refresh(req.body.refreshToken) });
});

authRouter.post("/logout", authenticate, async (req, res) => {
  await auth.logout(req.accessToken!);
  res.status(204).end();
});

authRouter.post("/forgot", validate("body", forgotSchema), async (req, res) => {
  const result = await auth.forgotPassword(req.body.email, req.body.lang);
  // Same answer for unknown addresses
  res.status(202).json({ next: "verify", mail: result === "unknown" ? "sent" : result });
});

authRouter.post("/reset", validate("body", resetSchema), async (req, res) => {
  await auth.resetPassword(req.body.email, req.body.code, req.body.password);
  res.json({ ok: true });
});
