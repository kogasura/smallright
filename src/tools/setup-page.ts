import type { Services } from "../types.js";

export async function setupPage(
  s: Services,
  _params: Record<string, never>
): Promise<string> {
  const page = await s.browser.getPage();
  const zones = await s.zones.autoDetect(page);
  return JSON.stringify(zones, null, 2);
}
