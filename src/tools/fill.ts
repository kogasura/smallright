import type { Services, AmbiguousMatch } from '../types.js';

// name属性等のCSSセレクタ内での特殊文字をエスケープする
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function fillField(
  s: Services,
  params: { label: string; value: string },
): Promise<string> {
  const page = await s.browser.getPage();
  const zones = s.zones.getZones();

  // 事前スキャンとスナップショット取得
  const elements = await s.elements.scan(page);
  const urlBefore = page.url();
  const snapshotBefore = await s.differ.takeSnapshot(page, zones);

  // 要素解決
  const resolved = s.elements.resolveByLabel(params.label, elements);

  if (resolved === null) {
    const allLabels = elements
      .filter((e) => ['input', 'select', 'textarea'].includes(e.tag))
      .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(不明)'} (${e.tag})`)
      .join('\n');
    throw new Error(
      `"${params.label}" に一致するフィールドが見つかりません。\n\nページ上のフォームフィールド一覧:\n${allLabels}`,
    );
  }

  // 曖昧マッチ
  if ('candidates' in resolved) {
    return JSON.stringify(resolved as AmbiguousMatch, null, 2);
  }

  // 入力実行（selectorがあれば直接使用）
  if (resolved.selector) {
    await page.locator(resolved.selector).fill(params.value);
  } else if (resolved.name) {
    await page.locator(`[name="${escapeAttrValue(resolved.name)}"]`).fill(params.value);
  } else if (resolved.placeholder) {
    await page.getByPlaceholder(resolved.placeholder).fill(params.value);
  } else {
    throw new Error(
      `"${params.label}" のフィールドを特定できません。name属性またはplaceholder属性が必要です。`,
    );
  }

  // DOM安定待ち（SPA対応）
  await page.waitForTimeout(500);

  // 再スキャンとスナップショット取得
  await s.elements.scan(page);
  const urlAfter = page.url();
  const snapshotAfter = await s.differ.takeSnapshot(page, zones);

  const diff = s.differ.computeDiff(snapshotBefore, snapshotAfter, urlBefore, urlAfter);
  return JSON.stringify(diff, null, 2);
}
