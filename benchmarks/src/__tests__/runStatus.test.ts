import { describe, it, expect } from "vitest";
import { classifyRun, filterMcpTools } from "../runStatus.js";

const OK_JUDGE = { success: true, reason: null };
const NG_JUDGE = { success: false, reason: "期待する文字列が含まれない: Smith" };

describe("filterMcpTools", () => {
  it("指定 MCP のツールだけを返す", () => {
    const names = ["Read", "mcp__smallright__navigate", "mcp__playwright__browser_click"];
    expect(filterMcpTools(names, "smallright")).toEqual(["mcp__smallright__navigate"]);
    expect(filterMcpTools(names, "playwright")).toEqual(["mcp__playwright__browser_click"]);
  });

  it("該当が無ければ空配列", () => {
    expect(filterMcpTools(["Read", "Bash"], "smallright")).toEqual([]);
  });
});

describe("classifyRun", () => {
  it("ツールが接続され、呼ばれ、判定も通れば success", () => {
    const c = classifyRun({
      mcpKey: "smallright",
      is_error: false,
      toolsAvailable: ["mcp__smallright__navigate"],
      toolsUsed: ["mcp__smallright__navigate"],
      judged: OK_JUDGE,
    });
    expect(c.status).toBe("success");
    expect(c.detail).toBeNull();
  });

  it("ツールを使ったうえで判定に落ちたら failure", () => {
    const c = classifyRun({
      mcpKey: "smallright",
      is_error: false,
      toolsAvailable: ["mcp__smallright__navigate"],
      toolsUsed: ["mcp__smallright__navigate", "mcp__smallright__read_text"],
      judged: NG_JUDGE,
    });
    expect(c.status).toBe("failure");
    expect(c.detail).toBe(NG_JUDGE.reason);
  });

  it("MCP ツールが接続されていなければ invalid（判定には進まない）", () => {
    const c = classifyRun({
      mcpKey: "smallright",
      is_error: false,
      toolsAvailable: [],
      toolsUsed: [],
      judged: NG_JUDGE,
    });
    expect(c.status).toBe("invalid");
    expect(c.invalid_reason).toBe("mcp_not_connected");
    // 「期待する文字列が含まれない」という失敗理由に化けてはいけない
    expect(c.detail).not.toBe(NG_JUDGE.reason);
  });

  it("他 MCP のツールしか無い場合も invalid", () => {
    const c = classifyRun({
      mcpKey: "smallright",
      is_error: false,
      toolsAvailable: ["mcp__playwright__browser_navigate"],
      toolsUsed: ["mcp__playwright__browser_navigate"],
      judged: NG_JUDGE,
    });
    expect(c.status).toBe("invalid");
    expect(c.invalid_reason).toBe("mcp_not_connected");
  });

  it("接続はされていたが一度も呼ばれなければ invalid", () => {
    const c = classifyRun({
      mcpKey: "smallright",
      is_error: false,
      toolsAvailable: ["mcp__smallright__navigate"],
      toolsUsed: [],
      judged: NG_JUDGE,
    });
    expect(c.status).toBe("invalid");
    expect(c.invalid_reason).toBe("mcp_tools_unused");
  });

  it("ツールを使わずに正解しても invalid（計測を通っていないため）", () => {
    const c = classifyRun({
      mcpKey: "smallright",
      is_error: false,
      toolsAvailable: ["mcp__smallright__navigate"],
      toolsUsed: [],
      judged: OK_JUDGE,
    });
    expect(c.status).toBe("invalid");
  });

  it("エラー終了は他の判定より優先される", () => {
    const c = classifyRun({
      mcpKey: "smallright",
      is_error: true,
      toolsAvailable: [],
      toolsUsed: [],
      judged: NG_JUDGE,
      rawError: "timeout: exceeded 300000ms, process killed",
    });
    expect(c.status).toBe("error");
    expect(c.detail).toContain("timeout");
  });
});
