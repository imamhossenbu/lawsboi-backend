import { env } from "../src/config/env.js";
import { db } from "../src/lib/supabase.js";
import { presets } from "../src/modules/admin/team/permissions.js";

// The first administrator, from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME in .env. Safe to run again: an
// existing account keeps its password and only has its admin role confirmed.

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || "Lawsboi Admin";
if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.");
if (password.length < 8) throw new Error("ADMIN_PASSWORD needs at least 8 characters.");

const existing = await db.from("team_members").select("*").eq("email", email).maybeSingle();
let id = existing.data?.id;

if (!id) {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { kind: "team", name, lang: "en" } });
  if (error) throw new Error(`Auth: ${error.message}`);
  id = data.user.id;
  const { error: insert } = await db.from("team_members").insert({ id, name, email, role: "admin", permissions: presets.admin, accepted_at: new Date().toISOString() });
  if (insert) throw new Error(`team_members: ${insert.message}`);
  console.log(`Created admin ${email} (${id}) on ${env.SUPABASE_URL}`);
} else {
  const { error } = await db.from("team_members").update({ role: "admin", permissions: presets.admin, active: true }).eq("id", id);
  if (error) throw new Error(`team_members: ${error.message}`);
  console.log(`${email} is already on the team; confirmed as an active admin.`);
}
