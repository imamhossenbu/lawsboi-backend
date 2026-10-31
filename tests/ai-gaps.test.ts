import { describe, expect, it } from "vitest";

// Pure parts of the gaps fixed for the frontends: health incidents, read de-duplication, and how the assistant
// merges a Bangla question's two searches.

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-long-enough-1234567890";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test";
process.env.NODE_ENV = "test";

const { incidentsOf } = await import("../src/modules/admin/health/router.js");
const { seenRecently } = await import("../src/modules/catalogue/router.js");
const { interleave } = await import("../src/modules/assistant/answer.js");

const up = { status: "up" as const, ms: 10 };
const run = (at: string, site: "up" | "degraded" | "down", mail: "up" | "down" = "up") => ({
  at,
  overall: site === "down" || mail === "down" ? ("down" as const) : site === "degraded" ? ("degraded" as const) : ("up" as const),
  checks: { database: up, storage: up, mail: { status: mail, ms: 5 }, site: { status: site, ms: 900 } },
});

describe("health incidents", () => {
  it("joins consecutive bad runs and lists them newest first", () => {
    const incidents = incidentsOf([run("t1", "up"), run("t2", "degraded"), run("t3", "down", "down"), run("t4", "up"), run("t5", "down")]);
    expect(incidents).toEqual([
      { from: "t5", to: "t5", worst: "down", checks: ["site"], runs: 1 },
      { from: "t2", to: "t3", worst: "down", checks: ["site", "mail"], runs: 2 },
    ]);
  });
});

describe("catalogue reads", () => {
  it("counts a page once per viewer every half hour", () => {
    const key = `viewer-${Math.random()}|law|penal-code-1860|`;
    expect(seenRecently(key, 1_000)).toBe(false);
    expect(seenRecently(key, 1_000 + 60_000)).toBe(true);
    expect(seenRecently(key, 1_000 + 31 * 60_000)).toBe(false);
    expect(seenRecently(`${key}other`, 1_000)).toBe(false);
  });
});

describe("assistant source merging", () => {
  it("takes turns from both searches, skipping repeats, up to the limit", () => {
    const a = { hits: [{ id: "a1" }, { id: "x" }, { id: "a3" }], refs: ["ra1", "rx", "ra3"] };
    const b = { hits: [{ id: "x" }, { id: "b2" }], refs: ["rx-b", "rb2"] };
    const merged = interleave(a, b, 4);
    expect(merged.hits.map((h) => h.id)).toEqual(["a1", "x", "b2", "a3"]);
    // x is taken from the second list, where it came up first in turn
    expect(merged.refs).toEqual(["ra1", "rx-b", "rb2", "ra3"]);
  });
});
