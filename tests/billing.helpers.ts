import { readFileSync } from "node:fs";
import type { Express } from "express";
import request from "supertest";

// Route tests run against the live Supabase project in .env, with fixtures named after a prefix and deleted after.

export function loadEnv() {
  if (process.env.SUPABASE_URL) return;
  const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const value = m[2]!.replace(/^"(.*)"$/, "$1");
    process.env[m[1]!] ??= value;
  }
  process.env.NODE_ENV = "test";
  // Emails go to the log, not to anyone's inbox
  delete process.env.SMTP_HOST;
}

export const PREFIX = "apitest";
export const testEmail = (tag: string) => `${PREFIX}+${tag}-${Date.now().toString(36)}@example.com`;

export async function app(): Promise<Express> {
  loadEnv();
  const { createApp } = await import("../src/app.js");
  return createApp();
}

export async function adminToken(server: Express) {
  const res = await request(server).post("/admin/auth/login").send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.tokens.accessToken as string;
}

/** A confirmed reader with a known password, signed in. Returns the token, the auth id and a cleanup. */
export async function reader(server: Express, tag: string, plan = "free") {
  const { db } = await import("../src/lib/supabase.js");
  const email = testEmail(tag);
  const password = "reader-pass-123";
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { kind: "reader", name: `Test ${tag}`, lang: "en" } });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const id = data.user.id;
  if (plan !== "free") await db.from("profiles").update({ plan_id: plan, cycle: "monthly" }).eq("id", id);
  const login = await request(server).post("/auth/login").send({ email, password });
  if (login.status !== 200) throw new Error(`reader login failed: ${login.status} ${JSON.stringify(login.body)}`);
  return {
    id,
    email,
    token: login.body.tokens.accessToken as string,
    publicId: login.body.user.id as string,
    cleanup: async () => {
      await db.auth.admin.deleteUser(id);
    },
  };
}

/** Removes every test reader left behind by an interrupted run. */
export async function sweep() {
  const { db } = await import("../src/lib/supabase.js");
  const { data } = await db.from("profiles").select("id").like("email", `${PREFIX}+%`);
  for (const p of data ?? []) await db.auth.admin.deleteUser(p.id);
}
