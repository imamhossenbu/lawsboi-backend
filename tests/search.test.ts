import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "./billing.helpers.js";

// GET /search against the live catalogue: each kind answers, a named provision comes first, short queries are empty.
vi.setConfig({ testTimeout: 30_000 });
const server = await app();

describe("GET /search", () => {
  it("finds a named provision in English and Bangla digits", async () => {
    for (const q of ["section 144", "ধারা ১৪৪"]) {
      const res = await request(server).get("/search").query({ q, limit: 3 });
      expect(res.status).toBe(200);
      expect(res.body.provisions[0].title.en).toMatch(/^Section 144/);
      expect(res.body.provisions[0].href).toMatch(/^\/dashboard\/laws\/.+\/section-144$/);
    }
  });

  it("returns laws, judgments and help articles in their own groups", async () => {
    const res = await request(server).get("/search").query({ q: "evidence act" });
    expect(res.body.laws.length).toBeGreaterThan(0);
    expect(res.body.laws[0].href).toMatch(/^\/dashboard\/laws\//);
    expect(res.body.cases.every((c: { href: string }) => c.href.startsWith("/dashboard/cases/"))).toBe(true);
    const help = await request(server).get("/search").query({ q: "payment" });
    expect(help.body.articles[0].href).toMatch(/^\/dashboard\/help\/articles\//);
  });

  it("answers empty groups for a one-letter query", async () => {
    const res = await request(server).get("/search").query({ q: "x" });
    expect(res.body).toEqual({ q: "x", laws: [], provisions: [], cases: [], articles: [] });
  });
});
