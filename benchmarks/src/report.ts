import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as os from "node:os";
import type { RunRecord } from "./runner.js";
import { dirFromMetaUrl } from "./paths.js";

const RESULTS_DIR = path.resolve(dirFromMetaUrl(import.meta.url), "..", "results");
const CONFIGS_DIR = path.resolve(dirFromMetaUrl(import.meta.url), "..", "configs");

/**
 * 削減率を算出するために必要な成功 run の最低数。
 * 全 run の半数（切り上げ）かつ 1 件以上を要求する。
 */
export function minSuccessRequired(count: number): number {
  return Math.max(1, Math.ceil(count / 2));
}

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
// トークン指標
//
// 4 種類のトークン（input / output / cache_creation / cache_read）を単純合計
// しても、コストにもコンテキスト量にも対応しない中間的な数字にしかならない。
// 用途ごとに指標を分ける。
// ---------------------------------------------------------------------------

/** キャッシュ書き込みの課金係数（base input 比） */
export const CACHE_WRITE_WEIGHT = 1.25;
/** キャッシュ読み出しの課金係数（base input 比） */
export const CACHE_READ_WEIGHT = 0.1;

/**
 * モデルに渡された入力コンテキストの総量。
 *
 * キャッシュ経由で渡された分も「モデルが読んだコンテキスト」なので含める。
 * smallright の主張（LLM に渡すコンテキストを減らす）に直接対応する主指標。
 */
export function contextTokens(r: {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}): number {
  return r.input_tokens + r.cache_creation_input_tokens + r.cache_read_input_tokens;
}

/**
 * 課金重みを掛けたトークン数（base input 換算）。
 *
 * キャッシュ書き込みは 1.25 倍、読み出しは 0.1 倍で課金されるため、
 * 生の合計ではコストの比較にならない。output はモデルごとに単価が異なるので
 * 重み付けせずそのまま加算する（正確なコストは total_cost_usd を参照）。
 */
export function billableTokens(r: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}): number {
  return (
    r.input_tokens +
    r.output_tokens +
    r.cache_creation_input_tokens * CACHE_WRITE_WEIGHT +
    r.cache_read_input_tokens * CACHE_READ_WEIGHT
  );
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
  /** 主指標: モデルに渡された入力コンテキスト量 */
  context_tokens: { median: number | null; min: number | null; max: number | null };
  /** 課金重み付きトークン数（cache_write 1.25 / cache_read 0.1） */
  billable_tokens: { median: number | null; min: number | null; max: number | null };
  /** 4 種のトークンの単純合計（後方互換のため保持。比較には使わない） */
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
  /**
   * 主指標の削減率。context_tokens の中央値ベース。算出不能の場合は null。
   * （フィールド名は後方互換のため token_reduction_pct のまま）
   */
  token_reduction_pct: number | null;
  /** 課金重み付きトークンの削減率 */
  billable_reduction_pct: number | null;
  /** 実コスト (USD) の削減率 */
  cost_reduction_pct: number | null;
  /** 削減率を算出しなかった理由。算出できた場合は null */
  reduction_suppressed_reason: string | null;
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
    /** 主指標: context_tokens の中央値（全シナリオ横断） */
    smallright_median_context_tokens: number | null;
    playwright_median_context_tokens: number | null;
    /** 課金重み付きトークンの中央値 */
    smallright_median_billable_tokens: number | null;
    playwright_median_billable_tokens: number | null;
    /** 単純合計の中央値（後方互換） */
    smallright_median_total_tokens: number | null;
    playwright_median_total_tokens: number | null;
    /** 実コスト (USD) の中央値 */
    smallright_median_cost_usd: number | null;
    playwright_median_cost_usd: number | null;
    /** 主指標 (context_tokens) の削減率。算出不能の場合は null */
    overall_token_reduction_pct: number | null;
    /** 課金重み付きトークンの削減率 */
    overall_billable_reduction_pct: number | null;
    /** 実コストの削減率 */
    overall_cost_reduction_pct: number | null;
    /** 全シナリオ横断の run 数と成功 run 数 */
    smallright_runs: number;
    smallright_success_runs: number;
    playwright_runs: number;
    playwright_success_runs: number;
    /** 削減率を算出しなかった理由。算出できた場合は null */
    reduction_suppressed_reason: string | null;
  };
}

/**
 * 削減率を算出してよいかを判定する。
 *
 * トークン中央値は成功 run のみから計算しているため、成功率が大きく偏った
 * 状態で中央値同士を比較すると、母集団の違う数字を割ることになり比較が
 * 成立しない。両者が最低限の成功数を満たす場合にのみ算出する。
 *
 * @returns 算出可能なら null、不可なら理由の文字列
 */
export function reductionBlockedReason(
  smCount: number,
  smSuccess: number,
  pwCount: number,
  pwSuccess: number
): string | null {
  const smRequired = minSuccessRequired(smCount);
  const pwRequired = minSuccessRequired(pwCount);

  if (smCount === 0 || pwCount === 0) {
    return "run が存在しない MCP があるため算出不能";
  }
  if (smSuccess < smRequired || pwSuccess < pwRequired) {
    return (
      `成功 run が不足（smallright ${smSuccess}/${smCount}, playwright ${pwSuccess}/${pwCount}）。` +
      `中央値の母集団が偏るため削減率は算出しない`
    );
  }
  return null;
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
    context_tokens: {
      median: medianOrNull(successRuns.map(contextTokens)),
      min: minOrNull(successRuns.map(contextTokens)),
      max: maxOrNull(successRuns.map(contextTokens)),
    },
    billable_tokens: {
      median: medianOrNull(successRuns.map(billableTokens)),
      min: minOrNull(successRuns.map(billableTokens)),
      max: maxOrNull(successRuns.map(billableTokens)),
    },
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

/**
 * configs/playwright.mcp.json の args から @playwright/mcp のバージョンを読む。
 * ハードコードするとレポートと実際に起動したバージョンが食い違うため、
 * 実際に使われる config を単一の情報源とする。
 */
export function parsePlaywrightMcpVersion(configJson: string): string {
  try {
    const parsed = JSON.parse(configJson) as {
      mcpServers?: Record<string, { args?: unknown }>;
    };
    const args = parsed.mcpServers?.["playwright"]?.args;
    if (!Array.isArray(args)) return "unknown";

    for (const arg of args) {
      if (typeof arg !== "string") continue;
      const m = /^@playwright\/mcp@(.+)$/.exec(arg);
      if (m?.[1] !== undefined) return m[1];
      // バージョン指定なしで参照している場合
      if (arg === "@playwright/mcp") return "latest";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function getPlaywrightMcpVersion(): string {
  // まず config の args からバージョン指定を読む（npx 起動時の形式）。
  // node で直接起動する場合は args にバージョンが無いので、
  // インストール済み @playwright/mcp の package.json を参照する。
  try {
    const raw = fs.readFileSync(path.join(CONFIGS_DIR, "playwright.mcp.json"), "utf-8");
    const fromConfig = parsePlaywrightMcpVersion(raw);
    if (fromConfig !== "unknown" && fromConfig !== "latest") return fromConfig;
  } catch {
    // config が読めない場合は package.json 参照へフォールバック
  }

  try {
    const pkgPath = path.resolve(
      dirFromMetaUrl(import.meta.url),
      "..",
      "node_modules",
      "@playwright",
      "mcp",
      "package.json"
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    if (typeof pkg.version === "string") return pkg.version;
  } catch {
    // 参照できなければ unknown
  }

  return "unknown";
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

    // 削減率は成功 run の中央値ベース。どちらかが null なら算出不能。
    // さらに成功 run が不足している場合も算出しない（母集団の偏り対策）。
    let token_reduction_pct: number | null = null;
    let billable_reduction_pct: number | null = null;
    let cost_reduction_pct: number | null = null;
    let reduction_suppressed_reason: string | null = null;

    if (
      smStats === null ||
      pwStats === null ||
      smStats.context_tokens.median === null ||
      pwStats.context_tokens.median === null
    ) {
      reduction_suppressed_reason = "成功 run が 0 件の MCP があるため算出不能";
    } else {
      reduction_suppressed_reason = reductionBlockedReason(
        smStats.count,
        smStats.success_count,
        pwStats.count,
        pwStats.success_count
      );
      if (reduction_suppressed_reason === null) {
        token_reduction_pct = reductionRate(
          pwStats.context_tokens.median,
          smStats.context_tokens.median
        );
        if (smStats.billable_tokens.median !== null && pwStats.billable_tokens.median !== null) {
          billable_reduction_pct = reductionRate(
            pwStats.billable_tokens.median,
            smStats.billable_tokens.median
          );
        }
        if (smStats.cost_usd.median !== null && pwStats.cost_usd.median !== null) {
          cost_reduction_pct = reductionRate(pwStats.cost_usd.median, smStats.cost_usd.median);
        }
      }
    }

    return {
      scenario_id: sid,
      scenario_name: scenarioNames[sid] ?? sid,
      smallright: smStats,
      playwright: pwStats,
      token_reduction_pct,
      billable_reduction_pct,
      cost_reduction_pct,
      reduction_suppressed_reason,
    };
  });

  // 全体集計: 成功 run のトークンのみ
  const srAll = records.filter((r) => r.mcp_key === "smallright");
  const pwAll = records.filter((r) => r.mcp_key === "playwright");
  const srSuccess = srAll.filter((r) => r.success === true && r.is_error === false);
  const pwSuccess = pwAll.filter((r) => r.success === true && r.is_error === false);

  const srMedian = medianOrNull(srSuccess.map(contextTokens));
  const pwMedian = medianOrNull(pwSuccess.map(contextTokens));
  const srBillable = medianOrNull(srSuccess.map(billableTokens));
  const pwBillable = medianOrNull(pwSuccess.map(billableTokens));
  const srTotal = medianOrNull(srSuccess.map((r) => r.total_tokens));
  const pwTotal = medianOrNull(pwSuccess.map((r) => r.total_tokens));
  const srCost = medianOrNull(srSuccess.map((r) => r.total_cost_usd));
  const pwCost = medianOrNull(pwSuccess.map((r) => r.total_cost_usd));

  // シナリオ別と同じガードを全体集計にも適用する
  let overallReduction: number | null = null;
  let overallBillableReduction: number | null = null;
  let overallCostReduction: number | null = null;
  let overallSuppressed: string | null = null;
  if (srMedian === null || pwMedian === null) {
    overallSuppressed = "成功 run が 0 件の MCP があるため算出不能";
  } else {
    overallSuppressed = reductionBlockedReason(
      srAll.length,
      srSuccess.length,
      pwAll.length,
      pwSuccess.length
    );
    if (overallSuppressed === null) {
      overallReduction = reductionRate(pwMedian, srMedian);
      if (srBillable !== null && pwBillable !== null) {
        overallBillableReduction = reductionRate(pwBillable, srBillable);
      }
      if (srCost !== null && pwCost !== null) {
        overallCostReduction = reductionRate(pwCost, srCost);
      }
    }
  }

  return {
    meta: {
      timestamp: new Date().toISOString(),
      model,
      claude_cli_version: getClaudeVersion(),
      playwright_mcp_version: getPlaywrightMcpVersion(),
      os: `${os.platform()} ${os.release()}`,
    },
    records,
    stats,
    comparisons,
    overall: {
      smallright_median_context_tokens: srMedian,
      playwright_median_context_tokens: pwMedian,
      smallright_median_billable_tokens: srBillable,
      playwright_median_billable_tokens: pwBillable,
      smallright_median_total_tokens: srTotal,
      playwright_median_total_tokens: pwTotal,
      smallright_median_cost_usd: srCost,
      playwright_median_cost_usd: pwCost,
      overall_token_reduction_pct: overallReduction,
      overall_billable_reduction_pct: overallBillableReduction,
      overall_cost_reduction_pct: overallCostReduction,
      smallright_runs: srAll.length,
      smallright_success_runs: srSuccess.length,
      playwright_runs: pwAll.length,
      playwright_success_runs: pwSuccess.length,
      reduction_suppressed_reason: overallSuppressed,
    },
  };
}

// ---------------------------------------------------------------------------
// マークダウン表生成
// ---------------------------------------------------------------------------

/**
 * 削減率の表示文字列を返す。
 *
 * 旧実装は削減を符号なし、増加を "+" 付きで表示していたため、
 * "+" が付いている方が悪い結果という直感に反する表記になっていた。
 * トークンの増減として素直に読めるよう、常に符号を付ける。
 *
 * 削減（トークンが減った）: "-30.0%"
 * 増加（トークンが増えた）: "+12.3%"
 */
export function pct(n: number | null): string {
  if (n === null) return "N/A";
  // reductionRate は「削減量」なので、トークンの増減に直すと符号が反転する
  const delta = -n;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "±";
  return `${sign}${Math.abs(delta).toFixed(1)}%`;
}

function tok(n: number | null): string {
  if (n === null) return "N/A";
  return n.toLocaleString("en-US");
}

function rate(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function cost(n: number | null): string {
  if (n === null) return "N/A";
  return `$${n.toFixed(4)}`;
}

export function generateMarkdown(result: AggregatedResult): string {
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
  lines.push("> Reduction: positive value = smallright used fewer tokens (good).");
  lines.push("> Completion rate is based on **all runs** (including errors).");
  lines.push(
    "> Reduction is reported as N/A when either MCP succeeded in fewer than half of its runs,"
  );
  lines.push("> because comparing medians drawn from unevenly filtered populations is misleading.");
  lines.push("");
  lines.push("### Metrics");
  lines.push("");
  lines.push(
    "- **Context tokens** (primary): `input + cache_creation + cache_read` — how much input context the model actually read."
  );
  lines.push(
    `- **Billable tokens**: \`input + output + cache_creation x ${CACHE_WRITE_WEIGHT} + cache_read x ${CACHE_READ_WEIGHT}\` — weighted by cache pricing.`
  );
  lines.push("- **Cost (USD)**: reported by the Claude CLI (`total_cost_usd`).");
  lines.push(
    "- **Total tokens**: naive sum of all four counters. Kept for reference only; it matches neither cost nor context."
  );
  lines.push("");

  // シナリオ別表
  lines.push("## Scenario Results");
  lines.push("");
  lines.push(
    "| Scenario | smallright (median context) | playwright (median context) | Context Reduction | Billable Reduction | Cost Reduction | smallright success | playwright success |"
  );
  lines.push(
    "|----------|----------------------------|----------------------------|-------------------|--------------------|----------------|--------------------|--------------------|"
  );

  for (const cmp of comparisons) {
    const srTok = cmp.smallright ? tok(cmp.smallright.context_tokens.median) : "N/A";
    const pwTok = cmp.playwright ? tok(cmp.playwright.context_tokens.median) : "N/A";
    const srRate = cmp.smallright ? rate(cmp.smallright.completion_rate) : "N/A";
    const pwRate = cmp.playwright ? rate(cmp.playwright.completion_rate) : "N/A";
    lines.push(
      `| ${cmp.scenario_name} | ${srTok} | ${pwTok} | ${pct(cmp.token_reduction_pct)} | ${pct(cmp.billable_reduction_pct)} | ${pct(cmp.cost_reduction_pct)} | ${srRate} | ${pwRate} |`
    );
  }

  lines.push("");

  // 詳細表（min/max）
  lines.push("## Detailed Stats");
  lines.push("");
  lines.push(
    "| Scenario | MCP | Runs | Success | Completion | Median context | Min | Max | Median billable | Median total | Median input | Median output | Median turns | Median cost (USD) |"
  );
  lines.push(
    "|----------|-----|------|---------|------------|----------------|-----|-----|-----------------|-------------|-------------|--------------|-------------|------------------|"
  );

  for (const cmp of comparisons) {
    for (const st of [cmp.smallright, cmp.playwright]) {
      if (!st) continue;
      const medTurns = st.num_turns.median;
      lines.push(
        `| ${st.scenario_name} | ${st.mcp_key} | ${st.count} | ${st.success_count} | ${rate(st.completion_rate)} | ${tok(st.context_tokens.median)} | ${tok(st.context_tokens.min)} | ${tok(st.context_tokens.max)} | ${tok(st.billable_tokens.median)} | ${tok(st.total_tokens.median)} | ${tok(st.input_tokens.median)} | ${tok(st.output_tokens.median)} | ${medTurns !== null ? medTurns.toFixed(1) : "N/A"} | ${st.cost_usd.median !== null ? `$${st.cost_usd.median.toFixed(4)}` : "N/A"} |`
      );
    }
  }

  lines.push("");

  // 総合表
  lines.push("## Overall Summary");
  lines.push("");
  lines.push("Medians across all scenarios, successful runs only.");
  lines.push("");
  lines.push("| MCP | Median context | Median billable | Median total | Median cost | Successful runs |");
  lines.push("|-----|----------------|-----------------|--------------|-------------|-----------------|");
  lines.push(
    `| smallright | ${tok(overall.smallright_median_context_tokens)} | ${tok(overall.smallright_median_billable_tokens)} | ${tok(overall.smallright_median_total_tokens)} | ${cost(overall.smallright_median_cost_usd)} | ${overall.smallright_success_runs} / ${overall.smallright_runs} |`
  );
  lines.push(
    `| playwright | ${tok(overall.playwright_median_context_tokens)} | ${tok(overall.playwright_median_billable_tokens)} | ${tok(overall.playwright_median_total_tokens)} | ${cost(overall.playwright_median_cost_usd)} | ${overall.playwright_success_runs} / ${overall.playwright_runs} |`
  );
  lines.push(
    `| **Reduction** | **${pct(overall.overall_token_reduction_pct)}** | **${pct(overall.overall_billable_reduction_pct)}** | | **${pct(overall.overall_cost_reduction_pct)}** | |`
  );
  lines.push("");

  if (overall.reduction_suppressed_reason !== null) {
    lines.push(`> ⚠ 削減率は算出していません: ${overall.reduction_suppressed_reason}`);
    lines.push("");
  }

  const suppressedScenarios = comparisons.filter(
    (c) => c.reduction_suppressed_reason !== null
  );
  if (suppressedScenarios.length > 0) {
    lines.push("### 削減率を算出しなかったシナリオ");
    lines.push("");
    for (const cmp of suppressedScenarios) {
      lines.push(`- **${cmp.scenario_name}**: ${cmp.reduction_suppressed_reason}`);
    }
    lines.push("");
  }

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

  const WIDTH = 100;

  console.log("\n========== BENCHMARK SUMMARY ==========");
  console.log("(Medians: successful runs only. Completion rate: all runs.)");
  console.log("(Context = input + cache_creation + cache_read. Billable = cache-weighted.)");
  console.log(
    `${"Scenario".padEnd(32)} ${"SR context".padStart(12)} ${"PW context".padStart(12)} ${"Context".padStart(9)} ${"Billable".padStart(9)} ${"Cost".padStart(9)} ${"SR ok".padStart(6)} ${"PW ok".padStart(6)}`
  );
  console.log("-".repeat(WIDTH));

  for (const cmp of comparisons) {
    const srTok = cmp.smallright ? tok(cmp.smallright.context_tokens.median) : "N/A";
    const pwTok = cmp.playwright ? tok(cmp.playwright.context_tokens.median) : "N/A";
    const srRate = cmp.smallright ? rate(cmp.smallright.completion_rate) : "N/A";
    const pwRate = cmp.playwright ? rate(cmp.playwright.completion_rate) : "N/A";

    console.log(
      `${cmp.scenario_name.padEnd(32)} ${srTok.padStart(12)} ${pwTok.padStart(12)} ${pct(cmp.token_reduction_pct).padStart(9)} ${pct(cmp.billable_reduction_pct).padStart(9)} ${pct(cmp.cost_reduction_pct).padStart(9)} ${srRate.padStart(6)} ${pwRate.padStart(6)}`
    );
  }

  console.log("-".repeat(WIDTH));
  console.log(
    `${"OVERALL (median across all)".padEnd(32)} ${tok(overall.smallright_median_context_tokens).padStart(12)} ${tok(overall.playwright_median_context_tokens).padStart(12)} ${pct(overall.overall_token_reduction_pct).padStart(9)} ${pct(overall.overall_billable_reduction_pct).padStart(9)} ${pct(overall.overall_cost_reduction_pct).padStart(9)} ${`${overall.smallright_success_runs}/${overall.smallright_runs}`.padStart(6)} ${`${overall.playwright_success_runs}/${overall.playwright_runs}`.padStart(6)}`
  );
  console.log("=".repeat(WIDTH));

  if (overall.reduction_suppressed_reason !== null) {
    console.log(`WARNING: 削減率は算出していません: ${overall.reduction_suppressed_reason}`);
  }
  for (const cmp of comparisons) {
    if (cmp.reduction_suppressed_reason !== null) {
      console.log(`  - ${cmp.scenario_name}: ${cmp.reduction_suppressed_reason}`);
    }
  }
}
