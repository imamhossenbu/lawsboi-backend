import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The free plan's reading allowance, against the live database: a free reader opens up to the month's sections,
// then is asked to upgrade; a second free account on the same device starts from that device's count; the whole
// act is for paid plans. Skipped until the reading_access migration is applied. Fixtures: "apitest" readers and a
// test device id, deleted after.

vi.setConfig({ testTimeout: 90_000 });
import request from "supertest";
import type { Express } from "express";
import { app, reader, sweep } from "./billing.helpers.js";

let server: Express;
let ready = false;
const device = `apitest-${Date.now().toString(36)}-device`;
const people: Awaited<ReturnType<typeof reader>>[] = [];
const ask = (body: object, token?: string) =>
  request(server)
    .post("/catalogue/access")
    .set({ "x-viewer-device": device, "x-viewer-ip": "203.0.113.7", ...(token ? { Authorization: `Bearer ${token}` } : {}) })
    .send(body);

beforeAll(async () => {
  server = await app();
  const { db } = await import("../src/lib/supabase.js");
  ready = !(await db.from("reading_access").select("id").limit(1)).error;
  if (!ready) return;
  await sweep();
  people.push(await reader(server, "quota-a"), await reader(server, "quota-b"));
}, 60_000);

afterAll(async () => {
  const { db } = await import("../src/lib/supabase.js");
  if (ready) await db.from("reading_access").delete().or(`device.eq.${device},ip.eq.203.0.113.7`);
  for (const p of people) await p.cleanup();
});

describe("free reading allowance", () => {
  it("stops a free reader at the month's sections, and a second account on that device too", async (ctx) => {
    if (!ready) ctx.skip();
    const [a, b] = people;
    const limit = (await import("../src/modules/catalogue/access.service.js")).ALLOWANCE.free.section;
    for (let i = 1; i <= limit; i++) expect((await ask({ kind: "section", slug: "apitest-law", n: String(i) }, a!.token)).body.allowed).toBe(true);
    // Something already read opens again; a new one doesn't
    expect((await ask({ kind: "section", slug: "apitest-law", n: "1" }, a!.token)).body.allowed).toBe(true);
    expect((await ask({ kind: "section", slug: "apitest-law", n: "999" }, a!.token)).body).toMatchObject({ allowed: false, reason: "upgrade", viewer: "free" });
    expect((await ask({ kind: "section", slug: "apitest-law", n: "998" }, b!.token)).body).toMatchObject({ allowed: false, reason: "upgrade" });
  });

  it("keeps the whole act for paid plans", async (ctx) => {
    if (!ready) ctx.skip();
    expect((await ask({ kind: "text", slug: "apitest-law" }, people[0]!.token)).body).toMatchObject({ allowed: false, reason: "paid_only" });
  });
});
