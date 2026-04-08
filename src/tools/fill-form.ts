import type { Services, AmbiguousMatch } from '../types.js';

// name属性等のCSSセレクタ内での特殊文字をエスケープする
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function fillForm(
  s: Services,
  params: { fields: Record<string, string> },
): Promise<string> {
  const page = await s.browser.getPage();
  const zones = s.zones.getZones();

  // 空のfieldsに対して早期リターン
  const fieldEntries = Object.entries(params.fields);
  if (fieldEntries.length === 0) {
    const urlNow = page.url();
    const snapshotNow = await s.differ.takeSnapshot(page, zones);
    const diff = s.differ.computeDiff(snapshotNow, snapshotNow, urlNow, urlNow);
    return JSON.stringify(diff, null, 2);
  }

  // 事前スナップショット取得
  const urlBefore = page.url();
  const snapshotBefore = await s.differ.takeSnapshot(page, zones);

  const filledFields: string[] = [];

  // ループ前に1回だけスキャン
  let elements = await s.elements.scan(page);

  for (const [label, value] of fieldEntries) {
    // 要素解決
    let resolved = s.elements.resolveByLabel(label, elements);

    // 解決失敗時のみ再スキャン（動的フォーム対応）
    if (resolved === null) {
      elements = await s.elements.scan(page);
      resolved = s.elements.resolveByLabel(label, elements);
    }

    if (resolved === null) {
      const allLabels = elements
        .filter((e) => ['input', 'select', 'textarea'].includes(e.tag))
        .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(不明)'} (${e.tag})`)
        .join('\n');
      return JSON.stringify(
        {
          error: `"${label}" に一致するフィールドが見つかりません`,
          filledFields,
          availableFields: allLabels,
        },
        null,
        2,
      );
    }

    // 曖昧マッチ
    if ('candidates' in resolved) {
      return JSON.stringify(
        {
          error: `"${label}" が曖昧マッチしました`,
          filledFields,
          ambiguousMatch: resolved as AmbiguousMatch,
        },
        null,
        2,
      );
    }

    // 入力実行（selectorがあれば直接使用）
    if (resolved.selector) {
      await page.locator(resolved.selector).fill(value);
    } else if (resolved.name) {
      await page.locator(`[name="${escapeAttrValue(resolved.name)}"]`).fill(value);
    } else if (resolved.placeholder) {
      await page.getByPlaceholder(resolved.placeholder).fill(value);
    } else {
      return JSON.stringify(
        {
          error: `"${label}" のフィールドを特定できません。name属性またはplaceholder属性が必要です。`,
          filledFields,
        },
        null,
        2,
      );
    }

    // DOM安定待ち（SPA対応）
    await page.waitForTimeout(500);

    filledFields.push(label);
  }

  // 全フィールド入力後のスナップショット取得
  await s.elements.scan(page);
  const urlAfter = page.url();
  const snapshotAfter = await s.differ.takeSnapshot(page, zones);

  const diff = s.differ.computeDiff(snapshotBefore, snapshotAfter, urlBefore, urlAfter);
  return JSON.stringify(diff, null, 2);
}
