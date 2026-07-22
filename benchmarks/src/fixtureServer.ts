import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { dirFromMetaUrl } from "./paths.js";

const FIXTURES_DIR = path.resolve(dirFromMetaUrl(import.meta.url), "..", "fixtures");

/** 拡張子ごとの Content-Type。フィクスチャで使うものだけ列挙する */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export interface FixtureServer {
  /** 例: http://127.0.0.1:54321 */
  baseUrl: string;
  /** サーバーを停止する */
  close: () => Promise<void>;
}

/**
 * 同梱フィクスチャ (benchmarks/fixtures) を http で配信する軽量サーバー。
 *
 * smallright は file:// を開けないため、両 MCP が同じ URL でローカルフィクスチャを
 * 開けるよう http 経由にする。127.0.0.1 は proxy の noProxy に含まれるので、
 * 外部ネットワークに一切依存せず再現性を保てる。
 *
 * ポートは 0 を指定して OS に空きポートを採番させ、並行実行や既存プロセスとの
 * 衝突を避ける。
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const server = http.createServer((req, res) => {
    const rawPath = (req.url ?? "/").split("?")[0].split("#")[0];
    let urlPath: string;
    try {
      urlPath = decodeURIComponent(rawPath);
    } catch {
      res.statusCode = 400;
      res.end("Bad Request");
      return;
    }

    // path traversal 防止: 正規化後に FIXTURES_DIR 配下へ収まることを確認する
    const resolved = path.normalize(path.join(FIXTURES_DIR, urlPath));
    if (resolved !== FIXTURES_DIR && !resolved.startsWith(FIXTURES_DIR + path.sep)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    let filePath = resolved;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      res.statusCode = 500;
      res.end("Server Error");
    });
    stream.pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
