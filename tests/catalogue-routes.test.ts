import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Route tests against the live catalogue (the imported laws and judgments). They read; the only write is a
// draft law created and removed by the admin tests, under a distinctive slug.

// The live project's settings come from .env (vitest doesn't load it); without one, these tests are skipped.
let live = true;
try {
  process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
} catch {
  live = false;
}
process.env.NODE_ENV = "test";
const { createApp } = await import("../src/app.js");
const { db } = await import("../src/lib/supabase.js");
const app = createApp();
const describeLive = live ? describe : describe.skip;

describeLive("public catalogue", () => {
  it("lists laws with filters and pagination", async () => {
    const res = await request(app).get("/catalogue/laws?types=act&letter=P&sort=az&perPage=5").expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.laws).toHaveLength(5);
    for (const l of res.body.laws) {
      expect(l.type).toBe("act");
      expect(l.title.en.replace(/^the\s+/i, "")[0].toUpperCase()).toBe("P");
    }
  });

  it("finds a law by words and by Act number", async () => {
    const words = await request(app).get("/catalogue/laws?q=civil%20procedure&perPage=5").expect(200);
    expect(words.body.laws.map((l: { slug: string }) => l.slug)).toContain("cpc-1908");
    const actNo = await request(app).get("/catalogue/laws?q=XLV%20of%201860&field=actNo").expect(200);
    expect(actNo.body.laws[0].slug).toBe("penal-code-1860");
  });

  it("gives a law's outline, a section, an Order and its text", async () => {
    const law = await request(app).get("/catalogue/laws/cpc-1908").expect(200);
    expect(law.body.law.title.bn).toContain("দেওয়ানী");
    expect(law.body.orders).toHaveLength(52);
    expect(law.body.parts[0].sections[0].n).toBe("1");

    const section = await request(app).get("/catalogue/laws/cpc-1908/sections/151").expect(200);
    expect(section.body.section.translation.body.length).toBeGreaterThan(0);
    expect(section.body.section.prev.n).toBe("150");
    expect(section.body.section.related.map((r: { n: string }) => r.n)).toEqual(["94", "9"]);

    const order = await request(app).get("/catalogue/laws/cpc-1908/orders/39").expect(200);
    expect(order.body.order.roman).toBe("XXXIX");
    expect(order.body.order.rules[0].translation.title).toBeTruthy();

    const text = await request(app).get("/catalogue/laws/penal-code-1860/text").expect(200);
    expect(text.body.text.parts.length).toBeGreaterThan(40);
  }, 20_000);

  it("searches provisions by words, by name and by Bangla digits", async () => {
    const words = await request(app).get("/catalogue/laws/search?q=temporary%20injunction&limit=10").expect(200);
    expect(words.body.hits.some((h: { kind: string; slug: string }) => h.kind === "rule" && h.slug === "cpc-1908")).toBe(true);
    const named = await request(app).get("/catalogue/laws/search?q=section%20151").expect(200);
    expect(named.body.hits[0].n).toBe("151");
    const bangla = await request(app).get("/catalogue/laws/search?q=%E0%A7%A7%E0%A7%AA%E0%A7%AA").expect(200);
    expect(bangla.body.hits.every((h: { n: string }) => h.n.toLowerCase() === "144")).toBe(true);
    expect(bangla.body.hits.map((h: { slug: string }) => h.slug)).toContain("crpc-1898");
  }, 20_000);

  it("lists and opens judgments, and the judgments citing a law", async () => {
    const list = await request(app).get("/catalogue/cases?courts=AD&perPage=3&sort=latest").expect(200);
    expect(list.body.cases).toHaveLength(3);
    expect(list.body.cases.every((c: { court: string }) => c.court === "AD")).toBe(true);
    const one = await request(app).get(`/catalogue/cases/${list.body.cases[0].slug}`).expect(200);
    expect(one.body.case.text.length).toBeGreaterThan(0);
    const citing = await request(app).get("/catalogue/laws/cpc-1908/cases").expect(200);
    expect(citing.body.cases.length).toBeGreaterThan(10);
    expect(citing.body.cases[0].refs[0].kind).toBeTruthy();
  }, 20_000);

  it("answers 404 for an unknown law and 400 for a bad slug", async () => {
    await request(app).get("/catalogue/laws/no-such-law-1").expect(404);
    await request(app).get("/catalogue/laws/bad%20slug!").expect(400);
  });

  it("serves the home page and totals", async () => {
    const home = await request(app).get("/catalogue/home").expect(200);
    expect(home.body.laws.length).toBe(6);
    expect(home.body.sections.length).toBe(5);
    const totals = await request(app).get("/catalogue/totals").expect(200);
    expect(totals.body.laws.act).toBeGreaterThan(1000);
    expect(totals.body.courts.supreme).toBe(totals.body.courts.AD + totals.body.courts.HCD);
  });
});

describeLive("assistant preview", () => {
  it("answers a question with provisions and judgments, without signing in", async () => {
    const res = await request(app).post("/assistant/preview").send({ question: "When can a court grant a temporary injunction?" }).expect(200);
    expect(res.body.answer.laws.length).toBeGreaterThan(0);
    expect(res.body.answer.laws[0].label.en).toMatch(/Order|Section/);
  });

  it("needs a signed-in reader to ask for real", async () => {
    await request(app).post("/assistant/ask").send({ question: "bail" }).expect(401);
  });
});

describeLive("admin catalogue", () => {
  // A fresh slug each run, so a run that dies half-way can't make the next one collide
  const slug = `zz-route-test-${Date.now().toString(36)}-2099`;
  let token = "";

  beforeAll(async () => {
    if (!live) return;
    const { data } = await db.from("team_members").select("email").eq("role", "admin").limit(1).single();
    const password = process.env.ADMIN_PASSWORD ?? "";
    const res = await request(app).post("/admin/auth/login").send({ email: data?.email, password });
    token = res.body.tokens?.accessToken ?? "";
  });

  afterAll(async () => {
    // This run's rows, and anything an earlier interrupted run left behind
    await db.from("catalogue_revisions").delete().like("target_slug", "zz-route-test-%");
    await db.from("audit_logs").delete().like("target_id", "zz-route-test-%");
    await db.from("laws").delete().like("slug", "zz-route-test-%");
  });

  it("refuses without a team token", async () => {
    await request(app).get("/admin/catalogue/laws").expect(401);
  });

  it("creates a draft, edits a section, translates it, publishes, and keeps the history", async () => {
    if (!token) return; // no admin password in this environment
    const auth = { Authorization: `Bearer ${token}` };
    await request(app)
      .post("/admin/catalogue/laws")
      .set(auth)
      .send({ slug, title: "The Route Test Act, 2099", year: 2099, type: "act", parts: [{ id: "g1", title: "Part I", sections: [{ n: "1", title: "Short title", body: [{ kind: "para", text: "Test." }] }] }] })
      .expect(201);
    // Drafts are invisible to readers
    await request(app).get(`/catalogue/laws/${slug}`).expect(404);
    await request(app).put(`/admin/catalogue/laws/${slug}/sections/1`).set(auth).send({ title: "Short title (edited)", body: [{ kind: "para", text: "Edited." }] }).expect(200);
    await request(app).put(`/admin/catalogue/laws/${slug}/sections/1/translation`).set(auth).send({ title: "সংক্ষিপ্ত শিরোনাম", b: ["সম্পাদিত।"] }).expect(200);
    await request(app).post(`/admin/catalogue/laws/${slug}/publish`).set(auth).send({ published: true }).expect(200);
    const section = await request(app).get(`/catalogue/laws/${slug}/sections/1`).expect(200);
    expect(section.body.section.title.bn).toBe("সংক্ষিপ্ত শিরোনাম");
    const history = await request(app).get(`/admin/catalogue/laws/${slug}/history`).set(auth).expect(200);
    expect(history.body.history.map((h: { kind: string }) => h.kind)).toEqual(["published", "translation", "section", "created"]);
  }, 30_000);
});
