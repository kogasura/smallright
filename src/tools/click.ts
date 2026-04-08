import type { Services, AmbiguousMatch } from '../types.js';

export async function clickElement(
  s: Services,
  params: { text: string; role?: string; zone?: string; index?: number },
): Promise<string> {
  const page = await s.browser.getPage();
  const zones = s.zones.getZones();

  // Scan elements and take initial snapshot
  const elements = await s.elements.scan(page);
  const urlBefore = page.url();
  const snapshotBefore = await s.differ.takeSnapshot(page, zones);

  // Resolve element
  const resolved = s.elements.resolveByText(params.text, elements, params.zone, params.index);

  if (resolved === null) {
    const allTexts = elements.map((e) => `- ${e.text} (${e.tag})`).join('\n');
    throw new Error(
      `No element matching "${params.text}" was found.\n\nInteractive elements on the page:\n${allTexts}`,
    );
  }

  // Ambiguous match
  if ('candidates' in resolved) {
    return JSON.stringify(resolved as AmbiguousMatch, null, 2);
  }

  // Click the element (use selector directly if available)
  if (resolved.selector) {
    await page.locator(resolved.selector).click({ timeout: 10000 });
  } else {
    // Fallback when no selector is available (should not normally occur)
    await page.locator(`text=${params.text}`).first().click({ timeout: 10000 });
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
