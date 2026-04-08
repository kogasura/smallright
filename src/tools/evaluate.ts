import type { Services } from '../types.js';

export async function evaluate(
  s: Services,
  params: { script: string },
): Promise<string> {
  const page = await s.browser.getPage();

  // page.evaluate にスクリプト文字列を直接渡す
  // eslint-disable-next-line no-new-func
  const result = await page.evaluate(new Function(params.script) as () => unknown);

  return JSON.stringify(result, null, 2);
}
