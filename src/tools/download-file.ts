import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as readline from 'readline';
import * as path from 'path';
import type { Services, AmbiguousMatch } from '../types.js';
import { resolveLocator } from '../core/locator-helper.js';

const MIME_MAP: Record<string, string> = {
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.log': 'text/plain',
};

const TEXT_EXTENSIONS = new Set(['.txt', '.csv', '.json', '.log']);

async function readFirstLines(filePath: string, maxLines: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let errored = false;
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      lines.push(line);
      if (lines.length >= maxLines) {
        rl.close();
        stream.destroy();
      }
    });

    rl.on('close', () => {
      if (!errored) resolve(lines.join('\n'));
    });

    const onError = (err: Error) => {
      if (errored) return;
      errored = true;
      rl.close();
      stream.destroy();
      reject(err);
    };
    rl.on('error', onError);
    stream.on('error', onError);
  });
}

export async function downloadFile(
  s: Services,
  params: { text: string; role?: string; index?: number; timeout?: number; save_path?: string },
): Promise<string> {
  const page = await s.browser.getPage();

  // 1. scan() で要素取得
  const elements = await s.elements.scan(page);

  // 2. resolveByText で要素特定
  const resolved = s.elements.resolveByText(params.text, elements, undefined, params.index, params.role);

  if (resolved === null) {
    const allTexts = elements.map((e) => `- ${e.text} (${e.tag})`).join('\n');
    throw new Error(
      `No element matching "${params.text}" was found.\n\nInteractive elements on the page:\n${allTexts}`,
    );
  }

  // AmbiguousMatch はそのまま返す
  if ('candidates' in resolved) {
    return JSON.stringify(resolved as AmbiguousMatch, null, 2);
  }

  // 3. download Promise を click の前に生成（競合回避）
  const timeout = params.timeout ?? 30000;
  const downloadPromise = page.waitForEvent('download', { timeout });

  // 4. resolveLocator で要素をクリック
  const locator = resolveLocator(page, resolved);
  await locator.click({ timeout: 10000 });

  // 5. download イベントを受信
  const download = await downloadPromise;

  // 6. ファイル名取得
  const filename = download.suggestedFilename();
  const ext = path.extname(filename).toLowerCase();
  const mimeType = MIME_MAP[ext] ?? null;

  // 7. 一時ファイルのパスとサイズ取得
  const tmpPath = await download.path();
  if (tmpPath === null) {
    throw new Error(
      `Download failed or the temporary file path is unavailable. ` +
      `This can occur when the browser was launched without a download directory configured.`,
    );
  }

  const stat = await fsPromises.stat(tmpPath);
  const size = stat.size;

  // 8. テキストファイルならプレビュー（先頭20行）
  let preview: string | undefined;
  if (TEXT_EXTENSIONS.has(ext)) {
    preview = await readFirstLines(tmpPath, 20);
  }

  // 9. save_path 指定時は保存、未指定時は削除
  if (params.save_path) {
    await download.saveAs(params.save_path);
  } else {
    await download.delete();
  }

  // 10. 結果返却
  const result: { filename: string; size: number; mimeType: string | null; preview?: string } = {
    filename,
    size,
    mimeType,
    ...(preview !== undefined ? { preview } : {}),
  };

  return JSON.stringify(result, null, 2);
}
