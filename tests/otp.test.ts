import { describe, expect, it } from "vitest";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-long-enough-1234567890";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test";
process.env.NODE_ENV = "test";

const { codeMatches, hashCode, isCodeShaped, newCode, OTP_LENGTH } = await import("../src/lib/otp.js");

describe("one-time codes", () => {
  it("makes six digits", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(new RegExp(`^\\d{${OTP_LENGTH}}$`));
  });

  it("matches only the same email, purpose and code", () => {
    const hash = hashCode("Reader@Example.com", "signup", "123456");
    expect(codeMatches("reader@example.com", "signup", "123456", hash)).toBe(true);
    expect(codeMatches("reader@example.com", "reset", "123456", hash)).toBe(false);
    expect(codeMatches("other@example.com", "signup", "123456", hash)).toBe(false);
    expect(codeMatches("reader@example.com", "signup", "654321", hash)).toBe(false);
  });

  it("recognises a code's shape", () => {
    expect(isCodeShaped("000000")).toBe(true);
    expect(isCodeShaped("12345")).toBe(false);
    expect(isCodeShaped("12345a")).toBe(false);
  });
});
