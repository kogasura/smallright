import type { Services } from '../types.js';

export async function readTable(
  s: Services,
  params: { zone?: string; selector?: string },
): Promise<string> {
  const page = await s.browser.getPage();

  // Determine the selector for the target table
  let tableSelector: string | null = null;

  if (params.selector) {
    // selector specified: use it directly
    tableSelector = params.selector;
  } else if (params.zone) {
    // zone specified: target the first table within that zone
    const zones = s.zones.getZones();
    const zoneDefinition = zones.find((z) => z.name === params.zone);
    if (!zoneDefinition) {
      throw new Error(
        `Zone "${params.zone}" not found. Defined zones: ${zones.map((z) => z.name).join(', ') || '(none)'}`,
      );
    }
    tableSelector = `${zoneDefinition.selector} table`;
  }
  // Neither specified: target the first table on the page (tableSelector remains null)

  // Parse the table in the browser
  const rows = await page.evaluate((sel: string | null) => {
    let table: HTMLTableElement | null = null;

    if (sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      // sel may point to the table itself or a container holding a table
      if (el.tagName.toLowerCase() === 'table') {
        table = el as HTMLTableElement;
      } else {
        table = el.querySelector('table') as HTMLTableElement | null;
      }
    } else {
      table = document.querySelector('table') as HTMLTableElement | null;
    }

    if (!table) return null;

    // Extract column names from thead
    const headers: string[] = [];
    const headerRow = table.querySelector('thead tr');
    if (headerRow) {
      headerRow.querySelectorAll('th, td').forEach((cell) => {
        headers.push((cell as HTMLElement).innerText?.trim() ?? cell.textContent?.trim() ?? '');
      });
    }

    // Identify columns to skip (empty headers = checkbox/action columns)
    const skipColumns = new Set<number>();
    headers.forEach((h, i) => { if (h === '') skipColumns.add(i); });

    // Convert each tbody row to an object, skipping empty-header columns
    const result: Record<string, string>[] = [];
    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach((row) => {
      const cells = row.querySelectorAll('td, th');
      const rowObj: Record<string, string> = {};
      cells.forEach((cell, index) => {
        if (skipColumns.has(index)) return;
        const key = headers[index] ?? String(index);
        rowObj[key] = (cell as HTMLElement).innerText?.trim() ?? cell.textContent?.trim() ?? '';
      });
      result.push(rowObj);
    });

    // If no thead, treat the first row as the header
    if (headers.length === 0 && result.length > 0) {
      const firstRow = table.querySelector('tr');
      if (firstRow) {
        firstRow.querySelectorAll('td, th').forEach((cell, index) => {
          headers[index] = (cell as HTMLElement).innerText?.trim() ?? cell.textContent?.trim() ?? String(index);
        });
        // Re-identify skip columns
        skipColumns.clear();
        headers.forEach((h, i) => { if (h === '') skipColumns.add(i); });
        // Re-parse excluding the header row
        result.length = 0;
        const allRows = table.querySelectorAll('tr');
        allRows.forEach((row, rowIndex) => {
          if (rowIndex === 0) return;
          const cells = row.querySelectorAll('td, th');
          const rowObj: Record<string, string> = {};
          cells.forEach((cell, index) => {
            if (skipColumns.has(index)) return;
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
      ? `selector "${params.selector}"`
      : params.zone
        ? `zone "${params.zone}"`
        : 'the page';
    throw new Error(`No table found in ${location}.`);
  }

  return JSON.stringify(rows, null, 2);
}
