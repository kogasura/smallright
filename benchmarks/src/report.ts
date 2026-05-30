import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as os from "node:os";
import type { RunRecord } from "./runner.js";
import { dirFromMetaUrl } from "./paths.js";

const RESULTS_DIR = path.resolve(dirFromMetaUrl(import.meta.url), "..", "results");

// ---------------------------------------------------------------------------
// 純粋関数: 統計計算
// ---------------------------------------------------------------------------

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

export function min(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.min(...values);
}

export function max(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

/**
 * 削減率 (%) を計算する。
 * reduction = (baseline - target) / baseline * 100
 * 正の値: target が baseline より少ない（削減できた）
 * 負の値: target が baseline より多い（増加した）
 */
export function reductionRate(baseline: number, target: number): number {
  if (baseline === 0) return 0;
  return ((baseline - target) / baseline) * 100;
}

// ---------------------------------------------------------------------------
// 集計型
// ---------------------------------------------------------------------------

export interface ScenarioMcpStats {
  scenario_id: string;
  scenario_name: string;
  mcp_key: "smallright" | "playwright";
  /** 全 run 数（エラー含む） */
  count: number;
  /** 成功（success===true かつ is_error===false）の run 数 */
  success_count: number;
  /** 完走率 = success_count / count（全 run ベース） */
  completion_rate: number;
  /**
   * トークン系の集計は success===true かつ is_error===false の run のみ。
   * 成功 run が 0 件の場合は null。
   */
  total_tokens: { median: number | null; min: number | null; max: number | null };
  input_tokens: { median: number | null; min: number | null; max: number | null };
  output_tokens: { median: number | null; min: number | null; max: number | null };
  cost_usd: { median: number | null; min: number | null; max: number | null };
  num_turns: { median: number | null; min: number | null; max: number | null };
}

export interface ScenarioComparison {
  scenario_id: string;
  scenario_name: string;
  smallright: ScenarioMcpStats | null;
  playwright: ScenarioMcpStats | null;
  /** 成功 run のトークン中央値ベースの削減率。算出不能の場合は null */
  token_reduction_pct: number | null;
}

export interface AggregatedResult {
  meta: {
    timestamp: string;
    model: string;
    claude_cli_version: string;
    playwright_mcp_version: string;
    os: string;
  };
  records: RunRecord[];
  stats: ScenarioMcpStats[];
  comparisons: ScenarioComparison[];
  overall: {
    /** 成功 run のトークン中央値（全シナリオ横断） */
    smallright_median_total_tokens: number | null;
    playwright_median_total_tokens: number | null;
    /** 成功 run の中央値ベースの削減率。算出不能の場合は null */
    overall_token_reduction_pct: number | null;
  };
}

// ---------------------------------------------------------------------------
// 集計ロジック
// ---------------------------------------------------------------------------

/** number[] が空なら null、要素があれば median を返す */
function medianOrNull(values: number[]): number | null {
  return values.length === 0 ? null : median(values);
}

/** number[] が空なら null、要素があれば min を返す */
function minOrNull(values: number[]): number | null {
  return values.length === 0 ? null : min(values);
}

/** number[] が空なら null、要素があれば max を返す */
function maxOrNull(values: number[]): number | null {
  return values.length === 0 ? null : max(values);
}

function computeStats(
  records: RunRecord[],
  scenario_id: string,
  scenario_name: string,
  mcp_key: "smallright" | "playwright"
): ScenarioMcpStats {
  // 全 run（エラー含む）
  const filtered = records.filter(
    (r) => r.scenario_id === scenario_id && r.mcp_key === mcp_key
  );
  // 成功 run のみ（トークン系集計に使用）
  const successRuns = filtered.filter((r) => r.success === true && r.is_error === false);
  const successCount = successRuns.length;

  return {
    scenario_id,
    scenario_name,
    mcp_key,
    count: filtered.length,
    success_count: successCount,
    // 完走率は全 run ベース
    completion_rate: filtered.length > 0 ? successCount / filtered.length : 0,
    // トークン系は成功 run のみ。0 件の場合は null
    total_tokens: {
      median: medianOrNull(successRuns.map((r) => r.total_tokens)),
      min: minOrNull(successRuns.map((r) => r.total_tokens)),
      max: maxOrNull(successRuns.map((r) => r.total_tokens)),
    },
    input_tokens: {
      median: medianOrNull(successRuns.map((r) => r.input_tokens)),
      min: minOrNull(successRuns.map((r) => r.input_tokens)),
      max: maxOrNull(successRuns.map((r) => r.input_tokens)),
    },
    output_tokens: {
      median: medianOrNull(successRuns.map((r) => r.output_tokens)),
      min: minOrNull(successRuns.map((r) => r.output_tokens)),
      max: maxOrNull(successRuns.map((r) => r.output_tokens)),
    },
    cost_usd: {
      median: medianOrNull(successRuns.map((r) => r.total_cost_usd)),
      min: minOrNull(successRuns.map((r) => r.total_cost_usd)),
      max: maxOrNull(successRuns.map((r) => r.total_cost_usd)),
    },
    num_turns: {
      median: medianOrNull(successRuns.map((r) => r.num_turns)),
      min: minOrNull(successRuns.map((r) => r.num_turns)),
      max: maxOrNull(successRuns.map((r) => r.num_turns)),
    },
  };
}

function getClaudeVersion(): string {
  try {
    // TS6 の execSync(encoding 指定) オーバーロードは shell を string 型のみ受け付けるため
    // boolean を string にキャストして渡す（実行時は true として解釈される）
    const out = execSync("claude --version", {
      encoding: "utf8",
      shell: true as unknown as string,
    });
    return out.trim();
  } catch {
    return "unknown";
  }
}

export function aggregate(records: RunRecord[], model: string): AggregatedResult {
  const scenarioIds = [...new Set(records.map((r) => r.scenario_id))];
  const scenarioNames = Object.fromEntries(
    records.map((r) => [r.scenario_id, r.scenario_name])
  );

  const stats: ScenarioMcpStats[] = [];
  for (const sid of scenarioIds) {
    const name = scenarioNames[sid] ?? sid;
    stats.push(computeStats(records, sid, name, "smallright"));
    stats.push(computeStats(records, sid, name, "playwright"));
  }

  const comparisons: ScenarioComparison[] = scenarioIds.map((sid) => {
    const smStats = stats.find((s) => s.scenario_id === sid && s.mcp_key === "smallright") ?? null;
    const pwStats = stats.find((s) => s.scenario_id === sid && s.mcp_key === "playwright") ?? null;

    // 削減率は成功 run の中央値ベース。どちらかが null なら算出不能
    let token_reduction_pct: number | null = null;
    if (
      smStats !== null &&
      pwStats !== null &&
      smStats.total_tokens.median !== null &&
      pwStats.total_tokens.median !== null
    ) {
      token_reduction_pct = reductionRate(
        pwStats.total_tokens.median,
        smStats.total_tokens.median
      );
    }

    return {
      scenario_id: sid,
      scenario_name: scenarioNames[sid] ?? sid,
      smallright: smStats,
      playwright: pwStats,
      token_reduction_pct,
    };
  });

  // 全体集計: 成功 run のトークンのみ
  const srTokens = records
    .filter((r) => r.mcp_key === "smallright" && r.success === true && r.is_error === false)
    .map((r) => r.total_tokens);
  const pwTokens = records
    .filter((r) => r.mcp_key === "playwright" && r.success === true && r.is_error === false)
    .map((r) => r.total_tokens);

  const srMedian = medianOrNull(srTokens);
  const pwMedian = medianOrNull(pwTokens);
  const overallReduction =
    srMedian !== null && pwMedian !== null ? reductionRate(pwMedian, srMedian) : null;

  return {
    meta: {
      timestamp: new Date().toISOString(),
      model,
      claude_cli_version: getClaudeVersion(),
      playwright_mcp_version: "0.0.29",
      os: `${os.platform()} ${os.release()}`,
    },
    records,
    stats,
    comparisons,
    overall: {
      smallright_median_total_tokens: srMedian,
      playwright_median_total_tokens: pwMedian,
      overall_token_reduction_pct: overallReduction,
    },
  };
}

// ---------------------------------------------------------------------------
// マークダウン表生成
// ---------------------------------------------------------------------------

/**
 * 削減率の表示文字列を返す。
 * 削減（正の値）: "30.0%" のように符号なし表記（削減が正契約）
 * 増加（負の値）: "+12.3%" のように + 記号を付けて増加であることを明示
 * N/A: 算出不能
 */
function pct(n: number | null): string {
  if (n === null) return "N/A";
  if (n >= 0) return `${n.toFixed(1)}%`;
  return `+${Math.abs(n).toFixed(1)}%`;
}

function tok(n: number | null): string {
  if (n === null) return "N/A";
  return n.toLocaleString("en-US");
}

function rate(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function generateMarkdown(result: AggregatedResult): string {
  const { meta, comparisons, overall } = result;

  const lines: string[] = [];
  lines.push("# Benchmark Results");
  lines.push("");
  lines.push(`**Date**: ${meta.timestamp}`);
  lines.push(`**Model**: ${meta.model}`);
  lines.push(`**Claude CLI**: ${meta.claude_cli_version}`);
  lines.push(`**@playwright/mcp**: ${meta.playwright_mcp_version}`);
  lines.push(`**OS**: ${meta.os}`);
  lines.push("");
  lines.push(
    "> Token medians are computed from **successful runs only** (success=true, is_error=false)."
  );
  lines.push("> Token Reduction: positive value = smallright used fewer tokens (good).");
  lines.push("> Completion rate is based on **all runs** (including errors).");
  lines.push("");

  // シナリオ別表
  lines.push("## Scenario Results");
  lines.push("");
  lines.push(
    "| Scenario | smallright (median tokens) | playwright (median tokens) | Token Reduction | smallright success | playwright success |"
  );
  lines.push(
    "|----------|---------------------------|---------------------------|-----------------|--------------------|--------------------|"
  );

  for (const cmp of comparisons) {
    const srTok = cmp.smallright ? tok(cmp.smallright.total_tokens.median) : "N/A";
    const pwTok = cmp.playwright ? tok(cmp.playwright.total_tokens.median) : "N/A";
    const reduction = pct(cmp.token_reduction_pct);
    const srRate = cmp.smallright ? rate(cmp.smallright.completion_rate) : "N/A";
    const pwRate = cmp.playwright ? rate(cmp.playwright.completion_rate) : "N/A";
    lines.push(
      `| ${cmp.scenario_name} | ${srTok} | ${pwTok} | ${reduction} | ${srRate} | ${pwRate} |`
    );
  }

  lines.push("");

  // 詳細表（min/max）
  lines.push("## Detailed Stats");
  lines.push("");
  lines.push(
    "| Scenario | MCP | Runs | Success | Completion | Median total | Min | Max | Median input | Median output | Median turns | Median cost (USD) |"
  );
  lines.push(
    "|----------|-----|------|---------|------------|-------------|-----|-----|-------------|--------------|-------------|------------------|"
  );

  for (const cmp of comparisons) {
    for (const st of [cmp.smallright, cmp.playwright]) {
      if (!st) continue;
      const medTurns = st.num_turns.median;
      lines.push(
        `| ${st.scenario_name} | ${st.mcp_key} | ${st.count} | ${st.success_count} | ${rate(st.completion_rate)} | ${tok(st.total_tokens.median)} | ${tok(st.total_tokens.min)} | ${tok(st.total_tokens.max)} | ${tok(st.input_tokens.median)} | ${tok(st.output_tokens.median)} | ${medTurns !== null ? medTurns.toFixed(1) : "N/A"} | ${st.cost_usd.median !== null ? `$${st.cost_usd.median.toFixed(4)}` : "N/A"} |`
      );
    }
  }

  lines.push("");

  // 総合表
  lines.push("## Overall Summary");
  lines.push("");
  lines.push("| MCP | Median total tokens (successful runs, all scenarios) |");
  lines.push("|-----|------------------------------------------------------|");
  lines.push(`| smallright | ${tok(overall.smallright_median_total_tokens)} |`);
  lines.push(`| playwright | ${tok(overall.playwright_median_total_tokens)} |`);
  lines.push(`| **Token reduction** | **${pct(overall.overall_token_reduction_pct)}** |`);
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// ファイル出力
// ---------------------------------------------------------------------------

export function writeResults(result: AggregatedResult): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const jsonPath = path.join(RESULTS_DIR, "results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`Results JSON written: ${jsonPath}`);

  const mdPath = path.join(RESULTS_DIR, "results.md");
  fs.writeFileSync(mdPath, generateMarkdown(result), "utf-8");
  console.log(`Results Markdown written: ${mdPath}`);
}

// ---------------------------------------------------------------------------
// コンソール要約
// ---------------------------------------------------------------------------

export function printSummary(result: AggregatedResult): void {
  const { comparisons, overall } = result;

  console.log("\n========== BENCHMARK SUMMARY ==========");
  console.log("(Token medians: successful runs only. Completion rate: all runs.)");
  console.log(
    `${"Scenario".padEnd(35)} ${"smallright".padStart(12)} ${"playwright".padStart(12)} ${"Reduction".padStart(10)} ${"SR ok".padStart(6)} ${"PW ok".padStart(6)}`
  );
  console.log("-".repeat(85));

  for (const cmp of comparisons) {
    const srTok = cmp.smallright ? tok(cmp.smallright.total_tokens.median) : "N/A";
    const pwTok = cmp.playwright ? tok(cmp.playwright.total_tokens.median) : "N/A";
    const reduction = pct(cmp.token_reduction_pct);
    const srRate = cmp.smallright ? rate(cmp.smallright.completion_rate) : "N/A";
    const pwRate = cmp.playwright ? rate(cmp.playwright.completion_rate) : "N/A";

    console.log(
      `${cmp.scenario_name.padEnd(35)} ${srTok.padStart(12)} ${pwTok.padStart(12)} ${reduction.padStart(10)} ${srRate.padStart(6)} ${pwRate.padStart(6)}`
    );
  }

  console.log("-".repeat(85));
  console.log(
    `${"OVERALL (median across all)".padEnd(35)} ${tok(overall.smallright_median_total_tokens).padStart(12)} ${tok(overall.playwright_median_total_tokens).padStart(12)} ${pct(overall.overall_token_reduction_pct).padStart(10)}`
  );
  console.log("=".repeat(85));
}
