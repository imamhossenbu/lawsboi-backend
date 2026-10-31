import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The Gemini client with fetch mocked: which door and model each attempt uses, when it retries, when it falls
// back, and how replies are parsed and held to their schema.

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-long-enough-1234567890";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test";
process.env.NODE_ENV = "test";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "main-model";
process.env.GEMINI_FALLBACK_MODEL = "lite-model";

const wasLive = process.env.AI_LIVE;
let g: typeof import("../src/lib/ai/gemini.js");
beforeAll(async () => {
  // fetch is mocked, so "live" costs nothing here
  process.env.AI_LIVE = "1";
  g = await import("../src/lib/ai/gemini.js");
});
afterAll(() => {
  if (wasLive === undefined) delete process.env.AI_LIVE;
  else process.env.AI_LIVE = wasLive;
});
afterEach(() => vi.unstubAllGlobals());

const interaction = (text: string, status = "completed") =>
  new Response(JSON.stringify({ status, model: "main-model", steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "text", text }] }], usage: { total_input_tokens: 5, total_output_tokens: 2, total_tokens: 7 } }));
const candidate = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1, totalTokenCount: 5 } }));
const failure = (status: number, message = "nope") => new Response(JSON.stringify({ error: { message } }), { status });

function mockFetch(...replies: (Response | Error)[]) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const next = replies.shift();
    if (!next) throw new Error("no more replies");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("gemini client", () => {
  it("answers through the Interactions API with the key in a header", async () => {
    const calls = mockFetch(interaction("Hello"));
    const out = await g.generate({ purpose: "test", system: "Be brief.", input: "Hi" });
    expect(out.text).toBe("Hello");
    expect(out.usage.total).toBe(7);
    expect(calls[0]!.url).toMatch(/\/interactions$/);
    expect(calls[0]!.url).not.toContain("test-key");
    expect(calls[0]!.headers["x-goog-api-key"]).toBe("test-key");
    expect(calls[0]!.body).toMatchObject({ model: "main-model", store: false, system_instruction: "Be brief.", input: "Hi" });
  });

  it("retries a server error once, then falls back to the lite model", async () => {
    const calls = mockFetch(failure(503), failure(503), candidate("From lite"));
    const out = await g.generate({ purpose: "test", input: "Hi" });
    expect(out.text).toBe("From lite");
    expect(out.model).toBe("lite-model");
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["interactions", "interactions", "lite-model:generateContent"]);
  });

  it("goes straight to the fallback on a used-up quota or a cut-off reply", async () => {
    let calls = mockFetch(failure(429, "Rate limit exceeded"), candidate("ok"));
    await g.generate({ purpose: "test", input: "Hi" });
    expect(calls).toHaveLength(2);
    calls = mockFetch(interaction("half", "incomplete"), candidate("whole"));
    expect((await g.generate({ purpose: "test", input: "Hi" })).text).toBe("whole");
    expect(calls).toHaveLength(2);
  });

  it("is off under test unless AI_LIVE is set", () => {
    delete process.env.AI_LIVE;
    expect(g.aiConfigured()).toBe(false);
    process.env.AI_LIVE = "1";
    expect(g.aiConfigured()).toBe(true);
  });

  it("reports unavailable when every attempt fails", async () => {
    mockFetch(failure(500), failure(500), failure(500));
    await expect(g.generate({ purpose: "test", input: "Hi" })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("reports blocked when the fallback refuses for safety", async () => {
    mockFetch(failure(429), new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })));
    await expect(g.generate({ purpose: "test", input: "Hi" })).rejects.toMatchObject({ code: "blocked" });
  });

  it("sends files as inline parts on both doors", async () => {
    const calls = mockFetch(failure(429), candidate("ok"));
    await g.generate({ purpose: "test", input: [{ type: "document", data: "QUJD", mimeType: "application/pdf" }, { type: "text", text: "Read it" }] });
    expect(calls[0]!.body.input).toEqual([{ role: "user", content: [{ type: "document", data: "QUJD", mime_type: "application/pdf" }, { type: "text", text: "Read it" }] }]);
    expect((calls[1]!.body.contents as { parts: unknown[] }[])[0]!.parts).toEqual([{ inline_data: { mime_type: "application/pdf", data: "QUJD" } }, { text: "Read it" }]);
  });
});

describe("structured replies", () => {
  const schema = z.object({ title: z.string().max(10), n: z.number().int() });

  it("sends the shape without length limits and validates the reply", async () => {
    const calls = mockFetch(interaction('```json\n{"title":"Hi","n":2}\n```'));
    const out = await g.generateJson({ purpose: "test", input: "x" }, schema);
    expect(out.value).toEqual({ title: "Hi", n: 2 });
    const sent = JSON.stringify(calls[0]!.body.response_format);
    expect(sent).toContain('"title"');
    expect(sent).not.toContain("maxLength");
  });

  it("rejects a reply that breaks the schema", async () => {
    mockFetch(interaction('{"title":"much too long a title","n":2}'));
    await expect(g.generateJson({ purpose: "test", input: "x" }, schema)).rejects.toMatchObject({ code: "invalid" });
  });

  it("finds the JSON inside chatter", () => {
    expect(g.parseJsonReply('Here you go: {"a":1} hope it helps')).toEqual({ a: 1 });
  });
});
