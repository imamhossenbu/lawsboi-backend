import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireTeam } from "../../../middleware/auth.js";
import { validate } from "../../../middleware/validate.js";
import { unauthorized, unwrap } from "../../../lib/errors.js";
import { authClient, db } from "../../../lib/supabase.js";
import { changePasswordSchema, loginSchema } from "../../auth/schemas.js";
import { changePassword, logout, refresh, tokensOf } from "../../auth/service.js";
import { logAudit } from "../../audit/service.js";
import { memberOf } from "../team/service.js";

// Team sign-in for the admin panel. The same Supabase Auth as readers, but only an active team_members row gets in.

export const adminAuthRouter = Router();

const strict = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

adminAuthRouter.post("/login", strict, validate("body", loginSchema), async (req, res) => {
  const { data, error } = await authClient().auth.signInWithPassword(req.body);
  if (error || !data.session) throw unauthorized("Wrong email or password.");
  const member = unwrap(await db.from("team_members").select("*").eq("id", data.user.id).maybeSingle(), "A team account");
  if (!member.active) throw unauthorized("This team account has been deactivated.");
  // Their first sign-in ends the invitation
  const accepted = member.accepted_at ? member : unwrap(await db.from("team_members").update({ accepted_at: new Date().toISOString(), invited_at: null }).eq("id", member.id).select("*").single());
  res.json({ tokens: tokensOf(data.session), member: memberOf(accepted), mustChangePassword: accepted.must_change_password });
});

adminAuthRouter.post("/refresh", validate("body", z.object({ refreshToken: z.string().min(1) })), async (req, res) => {
  res.json({ tokens: await refresh(req.body.refreshToken) });
});

adminAuthRouter.get("/me", requireTeam, (req, res) => {
  res.json({ member: memberOf(req.member!), mustChangePassword: req.member!.must_change_password });
});

adminAuthRouter.post("/password", requireTeam, validate("body", changePasswordSchema), async (req, res) => {
  const me = req.member!;
  await changePassword(me.email, me.id, req.body.current, req.body.password);
  await db.from("team_members").update({ must_change_password: false }).eq("id", me.id);
  await logAudit(req, { action: "account.password", target: { type: "account", id: me.public_id, label: { en: me.name, bn: me.name_bn ?? me.name } } });
  res.json({ ok: true });
});

adminAuthRouter.post("/logout", requireTeam, async (req, res) => {
  await logout(req.accessToken!);
  res.status(204).end();
});
