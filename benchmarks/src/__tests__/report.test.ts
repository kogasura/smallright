import { describe, it, expect } from "vitest";
import {
  median,
  min,
  max,
  reductionRate,
  aggregateReductionPct,
  aggregate,
  minSuccessRequired,
  reductionBlockedReason,
  parsePlaywrightMcpVersion,
  generateMarkdown,
  pct,
  contextTokens,
  billableTokens,
  CACHE_WRITE_WEIGHT,
  CACHE_READ_WEIGHT,
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

// ---------------------------------------------------------------------------
// トークン指標
// ---------------------------------------------------------------------------

describe("contextTokens", () => {
  it("キャッシュ経由の入力も含めて合計する", () => {
    expect(
      contextTokens({
        input_tokens: 100,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 300,
      })
    ).toBe(600);
  });

  it("output は含めない（モデルに渡した入力ではないため）", () => {
    const r = {
      input_tokens: 100,
      output_tokens: 999,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    expect(contextTokens(r)).toBe(100);
  });
});

describe("billableTokens", () => {
  it("キャッシュの課金係数を掛けて合計する", () => {
    const r = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 400,
      cache_read_input_tokens: 1000,
    };
    // 100 + 50 + 400*1.25 + 1000*0.1 = 100 + 50 + 500 + 100 = 750
    expect(billableTokens(r)).toBe(750);
    expect(CACHE_WRITE_WEIGHT).toBe(1.25);
    expect(CACHE_READ_WEIGHT).toBe(0.1);
  });

  it("キャッシュ読み出しが多いほど単純合計と乖離する", () => {
    const r = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 10_000,
    };
    const naiveTotal = 10_000;
    // 単純合計では 10,000 だが課金上は 1,000 相当
    expect(billableTokens(r)).toBe(1_000);
    expect(billableTokens(r)).toBeLessThan(naiveTotal);
  });
});

describe("aggregate - 指標ごとに削減率を出す", () => {
  it("キャッシュ構成が違う場合、context と billable で削減率が変わる", () => {
    // smallright: キャッシュをほとんど使わず素の入力が少ない
    // playwright: 素の入力は多いが大半がキャッシュ読み出し
    const records: RunRecord[] = [
      {
        scenario_id: "s1",
        scenario_name: "Scenario 1",
        mcp_key: "smallright",
        run_index: 0,
        input_tokens: 1000,
        output_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        total_tokens: 1100,
        num_turns: 2,
        duration_ms: 1000,
        total_cost_usd: 0.01,
        is_error: false,
        success: true,
      },
      {
        scenario_id: "s1",
        scenario_name: "Scenario 1",
        mcp_key: "playwright",
        run_index: 0,
        input_tokens: 1000,
        output_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 9000,
        total_tokens: 10100,
        num_turns: 2,
        duration_ms: 1000,
        total_cost_usd: 0.02,
        is_error: false,
        success: true,
      },
    ];

    const result = aggregate(records, "sonnet");
    const cmp = result.comparisons.find((c) => c.scenario_id === "s1");

    // context: smallright 1000 vs playwright 10000 -> 90% 削減
    expect(cmp?.token_reduction_pct).toBeCloseTo(90);

    // billable: smallright 1100 vs playwright 1100+900=2000 -> 45% 削減
    // キャッシュ読み出しは 0.1 倍なので、context ほどの差にはならない
    expect(cmp?.billable_reduction_pct).toBeCloseTo(45);

    // cost: 0.01 vs 0.02 -> 50% 削減
    expect(cmp?.cost_reduction_pct).toBeCloseTo(50);

    // 単純合計は指標として残っているが比較には使わない
    expect(cmp?.smallright?.total_tokens.median).toBe(1100);
    expect(cmp?.playwright?.total_tokens.median).toBe(10100);
  });

  it("成功 run が偏っている場合は全指標の削減率が抑制される", () => {
    const records: RunRecord[] = [
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "playwright", total_tokens: 800, success: true, is_error: false }),
      makeRecord({ mcp_key: "playwright", total_tokens: 0, success: false, is_error: true }),
      makeRecord({ mcp_key: "playwright", total_tokens: 0, success: false, is_error: true }),
    ];

    const result = aggregate(records, "sonnet");
    const cmp = result.comparisons.find((c) => c.scenario_id === "s1");
    expect(cmp?.token_reduction_pct).toBeNull();
    expect(cmp?.billable_reduction_pct).toBeNull();
    expect(cmp?.cost_reduction_pct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 表示フォーマット
// ---------------------------------------------------------------------------

describe("pct", () => {
  it("削減はマイナス表記（トークンが減った）", () => {
    expect(pct(30)).toBe("-30.0%");
  });

  it("増加はプラス表記（トークンが増えた）", () => {
    expect(pct(-12.3)).toBe("+12.3%");
  });

  it("変化なしは ± 表記", () => {
    expect(pct(0)).toBe("±0.0%");
  });

  it("算出不能は N/A", () => {
    expect(pct(null)).toBe("N/A");
  });
});

// ---------------------------------------------------------------------------
// Markdown 生成
// ---------------------------------------------------------------------------

describe("generateMarkdown", () => {
  const baseRecords: RunRecord[] = [
    makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
    makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
    makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
    makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
  ];

  it("主要セクションをすべて含む", () => {
    const md = generateMarkdown(aggregate(baseRecords, "sonnet"));
    expect(md).toContain("# Benchmark Results");
    expect(md).toContain("## Scenario Results");
    expect(md).toContain("## Detailed Stats");
    expect(md).toContain("## Overall Summary");
    expect(md).toContain("### Metrics");
  });

  it("シナリオ名と削減率を表に出す", () => {
    const md = generateMarkdown(aggregate(baseRecords, "sonnet"));
    expect(md).toContain("Scenario 1");
    // 700 vs 1000 -> 30% 削減 = -30.0%
    expect(md).toContain("-30.0%");
  });

  it("凡例と表示の符号が一致している（負の値が削減）", () => {
    const md = generateMarkdown(aggregate(baseRecords, "sonnet"));
    // 削減しているのに凡例が「正の値 = 削減」と書いてあると読者が符号を逆に読む
    expect(md).not.toContain("positive value = smallright used fewer tokens");
    expect(md).toContain("negative = smallright used less");
    expect(md).toContain("Context Δ");
    expect(md).toContain("-30.0%");
  });

  it("成功 run 数を Overall Summary に併記する", () => {
    const md = generateMarkdown(aggregate(baseRecords, "sonnet"));
    expect(md).toContain("2 / 2");
  });

  it("削減率を抑制した場合は理由を書く", () => {
    const skewed: RunRecord[] = [
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({ mcp_key: "playwright", total_tokens: 800, success: true, is_error: false }),
      makeRecord({ mcp_key: "playwright", total_tokens: 0, success: false, is_error: true }),
      makeRecord({ mcp_key: "playwright", total_tokens: 0, success: false, is_error: true }),
    ];
    const md = generateMarkdown(aggregate(skewed, "sonnet"));
    expect(md).toContain("削減率は算出していません");
    expect(md).toContain("### 削減率を算出しなかったシナリオ");
    expect(md).toContain("N/A");
  });

  it("Markdown の表が壊れていない（行頭と行末が | ）", () => {
    const md = generateMarkdown(aggregate(baseRecords, "sonnet"));
    const tableRows = md.split("\n").filter((l) => l.startsWith("|"));
    expect(tableRows.length).toBeGreaterThan(5);
    for (const row of tableRows) {
      expect(row.endsWith("|")).toBe(true);
    }
  });

  it("メタ情報を含む", () => {
    const md = generateMarkdown(aggregate(baseRecords, "sonnet"));
    expect(md).toContain("**Model**: sonnet");
    expect(md).toContain("**@playwright/mcp**:");
    expect(md).toContain("**OS**:");
  });
});

// ---------------------------------------------------------------------------
// 計測不成立 (invalid) の扱い
//
// MCP が繋がらないまま終わった run を「失敗」として数えると、対象ツールの
// 完走率が実力と無関係に下がる。invalid は分子からも分母からも外す。
// ---------------------------------------------------------------------------

describe("aggregate - invalid run", () => {
  const withInvalid = (): RunRecord[] => [
    makeRecord({
      mcp_key: "smallright",
      total_tokens: 700,
      success: true,
      is_error: false,
      status: "success",
    }),
    makeRecord({
      mcp_key: "smallright",
      total_tokens: 700,
      success: true,
      is_error: false,
      status: "success",
    }),
    // MCP が繋がらず 1 ターンで終わった run
    makeRecord({
      mcp_key: "smallright",
      total_tokens: 5000,
      success: false,
      is_error: false,
      status: "invalid",
      invalid_reason: "mcp_not_connected",
      run_index: 2,
    }),
    makeRecord({
      mcp_key: "playwright",
      total_tokens: 1000,
      success: true,
      is_error: false,
      status: "success",
    }),
    makeRecord({
      mcp_key: "playwright",
      total_tokens: 1000,
      success: true,
      is_error: false,
      status: "success",
    }),
    makeRecord({
      mcp_key: "playwright",
      total_tokens: 1000,
      success: true,
      is_error: false,
      status: "success",
    }),
  ];

  it("完走率の分母から invalid を外す（3 回中 2 成功 1 無効 → 100%）", () => {
    const result = aggregate(withInvalid(), "sonnet");
    const sr = result.stats.find((s) => s.mcp_key === "smallright")!;

    expect(sr.count).toBe(3);
    expect(sr.invalid_count).toBe(1);
    expect(sr.valid_count).toBe(2);
    expect(sr.success_count).toBe(2);
    // invalid を失敗として数えると 67% になってしまう
    expect(sr.completion_rate).toBe(1);
  });

  it("invalid run のトークンは中央値に混ざらない", () => {
    const result = aggregate(withInvalid(), "sonnet");
    const sr = result.stats.find((s) => s.mcp_key === "smallright")!;
    expect(sr.context_tokens.median).toBe(700);
  });

  it("overall に invalid 件数が記録される", () => {
    const result = aggregate(withInvalid(), "sonnet");
    expect(result.overall.smallright_invalid_runs).toBe(1);
    expect(result.overall.smallright_valid_runs).toBe(2);
    expect(result.overall.playwright_invalid_runs).toBe(0);
    // 母集団は揃っているので削減率は算出される
    expect(result.overall.reduction_suppressed_reason).toBeNull();
  });

  it("invalid が多くて有効 run が足りなければ削減率を出さない", () => {
    const records: RunRecord[] = [
      makeRecord({
        mcp_key: "smallright",
        total_tokens: 700,
        success: true,
        is_error: false,
        status: "success",
      }),
      makeRecord({
        mcp_key: "smallright",
        total_tokens: 0,
        success: false,
        is_error: false,
        status: "failure",
        run_index: 1,
      }),
      makeRecord({
        mcp_key: "smallright",
        total_tokens: 0,
        success: false,
        is_error: false,
        status: "failure",
        run_index: 2,
      }),
      makeRecord({
        mcp_key: "playwright",
        total_tokens: 1000,
        success: true,
        is_error: false,
        status: "success",
      }),
    ];
    const result = aggregate(records, "sonnet");
    expect(result.overall.overall_token_reduction_pct).toBeNull();
    expect(result.overall.reduction_suppressed_reason).toContain("成功 run が不足");
  });

  it("status を持たない旧レコードは valid として扱う（後方互換）", () => {
    const records: RunRecord[] = [
      makeRecord({ mcp_key: "smallright", total_tokens: 700, success: true, is_error: false }),
      makeRecord({
        mcp_key: "smallright",
        total_tokens: 0,
        success: false,
        is_error: false,
        run_index: 1,
      }),
      makeRecord({ mcp_key: "playwright", total_tokens: 1000, success: true, is_error: false }),
    ];
    const result = aggregate(records, "sonnet");
    const sr = result.stats.find((s) => s.mcp_key === "smallright")!;
    expect(sr.invalid_count).toBe(0);
    expect(sr.valid_count).toBe(2);
    expect(sr.completion_rate).toBe(0.5);
  });

  it("レポートに invalid の件数と内訳を出す（黙って除外しない）", () => {
    const md = generateMarkdown(aggregate(withInvalid(), "sonnet"));
    expect(md).toContain("計測不成立 (invalid) の run が 1 件");
    expect(md).toContain("mcp_not_connected");
    expect(md).toContain("| Invalid |");
  });

  it("invalid が 0 件なら警告を出さない", () => {
    const records: RunRecord[] = [
      makeRecord({
        mcp_key: "smallright",
        total_tokens: 700,
        success: true,
        is_error: false,
        status: "success",
      }),
      makeRecord({
        mcp_key: "playwright",
        total_tokens: 1000,
        success: true,
        is_error: false,
        status: "success",
      }),
    ];
    const md = generateMarkdown(aggregate(records, "sonnet"));
    expect(md).not.toContain("計測不成立 (invalid) の run が");
  });
});

describe("aggregateReductionPct", () => {
  it("シナリオ別の比率を幾何平均で集約する", () => {
    // 2倍と8倍 → 幾何平均は4倍（算術平均の5倍ではない）
    const r = aggregateReductionPct([
      { baseline: 200, target: 100 },
      { baseline: 800, target: 100 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(75, 6); // target/baseline の幾何平均 = 0.25
  });

  it("プールした中央値と違い、全シナリオが結果に反映される", () => {
    // 中央のシナリオだけが効くのではないことを確認する
    const withMiddleOnly = aggregateReductionPct([{ baseline: 100, target: 90 }]);
    const withAll = aggregateReductionPct([
      { baseline: 100, target: 90 },
      { baseline: 100, target: 50 },
      { baseline: 100, target: 99 },
    ]);
    expect(withAll).not.toBeCloseTo(withMiddleOnly!, 3);
  });

  it("増加している場合は負の値を返す", () => {
    expect(aggregateReductionPct([{ baseline: 100, target: 200 }])!).toBeCloseTo(-100, 6);
  });

  it("null や 0 以下の値は除外する", () => {
    const r = aggregateReductionPct([
      { baseline: null, target: 100 },
      { baseline: 100, target: null },
      { baseline: 0, target: 100 },
      { baseline: 200, target: 100 },
    ]);
    expect(r!).toBeCloseTo(50, 6);
  });

  it("有効な組が1つも無ければ null", () => {
    expect(aggregateReductionPct([])).toBeNull();
    expect(aggregateReductionPct([{ baseline: null, target: null }])).toBeNull();
  });
});
