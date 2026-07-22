import { describe, it, expect } from "vitest";
import { parsePreflight, formatPreflightFailure } from "../preflight.js";
import { buildClaudeArgs } from "../claudeRunner.js";

// ---------------------------------------------------------------------------
// 事前チェックの判定
// ---------------------------------------------------------------------------

describe("parsePreflight", () => {
  it("対象 MCP のツールが列挙されていれば ok", () => {
    const text =
      "mcp__smallright__navigate, mcp__smallright__click, mcp__smallright__scan_zone";
    const r = parsePreflight(text, "smallright");
    expect(r.ok).toBe(true);
    expect(r.tool_count).toBe(3);
    expect(r.reason).toBeNull();
  });

  it("重複したツール名は 1 件として数える", () => {
    const r = parsePreflight("mcp__playwright__click, mcp__playwright__click", "playwright");
    expect(r.tool_count).toBe(1);
  });

  it("NONE と返ってきたら失敗", () => {
    const r = parsePreflight("NONE", "playwright");
    expect(r.ok).toBe(false);
    expect(r.tool_count).toBe(0);
    expect(r.reason).toContain("mcp__playwright__* のツールが1つも見つかりません");
  });

  it("空文字なら失敗し、回答が空である旨を含める", () => {
    const r = parsePreflight("", "smallright");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("(空)");
  });

  it("別の MCP のツールしか無い場合は失敗（今回の事故パターン）", () => {
    // MCP config が読まれず、アカウント側のコネクタだけが見えていた状況
    const text =
      "mcp__claude_ai_Gmail__get_message, mcp__claude_ai_Slack__post_message";
    const r = parsePreflight(text, "playwright");
    expect(r.ok).toBe(false);
    expect(r.tool_count).toBe(0);
  });

  it("説明文が混ざっていてもツール名を拾える", () => {
    const text = "利用可能なツールは mcp__smallright__navigate と mcp__smallright__read_zone です。";
    const r = parsePreflight(text, "smallright");
    expect(r.ok).toBe(true);
    expect(r.tool_count).toBe(2);
  });

  it("前方一致の別サーバー名を誤検出しない", () => {
    // mcp__playwright_extra__ は playwright とは別サーバー
    const r = parsePreflight("mcp__playwrightextra__click", "playwright");
    expect(r.ok).toBe(false);
  });
});

describe("formatPreflightFailure", () => {
  it("失敗した MCP と理由を列挙する", () => {
    const msg = formatPreflightFailure([
      { mcp_key: "playwright", ok: false, tool_count: 0, reason: "接続なし" },
    ]);
    expect(msg).toContain("ベンチマークを中止しました");
    expect(msg).toContain("- playwright: 接続なし");
  });

  it("計測値が意味を持たない理由を説明する", () => {
    const msg = formatPreflightFailure([
      { mcp_key: "smallright", ok: false, tool_count: 0, reason: "x" },
    ]);
    expect(msg).toContain("計測値が意味を持ちません");
  });

  it("確認手順と回避フラグを案内する", () => {
    const msg = formatPreflightFailure([
      { mcp_key: "smallright", ok: false, tool_count: 0, reason: "x" },
    ]);
    expect(msg).toContain("npm run build");
    expect(msg).toContain("--skip-preflight");
  });
});

// ---------------------------------------------------------------------------
// claude CLI 引数の組み立て
// ---------------------------------------------------------------------------

describe("buildClaudeArgs", () => {
  const base = {
    prompt: "test",
    mcpConfigPath: "/tmp/x.json",
    model: "sonnet",
    allowedTools: "mcp__smallright__*",
  };

  it("組み込みツールを既定で無効化する", () => {
    const args = buildClaudeArgs(base, "/tmp/resolved.json");
    const i = args.indexOf("--tools");
    expect(i).toBeGreaterThan(-1);
    // 空文字を引用した形。組み込みツールを全て落とす
    expect(args[i + 1]).toBe('""');
  });

  it("disableBuiltinTools: false なら --tools を付けない", () => {
    const args = buildClaudeArgs({ ...base, disableBuiltinTools: false }, "/tmp/resolved.json");
    expect(args).not.toContain("--tools");
  });

  it("--strict-mcp-config を付けてユーザー設定の MCP を混入させない", () => {
    expect(buildClaudeArgs(base, "/tmp/resolved.json")).toContain("--strict-mcp-config");
  });

  it("解決済みの config パスを渡す（元のパスではなく）", () => {
    const args = buildClaudeArgs(base, "/tmp/resolved.json");
    const i = args.indexOf("--mcp-config");
    expect(args[i + 1]).toBe('"/tmp/resolved.json"');
  });

  it("allowedTools のグロブを引用する", () => {
    const args = buildClaudeArgs(base, "/tmp/resolved.json");
    const i = args.indexOf("--allowedTools");
    expect(args[i + 1]).toBe('"mcp__smallright__*"');
  });

  it("プロンプトは args に含めない（stdin で渡すため）", () => {
    const args = buildClaudeArgs({ ...base, prompt: "秘密のプロンプト" }, "/tmp/resolved.json");
    expect(args.join(" ")).not.toContain("秘密のプロンプト");
  });

  it("JSON 出力形式を指定する", () => {
    const args = buildClaudeArgs(base, "/tmp/resolved.json");
    const i = args.indexOf("--output-format");
    expect(args[i + 1]).toBe("json");
  });
});
