import type { Services, AmbiguousMatch } from '../types.js';
import { resolveLocator } from '../core/locator-helper.js';

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

  // Fill the field
  const locator = resolveLocator(page, resolved);
  await locator.fill(params.value);

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
