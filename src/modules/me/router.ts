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

/* ---------------------------------------------------------- notifications */

// The reader's own notifications (ticket replies, payment outcomes, legal news) beside the announcements in the
// bell, newest first. Opening one marks it read; "mark all read" clears the badge.

const noticeQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

meRouter.get("/notifications", validate("query", noticeQuery), async (req, res) => {
  const { limit } = noticeQuery.parse(req.query);
  const me = req.reader!.id;
  const [rows, unread] = await Promise.all([
    db.from("reader_notifications").select("*").eq("user_id", me).order("created_at", { ascending: false }).limit(limit),
    db.from("reader_notifications").select("id", { count: "exact", head: true }).eq("user_id", me).is("read_at", null),
  ]);
  res.json({
    notifications: unwrap(rows).map((n) => ({
      id: n.id,
      kind: n.kind,
      title: { en: n.title, bn: n.title_bn },
      body: { en: n.body, bn: n.body_bn },
      link: n.link,
      at: n.created_at,
      read: !!n.read_at,
    })),
    unread: unread.count ?? 0,
  });
});

meRouter.post("/notifications/read-all", async (req, res) => {
  await db.from("reader_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", req.reader!.id).is("read_at", null);
  res.status(204).end();
});

meRouter.post("/notifications/:id/read", validate("params", z.object({ id: z.uuid() })), async (req, res) => {
  await db.from("reader_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", req.reader!.id).eq("id", String(req.params.id)).is("read_at", null);
  res.status(204).end();
});

/* ----------------------------------------------------------------- resume */

// Where the reader left off (the page, how far down, its title), so the site can offer "continue where you left
// off" on any device. Kept in profiles.preferences.resume.

const resumeSchema = z.object({
  path: z.string().trim().min(1).max(600).regex(/^\/(?!\/)/, "A site path."),
  title: z.string().trim().max(240).default(""),
  scroll: z.number().min(0).max(1).default(0),
});

meRouter.get("/resume", (req, res) => {
  const prefs = (req.reader!.preferences ?? {}) as { resume?: unknown };
  res.json({ resume: prefs.resume ?? null });
});

meRouter.put("/resume", validate("body", resumeSchema), async (req, res) => {
  const prefs = (req.reader!.preferences ?? {}) as Record<string, unknown>;
  const resume = { ...(req.body as z.infer<typeof resumeSchema>), at: new Date().toISOString() };
  await db.from("profiles").update({ preferences: { ...prefs, resume } as never }).eq("id", req.reader!.id);
  res.json({ resume });
});
