import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// Unit-level: the cron door and the token format, without touching the database.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-long-enough-1234567890";
process.env.CRON_SECRET = "cron-test-secret";

vi.mock("../src/modules/cron/service.js", () => ({
  tick: vi.fn(async () => ({ at: new Date().toISOString(), ms: 1, database: true, announcements: 0, health: false, sessionsDeleted: 0, codesDeleted: 0, errors: [] })),
}));

const { createApp } = await import("../src/app.js");
const app = createApp();

describe("/cron/tick", () => {
  it("refuses a missing or wrong secret", async () => {
    expect((await request(app).get("/cron/tick")).status).toBe(401);
    expect((await request(app).get("/cron/tick").set("Authorization", "Bearer nope")).status).toBe(401);
  });

  it("runs the tick with the right secret, by GET or POST", async () => {
    const get = await request(app).get("/cron/tick").set("Authorization", "Bearer cron-test-secret");
    expect(get.status).toBe(200);
    expect(get.body.database).toBe(true);
    expect((await request(app).post("/cron/tick").set("Authorization", "Bearer cron-test-secret")).status).toBe(200);
  });
});

describe("access tokens", () => {
  it("rejects forged and malformed tokens before any lookup", async () => {
    const { verifyAccessToken } = await import("../src/lib/accounts.js");
    expect(await verifyAccessToken("not-a-jwt")).toBeNull();
    const { SignJWT } = await import("jose");
    const forged = await new SignJWT({ sid: "x" }).setProtectedHeader({ alg: "HS256" }).setSubject("y").setIssuer("lawsboi-api").setExpirationTime("1h").sign(new TextEncoder().encode("a-different-secret-of-enough-length-000000"));
    expect(await verifyAccessToken(forged)).toBeNull();
  });

  it("verifies the hashes Supabase Auth stored", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    // $2a$ is what Supabase Auth wrote; copied accounts must keep signing in
    const legacy = await bcrypt.hash("old-password", 10);
    expect(legacy.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare("old-password", legacy.replace(/^\$2b\$/, "$2a$"))).toBe(true);
  });
});
