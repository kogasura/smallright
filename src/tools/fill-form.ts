import type { Services, AmbiguousMatch } from '../types.js';
import { resolveLocator } from '../core/locator-helper.js';

export async function fillForm(
  s: Services,
  params: { fields: Record<string, string> },
): Promise<string> {
  const page = await s.browser.getPage();
  const zones = s.zones.getZones();

  // Early return for empty fields
  const fieldEntries = Object.entries(params.fields);
  if (fieldEntries.length === 0) {
    const urlNow = page.url();
    const snapshotNow = await s.differ.takeSnapshot(page, zones);
    const diff = s.differ.computeDiff(snapshotNow, snapshotNow, urlNow, urlNow);
    return JSON.stringify(diff, null, 2);
  }

  // Take initial snapshot
  const urlBefore = page.url();
  const snapshotBefore = await s.differ.takeSnapshot(page, zones);

  const filledFields: string[] = [];

  // Scan once before the loop
  let elements = await s.elements.scan(page);

  for (const [label, value] of fieldEntries) {
    // Resolve field
    let resolved = s.elements.resolveByLabel(label, elements);

    // Re-scan on failure to handle dynamic forms
    if (resolved === null) {
      elements = await s.elements.scan(page);
      resolved = s.elements.resolveByLabel(label, elements);
    }

    if (resolved === null) {
      const allLabels = elements
        .filter((e) => ['input', 'select', 'textarea'].includes(e.tag))
        .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(unknown)'} (${e.tag})`)
        .join('\n');
      return JSON.stringify(
        {
          error: `No field matching "${label}" was found`,
          filledFields,
          availableFields: allLabels,
        },
        null,
        2,
      );
    }

    // Ambiguous match
    if ('candidates' in resolved) {
      return JSON.stringify(
        {
          error: `"${label}" matched multiple fields`,
          filledFields,
          ambiguousMatch: resolved as AmbiguousMatch,
        },
        null,
        2,
      );
    }

    // Fill the field
    const locator = resolveLocator(page, resolved);
    await locator.fill(value);

    // Wait for DOM to settle (SPA support)
    await page.waitForTimeout(500);

    filledFields.push(label);
  }

  // Take final snapshot after all fields are filled
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
