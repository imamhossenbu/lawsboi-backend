import { env } from "../../../config/env.js";
import { conflict, HttpError, notFound, unwrap } from "../../../lib/errors.js";
import { sendMail, type MailResult } from "../../../lib/mail/send.js";
import { inviteMail } from "../../../lib/mail/templates/invite.js";
import { temporaryPassword } from "../../../lib/passwords.js";
import { createAccount, updateAccount } from "../../../lib/accounts.js";
import { db } from "../../../lib/supabase.js";
import type { Lang, TeamMemberRow, TeamRole } from "../../../types/rows.js";
import { normalizePermissions, presets, type Action } from "./permissions.js";

/** A team member as the admin panel lists them. */
export function memberOf(m: TeamMemberRow) {
  return {
    id: m.public_id,
    name: { en: m.name, bn: m.name_bn ?? m.name },
    email: m.email,
    role: m.role,
    permissions: m.permissions as Action[],
    active: m.active,
    phone: m.phone,
    photo: m.photo_url,
    signature: { en: m.signature, bn: m.signature_bn },
    added: m.created_at,
    invited: m.invited_at,
    mustChangePassword: m.must_change_password,
  };
}

export async function findMember(publicId: string) {
  return unwrap(await db.from("team_members").select("*").eq("public_id", publicId).maybeSingle(), "That team member");
}

export interface InviteInput {
  name: string;
  nameBn?: string;
  email: string;
  role: TeamRole;
  permissions?: string[];
  lang: Lang;
}

/** Creates the account with a temporary password, the team row, and emails the invitation. The password is
 * returned once so the admin can pass it on if the email doesn't arrive; it isn't kept anywhere. */
export async function inviteMember(input: InviteInput, inviter: TeamMemberRow): Promise<{ member: TeamMemberRow; password: string; mail: MailResult }> {
  const taken = await db.from("profiles").select("id").eq("email", input.email).maybeSingle();
  if (taken.data) throw conflict("That email belongs to a reader account.", { email: "taken" });
  const password = temporaryPassword();
  const account = await createAccount({ email: input.email, password, confirmed: true, meta: { kind: "team", name: input.name, lang: input.lang } }).catch((e: unknown) => {
    if (e instanceof HttpError) throw conflict("Someone with that email is already on the team.", { email: "taken" });
    throw e;
  });
  const member = unwrap(
    await db
      .from("team_members")
      .insert({
        id: account.id,
        name: input.name,
        name_bn: input.nameBn ?? null,
        email: input.email,
        role: input.role,
        permissions: input.permissions ? normalizePermissions(input.permissions) : presets[input.role],
        invited_by: inviter.id,
        invited_at: new Date().toISOString(),
        must_change_password: true,
      })
      .select("*")
      .single(),
  );
  const mail = await sendInvite(member, password, inviter, input.lang);
  return { member, password, mail };
}

/** A fresh temporary password and a new email, for someone who never signed in. */
export async function reinviteMember(member: TeamMemberRow, inviter: TeamMemberRow, lang: Lang) {
  if (member.accepted_at) throw conflict("They've already signed in; send them a password reset instead.");
  const password = temporaryPassword();
  await updateAccount(member.id, { password });
  const updated = unwrap(await db.from("team_members").update({ invited_at: new Date().toISOString(), must_change_password: true }).eq("id", member.id).select("*").single());
  const mail = await sendInvite(updated, password, inviter, lang);
  return { member: updated, password, mail };
}

function sendInvite(member: TeamMemberRow, password: string, inviter: TeamMemberRow, lang: Lang) {
  return sendMail({
    to: member.email,
    ...inviteMail({ name: member.name, role: member.role, inviter: inviter.name, password, signInUrl: `${env.ADMIN_URL}${lang === "bn" ? "/bn" : ""}/login` }, lang),
  });
}

export async function setActive(member: TeamMemberRow, active: boolean) {
  const updated = unwrap(await db.from("team_members").update({ active }).eq("id", member.id).select("*").single());
  // A deactivated member's tokens stop working at once
  await updateAccount(member.id, { disabled: !active });
  return updated;
}

export async function memberByPublicId(id: string | null) {
  if (id === null) return null;
  const { data } = await db.from("team_members").select("*").eq("public_id", id).maybeSingle();
  if (!data) throw notFound("That team member");
  return data;
}
