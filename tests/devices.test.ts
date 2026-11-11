import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A reader is signed in on two devices at most: a third sign-in signs out the device used longest ago (its access
// token stops working at once), so one account can't be passed around. Runs on an "apitest" reader, deleted after.

vi.setConfig({ testTimeout: 60_000 });
import request from "supertest";
import type { Express } from "express";
import { app, reader, sweep } from "./billing.helpers.js";

let server: Express;
let me: Awaited<ReturnType<typeof reader>>;
const me_ = (token: string) => request(server).get("/me").set({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  server = await app();
  await sweep();
  me = await reader(server, "devices");
}, 60_000);

afterAll(async () => {
  await me?.cleanup();
});

describe("two devices per reader", () => {
  it("signs out the device used longest ago when a third signs in", async () => {
    const first = me.token;
    const signIn = async () => (await request(server).post("/auth/login").send({ email: me.email, password: "reader-pass-123" })).body.tokens.accessToken as string;
    const second = await signIn();
    expect((await me_(first)).status).toBe(200);
    expect((await me_(second)).status).toBe(200);

    const third = await signIn();
    expect((await me_(first)).status).toBe(401);
    expect((await me_(second)).status).toBe(200);
    expect((await me_(third)).status).toBe(200);
  });
});
