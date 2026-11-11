import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The SMS path end to end against the live database, as the forwarder app drives it: a reader pays at checkout,
// bKash/Nagad SMS arrive, and each lands where the team expects — verified by itself, held for a look with its
// reason, waiting for a payment, set aside, or a repeat — and the admin's SMS log tells it the same way. Fixtures
// are an "apitest" reader and their payments (deleted after), and SMS with transaction ids no real payment has.
// The team's Telegram chat is left alone: notifyTeam is stubbed.

vi.setConfig({ testTimeout: 90_000 });
vi.mock("../src/lib/telegram.js", async (real) => ({ ...(await real<typeof import("../src/lib/telegram.js")>()), notifyTeam: vi.fn(async () => undefined) }));

import request from "supertest";
import type { Express } from "express";
import { adminToken, app, reader, sweep } from "./billing.helpers.js";

let server: Express;
let admin: string;
let me: Awaited<ReturnType<typeof reader>>;
const smsIds: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
// bKash transaction ids are 10 letters and digits; these are new each run
const trx = (tag: string) => `Z${tag}${Date.now().toString(36).toUpperCase()}`.replace(/[^A-Z0-9]/g, "").slice(0, 10).padEnd(10, "Q");
const bkash = (amount: number, id: string) => `You have received Tk ${amount.toFixed(2)} from 01712345678. Fee Tk 0.00. Balance Tk 1,250.50. TrxID ${id} at 11/11/2026 14:05`;

async function ingest(body: string) {
  const { ingestSms } = await import("../src/modules/sms/service.js");
  const row = await ingestSms({ source: "webhook", sender: "bKash", body });
  smsIds.push(row.id);
  return row;
}

async function checkout(trxId: string) {
  const res = await request(server).post("/billing/checkout").set(auth(me.token)).send({ plan: "researcher", cycle: "monthly", method: "bkash", trxId });
  expect(res.status).toBe(201);
  return res.body.payment as { id: string; amount: number; status: string };
}

beforeAll(async () => {
  server = await app();
  await sweep();
  admin = await adminToken(server);
  me = await reader(server, "sms");
}, 60_000);

afterAll(async () => {
  const { db } = await import("../src/lib/supabase.js");
  if (smsIds.length) await db.from("payment_sms").delete().in("id", smsIds);
  await me?.cleanup();
});

describe("SMS that settle payments", () => {
  it("verifies an awaiting payment by itself when its SMS brings the full amount", async () => {
    const id = trx("A");
    const pay = await checkout(id);
    const sms = await ingest(bkash(pay.amount, id));
    expect(sms.status).toBe("matched");
    const { db } = await import("../src/lib/supabase.js");
    const { data } = await db.from("payments").select("status,reviewed_by").eq("public_id", pay.id).single();
    expect(data).toMatchObject({ status: "verified", reviewed_by: null });

    const log = await request(server).get("/admin/settings/sms/inbox").query({ view: "verified" }).set(auth(admin));
    const row = log.body.sms.find((x: { id: string }) => x.id === sms.id);
    expect(row).toMatchObject({ outcome: "auto_verified", details: { id: pay.id, status: "verified", verifiedBy: null } });
    expect(row.details.reader.email).toBe(me.email);
  });

  it("holds a payment whose SMS is short, says why, and the team approves it", async () => {
    // A second payment needs the plan back to free (the first one made the reader a researcher)
    const { db } = await import("../src/lib/supabase.js");
    await db.from("profiles").update({ plan_id: "free" }).eq("id", me.id);
    await db.from("subscriptions").delete().eq("user_id", me.id);
    const id = trx("B");
    const pay = await checkout(id);
    const sms = await ingest(bkash(pay.amount - 10, id));
    expect(sms.status).toBe("matched");
    expect(sms.note).toMatch(/less than/);

    const log = await request(server).get("/admin/settings/sms/inbox").query({ view: "review" }).set(auth(admin));
    const row = log.body.sms.find((x: { id: string }) => x.id === sms.id);
    expect(row).toMatchObject({ outcome: "needs_review", details: { id: pay.id, status: "awaiting" } });
    expect(log.body.counts.review).toBeGreaterThan(0);

    const ok = await request(server).post(`/admin/billing/payments/${pay.id}/verify`).set(auth(admin));
    expect(ok.status).toBe(200);
    const after = await request(server).get("/admin/settings/sms/inbox").query({ view: "verified" }).set(auth(admin));
    const done = after.body.sms.find((x: { id: string }) => x.id === sms.id);
    expect(done.outcome).toBe("verified");
    expect(done.details.verifiedBy).not.toBeNull();
  });
});

describe("SMS with no payment, repeats and others", () => {
  it("waits for a payment, offers the likeliest, and matches one by hand", async () => {
    const { db } = await import("../src/lib/supabase.js");
    await db.from("profiles").update({ plan_id: "free" }).eq("id", me.id);
    await db.from("subscriptions").delete().eq("user_id", me.id);
    const sms = await ingest(bkash(99, trx("C")));
    expect(sms.status).toBe("unmatched");

    // The reader typed a different id at checkout: the team finds the payment and matches it
    const pay = await checkout(trx("D"));
    const cands = await request(server).get(`/admin/settings/sms/${sms.id}/candidates`).set(auth(admin));
    expect(cands.status).toBe(200);
    expect(cands.body.payments.map((p: { id: string }) => p.id)).toContain(pay.id);

    const matched = await request(server).post(`/admin/settings/sms/${sms.id}/match`).set(auth(admin)).send({ paymentId: pay.id });
    expect(matched.status).toBe(200);
    expect(matched.body).toMatchObject({ payment: pay.id, verified: true, status: "verified" });
  });

  it("sets a repeat apart, and SMS that aren't received payments", async () => {
    const id = trx("E");
    await ingest(bkash(50, id));
    expect((await ingest(bkash(50, id))).status).toBe("duplicate");
    expect((await ingest(`Send Money Tk 500.00 to 01712345678 successful. Fee Tk 0.00. TrxID ${trx("F")} at 11/11/2026`)).status).toBe("ignored");
    expect((await ingest("Your bKash verification code is 482913. Do not share it.")).status).toBe("ignored");
  });
});
