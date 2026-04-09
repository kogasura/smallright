import type { Services, ZoneDefinition } from "../types.js";

export async function configureZones(
  s: Services,
  params: { zones?: Array<{ name: string; selector: string; description?: string }> }
): Promise<string> {
  const page = await s.browser.getPage();

  if (params.zones === undefined) {
    // Auto mode: detect zones from the current page
    const detected = await s.zones.autoDetect(page);
    s.zones.setZones(detected);
    return JSON.stringify(detected, null, 2);
  }

  // Manual mode: use the provided zone definitions
  const zones: ZoneDefinition[] = params.zones.map(z => ({
    name: z.name,
    selector: z.selector,
    ...(z.description !== undefined ? { description: z.description } : {}),
  }));
  s.zones.setZones(zones);
  return JSON.stringify(zones, null, 2);
}
