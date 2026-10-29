import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { parsed, validate } from "../../../middleware/validate.js";
import { badRequest, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import { email, lang } from "../../auth/schemas.js";
import { logAudit } from "../../audit/service.js";
import { isAction, normalizePermissions, presets } from "./permissions.js";
import { findMember, inviteMember, memberOf, reinviteMember, setActive } from "./service.js";

export const teamRouter = Router();
teamRouter.use(requireTeam);

const roles = z.enum(["admin", "editor", "support"]);
const idParam = z.object({ id: z.string().regex(/^AGT-\d+$/) });
const label = (m: { name: string; name_bn: string | null }) => ({ en: m.name, bn: m.name_bn ?? m.name });

teamRouter.get("/", requirePermission("settings.view"), async (_req, res) => {
  const members = unwrap(await db.from("team_members").select("*").order("member_no"));
  res.json({ members: members.map(memberOf), presets });
});

const inviteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameBn: z.string().trim().max(120).optional(),
  email,
  role: roles,
  permissions: z.array(z.string()).optional(),
  lang,
});

teamRouter.post("/", requirePermission("settings.team"), validate("body", inviteSchema), async (req, res) => {
  const { member, password, mail } = await inviteMember(req.body, req.member!);
  await logAudit(req, { action: "team.invite", target: { type: "member", id: member.public_id, label: label(member) }, changes: [{ field: "role", to: member.role }, { field: "email", to: member.email }] });
  res.status(201).json({ member: memberOf(member), password, mail });
});

teamRouter.post("/:id/reinvite", requirePermission("settings.team"), validate("params", idParam), validate("body", z.object({ lang })), async (req, res) => {
  const { member, password, mail } = await reinviteMember(await findMember(parsed<{ id: string }>(req, "params").id), req.member!, req.body.lang);
  await logAudit(req, { action: "team.reinvite", target: { type: "member", id: member.public_id, label: label(member) }, changes: [{ field: "email", to: member.email }] });
  res.json({ member: memberOf(member), password, mail });
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    nameBn: z.string().trim().max(120).nullable(),
    role: roles,
    permissions: z.array(z.string()),
    active: z.boolean(),
  })
  .partial();

teamRouter.patch("/:id", requirePermission("settings.team"), validate("params", idParam), validate("body", patchSchema), async (req, res) => {
  const before = await findMember(parsed<{ id: string }>(req, "params").id);
  const b = req.body as z.infer<typeof patchSchema>;
  if (before.id === req.member!.id && (b.active === false || (b.role && b.role !== "admin"))) throw badRequest("You can't lock yourself out.");
  if (b.permissions?.some((p) => !isAction(p))) throw badRequest("Unknown permission.", { permissions: "unknown" });

  let member = before;
  if (b.active !== undefined && b.active !== before.active) {
    member = await setActive(before, b.active);
    await logAudit(req, { action: b.active ? "team.activate" : "team.deactivate", target: { type: "member", id: member.public_id, label: label(member) }, changes: [{ field: "active", from: !b.active, to: b.active }] });
  }
  const patch = {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.nameBn !== undefined && { name_bn: b.nameBn }),
    // A new role resets the permissions to its preset unless the request sets them too
    ...(b.role !== undefined && { role: b.role, permissions: b.permissions ? normalizePermissions(b.permissions) : presets[b.role] }),
    ...(b.role === undefined && b.permissions !== undefined && { permissions: normalizePermissions(b.permissions) }),
  };
  if (Object.keys(patch).length) {
    member = unwrap(await db.from("team_members").update(patch).eq("id", member.id).select("*").single());
    const target = { type: "member", id: member.public_id, label: label(member) };
    if (patch.name !== undefined || patch.name_bn !== undefined) await logAudit(req, { action: "team.edit", target, changes: [{ field: "name", from: before.name, to: member.name }] });
    if (b.role !== undefined && b.role !== before.role) await logAudit(req, { action: "team.role", target, changes: [{ field: "role", from: before.role, to: member.role }] });
    if (b.permissions !== undefined) {
      const was = new Set(before.permissions);
      const now = new Set(member.permissions);
      await logAudit(req, {
        action: "team.permissions",
        target,
        changes: [
          { field: "granted", to: member.permissions.filter((p) => !was.has(p)) },
          { field: "revoked", to: before.permissions.filter((p) => !now.has(p)) },
        ],
      });
    }
  }
  res.json({ member: memberOf(member) });
});

/** The signed-in member's own profile: name, phone, photo and the sign-off under their replies. */
const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    nameBn: z.string().trim().max(120).nullable(),
    phone: z.string().trim().max(30),
    photo: z.string().max(200_000).nullable(),
    signature: z.object({ en: z.string().max(500), bn: z.string().max(500) }).partial(),
  })
  .partial();

teamRouter.patch("/me/profile", validate("body", profileSchema), async (req, res) => {
  const me = req.member!;
  const b = req.body as z.infer<typeof profileSchema>;
  const patch = {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.nameBn !== undefined && { name_bn: b.nameBn }),
    ...(b.phone !== undefined && { phone: b.phone }),
    ...(b.photo !== undefined && { photo_url: b.photo }),
    ...(b.signature?.en !== undefined && { signature: b.signature.en }),
    ...(b.signature?.bn !== undefined && { signature_bn: b.signature.bn }),
  };
  const member = unwrap(await db.from("team_members").update(patch).eq("id", me.id).select("*").single());
  await logAudit(req, { action: "account.profile", target: { type: "account", id: member.public_id, label: label(member) }, changes: Object.keys(patch).map((field) => ({ field })) });
  res.json({ member: memberOf(member) });
});
