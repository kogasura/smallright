import type { Services } from '../types.js';

export async function takeScreenshot(
  s: Services,
  params: { zone?: string; full_page?: boolean; format?: 'png' | 'jpeg'; quality?: number },
): Promise<string> {
  const page = await s.browser.getPage();
  const format = params.format ?? 'png';
  const quality = format === 'jpeg' ? (params.quality ?? 50) : undefined;
  const screenshotOpts = { type: format as 'png' | 'jpeg', quality };

  let screenshotBuffer: Buffer;

  if (params.zone) {
    const zones = s.zones.getZones();
    const zoneDefinition = zones.find((z) => z.name === params.zone);
    if (!zoneDefinition) {
      throw new Error(
        `Zone "${params.zone}" not found. Defined zones: ${zones.map((z) => z.name).join(', ') || '(none)'}`,
      );
    }
    screenshotBuffer = await page.locator(zoneDefinition.selector).screenshot(screenshotOpts);
  } else {
    screenshotBuffer = await page.screenshot({
      ...screenshotOpts,
      fullPage: params.full_page ?? false,
    });
  }

  const base64 = screenshotBuffer.toString('base64');
  return JSON.stringify({ type: 'screenshot', format, data: base64 });
}
