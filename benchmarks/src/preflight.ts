import { runClaude } from "./claudeRunner.js";
import type { McpTarget } from "./runner.js";

/**
 * 事前チェック用のプロンプト。
 * ブラウザ操作は行わせず、接続されている MCP ツール名だけを列挙させる。
 */
const PREFLIGHT_PROMPT =
  "Reply with ONLY a comma-separated list of the mcp__ tool names available to you. " +
  "Do not use any tool. Do not explain. If none are available, reply exactly: NONE";

/** 事前チェックのタイムアウト (ms)。本番 run より短くてよい */
export const PREFLIGHT_TIMEOUT_MS = 120_000;

export interface PreflightResult {
  mcp_key: string;
  ok: boolean;
  /** 検出した対象 MCP のツール数 */
  tool_count: number;
  /** 失敗理由。成功時は null */
  reason: string | null;
}

/**
 * claude の回答テキストから、指定した MCP のツールが使えるかを判定する純粋関数。
 *
 * MCP サーバーが起動していない場合、claude は黙ってそのツールを持たないまま
 * 実行を続ける。気付かずにベンチマークを回すと、エージェントは別の手段で
 * タスクを解こうとし、計測値が意味を失う。
 */
export function parsePreflight(resultText: string, mcpKey: string): PreflightResult {
  const prefix = `mcp__${mcpKey}__`;
  const matches = resultText.match(new RegExp(`${prefix}[a-zA-Z0-9_]+`, "g")) ?? [];
  const unique = new Set(matches);

  if (unique.size === 0) {
    return {
      mcp_key: mcpKey,
      ok: false,
      tool_count: 0,
      reason:
        `${prefix}* のツールが1つも見つかりません。MCP サーバーが起動していない可能性があります。` +
        `回答: ${resultText.trim().slice(0, 200) || "(空)"}`,
    };
  }

  return { mcp_key: mcpKey, ok: true, tool_count: unique.size, reason: null };
}

/**
 * 対象 MCP のツールが実際に接続されているかを、実行前に 1 回だけ確認する。
 */
export async function preflightMcp(mcp: McpTarget, model: string): Promise<PreflightResult> {
  const result = await runClaude({
    prompt: PREFLIGHT_PROMPT,
    mcpConfigPath: mcp.configPath,
    model,
    allowedTools: mcp.toolGlob,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  });

  if (result.is_error) {
    return {
      mcp_key: mcp.key,
      ok: false,
      tool_count: 0,
      reason: `事前チェックの実行に失敗: ${result.raw_error ?? "unknown error"}`,
    };
  }

  return parsePreflight(result.result, mcp.key);
}

/**
 * 事前チェックの結果から、ユーザーに見せるエラーメッセージを組み立てる。
 */
export function formatPreflightFailure(failures: PreflightResult[]): string {
  const lines = [
    "ブラウザ MCP ツールに接続できないため、ベンチマークを中止しました。",
    "",
    "このまま実行しても、エージェントはブラウザを使わずにタスクを解こうとするため、",
    "計測値が意味を持ちません。",
    "",
  ];

  for (const f of failures) {
    lines.push(`- ${f.mcp_key}: ${f.reason ?? "unknown"}`);
  }

  lines.push(
    "",
    "確認すること:",
    "  - smallright: リポジトリルートで `npm run build` を実行し dist/index.js があるか",
    "  - playwright: `npx -y @playwright/mcp@0.0.29 --help` が通るか（ネットワーク到達性）",
    "  - 実行環境が stdio の MCP サーバー起動を許可しているか",
    "",
    "チェック自体を飛ばす場合は --skip-preflight を付けてください（非推奨）。"
  );

  return lines.join("\n");
}
