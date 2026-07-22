import { describe, it, expect } from "vitest";
import {
  median,
  min,
  max,
  reductionRate,
  aggregate,
  minSuccessRequired,
  reductionBlockedReason,
  parsePlaywrightMcpVersion,
} from "../report.js";
import type { RunRecord } from "../runner.js";

describe("median", () => {
  it("returns 0 for empty array", () => {
    expect(median([])).toBe(0);
  });

  it("returns value for single element", () => {
    expect(median([42])).toBe(42);
  });

  it("returns middle for odd-length array", () => {
    expect(median([1, 3, 5])).toBe(3);
  });

  it("returns average of two middle values for even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("sorts before computing", () => {
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe("min", () => {
  it("returns 0 for empty array", () => {
    expect(min([])).toBe(0);
  });

  it("returns minimum value", () => {
    expect(min([3, 1, 2])).toBe(1);
  });
});

describe("max", () => {
  it("returns 0 for empty array", () => {
    expect(max([])).toBe(0);
  });

  it("returns maximum value", () => {
    expect(max([3, 1, 2])).toBe(3);
  });
});

describe("reductionRate", () => {
  it("returns 0 when baseline is 0", () => {
    expect(reductionRate(0, 100)).toBe(0);
  });

  it("returns positive when target < baseline", () => {
    expect(reductionRate(1000, 700)).toBeCloseTo(30);
  });

  it("returns negative when target > baseline", () => {
    expect(reductionRate(700, 1000)).toBeCloseTo(-42.857, 2);
  });

  it("returns 0 when equal", () => {
    expect(reductionRate(500, 500)).toBe(0);
  });

  it("returns 100 when target is 0", () => {
    expect(reductionRate(500, 0)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// aggregate のテスト
// ---------------------------------------------------------------------------

/** テスト用の RunRecord を生成するヘルパー */
function makeRecord(
  overrides: Partial<RunRecord> & {
    mcp_key: "smallright" | "playwright";
    total_tokens: number;
    success: boolean;
    is_error: boolean;
  }
): RunRecord {
  return {
    scenario_id: "s1",
    scenario_name: "Scenario 1",
    run_index: 0,
    input_tokens: overrides.total_tokens,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    num_turns: 2,
    duration_ms: 1000,
    total_cost_usd: 0.01,
    raw_error: undefined,
    ...overrides,
  };
}

describe("aggregate - 成功 run のみトークン集計", () => {
  it("エラー run はトークン中央値から除外される", () => {
    const records: RunRecord[] = [
      // 成功 run: tokens=700
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      // エラー run: tokens=0（除外されるべき）
      makeRecord({ mcp_key: "smallright", total_tokens: 0, success: false, is_error: true }),
      // playwright 成功 run: tokens=1000
      makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
    ];

    const result = aggregate(records, "sonnet");
    const smStats = result.stats.find((s) => s.mcp_key === "smallright");
    expect(smStats).toBeDefined();
    // エラー run(0)を除外して成功 run(700)のみの中央値
    expect(smStats!.total_tokens.median).toBe(700);
    // 全 run 数は 2
    expect(smStats!.count).toBe(2);
    // 成功 run 数は 1
    expect(smStats!.success_count).toBe(1);
  });

  it("失敗(success=false)だがエラーでない run もトークン中央値から除外される", () => {
    const records: RunRecord[] = [
      // 成功 run: tokens=800
      makeRecord({ mcp_key: "smallright", total_tokens: 800, success: true, is_error: false }),
      // 失敗 run（タスク未達成、エラーではない）: tokens=900（除外されるべき）
      makeRecord({ mcp_key: "smallright", total_tokens: 900, success: false, is_error: false }),
      makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
    ];

    const result = aggregate(records, "sonnet");
    const smStats = result.stats.find((s) => s.mcp_key === "smallright");
    expect(smStats).toBeDefined();
    // success===true かつ is_error===false の run のみ（tokens=800）
    expect(smStats!.total_tokens.median).toBe(800);
  });

  it("成功 run が 0 件の場合、トークン中央値は null になりクラッシュしない", () => {
    const records: RunRecord[] = [
      // エラーのみ
      makeRecord({ mcp_key: "smallright", total_tokens: 0, success: false, is_error: true }),
      makeRecord({ mcp_key: "playwright", total_tokens: 0, success: false, is_error: true }),
    ];

    const result = aggregate(records, "sonnet");
    const smStats = result.stats.find((s) => s.mcp_key === "smallright");
    expect(smStats).toBeDefined();
    expect(smStats!.total_tokens.median).toBeNull();
    // 削減率も null（算出不能）
    const cmp = result.comparisons.find((c) => c.scenario_id === "s1");
    expect(cmp?.token_reduction_pct).toBeNull();
  });
});

describe("aggregate - 完走率は全 run ベース", () => {
  it("completion_rate = success_count / count (全 run)", () => {
    const records: RunRecord[] = [
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "smallright", total_tokens: 0, success: false, is_error: true }),
      makeRecord({ mcp_key: "smallright", total_tokens: 0, success: false, is_error: true }),
      makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
    ];

    const result = aggregate(records, "sonnet");
    const smStats = result.stats.find((s) => s.mcp_key === "smallright");
    expect(smStats).toBeDefined();
    expect(smStats!.count).toBe(3);
    expect(smStats!.success_count).toBe(1);
    // 完走率 = 1/3
    expect(smStats!.completion_rate).toBeCloseTo(1 / 3);
  });
});

describe("aggregate - 削減率の符号（B-2修正確認）", () => {
  it("smallright が playwright より少ないトークンの場合、削減率は正の値", () => {
    const records: RunRecord[] = [
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
    ];

    const result = aggregate(records, "sonnet");
    const cmp = result.comparisons.find((c) => c.scenario_id === "s1");
    expect(cmp?.token_reduction_pct).toBeCloseTo(30);
    // overall も正の値
    expect(result.overall.overall_token_reduction_pct).toBeCloseTo(30);
  });

  it("smallright が playwright より多いトークンの場合、削減率は負の値", () => {
    const records: RunRecord[] = [
      makeRecord({ mcp_key: "smallright", total_tokens: 1200, success: true, is_error: false }),
      makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
    ];

    const result = aggregate(records, "sonnet");
    const cmp = result.comparisons.find((c) => c.scenario_id === "s1");
    expect(cmp?.token_reduction_pct).toBeCloseTo(-20);
  });
});

// ---------------------------------------------------------------------------
// 成功 run 数のガード
// ---------------------------------------------------------------------------

describe("minSuccessRequired", () => {
  it("run 数の半数（切り上げ）を返す", () => {
    expect(minSuccessRequired(3)).toBe(2);
    expect(minSuccessRequired(4)).toBe(2);
    expect(minSuccessRequired(5)).toBe(3);
  });

  it("run 数が 1 以下でも最低 1 を返す", () => {
    expect(minSuccessRequired(1)).toBe(1);
    expect(minSuccessRequired(0)).toBe(1);
  });
});

describe("reductionBlockedReason", () => {
  it("双方が過半数成功していれば null（算出可能）", () => {
    expect(reductionBlockedReason(3, 2, 3, 3)).toBeNull();
  });

  it("片方の成功 run が過半数を下回る場合は理由を返す", () => {
    const reason = reductionBlockedReason(3, 3, 3, 1);
    expect(reason).not.toBeNull();
    expect(reason).toContain("playwright 1/3");
  });

  it("run が 0 件の MCP がある場合は理由を返す", () => {
    expect(reductionBlockedReason(3, 3, 0, 0)).toContain("run が存在しない");
  });
});

describe("aggregate - 成功率が偏った場合は削減率を出さない", () => {
  it("playwright が 3 回中 1 回しか成功していない場合、削減率は null になる", () => {
    const records: RunRecord[] = [
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      // playwright は 1 回だけ成功。しかもたまたま軽い run
      makeRecord({ mcp_key: "playwright", total_tokens: 800, success: true, is_error: false }),
      makeRecord({ mcp_key: "playwright", total_tokens: 0, success: false, is_error: true }),
      makeRecord({ mcp_key: "playwright", total_tokens: 0, success: false, is_error: true }),
    ];

    const result = aggregate(records, "sonnet");
    const cmp = result.comparisons.find((c) => c.scenario_id === "s1");

    // 中央値だけ見れば 12.5% の削減に見えるが、母集団が偏っているので出さない
    expect(cmp?.token_reduction_pct).toBeNull();
    expect(cmp?.reduction_suppressed_reason).toContain("成功 run が不足");

    // overall も同様に抑制される
    expect(result.overall.overall_token_reduction_pct).toBeNull();
    expect(result.overall.reduction_suppressed_reason).not.toBeNull();
  });

  it("成功 run 数は overall に記録される", () => {
    const records: RunRecord[] = [
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "smallright", total_tokens: 0, success: false, is_error: true }),
      makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
    ];

    const result = aggregate(records, "sonnet");
    expect(result.overall.smallright_runs).toBe(2);
    expect(result.overall.smallright_success_runs).toBe(1);
    expect(result.overall.playwright_runs).toBe(1);
    expect(result.overall.playwright_success_runs).toBe(1);
  });

  it("双方が過半数成功していれば従来どおり削減率を出す", () => {
    const records: RunRecord[] = [
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
      makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
    ];

    const result = aggregate(records, "sonnet");
    const cmp = result.comparisons.find((c) => c.scenario_id === "s1");
    expect(cmp?.reduction_suppressed_reason).toBeNull();
    expect(cmp?.token_reduction_pct).toBeCloseTo(30);
  });
});

// ---------------------------------------------------------------------------
// @playwright/mcp バージョンの取得
// ---------------------------------------------------------------------------

describe("parsePlaywrightMcpVersion", () => {
  it("args のバージョン指定を読む", () => {
    const json = JSON.stringify({
      mcpServers: {
        playwright: {
          command: "npx",
          args: ["-y", "@playwright/mcp@0.0.29", "--headless"],
        },
      },
    });
    expect(parsePlaywrightMcpVersion(json)).toBe("0.0.29");
  });

  it("バージョン指定がない場合は latest を返す", () => {
    const json = JSON.stringify({
      mcpServers: { playwright: { args: ["-y", "@playwright/mcp"] } },
    });
    expect(parsePlaywrightMcpVersion(json)).toBe("latest");
  });

  it("該当する引数がなければ unknown を返す", () => {
    const json = JSON.stringify({ mcpServers: { playwright: { args: ["-y"] } } });
    expect(parsePlaywrightMcpVersion(json)).toBe("unknown");
  });

  it("不正な JSON でも例外を投げず unknown を返す", () => {
    expect(parsePlaywrightMcpVersion("{ broken")).toBe("unknown");
  });
});
