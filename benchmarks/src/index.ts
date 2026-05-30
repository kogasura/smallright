import { runBenchmark } from "./runner.js";
import { aggregate, writeResults, printSummary } from "./report.js";
import { scenarios } from "./scenarios.js";
import { mcpTargets } from "./runner.js";

// ---------------------------------------------------------------------------
// 簡易 CLI 引数パース
// ---------------------------------------------------------------------------

interface CliArgs {
  repeat: number;
  model: string;
  scenarioIds?: string[];
  mcpKeys?: Array<"smallright" | "playwright">;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    repeat: 3,
    model: "sonnet",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--repeat" && next !== undefined) {
      const n = parseInt(next, 10);
      if (!isNaN(n) && n > 0) {
        args.repeat = n;
      }
      i++;
    } else if (arg === "--model" && next !== undefined) {
      args.model = next;
      i++;
    } else if (arg === "--scenario" && next !== undefined) {
      // カンマ区切りまたは複数フラグをサポート
      args.scenarioIds = args.scenarioIds ?? [];
      args.scenarioIds.push(...next.split(",").map((s) => s.trim()));
      i++;
    } else if (arg === "--mcp" && next !== undefined) {
      args.mcpKeys = args.mcpKeys ?? [];
      for (const k of next.split(",").map((s) => s.trim())) {
        if (k === "smallright" || k === "playwright") {
          args.mcpKeys.push(k);
        } else {
          console.warn(`Unknown MCP key: ${k}. Valid keys: smallright, playwright`);
        }
      }
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
smallright benchmark harness

Usage:
  npm run bench [-- options]

Options:
  --repeat <n>       Number of runs per scenario×MCP (default: 3)
  --model <id>       Claude model ID (default: sonnet)
  --scenario <id>    Run specific scenario(s), comma-separated
                     Valid: ${scenarios.map((s) => s.id).join(", ")}
  --mcp <key>        Run specific MCP(s), comma-separated
                     Valid: ${mcpTargets.map((m) => m.key).join(", ")}
  --help, -h         Show this help

Examples:
  npm run bench
  npm run bench -- --repeat 5
  npm run bench -- --scenario login --mcp smallright
  npm run bench -- --model claude-sonnet-4-5
`);
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // process.argv[0] = node, process.argv[1] = スクリプトパス なので slice(2) でオプションのみ取得
  const rawArgs = process.argv.slice(2);
  const cliArgs = parseArgs(rawArgs);

  console.log("=== smallright token benchmark ===");
  console.log(`repeat  : ${cliArgs.repeat}`);
  console.log(`model   : ${cliArgs.model}`);
  console.log(`scenario: ${cliArgs.scenarioIds?.join(", ") ?? "all"}`);
  console.log(`mcp     : ${cliArgs.mcpKeys?.join(", ") ?? "all"}`);
  console.log("");

  const records = await runBenchmark({
    repeat: cliArgs.repeat,
    model: cliArgs.model,
    scenarioIds: cliArgs.scenarioIds,
    mcpKeys: cliArgs.mcpKeys,
  });

  if (records.length === 0) {
    console.error("No records collected. Exiting.");
    process.exit(1);
  }

  const result = aggregate(records, cliArgs.model);
  writeResults(result);
  printSummary(result);
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
