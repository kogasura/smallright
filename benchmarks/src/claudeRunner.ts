import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { dirFromMetaUrl } from "./paths.js";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface RunResult {
  usage: TokenUsage;
  num_turns: number;
  duration_ms: number;
  total_cost_usd: number;
  is_error: boolean;
  result: string;
  raw_error?: string;
}

export interface RunOptions {
  prompt: string;
  mcpConfigPath: string;
  model: string;
  allowedTools: string;
  /** 子プロセスを強制終了するまでの上限 (ms)。未指定時は DEFAULT_RUN_TIMEOUT_MS */
  timeoutMs?: number;
  /**
   * 組み込みツール (Read / Bash / Glob / Grep / WebFetch など) を無効化するか。
   * 既定 true。false にすると計測が成立しなくなるので、通常は変更しない。
   */
  disableBuiltinTools?: boolean;
}

/** 1 run あたりの上限時間 (ms)。これを超えたら子プロセスを kill して is_error にする */
export const DEFAULT_RUN_TIMEOUT_MS = 300_000;

/** SIGTERM 後、SIGKILL に切り替えるまでの猶予 (ms) */
const KILL_GRACE_MS = 5_000;

const RUNTMP_DIR = path.resolve(dirFromMetaUrl(import.meta.url), "..", ".runtmp");

/**
 * playwright の MCP に使わせるブラウザ実行ファイルを差し込むための env 変数。
 *
 * @playwright/mcp は既定でシステムの Chrome チャンネル
 * (/opt/google/chrome/chrome) を起動しようとする。それが無い環境
 * （CI・サンドボックス等で Playwright のバンドル chromium だけが用意されて
 * いる場合）では起動に失敗する。この env にバイナリのパスを設定すると、
 * playwright の MCP 起動引数へ `--executable-path <path>` を注入し、
 * 用意済みのブラウザを使わせる。未設定なら既定動作のまま。
 */
export const PLAYWRIGHT_EXECUTABLE_PATH_ENV = "PLAYWRIGHT_MCP_EXECUTABLE_PATH";

/**
 * playwright の MCP config に `--executable-path` を注入する純粋関数。
 *
 * - execPath が未指定なら元の JSON をそのまま返す（変更なし）。
 * - 既に `--executable-path` が含まれていれば二重指定しない。
 * - playwright サーバー定義が無い、または JSON として壊れている場合も元のまま。
 */
export function injectPlaywrightExecutablePath(raw: string, execPath: string | undefined): string {
  if (execPath === undefined || execPath === "") return raw;

  let parsed: {
    mcpServers?: Record<string, { args?: unknown }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  const pw = parsed.mcpServers?.["playwright"];
  if (pw === undefined || !Array.isArray(pw.args)) return raw;
  if (pw.args.includes("--executable-path")) return raw;

  pw.args = [...pw.args, "--executable-path", execPath];
  return JSON.stringify(parsed, null, 2);
}

/**
 * MCP config を実行用に解決する。
 *
 * - smallright.mcp.json の {{SMALLRIGHT_DIST}} プレースホルダを絶対パスに置換する。
 * - playwright.mcp.json は、PLAYWRIGHT_MCP_EXECUTABLE_PATH が設定されていれば
 *   `--executable-path` を注入する。
 * どちらの変換も不要なら元の configPath をそのまま返す。
 */
export function resolveMcpConfig(configPath: string): string {
  const raw = fs.readFileSync(configPath, "utf-8");

  // smallright: dist の絶対パスを埋め込む
  if (raw.includes("{{SMALLRIGHT_DIST}}")) {
    const repoRoot = path.resolve(dirFromMetaUrl(import.meta.url), "..", "..");
    const distPath = path.join(repoRoot, "dist", "index.js");
    const resolved = raw.replace(/\{\{SMALLRIGHT_DIST\}\}/g, distPath.replace(/\\/g, "/"));

    const dir = ensureRuntmpDir();
    const tmpFile = path.join(dir, `smallright-${Date.now()}.mcp.json`);
    fs.writeFileSync(tmpFile, resolved, "utf-8");
    return tmpFile;
  }

  // playwright:
  //   1) {{PLAYWRIGHT_MCP_CLI}} を、benchmarks 配下にインストールした
  //      @playwright/mcp の cli.js の絶対パスへ置換する。
  //      npx 起動はパッケージ解決に時間がかかり、MCP 接続がツール列挙に
  //      間に合わず false negative（ツール0件）になるため、node で直接起動する。
  //   2) PLAYWRIGHT_MCP_EXECUTABLE_PATH 指定時は --executable-path を注入する。
  let resolved = raw;
  if (resolved.includes("{{PLAYWRIGHT_MCP_CLI}}")) {
    const benchRoot = path.resolve(dirFromMetaUrl(import.meta.url), "..");
    const cliPath = path.join(benchRoot, "node_modules", "@playwright", "mcp", "cli.js");
    resolved = resolved.replace(/\{\{PLAYWRIGHT_MCP_CLI\}\}/g, cliPath.replace(/\\/g, "/"));
  }
  resolved = injectPlaywrightExecutablePath(resolved, process.env[PLAYWRIGHT_EXECUTABLE_PATH_ENV]);

  if (resolved !== raw) {
    const dir = ensureRuntmpDir();
    const tmpFile = path.join(dir, `playwright-${Date.now()}.mcp.json`);
    fs.writeFileSync(tmpFile, resolved, "utf-8");
    return tmpFile;
  }

  return configPath;
}

function ensureRuntmpDir(): string {
  fs.mkdirSync(RUNTMP_DIR, { recursive: true });
  return RUNTMP_DIR;
}

/**
 * shell: true で起動するため、args はシェルに文字列として渡される。
 * グロブ (`*`) やスペースを含む値がシェルに解釈されないよう引用する。
 *
 * Windows の cmd.exe は単一引用符を解釈しないため二重引用符を使う。
 * 値に二重引用符自体が含まれるケースは想定していない（config パスと
 * ツール名グロブのみを渡すため）が、含まれていた場合は除去する。
 */
export function shellQuote(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

/**
 * claude CLI に渡す引数を組み立てる。
 *
 * プロンプトは stdin で渡すため args には含めない。
 * 値はすべて shellQuote で保護する（spawn を shell: true で呼ぶため）。
 *
 * ## なぜ組み込みツールを無効化するのか
 *
 * `--allowedTools` は許可リストを追加するだけで、他のツールを禁止しない。
 * `--dangerously-skip-permissions` と併用すると、エージェントは Read / Bash /
 * Glob / Grep / WebFetch を自由に使える。
 *
 * その状態では「ブラウザを操作するより HTML を直接読んだ方が早い」と判断され、
 * ブラウザ MCP を経由せずにタスクを達成できてしまう。ローカルフィクスチャは
 * ディスク上のただのファイルなので特にそうなりやすい。
 * こうなると測っているのはブラウザ MCP のトークン効率ではなくなり、
 * 両者の差が消える。
 *
 * そのため `--tools ""` で組み込みツールを全て落とし、MCP ツールだけを残す。
 * 個別の禁止リストではなく一括無効化にしているのは、CLI に新しい組み込み
 * ツールが追加されても抜け道が増えないようにするため。
 */
export function buildClaudeArgs(opts: RunOptions, resolvedConfigPath: string): string[] {
  const args = [
    "--print",
    "--mcp-config",
    shellQuote(resolvedConfigPath),
    // 設定ファイルに書いた MCP サーバーだけを使う。ユーザーのグローバル設定に
    // 別の MCP サーバーがあると計測に混入するため
    "--strict-mcp-config",
    "--model",
    shellQuote(opts.model),
    "--output-format",
    "json",
    "--allowedTools",
    // mcp__smallright__* のようなグロブを含む。shell: true のため引用しないと
    // cwd の内容によってはシェルがワイルドカード展開してしまう
    shellQuote(opts.allowedTools),
  ];

  if (opts.disableBuiltinTools !== false) {
    // 空文字列 = 組み込みツールを全て無効化（MCP ツールは残る）
    args.push("--tools", shellQuote(""));
  }

  args.push("--dangerously-skip-permissions");
  return args;
}

/**
 * claude CLI の stdout JSON をパースして RunResult に変換する純粋関数。
 * B-2: usage フィールドの欠落・非有限数を is_error=true として返す。
 *
 * @param stdout - claude CLI の stdout 文字列
 * @param stderr - claude CLI の stderr 文字列（エラー時の raw_error に使用）
 * @param duration_ms - 経過時間（ms）
 */
export function parseClaudeOutput(stdout: string, stderr: string, duration_ms: number): RunResult {
  const errorResult = (raw_error: string): RunResult => ({
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    num_turns: 0,
    duration_ms,
    total_cost_usd: 0,
    is_error: true,
    result: "",
    raw_error,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    return errorResult(`JSON parse error: ${String(e)}\nstdout: ${stdout.slice(0, 500)}`);
  }

  const obj = parsed as Record<string, unknown>;

  // B-2: usage オブジェクトの存在と input_tokens/output_tokens の有限数チェック。
  // 欠落または NaN の場合は is_error=true として集計から除外する。
  const rawUsage = obj["usage"];
  if (
    rawUsage === null ||
    typeof rawUsage !== "object" ||
    !Number.isFinite(Number((rawUsage as Record<string, unknown>)["input_tokens"])) ||
    !Number.isFinite(Number((rawUsage as Record<string, unknown>)["output_tokens"]))
  ) {
    return errorResult(`usage field missing or invalid: ${JSON.stringify(rawUsage)}`);
  }

  const usage = rawUsage as Partial<TokenUsage>;
  const result: RunResult = {
    usage: {
      input_tokens: Number(usage.input_tokens),
      output_tokens: Number(usage.output_tokens),
      cache_creation_input_tokens: Number(usage.cache_creation_input_tokens ?? 0),
      cache_read_input_tokens: Number(usage.cache_read_input_tokens ?? 0),
    },
    num_turns: Number(obj["num_turns"] ?? 0),
    duration_ms,
    total_cost_usd: Number(obj["total_cost_usd"] ?? 0),
    is_error: Boolean(obj["is_error"] ?? false),
    result: String(obj["result"] ?? ""),
  };

  if (result.is_error) {
    result.raw_error = stderr || String(obj["result"] ?? "");
  }

  return result;
}

/**
 * claude CLI をサブプロセスとして起動し、結果を RunResult として返す。
 * ANTHROPIC_API_KEY は子プロセスの env から除外してサブスク認証を維持する。
 *
 * プロンプトはシェルメタ文字の混入を防ぐため stdin で渡す。
 * args には固定の安全なフラグのみを含め、プロンプト文字列は含めない。
 * Windows では claude が claude.cmd として存在する場合があるため
 * shell: true を維持しつつ、プロンプトを args に含めないことで
 * シェルメタ文字（& | < > ^ " ` %）による計測汚染を排除する。
 *
 * opts.timeoutMs を超えても終了しない場合は子プロセスを強制終了し、
 * is_error=true として返す。claude CLI や MCP サーバーがハングしても
 * ベンチマーク全体が停止しないようにするため。
 */
export async function runClaude(opts: RunOptions): Promise<RunResult> {
  const startTime = Date.now();

  // cwd を .runtmp にして文脈ノイズを抑える
  const cwd = ensureRuntmpDir();

  // config のプレースホルダを解決
  const resolvedConfig = resolveMcpConfig(opts.mcpConfigPath);

  // 子プロセスの env から ANTHROPIC_API_KEY を除外
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
      childEnv[k] = v;
    }
  }

  const args = buildClaudeArgs(opts, resolvedConfig);

  const claudeCmd = "claude";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;

  return new Promise<RunResult>((resolve) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    // POSIX では shell: true により claude は sh の子プロセスになる。
    // detached: true でプロセスグループを分離しておくと、タイムアウト時に
    // kill(-pid) でグループごと落とせる。これをしないと sh だけが死んで
    // claude 本体とブラウザが孤児として残る。
    const useProcessGroup = process.platform !== "win32";

    // Windows では claude.cmd の解決のため shell: true を維持する。
    // プロンプトは args に含めず stdin で渡すことで、シェルメタ文字による
    // 引数破壊を原理的に防ぐ。
    const child = spawn(claudeCmd, args, {
      cwd,
      env: childEnv,
      shell: true,
      windowsHide: true,
      detached: useProcessGroup,
    });

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    /** 子プロセス（POSIX ではプロセスグループ全体）にシグナルを送る */
    const signalChild = (signal: NodeJS.Signals): void => {
      try {
        if (useProcessGroup && child.pid !== undefined) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        // 既に終了している場合は無視
      }
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalChild("SIGTERM");
      // SIGTERM で落ちなければ猶予後に SIGKILL
      killTimer = setTimeout(() => signalChild("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref();
    }, timeoutMs);
    timeoutTimer.unref();

    const clearTimers = (): void => {
      clearTimeout(timeoutTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
    };

    // B-1: claude が即死してパイプが閉じると EPIPE が stdin の error イベントとして
    // 発火する。child.on("error") とは別の EventEmitter なので個別にハンドルする。
    // close ハンドラ側で code!==0 として処理されるため、ここでは握りつぶす。
    child.stdin.on("error", () => {
      // EPIPE/ECONNRESET は close ハンドラに委ねる
    });

    // プロンプトを stdin 経由で渡す（シェルメタ文字問題を回避）
    try {
      child.stdin.write(opts.prompt, "utf-8");
      child.stdin.end();
    } catch {
      // 同期 throw も close ハンドラに委ねる
    }

    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      errChunks.push(chunk);
    });

    /** 一時 config ファイルを削除（自分で生成したものだけ） */
    const cleanupTmpConfig = (): void => {
      if (resolvedConfig !== opts.mcpConfigPath) {
        try {
          fs.unlinkSync(resolvedConfig);
        } catch {
          // 削除失敗は無視
        }
      }
    };

    child.on("close", (code) => {
      clearTimers();
      const duration_ms = Date.now() - startTime;
      const stdout = Buffer.concat(chunks).toString("utf-8");
      const stderr = Buffer.concat(errChunks).toString("utf-8");

      cleanupTmpConfig();

      // タイムアウトで kill した場合は stdout の内容によらずエラー扱いにする。
      // 途中まで出力されていても計測値として信頼できないため。
      if (timedOut) {
        resolve({
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          num_turns: 0,
          duration_ms,
          total_cost_usd: 0,
          is_error: true,
          result: "",
          raw_error: `timeout: exceeded ${timeoutMs}ms, process killed${stderr ? `\nstderr: ${stderr.slice(0, 500)}` : ""}`,
        });
        return;
      }

      if (code !== 0 && stdout.trim() === "") {
        resolve({
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          num_turns: 0,
          duration_ms,
          total_cost_usd: 0,
          is_error: true,
          result: "",
          raw_error: stderr || `process exited with code ${code}`,
        });
        return;
      }

      // JSON パース・usage バリデーションは純粋関数に委ねる
      resolve(parseClaudeOutput(stdout, stderr, duration_ms));
    });

    child.on("error", (err) => {
      clearTimers();
      cleanupTmpConfig();
      const duration_ms = Date.now() - startTime;
      resolve({
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        num_turns: 0,
        duration_ms,
        total_cost_usd: 0,
        is_error: true,
        result: "",
        raw_error: `spawn error: ${err.message}`,
      });
    });
  });
}
