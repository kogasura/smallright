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
}

const RUNTMP_DIR = path.resolve(dirFromMetaUrl(import.meta.url), "..", ".runtmp");

/**
 * smallright.mcp.json 内の {{SMALLRIGHT_DIST}} プレースホルダを
 * 実際の絶対パスに置換した一時 config ファイルを生成して返す。
 * playwright.mcp.json はそのままコピーして返す。
 */
function resolveMcpConfig(configPath: string): string {
  const raw = fs.readFileSync(configPath, "utf-8");

  // プレースホルダが含まれている場合は置換する
  if (raw.includes("{{SMALLRIGHT_DIST}}")) {
    const repoRoot = path.resolve(dirFromMetaUrl(import.meta.url), "..", "..");
    const distPath = path.join(repoRoot, "dist", "index.js");
    const resolved = raw.replace(/\{\{SMALLRIGHT_DIST\}\}/g, distPath.replace(/\\/g, "/"));

    // ディレクトリ生成は ensureRuntmpDir に委ねる
    const dir = ensureRuntmpDir();
    const tmpFile = path.join(dir, `smallright-${Date.now()}.mcp.json`);
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

  // プロンプトは stdin で渡すため args には含めない
  // resolvedConfig の絶対パスにスペースが含まれる場合も shell 経由で
  // 引数として渡すため引用符で保護する
  const configArg =
    resolvedConfig.includes(" ") ? `"${resolvedConfig}"` : resolvedConfig;

  const args = [
    "--print",
    "--mcp-config",
    configArg,
    "--model",
    opts.model,
    "--output-format",
    "json",
    "--allowedTools",
    opts.allowedTools,
    "--dangerously-skip-permissions",
  ];

  const claudeCmd = "claude";

  return new Promise<RunResult>((resolve) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    // Windows では claude.cmd の解決のため shell: true を維持する。
    // プロンプトは args に含めず stdin で渡すことで、シェルメタ文字による
    // 引数破壊を原理的に防ぐ。
    const child = spawn(claudeCmd, args, {
      cwd,
      env: childEnv,
      shell: true,
      windowsHide: true,
    });

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

    child.on("close", (code) => {
      const duration_ms = Date.now() - startTime;
      const stdout = Buffer.concat(chunks).toString("utf-8");
      const stderr = Buffer.concat(errChunks).toString("utf-8");

      // 一時 config ファイルを削除（自分で生成したものだけ）
      if (resolvedConfig !== opts.mcpConfigPath) {
        try {
          fs.unlinkSync(resolvedConfig);
        } catch {
          // 削除失敗は無視
        }
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
