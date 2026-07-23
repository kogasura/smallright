import * as path from "node:path";
import { runClaude, type RunResult } from "./claudeRunner.js";
import { contextTokens, billableTokens } from "./report.js";
import { preflightMcp, formatPreflightFailure, type PreflightResult } from "./preflight.js";
import {
  classifyRun,
  filterMcpTools,
  type RunStatus,
  type InvalidReason,
} from "./runStatus.js";
import {
  scenarios,
  judgeScenario,
  targetUrls,
  type Scenario,
  type TargetKind,
} from "./scenarios.js";
import { dirFromMetaUrl } from "./paths.js";
import { startFixtureServer, type FixtureServer } from "./fixtureServer.js";

const CONFIGS_DIR = path.resolve(dirFromMetaUrl(import.meta.url), "..", "configs");

export interface McpTarget {
  key: "smallright" | "playwright";
  configPath: string;
  toolGlob: string;
}

export const mcpTargets: McpTarget[] = [
  {
    key: "smallright",
    configPath: path.join(CONFIGS_DIR, "smallright.mcp.json"),
    toolGlob: "mcp__smallright__*",
  },
  {
    key: "playwright",
    configPath: path.join(CONFIGS_DIR, "playwright.mcp.json"),
    toolGlob: "mcp__playwright__*",
  },
];

export interface RunRecord {
  scenario_id: string;
  scenario_name: string;
  mcp_key: "smallright" | "playwright";
  run_index: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_tokens: number;
  num_turns: number;
  duration_ms: number;
  total_cost_usd: number;
  is_error: boolean;
  /** status === "success" と同義。既存の results.json との互換のため残している */
  success: boolean;
  /**
   * run の分類。invalid は「対象 MCP を一度も通っていない」= 計測不成立で、
   * 集計から除外される。詳細は runStatus.ts を参照。
   *
   * この項目が導入される前に取得した results.json を読み直せるよう optional に
   * している。未設定のレコードは report 側で is_error / success から復元する。
   */
  status?: RunStatus;
  /** status === "invalid" のときの理由 */
  invalid_reason?: InvalidReason;
  /** 失敗・無効の判定理由。成功時は undefined */
  failure_reason?: string;
  raw_error?: string;
  /** この run で接続されていた対象 MCP のツール数（旧レコードでは未設定） */
  mcp_tools_available?: number;
  /** この run で実際に呼ばれた対象 MCP のツール呼び出し回数（旧レコードでは未設定） */
  mcp_tool_calls?: number;
  /** この run に要した試行回数（無効時のリトライを含む）。通常は 1 */
  attempts?: number;
}

export interface RunnerOptions {
  repeat: number;
  model: string;
  scenarioIds?: string[];
  mcpKeys?: Array<"smallright" | "playwright">;
  /** 計測対象サイト。既定は local（同梱フィクスチャ） */
  target?: TargetKind;
  /** 事前チェック（MCP 接続確認）を飛ばす。既定 false */
  skipPreflight?: boolean;
}

/** ms 待機するユーティリティ */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** レート制限対策の run 間待機 (ミリ秒) */
const INTER_RUN_WAIT_MS = 5_000;

/**
 * 計測不成立 (invalid) だった run の最大試行回数。
 *
 * stdio の MCP サーバーは連続実行の後半で起動に失敗することがある（実測では
 * run_index 3, 4 に失敗が集中した）。一過性なので、計測不成立と判定したら
 * 同じ条件で数回まで引き直す。それでも繋がらなければ invalid として記録し、
 * 集計から除外したうえでレポートに件数を明記する（黙って捨てない）。
 */
export const INVALID_RUN_ATTEMPTS = 3;

export async function runBenchmark(opts: RunnerOptions): Promise<RunRecord[]> {
  const target = opts.target ?? "local";

  // local ターゲットは同梱フィクスチャを http で配信する。
  // smallright は file:// を開けないため、両 MCP が同一 URL を開けるよう
  // HTTP サーバーを立て、その baseUrl から URL を組み立てる。
  let fixtureServer: FixtureServer | undefined;
  let urls;
  if (target === "local") {
    fixtureServer = await startFixtureServer();
    urls = targetUrls("local", fixtureServer.baseUrl);
    console.log(`ローカルフィクスチャ配信: ${fixtureServer.baseUrl}`);
  } else {
    urls = targetUrls(target);
  }

  try {
    return await runScenarios(opts, urls, fixtureServer);
  } finally {
    if (fixtureServer) {
      await fixtureServer.close();
    }
  }
}

/**
 * 実際のシナリオ実行ループ。フィクスチャサーバーの後始末を runBenchmark 側の
 * finally に任せるため、本体を分離している。
 */
async function runScenarios(
  opts: RunnerOptions,
  urls: ReturnType<typeof targetUrls>,
  _fixtureServer: FixtureServer | undefined
): Promise<RunRecord[]> {
  const targetScenarios: Scenario[] =
    opts.scenarioIds && opts.scenarioIds.length > 0
      ? scenarios.filter((s) => opts.scenarioIds!.includes(s.id))
      : scenarios;

  const targetMcps: McpTarget[] =
    opts.mcpKeys && opts.mcpKeys.length > 0
      ? mcpTargets.filter((m) => opts.mcpKeys!.includes(m.key))
      : mcpTargets;

  // MCP が繋がっていないまま走ると、エージェントは別の手段でタスクを解こうとし、
  // それらしい数字が出てしまう。実行前に 1 回だけ確認して落とす。
  if (opts.skipPreflight !== true) {
    console.log("MCP 接続を確認しています...");
    // 逐次実行する。複数の claude 子プロセス（＋stdio MCP サーバー）を同時に
    // 起動すると、起動時の競合で MCP 接続が間に合わず、実際は繋がる構成でも
    // ツールが 0 件に見える false negative が起きる。1 つずつ確認する。
    const results: PreflightResult[] = [];
    for (const m of targetMcps) {
      results.push(await preflightMcp(m, opts.model));
    }

    for (const r of results) {
      console.log(`  ${r.ok ? "OK" : "NG"} ${r.mcp_key}: ${r.ok ? `${r.tool_count} tools` : r.reason}`);
    }

    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      throw new Error(formatPreflightFailure(failures));
    }
    console.log("");
  }

  const records: RunRecord[] = [];
  const totalRuns = targetScenarios.length * targetMcps.length * opts.repeat;
  let runCount = 0;

  // MCP ごとにまとめて連続実行すると、レート制限の蓄積・時間帯によるサーバー
  // 応答の変化・対象サイトの状態変化が後半の MCP に偏って乗る。
  // repeat ごとに MCP を交互に回し、さらに 1 回おきに順序を反転させることで
  // 「常に先に走る」側が生まれないようにする。
  for (const scenario of targetScenarios) {
    for (let i = 0; i < opts.repeat; i++) {
      const orderedMcps = i % 2 === 0 ? targetMcps : [...targetMcps].reverse();

      for (const mcp of orderedMcps) {
        runCount++;
        console.log(
          `[${runCount}/${totalRuns}] scenario=${scenario.id} mcp=${mcp.key} run=${i + 1}/${opts.repeat}`
        );

        // 計測不成立 (invalid) の場合だけ引き直す。失敗・エラーは実力・環境の
        // 結果なのでリトライしない（リトライすると成功率が水増しされる）。
        let result!: RunResult;
        let classified!: ReturnType<typeof classifyRun>;
        let attempts = 0;

        for (let attempt = 1; attempt <= INVALID_RUN_ATTEMPTS; attempt++) {
          attempts = attempt;
          result = await runClaude({
            prompt: scenario.buildPrompt(urls),
            mcpConfigPath: mcp.configPath,
            model: opts.model,
            allowedTools: mcp.toolGlob,
          });

          classified = classifyRun({
            mcpKey: mcp.key,
            is_error: result.is_error,
            toolsAvailable: result.mcp_tools_available,
            toolsUsed: result.mcp_tools_used,
            judged: judgeScenario(result.result, scenario),
            ...(result.raw_error !== undefined ? { rawError: result.raw_error } : {}),
          });

          if (classified.status !== "invalid") break;

          console.log(`     INVALID (${attempt}/${INVALID_RUN_ATTEMPTS}): ${classified.detail}`);
          if (attempt < INVALID_RUN_ATTEMPTS) await sleep(INTER_RUN_WAIT_MS);
        }

        const totalTokens =
          result.usage.input_tokens +
          result.usage.output_tokens +
          result.usage.cache_creation_input_tokens +
          result.usage.cache_read_input_tokens;

        const success = classified.status === "success";

        const record: RunRecord = {
          scenario_id: scenario.id,
          scenario_name: scenario.name,
          mcp_key: mcp.key,
          run_index: i,
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          cache_creation_input_tokens: result.usage.cache_creation_input_tokens,
          cache_read_input_tokens: result.usage.cache_read_input_tokens,
          total_tokens: totalTokens,
          num_turns: result.num_turns,
          duration_ms: result.duration_ms,
          total_cost_usd: result.total_cost_usd,
          is_error: result.is_error,
          success,
          status: classified.status,
          mcp_tools_available: filterMcpTools(result.mcp_tools_available, mcp.key).length,
          mcp_tool_calls: filterMcpTools(result.mcp_tools_used, mcp.key).length,
          attempts,
        };

        if (result.raw_error !== undefined) {
          record.raw_error = result.raw_error;
        }
        if (classified.invalid_reason !== undefined) {
          record.invalid_reason = classified.invalid_reason;
        }
        if (!success && classified.detail !== null) {
          record.failure_reason = classified.detail;
        }

        records.push(record);

        // OK: 成功 / FAIL: 対象ツールを使ったがタスク未達成 /
        // ERROR: 子プロセス異常終了・usage 欠落 / INVALID: 対象ツールを通っていない（計測不成立）
        const statusIcon = {
          success: "OK",
          failure: "FAIL",
          error: "ERROR",
          invalid: "INVALID",
        }[classified.status];
        console.log(
          `  -> ${statusIcon} | context=${contextTokens(record)} billable=${Math.round(billableTokens(record))} total=${totalTokens} (in=${result.usage.input_tokens} out=${result.usage.output_tokens}) | turns=${result.num_turns} | tools=${record.mcp_tool_calls} | cost=$${result.total_cost_usd.toFixed(4)}`
        );
        if (classified.detail !== null && classified.status !== "success") {
          console.log(`     reason: ${classified.detail}`);
        }

        // 最後の run 以外は待機
        if (runCount < totalRuns) {
          await sleep(INTER_RUN_WAIT_MS);
        }
      }
    }
  }

  return records;
}
