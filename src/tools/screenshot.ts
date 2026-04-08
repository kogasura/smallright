import type { Services } from '../types.js';

export async function takeScreenshot(
  s: Services,
  params: { zone?: string; full_page?: boolean },
): Promise<string> {
  const page = await s.browser.getPage();

  let screenshotBuffer: Buffer;

  if (params.zone) {
    // zone指定 → そのゾーンのセレクタでlocator → screenshot → Base64
    const zones = s.zones.getZones();
    const zoneDefinition = zones.find((z) => z.name === params.zone);
    if (!zoneDefinition) {
      throw new Error(
        `ゾーン "${params.zone}" が見つかりません。定義済みゾーン: ${zones.map((z) => z.name).join(', ') || '(なし)'}`,
      );
    }
    screenshotBuffer = await page.locator(zoneDefinition.selector).screenshot();
  } else {
    // zone未指定 → ページ全体のscreenshot
    screenshotBuffer = await page.screenshot({
      fullPage: params.full_page ?? false,
    });
  }

  const base64 = screenshotBuffer.toString('base64');
  return JSON.stringify({ type: 'screenshot', data: base64 }, null, 2);
}
