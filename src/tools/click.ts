import type { Services, AmbiguousMatch } from '../types.js';
import { resolveLocator } from '../core/locator-helper.js';

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

  // Click the element
  const locator = resolveLocator(page, resolved);
  await locator.click({ timeout: 10000 });

  // Wait for DOM to settle (SPA support)
  await page.waitForTimeout(500);

  // Re-scan and take snapshot
  await s.elements.scan(page);
  const urlAfter = page.url();
  const snapshotAfter = await s.differ.takeSnapshot(page, zones);

  const diff = s.differ.computeDiff(snapshotBefore, snapshotAfter, urlBefore, urlAfter);
  const responseJson = JSON.stringify(diff, null, 2);
  const dialogs = s.browser.consumeDialogMessages();
  if (dialogs.length > 0) {
    return JSON.stringify({ ...JSON.parse(responseJson), dialogs }, null, 2);
  }
  return responseJson;
}
