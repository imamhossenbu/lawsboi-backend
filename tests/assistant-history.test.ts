import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app, reader } from "./billing.helpers.js";

// The reader's chats against the live database: a follow-up joins its chat, chats can be saved and deleted, and a
// deleted question still counts towards the month's allowance. The model is off under test, so answers carry
// their sources with text: null — which is all these need.

describe("assistant conversations", () => {
  let server: Awaited<ReturnType<typeof app>>;
  let me: Awaited<ReturnType<typeof reader>>;
  const auth = () => ({ authorization: `Bearer ${me.token}` });

  beforeAll(async () => {
    server = await app();
    me = await reader(server, "chat");
  }, 60_000);
  afterAll(async () => {
    // Only this file's reader: sweep() would delete other files' readers while they run
    await me?.cleanup();
  }, 60_000);

  it("keeps a follow-up in the same chat, saves it, deletes it and still counts it", async () => {
    const first = await request(server).post("/assistant/ask").set(auth()).send({ question: "When can a court grant a temporary injunction?" }).expect(201);
    const chat = first.body.conversationId as string;
    expect(chat).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.body.answer.laws.length).toBeGreaterThan(0);
    expect(first.body.answer.text).toBeNull();

    const follow = await request(server).post("/assistant/ask").set(auth()).send({ question: "And can it be refused?", conversationId: chat }).expect(201);
    expect(follow.body.conversationId).toBe(chat);

    const chats = await request(server).get("/assistant/conversations").set(auth()).expect(200);
    expect(chats.body.conversations).toHaveLength(1);
    expect(chats.body.conversations[0]).toMatchObject({ id: chat, count: 2, title: "When can a court grant a temporary injunction?", saved: false });

    await request(server).post(`/assistant/history/${chat}/save`).set(auth()).send({ saved: true }).expect(200);
    const saved = await request(server).get("/assistant/history?saved=true").set(auth()).expect(200);
    expect(saved.body.questions).toHaveLength(2);

    await request(server).delete(`/assistant/history/${chat}`).set(auth()).expect(204);
    const after = await request(server).get("/assistant/history").set(auth()).expect(200);
    expect(after.body.total).toBe(0);
    const usage = await request(server).get("/assistant/usage").set(auth()).expect(200);
    expect(usage.body.usage.used).toBe(2);
  }, 90_000);

  it("refuses a follow-up in someone else's chat", async () => {
    await request(server).post("/assistant/ask").set(auth()).send({ question: "What is theft?", conversationId: "00000000-0000-4000-8000-000000000000" }).expect(404);
  }, 30_000);
});
