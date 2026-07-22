import * as path from "node:path";
import { runClaude, type RunResult } from "./claudeRunner.js";
import { contextTokens, billableTokens } from "./report.js";
import {
  scenarios,
  judgeScenario,
  targetUrls,
  type Scenario,
  type TargetKind,
} from "./scenarios.js";
import { dirFromMetaUrl } from "./paths.js";

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
  success: boolean;
  /** 失敗した場合の判定理由。成功時は undefined */
  failure_reason?: string;
  raw_error?: string;
}

export interface RunnerOptions {
  repeat: number;
  model: string;
  scenarioIds?: string[];
  mcpKeys?: Array<"smallright" | "playwright">;
  /** 計測対象サイト。既定は local（同梱フィクスチャ） */
  target?: TargetKind;
}

/** ms 待機するユーティリティ */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** レート制限対策の run 間待機 (ミリ秒) */
const INTER_RUN_WAIT_MS = 5_000;

export async function runBenchmark(opts: RunnerOptions): Promise<RunRecord[]> {
  const targetScenarios: Scenario[] =
    opts.scenarioIds && opts.scenarioIds.length > 0
      ? scenarios.filter((s) => opts.scenarioIds!.includes(s.id))
      : scenarios;

  const targetMcps: McpTarget[] =
    opts.mcpKeys && opts.mcpKeys.length > 0
      ? mcpTargets.filter((m) => opts.mcpKeys!.includes(m.key))
      : mcpTargets;

  const urls = targetUrls(opts.target ?? "local");

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

        const result: RunResult = await runClaude({
          prompt: scenario.buildPrompt(urls),
          mcpConfigPath: mcp.configPath,
          model: opts.model,
          allowedTools: mcp.toolGlob,
        });

        const totalTokens =
          result.usage.input_tokens +
          result.usage.output_tokens +
          result.usage.cache_creation_input_tokens +
          result.usage.cache_read_input_tokens;

        const judged = result.is_error
          ? { success: false, reason: "run がエラー終了" }
          : judgeScenario(result.result, scenario);
        const success = judged.success;

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
        };

        if (result.raw_error !== undefined) {
          record.raw_error = result.raw_error;
        }
        if (!success && judged.reason !== null) {
          record.failure_reason = judged.reason;
        }

        records.push(record);

        // ERROR: is_error=true（子プロセス異常終了/usage欠落等）/ OK: 成功 / FAIL: タスク未達成
        const statusIcon = result.is_error ? "ERROR" : success ? "OK" : "FAIL";
        console.log(
          `  -> ${statusIcon} | context=${contextTokens(record)} billable=${Math.round(billableTokens(record))} total=${totalTokens} (in=${result.usage.input_tokens} out=${result.usage.output_tokens}) | turns=${result.num_turns} | cost=$${result.total_cost_usd.toFixed(4)}`
        );
        if (statusIcon === "FAIL" && judged.reason !== null) {
          console.log(`     reason: ${judged.reason}`);
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
