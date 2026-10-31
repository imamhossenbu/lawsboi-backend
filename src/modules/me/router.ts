import { Router } from "express";
import { z } from "zod";
import { requireReader } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { unwrap } from "../../lib/errors.js";
import { db } from "../../lib/supabase.js";
import { changePasswordSchema } from "../auth/schemas.js";
import { changePassword, deleteAccount } from "../auth/service.js";
import { updateAccount } from "../../lib/accounts.js";
import { profileOf } from "./service.js";

export const meRouter = Router();
meRouter.use(requireReader);

meRouter.get("/", (req, res) => {
  res.json({ user: profileOf(req.reader!) });
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    lang: z.enum(["en", "bn"]),
    profile: z
      .object({
        phone: z.string().trim().max(30),
        profession: z.enum(["student", "researcher", "lawyer", "judge", "academic", "other"]),
        organization: z.string().trim().max(120),
        location: z.string().trim().max(120),
        photo: z.string().max(200_000).nullable(),
      })
      .partial(),
    preferences: z.record(z.string(), z.unknown()),
    notifications: z.record(z.string(), z.unknown()),
  })
  .partial();

meRouter.patch("/", validate("body", patchSchema), async (req, res) => {
  const b = req.body;
  const me = req.reader!;
  const patch = {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.lang !== undefined && { lang: b.lang }),
    ...(b.profile?.phone !== undefined && { phone: b.profile.phone }),
    ...(b.profile?.profession !== undefined && { profession: b.profile.profession }),
    ...(b.profile?.organization !== undefined && { organization: b.profile.organization }),
    ...(b.profile?.location !== undefined && { location: b.profile.location }),
    ...(b.profile?.photo !== undefined && { photo_url: b.profile.photo }),
    ...(b.preferences !== undefined && { preferences: { ...(me.preferences as object), ...b.preferences } as never }),
    ...(b.notifications !== undefined && { notifications: { ...(me.notifications as object), ...b.notifications } as never }),
  };
  const updated = unwrap(await db.from("profiles").update(patch).eq("id", me.id).select("*").single(), "Your profile");
  if (b.name !== undefined || b.lang !== undefined) {
    await updateAccount(me.id, { meta: { kind: "reader", name: updated.name, lang: updated.lang } });
  }
  res.json({ user: profileOf(updated) });
});

meRouter.post("/password", validate("body", changePasswordSchema), async (req, res) => {
  await changePassword(req.reader!.email, req.reader!.id, req.body.current, req.body.password, req.authUser!.sessionId);
  res.json({ ok: true });
});

/** Closes the account. The password confirms it's really them; everything they own goes with the account. */
meRouter.delete("/", validate("body", z.object({ password: z.string().min(1) })), async (req, res) => {
  await deleteAccount(req.reader!.email, req.reader!.id, req.body.password);
  res.status(204).end();
});
