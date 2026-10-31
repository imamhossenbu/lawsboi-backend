import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Route tests against the live database. Fixtures carry a "zzt-" prefix and are removed afterwards; the admin
// token comes from ADMIN_EMAIL / ADMIN_PASSWORD in .env (the seeded first admin).

// `npm test` runs without --env-file, so the test loads .env itself (and skips when there is none)
try {
  process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
} catch {
  // no .env: the suite fails at env validation with a clear message
}
process.env.NODE_ENV = "test";
// Every call is a round trip to the hosted database
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const { createApp } = await import("../src/app.js");
const { db } = await import("../src/lib/supabase.js");
const { createAccount, deleteAccountRow } = await import("../src/lib/accounts.js");

const app = createApp();
const PREFIX = "zzt-content";
let adminToken = "";
let readerToken = "";
let readerId = "";
const readerEmail = `${PREFIX}-reader@example.com`;

async function signInAdmin() {
  const res = await request(app).post("/admin/auth/login").send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  if (res.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(res.body)}`);
  return res.body.tokens.accessToken as string;
}

async function makeReader() {
  const { data: existing } = await db.from("profiles").select("id").eq("email", readerEmail).maybeSingle();
  if (existing) await deleteAccountRow(existing.id);
  readerId = (await createAccount({ email: readerEmail, password: "reader-pass-123", confirmed: true, meta: { kind: "reader", name: "Content Tester", lang: "bn" } })).id;
  const res = await request(app).post("/auth/login").send({ email: readerEmail, password: "reader-pass-123" });
  return res.body.tokens.accessToken as string;
}

beforeAll(async () => {
  adminToken = await signInAdmin();
  readerToken = await makeReader();
  await db.from("help_articles").delete().like("slug", `${PREFIX}%`);
  await db.from("announcements").delete().like("title", `${PREFIX}%`);
  await db.from("faqs").delete().like("question", `${PREFIX}%`);
});

afterAll(async () => {
  await db.from("help_articles").delete().like("slug", `${PREFIX}%`);
  await db.from("announcements").delete().like("title", `${PREFIX}%`);
  await db.from("faqs").delete().like("question", `${PREFIX}%`);
  if (readerId) await deleteAccountRow(readerId);
});

const admin = (r: request.Test) => r.set("authorization", `Bearer ${adminToken}`);
const reader = (r: request.Test) => r.set("authorization", `Bearer ${readerToken}`);

describe("help articles", () => {
  const slug = `${PREFIX}-article`;
  const body = {
    slug,
    title: { en: "How to test", bn: "" },
    summary: { en: "A test article", bn: "পরীক্ষা" },
    steps: [{ en: "Step one", bn: "ধাপ এক" }],
    tryHref: "/dashboard/laws",
    icon: "file",
    status: "draft",
  };

  it("refuses to publish with a language missing, then publishes once filled in", async () => {
    const draft = await admin(request(app).post("/admin/content/articles")).send(body);
    expect(draft.status).toBe(201);
    expect(draft.body.article.status).toBe("draft");

    const refused = await admin(request(app).post(`/admin/content/articles/${slug}/publish`));
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.languages).toBe("bn");

    const fixed = await admin(request(app).patch(`/admin/content/articles/${slug}`)).send({ ...body, title: { en: "How to test", bn: "কীভাবে পরীক্ষা" }, status: "published" });
    expect(fixed.status).toBe(200);
    expect(fixed.body.article.status).toBe("published");

    const pub = await request(app).get(`/content/articles/${slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.article.title.bn).toBe("কীভাবে পরীক্ষা");
  });

  it("counts reads and helpful votes", async () => {
    expect((await request(app).post(`/content/articles/${slug}/read`)).status).toBe(204);
    const vote = await reader(request(app).post(`/content/articles/${slug}/helpful`)).send({ helpful: true });
    expect(vote.status).toBe(200);
    expect(vote.body.helpful).toBe(100);
    const again = await reader(request(app).post(`/content/articles/${slug}/helpful`)).send({ helpful: false });
    expect(again.body.helpful).toBe(0);
    const list = await admin(request(app).get("/admin/content/articles"));
    const mine = list.body.articles.find((a: { slug: string }) => a.slug === slug);
    expect(mine.reads).toBeGreaterThanOrEqual(1);
    expect(mine.votes).toBe(1);
  });

  it("hides unpublished articles from readers and deletes", async () => {
    expect((await admin(request(app).post(`/admin/content/articles/${slug}/unpublish`))).status).toBe(200);
    expect((await request(app).get(`/content/articles/${slug}`)).status).toBe(404);
    expect((await admin(request(app).delete(`/admin/content/articles/${slug}`))).status).toBe(204);
  });
});

describe("faqs and pages", () => {
  it("needs a topic for help-centre questions and lists by place", async () => {
    const bad = await admin(request(app).post("/admin/content/faqs")).send({ place: "help", q: { en: `${PREFIX} q`, bn: "প্র" }, a: { en: "a", bn: "উ" } });
    expect(bad.status).toBe(400);
    const ok = await admin(request(app).post("/admin/content/faqs")).send({ place: "pricing", q: { en: `${PREFIX} q`, bn: "প্র" }, a: { en: "a", bn: "উ" }, status: "published" });
    expect(ok.status).toBe(201);
    const pricing = await request(app).get("/content/faqs?place=pricing");
    expect(pricing.body.faqs.some((f: { id: string }) => f.id === ok.body.faq.id)).toBe(true);
    expect((await admin(request(app).delete(`/admin/content/faqs/${ok.body.faq.id}`))).status).toBe(204);
  });

  it("serves the imported pages and keeps the about page's bands fixed", async () => {
    const about = await request(app).get("/content/pages/about");
    expect(about.status).toBe(200);
    expect(about.body.page.fixed).toBe(true);
    const fewer = await admin(request(app).put("/admin/content/pages/about")).send({ sections: about.body.page.sections.slice(0, 1) });
    expect(fewer.status).toBe(400);
    expect(fewer.body.error.details.sections).toBe("fixed");
  });

  it("lists the imported flags publicly", async () => {
    const res = await request(app).get("/content/flags");
    expect(res.body.flags.map((f: { id: string }) => f.id)).toContain("aiQuestions");
  });
});

describe("announcements", () => {
  let id = "";

  it("estimates reach from readers' settings", async () => {
    const res = await admin(request(app).get("/admin/announcements/reach?topic=product&channels=inApp,email,banner&plans="));
    expect(res.status).toBe(200);
    // The test reader is on the free plan with default settings: in the app yes, product email no
    expect(res.body.reach.inApp).toBeGreaterThanOrEqual(1);
    expect(res.body.reach.banner).toBeGreaterThanOrEqual(res.body.reach.inApp);
  });

  it("sends to the bell and marks it read", async () => {
    const res = await admin(request(app).post("/admin/announcements")).send({
      title: { en: `${PREFIX} hello`, bn: "হ্যালো" },
      body: { en: "Body", bn: "দেহ" },
      topic: "product",
      plans: ["free"],
      channels: ["inApp", "banner"],
      link: "/dashboard",
      mode: "send",
    });
    expect(res.status).toBe(201);
    id = res.body.announcement.id;
    expect(id).toMatch(/^ANN-\d{4}$/);
    expect(res.body.announcement.status).toBe("sent");
    expect(res.body.announcement.delivery.reached.inApp).toBeGreaterThanOrEqual(1);

    const bell = await reader(request(app).get("/content/announcements"));
    const mine = bell.body.announcements.find((a: { id: string }) => a.id === id);
    expect(mine.read).toBe(false);
    expect(mine.title.bn).toBe("হ্যালো");

    expect((await reader(request(app).post(`/content/announcements/${id}/read`))).status).toBe(204);
    const after = await reader(request(app).get("/content/announcements"));
    expect(after.body.announcements.find((a: { id: string }) => a.id === id).read).toBe(true);

    const banner = await reader(request(app).get("/content/banner"));
    expect(banner.body.banner.id).toBe(id);
    const ended = await admin(request(app).post(`/admin/announcements/${id}/end-banner`));
    expect(ended.body.announcement.banner).toBe("ended");
    expect(ended.body.announcement.delivery.reached.banner).toBe(1);
    expect((await reader(request(app).get("/content/banner"))).body.banner).toBeNull();
  });

  it("can't edit a sent announcement but can duplicate it", async () => {
    const edit = await admin(request(app).patch(`/admin/announcements/${id}`)).send({ title: { en: "x", bn: "y" }, body: { en: "x", bn: "y" }, topic: "product", channels: ["inApp"] });
    expect(edit.status).toBe(400);
    const dup = await admin(request(app).post(`/admin/announcements/${id}/duplicate`)).send({});
    expect(dup.status).toBe(201);
    expect(dup.body.announcement.status).toBe("draft");
    expect(dup.body.announcement.title.en).toBe(`${PREFIX} hello (copy)`);
  });

  it("schedules, refuses the past, and sends what is due", async () => {
    const past = await admin(request(app).post("/admin/announcements")).send({ title: { en: `${PREFIX} s`, bn: "স" }, body: { en: "b", bn: "ব" }, topic: "legal", channels: ["inApp"], mode: "schedule", at: "2020-01-01T00:00:00Z" });
    expect(past.status).toBe(400);
    const soon = new Date(Date.now() + 60_000).toISOString();
    const sched = await admin(request(app).post("/admin/announcements")).send({ title: { en: `${PREFIX} s`, bn: "স" }, body: { en: "b", bn: "ব" }, topic: "legal", channels: ["inApp"], mode: "schedule", at: soon });
    expect(sched.body.announcement.status).toBe("scheduled");
    // Pull the time back and let the due-sender pick it up
    await db.from("announcements").update({ at: new Date(Date.now() - 1000).toISOString() }).eq("public_id", sched.body.announcement.id);
    const due = await admin(request(app).post("/admin/announcements/send-due"));
    expect(due.body.sent).toBeGreaterThanOrEqual(1);
    const got = await admin(request(app).get(`/admin/announcements/${sched.body.announcement.id}`));
    expect(got.body.announcement.status).toBe("sent");
  });
});

describe("feature flags", () => {
  it("records each change in the flag's history and audits it", async () => {
    const before = await admin(request(app).get("/admin/flags"));
    const flag = before.body.flags.find((f: { id: string }) => f.id === "caseComparison");
    const n = flag.history.length;
    const res = await admin(request(app).patch("/admin/flags/caseComparison")).send({ rollout: flag.rollout === 50 ? 60 : 50 });
    expect(res.status).toBe(200);
    expect(res.body.flag.history.length).toBe(n + 1);
    expect(res.body.flag.history.at(-1).change.kind).toBe("rollout");
    expect(res.body.flag.history.at(-1).by).toMatch(/^AGT-/);
    // Back to where it was so the flag isn't left changed by a test
    await admin(request(app).patch("/admin/flags/caseComparison")).send({ rollout: flag.rollout ?? 0 });
  });

  it("refuses an allowance on an uncounted feature", async () => {
    const res = await admin(request(app).patch("/admin/flags/laws")).send({ allowance: { free: 1, researcher: 1, professional: null } });
    expect(res.status).toBe(400);
  });
});
