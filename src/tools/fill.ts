import type { Services, AmbiguousMatch } from '../types.js';

// Escape special characters in CSS attribute values (e.g. name attribute)
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function fillField(
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
      .filter((e) => ['input', 'select', 'textarea'].includes(e.tag))
      .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(unknown)'} (${e.tag})`)
      .join('\n');
    throw new Error(
      `No field matching "${params.label}" was found.\n\nForm fields on the page:\n${allLabels}`,
    );
  }

  // Ambiguous match
  if ('candidates' in resolved) {
    return JSON.stringify(resolved as AmbiguousMatch, null, 2);
  }

  // Fill the field (use selector directly if available)
  if (resolved.selector) {
    await page.locator(resolved.selector).fill(params.value);
  } else if (resolved.name) {
    await page.locator(`[name="${escapeAttrValue(resolved.name)}"]`).fill(params.value);
  } else if (resolved.placeholder) {
    await page.getByPlaceholder(resolved.placeholder).fill(params.value);
  } else {
    throw new Error(
      `Cannot identify the field for "${params.label}". A name or placeholder attribute is required.`,
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
