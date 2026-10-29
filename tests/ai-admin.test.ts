import { describe, expect, it } from "vitest";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test";
process.env.NODE_ENV = "test";

const { chunk, keepFixedSections, replaceTexts, textsIn } = await import("../src/modules/admin/ai/service.js");
const prompts = await import("../src/modules/admin/ai/prompts.js");

describe("admin AI helpers", () => {
  it("splits long lists into pieces by count and size", () => {
    expect(chunk(Array.from({ length: 90 }, () => "x")).map((c) => c.length)).toEqual([40, 40, 10]);
    expect(chunk(["a".repeat(8000), "b".repeat(8000), "c"]).map((c) => c.length)).toEqual([1, 2]);
  });

  it("walks and replaces every two-language text in order", () => {
    const draft = { title: { en: "A", bn: "" }, steps: [{ en: "", bn: "খ" }, { en: "C", bn: "গ" }], tryHref: "/dashboard" };
    const texts = textsIn(draft);
    expect(texts.map((t) => t.en || t.bn)).toEqual(["A", "খ", "C"]);
    const next = replaceTexts(draft, texts.map((t) => ({ en: t.en || "EN", bn: t.bn || "BN" })));
    expect(next).toEqual({ title: { en: "A", bn: "BN" }, steps: [{ en: "EN", bn: "খ" }, { en: "C", bn: "গ" }], tryHref: "/dashboard" });
  });

  it("puts rewritten text back into a fixed page's own bands", () => {
    const current = [{ id: "story", title: { en: "Old", bn: "পুরোনো" }, body: [{ en: "x", bn: "y" }] }];
    const written = [
      { id: "story", title: { en: "New", bn: "নতুন" }, body: [{ en: "z", bn: "w" }], list: [{ en: "extra", bn: "বাড়তি" }] },
      { id: "invented", title: { en: "No", bn: "না" }, body: [] },
    ];
    expect(keepFixedSections(current, written)).toEqual([{ id: "story", title: { en: "New", bn: "নতুন" }, body: [{ en: "z", bn: "w" }] }]);
  });

  it("keeps legal marks and the site's names in its instructions", () => {
    expect(prompts.translateInstruction("en", "bn", "legal")).toContain("clause marks like (1), (a), (i)");
    expect(prompts.articleInstruction()).toContain("/dashboard/assistant");
    expect(prompts.lawReadInstruction()).toContain("do not translate");
  });
});

describe("judgment citations", async () => {
  const { provisionRef, fromRoman } = await import("../src/modules/admin/ai/service.js");
  it("stores an Order's rule the way imported judgments do", () => {
    expect(fromRoman("XXXIX")).toBe(39);
    expect(provisionRef("order", "XXXIX rule 1")).toEqual({ kind: "order", n: "39", rule: 1 });
    expect(provisionRef("rule", "O.39 r.2")).toEqual({ kind: "order", n: "39", rule: 2 });
    expect(provisionRef("order", "7")).toEqual({ kind: "order", n: "7", rule: null });
    expect(provisionRef("section", "151")).toEqual({ kind: "section", n: "151", rule: null });
  });
});
