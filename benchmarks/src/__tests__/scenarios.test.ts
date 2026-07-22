import { describe, it, expect } from "vitest";
import {
  judge,
  judgeScenario,
  scenarios,
  targetUrls,
  type Scenario,
} from "../scenarios.js";

describe("judge (deprecated)", () => {
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

// ---------------------------------------------------------------------------
// 厳格化した成功判定
// ---------------------------------------------------------------------------

const testScenario: Scenario = {
  id: "test",
  name: "テスト用",
  buildPrompt: (u) => `open ${u.shop}`,
  successIncludes: ["Sauce Labs Backpack"],
  successExcludes: ["Sauce Labs Bike Light"],
  maxResultChars: 100,
};

describe("judgeScenario", () => {
  it("必要な情報だけを答えていれば成功", () => {
    const r = judgeScenario("最初の商品は Sauce Labs Backpack です。", testScenario);
    expect(r.success).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("期待する文字列が無ければ失敗し、理由を返す", () => {
    const r = judgeScenario("商品が見つかりませんでした。", testScenario);
    expect(r.success).toBe(false);
    expect(r.reason).toContain("期待する文字列が含まれない");
  });

  it("聞いていない情報が混ざっていたら失敗（ページ丸写し対策）", () => {
    const r = judgeScenario(
      "Sauce Labs Backpack, Sauce Labs Bike Light",
      testScenario
    );
    expect(r.success).toBe(false);
    expect(r.reason).toContain("聞いていない情報が含まれる");
  });

  it("レスポンスが長すぎたら失敗（ページ丸写し対策）", () => {
    const long = "Sauce Labs Backpack " + "x".repeat(200);
    const r = judgeScenario(long, testScenario);
    expect(r.success).toBe(false);
    expect(r.reason).toContain("長すぎる");
  });

  it("長さチェックは他の判定より先に効く", () => {
    // 期待文字列が無く、かつ長すぎる場合は長さの理由が返る
    const r = judgeScenario("y".repeat(500), testScenario);
    expect(r.reason).toContain("長すぎる");
  });

  it("大文字小文字は無視する", () => {
    const r = judgeScenario("sauce labs backpack", testScenario);
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 計測対象の切り替え
// ---------------------------------------------------------------------------

describe("targetUrls", () => {
  it("local は同梱フィクスチャの file:// URL を返す", () => {
    const u = targetUrls("local");
    expect(u.shop).toMatch(/^file:\/\//);
    expect(u.shop).toContain("fixtures/shop/index.html");
    expect(u.tables).toMatch(/^file:\/\//);
    expect(u.tables).toContain("fixtures/tables.html");
  });

  it("remote は実サイトの URL を返す", () => {
    const u = targetUrls("remote");
    expect(u.shop).toBe("https://www.saucedemo.com");
    expect(u.tables).toBe("https://the-internet.herokuapp.com/tables");
  });
});

describe("scenarios", () => {
  it("has exactly 3 scenarios", () => {
    expect(scenarios).toHaveLength(3);
  });

  it("each scenario has required fields", () => {
    const urls = targetUrls("local");
    for (const s of scenarios) {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.buildPrompt(urls)).toBeTruthy();
      expect(Array.isArray(s.successIncludes)).toBe(true);
      expect(s.successIncludes.length).toBeGreaterThan(0);
      expect(Array.isArray(s.successExcludes)).toBe(true);
      expect(s.maxResultChars).toBeGreaterThan(0);
    }
  });

  it("scenario IDs are unique", () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prompts do not contain tool names like 'navigate' or 'click'", () => {
    const urls = targetUrls("local");
    const toolKeywords = ["navigate(", "click(", "fill_form(", "screenshot("];
    for (const s of scenarios) {
      const prompt = s.buildPrompt(urls);
      for (const kw of toolKeywords) {
        expect(prompt).not.toContain(kw);
      }
    }
  });

  it("プロンプトに対象 URL が埋め込まれる", () => {
    const local = targetUrls("local");
    const remote = targetUrls("remote");
    const login = scenarios.find((s) => s.id === "login");
    expect(login).toBeDefined();
    expect(login!.buildPrompt(local)).toContain(local.shop);
    expect(login!.buildPrompt(remote)).toContain("saucedemo.com");
  });

  it("successIncludes と successExcludes が重複していない", () => {
    for (const s of scenarios) {
      for (const inc of s.successIncludes) {
        expect(s.successExcludes.map((e) => e.toLowerCase())).not.toContain(inc.toLowerCase());
      }
    }
  });
});
