/**
 * run の分類。
 *
 * ## なぜ「失敗」と「無効」を分けるのか
 *
 * ブラウザ MCP のトークン効率を測るベンチマークで、MCP サーバーが起動して
 * いなければ、エージェントは「使えるブラウザツールがありません」と一言返して
 * 終わる。判定は「期待する文字列が含まれない」で落ちるので、素直に実装すると
 * これが「失敗」として記録される。
 *
 * だが、これは対象ツールの実力不足ではない。**そもそも対象ツールを一度も
 * 通っていない**、計測が成立しなかった run である。これを失敗として数えると
 * 完走率が対象ツールに不利な方向へ静かに歪む。実際、初回の実測では
 * smallright の失敗 3 件がすべてこれだった（1 ターン・cache_read が数千のみ・
 * 7 秒で終了、という署名で見分けられた）。
 *
 * そこで両者を別の状態として扱う:
 *
 * - failure … 対象ツールを使ったうえでタスクを達成できなかった（実力の話）
 * - invalid … 対象ツールを一度も通っていない（計測不成立。集計から除外する）
 */
export type RunStatus = "success" | "failure" | "error" | "invalid";

/** 計測が成立しなかった理由 */
export type InvalidReason =
  /** 対象 MCP のツールが 1 つも接続されていなかった（サーバー起動失敗など） */
  | "mcp_not_connected"
  /** ツールは接続されていたが、一度も呼ばれないまま終わった */
  | "mcp_tools_unused";

export interface RunClassification {
  status: RunStatus;
  /** status==="invalid" のときの理由 */
  invalid_reason?: InvalidReason;
  /** 人間向けの説明。status==="success" のときは null */
  detail: string | null;
}

export interface ClassifyRunInput {
  mcpKey: string;
  is_error: boolean;
  /** system/init で接続されていたツール名（MCP 以外も含む） */
  toolsAvailable: string[];
  /** 実際に呼ばれたツール名 */
  toolsUsed: string[];
  /** judgeScenario の結果 */
  judged: { success: boolean; reason: string | null };
  /** is_error のときの生エラー */
  rawError?: string;
}

/** 指定 MCP のツール名だけを抜き出す */
export function filterMcpTools(names: string[], mcpKey: string): string[] {
  const prefix = `mcp__${mcpKey}__`;
  return names.filter((n) => n.startsWith(prefix));
}

/**
 * 1 run の結果を success / failure / error / invalid に分類する。
 *
 * 判定順序に意味がある。エラー終了 → 計測成立の確認 → タスク判定、の順で見る。
 * 計測が成立していない run にタスク判定を適用してはいけない。
 */
export function classifyRun(input: ClassifyRunInput): RunClassification {
  if (input.is_error) {
    return { status: "error", detail: input.rawError ?? "run がエラー終了" };
  }

  const available = filterMcpTools(input.toolsAvailable, input.mcpKey);
  if (available.length === 0) {
    return {
      status: "invalid",
      invalid_reason: "mcp_not_connected",
      detail:
        `mcp__${input.mcpKey}__* のツールが接続されていません。` +
        "MCP サーバーの起動に失敗した可能性があります（計測不成立）",
    };
  }

  const used = filterMcpTools(input.toolsUsed, input.mcpKey);
  if (used.length === 0) {
    return {
      status: "invalid",
      invalid_reason: "mcp_tools_unused",
      detail:
        `mcp__${input.mcpKey}__* のツールが接続されていましたが一度も呼ばれていません。` +
        "対象ツールを経由していないため計測不成立",
    };
  }

  if (!input.judged.success) {
    return { status: "failure", detail: input.judged.reason };
  }

  return { status: "success", detail: null };
}
