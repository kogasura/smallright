import { describe, it, expect } from "vitest";
import { judge, scenarios } from "../scenarios.js";

describe("judge", () => {
  it("returns true when all strings are present (case-insensitive)", () => {
    expect(judge("The product Sauce Labs Backpack is shown.", ["Sauce Labs Backpack"])).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(judge("sauce labs backpack", ["Sauce Labs Backpack"])).toBe(true);
  });

  it("returns false when any string is missing", () => {
    expect(judge("Smith is here", ["Smith", "jsmith@gmail.com"])).toBe(false);
  });

  it("returns true when all strings are present", () => {
    expect(judge("Smith jsmith@gmail.com", ["Smith", "jsmith@gmail.com"])).toBe(true);
  });

  it("returns true for empty successIncludes", () => {
    expect(judge("anything", [])).toBe(true);
  });

  it("returns false for empty result with non-empty successIncludes", () => {
    expect(judge("", ["Smith"])).toBe(false);
  });
});

describe("scenarios", () => {
  it("has exactly 3 scenarios", () => {
    expect(scenarios).toHaveLength(3);
  });

  it("each scenario has required fields", () => {
    for (const s of scenarios) {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.prompt).toBeTruthy();
      expect(Array.isArray(s.successIncludes)).toBe(true);
      expect(s.successIncludes.length).toBeGreaterThan(0);
    }
  });

  it("scenario IDs are unique", () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prompts do not contain tool names like 'navigate' or 'click'", () => {
    const toolKeywords = ["navigate(", "click(", "fill_form(", "screenshot("];
    for (const s of scenarios) {
      for (const kw of toolKeywords) {
        expect(s.prompt).not.toContain(kw);
      }
    }
  });
});
