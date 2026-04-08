import type { Services, AmbiguousMatch } from '../types.js';

// Escape special characters in CSS attribute values (e.g. name attribute)
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function selectOption(
  s: Services,
  params: { label: string; value: string },
): Promise<string> {
  const page = await s.browser.getPage();
  const zones = s.zones.getZones();

  // Scan elements and take initial snapshot
  const elements = await s.elements.scan(page);
  const urlBefore = page.url();
  const snapshotBefore = await s.differ.takeSnapshot(page, zones);

  // Resolve field
  const resolved = s.elements.resolveByLabel(params.label, elements);

  if (resolved === null) {
    const allLabels = elements
      .filter((e) => e.tag === 'select')
      .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(unknown)'} (${e.tag})`)
      .join('\n');
    throw new Error(
      `No select field matching "${params.label}" was found.\n\nSelect fields on the page:\n${allLabels}`,
    );
  }

  // Ambiguous match
  if ('candidates' in resolved) {
    return JSON.stringify(resolved as AmbiguousMatch, null, 2);
  }

  // Select the option (use selector directly if available)
  if (resolved.selector) {
    await page.locator(resolved.selector).selectOption(params.value);
  } else if (resolved.name) {
    await page.locator(`select[name="${escapeAttrValue(resolved.name)}"]`).selectOption(params.value);
  } else {
    throw new Error(
      `Cannot identify the select field for "${params.label}". A name attribute is required.`,
    );
  }

  // Wait for DOM to settle (SPA support)
  await page.waitForTimeout(500);

  // Re-scan and take snapshot
  await s.elements.scan(page);
  const urlAfter = page.url();
  const snapshotAfter = await s.differ.takeSnapshot(page, zones);

  const diff = s.differ.computeDiff(snapshotBefore, snapshotAfter, urlBefore, urlAfter);
  return JSON.stringify(diff, null, 2);
}
