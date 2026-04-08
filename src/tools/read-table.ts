import type { Services } from '../types.js';

export async function readTable(
  s: Services,
  params: { zone?: string; selector?: string },
): Promise<string> {
  const page = await s.browser.getPage();

  // テーブルを抽出するセレクタを決定する
  let tableSelector: string | null = null;

  if (params.selector) {
    // selector指定 → そのセレクタのtable
    tableSelector = params.selector;
  } else if (params.zone) {
    // zone指定 → そのゾーン内の最初のtable
    const zones = s.zones.getZones();
    const zoneDefinition = zones.find((z) => z.name === params.zone);
    if (!zoneDefinition) {
      throw new Error(
        `ゾーン "${params.zone}" が見つかりません。定義済みゾーン: ${zones.map((z) => z.name).join(', ') || '(なし)'}`,
      );
    }
    tableSelector = `${zoneDefinition.selector} table`;
  }
  // どちらもなし → ページ内の最初のtable（tableSelector = null のまま）

  // page.evaluate でテーブルを解析
  const rows = await page.evaluate((sel: string | null) => {
    let table: HTMLTableElement | null = null;

    if (sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      // selがtable自身か、その中のtableか
      if (el.tagName.toLowerCase() === 'table') {
        table = el as HTMLTableElement;
      } else {
        table = el.querySelector('table') as HTMLTableElement | null;
      }
    } else {
      table = document.querySelector('table') as HTMLTableElement | null;
    }

    if (!table) return null;

    // theadからカラム名を取得
    const headers: string[] = [];
    const headerRow = table.querySelector('thead tr');
    if (headerRow) {
      headerRow.querySelectorAll('th, td').forEach((cell) => {
        headers.push((cell as HTMLElement).innerText?.trim() ?? cell.textContent?.trim() ?? '');
      });
    }

    // tbodyの各行をオブジェクトに変換
    const result: Record<string, string>[] = [];
    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach((row) => {
      const cells = row.querySelectorAll('td, th');
      const rowObj: Record<string, string> = {};
      cells.forEach((cell, index) => {
        const key = headers[index] ?? String(index);
        rowObj[key] = (cell as HTMLElement).innerText?.trim() ?? cell.textContent?.trim() ?? '';
      });
      result.push(rowObj);
    });

    // theadがない場合（ヘッダーなしテーブル）: 最初の行をヘッダーとして扱う
    if (headers.length === 0 && result.length > 0) {
      const firstRow = table.querySelector('tr');
      if (firstRow) {
        firstRow.querySelectorAll('td, th').forEach((cell, index) => {
          headers[index] = (cell as HTMLElement).innerText?.trim() ?? cell.textContent?.trim() ?? String(index);
        });
        // 最初の行をヘッダーとして再パース
        result.length = 0;
        const allRows = table.querySelectorAll('tr');
        allRows.forEach((row, rowIndex) => {
          if (rowIndex === 0) return; // ヘッダー行をスキップ
          const cells = row.querySelectorAll('td, th');
          const rowObj: Record<string, string> = {};
          cells.forEach((cell, index) => {
            const key = headers[index] ?? String(index);
            rowObj[key] = (cell as HTMLElement).innerText?.trim() ?? cell.textContent?.trim() ?? '';
          });
          result.push(rowObj);
        });
      }
    }

    return result;
  }, tableSelector);

  if (rows === null) {
    const location = params.selector
      ? `セレクタ "${params.selector}"`
      : params.zone
        ? `ゾーン "${params.zone}"`
        : 'ページ内';
    throw new Error(`${location} にテーブルが見つかりません。`);
  }

  return JSON.stringify(rows, null, 2);
}
