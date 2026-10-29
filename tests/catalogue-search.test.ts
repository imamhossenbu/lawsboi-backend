import { describe, expect, it } from "vitest";
import { orderIdOf } from "../src/modules/catalogue/editorial.js";
import { clip, latinDigits, parseQuery, sectionLabel, toTsQuery } from "../src/modules/catalogue/shared.js";
import { slugify } from "../src/modules/admin/catalogue/schemas.js";

describe("query parsing", () => {
  it("names a section in English and Bangla", () => {
    expect(parseQuery("section 151").numbers).toEqual(["151"]);
    expect(parseQuery("ধারা ১৫১ কী বলে").numbers).toEqual(["151"]);
    expect(parseQuery("ধারা ১৫১ কী বলে").words).toEqual(["কী", "বলে"]);
  });

  it("names an Order and a Rule", () => {
    expect(parseQuery("order 39 rule 1").numbers).toEqual(["39.1"]);
    expect(parseQuery("o.39 r.1 injunction").numbers).toEqual(["39.1"]);
    expect(parseQuery("Order XXXIX").numbers).toEqual(["xxxix"]);
  });

  it("treats a bare number as a provision, not a word", () => {
    expect(parseQuery("144")).toEqual({ numbers: ["144"], words: [] });
    expect(parseQuery("১৪৪")).toEqual({ numbers: ["144"], words: [] });
  });

  it("keeps the words around a named provision", () => {
    const { numbers, words } = parseQuery("section 9 civil suits barred");
    expect(numbers).toEqual(["9"]);
    expect(words).toEqual(["civil", "suits", "barred"]);
  });
});

describe("tsquery", () => {
  it("ANDs the words and prefixes the longer ones", () => {
    expect(toTsQuery(["temporary", "injunction", "of"])).toBe("temporary:* & injunction:* & of");
  });
  it("drops symbols and gives null for nothing", () => {
    expect(toTsQuery(["(a)", "!"])).toBeNull();
    expect(toTsQuery(["সাক্ষ্য"])).toBe("সাক্ষ্য:*");
  });
});

describe("helpers", () => {
  it("converts Bangla digits", () => expect(latinDigits("১৯০৮ ধারা ৩")).toBe("1908 ধারা 3"));
  it("labels provisions in both languages", () => {
    expect(sectionLabel("151")).toEqual({ en: "Section 151", bn: "ধারা ১৫১" });
    expect(sectionLabel("102", "articles")).toEqual({ en: "Article 102", bn: "অনুচ্ছেদ ১০২" });
  });
  it("clips on a word boundary", () => expect(clip("one two three four", 9)).toBe("one two…"));
  it("turns romans into order ids", () => {
    expect(orderIdOf("XXXIX")).toBe("39");
    expect(orderIdOf("XXVIIA")).toBe("27A");
    expect(orderIdOf("LI")).toBe("51");
  });
  it("makes slugs the way the catalogue names laws", () => {
    expect(slugify("The Evidence Act, 1872", 1872)).toBe("evidence-act-1872");
    expect(slugify("Digital Security Act", 2018)).toBe("digital-security-act-2018");
  });
});
