import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseArgs } from "../index.js";
import { shellQuote, resolveMcpConfig } from "../claudeRunner.js";

// ---------------------------------------------------------------------------
// CLI 引数パース
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("引数なしなら既定値を返す", () => {
    const a = parseArgs([]);
    expect(a.repeat).toBe(3);
    expect(a.model).toBe("sonnet");
    // 既定は再現性のあるローカルフィクスチャ
    expect(a.target).toBe("local");
    expect(a.scenarioIds).toBeUndefined();
    expect(a.mcpKeys).toBeUndefined();
  });

  it("--repeat を数値として読む", () => {
    expect(parseArgs(["--repeat", "5"]).repeat).toBe(5);
  });

  it("不正な --repeat は既定値を維持して警告する", () => {
    expect(parseArgs(["--repeat", "abc"]).repeat).toBe(3);
    expect(parseArgs(["--repeat", "0"]).repeat).toBe(3);
    expect(parseArgs(["--repeat", "-1"]).repeat).toBe(3);
    expect(warn).toHaveBeenCalled();
  });

  it("--model を読む", () => {
    expect(parseArgs(["--model", "claude-sonnet-4-5"]).model).toBe("claude-sonnet-4-5");
  });

  it("--target は local / remote のみ受け付ける", () => {
    expect(parseArgs(["--target", "remote"]).target).toBe("remote");
    expect(parseArgs(["--target", "local"]).target).toBe("local");
    // 不正値は既定値のまま
    expect(parseArgs(["--target", "staging"]).target).toBe("local");
    expect(warn).toHaveBeenCalled();
  });

  it("--scenario をカンマ区切りで読む", () => {
    expect(parseArgs(["--scenario", "login,table"]).scenarioIds).toEqual(["login", "table"]);
  });

  it("--scenario の前後の空白を落とす", () => {
    expect(parseArgs(["--scenario", " login , table "]).scenarioIds).toEqual(["login", "table"]);
  });

  it("--scenario を複数回指定できる", () => {
    expect(parseArgs(["--scenario", "login", "--scenario", "table"]).scenarioIds).toEqual([
      "login",
      "table",
    ]);
  });

  it("--mcp は既知のキーのみ採用し、不明なキーは警告する", () => {
    const a = parseArgs(["--mcp", "smallright,unknown,playwright"]);
    expect(a.mcpKeys).toEqual(["smallright", "playwright"]);
    expect(warn).toHaveBeenCalled();
  });

  it("値のないフラグは無視される", () => {
    const a = parseArgs(["--repeat"]);
    expect(a.repeat).toBe(3);
  });

  it("複数のオプションを組み合わせられる", () => {
    const a = parseArgs(["--repeat", "2", "--target", "remote", "--mcp", "smallright"]);
    expect(a.repeat).toBe(2);
    expect(a.target).toBe("remote");
    expect(a.mcpKeys).toEqual(["smallright"]);
  });
});

// ---------------------------------------------------------------------------
// シェル引数の引用
// ---------------------------------------------------------------------------

describe("shellQuote", () => {
  it("グロブを引用してシェル展開を防ぐ", () => {
    expect(shellQuote("mcp__smallright__*")).toBe('"mcp__smallright__*"');
  });

  it("スペースを含むパスを引用する", () => {
    expect(shellQuote("/path with space/config.json")).toBe('"/path with space/config.json"');
  });

  it("値に含まれる二重引用符は除去する", () => {
    expect(shellQuote('a"b')).toBe('"ab"');
  });
});

// ---------------------------------------------------------------------------
// MCP config のプレースホルダ解決
// ---------------------------------------------------------------------------

describe("resolveMcpConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smallright-bench-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("プレースホルダが無い config はそのままのパスを返す", () => {
    const p = path.join(tmpDir, "plain.mcp.json");
    fs.writeFileSync(p, JSON.stringify({ mcpServers: { playwright: { args: [] } } }), "utf-8");
    expect(resolveMcpConfig(p)).toBe(p);
  });

  it("プレースホルダを dist の絶対パスに置換した一時ファイルを返す", () => {
    const p = path.join(tmpDir, "with-placeholder.mcp.json");
    fs.writeFileSync(
      p,
      JSON.stringify({ mcpServers: { smallright: { args: ["{{SMALLRIGHT_DIST}}"] } } }),
      "utf-8"
    );

    const resolved = resolveMcpConfig(p);
    try {
      // 元ファイルとは別の一時ファイルが返る
      expect(resolved).not.toBe(p);
      const body = fs.readFileSync(resolved, "utf-8");
      expect(body).not.toContain("{{SMALLRIGHT_DIST}}");
      expect(body).toContain("dist/index.js");
      // 絶対パスに解決されている
      const parsed = JSON.parse(body) as {
        mcpServers: { smallright: { args: string[] } };
      };
      expect(path.isAbsolute(parsed.mcpServers.smallright.args[0]!.replace(/\//g, path.sep))).toBe(
        true
      );
    } finally {
      fs.rmSync(resolved, { force: true });
    }
  });
});
