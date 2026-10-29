import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminToken, app, reader } from "./billing.helpers.js";

// One live call per AI route, against the real model and database. The key's free tier allows only a few
// requests a day, so these run only when asked: AI_LIVE=1 npx vitest run tests/ai-live.test.ts

const live = process.env.AI_LIVE === "1";
const describeLive = live ? describe : describe.skip;
const AI_TIMEOUT = 90_000;

describeLive("AI routes, live", () => {
  let server: Awaited<ReturnType<typeof app>>;
  let admin = "";
  let me: Awaited<ReturnType<typeof reader>>;

  beforeAll(async () => {
    server = await app();
    if (!process.env.GEMINI_API_KEY) throw new Error("AI_LIVE=1 needs GEMINI_API_KEY in .env");
    admin = await adminToken(server);
    me = await reader(server, "ai");
  }, 60_000);
  afterAll(async () => {
    // Only this file's reader: sweep() would delete other files' readers while they run
    await me?.cleanup();
  }, 60_000);

  const asTeam = (r: request.Test) => r.set("authorization", `Bearer ${admin}`);

  it("answers a reader's question from the sources, with citations", async () => {
    const res = await request(server).post("/assistant/ask").set("authorization", `Bearer ${me.token}`).send({ question: "What is the punishment for theft?", lang: "en" }).expect(201);
    const a = res.body.answer;
    expect(a.laws.length).toBeGreaterThan(0);
    expect(typeof a.text).toBe("string");
    expect(a.citations.length).toBeGreaterThan(0);
    expect(a.text).toMatch(/\[\d+\]/);
    expect(res.body.usage.used).toBe(1);
  }, AI_TIMEOUT);

  it("answers a Bangla question in Bangla", async () => {
    const res = await request(server).post("/assistant/preview").send({ question: "জামিন অযোগ্য অপরাধে জামিন কখন দেওয়া যায়?", lang: "bn" }).expect(200);
    expect(res.body.answer.lang).toBe("bn");
    expect(res.body.answer.text).toMatch(/[ঀ-৿]/);
  }, AI_TIMEOUT);

  it("translates, keeping marks", async () => {
    const res = await asTeam(request(server).post("/admin/ai/translate")).send({ texts: ["(1) This Act may be called the Penal Code."], from: "en", to: "bn", kind: "legal" }).expect(200);
    // The mark survives, in Latin or Bangla digits
    expect(res.body.texts[0]).toMatch(/\((1|১)\)/);
  }, AI_TIMEOUT);

  it("drafts an article in both languages", async () => {
    const res = await asTeam(request(server).post("/admin/ai/draft/article")).send({ mode: "write", brief: "How to save a section to the library" }).expect(200);
    expect(res.body.draft.steps.length).toBeGreaterThan(0);
    expect(res.body.draft.title.bn).toMatch(/[ঀ-৿]/);
  }, AI_TIMEOUT);

  it("translates a section of a law, one string per block", async () => {
    const res = await asTeam(request(server).post("/admin/ai/laws/translate-section")).send({ slug: "penal-code-1860", n: "379" }).expect(200);
    expect(res.body.translation.to).toBe("bn");
    expect(res.body.translation.b.length).toBeGreaterThan(0);
  }, AI_TIMEOUT);

  it("refuses an empty translation without calling the model", async () => {
    const res = await asTeam(request(server).post("/admin/ai/assist")).send({ task: "toBn", text: { en: "", bn: "" } }).expect(400);
    expect(res.body.error.details.ai).toBe("empty");
  });
});

describe("AI routes without the model", () => {
  it("say the model isn't connected, and the assistant still returns its sources", async () => {
    if (live) return;
    const server = await app();
    const status = await request(server).post("/assistant/preview").send({ question: "What is the punishment for theft?", lang: "en" }).expect(200);
    expect(status.body.answer.text).toBeNull();
    expect(status.body.answer.reason).toBe("not_configured");
    expect(status.body.answer.laws.length).toBeGreaterThan(0);
  }, 60_000);
});
