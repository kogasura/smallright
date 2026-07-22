import { describe, it, expect } from "vitest";
import { parseClaudeOutput, injectPlaywrightExecutablePath } from "../claudeRunner.js";

describe("injectPlaywrightExecutablePath", () => {
  const base = JSON.stringify({
    mcpServers: {
      playwright: { command: "npx", args: ["-y", "@playwright/mcp@0.0.78", "--headless"] },
    },
  });

  it("execPath 未指定なら元の JSON をそのまま返す", () => {
    expect(injectPlaywrightExecutablePath(base, undefined)).toBe(base);
    expect(injectPlaywrightExecutablePath(base, "")).toBe(base);
  });

  it("execPath 指定時は --executable-path を args 末尾に注入する", () => {
    const out = injectPlaywrightExecutablePath(base, "/opt/pw-browsers/chromium");
    const parsed = JSON.parse(out) as { mcpServers: { playwright: { args: string[] } } };
    const args = parsed.mcpServers.playwright.args;
    expect(args).toContain("--executable-path");
    expect(args[args.indexOf("--executable-path") + 1]).toBe("/opt/pw-browsers/chromium");
    // 既存の引数は保持される
    expect(args).toContain("--headless");
    expect(args).toContain("@playwright/mcp@0.0.78");
  });

  it("既に --executable-path があれば二重注入しない", () => {
    const withExec = JSON.stringify({
      mcpServers: {
        playwright: { command: "npx", args: ["-y", "@playwright/mcp", "--executable-path", "/x"] },
      },
    });
    expect(injectPlaywrightExecutablePath(withExec, "/other")).toBe(withExec);
  });

  it("playwright サーバー定義が無ければ元のまま", () => {
    const other = JSON.stringify({ mcpServers: { smallright: { args: ["a"] } } });
    expect(injectPlaywrightExecutablePath(other, "/x")).toBe(other);
  });

  it("壊れた JSON は元のまま返す", () => {
    expect(injectPlaywrightExecutablePath("{not json", "/x")).toBe("{not json");
  });
});

// B-2: usage 欠落・非有限数 → is_error=true の挙動を検証する
// spawn をモックせず parseClaudeOutput 純粋関数を直接テストする

const DURATION = 1000;

/** 最小限の正常 JSON を組み立てるヘルパー */
function validJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    num_turns: 2,
    total_cost_usd: 0.001,
    is_error: false,
    result: "done",
    ...overrides,
  });
}

describe("parseClaudeOutput - 正常系", () => {
  it("正常な JSON を RunResult に変換する", () => {
    const r = parseClaudeOutput(validJson(), "", DURATION);
    expect(r.is_error).toBe(false);
    expect(r.usage.input_tokens).toBe(100);
    expect(r.usage.output_tokens).toBe(50);
    expect(r.num_turns).toBe(2);
    expect(r.duration_ms).toBe(DURATION);
  });

  it("is_error=true の JSON は is_error=true として返す", () => {
    const r = parseClaudeOutput(validJson({ is_error: true }), "some stderr", DURATION);
    expect(r.is_error).toBe(true);
    expect(r.raw_error).toBeDefined();
  });
});

describe("parseClaudeOutput - JSON パースエラー", () => {
  it("不正な JSON は is_error=true を返す", () => {
    const r = parseClaudeOutput("not json", "", DURATION);
    expect(r.is_error).toBe(true);
    expect(r.raw_error).toMatch(/JSON parse error/);
  });
});

describe("parseClaudeOutput - B-2: usage 欠落・非有限数 → is_error=true", () => {
  it("usage フィールドが欠落している場合は is_error=true", () => {
    const json = JSON.stringify({
      num_turns: 1,
      total_cost_usd: 0,
      is_error: false,
      result: "ok",
    });
    const r = parseClaudeOutput(json, "", DURATION);
    expect(r.is_error).toBe(true);
    expect(r.raw_error).toMatch(/usage field missing or invalid/);
    // total_tokens が 0 のまま success 扱いにならないことを確認
    expect(r.usage.input_tokens).toBe(0);
    expect(r.usage.output_tokens).toBe(0);
  });

  it("usage が null の場合は is_error=true", () => {
    const r = parseClaudeOutput(validJson({ usage: null }), "", DURATION);
    expect(r.is_error).toBe(true);
    expect(r.raw_error).toMatch(/usage field missing or invalid/);
  });

  it("usage が配列の場合は is_error=true", () => {
    const r = parseClaudeOutput(validJson({ usage: [] }), "", DURATION);
    expect(r.is_error).toBe(true);
  });

  it("input_tokens が欠落している場合は is_error=true", () => {
    const json = JSON.stringify({
      usage: { output_tokens: 50 },
      num_turns: 1,
      is_error: false,
      result: "ok",
    });
    const r = parseClaudeOutput(json, "", DURATION);
    expect(r.is_error).toBe(true);
    expect(r.raw_error).toMatch(/usage field missing or invalid/);
  });

  it("output_tokens が欠落している場合は is_error=true", () => {
    const json = JSON.stringify({
      usage: { input_tokens: 100 },
      num_turns: 1,
      is_error: false,
      result: "ok",
    });
    const r = parseClaudeOutput(json, "", DURATION);
    expect(r.is_error).toBe(true);
  });

  it("input_tokens が文字列の場合（Number() → NaN）は is_error=true", () => {
    const r = parseClaudeOutput(
      validJson({ usage: { input_tokens: "abc", output_tokens: 50 } }),
      "",
      DURATION
    );
    expect(r.is_error).toBe(true);
  });

  it("input_tokens が null（Number(null)=0 で有限数扱い）の場合は通過する", () => {
    // null は Number(null)=0 → isFinite(0)=true なので欠落扱いにはならない
    // これは意図的な設計（null は 0 トークンとして処理される）
    const r = parseClaudeOutput(
      validJson({ usage: { input_tokens: null, output_tokens: 50 } }),
      "",
      DURATION
    );
    // null input_tokens は 0 として処理され is_error=false のまま
    expect(r.is_error).toBe(false);
    expect(r.usage.input_tokens).toBe(0);
  });

  it("有効な usage がある場合、total_tokens=0 の偽陽性は発生しない", () => {
    // usage が存在し正常数値ならば is_error=false のまま（input=100, output=50 -> total=150）
    const r = parseClaudeOutput(validJson(), "", DURATION);
    expect(r.is_error).toBe(false);
    const total =
      r.usage.input_tokens + r.usage.output_tokens;
    expect(total).toBeGreaterThan(0);
  });
});
