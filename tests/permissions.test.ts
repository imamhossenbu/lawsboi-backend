import { describe, expect, it } from "vitest";
import { allActions, can, normalizePermissions, presets } from "../src/modules/admin/team/permissions.js";

describe("permissions", () => {
  it("gives admins everything", () => {
    expect(can({ role: "admin", permissions: [] }, "payments.refund")).toBe(true);
  });

  it("needs the action and the part's view", () => {
    expect(can({ role: "support", permissions: presets.support }, "support.reply")).toBe(true);
    expect(can({ role: "support", permissions: presets.support }, "payments.refund")).toBe(false);
    expect(can({ role: "support", permissions: ["support.reply"] }, "support.reply")).toBe(false);
  });

  it("every preset only holds known actions", () => {
    const known = new Set(allActions);
    for (const role of Object.keys(presets) as (keyof typeof presets)[]) {
      for (const a of presets[role]) expect(known.has(a)).toBe(true);
    }
  });

  it("drops unknown keys and orphans without view", () => {
    expect(normalizePermissions(["support.reply", "nope.x", "laws.view", "laws.edit"])).toEqual(["laws.view", "laws.edit"]);
  });
});
