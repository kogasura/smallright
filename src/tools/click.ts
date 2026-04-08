import type { Services, AmbiguousMatch } from '../types.js';

export async function clickElement(
  s: Services,
  params: { text: string; role?: string; zone?: string; index?: number },
): Promise<string> {
  const page = await s.browser.getPage();
  const zones = s.zones.getZones();

  // 事前スキャンとスナップショット取得
  const elements = await s.elements.scan(page);
  const urlBefore = page.url();
  const snapshotBefore = await s.differ.takeSnapshot(page, zones);

  // 要素解決
  const resolved = s.elements.resolveByText(params.text, elements, params.zone, params.index);

  if (resolved === null) {
    const allTexts = elements.map((e) => `- ${e.text} (${e.tag})`).join('\n');
    throw new Error(
      `"${params.text}" に一致する要素が見つかりません。\n\nページ上のインタラクティブ要素一覧:\n${allTexts}`,
    );
  }

  // 曖昧マッチ
  if ('candidates' in resolved) {
    return JSON.stringify(resolved as AmbiguousMatch, null, 2);
  }

  // クリック実行（selectorがあれば直接使用）
  if (resolved.selector) {
    await page.locator(resolved.selector).click({ timeout: 10000 });
  } else {
    // selectorがない場合のフォールバック（通常はここに来ない）
    await page.locator(`text=${params.text}`).first().click({ timeout: 10000 });
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
