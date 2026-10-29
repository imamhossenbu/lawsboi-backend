import { describe, expect, it } from "vitest";
import { cyclesOf, isFree, isTrxId, normalizeTrxId, recurringRevenue, renewalAfter } from "../src/modules/billing/shared.js";
import { toCsv } from "../src/modules/admin/billing/csv.js";
import { areaOf } from "../src/modules/admin/audit/areas.js";

describe("transaction ids", () => {
  it("knows each wallet's shape", () => {
    expect(isTrxId("bkash", "8N4K2Q7X1M")).toBe(true);
    expect(isTrxId("bkash", "8n4k2q7x1m")).toBe(true);
    expect(isTrxId("bkash", "8N4K2Q7X")).toBe(false);
    expect(isTrxId("nagad", "8N4K2Q7X")).toBe(true);
    expect(isTrxId("nagad", "8N4K2Q7X1M")).toBe(false);
    expect(isTrxId("nagad", "8N4K-Q7X")).toBe(false);
    expect(normalizeTrxId(" 8n4k2q7x ")).toBe("8N4K2Q7X");
  });
});

describe("renewals", () => {
  it("steps a calendar month, clamping the day", () => {
    expect(renewalAfter(new Date("2026-01-31T10:00:00Z"), "monthly").toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(renewalAfter(new Date("2026-03-15T00:00:00Z"), "monthly").toISOString()).toBe("2026-04-15T00:00:00.000Z");
    expect(renewalAfter(new Date("2026-12-10T00:00:00Z"), "monthly").toISOString()).toBe("2027-01-10T00:00:00.000Z");
  });
  it("steps a year", () => {
    expect(renewalAfter(new Date("2024-02-29T00:00:00Z"), "yearly").toISOString()).toBe("2025-03-01T00:00:00.000Z");
  });
});

describe("plans", () => {
  it("tells free from paid and which cycles are sold", () => {
    expect(isFree({ price_monthly: 0, price_yearly: 0 })).toBe(true);
    expect(isFree({ price_monthly: 0, price_yearly: null })).toBe(true);
    expect(cyclesOf({ price_monthly: 0, price_yearly: 0 })).toEqual([]);
    expect(cyclesOf({ price_monthly: 100, price_yearly: null })).toEqual(["monthly"]);
    expect(cyclesOf({ price_monthly: 100, price_yearly: 960 })).toEqual(["monthly", "yearly"]);
  });
  it("adds up recurring revenue", () => {
    const mrr = recurringRevenue([
      { price_monthly: 100, price_yearly: 960, subscribers: 10, yearlySubscribers: 4 },
      { price_monthly: 300, price_yearly: 2880, subscribers: 2, yearlySubscribers: 0 },
    ]);
    expect(mrr).toBe(6 * 100 + (4 * 960) / 12 + 2 * 300);
  });
});

describe("csv", () => {
  it("quotes cells, escapes quotes and starts with a BOM", () => {
    const csv = toCsv(["A", "B"], [["x", 'say "hi"'], [null, 3]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"x","say ""hi"""');
    expect(csv.endsWith('"","3"')).toBe(true);
  });
});

describe("audit areas", () => {
  it("maps actions to the part of the panel", () => {
    expect(areaOf("payment.refund")).toBe("payments");
    expect(areaOf("team.invite")).toBe("settings");
    expect(areaOf("mystery.thing")).toBe("mystery");
  });
});
