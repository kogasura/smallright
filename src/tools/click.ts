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

  // Assign zone membership if zones are defined and zone param is specified (B4 fix)
  if (params.zone && zones.length > 0) {
    const zoneSelectors = zones.map(z => ({ name: z.name, selector: z.selector }));
    const zoneMap = await page.evaluate(
      (args: { selectors: Array<{ name: string; selector: string }> }) => {
        const result: Record<number, string> = {};
        for (const z of args.selectors) {
          const zoneEl = document.querySelector(z.selector);
          if (!zoneEl) continue;
          const allInteractive = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [onclick], [tabindex]:not([tabindex="-1"])');
          allInteractive.forEach((el, i) => {
            if (zoneEl.contains(el)) {
              result[i] = z.name;
            }
          });
        }
        return result;
      },
      { selectors: zoneSelectors }
    );
    elements.forEach((el) => {
      if (el.scanIndex !== undefined && zoneMap[el.scanIndex]) {
        el.zone = zoneMap[el.scanIndex];
      }
    });
  }

  const urlBefore = page.url();
  const snapshotBefore = await s.differ.takeSnapshot(page, zones);

  // Resolve element
  const resolved = s.elements.resolveByText(params.text, elements, params.zone, params.index, params.role);

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

  // URL change polling (max 2s)
  const maxWait = 2000;
  const interval = 100;
  let elapsed = 0;
  while (elapsed < maxWait && page.url() === urlBefore) {
    await page.waitForTimeout(interval);
    elapsed += interval;
  }
  // DOM stabilization wait
  await page.waitForTimeout(300);

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
