import { fileURLToPath } from "node:url";
import * as path from "node:path";

/**
 * import.meta.url から呼び出し元ファイルのディレクトリパスを返す。
 * node:url の fileURLToPath を使うことで Windows の /C:/... 形式を
 * 正しく C:\... に変換し、手動正規化の重複を排除する。
 */
export function dirFromMetaUrl(metaUrl: string): string {
  return path.dirname(fileURLToPath(metaUrl));
}
