import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// "Continue with Google" without reaching Google: the guards before the code exchange, and a refused code.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-long-enough-1234567890";
process.env.READER_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "client-secret";

const { createApp } = await import("../src/app.js");
const app = createApp();
const good = "http://localhost:3000/api/auth/google/callback";

describe("POST /auth/google", () => {
  it("checks the body", async () => {
    expect((await request(app).post("/auth/google").send({ redirectUri: good })).status).toBe(400);
  });

  it("only accepts the reader site as the redirect", async () => {
    const res = await request(app).post("/auth/google").send({ code: "x", redirectUri: "https://evil.example/cb" });
    expect(res.status).toBe(400);
  });

  it("answers 400 when Google refuses the code", async () => {
    const real = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/")) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      return real(input, init);
    });
    const res = await request(app).post("/auth/google").send({ code: "bad-code", redirectUri: good, lang: "bn" });
    spy.mockRestore();
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ google: "failed" });
  });
});
