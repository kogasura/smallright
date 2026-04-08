import type { Services } from '../types.js';

export async function takeScreenshot(
  s: Services,
  params: { zone?: string; full_page?: boolean },
): Promise<string> {
  const page = await s.browser.getPage();

  let screenshotBuffer: Buffer;

  if (params.zone) {
    // zone specified: locate the zone element and capture it
    const zones = s.zones.getZones();
    const zoneDefinition = zones.find((z) => z.name === params.zone);
    if (!zoneDefinition) {
      throw new Error(
        `Zone "${params.zone}" not found. Defined zones: ${zones.map((z) => z.name).join(', ') || '(none)'}`,
      );
    }
    screenshotBuffer = await page.locator(zoneDefinition.selector).screenshot();
  } else {
    // No zone specified: capture the full page
    screenshotBuffer = await page.screenshot({
      fullPage: params.full_page ?? false,
    });
  }

  const base64 = screenshotBuffer.toString('base64');
  return JSON.stringify({ type: 'screenshot', data: base64 }, null, 2);
}
