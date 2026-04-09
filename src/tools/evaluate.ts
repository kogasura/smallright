import type { Services } from '../types.js';

export async function evaluate(
  s: Services,
  params: { script: string },
): Promise<string> {
  const page = await s.browser.getPage();

  // Wrap the script in an async IIFE so that await can be used inside
  const wrapped = `(async () => { ${params.script} })()`;

  try {
    const result = await page.evaluate(wrapped);
    return JSON.stringify(result ?? null, null, 2);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Script evaluation failed: ${message}\n\nProvided script:\n${params.script}`);
  }
}
