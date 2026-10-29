import { describe, expect, it } from "vitest";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test";
process.env.NODE_ENV = "test";

const { assertAllowance, bestSentence, monthStart, questionWords } = await import("../src/modules/assistant/service.js");

describe("assistant", () => {
  it("drops stop words and duplicates", () => {
    expect(questionWords("What is the law about temporary injunction in Bangladesh? injunction")).toEqual(["temporary", "injunction"]);
    expect(questionWords("অস্থায়ী নিষেধাজ্ঞা কী")).toEqual(["অস্থায়ী", "নিষেধাজ্ঞা"]);
  });

  it("quotes the sentence that shares the most words", () => {
    const text = "This Act may be cited as the Code. A temporary injunction may be granted where property is in danger. Nothing else.";
    expect(bestSentence(text, ["temporary", "injunction"])).toBe("A temporary injunction may be granted where property is in danger.");
  });

  it("starts the month on Bangladesh time", () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in Dhaka
    expect(monthStart(new Date("2026-10-31T23:30:00Z")).toISOString()).toBe("2026-10-31T18:00:00.000Z");
    expect(monthStart(new Date("2026-10-31T17:00:00Z")).toISOString()).toBe("2026-09-30T18:00:00.000Z");
  });

  it("stops a reader at their plan's limit, never an unlimited plan", () => {
    expect(() => assertAllowance({ used: 5, limit: 5 })).toThrow();
    expect(() => assertAllowance({ used: 4, limit: 5 })).not.toThrow();
    expect(() => assertAllowance({ used: 999, limit: null })).not.toThrow();
  });
});
