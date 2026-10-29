import { describe, expect, it } from "vitest";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test";
process.env.NODE_ENV = "test";

const { buildPrompt, citedIndexes, languageOf, normaliseMarkers, systemInstruction } = await import("../src/modules/assistant/answer.js");
const { anyWordsQuery } = await import("../src/modules/assistant/service.js");

const hit = (kind: "law" | "case", label: string) => ({
  kind,
  id: label,
  title: { en: "Theft", bn: "চুরি" },
  label: { en: label, bn: label },
  context: { en: "The Penal Code, 1860", bn: "দণ্ডবিধি, ১৮৬০" },
  snippet: { en: "…", bn: "…" },
  href: "/bd/laws/penal-code-1860/section-379",
});

describe("assistant answers", () => {
  it("answers in Bangla when the question is in Bangla script", () => {
    expect(languageOf("চুরির শাস্তি কী?", "en")).toBe("bn");
    expect(languageOf("What is theft?", "bn")).toBe("bn");
    expect(languageOf("What is theft?", "en")).toBe("en");
  });

  it("numbers the sources with where they come from", () => {
    const prompt = buildPrompt("What is theft?", [
      { hit: hit("law", "Section 379"), text: "Whoever commits theft shall be punished…" },
      { hit: hit("case", "19 SCOB [2024] AD 1"), text: "The appellant…" },
    ]);
    expect(prompt).toContain("Question: What is theft?");
    expect(prompt).toContain("[1] Section 379, The Penal Code, 1860\nWhoever commits theft");
    expect(prompt).toContain("[2] Theft, 19 SCOB [2024] AD 1");
  });

  it("keeps only real citation markers, Bangla digits included, in first-use order", () => {
    expect(citedIndexes("A [2]. B [1][2]. C [৩]. D [9].", 3)).toEqual([2, 1, 3]);
    expect(normaliseMarkers("দেখুন [১] ও [২]")).toBe("দেখুন [1] ও [2]");
  });

  it("tells the model to stay inside the sources and in the reader's language", () => {
    const s = systemInstruction("bn", false);
    expect(s).toContain("ONLY the numbered sources");
    expect(s).toContain("Bangla");
    expect(s).toContain("not legal advice");
    expect(systemInstruction("en", true)).toContain("two or three sentences");
  });

  it("joins model search terms with OR", () => {
    expect(anyWordsQuery(["dower", "divorce", "wife"])).toBe("dower:* | divorce:* | wife:*");
  });
});
