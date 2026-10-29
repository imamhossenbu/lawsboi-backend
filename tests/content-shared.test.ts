import { describe, expect, it } from "vitest";
import { announcementOf, articleGaps, bannerState, gaps, pageGaps, slugify } from "../src/modules/content/shared.js";

describe("content helpers", () => {
  it("lists the languages text is still missing in", () => {
    expect(gaps([{ en: "Hi", bn: "" }])).toEqual(["bn"]);
    expect(gaps([{ en: " ", bn: "হাই" }, { en: "x", bn: "y" }])).toEqual(["en"]);
    expect(articleGaps({ title: { en: "a", bn: "b" }, summary: { en: "c", bn: "d" }, steps: [{ en: "e", bn: "" }] })).toEqual(["bn"]);
    expect(pageGaps([{ id: "s", title: { en: "t", bn: "ট" }, body: [], items: [{ title: { en: "", bn: "x" }, text: { en: "y", bn: "z" } }] }])).toEqual(["en"]);
  });

  it("makes unique slugs", () => {
    const taken = new Set(["how-to-search-for-a-law"]);
    expect(slugify("How to search for a law", taken)).toBe("how-to-search-for-a-law-2");
    expect(slugify("!!!", new Set(), "article")).toBe("article");
  });

  it("knows whether a banner is up", () => {
    const now = Date.parse("2026-10-30T00:00:00Z");
    const base = { channels: ["banner"] as ("in_app" | "email" | "banner")[], status: "sent" as const, banner_ended: false, banner_until: null };
    expect(bannerState(base, now)).toBe("live");
    expect(bannerState({ ...base, banner_until: "2026-10-29T00:00:00Z" }, now)).toBe("ended");
    expect(bannerState({ ...base, banner_until: "2026-11-29T00:00:00Z" }, now)).toBe("live");
    expect(bannerState({ ...base, banner_ended: true }, now)).toBe("ended");
    expect(bannerState({ ...base, status: "scheduled" }, now)).toBe("waiting");
    expect(bannerState({ ...base, channels: ["in_app"] }, now)).toBeNull();
  });

  it("maps channels to the reader's names and hides delivery until sent", () => {
    const row = {
      id: "u", number: 1, public_id: "ANN-0001", title: "T", title_bn: "ট", body: "B", body_bn: "ব", topic: "product" as const, plan_ids: [], channels: ["in_app", "banner"] as ("in_app" | "email" | "banner")[],
      link: "/dashboard", status: "draft" as const, at: "2026-10-30T00:00:00Z", sent_at: null, sending_started_at: null, banner_until: null, banner_ended: false, delivery: null, created_by: null, created_at: "", updated_at: "",
    };
    const a = announcementOf(row);
    expect(a.channels).toEqual(["inApp", "banner"]);
    expect(a.delivery).toBeUndefined();
    expect(announcementOf({ ...row, status: "sent" }, { reached: { inApp: 3 }, opened: {} }).delivery).toEqual({ reached: { inApp: 3 }, opened: {} });
  });
});
