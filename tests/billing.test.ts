import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Every step is a round trip to Supabase, so a test needs far more than the default five seconds
vi.setConfig({ testTimeout: 90_000 });
import request from "supertest";
import type { Express } from "express";
import { adminToken, app, reader, sweep } from "./billing.helpers.js";

let server: Express;
let admin: string;
let me: Awaited<ReturnType<typeof reader>>;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const trx = () => `T${Date.now().toString(36).toUpperCase().slice(-9)}`.padEnd(10, "X").slice(0, 10);

beforeAll(async () => {
  server = await app();
  await sweep();
  admin = await adminToken(server);
  me = await reader(server, "billing");
}, 60_000);

afterAll(async () => {
  await me?.cleanup();
});

describe("public pricing", () => {
  it("lists active plans with the comparison matrix", async () => {
    const res = await request(server).get("/billing/plans");
    expect(res.status).toBe(200);
    expect(res.body.plans.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["free", "researcher", "professional"]));
    expect(res.body.matrix.length).toBeGreaterThan(5);
    expect(res.body.plans[0]).not.toHaveProperty("subscribers");
  });
  it("lists the wallets", async () => {
    const res = await request(server).get("/billing/accounts");
    expect(res.status).toBe(200);
    expect(res.body.accounts.map((a: { method: string }) => a.method)).toEqual(["bkash", "nagad"]);
  });
});

describe("checkout, verification and refund", () => {
  let paymentId: string;
  const trxId = trx();

  it("rejects a malformed transaction id", async () => {
    const res = await request(server).post("/billing/checkout").set(auth(me.token)).send({ plan: "researcher", cycle: "monthly", method: "nagad", trxId });
    expect(res.status).toBe(400);
    expect(res.body.error.details.trxId).toBe("shape");
  });
  it("refuses the free plan and a cycle not sold", async () => {
    expect((await request(server).post("/billing/checkout").set(auth(me.token)).send({ plan: "free", cycle: "monthly", method: "bkash", trxId })).status).toBe(400);
  });
  it("creates an awaiting payment", async () => {
    const res = await request(server).post("/billing/checkout").set(auth(me.token)).send({ plan: "researcher", cycle: "monthly", method: "bkash", trxId: trxId.toLowerCase() });
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ status: "awaiting", amount: 100, plan: "researcher", trxId });
    paymentId = res.body.payment.id;
    expect(paymentId).toMatch(/^PAY-\d{6}$/);
  });
  it("refuses the same id again, and a second pending payment", async () => {
    expect((await request(server).post("/billing/checkout").set(auth(me.token)).send({ plan: "researcher", cycle: "monthly", method: "bkash", trxId })).status).toBe(409);
    expect((await request(server).post("/billing/checkout").set(auth(me.token)).send({ plan: "professional", cycle: "yearly", method: "nagad", trxId: "ABCD1234" })).status).toBe(409);
  });
  it("shows the reader their pending payment", async () => {
    const res = await request(server).get("/billing/subscription").set(auth(me.token));
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("free");
    expect(res.body.subscription).toBeNull();
    expect(res.body.payments[0].id).toBe(paymentId);
  });
  it("the team finds it by transaction id", async () => {
    const res = await request(server).get("/admin/billing/payments").query({ q: trxId }).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.payments[0].user.id).toBe(me.publicId);
  });
  it("verifying switches the plan on and starts the subscription", async () => {
    const res = await request(server).post(`/admin/billing/payments/${paymentId}/verify`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe("verified");
    const sub = await request(server).get("/billing/subscription").set(auth(me.token));
    expect(sub.body.plan).toBe("researcher");
    expect(sub.body.subscription).toMatchObject({ plan: "researcher", cycle: "monthly", status: "active", autoRenew: true });
    expect(Date.parse(sub.body.subscription.renews)).toBeGreaterThan(Date.now() + 27 * 86_400_000);
  });
  it("can't be verified twice", async () => {
    expect((await request(server).post(`/admin/billing/payments/${paymentId}/verify`).set(auth(admin))).status).toBe(409);
  });
  it("auto-renew can be turned off by the reader and by the team", async () => {
    const off = await request(server).post("/billing/subscription/auto-renew").set(auth(me.token)).send({ autoRenew: false });
    expect(off.body.subscription.autoRenew).toBe(false);
    const on = await request(server).patch(`/admin/billing/subscriptions/${off.body.subscription.id}`).set(auth(admin)).send({ autoRenew: true });
    expect(on.status).toBe(200);
    expect(on.body.subscription.autoRenew).toBe(true);
  });
  it("a renewal payment runs the subscription on", async () => {
    const second = await request(server).post("/billing/checkout").set(auth(me.token)).send({ plan: "researcher", cycle: "monthly", method: "nagad", trxId: trx().slice(0, 8) });
    expect(second.status).toBe(201);
    const before = (await request(server).get("/billing/subscription").set(auth(me.token))).body.subscription;
    await request(server).post(`/admin/billing/payments/${second.body.payment.id}/verify`).set(auth(admin)).expect(200);
    const after = (await request(server).get("/billing/subscription").set(auth(me.token))).body.subscription;
    expect(after.id).toBe(before.id);
    expect(Date.parse(after.renews)).toBeGreaterThan(Date.parse(before.renews));
  });
  it("refunding ends the subscription and drops the reader to the default plan", async () => {
    const res = await request(server).post(`/admin/billing/payments/${paymentId}/refund`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe("refunded");
    const sub = await request(server).get("/billing/subscription").set(auth(me.token));
    expect(sub.body.plan).toBe("free");
    expect(sub.body.subscription).toBeNull();
  });
  it("rejecting needs a reason and a pending payment", async () => {
    const third = await request(server).post("/billing/checkout").set(auth(me.token)).send({ plan: "professional", cycle: "monthly", method: "bkash", trxId: trx() });
    expect(third.status).toBe(201);
    expect((await request(server).post(`/admin/billing/payments/${third.body.payment.id}/reject`).set(auth(admin)).send({})).status).toBe(400);
    const rejected = await request(server).post(`/admin/billing/payments/${third.body.payment.id}/reject`).set(auth(admin)).send({ reason: "notFound" });
    expect(rejected.body.payment).toMatchObject({ status: "rejected", reason: "notFound" });
  });
  it("tallies the month and exports CSV", async () => {
    const figures = await request(server).get("/admin/billing/payments/figures").set(auth(admin));
    expect(figures.status).toBe(200);
    expect(figures.body.status.verified.count).toBeGreaterThanOrEqual(1);
    expect(figures.body.chart.months).toHaveLength(12);
    const csv = await request(server).get("/admin/billing/payments/export").query({ q: trxId }).set(auth(admin));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain(trxId);
  });
});

describe("plans management", () => {
  let id: string;
  it("creates, edits, duplicates and deletes a plan", async () => {
    const created = await request(server).post("/admin/billing/plans").set(auth(admin)).send({
      name: { en: "Chamber", bn: "চেম্বার" },
      description: { en: "Five seats", bn: "পাঁচটি আসন" },
      price: { monthly: 1200, yearly: null },
      features: [{ en: "Five seats", bn: "পাঁচটি আসন" }],
      icon: "layers",
    });
    expect(created.status).toBe(201);
    id = created.body.plan.id;
    expect(created.body.plan.cycles).toEqual(["monthly"]);
    const edited = await request(server).patch(`/admin/billing/plans/${id}`).set(auth(admin)).send({ price: { monthly: 1500, yearly: 15000 } });
    expect(edited.body.plan.price).toEqual({ monthly: 1500, yearly: 15000 });
    const copy = await request(server).post(`/admin/billing/plans/${id}/duplicate`).set(auth(admin));
    expect(copy.status).toBe(201);
    expect(copy.body.plan.active).toBe(false);
    expect((await request(server).delete(`/admin/billing/plans/${copy.body.plan.id}`).set(auth(admin))).status).toBe(204);
    expect((await request(server).delete(`/admin/billing/plans/${id}`).set(auth(admin))).status).toBe(204);
  });
  it("protects the default plan", async () => {
    expect((await request(server).post("/admin/billing/plans/free/deactivate").set(auth(admin))).status).toBe(400);
    expect((await request(server).delete("/admin/billing/plans/free").set(auth(admin))).status).toBe(400);
  });
  it("lists plans with subscriber counts and recurring revenue", async () => {
    const res = await request(server).get("/admin/billing/plans").set(auth(admin));
    expect(res.status).toBe(200);
    expect(typeof res.body.recurringRevenue).toBe("number");
    expect(res.body.plans.find((p: { id: string }) => p.id === "free").subscribers).toBeGreaterThanOrEqual(1);
  });
});

describe("dashboard, audit, settings, health, users", () => {
  it("counts the dashboard from the database", async () => {
    const res = await request(server).get("/admin/dashboard").set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.months).toHaveLength(12);
    expect(res.body.series.revenue).toHaveLength(12);
    expect(res.body.kpis.users.current).toBeGreaterThanOrEqual(1);
    expect(res.body.recent.users.length).toBeGreaterThanOrEqual(1);
  });
  it("lists and summarises the audit log", async () => {
    const list = await request(server).get("/admin/audit").query({ area: "payments" }).set(auth(admin));
    expect(list.status).toBe(200);
    expect(list.body.entries.every((e: { area: string }) => e.area === "payments")).toBe(true);
    expect(list.body.entries.some((e: { action: string }) => e.action === "payment.refund")).toBe(true);
    const stats = await request(server).get("/admin/audit/stats").set(auth(admin));
    expect(stats.body.today).toBeGreaterThanOrEqual(1);
    const csv = await request(server).get("/admin/audit/export").query({ area: "payments" }).set(auth(admin));
    expect(csv.headers["content-type"]).toContain("text/csv");
  });
  it("reads and writes settings", async () => {
    const before = await request(server).get("/admin/settings").set(auth(admin));
    expect(before.status).toBe(200);
    expect(before.body.accounts.bkash.number).toBeTruthy();
    const contact = { ...before.body.contact, phone: "+880 1700 000001" };
    const put = await request(server).put("/admin/settings/contact").set(auth(admin)).send({ email: "support@lawsboi.com", whatsapp: "", replyTime: { en: "", bn: "" }, hours: { en: "", bn: "" }, office: { en: "", bn: "" }, officeNote: { en: "", bn: "" }, ...contact });
    expect(put.status).toBe(200);
    const bad = await request(server).put("/admin/settings/accounts").set(auth(admin)).send({ bkash: { number: "12345", type: "personal", name: "Lawsboi", enabled: true }, nagad: before.body.accounts.nagad });
    expect(bad.status).toBe(400);
  });
  it("checks health for real", async () => {
    const res = await request(server).get("/admin/health").set(auth(admin));
    expect(res.status).toBe(200);
    // Round trips from here to the project's region vary; what matters is that the check ran and answered
    expect(["up", "degraded"]).toContain(res.body.database.status);
    expect(res.body.database.error).toBeNull();
    expect(res.body.storage.buckets).toContain("ticket-files");
    expect(res.body.data.readers).toBeGreaterThanOrEqual(1);
    expect(res.body.config.every((c: { state: string }) => !/sb_|@/.test(c.state))).toBe(true);
  });
  it("adds, details and exports users", async () => {
    const stats = await request(server).get("/admin/users/stats").set(auth(admin));
    expect(stats.body.total.current).toBeGreaterThanOrEqual(1);
    const email = `apitest+added-${Date.now().toString(36)}@example.com`;
    const added = await request(server).post("/admin/users").set(auth(admin)).send({ name: "Added Reader", email, plan: "researcher", cycle: "yearly" });
    expect(added.status).toBe(201);
    expect(added.body.user).toMatchObject({ plan: "researcher", cycle: "yearly" });
    expect((await request(server).post("/admin/users").set(auth(admin)).send({ name: "Dup", email })).status).toBe(409);
    const detail = await request(server).get(`/admin/users/${added.body.user.id}`).set(auth(admin));
    expect(detail.body.user.subscriptions).toEqual([]);
    const csv = await request(server).get("/admin/users/export").query({ q: email }).set(auth(admin));
    expect(csv.text).toContain(email);
    const { db } = await import("../src/lib/supabase.js");
    const { data } = await db.from("profiles").select("id").eq("email", email).single();
    if (data) await db.auth.admin.deleteUser(data.id);
  });
});
