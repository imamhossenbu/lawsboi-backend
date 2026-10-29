import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Every step is a round trip to Supabase, so a test needs far more than the default five seconds
vi.setConfig({ testTimeout: 90_000 });
import request from "supertest";
import type { Express } from "express";
import { app, reader } from "./billing.helpers.js";

let server: Express;
let me: Awaited<ReturnType<typeof reader>>;
const auth = () => ({ Authorization: `Bearer ${me.token}` });

beforeAll(async () => {
  server = await app();
  me = await reader(server, "library");
}, 60_000);

afterAll(async () => {
  await me?.cleanup();
});

describe("saved items", () => {
  it("toggles, lists within the free allowance, and clears", async () => {
    const first = await request(server).post("/library/saved/toggle").set(auth()).send({ href: "/dashboard/laws/penal-code-1860", kind: "law", title: "Penal Code, 1860" });
    expect(first.status).toBe(201);
    expect(first.body.saved).toBe(true);
    for (let i = 1; i < 5; i++) await request(server).post("/library/saved/toggle").set(auth()).send({ href: `/dashboard/laws/x/section-${i}`, kind: "section", title: `S${i}` }).expect(201);
    const over = await request(server).post("/library/saved/toggle").set(auth()).send({ href: "/dashboard/cases/one", kind: "case", title: "One" });
    expect(over.status).toBe(400);
    expect(over.body.error.details.saved).toBe("allowance");
    const list = await request(server).get("/library/saved").set(auth());
    expect(list.body.items).toHaveLength(5);
    expect(list.body.allowance).toBe(5);
    const again = await request(server).post("/library/saved/toggle").set(auth()).send({ href: "/dashboard/laws/penal-code-1860", kind: "law", title: "Penal Code, 1860" });
    expect(again.body.saved).toBe(false);
    await request(server).delete("/library/saved").set(auth()).expect(204);
    expect((await request(server).get("/library/saved").set(auth())).body.items).toHaveLength(0);
  });
  it("rejects paths outside the dashboard", async () => {
    expect((await request(server).post("/library/saved/toggle").set(auth()).send({ href: "https://evil", kind: "law", title: "x" })).status).toBe(400);
  });
});

describe("collections", () => {
  it("creates, fills, edits and deletes", async () => {
    const created = await request(server).post("/library/collections").set(auth()).send({ name: "Bail", icon: "scale", color: "blue" });
    expect(created.status).toBe(201);
    const id = created.body.collection.id;
    const put = await request(server).post(`/library/collections/${id}/toggle`).set(auth()).send({ key: "/dashboard/laws/crpc-1898/section-497" });
    expect(put.body.inCollection).toBe(true);
    const list = await request(server).get("/library/collections").set(auth());
    expect(list.body.collections[0].items).toEqual(["/dashboard/laws/crpc-1898/section-497"]);
    const renamed = await request(server).patch(`/library/collections/${id}`).set(auth()).send({ name: "Bail law" });
    expect(renamed.body.collection.name).toBe("Bail law");
    await request(server).delete("/library/collections/items").set(auth()).expect(204);
    expect((await request(server).get("/library/collections").set(auth())).body.collections[0].items).toEqual([]);
    await request(server).delete(`/library/collections/${id}`).set(auth()).expect(204);
  });
});

describe("research history", () => {
  it("records, folds repeats, filters and clears", async () => {
    const entry = { kind: "search", title: { en: "bail", bn: "bail" }, scope: "laws", href: "/dashboard/laws?q=bail" };
    const a = await request(server).post("/library/history").set(auth()).send(entry);
    expect(a.status).toBe(201);
    const b = await request(server).post("/library/history").set(auth()).send(entry);
    expect(b.status).toBe(200);
    expect(b.body.entry.id).toBe(a.body.entry.id);
    await request(server).post("/library/history").set(auth()).send({ kind: "law", title: { en: "Penal Code", bn: "দণ্ডবিধি" }, href: "/dashboard/laws/penal-code-1860" }).expect(201);
    const all = await request(server).get("/library/history").set(auth());
    expect(all.body.history).toHaveLength(2);
    const searches = await request(server).get("/library/history").query({ kind: "search" }).set(auth());
    expect(searches.body.history).toHaveLength(1);
    await request(server).delete("/library/history").query({ only: "search" }).set(auth()).expect(204);
    expect((await request(server).get("/library/history").set(auth())).body.history).toHaveLength(1);
  });
  it("honours the reader's record settings", async () => {
    await request(server).patch("/me").set(auth()).send({ preferences: { recordReads: false } }).expect(200);
    const res = await request(server).post("/library/history").set(auth()).send({ kind: "case", title: { en: "X v Y", bn: "X v Y" }, href: "/dashboard/cases/x" });
    expect(res.body.recorded).toBe(false);
  });
});
